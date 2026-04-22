const { pool } = require("../config/db");
const { sendSuccess, sendError, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");

const VALID_STATUSES = ["scheduled", "done", "cancelled", "rescheduled", "no_show"];

/**
 * GET /api/v1/site-visits
 */
const getAllSiteVisits = async (req, res, next) => {
  try {
    const { status, assigned_to, project_id, from, to, page = 1, per_page = 20 } = req.query;
    const { role, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params = [];
    let idx = 1;

    if (role === "sales_executive") { conditions.push(`sv.assigned_to = $${idx++}`); params.push(callerId); }
    else if (role === "sales_manager") { conditions.push(`u.manager_id = $${idx++}`); params.push(callerId); }

    if (status)     { conditions.push(`sv.status = $${idx++}`);               params.push(status); }
    if (assigned_to){ conditions.push(`sv.assigned_to = $${idx++}`);          params.push(assigned_to); }
    if (project_id) { conditions.push(`sv.project_id = $${idx++}`);           params.push(project_id); }
    if (from)       { conditions.push(`sv.visit_date >= $${idx++}`);          params.push(from); }
    if (to)         { conditions.push(`sv.visit_date <= $${idx++}`);          params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM site_visits sv
       LEFT JOIN users u ON u.id = sv.assigned_to ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT sv.id, sv.lead_id, sv.project_id, sv.visit_date, sv.visit_time,
              sv.status, sv.transport_arranged, sv.notes, sv.created_at,
              l.name AS lead_name, l.phone AS lead_phone,
              p.name AS project_name,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to
       FROM site_visits sv
       LEFT JOIN leads l ON l.id = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       LEFT JOIN users u ON u.id = sv.assigned_to
       ${where}
       ORDER BY sv.visit_date DESC, sv.visit_time DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/site-visits
 */
const createSiteVisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { lead_id, project_id, visit_date, visit_time, assigned_to, notes, transport_arranged } = req.body;
    if (!lead_id || !project_id || !visit_date || !visit_time) {
      return next(new AppError("lead_id, project_id, visit_date, and visit_time are required", 400));
    }

    const lead = await pool.query("SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [lead_id]);
    if (lead.rows.length === 0) return next(new AppError("Lead not found", 404));

    const project = await pool.query("SELECT id FROM projects WHERE id = $1", [project_id]);
    if (project.rows.length === 0) return next(new AppError("Project not found", 404));

    const execId = assigned_to || lead.rows[0].assigned_to;

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO site_visits (lead_id, project_id, visit_date, visit_time, assigned_to, notes, transport_arranged, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled') RETURNING *`,
      [lead_id, project_id, visit_date, visit_time, execId, notes || null, transport_arranged || false]
    );

    // Auto-update lead status
    await client.query(
      "UPDATE leads SET status = 'site_visit_scheduled', updated_at = NOW() WHERE id = $1",
      [lead_id]
    );
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by)
       VALUES ($1,'status_change','Site visit scheduled for ' || $2, $3)`,
      [lead_id, visit_date, req.user.id]
    );

    await client.query("COMMIT");
    return sendSuccess(res, "Site visit scheduled successfully", result.rows[0], 201);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/site-visits/:id
 */
const getSiteVisitById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT sv.*,
              l.name AS lead_name, l.phone AS lead_phone, l.email AS lead_email,
              p.name AS project_name, p.address AS project_address, p.city AS project_city,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_name,
              f.rating, f.client_reaction, f.interested_in, f.next_step, f.remarks AS feedback_remarks
       FROM site_visits sv
       LEFT JOIN leads l ON l.id = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       LEFT JOIN users u ON u.id = sv.assigned_to
       LEFT JOIN site_visit_feedback f ON f.site_visit_id = sv.id
       WHERE sv.id = $1`,
      [id]
    );

    if (result.rows.length === 0) return next(new AppError("Site visit not found", 404));

    const sv = result.rows[0];
    return sendSuccess(res, "Site visit fetched", {
      id: sv.id, visit_date: sv.visit_date, visit_time: sv.visit_time,
      status: sv.status, transport_arranged: sv.transport_arranged, notes: sv.notes,
      created_at: sv.created_at,
      lead: { id: sv.lead_id, name: sv.lead_name, phone: sv.lead_phone, email: sv.lead_email },
      project: { id: sv.project_id, name: sv.project_name, address: sv.project_address, city: sv.project_city },
      assigned_to: { id: sv.assigned_to, full_name: sv.assigned_name },
      feedback: sv.rating ? {
        rating: sv.rating, client_reaction: sv.client_reaction,
        interested_in: sv.interested_in, next_step: sv.next_step, remarks: sv.feedback_remarks,
      } : null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/site-visits/:id
 */
const updateSiteVisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { visit_date, visit_time, assigned_to, notes, transport_arranged, reschedule_reason } = req.body;

    const existing = await pool.query("SELECT * FROM site_visits WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Site visit not found", 404));
    if (existing.rows[0].status === "done") return next(new AppError("Cannot update a completed site visit", 400));

    const isReschedule = (visit_date && visit_date !== existing.rows[0].visit_date) ||
                         (visit_time && visit_time !== existing.rows[0].visit_time);

    const updates = []; const params = []; let idx = 1;
    if (visit_date)                    { updates.push(`visit_date = $${idx++}`);          params.push(visit_date); }
    if (visit_time)                    { updates.push(`visit_time = $${idx++}`);          params.push(visit_time); }
    if (assigned_to)                   { updates.push(`assigned_to = $${idx++}`);         params.push(assigned_to); }
    if (notes !== undefined)           { updates.push(`notes = $${idx++}`);               params.push(notes); }
    if (transport_arranged !== undefined) { updates.push(`transport_arranged = $${idx++}`); params.push(transport_arranged); }
    if (isReschedule)                  { updates.push(`status = 'rescheduled'`); }
    updates.push(`updated_at = NOW()`);
    params.push(id);

    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE site_visits SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`, params
    );

    if (isReschedule) {
      await client.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by)
         VALUES ($1, 'note', $2, $3)`,
        [existing.rows[0].lead_id, reschedule_reason || `Site visit rescheduled to ${visit_date}`, req.user.id]
      );
    }

    await client.query("COMMIT");
    const msg = isReschedule ? `Site visit rescheduled to ${visit_date} at ${visit_time}` : "Site visit updated";
    return sendSuccess(res, msg, result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/v1/site-visits/:id/status
 */
const updateSiteVisitStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return next(new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400));
    }
    if (["cancelled", "no_show"].includes(status) && !note) {
      return next(new AppError("note is required when cancelling or marking no_show", 400));
    }

    const existing = await pool.query("SELECT * FROM site_visits WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Site visit not found", 404));

    await client.query("BEGIN");
    await client.query("UPDATE site_visits SET status = $1, updated_at = NOW() WHERE id = $2", [status, id]);

    const leadId = existing.rows[0].lead_id;
    if (status === "done") {
      await client.query("UPDATE leads SET status = 'site_visit_done', updated_at = NOW() WHERE id = $1", [leadId]);
    }
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [leadId, note || `Site visit marked as ${status}`, req.user.id]
    );

    await client.query("COMMIT");
    return sendSuccess(res, `Site visit marked as ${status}`);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * POST /api/v1/site-visits/:id/feedback
 */
