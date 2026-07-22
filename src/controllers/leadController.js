/**
 * leadController.js — Nextone Reality
 * Fixes:
 *  1. fetchLeadWithProject — explicit column aliases so lead.email
 *     (client email) never gets overwritten by u.email (assignee email)
 *  2. Null guard on lead.name before .split() in email dispatch
 *  3. Added convertLead — manual convert lead to booking (PATCH /:id/convert)
 *
 * Email notifications fire ONLY after confirmed DB writes (setImmediate).
 */

const path            = require('path');
const fs              = require('fs');
const { pool }        = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError        = require("../utils/AppError");
const emailService    = require("../utils/emailService");
const whatsappService = require("../utils/whatsappService");
const { getTeamIds, ADMIN_ROLES, LEAF_ROLES } = require("../utils/teamUtils");
const { resolveProjectId, resolveProjectName } = require("../utils/projectResolver");
const { createNotification, createBulkNotifications, notifyAdmins } = require("./notificationController");

const VALID_STATUSES = [
  "new", "contacted", "interested", "follow_up",
  "site_visit_scheduled", "site_visit_done",
  "negotiation", "booked", "lost",
];

// Same phone number can be reused across leads (e.g. interested in multiple
// projects) but only up to this many times.
const MAX_LEADS_PER_PHONE = 3;

// ─── Helper — status is valid if it's a system status OR an active custom
// status defined in lead_statuses (used by both createLead and updateLeadStatus
// so the two entry points can never diverge on what counts as valid) ──────────
const isValidLeadStatus = async (status) => {
  if (VALID_STATUSES.includes(status)) return true;
  const custom = await pool.query(
    'SELECT key FROM lead_statuses WHERE key = $1 AND is_active = true', [status]
  );
  return custom.rows.length > 0;
};

// ─── Helper — count how many (non-archived) leads already use this phone ─────
const countLeadsByPhone = async (client, phone, excludeLeadId = null) => {
  const result = excludeLeadId
    ? await client.query(
        "SELECT COUNT(*) FROM leads WHERE phone = $1 AND is_archived = false AND id != $2",
        [phone, excludeLeadId]
      )
    : await client.query(
        "SELECT COUNT(*) FROM leads WHERE phone = $1 AND is_archived = false",
        [phone]
      );
  return parseInt(result.rows[0].count, 10);
};

// ─── Helper — activity log ────────────────────────────────────────────────────
const logActivity = async (client, leadId, type, note, performedBy) => {
  await client.query(
    `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, $2, $3, $4)`,
    [leadId, type, note, performedBy]
  );
};

