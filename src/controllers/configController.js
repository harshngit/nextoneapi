const { pool } = require("../config/db");
const { sendSuccess, sendError, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");
const { refreshPermissionCache, getUserOverride } = require("../middleware/permissions");

// ─── Constants ────────────────────────────────────────────────
// All roles except super_admin are configurable. super_admin always has
// full access to everything and is never stored in role_permissions —
// this is the platform's safety net (can never be locked out).
const CONFIGURABLE_ROLES = [
  "admin", "sales_manager", "sales_executive", "external_caller",
  "associate", "associate_partner", "partner", "team_leader",
  "cluster", "cluster_head", "digital_marketing", "hr_admin",
];

// 13 modules — one per frontend page/sidebar item
const MODULES = [
  "dashboard", "leads", "projects", "site_visits", "revisits",
  "closures", "targets", "follow_ups", "attendance", "salary", "team",
  "users", "phone_requests", "notifications",
];

// 6 permission keys. Not every module uses approve/export —
// the frontend hides those columns where MODULE_META marks them unsupported.
const PERMISSION_KEYS = ["view", "create", "edit", "delete", "approve", "export"];

const MODULE_META = [
  { key: "dashboard",      display_name: "Dashboard",               description: "Overview, KPIs, and team performance widgets",            supports: ["view", "export"] },
  { key: "leads",          display_name: "Lead Management",         description: "Create, assign, and track leads through the sales lifecycle", supports: ["view","create","edit","delete","export"] },
  { key: "projects",       display_name: "Project Management",      description: "Manage real estate projects and map leads to them",       supports: ["view","create","edit","delete","export"] },
  { key: "site_visits",    display_name: "Site Visit Management",    description: "Schedule, track, and capture feedback for site visits",  supports: ["view","create","edit","delete","export"] },
  { key: "revisits",       display_name: "Re-visit Management",      description: "Schedule and track follow-up site re-visits",            supports: ["view","create","edit","delete","export"] },
  { key: "closures",       display_name: "Closures & Bookings",      description: "Record bookings, unit details, and commission",          supports: ["view","create","edit","delete","approve","export"] },
  { key: "targets",        display_name: "Targets",                 description: "Set and track monthly site-visit and closure targets per user", supports: ["view","create","edit","delete","export"] },
  { key: "follow_ups",     display_name: "Follow-Up & Tasks",        description: "Create and manage follow-up tasks with reminders",       supports: ["view","create","edit","delete","export"] },
  { key: "attendance",     display_name: "Attendance",               description: "Check-in/out, manual entries, attendance approvals",     supports: ["view","create","edit","delete","approve","export"] },
  { key: "salary",         display_name: "Salary & Incentives",      description: "Salary slips, incentives, appraisals",                   supports: ["view","create","edit","delete","approve","export"] },
  { key: "team",           display_name: "Team",                     description: "View team hierarchy and member performance",             supports: ["view"] },
  { key: "users",          display_name: "User & Role Management",   description: "Manage users, roles, and access control",                supports: ["view","create","edit","delete"] },
  { key: "phone_requests", display_name: "Phone Number Requests",    description: "Request and approve access to lead phone numbers",       supports: ["view","create","edit","approve"] },
  { key: "notifications",  display_name: "Notifications",            description: "In-app notification center",                             supports: ["view"] },
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
 * Returns the full permission matrix for all 12 configurable roles.
 * super_admin is never included — it always has full access.
 */
const getRoles = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT role, display_name, permissions, updated_at
       FROM role_permissions
       WHERE role = ANY($1::varchar[])
       ORDER BY array_position($1::varchar[], role)`,
      [CONFIGURABLE_ROLES]
    );

    // Build full-access matrix for super_admin — it is never stored in DB,
    // always has full access to everything, and cannot be edited.
    const superAdminPerms = {};
    for (const m of MODULES) {
      superAdminPerms[m] = Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
    }
    const superAdminRow = {
      role:         "super_admin",
      display_name: "Super Admin",
      permissions:  superAdminPerms,
      updated_at:   null,
      editable:     false,
    };

    // All configurable roles from DB — clean each row
    const configurableRows = result.rows.map(r => {
      const cleanPerms = {};
      for (const [m, v] of Object.entries(r.permissions || {})) {
        if (MODULES.includes(m)) cleanPerms[m] = v;  // strip legacy modules
      }
      for (const m of MODULES) {
        if (!cleanPerms[m]) {
          cleanPerms[m] = Object.fromEntries(PERMISSION_KEYS.map(k => [k, false]));
        }
      }
      return { ...r, permissions: cleanPerms, editable: true };
    });

    // For roles that have NO row in DB yet, add an all-false placeholder
    const rolesInDb = new Set(result.rows.map(r => r.role));
    for (const role of CONFIGURABLE_ROLES) {
      if (!rolesInDb.has(role)) {
        const defaultPerms = {};
        for (const m of MODULES) {
          defaultPerms[m] = Object.fromEntries(PERMISSION_KEYS.map(k => [k, false]));
        }
        const displayName = role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        configurableRows.push({
          role,
          display_name: displayName,
          permissions:  defaultPerms,
          updated_at:   null,
          editable:     true,
        });
      }
    }

    // Sort to match CONFIGURABLE_ROLES order
    configurableRows.sort((a, b) =>
      CONFIGURABLE_ROLES.indexOf(a.role) - CONFIGURABLE_ROLES.indexOf(b.role)
    );

    return sendSuccess(res, "Roles and permissions fetched", {
      // super_admin always first, then configurable roles in order
      roles:           [superAdminRow, ...configurableRows],
      modules:         MODULES,
      permission_keys: PERMISSION_KEYS,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/config/roles/:role
 * Returns the permission matrix for a single role — used to populate
 * the Access Control edit panel for one role at a time.
 */
const getRolePermissions = async (req, res, next) => {
  try {
    const { role } = req.params;
    if (role === "super_admin") {
      // super_admin always has everything — return a synthetic full-access matrix
      const fullAccess = {};
      for (const m of MODULES) {
        fullAccess[m] = Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
      }
      return sendSuccess(res, "Super Admin has full access to all modules", {
        role: "super_admin",
        display_name: "Super Admin",
        permissions: fullAccess,
        editable: false,
      });
    }

    if (!CONFIGURABLE_ROLES.includes(role)) {
      return next(new AppError(`Invalid role. Configurable roles: ${CONFIGURABLE_ROLES.join(", ")}`, 400));
    }

    const result = await pool.query(
      "SELECT role, display_name, permissions, updated_at FROM role_permissions WHERE role = $1",
      [role]
    );

    // If no row exists yet for this role, auto-create an all-false default matrix
    // and insert it so subsequent calls have a row to update
    if (!result.rows.length) {
      const defaultPerms = {};
      for (const m of MODULES) {
        defaultPerms[m] = Object.fromEntries(PERMISSION_KEYS.map(k => [k, false]));
      }
      const displayName = role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      await pool.query(
        `INSERT INTO role_permissions (role, display_name, permissions)
         VALUES ($1, $2, $3)
         ON CONFLICT (role) DO NOTHING`,
        [role, displayName, JSON.stringify(defaultPerms)]
      );
      return sendSuccess(res, `Permissions for ${role}`, {
        role,
        display_name: displayName,
        permissions:  defaultPerms,
        updated_at:   null,
        editable:     true,
      });
    }

    // Strip legacy modules (tasks, reports) from stored permissions before returning
    const cleanPerms = {};
    for (const [m, v] of Object.entries(result.rows[0].permissions)) {
      if (MODULES.includes(m)) cleanPerms[m] = v;
    }
    // Fill in any missing modules with all-false defaults
    for (const m of MODULES) {
      if (!cleanPerms[m]) {
        cleanPerms[m] = Object.fromEntries(PERMISSION_KEYS.map(k => [k, false]));
      }
    }

    return sendSuccess(res, `Permissions for ${role}`, {
      ...result.rows[0],
      permissions: cleanPerms,
      editable: true,
    });
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

    // Strip unknown modules (e.g. old "tasks", "reports") and unknown keys silently.
    // This prevents errors when the DB row still contains legacy module names from
    // older migrations — we simply ignore them and save only valid entries.
    const cleanPermissions = {};
    for (const [module, perms] of Object.entries(permissions)) {
      if (!MODULES.includes(module)) continue;            // skip old modules silently
      cleanPermissions[module] = {};
      for (const [key, val] of Object.entries(perms)) {
        if (!PERMISSION_KEYS.includes(key)) continue;     // skip old keys silently
        if (typeof val !== "boolean") {
          return next(new AppError(`Permission value for ${module}.${key} must be boolean`, 400));
        }
        cleanPermissions[module][key] = val;
      }
    }

    // Fetch existing row and strip any legacy module keys from the stored JSONB
    const existing = await pool.query("SELECT permissions FROM role_permissions WHERE role = $1", [role]);
    const rawPerms  = existing.rows.length > 0 ? existing.rows[0].permissions : {};
    const currentPerms = {};
    for (const [m, v] of Object.entries(rawPerms)) {
      if (MODULES.includes(m)) currentPerms[m] = v;       // drop legacy modules
    }

    // Deep merge — only the valid modules/keys sent in the request are overwritten
    const mergedPerms = { ...currentPerms };
    for (const [module, perms] of Object.entries(cleanPermissions)) {
      mergedPerms[module] = { ...(mergedPerms[module] || {}), ...perms };
    }

    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO role_permissions (role, permissions)
       VALUES ($1, $2)
       ON CONFLICT (role) DO UPDATE SET permissions = $2, updated_at = NOW()
       RETURNING role, display_name, permissions, updated_at`,
      [role, JSON.stringify(mergedPerms)]
    );

    await writeAudit(client, {
      action: "permission_update",
      description: `Permissions updated for role: ${role}`,
      performed_by: callerId,
      metadata: { role, permissions },  // log only what changed, not the full matrix
    });

    await client.query("COMMIT");

    // Refresh the in-memory permission cache so the new rules apply immediately —
    // no server restart needed, takes effect on the very next request.
    await refreshPermissionCache();

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
  return sendSuccess(res, "Modules fetched", {
    modules: MODULE_META,
    permission_keys: PERMISSION_KEYS,
    configurable_roles: CONFIGURABLE_ROLES,
  });
};