const submitFeedback = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { rating, client_reaction, interested_in, next_step, remarks } = req.body;

    if (!client_reaction || !next_step) {
      return next(new AppError("client_reaction and next_step are required", 400));
    }

    const VALID_REACTIONS = ["very_positive", "positive", "neutral", "negative", "not_interested"];
    const VALID_NEXT_STEPS = ["negotiation", "follow_up", "send_proposal", "booked", "lost"];

    if (!VALID_REACTIONS.includes(client_reaction)) {
      return next(new AppError(`Invalid client_reaction. Must be: ${VALID_REACTIONS.join(", ")}`, 400));
    }
    if (!VALID_NEXT_STEPS.includes(next_step)) {
      return next(new AppError(`Invalid next_step. Must be: ${VALID_NEXT_STEPS.join(", ")}`, 400));
    }

    const visit = await pool.query("SELECT * FROM site_visits WHERE id = $1", [id]);
    if (visit.rows.length === 0) return next(new AppError("Site visit not found", 404));
    if (visit.rows[0].status !== "done") return next(new AppError("Feedback can only be submitted for completed visits", 400));

    const existingFeedback = await pool.query("SELECT id FROM site_visit_feedback WHERE site_visit_id = $1", [id]);
    if (existingFeedback.rows.length > 0) return next(new AppError("Feedback already submitted for this visit", 400));

    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO site_visit_feedback (site_visit_id, rating, client_reaction, interested_in, next_step, remarks, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, rating || null, client_reaction, interested_in || null, next_step, remarks || null, req.user.id]
    );

    // Log to lead activity
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by)
       VALUES ($1,'note',$2,$3)`,
      [visit.rows[0].lead_id, `Visit feedback: ${client_reaction} reaction. Next step: ${next_step}. ${remarks || ""}`, req.user.id]
    );

    await client.query("COMMIT");
    return sendSuccess(res, "Visit feedback submitted successfully", result.rows[0], 201);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/site-visits/lead/:leadId
 */
const getVisitsByLead = async (req, res, next) => {
  try {
    const { leadId } = req.params;
    const lead = await pool.query("SELECT id FROM leads WHERE id = $1", [leadId]);
    if (lead.rows.length === 0) return next(new AppError("Lead not found", 404));

    const result = await pool.query(
      `SELECT sv.id, sv.visit_date, sv.visit_time, sv.status, sv.transport_arranged,
              sv.notes, sv.created_at,
              p.name AS project_name, p.city AS project_city,
              f.rating, f.client_reaction, f.next_step, f.remarks AS feedback_remarks
       FROM site_visits sv
       LEFT JOIN projects p ON p.id = sv.project_id
       LEFT JOIN site_visit_feedback f ON f.site_visit_id = sv.id
       WHERE sv.lead_id = $1
       ORDER BY sv.visit_date DESC`,
      [leadId]
    );

    return sendSuccess(res, "Site visits fetched", result.rows.map(sv => ({
      id: sv.id, project_name: sv.project_name, project_city: sv.project_city,
      visit_date: sv.visit_date, visit_time: sv.visit_time, status: sv.status,
      transport_arranged: sv.transport_arranged, notes: sv.notes, created_at: sv.created_at,
      feedback: sv.rating ? {
        rating: sv.rating, client_reaction: sv.client_reaction,
        next_step: sv.next_step, remarks: sv.feedback_remarks,
      } : null,
    })));
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllSiteVisits, createSiteVisit, getSiteVisitById, updateSiteVisit, updateSiteVisitStatus, submitFeedback, getVisitsByLead };
