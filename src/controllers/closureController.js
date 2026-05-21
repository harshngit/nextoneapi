/**
 * closureController.js — Next One Realty CRM
 *
 * A Closure is created when a lead is booked/converted.
 * It captures all booking details, financials, unit info and commission.
 *
 * Base path: /api/v1/closures
 */

const { pool }     = require('../config/db');
const { sendSuccess, paginate } = require('../utils/response');
const AppError     = require('../utils/AppError');
const emailService = require('../utils/emailService');

const VALID_STATUSES = ['confirmed', 'cancelled', 'on_hold'];

// ── GET /api/v1/closures ──────────────────────────────────────────────────────
const getAllClosures = async (req, res, next) => {
  try {
    const { status, project_id, closed_by, from, to,
            commission_paid, page = 1, per_page = 20 } = req.query;
    const { role, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params     = [];
    let idx        = 1;

    // Role scoping — sales exec sees only their own closures
    if (role === 'sales_executive') {
      conditions.push(`lc.closed_by = $${idx++}`); params.push(callerId);
    } else if (role === 'sales_manager') {
      conditions.push(`lc.closed_by_manager = $${idx++}`); params.push(callerId);
    }

    if (status)          { conditions.push(`lc.status = $${idx++}`);            params.push(status); }
    if (project_id)      { conditions.push(`lc.project_id = $${idx++}`);        params.push(project_id); }
    if (closed_by)       { conditions.push(`lc.closed_by = $${idx++}`);         params.push(closed_by); }
    if (commission_paid) { conditions.push(`lc.commission_paid = $${idx++}`);   params.push(commission_paid === 'true'); }
    if (from)            { conditions.push(`lc.booking_date >= $${idx++}`);     params.push(from); }
    if (to)              { conditions.push(`lc.booking_date <= $${idx++}`);     params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*) FROM lead_closures lc ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    const dataRes = await pool.query(
      `SELECT lc.*,
              l.name  AS lead_name,  l.phone AS lead_phone,  l.email AS lead_email,
              p.name  AS project_name, p.city AS project_city,
              CONCAT(cb.first_name,' ',cb.last_name) AS closed_by_name,
              CONCAT(cm.first_name,' ',cm.last_name) AS closed_by_manager_name
       FROM lead_closures lc
       LEFT JOIN leads    l  ON l.id  = lc.lead_id
       LEFT JOIN projects p  ON p.id  = lc.project_id
       LEFT JOIN users    cb ON cb.id = lc.closed_by
       LEFT JOIN users    cm ON cm.id = lc.closed_by_manager
       ${where}
       ORDER BY lc.booking_date DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataRes.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) { next(err); }
};

// ── POST /api/v1/closures ─────────────────────────────────────────────────────
const createClosure = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      lead_id, project_id, site_visit_id,
      booking_date, unit_number, tower_block, floor_number, unit_type,
      carpet_area_sqft, super_area_sqft,
      agreed_price, booking_amount, payment_plan,
      loan_required, loan_bank,
      commission_amount, commission_percent,
      commission_paid, commission_paid_date,
      closed_by_manager, closure_notes,
    } = req.body;

    if (!lead_id || !booking_date) {
      return next(new AppError('lead_id and booking_date are required', 400));
    }

    // Verify lead exists and is not already closed
    const leadRes = await pool.query(
      `SELECT l.*, p.name AS project_name,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_name,
              u.email AS assigned_email
       FROM leads l
       LEFT JOIN projects p ON p.id = l.project_id
       LEFT JOIN users    u ON u.id = l.assigned_to
       WHERE l.id = $1 AND l.is_archived = false`, [lead_id]
    );
    if (!leadRes.rows.length) return next(new AppError('Lead not found', 404));

    // Prevent duplicate closure
    const dupRes = await pool.query(
      'SELECT id, status FROM lead_closures WHERE lead_id = $1', [lead_id]
    );
    if (dupRes.rows.length > 0) {
      return next(new AppError(
        `A closure already exists for this lead (status: ${dupRes.rows[0].status}). ` +
        `Use PUT /api/v1/closures/${dupRes.rows[0].id} to update it.`, 400
      ));
    }

    const lead       = leadRes.rows[0];
    const closedBy   = req.user.id;
    const projId     = project_id || lead.project_id;

    // Auto-calculate commission if percent given but amount not
    let finalCommAmt = commission_amount || null;
    if (!finalCommAmt && commission_percent && agreed_price) {
      finalCommAmt = (parseFloat(agreed_price) * parseFloat(commission_percent) / 100).toFixed(2);
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO lead_closures (
         lead_id, project_id, site_visit_id,
         booking_date, unit_number, tower_block, floor_number, unit_type,
         carpet_area_sqft, super_area_sqft,
         agreed_price, booking_amount, payment_plan,
         loan_required, loan_bank,
         commission_amount, commission_percent,
         commission_paid, commission_paid_date,
         closed_by, closed_by_manager, closure_notes,
         status
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18,$19,
         $20,$21,$22,'confirmed'
       ) RETURNING *`,
      [
        lead_id, projId, site_visit_id || null,
        booking_date,
        unit_number || null, tower_block || null, floor_number || null, unit_type || null,
        carpet_area_sqft || null, super_area_sqft || null,
        agreed_price || null, booking_amount || null, payment_plan || null,
        loan_required || false, loan_bank || null,
        finalCommAmt, commission_percent || null,
        commission_paid || false, commission_paid_date || null,
        closedBy, closed_by_manager || null, closure_notes || null,
      ]
    );

    // Mark lead as booked
    await client.query(
      `UPDATE leads SET status = 'booked', updated_at = NOW() WHERE id = $1`, [lead_id]
    );

    // Activity log
    const unitDesc = [unit_type, unit_number, tower_block].filter(Boolean).join(' · ');
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'status_change',$2,$3)`,
      [lead_id,
       `Lead BOOKED${unitDesc ? ' — ' + unitDesc : ''}${agreed_price ? `. Deal value: ₹${Number(agreed_price).toLocaleString('en-IN')}` : ''}`,
       closedBy]
    );

    await client.query('COMMIT');

    // ── Email ──────────────────────────────────────────────────────────────────
    setImmediate(async () => {
      try {
        // Notify lead (if email) of booking confirmation
        if (lead.email) {
          await emailService.notifyLeadStatusChanged({
            lead: { ...lead, email: lead.email },
            oldStatus: lead.status,
            newStatus: 'booked',
            changedBy: 'System',
            note: `Your booking has been confirmed${unit_number ? ` for Unit ${unit_number}` : ''}. Our team will contact you with next steps.`,
          });
        }
        // Notify admins/managers of new booking
        const adminEmails = await pool.query(
          `SELECT email FROM users WHERE role IN ('admin','super_admin','sales_manager') AND is_active = true`
        );
        if (adminEmails.rows.length) {
          const closedByRow = await pool.query(
            `SELECT CONCAT(first_name,' ',last_name) AS name, email FROM users WHERE id = $1`, [closedBy]
          );
          await emailService.notifyLeadAssigned({
            lead: { ...lead, email: lead.email },
            assigneeName:  closedByRow.rows[0]?.name || 'Sales Executive',
            assignerName:  'System',
            assigneeEmail: adminEmails.rows.map(r => r.email).join(','),
            note: `BOOKING CONFIRMED${unit_number ? ` — Unit ${unit_number}` : ''}${agreed_price ? `. Deal ₹${Number(agreed_price).toLocaleString('en-IN')}` : ''}. Closed by ${closedByRow.rows[0]?.name || 'exec'}.`,
          });
        }
      } catch (e) { console.error('[Email] createClosure notification failed:', e.message); }
    });

    return sendSuccess(res, 'Lead closed/booked successfully', result.rows[0], 201);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ── GET /api/v1/closures/:id ──────────────────────────────────────────────────
const getClosureById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT lc.*,
              l.name  AS lead_name,  l.phone AS lead_phone,  l.email AS lead_email,
              l.budget AS lead_budget, l.source AS lead_source,
              p.name  AS project_name, p.city AS project_city,
              p.developer AS project_developer, p.price_range,
              CONCAT(cb.first_name,' ',cb.last_name) AS closed_by_name,
              cb.email AS closed_by_email,
              CONCAT(cm.first_name,' ',cm.last_name) AS closed_by_manager_name,
              sv.visit_date AS site_visit_date, sv.visit_time AS site_visit_time
       FROM lead_closures lc
       LEFT JOIN leads        l  ON l.id  = lc.lead_id
       LEFT JOIN projects     p  ON p.id  = lc.project_id
       LEFT JOIN users        cb ON cb.id = lc.closed_by
       LEFT JOIN users        cm ON cm.id = lc.closed_by_manager
       LEFT JOIN site_visits  sv ON sv.id = lc.site_visit_id
       WHERE lc.id = $1`,
      [id]
    );
    if (!result.rows.length) return next(new AppError('Closure not found', 404));

    const c = result.rows[0];
    return sendSuccess(res, 'Closure fetched', {
      id: c.id, booking_date: c.booking_date, status: c.status,
      unit: {
        unit_number: c.unit_number, tower_block: c.tower_block,
        floor_number: c.floor_number, unit_type: c.unit_type,
        carpet_area_sqft: c.carpet_area_sqft, super_area_sqft: c.super_area_sqft,
      },
      financials: {
        agreed_price: c.agreed_price, booking_amount: c.booking_amount,
        payment_plan: c.payment_plan, loan_required: c.loan_required, loan_bank: c.loan_bank,
      },
      commission: {
        amount: c.commission_amount, percent: c.commission_percent,
        paid: c.commission_paid, paid_date: c.commission_paid_date,
      },
      lead:    { id: c.lead_id,    name: c.lead_name,    phone: c.lead_phone, email: c.lead_email, budget: c.lead_budget, source: c.lead_source },
      project: { id: c.project_id, name: c.project_name, city: c.project_city, developer: c.project_developer, price_range: c.price_range },
      closed_by: { id: c.closed_by, name: c.closed_by_name, email: c.closed_by_email },
      closed_by_manager: { id: c.closed_by_manager, name: c.closed_by_manager_name },
      site_visit: c.site_visit_id ? { id: c.site_visit_id, visit_date: c.site_visit_date, visit_time: c.site_visit_time } : null,
      closure_notes: c.closure_notes, created_at: c.created_at, updated_at: c.updated_at,
    });
  } catch (err) { next(err); }
};

