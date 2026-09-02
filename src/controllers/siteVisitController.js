/**
 * siteVisitController.js — Next One Realty CRM
 *
 * Original site visits (first-time visits).
 *
 * Base path: /api/v1/site-visits
 */

const { pool }        = require('../config/db');
const { sendSuccess, paginate } = require('../utils/response');
const AppError        = require('../utils/AppError');
const { createNotification, notifyAdmins } = require('./notificationController');
const { getTeamIds, ADMIN_ROLES, LEAF_ROLES } = require('../utils/teamUtils');
const { resolveProjectId, resolveProjectName } = require('../utils/projectResolver');

const VALID_STATUSES   = ['scheduled', 'done', 'complete', 'completed', 'cancelled', 'rescheduled', 'no_show'];
const COMPLETED_STATUSES = ['done', 'complete', 'completed'];
const VALID_REACTIONS  = ['very_positive', 'positive', 'neutral', 'negative', 'not_interested'];
const VALID_NEXT_STEPS = ['negotiation', 'follow_up', 'send_proposal', 'booked', 'lost', 'site_revisit'];

const normalizeStatus = (status) => COMPLETED_STATUSES.includes(status) ? 'done' : status;

// ─── GET /api/v1/site-visits ──────────────────────────────────────────────────
const getAllSiteVisits = async (req, res, next) => {
  try {
    const { status, lead_id, project_id, assigned_to, from, to, search,
            page = 1, per_page = 20 } = req.query;
    const { role, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params     = [];
    let idx        = 1;

    // Role scoping
    if (LEAF_ROLES.includes(role)) {
      conditions.push(`sv.assigned_to = $${idx++}`); params.push(callerId);
    } else if (!ADMIN_ROLES.includes(role)) {
      const teamIds = await getTeamIds(callerId);
      conditions.push(`sv.assigned_to = ANY($${idx++}::uuid[])`); params.push(teamIds);
    }

    if (status)      { conditions.push(`sv.status = $${idx++}`);      params.push(normalizeStatus(status)); }
    if (lead_id)     { conditions.push(`sv.lead_id = $${idx++}`);     params.push(lead_id); }
    if (project_id)  {
      const resolvedProjectId = await resolveProjectId(project_id);
      conditions.push(`sv.project_id = $${idx++}`);
      params.push(resolvedProjectId);
    }
    if (assigned_to) { conditions.push(`sv.assigned_to = $${idx++}`); params.push(assigned_to); }
    if (from)        { conditions.push(`sv.visit_date >= $${idx++}`); params.push(from); }
    if (to)          { conditions.push(`sv.visit_date <= $${idx++}`); params.push(to); }
    if (search) {
      conditions.push(`(l.name ILIKE $${idx} OR l.phone ILIKE $${idx} OR COALESCE(p.name, sv.project_name_text) ILIKE $${idx} OR CONCAT(u.first_name,' ',u.last_name) ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM site_visits sv
       LEFT JOIN users u ON u.id = sv.assigned_to
       LEFT JOIN leads l ON l.id = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await pool.query(
      `SELECT sv.id, sv.lead_id, sv.visit_date, sv.visit_time,
              sv.status, sv.transport_arranged, sv.notes, sv.created_at,
              COALESCE(sv.closing_person, l.closing_person) AS closing_person,
              COALESCE(sv.closing_manager, l.closing_manager) AS closing_manager,
              CONCAT(cm.first_name,' ',cm.last_name) AS closing_manager_name,
              l.name AS lead_name, l.phone AS lead_phone,
              COALESCE(p.name, sv.project_name_text) AS project_name, p.city AS project_city,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name,
              vf.rating, vf.client_reaction, vf.next_step
       FROM site_visits sv
       LEFT JOIN leads l    ON l.id = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       LEFT JOIN users u    ON u.id = sv.assigned_to
       LEFT JOIN users cm   ON cm.id = COALESCE(sv.closing_manager, l.closing_manager)
       LEFT JOIN site_visit_feedback vf ON vf.site_visit_id = sv.id
       ${where}
       ORDER BY sv.visit_date DESC, sv.visit_time DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataRes.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) { next(err); }
};

// ─── POST /api/v1/site-visits ─────────────────────────────────────────────────
const createSiteVisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { lead_id, project_id, visit_date, visit_time, assigned_to,
            notes, transport_arranged } = req.body;

    if (!lead_id || !project_id || !visit_date || !visit_time) {
      return next(new AppError('lead_id, project_id, visit_date, and visit_time are required', 400));
    }

    // Resolve project_id — accepts an existing project's UUID or name.
    // If it doesn't match any project, fall back to storing it as free text
    // (mirrors leads.project_name_text) instead of rejecting the request.
    let resolvedProjectId = null;
    let resolvedProjectNameText = null;
    try {
      resolvedProjectId = await resolveProjectId(project_id);
    } catch (e) {
      resolvedProjectNameText = String(project_id).trim();
    }

    // Fetch lead details
    const leadRes = await pool.query(
      `SELECT l.name, l.phone, l.email, u.email AS assigned_email, CONCAT(u.first_name,' ',u.last_name) AS assigned_name
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id = $1`, [lead_id]
    );
    if (!leadRes.rows.length) return next(new AppError('Lead not found', 404));

    let projectDisplayName = resolvedProjectNameText;
    if (resolvedProjectId) {
      const projectRes = await pool.query('SELECT name FROM projects WHERE id = $1', [resolvedProjectId]);
      projectDisplayName = projectRes.rows[0]?.name || projectDisplayName;
    }

    const lead = leadRes.rows[0];
    const execId = assigned_to || lead.assigned_to;

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO site_visits
         (lead_id, project_id, project_name_text, visit_date, visit_time, assigned_to,
          status, transport_arranged, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7,$8,$9)
       RETURNING *`,
      [lead_id, resolvedProjectId, resolvedProjectNameText, visit_date, visit_time, execId,
       transport_arranged || false, notes || null, req.user.id]
    );

    // Update lead status (only touch lead.project_id when we resolved a real project)
    await client.query(
      `UPDATE leads SET status = 'site_visit_scheduled', project_id = COALESCE($1, project_id), updated_at = NOW() WHERE id = $2`,
      [resolvedProjectId, lead_id]
    );

    // Log activity
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'status_change',$2,$3)`,
      [lead_id, `Site visit scheduled at ${projectDisplayName || 'project'} on ${visit_date} at ${visit_time}`, req.user.id]
    );

    await client.query('COMMIT');

    // ── Push + in-app notifications ───────────────────────────────────────────
    setImmediate(async () => {
      try {
        const projectName = projectDisplayName || 'project';
        if (execId) {
          await createNotification(execId, {
            type:           'visit_scheduled',
            title:          'Site Visit Scheduled',
            message:        `Site visit for "${lead.name}" on ${visit_date} at ${visit_time}`,
            reference_id:   result.rows[0].id,
            reference_type: 'site_visit',
            metadata:       { lead_id, visit_date, visit_time, project: projectName },
          });
          const mgrRow = await pool.query(
            `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [execId]
          );
          if (mgrRow.rows.length) {
            await createNotification(mgrRow.rows[0].manager_id, {
              type:           'visit_scheduled',
              title:          'Site Visit Scheduled for Your Team',
              message:        `Site visit for "${lead.name}" on ${visit_date} assigned to your executive`,
              reference_id:   result.rows[0].id,
              reference_type: 'site_visit',
              metadata:       { lead_id, visit_date, project: projectName },
            });
          }
        }
        await notifyAdmins({
          type:           'visit_scheduled',
          title:          'New Site Visit Scheduled',
          message:        `Site visit for "${lead.name}" on ${visit_date} at ${visit_time}`,
          reference_id:   result.rows[0].id,
          reference_type: 'site_visit',
          metadata:       { lead_id, visit_date, project: projectName },
        });
      } catch (notifErr) {
        console.error('[Notification] createSiteVisit failed:', notifErr.message);
      }
    });

    // NOTE: the "site visit scheduled" email (notifySiteVisitScheduled) was
    // removed on purpose.

    return sendSuccess(res, 'Site visit scheduled successfully', result.rows[0], 201);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── GET /api/v1/site-visits/:id ──────────────────────────────────────────────
const getSiteVisitById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT sv.*,
              COALESCE(sv.closing_person, l.closing_person) AS closing_person,
              COALESCE(sv.closing_manager, l.closing_manager) AS closing_manager,
              l.name AS lead_name, l.phone AS lead_phone, l.email AS lead_email,
              COALESCE(p.name, sv.project_name_text) AS project_name,
              p.address AS project_address, p.city AS project_city,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name,
              CONCAT(cm.first_name,' ',cm.last_name) AS closing_manager_name,
              vf.rating, vf.client_reaction, vf.interested_in, vf.next_step, vf.remarks AS feedback_remarks
       FROM site_visits sv
       LEFT JOIN leads         l  ON l.id  = sv.lead_id
       LEFT JOIN projects      p  ON p.id  = sv.project_id
       LEFT JOIN users         u  ON u.id  = sv.assigned_to
       LEFT JOIN users         cm ON cm.id = COALESCE(sv.closing_manager, l.closing_manager)
       LEFT JOIN site_visit_feedback vf ON vf.site_visit_id = sv.id
       WHERE sv.id = $1`,
      [id]
    );
    if (!result.rows.length) return next(new AppError('Site visit not found', 404));

    return sendSuccess(res, 'Site visit fetched', result.rows[0]);
  } catch (err) { next(err); }
};

// ─── PUT /api/v1/site-visits/:id ──────────────────────────────────────────────
const updateSiteVisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { visit_date, visit_time, assigned_to, notes, transport_arranged } = req.body;

    const existing = await pool.query('SELECT * FROM site_visits WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Site visit not found', 404));

    const updates = []; const params = []; let idx = 1;
    if (visit_date          !== undefined) { updates.push(`visit_date = $${idx++}`);         params.push(visit_date); }
    if (visit_time          !== undefined) { updates.push(`visit_time = $${idx++}`);         params.push(visit_time); }
    if (assigned_to         !== undefined) { updates.push(`assigned_to = $${idx++}`);        params.push(assigned_to); }
    if (notes               !== undefined) { updates.push(`notes = $${idx++}`);              params.push(notes); }
    if (transport_arranged  !== undefined) { updates.push(`transport_arranged = $${idx++}`); params.push(transport_arranged); }

    if (!updates.length) return next(new AppError('No fields to update', 400));
    updates.push('updated_at = NOW()');
    params.push(id);

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE site_visits SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params
    );
    await client.query('COMMIT');

    return sendSuccess(res, 'Site visit updated', result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── PATCH /api/v1/site-visits/:id/status ─────────────────────────────────────
const updateSiteVisitStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id }     = req.params;
    const { status, note, closing_manager, closing_person } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return next(new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400));
    }

    const normalizedStatus = normalizeStatus(status);

    const existing = await pool.query('SELECT * FROM site_visits WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Site visit not found', 404));

    await client.query('BEGIN');

    const updateParams = [normalizedStatus];
    let updateQuery = `UPDATE site_visits SET status = $1, updated_at = NOW()`;

    if (closing_manager !== undefined) {
      updateParams.push(closing_manager);
      updateQuery += `, closing_manager = $${updateParams.length}`;
    }
    if (closing_person !== undefined) {
      updateParams.push(closing_person);
      updateQuery += `, closing_person = $${updateParams.length}`;
    }

    updateParams.push(id);
    updateQuery += ` WHERE id = $${updateParams.length}`;
    await client.query(updateQuery, updateParams);

    if (normalizedStatus === 'done') {
      await client.query(
        `UPDATE leads SET status = 'site_visit_done', updated_at = NOW()
         WHERE id = $1 AND status NOT IN ('booked','negotiation')`, [existing.rows[0].lead_id]
      );
    }

    // Also persist on the lead itself — closing_manager on the visit is
    // per-visit, but the lead needs to carry it forward too (shows up on the
    // lead's own GET responses, not just this visit's).
    if (closing_manager !== undefined) {
      await client.query(
        `UPDATE leads SET closing_manager = $1, updated_at = NOW() WHERE id = $2`,
        [closing_manager, existing.rows[0].lead_id]
      );
    }

    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [existing.rows[0].lead_id, note || `Site visit marked as ${normalizedStatus}`, req.user.id]
    );

    await client.query('COMMIT');

    // Re-fetch with the closing_manager name resolved — the UPDATE above only
    // has the raw column, and closing_manager was never actually being
    // returned to the caller at all before this.
    const updatedRes = await pool.query(
      `SELECT sv.*, CONCAT(cm.first_name,' ',cm.last_name) AS closing_manager_name
       FROM site_visits sv
       LEFT JOIN users cm ON cm.id = sv.closing_manager
       WHERE sv.id = $1`,
      [id]
    );

    // ── Push + in-app notifications ───────────────────────────────────────────
    setImmediate(async () => {
      try {
        const sv      = existing.rows[0];
        const typeMap = { done: 'visit_done', cancelled: 'visit_cancelled', rescheduled: 'visit_rescheduled' };
        const notifType = typeMap[normalizedStatus] || 'visit_scheduled';
        const titleMap  = { done: 'Site Visit Completed', cancelled: 'Site Visit Cancelled', rescheduled: 'Site Visit Rescheduled' };
        const notifTitle = titleMap[normalizedStatus] || `Site Visit ${normalizedStatus}`;

        if (sv.assigned_to) {
          await createNotification(sv.assigned_to, {
            type:           notifType,
            title:          notifTitle,
            message:        `Site visit has been marked as ${normalizedStatus}`,
            reference_id:   id,
            reference_type: 'site_visit',
            metadata:       { lead_id: sv.lead_id, status: normalizedStatus },
          });
          const mgrRow = await pool.query(
            `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [sv.assigned_to]
          );
          if (mgrRow.rows.length) {
            await createNotification(mgrRow.rows[0].manager_id, {
              type:           notifType,
              title:          `${notifTitle} (Your Team)`,
              message:        `A site visit in your team was marked as ${normalizedStatus}`,
              reference_id:   id,
              reference_type: 'site_visit',
              metadata:       { lead_id: sv.lead_id, status: normalizedStatus },
            });
          }
        }
        await notifyAdmins({
          type:           notifType,
          title:          notifTitle,
          message:        `A site visit was marked as ${normalizedStatus}`,
          reference_id:   id,
          reference_type: 'site_visit',
          metadata:       { lead_id: sv.lead_id, status: normalizedStatus },
        });
      } catch (notifErr) {
        console.error('[Notification] updateSiteVisitStatus failed:', notifErr.message);
      }
    });

    return sendSuccess(res, `Site visit marked as ${normalizedStatus}`, updatedRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── DELETE /api/v1/site-visits/:id ───────────────────────────────────────────
const deleteSiteVisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM site_visits WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Site visit not found', 404));

    await client.query('BEGIN');
    await client.query('DELETE FROM site_visits WHERE id = $1', [id]);
    await client.query('COMMIT');
    return sendSuccess(res, 'Site visit deleted');
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── DELETE /api/v1/site-visits/bulk ──────────────────────────────────────────
// Body: { ids: [uuid, ...] }. Admin/Super Admin only, matching the single-
// delete endpoint's authorize(...ADMIN) restriction at the route level.
const bulkDeleteSiteVisits = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return next(new AppError('ids array is required and cannot be empty', 400));
    }

    const existing = await pool.query('SELECT id FROM site_visits WHERE id = ANY($1::uuid[])', [ids]);
    const foundIds = existing.rows.map(r => r.id);
    const notFoundIds = ids.filter(id => !foundIds.includes(id));

    if (foundIds.length) {
      await pool.query('DELETE FROM site_visits WHERE id = ANY($1::uuid[])', [foundIds]);
    }

    return sendSuccess(res, `${foundIds.length} site visit(s) deleted`, {
      deleted_count: foundIds.length,
      deleted_ids: foundIds,
      not_found_ids: notFoundIds,
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/v1/site-visits/:id/feedback ────────────────────────────────────
const submitSiteVisitFeedback = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { rating, client_reaction, interested_in, next_step, remarks } = req.body;

    if (!client_reaction || !next_step) {
      return next(new AppError('client_reaction and next_step are required', 400));
    }

    const visit = await pool.query('SELECT * FROM site_visits WHERE id = $1', [id]);
    if (!visit.rows.length) return next(new AppError('Site visit not found', 404));

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO site_visit_feedback (site_visit_id, rating, client_reaction, interested_in, next_step, remarks, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, rating || null, client_reaction, interested_in || null, next_step, remarks || null, req.user.id]
    );

    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [visit.rows[0].lead_id, `Site visit feedback: ${client_reaction} reaction. Next step: ${next_step}`, req.user.id]
    );
    await client.query('COMMIT');

    return sendSuccess(res, 'Site visit feedback submitted', result.rows[0], 201);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ─── POST /api/v1/site-visits/create-with-lead ────────────────────────────────
const createSiteVisitWithLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    // Extract lead data and site visit data from request body
    const {
      // Lead fields
      name, phone, alternate_phone_number, email, source,
      assigned_to: lead_assigned_to, budget, location_preference, configuration,
      lead_notes, callback_time, next_followup_time,
      // Site visit fields
      project_id, project_name, visit_date, visit_time,
      assigned_to: visit_assigned_to, notes, transport_arranged,
    } = req.body;

    if (!name || !phone) {
      return next(new AppError('name and phone are required for lead', 400));
    }
    if ((!project_id && !project_name) || !visit_date || !visit_time) {
      return next(new AppError('project_id (or project_name), visit_date, and visit_time are required for site visit', 400));
    }

    // project_id takes precedence over project_name. Neither has to match an
    // existing project — if it doesn't, it's stored as free text instead
    // (mirrors leads.project_name_text).
    let resolvedProjectId = null;
    let resolvedProjectNameText = null;
    if (project_id) {
      try {
        resolvedProjectId = await resolveProjectId(project_id);
      } catch (e) {
        resolvedProjectNameText = String(project_id).trim();
      }
    } else {
      const resolved = await resolveProjectName(project_name);
      resolvedProjectId = resolved.projectId;
      resolvedProjectNameText = resolved.projectNameText;
    }

    await client.query('BEGIN');

    // Duplicate phone check — a phone number already registered to an active
    // (non-archived) lead cannot be reused. Same rule as POST /api/v1/leads.
    const dupLead = await client.query(
      "SELECT id, name FROM leads WHERE phone = $1 AND is_archived = false LIMIT 1",
      [phone]
    );
    if (dupLead.rows.length) {
      await client.query('ROLLBACK');
      return next(new AppError(
        `This phone number is already registered with lead "${dupLead.rows[0].name}". Duplicate phone numbers are not allowed.`,
        400
      ));
    }

    // Create the lead first
    const leadResult = await client.query(
      `INSERT INTO leads (
        name, phone, alternate_phone_number, email, source,
        project_id, project_name_text, assigned_to, budget, location_preference, configuration,
        callback_time, next_followup_time, status, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'site_visit_scheduled',$13) RETURNING *`,
      [
        name.trim(), phone, alternate_phone_number || null, email || null, source || null,
        resolvedProjectId || null, resolvedProjectNameText || null, lead_assigned_to || null, budget || null,
        location_preference || null, configuration || null, callback_time || null,
        next_followup_time || null, req.user.id
      ]
    );
    const lead = leadResult.rows[0];

    // Log lead creation activity
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [lead.id, lead_notes || 'Lead created with site visit', req.user.id]
    );

    // Now create the site visit
    const execId = visit_assigned_to || lead_assigned_to || lead.assigned_to || req.user.id;
    const siteVisitResult = await client.query(
      `INSERT INTO site_visits (
        lead_id, project_id, project_name_text, visit_date, visit_time, assigned_to,
        status, transport_arranged, notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7,$8,$9) RETURNING *`,
      [
        lead.id, resolvedProjectId, resolvedProjectNameText, visit_date, visit_time, execId,
        transport_arranged || false, notes || null, req.user.id
      ]
    );
    const siteVisit = siteVisitResult.rows[0];

    // Update lead's project_id (only when we resolved a real project)
    await client.query(
      `UPDATE leads SET project_id = COALESCE($1, project_id), updated_at = NOW() WHERE id = $2`,
      [resolvedProjectId, lead.id]
    );

    await client.query('COMMIT');

    // Send notifications (similar to createSiteVisit and createLead)
    setImmediate(async () => {
      try {
        const { createNotification, notifyAdmins } = require('./notificationController');
        // Get project name — fall back to the free-text name if no real project matched
        let projectName = resolvedProjectNameText || 'project';
        if (resolvedProjectId) {
          const projectRes = await pool.query('SELECT name FROM projects WHERE id = $1', [resolvedProjectId]);
          projectName = projectRes.rows[0]?.name || projectName;
        }

        if (execId) {
          await createNotification(execId, {
            type: 'visit_scheduled',
            title: 'New Lead + Site Visit Scheduled',
            message: `New lead "${name}" with site visit on ${visit_date} at ${visit_time}`,
            reference_id: siteVisit.id,
            reference_type: 'site_visit',
            metadata: { lead_id: lead.id, site_visit_id: siteVisit.id },
          });

          const mgrRow = await pool.query(
            `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [execId]
          );
          if (mgrRow.rows.length) {
            await createNotification(mgrRow.rows[0].manager_id, {
              type: 'visit_scheduled',
              title: 'New Lead + Site Visit Scheduled for Your Team',
              message: `New lead "${name}" with site visit on ${visit_date}`,
              reference_id: siteVisit.id,
              reference_type: 'site_visit',
              metadata: { lead_id: lead.id, project: projectName },
            });
          }
        }

        await notifyAdmins({
          type: 'visit_scheduled',
          title: 'New Lead + Site Visit Scheduled',
          message: `New lead "${name}" with site visit on ${visit_date} at ${visit_time}`,
          reference_id: siteVisit.id,
          reference_type: 'site_visit',
          metadata: { lead_id: lead.id, site_visit_id: siteVisit.id },
        });
      } catch (notifErr) {
        console.error('[Notification] createSiteVisitWithLead failed:', notifErr.message);
      }
    });

    return sendSuccess(res, 'Lead and site visit created successfully', {
      lead,
      siteVisit,
    }, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  getAllSiteVisits, createSiteVisit, getSiteVisitById, updateSiteVisit,
  updateSiteVisitStatus, deleteSiteVisit, bulkDeleteSiteVisits, submitSiteVisitFeedback,
  createSiteVisitWithLead,
};