const { pool } = require("../config/db");
const { sendSuccess, sendError, paginate } = require("../utils/response");

const VALID_STATUSES = ["new", "contacted", "interested", "follow_up", "site_visit_scheduled", "site_visit_done", "negotiation", "booked", "lost"];

// Helper — log to activity table
const logActivity = async (client, leadId, type, note, performedBy) => {
  await client.query(
    `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, $2, $3, $4)`,
    [leadId, type, note, performedBy]
  );
};

/**
 * GET /api/v1/leads
 */
const getAllLeads = async (req, res) => {
  try {
    const { status, source, assigned_to, project_id, from, to, search, page = 1, per_page = 20 } = req.query;
    const { role, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = ["l.is_archived = false"];
    let params = [];
    let idx = 1;

    // Role-based visibility
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
      `SELECT l.id, l.name, l.phone, l.email, l.status, l.source, l.budget,
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
    console.error("[getAllLeads]", err);
    return sendError(res, "Failed to fetch leads", 500);
  }
};

/**
 * POST /api/v1/leads
 */
const createLead = async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, phone, email, source, project_id, assigned_to, budget, location_preference, notes } = req.body;
    if (!name || !phone) return sendError(res, "name and phone are required", 400);

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO leads (name, phone, email, source, project_id, assigned_to, budget, location_preference, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new',$9)
       RETURNING *`,
      [name.trim(), phone, email || null, source || null, project_id || null, assigned_to || null, budget || null, location_preference || null, req.user.id]
    );

    const lead = result.rows[0];

    await logActivity(client, lead.id, "note", notes || "Lead created", req.user.id);
    if (assigned_to) {
      await logActivity(client, lead.id, "assignment", `Lead assigned to user`, req.user.id);
    }

    await client.query("COMMIT");
    return sendSuccess(res, "Lead created successfully", lead, 201);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[createLead]", err);
    return sendError(res, "Failed to create lead", 500);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/leads/:id
 */
const getLeadById = async (req, res) => {
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

    if (result.rows.length === 0) return sendError(res, "Lead not found", 404);
    const lead = result.rows[0];

    if (role === "sales_executive" && lead.assigned_to !== callerId) {
      return sendError(res, "Access denied", 403);
    }

    return sendSuccess(res, "Lead fetched successfully", {
      ...lead,
      assigned_to: lead.assigned_to ? { id: lead.assigned_to, full_name: lead.assigned_name, phone: lead.assigned_phone } : null,
      project: lead.project_id ? { id: lead.project_id, name: lead.project_name, city: lead.project_city, locality: lead.project_locality } : null,
    });
  } catch (err) {
    console.error("[getLeadById]", err);
    return sendError(res, "Failed to fetch lead", 500);
  }
};

/**
 * PUT /api/v1/leads/:id
 */
const updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, source, project_id, budget, location_preference } = req.body;

    const existing = await pool.query("SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]);
    if (existing.rows.length === 0) return sendError(res, "Lead not found", 404);

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && existing.rows[0].assigned_to !== callerId) {
      return sendError(res, "Access denied", 403);
    }

    const updates = []; const params = []; let idx = 1;
    if (name)                { updates.push(`name = $${idx++}`);                params.push(name.trim()); }
    if (phone)               { updates.push(`phone = $${idx++}`);               params.push(phone); }
    if (email !== undefined) { updates.push(`email = $${idx++}`);               params.push(email); }
    if (source)              { updates.push(`source = $${idx++}`);              params.push(source); }
    if (project_id !== undefined) { updates.push(`project_id = $${idx++}`);     params.push(project_id); }
    if (budget)              { updates.push(`budget = $${idx++}`);              params.push(budget); }
    if (location_preference) { updates.push(`location_preference = $${idx++}`); params.push(location_preference); }

    if (updates.length === 0) return sendError(res, "No fields to update", 400);
    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE leads SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );
    return sendSuccess(res, "Lead updated successfully", result.rows[0]);
  } catch (err) {
    console.error("[updateLead]", err);
    return sendError(res, "Failed to update lead", 500);
  }
};

/**
 * DELETE /api/v1/leads/:id
 */
