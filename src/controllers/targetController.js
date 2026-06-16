/**
 * targetController.js — Next One Realty CRM
 *
 * Monthly performance targets, per user.
 * Default target (used whenever no custom row exists): 15 site visits + 1 closure.
 *
 * "Remaining" is never stored — it's computed live from site_visits (status = 'done')
 * and lead_closures (status != 'cancelled') for the target month, so booking a lead
 * (which inserts a lead_closures row) automatically reduces the remaining target.
 *
 * Base path: /api/v1/targets
 */

const { pool } = require("../config/db");
const { sendSuccess } = require("../utils/response");
const AppError = require("../utils/AppError");

const DEFAULT_SITE_VISIT_TARGET = 15;
const DEFAULT_CLOSURE_TARGET    = 1;

// ─── Helper — normalize a "YYYY-MM" query param into month start/end dates ────
// Defaults to the current month when not provided.
const resolveMonthRange = (monthParam) => {
  let year, month; // month is 1-indexed here
  if (monthParam) {
    const match = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (!match) return null;
    year  = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    if (month < 1 || month > 12) return null;
  } else {
    const now = new Date();
    year  = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth   = month === 12 ? 1 : month + 1;
  const nextYear    = month === 12 ? year + 1 : year;
  const monthEnd    = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { monthStart, monthEnd };
};

// ─── Helper — fetch the effective target row for a user/month (custom or default) ─
const getEffectiveTarget = async (userId, monthStart) => {
  const result = await pool.query(
    `SELECT id, site_visit_target, closure_target, updated_at
     FROM user_targets WHERE user_id = $1 AND target_month = $2`,
    [userId, monthStart]
  );
  if (result.rows.length) {
    return { ...result.rows[0], is_custom: true };
  }
  return {
    id: null,
    site_visit_target: DEFAULT_SITE_VISIT_TARGET,
    closure_target:     DEFAULT_CLOSURE_TARGET,
    updated_at:          null,
    is_custom:           false,
  };
};

// ─── Helper — count achieved site visits + closures for a user within a month ─
const getAchieved = async (userId, monthStart, monthEnd) => {
  const [visitsRes, closuresRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FROM site_visits
       WHERE assigned_to = $1 AND status = 'done'
         AND visit_date >= $2 AND visit_date < $3`,
      [userId, monthStart, monthEnd]
    ),
    pool.query(
      `SELECT COUNT(*) FROM lead_closures
       WHERE closed_by = $1 AND status != 'cancelled'
         AND booking_date >= $2 AND booking_date < $3`,
      [userId, monthStart, monthEnd]
    ),
  ]);
  return {
    site_visits_done: parseInt(visitsRes.rows[0].count, 10),
    closures_done:    parseInt(closuresRes.rows[0].count, 10),
  };
};

// ─── Helper — build the full progress object for one user/month ──────────────
const buildProgress = async (user, monthStart, monthEnd) => {
  const target   = await getEffectiveTarget(user.id, monthStart);
  const achieved = await getAchieved(user.id, monthStart, monthEnd);

  return {
    user_id:               user.id,
    user_name:              user.full_name,
    role:                  user.role,
    target_month:           monthStart.slice(0, 7), // "YYYY-MM"
    site_visit_target:      target.site_visit_target,
    site_visits_done:       achieved.site_visits_done,
    site_visits_remaining:  Math.max(target.site_visit_target - achieved.site_visits_done, 0),
    closure_target:         target.closure_target,
    closures_done:          achieved.closures_done,
    closures_remaining:     Math.max(target.closure_target - achieved.closures_done, 0),
    is_custom:              target.is_custom,
    updated_at:             target.updated_at,
  };
};

// ─── Helper — can `caller` manage (set/delete) targets for `targetUserId`? ────
const canManageTarget = async (caller, targetUserId) => {
  if (caller.role === "super_admin" || caller.role === "admin") return true;
  if (caller.role === "sales_manager") {
    const chk = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND manager_id = $2", [targetUserId, caller.id]
    );
    return chk.rows.length > 0;
  }
  return false;
};

// ─── GET /api/v1/targets ───────────────────────────────────────────────────
// List target progress for all visible users (role-scoped) for a given month.
const getAllTargets = async (req, res, next) => {
  try {
    const { month, user_id } = req.query;
    const { role, id: callerId } = req.user;

    const range = resolveMonthRange(month);
    if (!range) return next(new AppError("month must be in YYYY-MM format", 400));

    let conditions = ["is_active = true"];
    let params = [];
    let idx = 1;

    if (role === "sales_executive") {
      conditions.push(`id = $${idx++}`); params.push(callerId);
    } else if (role === "sales_manager") {
      conditions.push(`(manager_id = $${idx++} OR id = $${idx++})`);
      params.push(callerId, callerId);
    }

    if (user_id) { conditions.push(`id = $${idx++}`); params.push(user_id); }

    const usersRes = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role
       FROM users WHERE ${conditions.join(" AND ")} ORDER BY first_name ASC`,
      params
    );

    const progress = await Promise.all(
      usersRes.rows.map((u) => buildProgress(u, range.monthStart, range.monthEnd))
    );

    return sendSuccess(res, "Targets fetched", {
      target_month: range.monthStart.slice(0, 7),
      targets: progress,
    });
  } catch (err) { next(err); }
};

