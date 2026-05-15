/**
 * phoneRevealController.js
 *
 * Allows non-admin users (sales_manager, sales_executive, external_caller)
 * to request access to a lead's masked phone number.
 * Admin / super_admin approve or decline requests.
 *
 * Endpoints:
 *   POST   /api/v1/phone-reveal/request        — user requests to see a lead's phone
 *   GET    /api/v1/phone-reveal/my-requests     — user sees their own request history
 *   GET    /api/v1/phone-reveal/pending         — admin sees all pending requests
 *   GET    /api/v1/phone-reveal/all             — admin sees all requests with filters
 *   PATCH  /api/v1/phone-reveal/:id/approve     — admin approves a request
 *   PATCH  /api/v1/phone-reveal/:id/decline     — admin declines a request
 *   GET    /api/v1/phone-reveal/lead/:leadId    — admin/manager sees all requests for one lead
 *   GET    /api/v1/phone-reveal/check/:leadId   — user checks if they have active access for a lead
 */

const { pool }       = require('../config/db');
const { sendSuccess, paginate } = require('../utils/response');
const AppError       = require('../utils/AppError');
const { createNotification } = require('./notificationController');

// ── 1. REQUEST phone reveal ───────────────────────────────────────────────────
const requestPhoneReveal = async (req, res, next) => {
  try {
    const { lead_id, reason } = req.body;
    const requesterId = req.user.id;

    if (!lead_id) return next(new AppError('lead_id is required', 400));

    // Check lead exists
    const leadCheck = await pool.query(
      `SELECT id, name, phone, assigned_to FROM leads WHERE id = $1 AND is_archived = false`,
      [lead_id]
    );
    if (!leadCheck.rows.length) return next(new AppError('Lead not found', 404));

    const lead = leadCheck.rows[0];

    // Check if a pending/approved request already exists for this user+lead
    const existing = await pool.query(
      `SELECT id, status FROM phone_reveal_requests
       WHERE lead_id = $1 AND requested_by = $2 AND status IN ('pending','approved')`,
      [lead_id, requesterId]
    );
    if (existing.rows.length) {
      const s = existing.rows[0].status;
      return next(new AppError(
        s === 'approved'
          ? 'You already have approved access to this lead\'s phone number'
          : 'You already have a pending request for this lead',
        409
      ));
    }

    // Insert request
    const result = await pool.query(
      `INSERT INTO phone_reveal_requests
         (lead_id, requested_by, reason, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [lead_id, requesterId, reason || null]
    );

    // Notify all admins/super_admins
    const admins = await pool.query(
      `SELECT id FROM users WHERE role IN ('admin','super_admin') AND is_active = true`
    );
    const requesterInfo = await pool.query(
      `SELECT CONCAT(first_name,' ',last_name) AS full_name, role FROM users WHERE id = $1`,
      [requesterId]
    );
    const requesterName = requesterInfo.rows[0]?.full_name || 'A user';
    const requesterRole = requesterInfo.rows[0]?.role || '';

    await Promise.all(admins.rows.map(a =>
      createNotification(a.id, {
        type:           'general',
        title:          '📞 Phone Number Access Request',
        message:        `${requesterName} (${requesterRole.replace(/_/g,' ')}) is requesting to see the phone number for lead "${lead.name}"${reason ? `: "${reason}"` : '.'}`,
        reference_id:   result.rows[0].id,
        reference_type: 'phone_reveal',
        metadata:       { lead_id, lead_name: lead.name, requester_id: requesterId },
      })
    ));

    return sendSuccess(res, 'Phone reveal request submitted successfully', result.rows[0], 201);
  } catch (err) { next(err); }
};

// ── 1b. BULK REQUEST phone reveal ────────────────────────────────────────────
const bulkRequestPhoneReveal = async (req, res, next) => {
  try {
    const { lead_ids, reason } = req.body;
    const requesterId = req.user.id;

    if (!Array.isArray(lead_ids) || lead_ids.length === 0)
      return next(new AppError('lead_ids must be a non-empty array', 400));
    if (lead_ids.length > 50)
      return next(new AppError('Maximum 50 leads per bulk request', 400));

    // Fetch all leads in one query
    const leadsResult = await pool.query(
      `SELECT id, name, phone FROM leads
       WHERE id = ANY($1::uuid[]) AND is_archived = false`,
      [lead_ids]
    );
    if (!leadsResult.rows.length)
      return next(new AppError('No valid leads found', 404));

    const leadMap = new Map(leadsResult.rows.map(l => [l.id, l]));

    // Find existing pending/approved requests for this user in one query
    const existing = await pool.query(
      `SELECT lead_id, status FROM phone_reveal_requests
       WHERE lead_id = ANY($1::uuid[]) AND requested_by = $2
         AND status IN ('pending','approved')`,
      [lead_ids, requesterId]
    );
    const alreadyHas = new Set(existing.rows.map(r => r.lead_id));

    const inserted  = [];
    const skipped   = [];

    for (const lead_id of lead_ids) {
      const lead = leadMap.get(lead_id);

      if (!lead) {
        skipped.push({ lead_id, reason: 'Lead not found' });
        continue;
      }
      if (alreadyHas.has(lead_id)) {
        const existing_status = existing.rows.find(r => r.lead_id === lead_id)?.status;
        skipped.push({ lead_id, lead_name: lead.name,
          reason: existing_status === 'approved'
            ? 'Already have approved access'
            : 'Already has a pending request' });
        continue;
      }

      try {
        const r = await pool.query(
          `INSERT INTO phone_reveal_requests
             (lead_id, requested_by, reason, status)
           VALUES ($1, $2, $3, 'pending')
           RETURNING id`,
          [lead_id, requesterId, reason || null]
        );
        inserted.push({ lead_id, lead_name: lead.name, request_id: r.rows[0].id });
      } catch (e) {
        skipped.push({ lead_id, lead_name: lead.name, reason: e.message });
      }
    }

    // Notify admins once with a consolidated message (not one per lead)
    if (inserted.length > 0) {
      const admins = await pool.query(
        `SELECT id FROM users WHERE role IN ('admin','super_admin') AND is_active = true`
      );
      const requesterInfo = await pool.query(
        `SELECT CONCAT(first_name,' ',last_name) AS full_name, role FROM users WHERE id = $1`,
        [requesterId]
      );
      const requesterName = requesterInfo.rows[0]?.full_name || 'A user';
      const requesterRole = requesterInfo.rows[0]?.role?.replace(/_/g, ' ') || '';

      await Promise.all(admins.rows.map(a =>
        createNotification(a.id, {
          type:           'general',
          title:          `📞 Bulk Phone Access Request (${inserted.length} leads)`,
          message:        `${requesterName} (${requesterRole}) requested phone access for ${inserted.length} lead${inserted.length > 1 ? 's' : ''}${reason ? `: "${reason}"` : '.'}`,
          reference_id:   inserted[0].request_id,
          reference_type: 'phone_reveal',
          metadata:       { requester_id: requesterId, count: inserted.length,
                            lead_ids: inserted.map(i => i.lead_id) },
        })
      ));
    }

    return sendSuccess(res, 'Bulk phone reveal request processed', {
      total_requested: lead_ids.length,
      inserted:        inserted.length,
      skipped:         skipped.length,
      requests:        inserted,
      skipped_details: skipped,
    }, 201);
  } catch (err) { next(err); }
};

// ── 2. MY REQUESTS (requester sees their own history) ─────────────────────────
const getMyRequests = async (req, res, next) => {
  try {
    const { page = 1, per_page = 20, status } = req.query;
    const userId = req.user.id;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const conditions = ['prr.requested_by = $1'];
    const params     = [userId];
    let idx          = 2;

    if (status) { conditions.push(`prr.status = $${idx++}`); params.push(status); }

    const where = conditions.join(' AND ');

    const [cnt, rows] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM phone_reveal_requests prr WHERE ${where}`, params),
      pool.query(`
        SELECT
          prr.*,
          l.name  AS lead_name,
          l.phone AS lead_phone,
          CONCAT(u.first_name,' ',u.last_name) AS reviewed_by_name
        FROM phone_reveal_requests prr
        JOIN leads l ON l.id = prr.lead_id
        LEFT JOIN users u ON u.id = prr.reviewed_by
        WHERE ${where}
        ORDER BY prr.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(per_page), offset]
      ),
    ]);

    // Only reveal the phone if the request is approved
    const data = rows.rows.map(r => ({
      ...r,
      lead_phone: r.status === 'approved' ? r.lead_phone : null,
    }));

    return res.json({
      ...paginate(data, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
    });
  } catch (err) { next(err); }
};

// ── 3. PENDING REQUESTS (admin sees what needs action) ───────────────────────
const getPendingRequests = async (req, res, next) => {
  try {
    const { page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const [cnt, rows] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM phone_reveal_requests WHERE status = 'pending'`),
      pool.query(`
        SELECT
          prr.*,
          l.name   AS lead_name,
          l.phone  AS lead_phone,
          CONCAT(ru.first_name,' ',ru.last_name) AS requester_name,
          ru.role  AS requester_role,
          ru.email AS requester_email
        FROM phone_reveal_requests prr
        JOIN leads l  ON l.id  = prr.lead_id
        JOIN users ru ON ru.id = prr.requested_by
        WHERE prr.status = 'pending'
        ORDER BY prr.created_at ASC
        LIMIT $1 OFFSET $2`,
        [parseInt(per_page), offset]
      ),
    ]);

    return res.json({
      ...paginate(rows.rows, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
    });
  } catch (err) { next(err); }
};