const deleteLead = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT id FROM leads WHERE id = $1", [id]);
    if (existing.rows.length === 0) return sendError(res, "Lead not found", 404);
    await pool.query("UPDATE leads SET is_archived = true, updated_at = NOW() WHERE id = $1", [id]);
    return sendSuccess(res, "Lead archived successfully");
  } catch (err) {
    console.error("[deleteLead]", err);
    return sendError(res, "Failed to archive lead", 500);
  }
};

/**
 * PATCH /api/v1/leads/:id/status
 */
const updateLeadStatus = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return sendError(res, `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400);
    }

    const existing = await pool.query("SELECT id, status, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]);
    if (existing.rows.length === 0) return sendError(res, "Lead not found", 404);

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && existing.rows[0].assigned_to !== callerId) {
      return sendError(res, "Access denied", 403);
    }

    await client.query("BEGIN");
    const result = await client.query(
      "UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status, updated_at",
      [status, id]
    );
    await logActivity(
      client, id, "status_change",
      note || `Status changed from ${existing.rows[0].status} to ${status}`,
      callerId
    );
    await client.query("COMMIT");

    return sendSuccess(res, `Lead status updated to ${status}`, result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[updateLeadStatus]", err);
    return sendError(res, "Failed to update status", 500);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/v1/leads/:id/assign
 */
const assignLead = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { assigned_to, note } = req.body;

    if (!assigned_to) return sendError(res, "assigned_to is required", 400);

    const leadResult = await pool.query("SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]);
    if (leadResult.rows.length === 0) return sendError(res, "Lead not found", 404);

    const userResult = await pool.query(
      "SELECT id, first_name, last_name, manager_id FROM users WHERE id = $1 AND is_active = true",
      [assigned_to]
    );
    if (userResult.rows.length === 0) return sendError(res, "User not found", 404);

    const { role, id: callerId } = req.user;
    if (role === "sales_manager" && userResult.rows[0].manager_id !== callerId) {
      return sendError(res, "Cannot assign to a user outside your team", 403);
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

    return sendSuccess(res, `Lead assigned to ${assignee.first_name} ${assignee.last_name}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[assignLead]", err);
    return sendError(res, "Failed to assign lead", 500);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/leads/:id/activity
 */
const getLeadActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await pool.query("SELECT id, assigned_to FROM leads WHERE id = $1", [id]);
    if (lead.rows.length === 0) return sendError(res, "Lead not found", 404);

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && lead.rows[0].assigned_to !== callerId) {
      return sendError(res, "Access denied", 403);
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
    console.error("[getLeadActivity]", err);
    return sendError(res, "Failed to fetch activity", 500);
  }
};

/**
 * POST /api/v1/leads/:id/activity
 */
const addLeadActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, note } = req.body;

    const VALID_TYPES = ["note", "call", "email", "whatsapp", "meeting"];
    if (!type || !VALID_TYPES.includes(type)) {
      return sendError(res, `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}`, 400);
    }
    if (!note) return sendError(res, "note is required", 400);

    const lead = await pool.query("SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]);
    if (lead.rows.length === 0) return sendError(res, "Lead not found", 404);

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && lead.rows[0].assigned_to !== callerId) {
      return sendError(res, "Access denied", 403);
    }

    const result = await pool.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, type, note, callerId]
    );
    return sendSuccess(res, "Activity logged successfully", result.rows[0], 201);
  } catch (err) {
    console.error("[addLeadActivity]", err);
    return sendError(res, "Failed to log activity", 500);
  }
};

/**
 * GET /api/v1/leads/sources
 */
const getLeadSources = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT source FROM leads WHERE source IS NOT NULL ORDER BY source"
    );
    const sources = result.rows.map(r => r.source);
    return sendSuccess(res, "Lead sources fetched", sources);
  } catch (err) {
    console.error("[getLeadSources]", err);
    return sendError(res, "Failed to fetch lead sources", 500);
  }
};

module.exports = { getAllLeads, createLead, getLeadById, updateLead, deleteLead, updateLeadStatus, assignLead, getLeadActivity, addLeadActivity, getLeadSources };