// ─── Helper — fetch full lead (explicit aliases, NO column collision) ─────────
//
// ROOT BUG FIX: Using `l.*` with `u.email AS assigned_email` caused the pg
// driver to overwrite l.email (client email) with u.email (staff email)
// because both resolve to the key "email" in the result object.
//
// Fix: list every lead column explicitly, aliasing the client email as
// `lead_email`, then re-expose it as `email` in the returned JS object.
//
const fetchLeadWithProject = async (leadId) => {
  const result = await pool.query(
    `SELECT
       l.id,
       l.name,
       l.phone,
       l.alternate_phone_number,
       l.email            AS lead_email,
       l.status,
       l.source,
       l.budget,
       l.location_preference,
       l.callback_time,
       l.next_followup_time,
       l.project_id,
       l.project_name_text,
       l.assigned_to,
       l.created_by,
       l.is_archived,
       l.is_converted,
       l.converted_at,
       l.created_at,
       l.updated_at,
       l.configuration,
       l.payment_proof_url,
       l.payment_proof_amount,
       COALESCE(p.name, l.project_name_text) AS project_name,
       CONCAT(u.first_name,' ',u.last_name) AS assigned_name,
       u.email            AS assigned_email
     FROM leads l
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN users u    ON u.id = l.assigned_to
     WHERE l.id = $1`,
    [leadId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  // Always expose the CLIENT's email under the standard `email` key
  return { ...row, email: row.lead_email };
};

/**
 * GET /api/v1/leads
 */
const getAllLeads = async (req, res, next) => {
  try {
    const { status, source, assigned_to, project_id, project, from, to, search, page = 1, per_page = 20 } = req.query;
    const { role, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = ["l.is_archived = false"];
    let params = [];
    let idx = 1;

    if (LEAF_ROLES.includes(role)) {
      conditions.push(`l.assigned_to = $${idx++}`);
      params.push(callerId);
    } else if (!ADMIN_ROLES.includes(role)) {
      const teamIds = await getTeamIds(callerId);
      conditions.push(`l.assigned_to = ANY($${idx++}::uuid[])`);
      params.push(teamIds);
    }

    if (status)      { conditions.push(`l.status = $${idx++}`);             params.push(status); }
    if (source)      { conditions.push(`l.source ILIKE $${idx++}`);         params.push(source); }
    if (assigned_to) { conditions.push(`l.assigned_to = $${idx++}`);        params.push(assigned_to); }
    if (project_id)  {
      // Exact match on a known project id/name — never throws; a
      // non-matching value just yields zero results instead of a 500.
      try {
        const resolvedProjectId = await resolveProjectId(project_id);
        conditions.push(`l.project_id = $${idx++}`);
        params.push(resolvedProjectId);
      } catch (e) {
        conditions.push("1 = 0");
      }
    }
    if (project) {
      // Free-text project search — matches the linked project's name OR the
      // lead's free-text project_name_text (for projects that aren't in the
      // projects table yet). Partial, case-insensitive match.
      conditions.push(`COALESCE(p.name, l.project_name_text) ILIKE $${idx++}`);
      params.push(`%${project}%`);
    }
    if (from)        { conditions.push(`l.created_at::date >= $${idx++}`);  params.push(from); }
    if (to)          { conditions.push(`l.created_at::date <= $${idx++}`);  params.push(to); }
    if (search) {
      conditions.push(`(l.name ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.email ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       LEFT JOIN projects p ON p.id = l.project_id
       ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT l.id, l.name, l.phone, l.alternate_phone_number, l.email, l.status,
              l.source, l.budget, l.location_preference, l.project_id, l.project_name_text, l.assigned_to,
              l.callback_time, l.next_followup_time, l.configuration,
              l.payment_proof_url, l.payment_proof_amount,
              l.is_converted, l.converted_at, l.created_at, l.updated_at,
              COALESCE(p.name, l.project_name_text) AS project_name, p.city AS project_city,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_name,
              (SELECT COUNT(*) FROM call_recordings cr WHERE cr.lead_id = l.id) AS call_recordings_count,
              (SELECT COUNT(*) FROM lead_photos ph WHERE ph.lead_id = l.id)    AS photos_count
       FROM leads l
       LEFT JOIN projects p ON p.id = l.project_id
       LEFT JOIN users u ON u.id = l.assigned_to
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    dataResult.rows.forEach(r => {
      r.call_recordings_count = parseInt(r.call_recordings_count) || 0;
      r.photos_count          = parseInt(r.photos_count)          || 0;
    });

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/leads/upload-recording
 * Standalone file upload — returns { url, filename, size }
 * Call this FIRST, get the URL, then pass it in create/update lead body.
 * Field name: voice_recording
 */
const uploadRecordingFile = async (req, res, next) => {
  try {
    if (!req.file) return next(new AppError('No file uploaded. Use field name: voice_recording', 400));

    const fileUrl  = `/uploads/leads/voice/${req.file.filename}`;
    const fileName = req.file.originalname;
    const fileSize = req.file.size || null;

    return sendSuccess(res, 'File uploaded successfully', {
      url:      fileUrl,
      filename: fileName,
      size:     fileSize,
    }, 201);
  } catch (err) { next(err); }
};

/**
 * POST /api/v1/leads
 * Email → Internal: New Lead detail  |  Client: Welcome email
 */
const createLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, phone, alternate_phone_number, email, source,
            project_id, project_name,
            assigned_to, budget, location_preference, configuration, notes,
            callback_time, next_followup_time,
            call_recordings, payment_proof_url, payment_proof_amount, photos, status } = req.body;

    // project_id takes precedence over project_name. Neither has to match an
    // existing project — if it doesn't, it's stored as free text instead
    // (project_name_text) rather than rejecting the request.
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

    if (!name || !phone) return next(new AppError("name and phone are required", 400));

    // status defaults to 'new' — pass it explicitly to start the lead further
    // along the lifecycle (e.g. importing an already-contacted lead)
    let initialStatus = "new";
    if (status !== undefined) {
      if (!(await isValidLeadStatus(status))) {
        return next(new AppError(
          `Invalid status '${status}'. Use GET /api/v1/config/lead-statuses for the full list.`, 400
        ));
      }
      initialStatus = status;
    }

    // Validate call_recordings if provided
    let recordings = [];
    if (call_recordings) {
      recordings = Array.isArray(call_recordings) ? call_recordings : [call_recordings];
      for (const rec of recordings) {
        if (!rec.url) return next(new AppError('Each call_recording must have a url', 400));
      }
    }

    // payment_proof_url / payment_proof_amount — a single flat proof per lead
    // (not an array). amount without a url makes no sense.
    if (payment_proof_amount !== undefined && !payment_proof_url) {
      return next(new AppError('payment_proof_url is required when payment_proof_amount is provided', 400));
    }

    // Validate photos if provided
    let photoItems = [];
    if (photos) {
      photoItems = Array.isArray(photos) ? photos : [photos];
      for (const ph of photoItems) {
        if (!ph.url) return next(new AppError('Each photo must have a url', 400));
      }
    }

    await client.query("BEGIN");

    const phoneUsage = await countLeadsByPhone(client, phone);
    if (phoneUsage >= MAX_LEADS_PER_PHONE) {
      await client.query("ROLLBACK");
      return next(new AppError(
        `This phone number has already been used for ${MAX_LEADS_PER_PHONE} leads. A phone number can be added at most ${MAX_LEADS_PER_PHONE} times.`, 400
      ));
    }

    const result = await client.query(
      `INSERT INTO leads (name, phone, alternate_phone_number, email, source,
                          project_id, project_name_text, assigned_to, budget, location_preference, configuration,
                          callback_time, next_followup_time, payment_proof_url, payment_proof_amount,
                          status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [name.trim(), phone, alternate_phone_number || null, email || null, source || null,
       resolvedProjectId || null, resolvedProjectNameText || null,
       assigned_to || null, budget || null, location_preference || null,
       configuration || null, callback_time || null, next_followup_time || null,
       payment_proof_url || null, payment_proof_amount || null,
       initialStatus, req.user.id]
    );

    const lead = result.rows[0];
    await logActivity(client, lead.id, "note", notes || "Lead created", req.user.id);
    if (assigned_to) {
      await logActivity(client, lead.id, "assignment", "Lead assigned to user", req.user.id);
    }

    // ── Save call recordings ─────────────────────────────────────────────────
    const savedRecordings = [];
    if (recordings.length > 0) {
      for (const rec of recordings) {
        const recResult = await client.query(
          `INSERT INTO call_recordings (lead_id, url, phone_number, name, uploaded_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [lead.id, rec.url, rec.phone_number || null, rec.name || null, req.user.id]
        );
        savedRecordings.push(recResult.rows[0]);
      }
      await logActivity(client, lead.id, "call",
        `${recordings.length} call recording(s) attached`, req.user.id);
    }

    if (payment_proof_url) {
      await logActivity(client, lead.id, "note", "Payment proof attached", req.user.id);
    }

    // ── Save photos ───────────────────────────────────────────────────────────
    const savedPhotos = [];
    if (photoItems.length > 0) {
      for (const ph of photoItems) {
        const photoResult = await client.query(
          `INSERT INTO lead_photos (lead_id, url, name, uploaded_by)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [lead.id, ph.url, ph.name || null, req.user.id]
        );
        savedPhotos.push(photoResult.rows[0]);
      }
      await logActivity(client, lead.id, "note",
        `${photoItems.length} photo(s) attached`, req.user.id);
    }

    await client.query("COMMIT");

    // ── Push + in-app notifications ───────────────────────────────────────────
    setImmediate(async () => {
      try {
        // 1. Notify all admins: new lead created
        await notifyAdmins({
          type:           'lead_new',
          title:          'New Lead Created',
          message:        `${name.trim()} (${phone}) was added${assigned_to ? ' and assigned' : ''}`,
          reference_id:   lead.id,
          reference_type: 'lead',
          metadata:       { lead_id: lead.id, created_by: req.user.id },
        });

        // 2. Notify assigned exec if lead was assigned on creation
        if (assigned_to) {
          await createNotification(assigned_to, {
            type:           'lead_assigned',
            title:          'New Lead Assigned to You',
            message:        `Lead "${name.trim()}" has been assigned to you`,
            reference_id:   lead.id,
            reference_type: 'lead',
            metadata:       { lead_id: lead.id, phone },
          });
          // 3. Notify their manager too
          const mgrRow = await pool.query(
            `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [assigned_to]
          );
          if (mgrRow.rows.length) {
            await createNotification(mgrRow.rows[0].manager_id, {
              type:           'lead_assigned',
              title:          'Lead Assigned to Your Team',
              message:        `Lead "${name.trim()}" was assigned to one of your executives`,
              reference_id:   lead.id,
              reference_type: 'lead',
              metadata:       { lead_id: lead.id, assigned_to },
            });
          }
        }
      } catch (notifErr) {
        console.error('[Notification] createLead failed:', notifErr.message);
      }
    });
    setImmediate(async () => {
      try {
        const fullLead = await fetchLeadWithProject(lead.id);
        if (!fullLead) return;  // null guard

        // NOTE: the "new lead created" welcome/admin email (notifyLeadCreated)
        // was removed on purpose — only the assignment email below still fires.

        // Dedicated assignment email to the exec
        if (assigned_to && fullLead.assigned_email) {
          const assignerRow = await pool.query(
            "SELECT CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1",
            [req.user.id]
          );
          await emailService.notifyLeadAssigned({
            lead:          fullLead,
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

    // ── 📱 WhatsApp — welcome message to the client ──────────────────────────
    setImmediate(async () => {
      try {
        if (lead.whatsapp_welcome_sent) return; // already sent (shouldn't happen on create, but safe)
        await whatsappService.sendLeadWelcome({
          leadName:    lead.name,
          leadPhone:   lead.phone,
          projectName: lead.project_id ? (await pool.query(
            `SELECT name FROM projects WHERE id = $1`, [lead.project_id]
          )).rows[0]?.name : null,
        });
        await pool.query(
          `UPDATE leads SET whatsapp_welcome_sent = true WHERE id = $1`, [lead.id]
        );
      } catch (waErr) {
        console.error("[WhatsApp] createLead welcome message failed:", waErr.message);
      }
    });
    // ─────────────────────────────────────────────────────────────────────────

    return sendSuccess(res, "Lead created", {
      ...lead,
      call_recordings: savedRecordings,
      photos: savedPhotos,
    }, 201);
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
      `SELECT
         l.id, l.name, l.phone, l.alternate_phone_number, l.email,
         l.status, l.source, l.budget, l.location_preference,
         l.callback_time, l.next_followup_time, l.configuration,
         l.payment_proof_url, l.payment_proof_amount,
         l.project_id, l.project_name_text, l.assigned_to, l.is_converted, l.converted_at,
         l.created_at, l.updated_at,
         p.name AS project_name, p.city AS project_city, p.locality AS project_locality,
         CONCAT(u.first_name, ' ', u.last_name) AS assigned_name,
         u.phone_number AS assigned_phone,
         (SELECT COALESCE(json_agg(cr.* ORDER BY cr.created_at DESC), '[]')
          FROM call_recordings cr WHERE cr.lead_id = l.id) AS call_recordings,
         (SELECT COALESCE(json_agg(ph.* ORDER BY ph.created_at DESC), '[]')
          FROM lead_photos ph WHERE ph.lead_id = l.id) AS photos
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
        : lead.project_name_text
          ? { id: null, name: lead.project_name_text }
          : null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/leads/:id
 */
const updateLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { name, phone, alternate_phone_number, email, source,
            project_id, project_name,
            budget, location_preference, configuration,
            callback_time, next_followup_time, status,
            call_recordings, payment_proof_url, payment_proof_amount, photos } = req.body;

    // project_id takes precedence over project_name. Neither has to match an
    // existing project — if it doesn't, it's stored as free text instead
    // (project_name_text) rather than rejecting the request.
    let resolvedProjectId = undefined;
    let resolvedProjectNameText = undefined;
    if (project_id !== undefined) {
      try {
        resolvedProjectId = await resolveProjectId(project_id);
        resolvedProjectNameText = null; // clear any stored free-text name
      } catch (e) {
        resolvedProjectId = null;
        resolvedProjectNameText = String(project_id).trim();
      }
    } else if (project_name !== undefined) {
      const resolved = await resolveProjectName(project_name);
      resolvedProjectId = resolved.projectId;
      resolvedProjectNameText = resolved.projectNameText;
    }

    // status — validated the same way as PATCH /:id/status
    if (status !== undefined && !(await isValidLeadStatus(status))) {
      return next(new AppError(
        `Invalid status '${status}'. Use GET /api/v1/config/lead-statuses for the full list.`, 400
      ));
    }

    // Validate call_recordings / payment_proof / photos if provided
    let recordings = [];
    if (call_recordings) {
      recordings = Array.isArray(call_recordings) ? call_recordings : [call_recordings];
      for (const rec of recordings) {
        if (!rec.url) return next(new AppError('Each call_recording must have a url', 400));
      }
    }
    let photoItems = [];
    if (photos) {
      photoItems = Array.isArray(photos) ? photos : [photos];
      for (const ph of photoItems) {
        if (!ph.url) return next(new AppError('Each photo must have a url', 400));
      }
    }

    const existing = await pool.query(
      "SELECT id, assigned_to, phone, status, payment_proof_url FROM leads WHERE id = $1 AND is_archived = false", [id]
    );
    if (existing.rows.length === 0) return next(new AppError("Lead not found", 404));

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && existing.rows[0].assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    if (phone && phone !== existing.rows[0].phone) {
      const phoneUsage = await countLeadsByPhone(pool, phone, id);
      if (phoneUsage >= MAX_LEADS_PER_PHONE) {
        return next(new AppError(
          `This phone number has already been used for ${MAX_LEADS_PER_PHONE} leads. A phone number can be added at most ${MAX_LEADS_PER_PHONE} times.`, 400
        ));
      }
    }

    const updates = []; const params = []; let idx = 1;
    if (name)                         { updates.push(`name = $${idx++}`);                params.push(name.trim()); }
    if (phone)                        { updates.push(`phone = $${idx++}`);               params.push(phone); }
    if (alternate_phone_number !== undefined) { updates.push(`alternate_phone_number = $${idx++}`); params.push(alternate_phone_number); }
    if (email !== undefined)          { updates.push(`email = $${idx++}`);               params.push(email); }
    if (source)                       { updates.push(`source = $${idx++}`);              params.push(source); }
    if (resolvedProjectId !== undefined)       { updates.push(`project_id = $${idx++}`);        params.push(resolvedProjectId); }
    if (resolvedProjectNameText !== undefined) { updates.push(`project_name_text = $${idx++}`); params.push(resolvedProjectNameText); }
    if (budget)                       { updates.push(`budget = $${idx++}`);              params.push(budget); }
    if (location_preference)          { updates.push(`location_preference = $${idx++}`); params.push(location_preference); }
    if (configuration !== undefined)  { updates.push(`configuration = $${idx++}`);       params.push(configuration || null); }
    if (callback_time !== undefined)  { updates.push(`callback_time = $${idx++}`);       params.push(callback_time || null); }
    if (next_followup_time !== undefined) { updates.push(`next_followup_time = $${idx++}`); params.push(next_followup_time || null); }
    if (payment_proof_url !== undefined)    { updates.push(`payment_proof_url = $${idx++}`);    params.push(payment_proof_url || null); }
    if (payment_proof_amount !== undefined) { updates.push(`payment_proof_amount = $${idx++}`); params.push(payment_proof_amount || null); }
    if (status !== undefined)         { updates.push(`status = $${idx++}`);              params.push(status); }

    if (updates.length === 0 && recordings.length === 0 && photoItems.length === 0) {
      return next(new AppError("No fields to update", 400));
    }

    await client.query("BEGIN");

    let lead = existing.rows[0];
    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      params.push(id);
      const result = await client.query(
        `UPDATE leads SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`, params
      );
      lead = result.rows[0];

      if (status !== undefined && status !== existing.rows[0].status) {
        await logActivity(client, id, "status_change", `Status changed from ${existing.rows[0].status} to ${status}`, callerId);
      }
    }

    // Save any new call recordings
    const savedRecordings = [];
    if (recordings.length > 0) {
      for (const rec of recordings) {
        const recResult = await client.query(
          `INSERT INTO call_recordings (lead_id, url, phone_number, name, uploaded_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [id, rec.url, rec.phone_number || null, rec.name || null, callerId]
        );
        savedRecordings.push(recResult.rows[0]);
      }
      await logActivity(client, id, "call", `${recordings.length} call recording(s) attached`, callerId);
    }

    if (payment_proof_url !== undefined && payment_proof_url !== existing.rows[0].payment_proof_url) {
      await logActivity(client, id, "note", "Payment proof updated", callerId);
    }

    // Save any new photos
    const savedPhotos = [];
    if (photoItems.length > 0) {
      for (const ph of photoItems) {
        const photoResult = await client.query(
          `INSERT INTO lead_photos (lead_id, url, name, uploaded_by)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [id, ph.url, ph.name || null, callerId]
        );
        savedPhotos.push(photoResult.rows[0]);
      }
      await logActivity(client, id, "note", `${photoItems.length} photo(s) attached`, callerId);
    }

    await client.query("COMMIT");

    return sendSuccess(res, "Lead updated successfully", {
      ...lead,
      call_recordings: savedRecordings,
      photos: savedPhotos,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/v1/leads/:id/payment-proof
 * Fast, dedicated endpoint to set/update just the payment proof + amount on
 * a lead — same fields already supported by the full PUT /:id, just without
 * needing to resend the whole lead body.
 */
const updateLeadPaymentProof = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { payment_proof_url, payment_proof_amount } = req.body;

    if (payment_proof_url === undefined && payment_proof_amount === undefined) {
      return next(new AppError('Provide payment_proof_url and/or payment_proof_amount', 400));
    }

    const existing = await pool.query(
      "SELECT id, assigned_to, payment_proof_url FROM leads WHERE id = $1 AND is_archived = false", [id]
    );
    if (existing.rows.length === 0) return next(new AppError("Lead not found", 404));

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && existing.rows[0].assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    const finalProofUrl = payment_proof_url !== undefined ? payment_proof_url : existing.rows[0].payment_proof_url;
    if (payment_proof_amount !== undefined && payment_proof_amount && !finalProofUrl) {
      return next(new AppError('payment_proof_url is required when payment_proof_amount is provided', 400));
    }

    const updates = []; const params = []; let idx = 1;
    if (payment_proof_url !== undefined)    { updates.push(`payment_proof_url = $${idx++}`);    params.push(payment_proof_url || null); }
    if (payment_proof_amount !== undefined) { updates.push(`payment_proof_amount = $${idx++}`); params.push(payment_proof_amount || null); }
    updates.push(`updated_at = NOW()`);
    params.push(id);

    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE leads SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`, params
    );

    if (payment_proof_url !== undefined && payment_proof_url !== existing.rows[0].payment_proof_url) {
      await logActivity(client, id, "note", "Payment proof updated", callerId);
    }

    await client.query("COMMIT");

    return sendSuccess(res, "Payment proof updated successfully", result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
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
    await pool.query("DELETE FROM leads WHERE id = $1", [id]);
    return sendSuccess(res, "Lead deleted successfully");
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/leads/:id/status
 * Email → Internal: Status change detail  |  Client: Friendly update
 */
const updateLeadStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    if (!status) return next(new AppError('status is required', 400));

    // Validate against system statuses OR custom statuses in DB
    if (!(await isValidLeadStatus(status))) {
      return next(new AppError(
        `Invalid status '${status}'. Use GET /api/v1/config/lead-statuses for the full list.`, 400
      ));
    }

    const existing = await pool.query(
      "SELECT id, status, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]
    );
    if (existing.rows.length === 0) return next(new AppError("Lead not found", 404));

    const oldStatus = existing.rows[0].status;
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

    // Keep the site_visits row in sync — the monthly Target feature counts
    // site_visits.status = 'done' independently of leads.status, so without
    // this a lead marked "Site Visit Done" here never counts toward target.
    if (status === 'site_visit_done') {
      await client.query(
        `UPDATE site_visits
         SET status = 'done', updated_at = NOW()
         WHERE id = (
           SELECT id FROM site_visits
           WHERE lead_id = $1 AND status IN ('scheduled', 'rescheduled')
           ORDER BY visit_date DESC, created_at DESC
           LIMIT 1
         )`,
        [id]
      );
    }

    await client.query("COMMIT");

    // ── Push + in-app notifications ───────────────────────────────────────────
    setImmediate(async () => {
      try {
        const lead = existing.rows[0];
        const isBooked = status === 'booked';

        // Notify assigned exec
        if (lead.assigned_to) {
          await createNotification(lead.assigned_to, {
            type:           'lead_status_changed',
            title:          isBooked ? '🎉 Lead Booked!' : 'Lead Status Updated',
            message:        `Lead status changed from ${oldStatus} to ${status}`,
            reference_id:   id,
            reference_type: 'lead',
            metadata:       { old_status: oldStatus, new_status: status },
          });
          // Notify their manager
          const mgrRow = await pool.query(
            `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [lead.assigned_to]
          );
          if (mgrRow.rows.length) {
            await createNotification(mgrRow.rows[0].manager_id, {
              type:           isBooked ? 'booking_new' : 'lead_status_changed',
              title:          isBooked ? 'Lead Booked by Your Team' : 'Lead Status Changed',
              message:        isBooked
                ? `A lead in your team was booked`
                : `Lead status changed from ${oldStatus} to ${status}`,
              reference_id:   id,
              reference_type: 'lead',
              metadata:       { old_status: oldStatus, new_status: status },
            });
          }
        }

        // Notify all admins
        await notifyAdmins({
          type:           isBooked ? 'booking_new' : 'lead_status_changed',
          title:          isBooked ? 'New Booking Confirmed' : 'Lead Status Changed',
          message:        isBooked
            ? `A lead has been booked`
            : `Lead status changed from ${oldStatus} to ${status}`,
          reference_id:   id,
          reference_type: 'lead',
          metadata:       { old_status: oldStatus, new_status: status },
        });
      } catch (notifErr) {
        console.error('[Notification] updateLeadStatus failed:', notifErr.message);
      }
    });

    // NOTE: the "lead status changed" email (notifyLeadStatusChanged) was
    // removed on purpose.

    // ── 📱 WhatsApp — only for the two client-meaningful statuses below.
    // 'site_visit_scheduled' and 'booked' are deliberately NOT covered here —
    // they're handled by the dedicated Site Visit / Closure WhatsApp messages
    // instead, to avoid sending the client two messages for the same event.
    // 'lost' is deliberately NOT covered — kept internal-only.
    if (['interested', 'negotiation'].includes(status)) {
      setImmediate(async () => {
        try {
          const fullLead = await fetchLeadWithProject(id);
          if (!fullLead) return;

          const sentFlagCol = status === 'interested' ? 'whatsapp_interested_sent' : 'whatsapp_negotiation_sent';
          const alreadySentRow = await pool.query(
            `SELECT ${sentFlagCol} AS sent FROM leads WHERE id = $1`, [id]
          );
          if (alreadySentRow.rows[0]?.sent) return; // already sent for this status once before

          if (status === 'interested') {
            await whatsappService.sendLeadStatusInterested({
              leadName:    fullLead.name,
              leadPhone:   fullLead.phone,
              projectName: fullLead.project_name,
            });
          } else {
            await whatsappService.sendLeadStatusNegotiation({
              leadName:    fullLead.name,
              leadPhone:   fullLead.phone,
              projectName: fullLead.project_name,
            });
          }

          await pool.query(
            `UPDATE leads SET ${sentFlagCol} = true WHERE id = $1`, [id]
          );
        } catch (waErr) {
          console.error("[WhatsApp] updateLeadStatus message failed:", waErr.message);
        }
      });
    }
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
 * Email → Internal only: Lead assigned to executive
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

    if (!sameAssignee) {
      setImmediate(async () => {
        try {
          // Push: notify new assignee
          await createNotification(assigned_to, {
            type:           'lead_assigned',
            title:          'Lead Assigned to You',
            message:        `A lead has been assigned to you`,
            reference_id:   id,
            reference_type: 'lead',
            metadata:       { lead_id: id, assigned_by: callerId },
          });

          // Push: notify old assignee if there was one
          if (prevAssignee) {
            await createNotification(prevAssignee, {
              type:           'lead_assigned',
              title:          'Lead Reassigned',
              message:        `A lead has been reassigned away from you`,
              reference_id:   id,
              reference_type: 'lead',
              metadata:       { lead_id: id },
            });
          }

          // Push: notify manager of new assignee
          if (assignee.manager_id) {
            await createNotification(assignee.manager_id, {
              type:           'lead_assigned',
              title:          'Lead Assigned to Your Team',
              message:        `A lead was assigned to ${assignee.first_name} ${assignee.last_name}`,
              reference_id:   id,
              reference_type: 'lead',
              metadata:       { lead_id: id, assigned_to },
            });
          }

          // Push: notify admins
          await notifyAdmins({
            type:           'lead_assigned',
            title:          'Lead Assignment Updated',
            message:        `A lead was assigned to ${assignee.first_name} ${assignee.last_name}`,
            reference_id:   id,
            reference_type: 'lead',
            metadata:       { lead_id: id, assigned_to },
          });

          // Email (existing)
          const fullLead    = await fetchLeadWithProject(id);
          if (!fullLead) return;
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
        } catch (err) {
          console.error("[Notification/Email] assignLead failed:", err.message);
        }
      });
    }

    return sendSuccess(res, `Lead assigned to ${assignee.first_name} ${assignee.last_name}`);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/v1/leads/:id/convert
 *
 * Manual lead-to-booking conversion.
 *
 * Automatic path: status set to "booked" via updateLeadStatus → booking email fires
 * Manual path:    this endpoint → sets status = booked, is_converted = true,
 *                 records booking_amount, optionally inserts into bookings table
 *
 * Body (all optional):
 *   { note, booking_amount, project_id }
 *
 * Email → Internal: Booking confirmed (CRM detail)
 *         Client:   Congratulations email
 */
const convertLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { note, booking_amount, project_id: overrideProjectId } = req.body;

    // Resolve project_id if provided (accepts UUID or name)
    const resolvedProjectId = overrideProjectId !== undefined ? await resolveProjectId(overrideProjectId) : undefined;

    const leadRow = await pool.query(
      `SELECT
         l.id, l.status, l.assigned_to, l.is_converted,
         l.email AS lead_email,
         l.name, l.phone, l.budget, l.location_preference, l.project_id,
         p.name AS project_name,
         CONCAT(u.first_name,' ',u.last_name) AS assigned_name,
         u.email AS assigned_email
       FROM leads l
       LEFT JOIN projects p ON p.id = l.project_id
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id = $1 AND l.is_archived = false`,
      [id]
    );
    if (leadRow.rows.length === 0) return next(new AppError("Lead not found", 404));

    const lead = { ...leadRow.rows[0], email: leadRow.rows[0].lead_email };

    if (lead.is_converted) {
      return next(new AppError("This lead has already been converted", 400));
    }

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && lead.assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    const oldStatus = lead.status;

    await client.query("BEGIN");
    
    const finalProjectId = resolvedProjectId !== undefined ? resolvedProjectId : lead.project_id;
    await client.query(
      `UPDATE leads
       SET status       = 'booked',
           is_converted = true,
           converted_at = NOW(),
           project_id   = COALESCE($1, project_id),
           updated_at   = NOW()
       WHERE id = $2`,
      [finalProjectId, id]
    );

    await logActivity(
      client, id, "status_change",
      note || `Lead manually converted to booking${booking_amount ? ` — Amount: ₹${booking_amount}` : ""}`,
      callerId
    );

    // Insert into bookings table if it exists
    const { rows: [{ exists: bookingsExists }] } = await client.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables WHERE table_name = 'bookings'
       ) AS exists`
    );
    if (bookingsExists) {
      await client.query(
        `INSERT INTO bookings (lead_id, project_id, booking_amount, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lead_id) DO UPDATE SET booking_amount = EXCLUDED.booking_amount`,
        [id, finalProjectId, booking_amount || null, callerId]
      );
    }

    await client.query("COMMIT");

    // ── Push + in-app notifications ───────────────────────────────────────────
    setImmediate(async () => {
      try {
        // Notify assigned exec
        if (lead.assigned_to) {
          await createNotification(lead.assigned_to, {
            type:           'booking_new',
            title:          '🎉 Lead Booked!',
            message:        `Lead "${lead.name}" has been converted to a booking`,
            reference_id:   id,
            reference_type: 'lead',
            metadata:       { lead_id: id, booking_amount: booking_amount || null },
          });
          // Notify their manager
          const mgrRow = await pool.query(
            `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [lead.assigned_to]
          );
          if (mgrRow.rows.length) {
            await createNotification(mgrRow.rows[0].manager_id, {
              type:           'booking_new',
              title:          'New Booking by Your Team',
              message:        `Lead "${lead.name}" was booked by your executive`,
              reference_id:   id,
              reference_type: 'lead',
              metadata:       { lead_id: id },
            });
          }
        }
        // Notify admins
        await notifyAdmins({
          type:           'booking_new',
          title:          'New Booking Confirmed',
          message:        `Lead "${lead.name}" has been converted to a booking${booking_amount ? ` — ₹${Number(booking_amount).toLocaleString('en-IN')}` : ''}`,
          reference_id:   id,
          reference_type: 'lead',
          metadata:       { lead_id: id, booking_amount: booking_amount || null },
        });
      } catch (notifErr) {
        console.error('[Notification] convertLead failed:', notifErr.message);
      }
    });

    // NOTE: the "lead status changed" email (notifyLeadStatusChanged) was
    // removed on purpose.

    return sendSuccess(res, "Lead successfully converted to booking", {
      id,
      status:       "booked",
      is_converted: true,
      converted_at: new Date().toISOString(),
    });
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

    const lead = await pool.query(
      "SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]
    );
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
 * GET /api/v1/leads/:id/notes
 * Returns only the "note" type entries from the lead's activity log.
 */
const getLeadNotes = async (req, res, next) => {
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
       WHERE la.lead_id = $1 AND la.type = 'note'
       ORDER BY la.created_at DESC`,
      [id]
    );
    return sendSuccess(res, "Notes fetched", result.rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/leads/:id/notes
 * Adds a note — stored in lead_activities (type = 'note'), so it also
 * shows up in the lead's activity log (GET /:id/activity).
 */
const addLeadNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    if (!note) return next(new AppError("note is required", 400));

    const lead = await pool.query(
      "SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [id]
    );
    if (lead.rows.length === 0) return next(new AppError("Lead not found", 404));

    const { role, id: callerId } = req.user;
    if (role === "sales_executive" && lead.rows[0].assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    const result = await pool.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3) RETURNING *`,
      [id, note, callerId]
    );
    return sendSuccess(res, "Note added successfully", result.rows[0], 201);
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

/**
 * POST /api/v1/leads/:id/send-whatsapp
 * Sends a project details WhatsApp message to the lead's phone number via
 * Meta's WhatsApp Cloud API (same provider/credentials as whatsappService.js —
 * NOT a generic free-text API; uses the approved 'lead_project_details' template).
 * Mirrors sendLeadEmail's structure and logs an identical activity entry.
 */
const sendLeadWhatsapp = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { project_id } = req.body;
    const { role, id: callerId } = req.user;

    const leadResult = await pool.query(
      `SELECT l.id, l.name, l.phone, l.assigned_to,
              p.name AS project_name, p.city AS project_city,
              p.locality AS project_locality, p.price_range, p.configurations
       FROM leads l
       LEFT JOIN projects p ON p.id = COALESCE($2::uuid, l.project_id)
       WHERE l.id = $1 AND l.is_archived = false`,
      [id, project_id || null]
    );

    if (leadResult.rows.length === 0) return next(new AppError("Lead not found", 404));
    const lead = leadResult.rows[0];

    if (role === "sales_executive" && lead.assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    if (!lead.phone) {
      return next(new AppError("This lead does not have a phone number on record", 400));
    }

    // Send via the real Meta WhatsApp Cloud API (approved template — not free text)
    let whatsappSent = false;
    let sendError    = null;
    try {
      const result = await whatsappService.sendLeadProjectDetailsWhatsapp({
        leadName:    lead.name,
        leadPhone:   lead.phone,
        projectName: lead.project_name,
        projectCity: lead.project_city,
        priceRange:  lead.price_range,
      });
      whatsappSent = !!result; // null means credentials weren't configured, or the API call failed silently above the catch
    } catch (waErr) {
      sendError = waErr.message;
      console.error("[WhatsApp] sendLeadWhatsapp failed:", waErr.message);
    }

    // Log the activity regardless of send outcome — same pattern as sendLeadEmail
    const activityNote = whatsappSent
      ? `Project details WhatsApp message sent${lead.project_name ? ` for ${lead.project_name}` : ""}`
      : `Project details WhatsApp message attempted but failed${sendError ? ` (${sendError})` : ""}`;

    await pool.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, 'whatsapp', $2, $3)`,
      [id, activityNote, callerId]
    );

    return sendSuccess(res, whatsappSent
      ? "Project details sent via WhatsApp and activity logged"
      : "WhatsApp send failed, but the attempt was logged", {
      lead_id:         id,
      phone:           lead.phone,
      project:         lead.project_name || null,
      whatsapp_sent:   whatsappSent,
      activity_logged: true,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/leads/:id/send-email
 * Sends a project details email to the lead's email address
 * and logs an email activity entry.
 */
const sendLeadEmail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { project_id, message } = req.body;
    const { role, id: callerId } = req.user;

    const leadResult = await pool.query(
      `SELECT l.id, l.name, l.phone, l.email, l.assigned_to, l.budget,
              l.location_preference,
              p.id   AS project_id,   p.name  AS project_name,
              p.city AS project_city, p.locality AS project_locality,
              p.price_range, p.configurations, p.rera_number,
              p.possession_date, p.description
       FROM leads l
       LEFT JOIN projects p ON p.id = COALESCE($2::uuid, l.project_id)
       WHERE l.id = $1 AND l.is_archived = false`,
      [id, project_id || null]
    );

    if (leadResult.rows.length === 0) return next(new AppError("Lead not found", 404));
    const lead = leadResult.rows[0];

    if (role === "sales_executive" && lead.assigned_to !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    if (!lead.email) {
      return next(new AppError("This lead does not have an email address on record", 400));
    }

    // Build and send the email via existing emailService infrastructure
    await emailService.sendLeadProjectDetails({
      lead,
      customMessage: message || null,
    });

    // Log the activity
    const activityNote = message
      ? `Project details email sent with custom message: "${message}"`
      : `Project details email sent${lead.project_name ? ` for ${lead.project_name}` : ""}`;

    await pool.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, 'email', $2, $3)`,
      [id, activityNote, callerId]
    );

    return sendSuccess(res, "Project details emailed to lead and activity logged", {
      lead_id:        id,
      email_sent_to:  lead.email,
      project:        lead.project_name || null,
      activity_logged: true,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * ─── CALL RECORDINGS ──────────────────────────────────────────────────────────
 *
 * Each lead can have multiple call recordings.
 * Every recording stores: file URL, phone_number, name (label), file size.
 *
 * Endpoints:
 *   POST   /api/v1/leads/:id/call-recordings        → upload file OR pass URL array
 *   GET    /api/v1/leads/:id/call-recordings        → list all recordings for a lead
 *   PATCH  /api/v1/leads/:id/call-recordings/:rid   → update name / phone_number
 *   DELETE /api/v1/leads/:id/call-recordings/:rid   → delete one recording
 */

// ─── POST /api/v1/leads/:id/call-recordings ───────────────────────────────────
// Mode 1 — File upload (multipart/form-data):
//   field: voice_recording (required)
//   body:  phone_number (optional), name (optional)
//
// Mode 2 — JSON body (recording URL already exists, e.g. from phone system):
//   body: { call_recording: [{ url, phone_number, name }] }
//   or    { call_recording: { url, phone_number, name } }  (single object also accepted)
const addCallRecording = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: callerId } = req.user;

    const leadChk = await pool.query(
      'SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false', [id]
    );
    if (!leadChk.rows.length) return next(new AppError('Lead not found', 404));
    const lead = leadChk.rows[0];
    if (role === 'sales_executive' && lead.assigned_to !== callerId) {
      return next(new AppError('Access denied', 403));
    }

    const inserted = [];

    // ── Mode 1: File upload ──────────────────────────────────────────────────
    if (req.file) {
      const { phone_number, name } = req.body;
      const fileUrl  = `/uploads/leads/voice/${req.file.filename}`;
      const fileName = name || req.file.originalname;
      const fileSize = req.file.size || null;

      const result = await pool.query(
        `INSERT INTO call_recordings (lead_id, url, phone_number, name, file_size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, fileUrl, phone_number || null, fileName, fileSize, callerId]
      );
      inserted.push(result.rows[0]);

      await pool.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, 'call', $2, $3)`,
        [id, `Call recording uploaded: ${fileName}${phone_number ? ` (${phone_number})` : ''}`, callerId]
      );
    }

    // ── Mode 2: JSON URL array ───────────────────────────────────────────────
    else if (req.body.call_recording) {
      let recordings = req.body.call_recording;
      if (!Array.isArray(recordings)) recordings = [recordings];
      if (!recordings.length) return next(new AppError('call_recording array cannot be empty', 400));

      for (const rec of recordings) {
        if (!rec.url) return next(new AppError('Each recording must have a url', 400));
        const result = await pool.query(
          `INSERT INTO call_recordings (lead_id, url, phone_number, name, uploaded_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [id, rec.url, rec.phone_number || null, rec.name || null, callerId]
        );
        inserted.push(result.rows[0]);
      }

      await pool.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, 'call', $2, $3)`,
        [id, `${inserted.length} call recording(s) added`, callerId]
      );
    } else {
      return next(new AppError('Provide either a voice_recording file or call_recording JSON', 400));
    }

    return sendSuccess(res, `${inserted.length} call recording(s) saved`, {
      lead_id: id, recordings: inserted,
    }, 201);
  } catch (err) { next(err); }
};

// ─── GET /api/v1/leads/:id/call-recordings ────────────────────────────────────
const getCallRecordings = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: callerId } = req.user;

    const leadChk = await pool.query(
      'SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false', [id]
    );
    if (!leadChk.rows.length) return next(new AppError('Lead not found', 404));
    const lead = leadChk.rows[0];
    if (role === 'sales_executive' && lead.assigned_to !== callerId) {
      return next(new AppError('Access denied', 403));
    }

    const result = await pool.query(
      `SELECT cr.*, CONCAT(u.first_name,' ',u.last_name) AS uploaded_by_name
       FROM call_recordings cr
       LEFT JOIN users u ON u.id = cr.uploaded_by
       WHERE cr.lead_id = $1
       ORDER BY cr.created_at DESC`,
      [id]
    );

    return sendSuccess(res, 'Call recordings fetched', {
      lead_id: id, total: result.rows.length, recordings: result.rows,
    });
  } catch (err) { next(err); }
};

