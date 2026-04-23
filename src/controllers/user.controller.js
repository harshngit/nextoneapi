const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");

/**
 * GET /api/users
 */
const getAllUsers = async (req, res, next) => {
  try {
    const { role, is_active, search, manager_id, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params = [];
    let idx = 1;

    // Sales Manager can only see their own team
    if (req.user.role === "sales_manager") {
      conditions.push(`manager_id = $${idx++}`);
      params.push(req.user.id);
    }

    if (role)       { conditions.push(`role = $${idx++}`);       params.push(role); }
    if (manager_id && req.user.role !== "sales_manager") {
                      conditions.push(`manager_id = $${idx++}`); params.push(manager_id); }
    if (is_active !== undefined) {
                      conditions.push(`is_active = $${idx++}`);  params.push(is_active === "true"); }
    if (search) {
      conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM users ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT id, first_name, last_name, email, phone_number, role,
              is_active, last_login, manager_id, created_at
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/users
 */
const createUser = async (req, res, next) => {
  try {
    const {
      first_name, last_name, email, password, phone_number,
      role, manager_id,
    } = req.body;

    if (!first_name || !last_name || !email || !password || !role) {
      return next(new AppError("first_name, last_name, email, password, and role are required", 400));
    }

    const validRoles = ["admin", "sales_manager", "sales_executive", "external_caller"];
    if (!validRoles.includes(role)) {
      return next(new AppError(`Invalid role. Allowed: ${validRoles.join(", ")}`, 400));
    }

    if (role === "sales_executive" && !manager_id) {
      return next(new AppError("manager_id is required when creating a sales_executive", 400));
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) return next(new AppError("A user with this email already exists", 400));

    if (manager_id) {
      const mgr = await pool.query("SELECT id, role FROM users WHERE id = $1 AND is_active = true", [manager_id]);
      if (mgr.rows.length === 0) return next(new AppError("Manager not found", 400));
      if (mgr.rows[0].role !== "sales_manager") return next(new AppError("Provided manager_id does not belong to a Sales Manager", 400));
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users
        (first_name, last_name, email, password_hash, phone_number, role,
         manager_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)
       RETURNING id, email, role, first_name, last_name, created_at`,
      [
        first_name.trim(), last_name.trim(), email.toLowerCase(),
        passwordHash, phone_number || null, role,
        manager_id || null,
      ]
    );

    return sendSuccess(res, "User created successfully", result.rows[0], 201);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/users/:id
 */
const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: callerId } = req.user;

    // Sales Executive can only view themselves
    if (role === "sales_executive" && id !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone_number, u.role,
              u.is_active, u.last_login,
              u.manager_id, u.created_at, u.updated_at,
              m.first_name AS manager_first_name, m.last_name AS manager_last_name
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
       WHERE u.id = $1`,
      [id]
    );

    if (result.rows.length === 0) return next(new AppError("User not found", 404));

    const user = result.rows[0];

    // Sales Manager can only view their own team
    if (role === "sales_manager" && user.manager_id !== callerId) {
      return next(new AppError("Access denied to this user's profile", 403));
    }

    const { manager_first_name, manager_last_name, manager_id, ...rest } = user;
    const formatted = {
      ...rest,
      manager: manager_id ? { id: manager_id, full_name: `${manager_first_name} ${manager_last_name}` } : null,
    };

    return sendSuccess(res, "User fetched successfully", formatted);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/users/:id
 */
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role: callerRole, id: callerId } = req.user;

    // Only admin+ or the user themselves can update
    const canUpdate = ["super_admin", "admin"].includes(callerRole) || callerId === id;
    if (!canUpdate) return next(new AppError("You can only update your own profile", 403));

    const existing = await pool.query("SELECT id, manager_id FROM users WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("User not found", 404));

    const { first_name, last_name, phone_number, manager_id } = req.body;

    const updates = [];
    const params = [];
    let idx = 1;

    if (first_name)           { updates.push(`first_name = $${idx++}`);           params.push(first_name.trim()); }
    if (last_name)            { updates.push(`last_name = $${idx++}`);            params.push(last_name.trim()); }
    if (phone_number)         { updates.push(`phone_number = $${idx++}`);         params.push(phone_number); }
    if (manager_id !== undefined && ["super_admin", "admin"].includes(callerRole)) {
                                updates.push(`manager_id = $${idx++}`);           params.push(manager_id || null); }

    if (updates.length === 0) return next(new AppError("No fields to update", 400));

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx}
       RETURNING id, first_name, last_name, email, phone_number, role, is_active, updated_at`,
      params
    );

    return sendSuccess(res, "User updated successfully", result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/users/:id  (soft delete)
 */
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query("SELECT role FROM users WHERE id = $1", [id]);
    if (result.rows.length === 0) return next(new AppError("User not found", 404));
    if (result.rows[0].role === "super_admin") return next(new AppError("Cannot deactivate a Super Admin", 400));

    await pool.query(
      "UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1",
      [id]
    );

    // Revoke all sessions
    await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [id]);

    return sendSuccess(res, "User deactivated successfully");
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/users/:id/role
 */
const updateRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ["admin", "sales_manager", "sales_executive", "external_caller"];
    if (!role || !validRoles.includes(role)) {
      return next(new AppError(`Invalid role. Allowed: ${validRoles.join(", ")}`, 400));
    }

    const existing = await pool.query("SELECT role FROM users WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("User not found", 404));

    const updates = [`role = $1`, `updated_at = NOW()`];
    const params = [role, id];

    // If promoted from exec to manager, clear their manager_id
    if (role === "sales_manager") {
      updates.push(`manager_id = NULL`);
    }

    const result = await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id = $2 RETURNING id, role, updated_at`,
      params
    );

    return sendSuccess(res, `User role updated to ${role}`, result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/users/team
 */
const getTeam = async (req, res, next) => {
  try {
    const { role, id: callerId } = req.user;
    let managerId = callerId;

    // Admin/Super Admin can query any manager's team
    if (["super_admin", "admin"].includes(role) && req.query.manager_id) {
      managerId = req.query.manager_id;
    }

    const managerResult = await pool.query(
      "SELECT id, first_name, last_name, role FROM users WHERE id = $1 AND role = 'sales_manager'",
      [managerId]
    );
    if (managerResult.rows.length === 0) return next(new AppError("Manager not found", 404));

    const teamResult = await pool.query(
      `SELECT id, first_name, last_name, email, phone_number, is_active,
              (SELECT COUNT(*) FROM leads WHERE assigned_to = u.id) AS total_leads,
              (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id AND is_completed = false) AS pending_followups
       FROM users u
       WHERE manager_id = $1
       ORDER BY first_name`,
      [managerId]
    );

    const mgr = managerResult.rows[0];
    return sendSuccess(res, "Team fetched successfully", {
      manager: { id: mgr.id, full_name: `${mgr.first_name} ${mgr.last_name}`, role: mgr.role },
      team_size: teamResult.rows.length,
      members: teamResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/users/:id/performance
 */
const getUserPerformance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { from, to, role: callerRole, id: callerId } = req.user;

    // Access control
    if (callerRole === "sales_executive" && id !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    const fromDate = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
    const toDate   = req.query.to   || new Date().toISOString().split("T")[0];

    const user = await pool.query(
      "SELECT id, first_name, last_name FROM users WHERE id = $1",
      [id]
    );
    if (user.rows.length === 0) return next(new AppError("User not found", 404));

    // If caller is sales_manager, verify the user is in their team
    if (callerRole === "sales_manager") {
      const check = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND manager_id = $2",
        [id, callerId]
      );
      if (check.rows.length === 0) return next(new AppError("Access denied", 403));
    }

    const stats = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'new')                  AS new_leads,
        COUNT(*) FILTER (WHERE status = 'contacted')            AS contacted,
        COUNT(*) FILTER (WHERE status = 'interested')           AS interested,
        COUNT(*) FILTER (WHERE status = 'site_visit_scheduled') AS site_visits_scheduled,
        COUNT(*) FILTER (WHERE status = 'site_visit_done')      AS site_visits_done,
        COUNT(*) FILTER (WHERE status = 'negotiation')          AS negotiation,
        COUNT(*) FILTER (WHERE status = 'booked')               AS booked,
        COUNT(*) FILTER (WHERE status = 'lost')                 AS lost,
        COUNT(*)                                                 AS total_leads
       FROM leads
       WHERE assigned_to = $1
         AND created_at::date BETWEEN $2 AND $3`,
      [id, fromDate, toDate]
    );

    const tasks = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE is_completed = false)                    AS pending_followups,
        COUNT(*) FILTER (WHERE is_completed = false AND due_date < NOW()) AS overdue_followups
       FROM tasks WHERE assigned_to = $1`,
      [id]
    );

    const s = stats.rows[0];
    const t = tasks.rows[0];
    const booked = parseInt(s.booked);
    const total  = parseInt(s.total_leads);

    return sendSuccess(res, "Performance stats fetched", {
      user_id:     id,
      full_name:   `${user.rows[0].first_name} ${user.rows[0].last_name}`,
      period:      { from: fromDate, to: toDate },
      total_leads: total,
      contacted:              parseInt(s.contacted),
      interested:             parseInt(s.interested),
      site_visits_scheduled:  parseInt(s.site_visits_scheduled),
      site_visits_done:       parseInt(s.site_visits_done),
      negotiation:            parseInt(s.negotiation),
      booked,
      lost:                   parseInt(s.lost),
      conversion_rate:        total > 0 ? parseFloat(((booked / total) * 100).toFixed(1)) : 0,
      pending_followups:      parseInt(t.pending_followups),
      overdue_followups:      parseInt(t.overdue_followups),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllUsers, createUser, getUserById, updateUser, deleteUser, updateRole, getTeam, getUserPerformance };