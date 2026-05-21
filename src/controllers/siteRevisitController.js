/**
 * siteRevisitController.js — Next One Realty CRM
 *
 * Re-visits are follow-up site visits linked to an original site_visit.
 * They share the same lead, project and status lifecycle.
 *
 * Base path: /api/v1/site-revisits
 */

const { pool }        = require('../config/db');
const { sendSuccess, paginate } = require('../utils/response');
const AppError        = require('../utils/AppError');
const emailService    = require('../utils/emailService');

const VALID_STATUSES   = ['scheduled', 'done', 'cancelled', 'rescheduled', 'no_show'];
const VALID_REACTIONS  = ['very_positive', 'positive', 'neutral', 'negative', 'not_interested'];
const VALID_NEXT_STEPS = ['negotiation', 'follow_up', 'send_proposal', 'booked', 'lost', 'another_revisit'];

// ─── GET /api/v1/site-revisits ────────────────────────────────────────────────
const getAllRevisits = async (req, res, next) => {
  try {
    const { status, lead_id, project_id, assigned_to, from, to,
            original_visit_id, page = 1, per_page = 20 } = req.query;
    const { role, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params     = [];
    let idx        = 1;

    // Role scoping
    if (role === 'sales_executive') {
      conditions.push(`sr.assigned_to = $${idx++}`); params.push(callerId);
    } else if (role === 'sales_manager') {
      conditions.push(`u.manager_id = $${idx++}`); params.push(callerId);
    }

    if (status)            { conditions.push(`sr.status = $${idx++}`);           params.push(status); }
    if (lead_id)           { conditions.push(`sr.lead_id = $${idx++}`);          params.push(lead_id); }
    if (project_id)        { conditions.push(`sr.project_id = $${idx++}`);       params.push(project_id); }
    if (assigned_to)       { conditions.push(`sr.assigned_to = $${idx++}`);      params.push(assigned_to); }
    if (original_visit_id) { conditions.push(`sr.original_visit_id = $${idx++}`); params.push(original_visit_id); }
    if (from)              { conditions.push(`sr.visit_date >= $${idx++}`);      params.push(from); }
    if (to)                { conditions.push(`sr.visit_date <= $${idx++}`);      params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM site_revisits sr
       LEFT JOIN users u ON u.id = sr.assigned_to ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await pool.query(
      `SELECT sr.id, sr.original_visit_id, sr.visit_date, sr.visit_time,
              sr.status, sr.transport_arranged, sr.reason, sr.notes, sr.created_at,
              l.name AS lead_name, l.phone AS lead_phone,
              p.name AS project_name, p.city AS project_city,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name,
              rf.rating, rf.client_reaction, rf.next_step
       FROM site_revisits sr
       LEFT JOIN leads l    ON l.id = sr.lead_id
       LEFT JOIN projects p ON p.id = sr.project_id
       LEFT JOIN users u    ON u.id = sr.assigned_to
       LEFT JOIN site_revisit_feedback rf ON rf.revisit_id = sr.id
       ${where}
       ORDER BY sr.visit_date DESC, sr.visit_time DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataRes.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) { next(err); }
};

// ─── POST /api/v1/site-revisits ───────────────────────────────────────────────
const createRevisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { original_visit_id, visit_date, visit_time, assigned_to,
            notes, reason, transport_arranged } = req.body;

    if (!original_visit_id || !visit_date || !visit_time) {
      return next(new AppError('original_visit_id, visit_date, and visit_time are required', 400));
    }

    // Fetch the original visit to inherit lead + project
    const origRes = await pool.query(
      `SELECT sv.*, l.name AS lead_name, l.phone AS lead_phone, l.email AS lead_email,
              p.name AS project_name,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_name,
              u.email AS assigned_email
       FROM site_visits sv
       LEFT JOIN leads    l ON l.id = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       LEFT JOIN users    u ON u.id = sv.assigned_to
       WHERE sv.id = $1`,
      [original_visit_id]
    );
    if (!origRes.rows.length) return next(new AppError('Original site visit not found', 404));

    const orig = origRes.rows[0];
    const execId       = assigned_to || orig.assigned_to;
    let   assigneeEmail = orig.assigned_email;
    let   assigneeName  = orig.assigned_name;

    if (assigned_to && assigned_to !== orig.assigned_to) {
      const execRow = await pool.query(
        `SELECT email, CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1`, [assigned_to]
      );
      if (execRow.rows.length) {
        assigneeEmail = execRow.rows[0].email;
        assigneeName  = execRow.rows[0].name;
      }
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO site_revisits
         (original_visit_id, lead_id, project_id, visit_date, visit_time,
          assigned_to, status, transport_arranged, reason, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7,$8,$9,$10)
       RETURNING *`,
      [original_visit_id, orig.lead_id, orig.project_id, visit_date, visit_time,
       execId, transport_arranged || false, reason || null, notes || null, req.user.id]
    );

    // Log activity on the lead
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by)
       VALUES ($1,'note',$2,$3)`,
      [orig.lead_id,
       `Re-visit scheduled for ${visit_date} at ${visit_time}${reason ? ` — ${reason}` : ''}`,
       req.user.id]
    );

    await client.query('COMMIT');

    // ── Email notification ────────────────────────────────────────────────────
    setImmediate(async () => {
      try {
        const scheduledByRow = await pool.query(
          `SELECT CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1`, [req.user.id]
        );
        if (assigneeEmail) {
          await emailService.notifySiteVisitScheduled({
            lead:         { id: orig.lead_id, name: orig.lead_name, phone: orig.lead_phone, email: orig.lead_email },
            project:      { id: orig.project_id, name: orig.project_name },
            visit:        { visit_date, visit_time },
            assignedTo:   assigneeName,
            scheduledBy:  scheduledByRow.rows[0]?.name || 'System',
            assigneeEmail,
            adminEmails:  [],
          });
        }
      } catch (e) { console.error('[Email] createRevisit notification failed:', e.message); }
    });

    return sendSuccess(res, 'Re-visit scheduled successfully', result.rows[0], 201);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── GET /api/v1/site-revisits/:id ───────────────────────────────────────────
const getRevisitById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT sr.*,
              l.name AS lead_name, l.phone AS lead_phone, l.email AS lead_email,
              p.name AS project_name, p.address AS project_address, p.city AS project_city,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name,
              rf.rating, rf.client_reaction, rf.interested_in, rf.next_step, rf.remarks AS feedback_remarks,
              sv.visit_date AS original_visit_date, sv.visit_time AS original_visit_time
       FROM site_revisits sr
       LEFT JOIN leads         l  ON l.id  = sr.lead_id
       LEFT JOIN projects      p  ON p.id  = sr.project_id
       LEFT JOIN users         u  ON u.id  = sr.assigned_to
       LEFT JOIN site_revisit_feedback rf ON rf.revisit_id = sr.id
       LEFT JOIN site_visits   sv ON sv.id = sr.original_visit_id
       WHERE sr.id = $1`,
      [id]
    );
    if (!result.rows.length) return next(new AppError('Re-visit not found', 404));

    const r = result.rows[0];
    return sendSuccess(res, 'Re-visit fetched', {
      id: r.id, visit_date: r.visit_date, visit_time: r.visit_time,
      status: r.status, transport_arranged: r.transport_arranged,
      reason: r.reason, notes: r.notes, created_at: r.created_at,
      original_visit: {
        id: r.original_visit_id,
        visit_date: r.original_visit_date,
        visit_time: r.original_visit_time,
      },
      lead:    { id: r.lead_id,    name: r.lead_name,    phone: r.lead_phone,    email: r.lead_email },
      project: { id: r.project_id, name: r.project_name, address: r.project_address, city: r.project_city },
      assigned_to: { id: r.assigned_to, full_name: r.assigned_to_name },
      feedback: r.rating ? {
        rating: r.rating, client_reaction: r.client_reaction,
        interested_in: r.interested_in, next_step: r.next_step, remarks: r.feedback_remarks,
      } : null,
    });
  } catch (err) { next(err); }
};