// ─── PATCH /api/v1/leads/:id/call-recordings/:rid ────────────────────────────
// Update name and/or phone_number of an existing recording
const updateCallRecording = async (req, res, next) => {
  try {
    const { id, rid } = req.params;
    const { role, id: callerId } = req.user;
    const { name, phone_number } = req.body;

    const leadChk = await pool.query(
      'SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false', [id]
    );
    if (!leadChk.rows.length) return next(new AppError('Lead not found', 404));
    const lead = leadChk.rows[0];
    if (role === 'sales_executive' && lead.assigned_to !== callerId) {
      return next(new AppError('Access denied', 403));
    }

    const recChk = await pool.query(
      'SELECT * FROM call_recordings WHERE id = $1 AND lead_id = $2', [rid, id]
    );
    if (!recChk.rows.length) return next(new AppError('Recording not found', 404));

    const updates = []; const params = []; let idx = 1;
    if (name         !== undefined) { updates.push(`name = $${idx++}`);         params.push(name); }
    if (phone_number !== undefined) { updates.push(`phone_number = $${idx++}`); params.push(phone_number); }
    if (!updates.length) return next(new AppError('Provide name or phone_number to update', 400));

    updates.push('updated_at = NOW()');
    params.push(rid, id);

    const result = await pool.query(
      `UPDATE call_recordings SET ${updates.join(', ')}
       WHERE id = $${idx++} AND lead_id = $${idx++} RETURNING *`,
      params
    );

    return sendSuccess(res, 'Recording updated', result.rows[0]);
  } catch (err) { next(err); }
};