// ── 4. ALL REQUESTS (admin with filters) ─────────────────────────────────────
const getAllRequests = async (req, res, next) => {
  try {
    const { page = 1, per_page = 20, status, requested_by, lead_id } = req.query;
    const { role: callerRole, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const conditions = [];
    const params     = [];
    let idx          = 1;

    // sales_manager: only see requests for leads assigned to their team
    if (callerRole === 'sales_manager') {
      conditions.push(`prr.requested_by IN (
        SELECT id FROM users WHERE manager_id = $${idx++}
      )`);
      params.push(callerId);
    }

    if (status)       { conditions.push(`prr.status = $${idx++}`);       params.push(status); }
    if (requested_by) { conditions.push(`prr.requested_by = $${idx++}`); params.push(requested_by); }
    if (lead_id)      { conditions.push(`prr.lead_id = $${idx++}`);      params.push(lead_id); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [cnt, rows] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM phone_reveal_requests prr ${where}`, params),
      pool.query(`
        SELECT
          prr.*,
          l.name   AS lead_name,
          l.phone  AS lead_phone,
          CONCAT(ru.first_name,' ',ru.last_name) AS requester_name,
          ru.role  AS requester_role,
          CONCAT(rv.first_name,' ',rv.last_name) AS reviewed_by_name,
          rv.role  AS reviewed_by_role
        FROM phone_reveal_requests prr
        JOIN  leads l  ON l.id  = prr.lead_id
        JOIN  users ru ON ru.id = prr.requested_by
        LEFT JOIN users rv ON rv.id = prr.reviewed_by
        ${where}
        ORDER BY prr.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(per_page), offset]
      ),
    ]);

    // Mask phone for non-admin viewers (sales_manager can see approved phones)
    const isAdmin = ['admin','super_admin'].includes(callerRole);
    const data = rows.rows.map(r => ({
      ...r,
      lead_phone: (isAdmin || r.status === 'approved') ? r.lead_phone : null,
    }));

    return res.json({
      ...paginate(data, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
    });
  } catch (err) { next(err); }
};

