/**
 * closureController.js — Next One Realty CRM
 *
 * A Closure is created when a lead is booked/converted.
 * It captures all booking details, financials, unit info and commission.
 *
 * Base path: /api/v1/closures
 */

const path         = require('path');
const fs           = require('fs');
const { pool }     = require('../config/db');
const { sendSuccess, paginate } = require('../utils/response');
const AppError     = require('../utils/AppError');
const emailService = require('../utils/emailService');
const whatsappService = require('../utils/whatsappService');
const { getTeamIds, ADMIN_ROLES, LEAF_ROLES } = require('../utils/teamUtils');
const { resolveProjectId } = require('../utils/projectResolver');

const VALID_STATUSES  = ['confirmed', 'cancelled', 'on_hold'];
const VALID_DOC_TYPES = ['cost_sheet', 'payment_proof'];

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

    // Role scoping
    if (LEAF_ROLES.includes(role)) {
      conditions.push(`lc.closed_by = $${idx++}`); params.push(callerId);
    } else if (!ADMIN_ROLES.includes(role)) {
      const teamIds = await getTeamIds(callerId);
      conditions.push(`lc.closed_by = ANY($${idx++}::uuid[])`); params.push(teamIds);
    }

    if (status)          { conditions.push(`lc.status = $${idx++}`);            params.push(status); }
    if (project_id)      { 
      const resolvedProjectId = await resolveProjectId(project_id);
      conditions.push(`lc.project_id = $${idx++}`);  
      params.push(resolvedProjectId); 
    }
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
              CONCAT(cb.first_name,' ',cb.last_name) AS closed_by_name
       FROM lead_closures lc
       LEFT JOIN leads    l  ON l.id  = lc.lead_id
       LEFT JOIN projects p  ON p.id  = lc.project_id
       LEFT JOIN users    cb ON cb.id = lc.closed_by
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
      closed_by_manager, closure_notes, documents,
    } = req.body;

    // Resolve project_id if provided (accepts UUID or name)
    const resolvedProjectId = project_id !== undefined ? await resolveProjectId(project_id) : undefined;

    // Validate documents (cost sheet / payment proof) if provided
    let docItems = [];
    if (documents) {
      docItems = Array.isArray(documents) ? documents : [documents];
      for (const d of docItems) {
        if (!d.url) return next(new AppError('Each document must have a url', 400));
        if (!d.document_type || !VALID_DOC_TYPES.includes(d.document_type)) {
          return next(new AppError(`Each document must have document_type one of: ${VALID_DOC_TYPES.join(', ')}`, 400));
        }
      }
    }

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

    const lead = leadRes.rows[0];
    const closedBy = req.user.id;
    const projId = resolvedProjectId !== undefined ? resolvedProjectId : lead.project_id;

    // Normalize closed_by_manager to array (accept single UUID or array)
    let managerIds = null;
    if (closed_by_manager) {
      managerIds = Array.isArray(closed_by_manager)
        ? closed_by_manager.filter(Boolean)
        : [closed_by_manager];
      if (managerIds.length === 0) managerIds = null;
    }

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
        closedBy, managerIds, closure_notes || null,
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

    // Save cost sheet / payment proof documents
    const savedDocs = [];
    if (docItems.length > 0) {
      for (const d of docItems) {
        const docResult = await client.query(
          `INSERT INTO closure_documents (closure_id, document_type, url, name, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [result.rows[0].id, d.document_type, d.url, d.name || null, d.file_size || null, d.mime_type || null, closedBy]
        );
        savedDocs.push(docResult.rows[0]);
      }
      await client.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
        [lead_id, `${docItems.length} closure document(s) attached`, closedBy]
      );
    }

    await client.query('COMMIT');

    // ── Email ──────────────────────────────────────────────────────────────────
    setImmediate(async () => {
      try {
        const closedByRow = await pool.query(
          `SELECT CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1`, [closedBy]
        );
        const closedByName = closedByRow.rows[0]?.name || 'Sales Executive';

        const adminEmailsRes = await pool.query(
          `SELECT email FROM users WHERE role IN ('admin','super_admin','sales_manager') AND is_active = true`
        );
        const adminEmails = adminEmailsRes.rows.map(r => r.email);

        await emailService.notifyBookingConfirmed({
          lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email },
          project: { id: projId, name: lead.project_name || 'Project' },
          closure: {
            unit_number, tower_block, booking_date,
            agreed_price, booking_amount
          },
          closedBy: closedByName,
          adminEmails
        });
      } catch (e) { console.error('[Email] createClosure notification failed:', e.message); }
    });

    // ── 📱 WhatsApp — booking confirmation to the client ──────────────────────
    setImmediate(async () => {
      try {
        const unitDesc = [unit_type, unit_number, tower_block].filter(Boolean).join(' · ');
        await whatsappService.sendBookingConfirmed({
          leadName:    lead.name,
          leadPhone:   lead.phone,
          projectName: lead.project_name || 'the project',
          unitDesc:    unitDesc || null,
          bookingDate: booking_date,
        });
        await pool.query(
          `UPDATE lead_closures SET whatsapp_confirmed_sent = true WHERE lead_id = $1`, [lead_id]
        );
      } catch (waErr) {
        console.error('[WhatsApp] createClosure booking confirmation failed:', waErr.message);
      }
    });

    // Fetch managers for frontend Reporting Manager dropdown
    const managersRes = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS name, role
       FROM users
       WHERE role IN ('sales_manager','admin','super_admin') AND is_active = true
       ORDER BY first_name ASC`
    );

    return sendSuccess(res, 'Lead closed/booked successfully', {
      closure:  result.rows[0],
      documents: savedDocs,
      managers: managersRes.rows.map(m => ({ id: m.id, name: m.name, role: m.role })),
    }, 201);
  } catch (err) {
    await client.query('ROLLBACK'); next(err);
  } finally { client.release(); }
};
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
              sv.visit_date AS site_visit_date, sv.visit_time AS site_visit_time
       FROM lead_closures lc
       LEFT JOIN leads        l  ON l.id  = lc.lead_id
       LEFT JOIN projects     p  ON p.id  = lc.project_id
       LEFT JOIN users        cb ON cb.id = lc.closed_by
       LEFT JOIN site_visits  sv ON sv.id = lc.site_visit_id
       WHERE lc.id = $1`,
      [id]
    );
    if (!result.rows.length) return next(new AppError('Closure not found', 404));

    const c = result.rows[0];

    // Resolve closed_by_manager array → [{id, name, role}]
    let closedByManagers = [];
    if (c.closed_by_manager && Array.isArray(c.closed_by_manager) && c.closed_by_manager.length) {
      const mgrDetails = await pool.query(
        `SELECT id, CONCAT(first_name,' ',last_name) AS name, role
         FROM users WHERE id = ANY($1::uuid[])
         ORDER BY first_name ASC`,
        [c.closed_by_manager]
      );
      closedByManagers = mgrDetails.rows.map(m => ({ id: m.id, name: m.name, role: m.role }));
    }

    // Full managers dropdown list for edit form
    const managersRes = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS name, role
       FROM users
       WHERE role IN ('sales_manager','admin','super_admin') AND is_active = true
       ORDER BY first_name ASC`
    );

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
      closed_by_manager: closedByManagers,   // ← now an array of {id, name, role}
      site_visit: c.site_visit_id ? { id: c.site_visit_id, visit_date: c.site_visit_date, visit_time: c.site_visit_time } : null,
      closure_notes: c.closure_notes, created_at: c.created_at, updated_at: c.updated_at,
      managers: managersRes.rows.map(m => ({ id: m.id, name: m.name, role: m.role })),
    });
  } catch (err) { next(err); }
};