// ─── GET /api/v1/targets/me ────────────────────────────────────────────────
// Shortcut for the logged-in user's own target/progress.
const getMyTarget = async (req, res, next) => {
  try {
    const { month } = req.query;
    const range = resolveMonthRange(month);
    if (!range) return next(new AppError("month must be in YYYY-MM format", 400));

    const userRes = await pool.query(
      "SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!userRes.rows.length) return next(new AppError("User not found", 404));

    const progress = await buildProgress(userRes.rows[0], range.monthStart, range.monthEnd);
    return sendSuccess(res, "Target fetched", progress);
  } catch (err) { next(err); }
};

// ─── GET /api/v1/targets/:userId ───────────────────────────────────────────
const getUserTarget = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { month } = req.query;
    const { role, id: callerId } = req.user;

    if (role === "sales_executive" && userId !== callerId) {
      return next(new AppError("Access denied", 403));
    }

    const range = resolveMonthRange(month);
    if (!range) return next(new AppError("month must be in YYYY-MM format", 400));

    const userRes = await pool.query(
      "SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, manager_id FROM users WHERE id = $1 AND is_active = true",
      [userId]
    );
    if (!userRes.rows.length) return next(new AppError("User not found", 404));

    if (role === "sales_manager" && userRes.rows[0].manager_id !== callerId && userId !== callerId) {
      return next(new AppError("Cannot view targets outside your team", 403));
    }

    const progress = await buildProgress(userRes.rows[0], range.monthStart, range.monthEnd);
    return sendSuccess(res, "Target fetched", progress);
  } catch (err) { next(err); }
};

// ─── POST /api/v1/targets/:userId ──────────────────────────────────────────
// Create (or upsert) a custom target for a user for a given month.
const setUserTarget = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const { month, site_visit_target, closure_target } = req.body;

    if (!(await canManageTarget(req.user, userId))) {
      return next(new AppError("Access denied", 403));
    }

    const userRes = await pool.query("SELECT id FROM users WHERE id = $1 AND is_active = true", [userId]);
    if (!userRes.rows.length) return next(new AppError("User not found", 404));

    const range = resolveMonthRange(month);
    if (!range) return next(new AppError("month must be in YYYY-MM format", 400));

    const finalSiteVisitTarget = site_visit_target !== undefined ? site_visit_target : DEFAULT_SITE_VISIT_TARGET;
    const finalClosureTarget   = closure_target    !== undefined ? closure_target    : DEFAULT_CLOSURE_TARGET;

    if (!Number.isInteger(finalSiteVisitTarget) || finalSiteVisitTarget < 0) {
      return next(new AppError("site_visit_target must be a non-negative integer", 400));
    }
    if (!Number.isInteger(finalClosureTarget) || finalClosureTarget < 0) {
      return next(new AppError("closure_target must be a non-negative integer", 400));
    }

    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO user_targets (user_id, target_month, site_visit_target, closure_target, set_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, target_month)
       DO UPDATE SET site_visit_target = $3, closure_target = $4, set_by = $5, updated_at = NOW()
       RETURNING *`,
      [userId, range.monthStart, finalSiteVisitTarget, finalClosureTarget, req.user.id]
    );
    await client.query("COMMIT");

    return sendSuccess(res, "Target set successfully", result.rows[0], 201);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

// ─── PUT /api/v1/targets/:userId ───────────────────────────────────────────
// Update an existing custom target (defaults to the current month if not given).
const updateUserTarget = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const { month, site_visit_target, closure_target } = req.body;

    if (!(await canManageTarget(req.user, userId))) {
      return next(new AppError("Access denied", 403));
    }
    if (site_visit_target === undefined && closure_target === undefined) {
      return next(new AppError("Provide site_visit_target and/or closure_target to update", 400));
    }

    const range = resolveMonthRange(month);
    if (!range) return next(new AppError("month must be in YYYY-MM format", 400));

    if (site_visit_target !== undefined && (!Number.isInteger(site_visit_target) || site_visit_target < 0)) {
      return next(new AppError("site_visit_target must be a non-negative integer", 400));
    }
    if (closure_target !== undefined && (!Number.isInteger(closure_target) || closure_target < 0)) {
      return next(new AppError("closure_target must be a non-negative integer", 400));
    }

    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO user_targets (user_id, target_month, site_visit_target, closure_target, set_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, target_month)
       DO UPDATE SET
         site_visit_target = COALESCE($3, user_targets.site_visit_target),
         closure_target     = COALESCE($4, user_targets.closure_target),
         set_by              = $5,
         updated_at          = NOW()
       RETURNING *`,
      [
        userId, range.monthStart,
        site_visit_target !== undefined ? site_visit_target : null,
        closure_target    !== undefined ? closure_target    : null,
        req.user.id,
      ]
    );
    await client.query("COMMIT");

    return sendSuccess(res, "Target updated successfully", result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

// ─── DELETE /api/v1/targets/:userId ────────────────────────────────────────
// Removes the custom target override, reverting to the default (15 / 1).
const deleteUserTarget = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { month } = req.query;

    if (!(await canManageTarget(req.user, userId))) {
      return next(new AppError("Access denied", 403));
    }

    const range = resolveMonthRange(month);
    if (!range) return next(new AppError("month must be in YYYY-MM format", 400));

    const result = await pool.query(
      "DELETE FROM user_targets WHERE user_id = $1 AND target_month = $2 RETURNING id",
      [userId, range.monthStart]
    );
    if (!result.rows.length) {
      return next(new AppError("No custom target found for this user/month — already at default", 404));
    }

    return sendSuccess(res, `Target reset to default (${DEFAULT_SITE_VISIT_TARGET} site visits / ${DEFAULT_CLOSURE_TARGET} closure)`);
  } catch (err) { next(err); }
};

module.exports = {
  getAllTargets,
  getMyTarget,
  getUserTarget,
  setUserTarget,
  updateUserTarget,
  deleteUserTarget,
};