// ── 5. APPROVE ────────────────────────────────────────────────────────────────
const approveRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const reviewerId = req.user.id;

    const reqRow = await pool.query(
      `SELECT prr.*, l.name AS lead_name, l.phone AS lead_phone,
              CONCAT(ru.first_name,' ',ru.last_name) AS requester_name
       FROM phone_reveal_requests prr
       JOIN leads l  ON l.id  = prr.lead_id
       JOIN users ru ON ru.id = prr.requested_by
       WHERE prr.id = $1`,
      [id]
    );
    if (!reqRow.rows.length) return next(new AppError('Request not found', 404));
    if (reqRow.rows[0].status !== 'pending') return next(new AppError('Request is not pending', 400));

    const updated = await pool.query(
      `UPDATE phone_reveal_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
       WHERE id = $3
       RETURNING *`,
      [reviewerId, note || null, id]
    );

    const r = reqRow.rows[0];

    // Notify the requester — include the actual phone number in the notification
    await createNotification(r.requested_by, {
      type:           'general',
      title:          '✅ Phone Number Access Approved',
      message:        `Your request to view the phone number for lead "${r.lead_name}" has been approved. Number: ${r.lead_phone}`,
      reference_id:   id,
      reference_type: 'phone_reveal',
      metadata:       { lead_id: r.lead_id, lead_name: r.lead_name, phone: r.lead_phone },
    });

    return sendSuccess(res, 'Request approved', {
      ...updated.rows[0],
      lead_name:  r.lead_name,
      lead_phone: r.lead_phone,   // include revealed phone in response
      requester_name: r.requester_name,
    });
  } catch (err) { next(err); }
};

