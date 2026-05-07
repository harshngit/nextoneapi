/**
 * leadController.js — Nextone Reality
 * Email notifications fire ONLY after confirmed DB writes.
 * Emails are non-blocking (fire-and-forget) — they never fail an API response.
 */

const { pool }        = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError        = require("../utils/AppError");
const emailService    = require("../utils/emailService");

const VALID_STATUSES = [
  "new", "contacted", "interested", "follow_up",
  "site_visit_scheduled", "site_visit_done",
  "negotiation", "booked", "lost",
];

// ─── Helper — log to activity table ──────────────────────────────────────────
const logActivity = async (client, leadId, type, note, performedBy) => {
  await client.query(
    `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, $2, $3, $4)`,
    [leadId, type, note, performedBy]
  );
};

// ─── Helper — fetch email addresses for notification ─────────────────────────
const getEmailContext = async (assignedToId) => {
  const emailData = { assigneeEmail: null, adminEmails: [] };

  if (assignedToId) {
    const assignee = await pool.query(
      "SELECT email FROM users WHERE id = $1 AND is_active = true",
      [assignedToId]
    );
    if (assignee.rows.length) emailData.assigneeEmail = assignee.rows[0].email;
  }

  const admins = await pool.query(
    "SELECT email FROM users WHERE role IN ('admin','super_admin') AND is_active = true"
  );
  emailData.adminEmails = admins.rows.map(r => r.email);

  return emailData;
};

// ─── Helper — fetch full lead row (with project name) ────────────────────────
const fetchLeadWithProject = async (leadId) => {
  const result = await pool.query(
    `SELECT l.*,
            p.name AS project_name,
            CONCAT(u.first_name,' ',u.last_name) AS assigned_name,
            u.email AS assigned_email
     FROM leads l
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN users u    ON u.id  = l.assigned_to
     WHERE l.id = $1`,
    [leadId]
  );
  return result.rows[0] || null;
};

/**
 * GET /api/v1/leads
 */
