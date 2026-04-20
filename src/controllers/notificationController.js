const { pool } = require("../config/db");
const { sendSuccess, sendError, paginate } = require("../utils/response");
const { emitToUser } = require("../config/socket");

/**
 * Helper — create a notification in DB and push via WebSocket
 */
const createNotification = async (userId, { type, title, message, reference_id, reference_type }) => {
  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, reference_id, reference_type)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [userId, type, title, message, reference_id || null, reference_type || null]
  );
  const notif = result.rows[0];
  emitToUser(userId, "notification:new", notif);
  return notif;
};

/**
 * GET /api/v1/notifications
 */
const getNotifications = async (req, res) => {
  try {
    const { is_read, type, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [`user_id = $1`];
    const params = [req.user.id];
    let idx = 2;

    if (is_read !== undefined) { conditions.push(`is_read = $${idx++}`); params.push(is_read === "true"); }
    if (type)                  { conditions.push(`type = $${idx++}`);    params.push(type); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(`SELECT COUNT(*) FROM notifications ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT id, type, title, message, is_read, reference_id, reference_type, created_at
       FROM notifications ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    console.error("[getNotifications]", err);
    return sendError(res, "Failed to fetch notifications", 500);
  }
};

/**
 * GET /api/v1/notifications/unread-count
 */
const getUnreadCount = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false",
      [req.user.id]
    );
    return sendSuccess(res, "Unread count fetched", { unread_count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error("[getUnreadCount]", err);
    return sendError(res, "Failed to fetch count", 500);
  }
};

/**
 * PATCH /api/v1/notifications/read-all
 */
const markAllRead = async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
      [req.user.id]
    );
    return sendSuccess(res, `${result.rowCount} notifications marked as read`);
  } catch (err) {
    console.error("[markAllRead]", err);
    return sendError(res, "Failed to mark notifications", 500);
  }
};

/**
 * PATCH /api/v1/notifications/:id/read
 */
const markOneRead = async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return sendError(res, "Notification not found", 404);
    return sendSuccess(res, "Notification marked as read");
  } catch (err) {
    console.error("[markOneRead]", err);
    return sendError(res, "Failed to mark notification", 500);
  }
};

/**
 * DELETE /api/v1/notifications/:id
 */
const deleteNotification = async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return sendError(res, "Notification not found", 404);
    return sendSuccess(res, "Notification deleted");
  } catch (err) {
    console.error("[deleteNotification]", err);
    return sendError(res, "Failed to delete notification", 500);
  }
};

module.exports = { getNotifications, getUnreadCount, markAllRead, markOneRead, deleteNotification, createNotification };