// ── PUT /api/v1/closures/:id ──────────────────────────────────────────────────
const updateClosure = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      project_id, site_visit_id,
      booking_date, unit_number, tower_block, floor_number, unit_type,
      carpet_area_sqft, super_area_sqft,
      agreed_price, booking_amount, payment_plan,
      loan_required, loan_bank,
      commission_amount, commission_percent,
      commission_paid, commission_paid_date,
      closed_by_manager, closure_notes, documents,
    } = req.body;

    // Resolve project_id if provided (accepts UUID or name)
    const resolvedProjectId = project_id !== undefined ? await resolveProjectId(project_id) : undefined;

    // Validate documents (cost sheet / payment proof) if provided
    let docItems = [];
    if (documents) {
      docItems = Array.isArray(documents) ? documents : [documents];
      for (const d of docItems) {
        if (!d.url) return next(new AppError('Each document must have a url', 400));
        if (!d.document_type || !VALID_DOC_TYPES.includes(d.document_type)) {
          return next(new AppError(`Each document must have document_type one of: ${VALID_DOC_TYPES.join(', ')}`, 400));
        }
      }
    }

    const existing = await pool.query('SELECT * FROM lead_closures WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Closure not found', 404));

    // Normalize closed_by_manager to array
    let managerIds = undefined;
    if (closed_by_manager !== undefined) {
      if (closed_by_manager === null || (Array.isArray(closed_by_manager) && closed_by_manager.length === 0)) {
        managerIds = null;
      } else {
        managerIds = Array.isArray(closed_by_manager)
          ? closed_by_manager.filter(Boolean)
          : [closed_by_manager];
      }
    }

    // Auto-calculate commission amount if percent provided but amount not
    let finalCommAmt = commission_amount;
    if (finalCommAmt === undefined && commission_percent !== undefined && agreed_price !== undefined) {
      finalCommAmt = (parseFloat(agreed_price) * parseFloat(commission_percent) / 100).toFixed(2);
    }

    const fields = {
      project_id: resolvedProjectId, site_visit_id,
      booking_date, unit_number, tower_block, floor_number, unit_type,
      carpet_area_sqft, super_area_sqft,
      agreed_price, booking_amount, payment_plan,
      loan_required, loan_bank,
      commission_amount: finalCommAmt,
      commission_percent,
      commission_paid, commission_paid_date,
      closed_by_manager: managerIds,
      closure_notes,
    };

    const updates = []; const params = []; let idx = 1;
    for (const [col, val] of Object.entries(fields)) {
      if (val !== undefined) { updates.push(`${col} = $${idx++}`); params.push(val); }
    }
    if (!updates.length && docItems.length === 0) {
      return next(new AppError('No fields to update', 400));
    }

    await client.query('BEGIN');

    let closure = existing.rows[0];
    if (updates.length) {
      updates.push('updated_at = NOW()');
      params.push(id);
      const result = await client.query(
        `UPDATE lead_closures SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params
      );
      closure = result.rows[0];
      await client.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
        [existing.rows[0].lead_id, 'Closure record updated', req.user.id]
      );
    }

    // Save any new cost sheet / payment proof documents
    const savedDocs = [];
    if (docItems.length > 0) {
      for (const d of docItems) {
        const docResult = await client.query(
          `INSERT INTO closure_documents (closure_id, document_type, url, name, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [id, d.document_type, d.url, d.name || null, d.file_size || null, d.mime_type || null, req.user.id]
        );
        savedDocs.push(docResult.rows[0]);
      }
      await client.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
        [existing.rows[0].lead_id, `${docItems.length} closure document(s) added`, req.user.id]
      );
    }

    await client.query('COMMIT');

    // Fetch managers list for the response (all sales_manager + admin users)
    const managersRes = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS name, role
       FROM users
       WHERE role IN ('sales_manager','admin','super_admin') AND is_active = true
       ORDER BY first_name ASC`
    );

    return sendSuccess(res, 'Closure updated', {
      closure:  closure,
      documents: savedDocs,
      managers: managersRes.rows.map(m => ({ id: m.id, name: m.name, role: m.role })),
    });
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

    // ── 📱 WhatsApp — booking cancelled / on-hold notice to the client ───────
    if (['cancelled', 'on_hold'].includes(status)) {
      setImmediate(async () => {
        try {
          const leadRow = await pool.query(
            `SELECT l.name, l.phone, p.name AS project_name
             FROM leads l LEFT JOIN projects p ON p.id = l.project_id
             WHERE l.id = $1`,
            [existing.rows[0].lead_id]
          );
          if (!leadRow.rows.length) return;
          const lead = leadRow.rows[0];

          await whatsappService.sendBookingCancelled({
            leadName:    lead.name,
            leadPhone:   lead.phone,
            projectName: lead.project_name,
            newStatus:   status,
          });
          await pool.query(
            `UPDATE lead_closures SET whatsapp_cancelled_sent = true WHERE id = $1`, [id]
          );
        } catch (waErr) {
          console.error('[WhatsApp] updateClosureStatus notification failed:', waErr.message);
        }
      });
    }

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
      conditions.push(`$${idx++} = ANY(lc.closed_by_manager)`); params.push(callerId);
    }
    if (from)       { conditions.push(`lc.booking_date >= $${idx++}`); params.push(from); }
    if (to)         { conditions.push(`lc.booking_date <= $${idx++}`); params.push(to); }
    if (project_id) { 
      const resolvedProjectId = await resolveProjectId(project_id);
      conditions.push(`lc.project_id = $${idx++}`);  
      params.push(resolvedProjectId); 
    }

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

// ── GET /api/v1/closures/managers ─────────────────────────────────────────────
/**
 * Returns all active sales_manager / admin / super_admin users
 * for the Reporting Manager dropdown on Create and Edit Closure forms.
 */
const getManagers = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id,
              CONCAT(first_name,' ',last_name) AS name,
              role
       FROM users
       WHERE role IN ('sales_manager','admin','super_admin')
         AND is_active = true
       ORDER BY first_name ASC`
    );
    return sendSuccess(res, 'Managers fetched', result.rows.map(r => ({
      id:   r.id,
      name: r.name,
      role: r.role,
    })));
  } catch (err) { next(err); }
};

