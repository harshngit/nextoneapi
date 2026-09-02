/**
 * websiteInquiryController.js — Nextone Reality
 *
 * "Contact Us" style submissions from the public website. Creation is
 * public (no auth — the website itself has no logged-in user). Everything
 * else (list/view/update/delete/convert) is staff-only.
 */

const { pool } = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");
const { resolveProjectId, resolveProjectName } = require("../utils/projectResolver");
const { notifyAdmins } = require("./notificationController");
const emailService = require("../utils/emailService");

// Every website-inquiry notification always reaches this inbox, regardless
// of who's registered as admin in the system.
const WEBSITE_INQUIRY_NOTIFY_EMAIL = "nextonerealty77@gmail.com";

// ─── Helper — active admin/super_admin email addresses ────────────────────────
const getAdminEmails = async () => {
  const result = await pool.query(
    "SELECT email FROM users WHERE role IN ('admin','super_admin') AND is_active = true"
  );
  const emails = new Set(result.rows.map(r => r.email));
  emails.add(WEBSITE_INQUIRY_NOTIFY_EMAIL);
  return [...emails];
};

// ─── POST /api/v1/website-inquiries (PUBLIC — no auth) ────────────────────────
const createInquiry = async (req, res, next) => {
  try {
    const { name, phone, email, message, project_id, project_name, source } = req.body;

    if (!name || !phone) {
      return next(new AppError("name and phone are required", 400));
    }

    let resolvedProjectId = null;
    let resolvedProjectNameText = null;
    if (project_id) {
      try {
        resolvedProjectId = await resolveProjectId(project_id);
      } catch (e) {
        resolvedProjectNameText = String(project_id).trim();
      }
    } else if (project_name) {
      const resolved = await resolveProjectName(project_name);
      resolvedProjectId = resolved.projectId;
      resolvedProjectNameText = resolved.projectNameText;
    }

    const result = await pool.query(
      `INSERT INTO website_inquiries
         (name, phone, email, message, project_id, project_name_text, source, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        String(name).trim(), phone, email || null, message || null,
        resolvedProjectId, resolvedProjectNameText, source || "Website",
        req.ip || null,
      ]
    );
    const inquiry = result.rows[0];

    // Fire-and-forget: in-app/push notification to admins + email to admins
    // and the inquirer. None of this should block or fail the public response.
    notifyAdmins({
      type: "general",
      title: "New Website Inquiry",
      message: `${inquiry.name} (${inquiry.phone}) submitted an inquiry from the website`,
      reference_id: inquiry.id,
      reference_type: "website_inquiry",
      metadata: { inquiry_id: inquiry.id },
    }).catch(() => {});

    getAdminEmails()
      .then(adminEmails => emailService.notifyWebsiteInquiry({ inquiry, adminEmails }))
      .catch(err => console.error("[Email] website inquiry notify failed:", err.message));

    return sendSuccess(res, "Thank you — we'll get in touch with you shortly", inquiry, 201);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/v1/website-inquiries ─────────────────────────────────────────────
const getAllInquiries = async (req, res, next) => {
  try {
    const { status, source, project, search, from, to, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params = [];
    let idx = 1;

    if (status) { conditions.push(`wi.status = $${idx++}`); params.push(status); }
    if (source) { conditions.push(`wi.source ILIKE $${idx++}`); params.push(source); }
    if (project) {
      conditions.push(`COALESCE(p.name, wi.project_name_text) ILIKE $${idx++}`);
      params.push(`%${project}%`);
    }
    if (search) {
      conditions.push(`(wi.name ILIKE $${idx} OR wi.phone ILIKE $${idx} OR wi.email ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }
    if (from) { conditions.push(`wi.created_at::date >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`wi.created_at::date <= $${idx++}`); params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM website_inquiries wi
       LEFT JOIN projects p ON p.id = wi.project_id ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT wi.*, COALESCE(p.name, wi.project_name_text) AS project_name
       FROM website_inquiries wi
       LEFT JOIN projects p ON p.id = wi.project_id
       ${where}
       ORDER BY wi.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/v1/website-inquiries/:id ─────────────────────────────────────────
const getInquiryById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT wi.*, COALESCE(p.name, wi.project_name_text) AS project_name
       FROM website_inquiries wi
       LEFT JOIN projects p ON p.id = wi.project_id
       WHERE wi.id = $1`,
      [id]
    );
    if (!result.rows.length) return next(new AppError("Website inquiry not found", 404));
    return sendSuccess(res, "Website inquiry fetched", result.rows[0]);
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/v1/website-inquiries/:id ─────────────────────────────────────────
const updateInquiry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT id FROM website_inquiries WHERE id = $1", [id]);
    if (!existing.rows.length) return next(new AppError("Website inquiry not found", 404));

    const { name, phone, email, message, status, project_id, project_name } = req.body;

    if (status && !["new", "contacted", "converted", "spam", "closed"].includes(status)) {
      return next(new AppError("Invalid status value", 400));
    }

    let resolvedProjectId, resolvedProjectNameText;
    let projectProvided = false;
    if (project_id) {
      projectProvided = true;
      try {
        resolvedProjectId = await resolveProjectId(project_id);
        resolvedProjectNameText = null;
      } catch (e) {
        resolvedProjectId = null;
        resolvedProjectNameText = String(project_id).trim();
      }
    } else if (project_name) {
      projectProvided = true;
      const resolved = await resolveProjectName(project_name);
      resolvedProjectId = resolved.projectId;
      resolvedProjectNameText = resolved.projectNameText;
    }

    const fields = [];
    const params = [];
    let idx = 1;
    const set = (col, val) => { fields.push(`${col} = $${idx++}`); params.push(val); };

    if (name !== undefined)    set("name", name);
    if (phone !== undefined)   set("phone", phone);
    if (email !== undefined)   set("email", email);
    if (message !== undefined) set("message", message);
    if (status !== undefined)  set("status", status);
    if (projectProvided) {
      set("project_id", resolvedProjectId);
      set("project_name_text", resolvedProjectNameText);
    }

    if (!fields.length) return next(new AppError("No fields to update", 400));

    fields.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE website_inquiries SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );

    return sendSuccess(res, "Website inquiry updated", result.rows[0]);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/v1/website-inquiries/:id ──────────────────────────────────────
const deleteInquiry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT id FROM website_inquiries WHERE id = $1", [id]);
    if (!existing.rows.length) return next(new AppError("Website inquiry not found", 404));

    await pool.query("DELETE FROM website_inquiries WHERE id = $1", [id]);
    return sendSuccess(res, "Website inquiry deleted");
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/v1/website-inquiries/:id/convert ────────────────────────────────
// Body: { convert_to: 'lead' | 'follow_up' | 'site_visit', ...fields }
// Always creates a Lead. When convert_to is 'follow_up' or 'site_visit', a
// Task / Site Visit is additionally created and linked to that same lead.
const convertInquiry = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      convert_to,
      assigned_to, budget, location_preference, configuration, status,
      project_id, project_name,
      title, due_date, priority, notes,
      visit_date, visit_time, transport_arranged,
    } = req.body;

    if (!["lead", "follow_up", "site_visit"].includes(convert_to)) {
      return next(new AppError("convert_to must be one of 'lead', 'follow_up', 'site_visit'", 400));
    }

    const existing = await pool.query("SELECT * FROM website_inquiries WHERE id = $1", [id]);
    if (!existing.rows.length) return next(new AppError("Website inquiry not found", 404));
    const inquiry = existing.rows[0];

    if (inquiry.status === "converted") {
      return next(new AppError("This inquiry has already been converted", 400));
    }
    if (convert_to === "follow_up" && !due_date) {
      return next(new AppError("due_date is required to convert to a follow-up", 400));
    }
    if (convert_to === "site_visit" && (!visit_date || !visit_time)) {
      return next(new AppError("visit_date and visit_time are required to convert to a site visit", 400));
    }

    let resolvedProjectId = inquiry.project_id;
    let resolvedProjectNameText = inquiry.project_name_text;
    if (project_id) {
      try {
        resolvedProjectId = await resolveProjectId(project_id);
        resolvedProjectNameText = null;
      } catch (e) {
        resolvedProjectId = null;
        resolvedProjectNameText = String(project_id).trim();
      }
    } else if (project_name) {
      const resolved = await resolveProjectName(project_name);
      resolvedProjectId = resolved.projectId;
      resolvedProjectNameText = resolved.projectNameText;
    }

    await client.query("BEGIN");

    // Duplicate phone check — a phone number already registered to an active
    // (non-archived) lead cannot be reused. Same rule as POST /api/v1/leads.
    const dupLead = await client.query(
      "SELECT id, name FROM leads WHERE phone = $1 AND is_archived = false LIMIT 1",
      [inquiry.phone]
    );
    if (dupLead.rows.length) {
      await client.query("ROLLBACK");
      return next(new AppError(
        `This phone number is already registered with lead "${dupLead.rows[0].name}". Duplicate phone numbers are not allowed.`,
        400
      ));
    }

    const leadStatus = status
      || (convert_to === "follow_up" ? "follow_up"
        : convert_to === "site_visit" ? "site_visit_scheduled"
        : "new");

    const leadResult = await client.query(
      `INSERT INTO leads (name, phone, email, source, project_id, project_name_text,
                           assigned_to, budget, location_preference, configuration,
                           status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        inquiry.name, inquiry.phone, inquiry.email || null, inquiry.source || "Website",
        resolvedProjectId, resolvedProjectNameText,
        assigned_to || null, budget || null, location_preference || null, configuration || null,
        leadStatus, req.user.id,
      ]
    );
    const lead = leadResult.rows[0];

    let task = null;
    let siteVisit = null;

    if (convert_to === "follow_up") {
      const taskResult = await client.query(
        `INSERT INTO tasks (title, lead_id, due_date, assigned_to, priority, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          title || `Follow up with ${inquiry.name}`, lead.id, due_date,
          assigned_to || lead.assigned_to || req.user.id, priority || "medium",
          notes || inquiry.message || null, req.user.id,
        ]
      );
      task = taskResult.rows[0];
    }

    if (convert_to === "site_visit") {
      const svResult = await client.query(
        `INSERT INTO site_visits (lead_id, project_id, project_name_text, visit_date, visit_time,
                                   assigned_to, status, transport_arranged, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7,$8,$9)
         RETURNING *`,
        [
          lead.id, resolvedProjectId, resolvedProjectNameText, visit_date, visit_time,
          assigned_to || lead.assigned_to || req.user.id, transport_arranged || false,
          notes || inquiry.message || null, req.user.id,
        ]
      );
      siteVisit = svResult.rows[0];
    }

    await client.query(
      `UPDATE website_inquiries
       SET status = 'converted', converted_to = $1, lead_id = $2, converted_at = NOW(),
           converted_by = $3, updated_at = NOW()
       WHERE id = $4`,
      [convert_to, lead.id, req.user.id, id]
    );

    await client.query("COMMIT");

    // NOTE: the "new lead created" email (notifyLeadCreated) was removed on
    // purpose — the in-app/push notification below still fires.

    notifyAdmins({
      type: "lead_new",
      title: "Website Inquiry Converted",
      message: `A website inquiry was converted to a ${convert_to.replace("_", " ")} for "${lead.name}"`,
      reference_id: lead.id,
      reference_type: "lead",
      metadata: { lead_id: lead.id, inquiry_id: id, convert_to },
    }).catch(() => {});

    return sendSuccess(
      res,
      `Inquiry converted to ${convert_to.replace("_", " ")} successfully`,
      { lead, task, site_visit: siteVisit },
      201
    );
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  createInquiry,
  getAllInquiries,
  getInquiryById,
  updateInquiry,
  deleteInquiry,
  convertInquiry,
};