// ── PUT /api/v1/closures/:id ──────────────────────────────────────────────────
const updateClosure = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      booking_date, unit_number, tower_block, floor_number, unit_type,
      carpet_area_sqft, super_area_sqft,
      agreed_price, booking_amount, payment_plan,
      loan_required, loan_bank,
      commission_amount, commission_percent,
      commission_paid, commission_paid_date,
      closed_by_manager, closure_notes,
    } = req.body;

    const existing = await pool.query('SELECT * FROM lead_closures WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Closure not found', 404));

    const fields = {
      booking_date, unit_number, tower_block, floor_number, unit_type,
      carpet_area_sqft, super_area_sqft,
      agreed_price, booking_amount, payment_plan,
      loan_required, loan_bank,
      commission_amount, commission_percent,
      commission_paid, commission_paid_date,
      closed_by_manager, closure_notes,
    };

    const updates = []; const params = []; let idx = 1;
    for (const [col, val] of Object.entries(fields)) {
      if (val !== undefined) { updates.push(`${col} = $${idx++}`); params.push(val); }
    }
    if (!updates.length) return next(new AppError('No fields to update', 400));
    updates.push('updated_at = NOW()');
    params.push(id);

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE lead_closures SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params
    );
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [existing.rows[0].lead_id, 'Closure record updated', req.user.id]
    );
    await client.query('COMMIT');

    return sendSuccess(res, 'Closure updated', result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ── PATCH /api/v1/closures/:id/status ────────────────────────────────────────
const updateClosureStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id }           = req.params;
    const { status, note } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return next(new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400));
    }

    const existing = await pool.query('SELECT * FROM lead_closures WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Closure not found', 404));
    if (existing.rows[0].status === status) {
      return sendSuccess(res, 'Status already set to this value', { id, status });
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE lead_closures SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]
    );

    // Sync lead status back if cancelled
    if (status === 'cancelled') {
      await client.query(
        `UPDATE leads SET status = 'negotiation', updated_at = NOW() WHERE id = $1`,
        [existing.rows[0].lead_id]
      );
    }

    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [existing.rows[0].lead_id,
       note || `Closure status changed to ${status}`,
       req.user.id]
    );
    await client.query('COMMIT');

    return sendSuccess(res, `Closure status updated to ${status}`);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};