// ─── PUT /api/v1/site-revisits/:id ───────────────────────────────────────────
const updateRevisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { visit_date, visit_time, assigned_to, notes, reason, transport_arranged, reschedule_reason } = req.body;

    const existing = await pool.query('SELECT * FROM site_revisits WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Re-visit not found', 404));
    if (existing.rows[0].status === 'done') return next(new AppError('Cannot update a completed re-visit', 400));

    const isReschedule = (visit_date && visit_date !== existing.rows[0].visit_date) ||
                         (visit_time && visit_time !== existing.rows[0].visit_time);

    const updates = []; const params = []; let idx = 1;
    if (visit_date          !== undefined) { updates.push(`visit_date = $${idx++}`);          params.push(visit_date); }
    if (visit_time          !== undefined) { updates.push(`visit_time = $${idx++}`);          params.push(visit_time); }
    if (assigned_to         !== undefined) { updates.push(`assigned_to = $${idx++}`);         params.push(assigned_to); }
    if (notes               !== undefined) { updates.push(`notes = $${idx++}`);               params.push(notes); }
    if (reason              !== undefined) { updates.push(`reason = $${idx++}`);              params.push(reason); }
    if (transport_arranged  !== undefined) { updates.push(`transport_arranged = $${idx++}`);  params.push(transport_arranged); }
    if (isReschedule)                      { updates.push(`status = 'rescheduled'`); }
    if (!updates.length) return next(new AppError('No fields to update', 400));
    updates.push('updated_at = NOW()');
    params.push(id);

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE site_revisits SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params
    );

    if (isReschedule) {
      await client.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
        [existing.rows[0].lead_id,
         reschedule_reason || `Re-visit rescheduled to ${visit_date} at ${visit_time}`,
         req.user.id]
      );
    }

    await client.query('COMMIT');
    return sendSuccess(res, isReschedule ? 'Re-visit rescheduled' : 'Re-visit updated', result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── PATCH /api/v1/site-revisits/:id/status ──────────────────────────────────
const updateRevisitStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id }     = req.params;
    const { status, note } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return next(new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400));
    }
    if (['cancelled', 'no_show'].includes(status) && !note) {
      return next(new AppError('note is required when cancelling or marking no_show', 400));
    }

    const existing = await pool.query(
      `SELECT sr.*, l.name AS lead_name, l.phone AS lead_phone,
              p.name AS project_name,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_name,
              u.email AS assigned_email
       FROM site_revisits sr
       LEFT JOIN leads    l ON l.id = sr.lead_id
       LEFT JOIN projects p ON p.id = sr.project_id
       LEFT JOIN users    u ON u.id = sr.assigned_to
       WHERE sr.id = $1`,
      [id]
    );
    if (!existing.rows.length) return next(new AppError('Re-visit not found', 404));

    const rv        = existing.rows[0];
    const oldStatus = rv.status;
    if (oldStatus === status) {
      return sendSuccess(res, 'Status already set to this value', { id, status });
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE site_revisits SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]
    );

    // If done, update lead status to site_visit_done (if not already booked/negotiation)
    if (status === 'done') {
      await client.query(
        `UPDATE leads SET status = 'site_visit_done', updated_at = NOW()
         WHERE id = $1 AND status NOT IN ('booked','negotiation')`, [rv.lead_id]
      );
    }

    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [rv.lead_id, note || `Re-visit marked as ${status}`, req.user.id]
    );

    await client.query('COMMIT');

    // ── Email ──────────────────────────────────────────────────────────────────
    setImmediate(async () => {
      try {
        const updatedByRow = await pool.query(
          `SELECT CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1`, [req.user.id]
        );
        await emailService.notifySiteVisitStatusChanged({
          lead:          { id: rv.lead_id, name: rv.lead_name, phone: rv.lead_phone },
          project:       { name: rv.project_name },
          visit:         { visit_date: rv.visit_date, visit_time: rv.visit_time },
          oldStatus, newStatus: status,
          updatedBy:     updatedByRow.rows[0]?.name || 'System',
          note:          note || null,
          assigneeEmail: rv.assigned_email,
          adminEmails:   [],
        });
      } catch (e) { console.error('[Email] updateRevisitStatus failed:', e.message); }
    });

    return sendSuccess(res, `Re-visit marked as ${status}`);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── DELETE /api/v1/site-revisits/:id ────────────────────────────────────────
const deleteRevisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM site_revisits WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Re-visit not found', 404));
    if (existing.rows[0].status === 'done') {
      return next(new AppError('Cannot delete a completed re-visit', 400));
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM site_revisits WHERE id = $1', [id]);
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [existing.rows[0].lead_id, 'Re-visit cancelled and deleted', req.user.id]
    );
    await client.query('COMMIT');
    return sendSuccess(res, 'Re-visit deleted');
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── POST /api/v1/site-revisits/:id/feedback ─────────────────────────────────
const submitRevisitFeedback = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { rating, client_reaction, interested_in, next_step, remarks } = req.body;

    if (!client_reaction || !next_step) {
      return next(new AppError('client_reaction and next_step are required', 400));
    }
    if (!VALID_REACTIONS.includes(client_reaction)) {
      return next(new AppError(`Invalid client_reaction. Must be: ${VALID_REACTIONS.join(', ')}`, 400));
    }
    if (!VALID_NEXT_STEPS.includes(next_step)) {
      return next(new AppError(`Invalid next_step. Must be: ${VALID_NEXT_STEPS.join(', ')}`, 400));
    }

    const revisit = await pool.query(
      `SELECT sr.*, l.name AS lead_name, p.name AS project_name
       FROM site_revisits sr
       LEFT JOIN leads    l ON l.id = sr.lead_id
       LEFT JOIN projects p ON p.id = sr.project_id
       WHERE sr.id = $1`, [id]
    );
    if (!revisit.rows.length) return next(new AppError('Re-visit not found', 404));
    if (revisit.rows[0].status !== 'done') {
      return next(new AppError('Feedback can only be submitted for completed re-visits', 400));
    }

    const dup = await pool.query('SELECT id FROM site_revisit_feedback WHERE revisit_id = $1', [id]);
    if (dup.rows.length) return next(new AppError('Feedback already submitted for this re-visit', 400));

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO site_revisit_feedback (revisit_id, rating, client_reaction, interested_in, next_step, remarks, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, rating || null, client_reaction, interested_in || null, next_step, remarks || null, req.user.id]
    );

    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [revisit.rows[0].lead_id,
       `Re-visit feedback: ${client_reaction} reaction. Next step: ${next_step}.${remarks ? ' ' + remarks : ''}`,
       req.user.id]
    );
    await client.query('COMMIT');

    return sendSuccess(res, 'Re-visit feedback submitted', result.rows[0], 201);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── GET /api/v1/site-revisits/original/:visitId ─────────────────────────────
// All re-visits for a given original site visit
const getRevisitsByOriginalVisit = async (req, res, next) => {
  try {
    const { visitId } = req.params;
    const visit = await pool.query('SELECT id FROM site_visits WHERE id = $1', [visitId]);
    if (!visit.rows.length) return next(new AppError('Original site visit not found', 404));

    const result = await pool.query(
      `SELECT sr.id, sr.visit_date, sr.visit_time, sr.status,
              sr.transport_arranged, sr.reason, sr.notes, sr.created_at,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name,
              rf.rating, rf.client_reaction, rf.next_step
       FROM site_revisits sr
       LEFT JOIN users u ON u.id = sr.assigned_to
       LEFT JOIN site_revisit_feedback rf ON rf.revisit_id = sr.id
       WHERE sr.original_visit_id = $1
       ORDER BY sr.visit_date DESC`,
      [visitId]
    );
    return sendSuccess(res, 'Re-visits fetched', { original_visit_id: visitId, revisits: result.rows });
  } catch (err) { next(err); }
};

module.exports = {
  getAllRevisits, createRevisit, getRevisitById, updateRevisit,
  updateRevisitStatus, deleteRevisit, submitRevisitFeedback,
  getRevisitsByOriginalVisit,
};