// ─── DELETE /api/v1/leads/:id/call-recordings/:rid ───────────────────────────
const deleteCallRecording = async (req, res, next) => {
  try {
    const { id, rid } = req.params;
    const { role, id: callerId } = req.user;

    const leadChk = await pool.query(
      'SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false', [id]
    );
    if (!leadChk.rows.length) return next(new AppError('Lead not found', 404));
    const lead = leadChk.rows[0];
    if (role === 'sales_executive' && lead.assigned_to !== callerId) {
      return next(new AppError('Access denied', 403));
    }

    const recChk = await pool.query(
      'SELECT * FROM call_recordings WHERE id = $1 AND lead_id = $2', [rid, id]
    );
    if (!recChk.rows.length) return next(new AppError('Recording not found', 404));
    const rec = recChk.rows[0];

    // Delete physical file only if it was uploaded locally
    if (rec.url && rec.url.startsWith('/uploads/')) {
      const filePath = path.join(process.cwd(), rec.url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await pool.query('DELETE FROM call_recordings WHERE id = $1', [rid]);

    await pool.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, 'note', $2, $3)`,
      [id, `Call recording deleted: ${rec.name || rec.url}`, callerId]
    );

    return sendSuccess(res, 'Recording deleted');
  } catch (err) { next(err); }
};

// Payment proof is now a single flat pair of columns directly on the lead
// (payment_proof_url, payment_proof_amount) — set via POST/PUT on the lead
// itself. See createLead / updateLead. No separate CRUD endpoints needed.

/**
 * ─── LEAD PHOTOS ───────────────────────────────────────────────────────────────
 *
 * Front-page form photo — separate from payment proof (different purpose,
 * different table). Same shape/flow as call recordings.
 *
 * Endpoints:
 *   POST   /api/v1/leads/upload-photo          → upload file, get url (use in create/update)
 *   POST   /api/v1/leads/:id/photos            → attach (file upload OR url array)
 *   GET    /api/v1/leads/:id/photos            → list all photos for a lead
 *   PATCH  /api/v1/leads/:id/photos/:pid       → update name
 *   DELETE /api/v1/leads/:id/photos/:pid       → delete one photo
 */

// ─── POST /api/v1/leads/upload-photo ──────────────────────────────────────────
// Standalone file upload — returns { url, filename, size }
// Field name: photo
const uploadPhotoFile = async (req, res, next) => {
  try {
    if (!req.file) return next(new AppError('No file uploaded. Use field name: photo', 400));

    return sendSuccess(res, 'File uploaded successfully', {
      url:      `/uploads/leads/photos/${req.file.filename}`,
      filename: req.file.originalname,
      size:     req.file.size || null,
    }, 201);
  } catch (err) { next(err); }
};

// ─── POST /api/v1/leads/:id/photos ────────────────────────────────────────────
// Mode 1 — File upload (multipart/form-data): field photo (required), body: name (optional)
// Mode 2 — JSON body: { photos: [{ url, name }] } (single object also accepted)
const addPhoto = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: callerId } = req.user;

    const leadChk = await pool.query(
      'SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false', [id]
    );
    if (!leadChk.rows.length) return next(new AppError('Lead not found', 404));
    const lead = leadChk.rows[0];
    if (role === 'sales_executive' && lead.assigned_to !== callerId) {
      return next(new AppError('Access denied', 403));
    }

    const inserted = [];

    // ── Mode 1: File upload ──────────────────────────────────────────────────
    if (req.file) {
      const { name } = req.body;
      const fileUrl  = `/uploads/leads/photos/${req.file.filename}`;
      const fileName = name || req.file.originalname;

      const result = await pool.query(
        `INSERT INTO lead_photos (lead_id, url, name, file_size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, fileUrl, fileName, req.file.size || null, callerId]
      );
      inserted.push(result.rows[0]);

      await pool.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, 'note', $2, $3)`,
        [id, `Photo uploaded: ${fileName}`, callerId]
      );
    }

    // ── Mode 2: JSON URL array ───────────────────────────────────────────────
    else if (req.body.photos) {
      let items = req.body.photos;
      if (!Array.isArray(items)) items = [items];
      if (!items.length) return next(new AppError('photos array cannot be empty', 400));

      for (const ph of items) {
        if (!ph.url) return next(new AppError('Each photo must have a url', 400));
        const result = await pool.query(
          `INSERT INTO lead_photos (lead_id, url, name, uploaded_by)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [id, ph.url, ph.name || null, callerId]
        );
        inserted.push(result.rows[0]);
      }

      await pool.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, 'note', $2, $3)`,
        [id, `${inserted.length} photo(s) added`, callerId]
      );
    } else {
      return next(new AppError('Provide either a photo file or photos JSON', 400));
    }

    return sendSuccess(res, `${inserted.length} photo(s) saved`, {
      lead_id: id, photos: inserted,
    }, 201);
  } catch (err) { next(err); }
};

// ─── GET /api/v1/leads/:id/photos ─────────────────────────────────────────────
const getPhotos = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: callerId } = req.user;

    const leadChk = await pool.query(
      'SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false', [id]
    );
    if (!leadChk.rows.length) return next(new AppError('Lead not found', 404));
    const lead = leadChk.rows[0];
    if (role === 'sales_executive' && lead.assigned_to !== callerId) {
      return next(new AppError('Access denied', 403));
    }

    const result = await pool.query(
      `SELECT lp.*, CONCAT(u.first_name,' ',u.last_name) AS uploaded_by_name
       FROM lead_photos lp
       LEFT JOIN users u ON u.id = lp.uploaded_by
       WHERE lp.lead_id = $1
       ORDER BY lp.created_at DESC`,
      [id]
    );

    return sendSuccess(res, 'Photos fetched', {
      lead_id: id, total: result.rows.length, photos: result.rows,
    });
  } catch (err) { next(err); }
};

// ─── PATCH /api/v1/leads/:id/photos/:pid ─────────────────────────────────────
const updatePhoto = async (req, res, next) => {
  try {
    const { id, pid } = req.params;
    const { role, id: callerId } = req.user;
    const { name } = req.body;

    const leadChk = await pool.query(
      'SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false', [id]
    );
    if (!leadChk.rows.length) return next(new AppError('Lead not found', 404));
    const lead = leadChk.rows[0];
    if (role === 'sales_executive' && lead.assigned_to !== callerId) {
      return next(new AppError('Access denied', 403));
    }

    const photoChk = await pool.query(
      'SELECT * FROM lead_photos WHERE id = $1 AND lead_id = $2', [pid, id]
    );
    if (!photoChk.rows.length) return next(new AppError('Photo not found', 404));

    if (name === undefined) return next(new AppError('Provide name to update', 400));

    const result = await pool.query(
      `UPDATE lead_photos SET name = $1, updated_at = NOW() WHERE id = $2 AND lead_id = $3 RETURNING *`,
      [name, pid, id]
    );

    return sendSuccess(res, 'Photo updated', result.rows[0]);
  } catch (err) { next(err); }
};

// ─── DELETE /api/v1/leads/:id/photos/:pid ────────────────────────────────────
const deletePhoto = async (req, res, next) => {
  try {
    const { id, pid } = req.params;
    const { role, id: callerId } = req.user;

    const leadChk = await pool.query(
      'SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false', [id]
    );
    if (!leadChk.rows.length) return next(new AppError('Lead not found', 404));
    const lead = leadChk.rows[0];
    if (role === 'sales_executive' && lead.assigned_to !== callerId) {
      return next(new AppError('Access denied', 403));
    }

    const photoChk = await pool.query(
      'SELECT * FROM lead_photos WHERE id = $1 AND lead_id = $2', [pid, id]
    );
    if (!photoChk.rows.length) return next(new AppError('Photo not found', 404));
    const photo = photoChk.rows[0];

    // Delete physical file only if it was uploaded locally
    if (photo.url && photo.url.startsWith('/uploads/')) {
      const filePath = path.join(process.cwd(), photo.url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await pool.query('DELETE FROM lead_photos WHERE id = $1', [pid]);

    await pool.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1, 'note', $2, $3)`,
      [id, `Photo deleted: ${photo.name || photo.url}`, callerId]
    );

    return sendSuccess(res, 'Photo deleted');
  } catch (err) { next(err); }
};


module.exports = {
  getAllLeads,
  createLead,
  getLeadById,
  updateLead,
  updateLeadPaymentProof,
  deleteLead,
  updateLeadStatus,
  assignLead,
  convertLead,
  getLeadActivity,
  addLeadActivity,
  getLeadNotes,
  addLeadNote,
  getLeadSources,
  sendLeadWhatsapp,
  sendLeadEmail,
  uploadRecordingFile,
  addCallRecording,
  getCallRecordings,
  updateCallRecording,
  deleteCallRecording,
  uploadPhotoFile,
  addPhoto,
  getPhotos,
  updatePhoto,
  deletePhoto,
};