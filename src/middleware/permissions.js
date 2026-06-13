/**
 * permissions.js — Next One Realty CRM
 *
 * Permission-based access control middleware.
 * Works alongside (not instead of) the existing `authorize(...roles)`
 * middleware in auth.js — use this for module/action-level checks.
 *
 * ─────────────────────────────────────────────────────────────────
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────
 * 1. role_permissions table holds a JSONB matrix per role:
 *      { "leads": {"view":true,"create":true,...}, "projects": {...}, ... }
 * 2. This matrix is cached in memory (refreshed on every config update
 *    and on a 5-minute interval as a safety net) so we don't hit the
 *    DB on every request.
 * 3. super_admin ALWAYS passes — bypassed entirely, never stored in DB.
 * 4. For all other roles: checkPermission('leads','create') reads
 *    cache[req.user.role]['leads']['create'].
 * 5. user_permission_overrides table can override a single user's
 *    permission for one module+key — checked AFTER the role default,
 *    so an override always wins.
 *
 * ─────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────
 *   const { checkPermission } = require('../middleware/permissions');
 *
 *   router.post('/leads',     authenticate, checkPermission('leads','create'), ctrl.createLead);
 *   router.put('/leads/:id',  authenticate, checkPermission('leads','edit'),   ctrl.updateLead);
 *   router.delete('/leads/:id', authenticate, checkPermission('leads','delete'), ctrl.deleteLead);
 *
 * After PUT /api/v1/config/roles/:role, call refreshPermissionCache()
 * (already wired into configController.updateRolePermissions) so the
 * new permissions take effect immediately — no server restart needed.
 */

const { pool } = require('../config/db');
const AppError = require('../utils/AppError');

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Shape: { [role]: { [module]: { view, create, edit, delete, approve, export } } }
let permissionCache = {};
let lastLoaded = null;

const loadPermissionCache = async () => {
  try {
    const result = await pool.query('SELECT role, permissions FROM role_permissions');
    const next = {};
    for (const row of result.rows) {
      next[row.role] = row.permissions || {};
    }
    permissionCache = next;
    lastLoaded = new Date();
    console.log(`[Permissions] Cache refreshed — ${result.rows.length} role(s) loaded at ${lastLoaded.toISOString()}`);
  } catch (err) {
    console.error('[Permissions] Failed to load permission cache:', err.message);
  }
};

// Call this from configController after any PUT /config/roles/:role
const refreshPermissionCache = async () => {
  await loadPermissionCache();
};

// Safety-net refresh every 5 minutes in case cache gets out of sync
// (e.g. direct DB edits, multi-instance deployments without shared cache invalidation)
const startCacheRefreshInterval = () => {
  loadPermissionCache(); // initial load on server start
  setInterval(loadPermissionCache, 5 * 60 * 1000);
};

// ─── Per-user override lookup ────────────────────────────────────────────────
const getUserOverride = async (userId, module, action) => {
  try {
    const result = await pool.query(
      `SELECT value FROM user_permission_overrides
       WHERE user_id = $1 AND module = $2 AND permission_key = $3`,
      [userId, module, action]
    );
    return result.rows.length ? result.rows[0].value : null; // null = no override
  } catch (err) {
    console.error('[Permissions] Override lookup failed:', err.message);
    return null;
  }
};

// ─── Core middleware ──────────────────────────────────────────────────────────
/**
 * checkPermission(module, action)
 *
 * module: 'dashboard' | 'leads' | 'projects' | 'site_visits' | 'revisits' |
 *         'closures' | 'follow_ups' | 'attendance' | 'salary' | 'team' |
 *         'users' | 'phone_requests' | 'notifications'
 * action: 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export'
 */
const checkPermission = (module, action) => {
  return async (req, res, next) => {
    try {
      const { role, id: userId } = req.user;

      // super_admin always has full access — never stored in role_permissions
      if (role === 'super_admin') return next();

      // Lazy-load cache if empty (first request after server start)
      if (Object.keys(permissionCache).length === 0) {
        await loadPermissionCache();
      }

      // 1. Check per-user override first — it always wins
      const override = await getUserOverride(userId, module, action);
      if (override !== null) {
        if (override === true) return next();
        return next(new AppError(
          `You do not have permission to ${action} ${module} (overridden for your account)`, 403
        ));
      }

      // 2. Fall back to role default
      const rolePerm = permissionCache[role];
      const allowed  = rolePerm?.[module]?.[action] === true;

      if (!allowed) {
        return next(new AppError(
          `You do not have permission to ${action} ${module}`, 403
        ));
      }

      return next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = {
  checkPermission,
  loadPermissionCache,
  refreshPermissionCache,
  startCacheRefreshInterval,
  getUserOverride,
  // exposed for the /me/permissions endpoint
  _getCache: () => permissionCache,
};