/**
 * ─── CLOSURE DOCUMENTS (cost sheet, payment proof) ─────────────────────────────
 *
 * Same shape/flow as lead payment proofs / photos — accepts images (jpeg/png/webp)
 * or PDF.
 *
 * Endpoints:
 *   POST   /api/v1/closures/upload-document       → upload file, get url (use in create/update)
 *   POST   /api/v1/closures/:id/documents         → attach (file upload OR url array)
 *   GET    /api/v1/closures/:id/documents         → list all documents for a closure
 *   PATCH  /api/v1/closures/:id/documents/:did    → update name
 *   DELETE /api/v1/closures/:id/documents/:did    → delete one document
 */

// ─── POST /api/v1/closures/upload-document ────────────────────────────────────
// Standalone file upload — returns { url, filename, size }
// Field name: document
const uploadDocumentFile = async (req, res, next) => {
  try {
    if (!req.file) return next(new AppError('No file uploaded. Use field name: document', 400));

    return sendSuccess(res, 'File uploaded successfully', {
      url:      `/uploads/closures/documents/${req.file.filename}`,
      filename: req.file.originalname,
      size:     req.file.size || null,
    }, 201);
  } catch (err) { next(err); }
};

// ─── POST /api/v1/closures/:id/documents ──────────────────────────────────────
// Mode 1 — File upload (multipart/form-data): field document (required),
//          body: document_type (required: cost_sheet | payment_proof), name (optional)
// Mode 2 — JSON body: { documents: [{ url, document_type, name }] } (single object also accepted)
const addClosureDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const callerId = req.user.id;

    const closureChk = await pool.query('SELECT id FROM lead_closures WHERE id = $1', [id]);
    if (!closureChk.rows.length) return next(new AppError('Closure not found', 404));

    const inserted = [];

    // ── Mode 1: File upload ──────────────────────────────────────────────────
    if (req.file) {
      const { document_type, name } = req.body;
      if (!document_type || !VALID_DOC_TYPES.includes(document_type)) {
        return next(new AppError(`document_type is required and must be one of: ${VALID_DOC_TYPES.join(', ')}`, 400));
      }
      const fileUrl  = `/uploads/closures/documents/${req.file.filename}`;
      const fileName = name || req.file.originalname;

      const result = await pool.query(
        `INSERT INTO closure_documents (closure_id, document_type, url, name, file_size, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, document_type, fileUrl, fileName, req.file.size || null, req.file.mimetype || null, callerId]
      );
      inserted.push(result.rows[0]);
    }

    // ── Mode 2: JSON URL array ───────────────────────────────────────────────
    else if (req.body.documents) {
      let docs = req.body.documents;
      if (!Array.isArray(docs)) docs = [docs];
      if (!docs.length) return next(new AppError('documents array cannot be empty', 400));

      for (const d of docs) {
        if (!d.url) return next(new AppError('Each document must have a url', 400));
        if (!d.document_type || !VALID_DOC_TYPES.includes(d.document_type)) {
          return next(new AppError(`Each document must have document_type one of: ${VALID_DOC_TYPES.join(', ')}`, 400));
        }
        const result = await pool.query(
          `INSERT INTO closure_documents (closure_id, document_type, url, name, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [id, d.document_type, d.url, d.name || null, d.file_size || null, d.mime_type || null, callerId]
        );
        inserted.push(result.rows[0]);
      }
    } else {
      return next(new AppError('Provide either a document file or documents JSON', 400));
    }

    await pool.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by)
       SELECT lead_id, 'note', $2, $3 FROM lead_closures WHERE id = $1`,
      [id, `${inserted.length} closure document(s) added`, callerId]
    );

    return sendSuccess(res, `${inserted.length} document(s) saved`, {
      closure_id: id, documents: inserted,
    }, 201);
  } catch (err) { next(err); }
};

// ─── GET /api/v1/closures/:id/documents ───────────────────────────────────────
const getClosureDocuments = async (req, res, next) => {
  try {
    const { id } = req.params;

    const closureChk = await pool.query('SELECT id FROM lead_closures WHERE id = $1', [id]);
    if (!closureChk.rows.length) return next(new AppError('Closure not found', 404));

    const result = await pool.query(
      `SELECT cd.*, CONCAT(u.first_name,' ',u.last_name) AS uploaded_by_name
       FROM closure_documents cd
       LEFT JOIN users u ON u.id = cd.uploaded_by
       WHERE cd.closure_id = $1
       ORDER BY cd.created_at DESC`,
      [id]
    );

    return sendSuccess(res, 'Closure documents fetched', {
      closure_id: id, total: result.rows.length, documents: result.rows,
    });
  } catch (err) { next(err); }
};

// ─── PATCH /api/v1/closures/:id/documents/:did ───────────────────────────────
const updateClosureDocument = async (req, res, next) => {
  try {
    const { id, did } = req.params;
    const { name } = req.body;

    const closureChk = await pool.query('SELECT id FROM lead_closures WHERE id = $1', [id]);
    if (!closureChk.rows.length) return next(new AppError('Closure not found', 404));

    const docChk = await pool.query(
      'SELECT * FROM closure_documents WHERE id = $1 AND closure_id = $2', [did, id]
    );
    if (!docChk.rows.length) return next(new AppError('Document not found', 404));

    if (name === undefined) return next(new AppError('Provide name to update', 400));

    const result = await pool.query(
      `UPDATE closure_documents SET name = $1, updated_at = NOW() WHERE id = $2 AND closure_id = $3 RETURNING *`,
      [name, did, id]
    );

    return sendSuccess(res, 'Document updated', result.rows[0]);
  } catch (err) { next(err); }
};

// ─── DELETE /api/v1/closures/:id/documents/:did ──────────────────────────────
const deleteClosureDocument = async (req, res, next) => {
  try {
    const { id, did } = req.params;

    const closureChk = await pool.query('SELECT id FROM lead_closures WHERE id = $1', [id]);
    if (!closureChk.rows.length) return next(new AppError('Closure not found', 404));

    const docChk = await pool.query(
      'SELECT * FROM closure_documents WHERE id = $1 AND closure_id = $2', [did, id]
    );
    if (!docChk.rows.length) return next(new AppError('Document not found', 404));
    const doc = docChk.rows[0];

    if (doc.url && doc.url.startsWith('/uploads/')) {
      const filePath = path.join(process.cwd(), doc.url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await pool.query('DELETE FROM closure_documents WHERE id = $1', [did]);

    return sendSuccess(res, 'Document deleted');
  } catch (err) { next(err); }
};

module.exports = {
  getAllClosures, createClosure, getClosureById, updateClosure,
  updateClosureStatus, getClosureByLead, getClosureSummary,
  getManagers,
  uploadDocumentFile, addClosureDocument, getClosureDocuments,
  updateClosureDocument, deleteClosureDocument,
};