// ── GET /api/v1/closures/lead/:leadId ────────────────────────────────────────
const getClosureByLead = async (req, res, next) => {
  try {
    const { leadId } = req.params;
    const result = await pool.query(
      `SELECT lc.*,
              p.name AS project_name, p.city AS project_city,
              CONCAT(cb.first_name,' ',cb.last_name) AS closed_by_name
       FROM lead_closures lc
       LEFT JOIN projects p  ON p.id  = lc.project_id
       LEFT JOIN users    cb ON cb.id = lc.closed_by
       WHERE lc.lead_id = $1`, [leadId]
    );
    if (!result.rows.length) return next(new AppError('No closure found for this lead', 404));
    return sendSuccess(res, 'Closure fetched', result.rows[0]);
  } catch (err) { next(err); }
};

// ── GET /api/v1/closures/summary ─────────────────────────────────────────────
// Aggregated stats for admin dashboard
const getClosureSummary = async (req, res, next) => {
  try {
    const { from, to, project_id } = req.query;
    const { role, id: callerId } = req.user;

    let conditions = ["lc.status = 'confirmed'"];
    let params     = [];
    let idx        = 1;

    if (role === 'sales_executive') {
      conditions.push(`lc.closed_by = $${idx++}`); params.push(callerId);
    } else if (role === 'sales_manager') {
      conditions.push(`lc.closed_by_manager = $${idx++}`); params.push(callerId);
    }
    if (from)       { conditions.push(`lc.booking_date >= $${idx++}`); params.push(from); }
    if (to)         { conditions.push(`lc.booking_date <= $${idx++}`); params.push(to); }
    if (project_id) { conditions.push(`lc.project_id = $${idx++}`);   params.push(project_id); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const summary = await pool.query(
      `SELECT
         COUNT(*)                                        AS total_closures,
         COALESCE(SUM(lc.agreed_price),     0)          AS total_deal_value,
         COALESCE(SUM(lc.commission_amount),0)          AS total_commission,
         COALESCE(SUM(CASE WHEN lc.commission_paid THEN lc.commission_amount ELSE 0 END),0) AS commission_paid,
         COALESCE(SUM(CASE WHEN NOT lc.commission_paid THEN lc.commission_amount ELSE 0 END),0) AS commission_pending,
         COALESCE(AVG(lc.agreed_price),     0)          AS avg_deal_value,
         COUNT(DISTINCT lc.project_id)                  AS projects_count,
         COUNT(DISTINCT lc.closed_by)                   AS closures_by_executives
       FROM lead_closures lc ${where}`, params
    );

    // Top performers
    const performers = await pool.query(
      `SELECT CONCAT(u.first_name,' ',u.last_name) AS exec_name,
              COUNT(lc.id)                          AS closures,
              COALESCE(SUM(lc.agreed_price),0)      AS total_value,
              COALESCE(SUM(lc.commission_amount),0) AS total_commission
       FROM lead_closures lc
       LEFT JOIN users u ON u.id = lc.closed_by
       ${where}
       GROUP BY lc.closed_by, u.first_name, u.last_name
       ORDER BY closures DESC
       LIMIT 10`, params
    );

    return sendSuccess(res, 'Closure summary fetched', {
      ...summary.rows[0],
      top_performers: performers.rows,
      period: { from: from || null, to: to || null },
    });
  } catch (err) { next(err); }
};

module.exports = {
  getAllClosures, createClosure, getClosureById, updateClosure,
  updateClosureStatus, getClosureByLead, getClosureSummary,
};
