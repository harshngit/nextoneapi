const { pool } = require("../config/db");
const { sendSuccess, sendError, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");

// ─── Constants ────────────────────────────────────────────────
const CONFIGURABLE_ROLES = ["admin", "sales_manager", "sales_executive", "external_caller"];
const MODULES = ["leads", "projects", "site_visits", "tasks", "users", "reports"];
const PERMISSION_KEYS = ["view", "create", "edit", "delete"];

const MODULE_META = [
  { key: "leads",       display_name: "Lead Management",         description: "Create, assign, and track leads through the sales lifecycle" },
  { key: "projects",    display_name: "Project Management",       description: "Manage real estate projects and map leads to them" },
  { key: "site_visits", display_name: "Site Visit Management",    description: "Schedule, track, and capture feedback for site visits" },
  { key: "tasks",       display_name: "Follow-Up & Tasks",        description: "Create and manage follow-up tasks with reminders" },
  { key: "users",       display_name: "User & Team Management",   description: "Manage users, roles, and team hierarchy" },
  { key: "reports",     display_name: "Dashboard & Reports",      description: "View analytics, conversion reports, and team performance" },
];

// Helper — write to audit log
const writeAudit = async (client, { action, description, performed_by, target_user_id = null, metadata = {} }) => {
  await client.query(
    `INSERT INTO audit_logs (action, description, performed_by, target_user_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [action, description, performed_by, target_user_id, JSON.stringify(metadata)]
  );
};

// ─── Controllers ──────────────────────────────────────────────

/**
 * GET /api/v1/config/roles
 */
const getRoles = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT role, display_name, permissions FROM role_permissions ORDER BY
       CASE role
         WHEN 'admin'            THEN 1
         WHEN 'sales_manager'    THEN 2
         WHEN 'sales_executive'  THEN 3
         WHEN 'external_caller'  THEN 4
       END`
    );
    return sendSuccess(res, "Roles and permissions fetched", result.rows);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/config/roles/:role
 */
const updateRolePermissions = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { role } = req.params;
    const { permissions } = req.body;
    const { role: callerRole, id: callerId } = req.user;

    if (!CONFIGURABLE_ROLES.includes(role)) {
      return next(new AppError(`Invalid role. Configurable roles: ${CONFIGURABLE_ROLES.join(", ")}`, 400));
    }
    // Admin cannot update admin permissions — only super_admin can
    if (role === "admin" && callerRole !== "super_admin") {
      return next(new AppError("Only Super Admin can update admin permissions", 403));
    }
    if (!permissions || typeof permissions !== "object") {
      return next(new AppError("permissions object is required", 400));
    }

    // Validate permission structure
    for (const [module, perms] of Object.entries(permissions)) {
      if (!MODULES.includes(module)) {
        return next(new AppError(`Invalid module: ${module}. Valid: ${MODULES.join(", ")}`, 400));
      }
      for (const key of Object.keys(perms)) {
        if (!PERMISSION_KEYS.includes(key)) {
          return next(new AppError(`Invalid permission key: ${key}. Valid: ${PERMISSION_KEYS.join(", ")}`, 400));
        }
        if (typeof perms[key] !== "boolean") {
          return next(new AppError(`Permission values must be boolean`, 400));
        }
      }
    }

    // Fetch existing to preserve unmodified modules
    const existing = await pool.query("SELECT permissions FROM role_permissions WHERE role = $1", [role]);
    const currentPerms = existing.rows.length > 0 ? existing.rows[0].permissions : {};
    const mergedPerms = { ...currentPerms, ...permissions };

    await client.query("BEGIN");
    const result = await pool.query(
      `INSERT INTO role_permissions (role, permissions)
       VALUES ($1, $2)
       ON CONFLICT (role) DO UPDATE SET permissions = $2, updated_at = NOW()
       RETURNING role, permissions, updated_at`,
      [role, JSON.stringify(mergedPerms)]
    );

    await writeAudit(client, {
      action: "permission_update",
      description: `Permissions updated for role: ${role}`,
      performed_by: callerId,
      metadata: { role, permissions: mergedPerms },
    });

    await client.query("COMMIT");
    return sendSuccess(res, `Permissions updated for ${role}`, result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/config/lead-sources
 */
const getLeadSources = async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, is_active, created_at FROM lead_sources ORDER BY name ASC"
    );
    return sendSuccess(res, "Lead sources fetched", result.rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/config/lead-sources
 */
const createLeadSource = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return next(new AppError("name is required", 400));

    const existing = await pool.query(
      "SELECT id FROM lead_sources WHERE LOWER(name) = LOWER($1)",
      [name.trim()]
    );
    if (existing.rows.length > 0) {
      return next(new AppError(`Lead source '${name.trim()}' already exists`, 400));
    }

    await client.query("BEGIN");
    const result = await client.query(
      "INSERT INTO lead_sources (name) VALUES ($1) RETURNING *",
      [name.trim()]
    );
    await writeAudit(client, {
      action: "lead_source_change",
      description: `Lead source added: ${name.trim()}`,
      performed_by: req.user.id,
      metadata: { action: "create", name: name.trim() },
    });
    await client.query("COMMIT");

    return sendSuccess(res, "Lead source added successfully", result.rows[0], 201);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PUT /api/v1/config/lead-sources/:id
 */
const updateLeadSource = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { name, is_active } = req.body;

    const existing = await pool.query("SELECT * FROM lead_sources WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Lead source not found", 404));

    if (name) {
      const dupe = await pool.query(
        "SELECT id FROM lead_sources WHERE LOWER(name) = LOWER($1) AND id != $2",
        [name.trim(), id]
      );
      if (dupe.rows.length > 0) return next(new AppError(`Lead source '${name}' already exists`, 400));
    }

    const updates = []; const params = []; let idx = 1;
    if (name !== undefined)      { updates.push(`name = $${idx++}`);      params.push(name.trim()); }
    if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); params.push(is_active); }
    if (updates.length === 0) return next(new AppError("No fields to update", 400));
    updates.push(`updated_at = NOW()`);
    params.push(id);

    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE lead_sources SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );
    await writeAudit(client, {
      action: "lead_source_change",
      description: `Lead source updated: ${existing.rows[0].name}${name ? ` → ${name}` : ""}`,
      performed_by: req.user.id,
      metadata: { action: "update", id, changes: req.body },
    });
    await client.query("COMMIT");

    return sendSuccess(res, "Lead source updated successfully", result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/v1/config/lead-sources/:id
 */
const deleteLeadSource = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    const existing = await pool.query("SELECT * FROM lead_sources WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Lead source not found", 404));

    // Check if any leads are using this source
    const inUse = await pool.query(
      "SELECT COUNT(*) FROM leads WHERE source = $1 AND is_archived = false",
      [existing.rows[0].name]
    );
    const count = parseInt(inUse.rows[0].count);
    if (count > 0) {
      return next(new AppError(
        `Cannot delete — ${count} lead${count > 1 ? "s are" : " is"} using this source. Deactivate it instead.`,
        400
      ));
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM lead_sources WHERE id = $1", [id]);
    await writeAudit(client, {
      action: "lead_source_change",
      description: `Lead source deleted: ${existing.rows[0].name}`,
      performed_by: req.user.id,
      metadata: { action: "delete", name: existing.rows[0].name },
    });
    await client.query("COMMIT");

    return sendSuccess(res, "Lead source removed successfully");
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/config/modules
 */
const getModules = async (req, res, next) => {
  return sendSuccess(res, "Modules fetched", MODULE_META);
};

/**
 * GET /api/v1/config/general
 */
const getGeneralSettings = async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM system_settings LIMIT 1");
    if (result.rows.length === 0) {
      // Return defaults if not yet configured
      return sendSuccess(res, "General settings fetched", {
        company_name: "Next One Realty",
        timezone: "Asia/Kolkata",
        default_language: "en",
        task_reminder_minutes: 30,
        visit_reminder_hours: 24,
        max_leads_per_executive: 100,
      });
    }
    return sendSuccess(res, "General settings fetched", result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/config/general
 */
const updateGeneralSettings = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      company_name, timezone, default_language,
      task_reminder_minutes, visit_reminder_hours, max_leads_per_executive,
    } = req.body;

    const updates = []; const params = []; let idx = 1;
    if (company_name)              { updates.push(`company_name = $${idx++}`);              params.push(company_name); }
    if (timezone)                  { updates.push(`timezone = $${idx++}`);                  params.push(timezone); }
    if (default_language)          { updates.push(`default_language = $${idx++}`);          params.push(default_language); }
    if (task_reminder_minutes)     { updates.push(`task_reminder_minutes = $${idx++}`);     params.push(task_reminder_minutes); }
    if (visit_reminder_hours)      { updates.push(`visit_reminder_hours = $${idx++}`);      params.push(visit_reminder_hours); }
    if (max_leads_per_executive)   { updates.push(`max_leads_per_executive = $${idx++}`);   params.push(max_leads_per_executive); }

    if (updates.length === 0) return sendError(res, "No fields to update", 400);
    updates.push(`updated_at = NOW()`);

    await client.query("BEGIN");
    // Upsert — insert row if none exists, update if it does
    const result = await client.query(
      `INSERT INTO system_settings (${updates.map((u, i) => u.split(" = ")[0]).join(", ")})
       VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}
       RETURNING *`,
      params
    );

    await writeAudit(client, {
      action: "config_update",
      description: "General system settings updated",
      performed_by: req.user.id,
      metadata: req.body,
    });
    await client.query("COMMIT");

    return sendSuccess(res, "General settings updated successfully", result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[updateGeneralSettings]", err);
    return sendError(res, "Failed to update settings", 500);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/config/audit-log
 */
const getAuditLog = async (req, res) => {
  try {
    const { action, performed_by, from, to, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    const params = [];
    let idx = 1;

    if (action)       { conditions.push(`al.action = $${idx++}`);               params.push(action); }
    if (performed_by) { conditions.push(`al.performed_by = $${idx++}`);         params.push(performed_by); }
    if (from)         { conditions.push(`al.created_at::date >= $${idx++}`);    params.push(from); }
    if (to)           { conditions.push(`al.created_at::date <= $${idx++}`);    params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM audit_logs al ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT al.id, al.action, al.description, al.metadata, al.created_at,
              CONCAT(u.first_name,' ',u.last_name) AS performed_by,
              CONCAT(t.first_name,' ',t.last_name) AS target_user
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.performed_by
       LEFT JOIN users t ON t.id = al.target_user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    console.error("[getAuditLog]", err);
    return sendError(res, "Failed to fetch audit log", 500);
  }
};

module.exports = {
  getRoles, updateRolePermissions,
  getLeadSources, createLeadSource, updateLeadSource, deleteLeadSource,
  getModules,
  getGeneralSettings, updateGeneralSettings,
  getAuditLog,
};