/**
 * GET /api/v1/users/me/permissions
 * Returns the EFFECTIVE permissions for the logged-in user:
 *   role default permissions, with any per-user overrides applied on top.
 * Frontend calls this once after login and caches the result —
 * used to drive the sidebar, route guards, and action buttons.
 */
const getMyPermissions = async (req, res, next) => {
  try {
    const { id: userId, role } = req.user;

    // super_admin → synthetic full-access matrix, no DB lookups needed
    if (role === "super_admin") {
      const fullAccess = {};
      for (const m of MODULES) {
        fullAccess[m] = Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
      }
      return sendSuccess(res, "Effective permissions fetched", {
        role: "super_admin",
        permissions: fullAccess,
        modules: MODULES,
        permission_keys: PERMISSION_KEYS,
      });
    }

    // 1. Role defaults
    const roleResult = await pool.query(
      "SELECT permissions FROM role_permissions WHERE role = $1", [role]
    );
    const rolePerms = roleResult.rows.length ? roleResult.rows[0].permissions : {};

    // Ensure every module/key exists even if the role row is missing some
    // (e.g. a module added after this role was last saved)
    const effective = {};
    for (const m of MODULES) {
      effective[m] = {};
      for (const k of PERMISSION_KEYS) {
        effective[m][k] = rolePerms?.[m]?.[k] === true;
      }
    }

    // 2. Apply per-user overrides on top
    // Wrapped in try/catch so a missing table (migration not run yet)
    // doesn't crash the login flow — just skips overrides gracefully.
    let overrideRows = [];
    try {
      const overrides = await pool.query(
        "SELECT module, permission_key, value FROM user_permission_overrides WHERE user_id = $1",
        [userId]
      );
      overrideRows = overrides.rows;
    } catch (overrideErr) {
      // Table doesn't exist yet — proceed without overrides
      console.warn("[Permissions] user_permission_overrides table not found — run migration 033. Continuing without overrides.");
    }

    for (const o of overrideRows) {
      if (effective[o.module]) {
        effective[o.module][o.permission_key] = o.value;
      }
    }

    return sendSuccess(res, "Effective permissions fetched", {
      role,
      permissions: effective,
      modules: MODULES,
      permission_keys: PERMISSION_KEYS,
      has_overrides: overrideRows.length > 0,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/config/roles/:role/reset
 * Resets a role's permissions back to {} (all false).
 * Re-run migration 031, or manually re-configure via PUT, to restore defaults.
 * super_admin cannot be reset (not stored / always full access).
 */
const resetRolePermissions = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { role } = req.params;
    const { id: callerId } = req.user;

    if (!CONFIGURABLE_ROLES.includes(role)) {
      return next(new AppError(`Invalid role. Configurable roles: ${CONFIGURABLE_ROLES.join(", ")}`, 400));
    }

    // Build an all-false matrix for every module/key
    const blank = {};
    for (const m of MODULES) {
      blank[m] = Object.fromEntries(PERMISSION_KEYS.map(k => [k, false]));
    }

    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE role_permissions SET permissions = $2, updated_at = NOW()
       WHERE role = $1
       RETURNING role, display_name, permissions, updated_at`,
      [role, JSON.stringify(blank)]
    );
    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return next(new AppError(`Role ${role} not found in role_permissions`, 404));
    }

    await writeAudit(client, {
      action: "permission_reset",
      description: `Permissions reset to all-false for role: ${role}`,
      performed_by: callerId,
      metadata: { role },
    });

    await client.query("COMMIT");
    await refreshPermissionCache();

    return sendSuccess(res, `Permissions for ${role} reset — all modules set to no access`, result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
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

// ═════════════════════════════════════════════════════════════
// LEAD STATUS MANAGEMENT
// ═════════════════════════════════════════════════════════════

/**
 * GET /api/v1/config/lead-statuses
 * Returns all statuses ordered by sort_order.
 * Accessible to all authenticated users (needed for dropdowns).
 */
const getLeadStatuses = async (req, res, next) => {
  try {
    const { include_inactive } = req.query;
    const where = include_inactive === 'true' ? '' : 'WHERE is_active = true';
    const result = await pool.query(
      `SELECT id, key, label, color, sort_order, is_active, is_system, created_at
       FROM lead_statuses ${where} ORDER BY sort_order ASC, label ASC`
    );
    return sendSuccess(res, 'Lead statuses fetched', result.rows);
  } catch (err) { next(err); }
};

/**
 * POST /api/v1/config/lead-statuses
 * Create a new custom lead status.
 * Body: { key, label, color?, sort_order? }
 */
const createLeadStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { key, label, color, sort_order } = req.body;
    if (!key  || !key.trim())   return next(new AppError('key is required',   400));
    if (!label || !label.trim()) return next(new AppError('label is required', 400));

    // key must be slug-style
    const cleanKey = key.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!cleanKey) return next(new AppError('key must contain alphanumeric characters', 400));

    const dupKey = await pool.query('SELECT id FROM lead_statuses WHERE key = $1', [cleanKey]);
    if (dupKey.rows.length > 0) return next(new AppError(`Status key '${cleanKey}' already exists`, 400));

    const dupLabel = await pool.query(
      'SELECT id FROM lead_statuses WHERE LOWER(label) = LOWER($1)', [label.trim()]
    );
    if (dupLabel.rows.length > 0) return next(new AppError(`Status label '${label.trim()}' already exists`, 400));

    // Default sort_order: after current last
    let finalOrder = sort_order;
    if (finalOrder === undefined || finalOrder === null) {
      const maxRes = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM lead_statuses');
      finalOrder = maxRes.rows[0].next;
    }

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO lead_statuses (key, label, color, sort_order, is_system)
       VALUES ($1, $2, $3, $4, false) RETURNING *`,
      [cleanKey, label.trim(), color || '#6b7280', finalOrder]
    );
    await writeAudit(client, {
      action:      'config_update',
      description: `Lead status created: ${label.trim()} (${cleanKey})`,
      performed_by: req.user.id,
      metadata:    { action: 'create', key: cleanKey, label: label.trim() },
    });
    await client.query('COMMIT');

    return sendSuccess(res, 'Lead status created successfully', result.rows[0], 201);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

/**
 * PUT /api/v1/config/lead-statuses/:id
 * Update label, color, sort_order, or is_active on any status.
 * Key cannot be changed (leads.status references it directly).
 * Body: { label?, color?, sort_order?, is_active? }
 */
const updateLeadStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { label, color, sort_order, is_active } = req.body;

    const existing = await pool.query('SELECT * FROM lead_statuses WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Lead status not found', 404));

    const status = existing.rows[0];

    if (label) {
      const dupe = await pool.query(
        'SELECT id FROM lead_statuses WHERE LOWER(label) = LOWER($1) AND id != $2',
        [label.trim(), id]
      );
      if (dupe.rows.length > 0) return next(new AppError(`Status label '${label}' already exists`, 400));
    }

    const updates = []; const params = []; let idx = 1;
    if (label      !== undefined) { updates.push(`label = $${idx++}`);      params.push(label.trim()); }
    if (color      !== undefined) { updates.push(`color = $${idx++}`);      params.push(color); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); params.push(sort_order); }
    if (is_active  !== undefined) { updates.push(`is_active = $${idx++}`);  params.push(is_active); }
    if (!updates.length) return next(new AppError('No fields to update', 400));
    updates.push('updated_at = NOW()');
    params.push(id);

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE lead_statuses SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    await writeAudit(client, {
      action:      'config_update',
      description: `Lead status updated: ${status.label}`,
      performed_by: req.user.id,
      metadata:    { action: 'update', id, changes: req.body },
    });
    await client.query('COMMIT');

    return sendSuccess(res, 'Lead status updated successfully', result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

/**
 * DELETE /api/v1/config/lead-statuses/:id
 * Deletes a custom status. System statuses cannot be deleted.
 * Statuses in use by active leads cannot be deleted — deactivate instead.
 */
const deleteLeadStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    const existing = await pool.query('SELECT * FROM lead_statuses WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Lead status not found', 404));

    const status = existing.rows[0];
    if (status.is_system) {
      return next(new AppError(
        `'${status.label}' is a system status and cannot be deleted. You can deactivate it instead.`, 400
      ));
    }

    // Check if any active leads use this status
    const inUse = await pool.query(
      'SELECT COUNT(*) FROM leads WHERE status = $1 AND is_archived = false',
      [status.key]
    );
    const count = parseInt(inUse.rows[0].count);
    if (count > 0) {
      return next(new AppError(
        `Cannot delete — ${count} active lead${count > 1 ? 's are' : ' is'} using this status. Deactivate it instead.`,
        400
      ));
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM lead_statuses WHERE id = $1', [id]);
    await writeAudit(client, {
      action:      'config_update',
      description: `Lead status deleted: ${status.label} (${status.key})`,
      performed_by: req.user.id,
      metadata:    { action: 'delete', key: status.key, label: status.label },
    });
    await client.query('COMMIT');

    return sendSuccess(res, 'Lead status removed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

/**
 * PATCH /api/v1/config/lead-statuses/reorder
 * Bulk-reorder statuses.
 * Body: { order: [{ id, sort_order }] }
 */
const reorderLeadStatuses = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || !order.length) {
      return next(new AppError('order array is required', 400));
    }

    await client.query('BEGIN');
    for (const item of order) {
      if (!item.id || item.sort_order === undefined) continue;
      await client.query(
        'UPDATE lead_statuses SET sort_order = $1, updated_at = NOW() WHERE id = $2',
        [item.sort_order, item.id]
      );
    }
    await writeAudit(client, {
      action:      'config_update',
      description: `Lead statuses reordered (${order.length} items)`,
      performed_by: req.user.id,
      metadata:    { action: 'reorder', count: order.length },
    });
    await client.query('COMMIT');

    const updated = await pool.query(
      'SELECT id, key, label, color, sort_order, is_active, is_system FROM lead_statuses ORDER BY sort_order ASC'
    );
    return sendSuccess(res, 'Lead statuses reordered', updated.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PER-USER PERMISSION OVERRIDES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/users/:id/permission-overrides
 * List all per-user overrides for one user (admin view).
 */
const getUserOverrides = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userChk = await pool.query(
      "SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role FROM users WHERE id = $1", [id]
    );
    if (!userChk.rows.length) return next(new AppError("User not found", 404));

    let overrideRows = [];
    try {
      const result = await pool.query(
        `SELECT upo.*, CONCAT(s.first_name,' ',s.last_name) AS set_by_name
         FROM user_permission_overrides upo
         LEFT JOIN users s ON s.id = upo.set_by
         WHERE upo.user_id = $1
         ORDER BY upo.module, upo.permission_key`,
        [id]
      );
      overrideRows = result.rows;
    } catch (tableErr) {
      console.warn("[Permissions] user_permission_overrides table not found — run migration 033.");
    }

    return sendSuccess(res, "Permission overrides fetched", {
      user:      userChk.rows[0],
      overrides: overrideRows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/users/:id/permission-overrides
 * Set or clear per-user permission overrides.
 * Body: { overrides: [ { module, permission_key, value }, ... ] }
 * Pass value: null to remove an override (revert to role default).
 */
const setUserOverrides = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { overrides } = req.body;
    const { id: callerId } = req.user;

    if (!Array.isArray(overrides) || !overrides.length) {
      return next(new AppError("overrides array is required", 400));
    }

    const userChk = await pool.query("SELECT id, role FROM users WHERE id = $1", [id]);
    if (!userChk.rows.length) return next(new AppError("User not found", 404));
    if (userChk.rows[0].role === "super_admin") {
      return next(new AppError("Cannot set overrides for Super Admin — always full access", 400));
    }

    for (const o of overrides) {
      if (!MODULES.includes(o.module)) continue; // skip legacy modules silently
      if (!PERMISSION_KEYS.includes(o.permission_key)) {
        return next(new AppError(`Invalid permission key: ${o.permission_key}`, 400));
      }
      if (o.value !== null && typeof o.value !== "boolean") {
        return next(new AppError("value must be true, false, or null", 400));
      }
    }

    await client.query("BEGIN");
    for (const o of overrides) {
      if (!MODULES.includes(o.module)) continue;       // skip legacy modules
      if (!PERMISSION_KEYS.includes(o.permission_key)) continue; // skip legacy keys
      if (o.value === null) {
        await client.query(
          `DELETE FROM user_permission_overrides
           WHERE user_id = $1 AND module = $2 AND permission_key = $3`,
          [id, o.module, o.permission_key]
        );
      } else {
        await client.query(
          `INSERT INTO user_permission_overrides (user_id, module, permission_key, value, set_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, module, permission_key)
           DO UPDATE SET value = $4, set_by = $5, updated_at = NOW()`,
          [id, o.module, o.permission_key, o.value, callerId]
        );
      }
    }

    await writeAudit(client, {
      action: "permission_override_update",
      description: `Permission overrides updated for user ${id}`,
      performed_by: callerId,
      target_user_id: id,
      metadata: { overrides },
    });

    await client.query("COMMIT");

    const result = await pool.query(
      `SELECT module, permission_key, value FROM user_permission_overrides WHERE user_id = $1
       ORDER BY module, permission_key`,
      [id]
    );

    return sendSuccess(res, "Permission overrides updated", { user_id: id, overrides: result.rows });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  getRoles,
  getRolePermissions,
  updateRolePermissions,
  resetRolePermissions,
  getMyPermissions,
  getUserOverrides,
  setUserOverrides,
  getLeadSources,
  createLeadSource,
  updateLeadSource,
  deleteLeadSource,
  getModules,
  getGeneralSettings,
  updateGeneralSettings,
  getAuditLog,
  getLeadStatuses,
  createLeadStatus,
  updateLeadStatus,
  deleteLeadStatus,
  reorderLeadStatuses
};