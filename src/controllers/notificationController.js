const { pool } = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError  = require("../utils/AppError");
const { emitToUser } = require("../config/socket");

// ════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS — imported by other controllers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Insert one notification row and push it to the user via WebSocket.
 * Safe to call without await — errors are caught and logged.
 */
const createNotification = async (userId, {
  type            = 'general',
  title,
  message,
  reference_id    = null,
  reference_type  = null,
  metadata        = null,
}) => {
  try {
    const result = await pool.query(
      `INSERT INTO notifications
         (user_id, type, title, message, reference_id, reference_type, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        userId, type, title, message,
        reference_id, reference_type,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
    const notif = result.rows[0];
    emitToUser(String(userId), 'notification:new', notif);
    return notif;
  } catch (err) {
    console.error('[createNotification] error:', err.message);
    return null;
  }
};

/** Notify multiple users with the same payload. */
const createBulkNotifications = (userIds, payload) =>
  Promise.all(userIds.map(uid => createNotification(uid, payload)));

/** Notify every active admin and super_admin. */
const notifyAdmins = async (payload) => {
  const result = await pool.query(
    `SELECT id FROM users WHERE role IN ('super_admin','admin') AND is_active = true`
  );
  return createBulkNotifications(result.rows.map(r => r.id), payload);
};

/**
 * Notify the sales_manager of a lead when a site-visit / follow-up is created.
 * lead must have: id, name, assigned_to (exec id)
 */
const notifyManagerOfLeadAssignment = async (execId, lead) => {
  try {
    const mgr = await pool.query(
      `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`,
      [execId]
    );
    if (!mgr.rows.length) return;
    return createNotification(mgr.rows[0].manager_id, {
      type:           'lead_assigned',
      title:          'Lead Activity on Your Team',
      message:        `A site visit or follow-up was created for lead "${lead.name}"`,
      reference_id:   lead.id,
      reference_type: 'lead',
      metadata:       { lead_id: lead.id, exec_id: execId },
    });
  } catch (err) {
    console.error('[notifyManagerOfLeadAssignment] error:', err.message);
  }
};

// ─── 1. GET ALL NOTIFICATIONS ───────────────────────────────────────────────
const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { is_read, type, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = ["user_id = $1"];
    let params = [userId];
    let idx = 2;

    if (is_read !== undefined) {
      conditions.push(`is_read = $${idx++}`);
      params.push(is_read === 'true');
    }

    if (type) {
      conditions.push(`type = $${idx++}`);
      params.push(type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM notifications ${whereClause}`,
      params
    );

    const query = `
      SELECT * FROM notifications 
      ${whereClause} 
      ORDER BY created_at DESC 
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(parseInt(per_page), offset);

    const dataResult = await pool.query(query, params);

    const total = parseInt(countResult.rows[0].count);
    return res.json({
      ...paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)),
    });
  } catch (err) {
    next(err);
  }
};

// ─── 2. UNREAD COUNT ────────────────────────────────────────────────────────
const getUnreadCount = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false",
      [userId]
    );
    return sendSuccess(res, "Unread count returned", {
      unread_count: parseInt(result.rows[0].count),
    });
  } catch (err) {
    next(err);
  }
};

// ─── 3. NOTIFICATION TYPES ──────────────────────────────────────────────────
const getNotificationTypes = async (req, res, next) => {
  try {
    const types = [
      'lead_assigned', 'lead_status_changed', 'lead_new',
      'follow_up_created', 'follow_up_due', 'follow_up_overdue', 'follow_up_completed',
      'visit_scheduled', 'visit_reminder', 'visit_done', 'visit_cancelled', 'visit_rescheduled',
      'project_new', 'project_updated',
      'booking_new', 'payment_received', 'commission_credited',
      'task_created', 'task_reminder', 'task_completed',
      'general'
    ];

    const categories = {
      leads: ['lead_assigned', 'lead_status_changed', 'lead_new', 'booking_new'],
      follow_ups: ['follow_up_created', 'follow_up_due', 'follow_up_overdue', 'follow_up_completed'],
      site_visits: ['visit_scheduled', 'visit_reminder', 'visit_done', 'visit_cancelled', 'visit_rescheduled'],
      projects: ['project_new', 'project_updated'],
      payments: ['payment_received', 'commission_credited'],
      tasks: ['task_created', 'task_reminder', 'task_completed'],
      general: ['general']
    };

    return sendSuccess(res, "Notification types returned", { types, categories });
  } catch (err) {
    next(err);
  }
};

// ─── 4. MARK ALL READ ───────────────────────────────────────────────────────
const markAllRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      "UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
      [userId]
    );
    return sendSuccess(res, `${result.rowCount} notifications marked as read`);
  } catch (err) {
    next(err);
  }
};

// ─── 5. MARK ONE READ ───────────────────────────────────────────────────────
const markOneRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const result = await pool.query(
      "UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId]
    );
    if (!result.rows.length) return next(new AppError("Notification not found", 404));
    return sendSuccess(res, "Notification marked as read");
  } catch (err) {
    next(err);
  }
};

// ─── 6. DELETE ONE ──────────────────────────────────────────────────────────
const deleteNotification = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const result = await pool.query(
      "DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId]
    );
    if (!result.rows.length) return next(new AppError("Notification not found", 404));
    return sendSuccess(res, "Notification deleted");
  } catch (err) {
    next(err);
  }
};

// ─── 7. DELETE ALL ──────────────────────────────────────────────────────────
const deleteAllNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      "DELETE FROM notifications WHERE user_id = $1",
      [userId]
    );
    return sendSuccess(res, `${result.rowCount} notifications deleted`);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  // ── Route handlers ──────────────────────────────────────────────────────
  getNotifications,
  getUnreadCount,
  getNotificationTypes,
  markAllRead,
  markOneRead,
  deleteNotification,
  deleteAllNotifications,
  // ── Internal helpers (used by other controllers) ─────────────────────────
  createNotification,
  createBulkNotifications,
  notifyAdmins,
  notifyManagerOfLeadAssignment,
};