const getAllLeads = async (req, res, next) => {
  try {
    const { status, source, assigned_to, project_id, from, to, search, page = 1, per_page = 20 } = req.query;
    const { role, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = ["l.is_archived = false"];
    let params = [];
    let idx = 1;

    if (role === "sales_executive") {
      conditions.push(`l.assigned_to = $${idx++}`);
      params.push(callerId);
    } else if (role === "sales_manager") {
      conditions.push(`u.manager_id = $${idx++}`);
      params.push(callerId);
    }

    if (status)      { conditions.push(`l.status = $${idx++}`);             params.push(status); }
    if (source)      { conditions.push(`l.source ILIKE $${idx++}`);         params.push(source); }
    if (assigned_to) { conditions.push(`l.assigned_to = $${idx++}`);        params.push(assigned_to); }
    if (project_id)  { conditions.push(`l.project_id = $${idx++}`);         params.push(project_id); }
    if (from)        { conditions.push(`l.created_at::date >= $${idx++}`);  params.push(from); }
    if (to)          { conditions.push(`l.created_at::date <= $${idx++}`);  params.push(to); }
    if (search) {
      conditions.push(`(l.name ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.email ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT l.id, l.name, l.phone, l.alternate_phone_number, l.email, l.status, l.source, l.budget,
              l.location_preference, l.project_id, l.assigned_to, l.created_at,
              p.name AS project_name,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_name
       FROM leads l
       LEFT JOIN projects p ON p.id = l.project_id
       LEFT JOIN users u ON u.id = l.assigned_to
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/leads
 * ✉ Sends email: Lead Created + Lead Assigned (if applicable)
 */
const createLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, phone, alternate_phone_number, email, source, project_id,
            assigned_to, budget, location_preference, notes } = req.body;
    if (!name || !phone) return next(new AppError("name and phone are required", 400));

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO leads (name, phone, alternate_phone_number, email, source,
                          project_id, assigned_to, budget, location_preference,
                          status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'new',$10)
       RETURNING *`,
      [name.trim(), phone, alternate_phone_number || null, email || null, source || null,
       project_id || null, assigned_to || null, budget || null, location_preference || null,
       req.user.id]
    );

    const lead = result.rows[0];
    await logActivity(client, lead.id, "note", notes || "Lead created", req.user.id);
    if (assigned_to) {
      await logActivity(client, lead.id, "assignment", `Lead assigned to user`, req.user.id);
    }

    await client.query("COMMIT");

    // ── ✉ Email after successful DB commit ───────────────────────────────────
    setImmediate(async () => {
      try {
        const fullLead   = await fetchLeadWithProject(lead.id);
        const { adminEmails } = await getEmailContext(null);
        const creatorRow = await pool.query(
          "SELECT CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1",
          [req.user.id]
        );
        const createdByName = creatorRow.rows[0]?.name || "System";

        const emailData = {
          lead:         { ...fullLead },
          assignedTo:   fullLead?.assigned_name || null,
          createdBy:    createdByName,
          assigneeEmail: fullLead?.assigned_email || null,
          adminEmails,
        };

        // Notify admins + assignee of new lead
        await emailService.notifyLeadCreated(emailData);

        // If assigned, also send dedicated assignment email to assignee
        if (assigned_to && fullLead?.assigned_email) {
          const assignerRow = await pool.query(
            "SELECT CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1",
            [req.user.id]
          );
          await emailService.notifyLeadAssigned({
            lead:          { ...fullLead },
            assigneeName:  fullLead.assigned_name,
            assignerName:  assignerRow.rows[0]?.name || "System",
            assigneeEmail: fullLead.assigned_email,
            note:          notes || null,
          });
        }
      } catch (emailErr) {
        console.error("[Email] createLead notification failed:", emailErr.message);
      }
    });
    // ─────────────────────────────────────────────────────────────────────────

    return sendSuccess(res, "Lead created", lead, 201);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/leads/:id
 */
const getLeadById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: callerId } = req.user;

    const result = await pool.query(
      `SELECT l.*,
              p.name AS project_name, p.city AS project_city, p.locality AS project_locality,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_name,
              u.phone_number AS assigned_phone
       FROM leads l
       LEFT JOIN projects p ON p.id = l.project_id
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id = $1 AND l.is_archived = false`,
      [id]
    );

    if (result.rows.length === 0) return next(new AppError("Lead not found", 404));
    const lead = result.rows[0];

    if (role === "sales_executive" && lead.assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    return sendSuccess(res, "Lead fetched successfully", {
      ...lead,
      assigned_to: lead.assigned_to
        ? { id: lead.assigned_to, full_name: lead.assigned_name, phone: lead.assigned_phone }
        : null,
      project: lead.project_id
        ? { id: lead.project_id, name: lead.project_name, city: lead.project_city, locality: lead.project_locality }
        : null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/leads/:id
 * (No email — only info fields updated, not status/assignment)
 */
const updateLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, phone, alternate_phone_number, email, source, project_id, budget, location_preference } = req.body;

    const existing = await pool.query("SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]);
    if (existing.rows.length === 0) return next(new AppError("Lead not found", 404));

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && existing.rows[0].assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    const updates = []; const params = []; let idx = 1;
    if (name)                { updates.push(`name = $${idx++}`);                params.push(name.trim()); }
    if (phone)               { updates.push(`phone = $${idx++}`);               params.push(phone); }
    if (alternate_phone_number !== undefined) { updates.push(`alternate_phone_number = $${idx++}`); params.push(alternate_phone_number); }
    if (email !== undefined) { updates.push(`email = $${idx++}`);               params.push(email); }
    if (source)              { updates.push(`source = $${idx++}`);              params.push(source); }
    if (project_id !== undefined) { updates.push(`project_id = $${idx++}`);     params.push(project_id); }
    if (budget)              { updates.push(`budget = $${idx++}`);              params.push(budget); }
    if (location_preference) { updates.push(`location_preference = $${idx++}`); params.push(location_preference); }

    if (updates.length === 0) return next(new AppError("No fields to update", 400));
    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE leads SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );
    return sendSuccess(res, "Lead updated successfully", result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/leads/:id
 */
const deleteLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT id FROM leads WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Lead not found", 404));
    await pool.query("UPDATE leads SET is_archived = true, updated_at = NOW() WHERE id = $1", [id]);
    return sendSuccess(res, "Lead archived successfully");
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/leads/:id/status
 * ✉ Sends email: Lead Status Changed
 */
const updateLeadStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return next(new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400));
    }

    const existing = await pool.query(
      "SELECT id, status, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]
    );
    if (existing.rows.length === 0) return next(new AppError("Lead not found", 404));

    const oldStatus = existing.rows[0].status;

    // No email if status not actually changing
    if (oldStatus === status) {
      return sendSuccess(res, "Status is already set to this value", { id, status });
    }

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && existing.rows[0].assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    await client.query("BEGIN");
    const result = await client.query(
      "UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status, updated_at",
      [status, id]
    );
    await logActivity(
      client, id, "status_change",
      note || `Status changed from ${oldStatus} to ${status}`,
      callerId
    );
    await client.query("COMMIT");

    // ── ✉ Email after successful DB commit ───────────────────────────────────
    setImmediate(async () => {
      try {
        const fullLead = await fetchLeadWithProject(id);
        const { adminEmails } = await getEmailContext(null);
        const changedByRow = await pool.query(
          "SELECT CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1", [callerId]
        );

        await emailService.notifyLeadStatusChanged({
          lead:         fullLead,
          oldStatus,
          newStatus:    status,
          changedBy:    changedByRow.rows[0]?.name || "System",
          note:         note || null,
          assigneeEmail: fullLead?.assigned_email || null,
          adminEmails,
        });
      } catch (emailErr) {
        console.error("[Email] updateLeadStatus notification failed:", emailErr.message);
      }
    });
    // ─────────────────────────────────────────────────────────────────────────

    return sendSuccess(res, `Lead status updated to ${status}`, result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/v1/leads/:id/assign
 * ✉ Sends email: Lead Assigned
 */
const assignLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { assigned_to, note } = req.body;

    if (!assigned_to) return next(new AppError("assigned_to is required", 400));

    const leadResult = await pool.query(
      "SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]
    );
    if (leadResult.rows.length === 0) return next(new AppError("Lead not found", 404));

    const prevAssignee = leadResult.rows[0].assigned_to;

    // No email if assigning to same person
    const sameAssignee = prevAssignee === assigned_to;

    const userResult = await pool.query(
      "SELECT id, first_name, last_name, email, manager_id FROM users WHERE id = $1 AND is_active = true",
      [assigned_to]
    );
    if (userResult.rows.length === 0) return next(new AppError("User not found", 404));

    const { role, id: callerId } = req.user;
    if (role === "sales_manager" && userResult.rows[0].manager_id !== callerId) {
      return next(new AppError("Cannot assign to a user outside your team", 403));
    }

    await client.query("BEGIN");
    await client.query("UPDATE leads SET assigned_to = $1, updated_at = NOW() WHERE id = $2", [assigned_to, id]);
    const assignee = userResult.rows[0];
    await logActivity(
      client, id, "assignment",
      note || `Lead assigned to ${assignee.first_name} ${assignee.last_name}`,
      callerId
    );
    await client.query("COMMIT");

    // ── ✉ Email only if assignment actually changed ───────────────────────
    if (!sameAssignee) {
      setImmediate(async () => {
        try {
          const fullLead    = await fetchLeadWithProject(id);
          const assignerRow = await pool.query(
            "SELECT CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1", [callerId]
          );
          await emailService.notifyLeadAssigned({
            lead:          fullLead,
            assigneeName:  `${assignee.first_name} ${assignee.last_name}`,
            assignerName:  assignerRow.rows[0]?.name || "System",
            assigneeEmail: assignee.email,
            note:          note || null,
          });
        } catch (emailErr) {
          console.error("[Email] assignLead notification failed:", emailErr.message);
        }
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    return sendSuccess(res, `Lead assigned to ${assignee.first_name} ${assignee.last_name}`);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/leads/:id/activity
 */
const getLeadActivity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const lead = await pool.query("SELECT id, assigned_to FROM leads WHERE id = $1", [id]);
    if (lead.rows.length === 0) return next(new AppError("Lead not found", 404));

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && lead.rows[0].assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    const result = await pool.query(
      `SELECT la.id, la.type, la.note, la.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS performed_by
       FROM lead_activities la
       LEFT JOIN users u ON u.id = la.performed_by
       WHERE la.lead_id = $1
       ORDER BY la.created_at DESC`,
      [id]
    );
    return sendSuccess(res, "Activity log fetched", result.rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/leads/:id/activity
 */
const addLeadActivity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type, note } = req.body;

    const VALID_TYPES = ["note", "call", "email", "whatsapp", "meeting"];
    if (!type || !VALID_TYPES.includes(type)) {
      return next(new AppError(`Invalid type. Must be one of: ${VALID_TYPES.join(", ")}`, 400));
    }
    if (!note) return next(new AppError("note is required", 400));

    const lead = await pool.query("SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]);
    if (lead.rows.length === 0) return next(new AppError("Lead not found", 404));

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && lead.rows[0].assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    const result = await pool.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, type, note, callerId]
    );
    return sendSuccess(res, "Activity logged successfully", result.rows[0], 201);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/leads/sources
 */
const getLeadSources = async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT source FROM leads WHERE source IS NOT NULL ORDER BY source"
    );
    return sendSuccess(res, "Lead sources fetched", result.rows.map(r => r.source));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllLeads, createLead, getLeadById, updateLead, deleteLead,
  updateLeadStatus, assignLead, getLeadActivity, addLeadActivity, getLeadSources,
};