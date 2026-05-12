/**
 * teamHistoryController.js — Next One Realty
 *
 * Provides sales_manager (and admin/super_admin) access to the full activity
 * history — leads, follow-ups (tasks), and site visits — belonging to any
 * sales_executive or external_caller on their team.
 *
 * sales_executive and external_caller can access only their own history via
 * these endpoints (same URLs, enforced below).
 */

const { pool }     = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError     = require("../utils/AppError");

// ─── Guard helper ─────────────────────────────────────────────────────────────
// Returns the resolved target user_id or throws an AppError.
// Rules:
//   super_admin / admin  → can view anyone
//   sales_manager        → can view only their own team members
//   sales_executive /
//   external_caller      → can view only themselves
const resolveTargetUser = async (requestedId, caller) => {
  const { role, id: callerId } = caller;

  // Self-access always allowed
  if (requestedId === callerId) return requestedId;

  if (["super_admin", "admin"].includes(role)) return requestedId;

  if (role === "sales_manager") {
    const check = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND manager_id = $2 AND is_active = true`,
      [requestedId, callerId]
    );
    if (check.rows.length === 0) {
      throw new AppError("Access denied — user is not on your team", 403);
    }
    return requestedId;
  }

  // sales_executive / external_caller can only see themselves
  throw new AppError("Access denied", 403);
};

// ─── Shared user info fetch ───────────────────────────────────────────────────
const getUserInfo = async (userId) => {
  const r = await pool.query(
    `SELECT id, first_name, last_name, role, email, phone_number
     FROM users WHERE id = $1`,
    [userId]
  );
  if (r.rows.length === 0) throw new AppError("User not found", 404);
  return r.rows[0];
};

// ─── GET /api/v1/team-history/:userId/leads ───────────────────────────────────
/**
 * Returns paginated leads assigned to the target user.
 * Supports filtering by status, source, date range, and text search.
 */
const getUserLeads = async (req, res, next) => {
  try {
    const targetId = await resolveTargetUser(req.params.userId, req.user);
    const userInfo = await getUserInfo(targetId);

    const {
      status, source, from, to, search,
      page = 1, per_page = 20,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = ["l.assigned_to = $1", "l.is_archived = false"];
    let params     = [targetId];
    let idx        = 2;

    if (status) { conditions.push(`l.status = $${idx++}`);                  params.push(status); }
    if (source) { conditions.push(`l.source ILIKE $${idx++}`);              params.push(source); }
    if (from)   { conditions.push(`l.created_at::date >= $${idx++}`);       params.push(from); }
    if (to)     { conditions.push(`l.created_at::date <= $${idx++}`);       params.push(to); }
    if (search) {
      conditions.push(`(l.name ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.email ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM leads l ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT l.id, l.name, l.phone, l.email, l.status, l.source,
              l.budget, l.location_preference, l.notes,
              l.is_converted, l.converted_at, l.created_at, l.updated_at,
              p.name AS project_name
       FROM leads l
       LEFT JOIN projects p ON p.id = l.project_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json({
      success: true,
      member: {
        id:         userInfo.id,
        full_name:  `${userInfo.first_name} ${userInfo.last_name}`,
        role:       userInfo.role,
      },
      ...paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)),
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/v1/team-history/:userId/follow-ups ─────────────────────────────
/**
 * Returns paginated follow-up tasks assigned to the target user.
 * Supports filtering by is_completed, priority, date range.
 */
const getUserFollowUps = async (req, res, next) => {
  try {
    const targetId = await resolveTargetUser(req.params.userId, req.user);
    const userInfo = await getUserInfo(targetId);

    const {
      is_completed, priority, from, to,
      page = 1, per_page = 20,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = ["t.assigned_to = $1"];
    let params     = [targetId];
    let idx        = 2;

    if (is_completed !== undefined) {
      conditions.push(`t.is_completed = $${idx++}`);
      params.push(is_completed === "true");
    }
    if (priority) { conditions.push(`t.priority = $${idx++}`);              params.push(priority); }
    if (from)     { conditions.push(`t.due_date::date >= $${idx++}`);       params.push(from); }
    if (to)       { conditions.push(`t.due_date::date <= $${idx++}`);       params.push(to); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM tasks t ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT t.id, t.title, t.notes, t.priority, t.due_date,
              t.is_completed, t.completed_at, t.created_at,
              l.id AS lead_id, l.name AS lead_name, l.phone AS lead_phone
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       ${where}
       ORDER BY t.due_date ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json({
      success: true,
      member: {
        id:         userInfo.id,
        full_name:  `${userInfo.first_name} ${userInfo.last_name}`,
        role:       userInfo.role,
      },
      ...paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)),
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/v1/team-history/:userId/site-visits ────────────────────────────
/**
 * Returns paginated site visits assigned to the target user.
 * Supports filtering by status, date range.
 */
const getUserSiteVisits = async (req, res, next) => {
  try {
    const targetId = await resolveTargetUser(req.params.userId, req.user);
    const userInfo = await getUserInfo(targetId);

    const {
      status, from, to,
      page = 1, per_page = 20,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = ["sv.assigned_to = $1"];
    let params     = [targetId];
    let idx        = 2;

    if (status) { conditions.push(`sv.status = $${idx++}`);                 params.push(status); }
    if (from)   { conditions.push(`sv.visit_date::date >= $${idx++}`);      params.push(from); }
    if (to)     { conditions.push(`sv.visit_date::date <= $${idx++}`);      params.push(to); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM site_visits sv ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT sv.id, sv.visit_date, sv.status, sv.notes,
              sv.transport_arranged, sv.created_at, sv.updated_at,
              l.id AS lead_id, l.name AS lead_name, l.phone AS lead_phone,
              p.id AS project_id, p.name AS project_name
       FROM site_visits sv
       LEFT JOIN leads    l ON l.id  = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       ${where}
       ORDER BY sv.visit_date DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json({
      success: true,
      member: {
        id:         userInfo.id,
        full_name:  `${userInfo.first_name} ${userInfo.last_name}`,
        role:       userInfo.role,
      },
      ...paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getUserLeads, getUserFollowUps, getUserSiteVisits };