// ── 6. DECLINE ────────────────────────────────────────────────────────────────
const declineRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const reviewerId = req.user.id;

    const reqRow = await pool.query(
      `SELECT prr.*, l.name AS lead_name,
              CONCAT(ru.first_name,' ',ru.last_name) AS requester_name
       FROM phone_reveal_requests prr
       JOIN leads l  ON l.id  = prr.lead_id
       JOIN users ru ON ru.id = prr.requested_by
       WHERE prr.id = $1`,
      [id]
    );
    if (!reqRow.rows.length) return next(new AppError('Request not found', 404));
    if (reqRow.rows[0].status !== 'pending') return next(new AppError('Request is not pending', 400));

    const updated = await pool.query(
      `UPDATE phone_reveal_requests
       SET status = 'declined', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
       WHERE id = $3
       RETURNING *`,
      [reviewerId, note || null, id]
    );

    const r = reqRow.rows[0];

    // Notify the requester
    await createNotification(r.requested_by, {
      type:           'general',
      title:          '❌ Phone Number Access Declined',
      message:        `Your request to view the phone number for lead "${r.lead_name}" was declined.${note ? ` Reason: "${note}"` : ''}`,
      reference_id:   id,
      reference_type: 'phone_reveal',
      metadata:       { lead_id: r.lead_id, lead_name: r.lead_name },
    });

    return sendSuccess(res, 'Request declined', {
      ...updated.rows[0],
      lead_name:      r.lead_name,
      requester_name: r.requester_name,
    });
  } catch (err) { next(err); }
};

// ── 7. REQUESTS FOR A SPECIFIC LEAD ──────────────────────────────────────────
const getLeadRequests = async (req, res, next) => {
  try {
    const { leadId } = req.params;
    const { role: callerRole, id: callerId } = req.user;

    const leadCheck = await pool.query(`SELECT id, name FROM leads WHERE id = $1`, [leadId]);
    if (!leadCheck.rows.length) return next(new AppError('Lead not found', 404));

    // sales_manager: only if lead is in their team
    if (callerRole === 'sales_manager') {
      const teamCheck = await pool.query(
        `SELECT l.id FROM leads l
         JOIN users u ON u.id = l.assigned_to
         WHERE l.id = $1 AND u.manager_id = $2`,
        [leadId, callerId]
      );
      if (!teamCheck.rows.length) return next(new AppError('Access denied', 403));
    }

    const rows = await pool.query(`
      SELECT
        prr.*,
        CONCAT(ru.first_name,' ',ru.last_name) AS requester_name,
        ru.role  AS requester_role,
        CONCAT(rv.first_name,' ',rv.last_name) AS reviewed_by_name
      FROM phone_reveal_requests prr
      JOIN  users ru ON ru.id = prr.requested_by
      LEFT JOIN users rv ON rv.id = prr.reviewed_by
      WHERE prr.lead_id = $1
      ORDER BY prr.created_at DESC`,
      [leadId]
    );

    return sendSuccess(res, 'Lead phone reveal requests', {
      lead:     leadCheck.rows[0],
      total:    rows.rows.length,
      requests: rows.rows,
    });
  } catch (err) { next(err); }
};

// ── 8. CHECK ACCESS (user checks if they have approved access for a lead) ─────
const checkAccess = async (req, res, next) => {
  try {
    const { leadId } = req.params;
    const userId = req.user.id;

    // admin/super_admin always have access
    if (['admin','super_admin'].includes(req.user.role)) {
      const lead = await pool.query(`SELECT phone FROM leads WHERE id = $1`, [leadId]);
      if (!lead.rows.length) return next(new AppError('Lead not found', 404));
      return sendSuccess(res, 'Access granted', { has_access: true, phone: lead.rows[0].phone, request: null });
    }

    const row = await pool.query(
      `SELECT prr.id, prr.status, l.phone
       FROM phone_reveal_requests prr
       JOIN leads l ON l.id = prr.lead_id
       WHERE prr.lead_id = $1 AND prr.requested_by = $2 AND prr.status = 'approved'
       ORDER BY prr.reviewed_at DESC LIMIT 1`,
      [leadId, userId]
    );

    if (row.rows.length) {
      return sendSuccess(res, 'Access granted', { has_access: true, phone: row.rows[0].phone, request: row.rows[0] });
    }

    // Check for pending request
    const pending = await pool.query(
      `SELECT id, status, created_at FROM phone_reveal_requests
       WHERE lead_id = $1 AND requested_by = $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [leadId, userId]
    );

    return sendSuccess(res, 'No access', {
      has_access: false,
      phone:      null,
      request:    pending.rows[0] || null,  // null if never requested, pending obj if waiting
    });
  } catch (err) { next(err); }
};

module.exports = {
  requestPhoneReveal,
  bulkRequestPhoneReveal,
  getMyRequests,
  getPendingRequests,
  getAllRequests,
  approveRequest,
  declineRequest,
  getLeadRequests,
  checkAccess,
};