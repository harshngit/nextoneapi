const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { authenticate } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: >
 *     In-app notification system with real-time WebSocket delivery.
 *
 *     **WebSocket Connection:**
 *     ```js
 *     const socket = io("wss://nextoneapi-production.up.railway.app", {
 *       auth: { token: "YOUR_JWT_ACCESS_TOKEN" }
 *     });
 *     ```
 *
 *     **Events you can listen to:**
 *     | Event | Trigger |
 *     |-------|---------|
 *     | `notification:new` | Any new notification for the user |
 *     | `task:created` | A new task is assigned to you |
 *     | `task:updated` | A task you own is updated |
 *     | `task:completed` | A task is marked complete |
 *     | `task:reminder` | Task due soon (sent 30 min before) |
 *     | `lead:assigned` | A lead is assigned to you |
 *     | `lead:status_changed` | Status of your lead changed |
 *     | `visit:scheduled` | A site visit is scheduled for you |
 *     | `visit:reminder` | Visit reminder (sent day before) |
 */

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     summary: Get all notifications for logged-in user
 *     description: >
 *       Returns paginated notifications for the authenticated user,
 *       newest first. Filter by read/unread status.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: is_read
 *         schema:
 *           type: boolean
 *         description: Filter by read status. Omit for all.
 *         example: false
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [lead_assigned, task_created, task_reminder, visit_scheduled, visit_reminder, status_change, general]
 *         example: lead_assigned
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Notifications returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "notif-uuid-001"
 *                   type: "lead_assigned"
 *                   title: "New Lead Assigned"
 *                   message: "Lead Suresh Patel has been assigned to you"
 *                   is_read: false
 *                   reference_id: "lead-uuid-001"
 *                   reference_type: "lead"
 *                   created_at: "2025-04-20T10:00:00Z"
 *               pagination:
 *                 total: 18
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 1
 */
router.get("/", authenticate, notificationController.getNotifications);

/**
 * @swagger
 * /api/v1/notifications/unread-count:
 *   get:
 *     summary: Get count of unread notifications
 *     description: >
 *       Returns the number of unread notifications for the logged-in user.
 *       Call this on app load or poll it every 60 seconds as a fallback
 *       when WebSocket is not available.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 unread_count: 7
 */
router.get("/unread-count", authenticate, notificationController.getUnreadCount);

/**
 * @swagger
 * /api/v1/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     description: Marks every unread notification for the logged-in user as read.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "7 notifications marked as read"
 */
router.patch("/read-all", authenticate, notificationController.markAllRead);

/**
 * @swagger
 * /api/v1/notifications/{id}/read:
 *   patch:
 *     summary: Mark a single notification as read
 *     description: Marks a specific notification as read.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "notif-uuid-001"
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Notification marked as read"
 *       404:
 *         description: Notification not found
 */
router.patch("/:id/read", authenticate, notificationController.markOneRead);

/**
 * @swagger
 * /api/v1/notifications/{id}:
 *   delete:
 *     summary: Delete a notification
 *     description: Permanently deletes a notification. Users can only delete their own.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "notif-uuid-001"
 *     responses:
 *       200:
 *         description: Notification deleted
 *       404:
 *         description: Notification not found
 */
router.delete("/:id", authenticate, notificationController.deleteNotification);

module.exports = router;
