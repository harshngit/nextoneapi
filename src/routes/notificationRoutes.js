const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { authenticate, authorize } = require("../middleware/auth");

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
 *     | `visit:done` | Site visit marked as done |
 *     | `visit:cancelled` | Site visit cancelled |
 *     | `project:new` | A new project has been added |
 *
 *     **All Notification Types:**
 *     | Type | Description |
 *     |------|-------------|
 *     | `lead_assigned` | Lead assigned to agent |
 *     | `lead_status_changed` | Lead status updated |
 *     | `lead_new` | New lead created (admins/managers) |
 *     | `follow_up_created` | Follow-up task created |
 *     | `follow_up_due` | Follow-up due today |
 *     | `follow_up_overdue` | Follow-up is overdue |
 *     | `follow_up_completed` | Follow-up marked complete |
 *     | `visit_scheduled` | Site visit scheduled |
 *     | `visit_reminder` | Visit reminder (day before) |
 *     | `visit_done` | Site visit completed |
 *     | `visit_cancelled` | Site visit cancelled |
 *     | `visit_rescheduled` | Site visit rescheduled |
 *     | `project_new` | New project added |
 *     | `project_updated` | Project details updated |
 *     | `booking_new` | New booking created |
 *     | `payment_received` | Payment received |
 *     | `commission_credited` | Commission credited |
 *     | `task_created` | Task assigned to user |
 *     | `task_reminder` | Task due reminder |
 *     | `task_completed` | Task marked complete |
 *     | `general` | General announcements |
 */

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     summary: Get all notifications for logged-in user
 *     description: >
 *       Returns paginated notifications for the authenticated user, newest first.
 *       Filter by read/unread status or by notification type.
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
 *           enum:
 *             - lead_assigned
 *             - lead_status_changed
 *             - lead_new
 *             - follow_up_created
 *             - follow_up_due
 *             - follow_up_overdue
 *             - follow_up_completed
 *             - visit_scheduled
 *             - visit_reminder
 *             - visit_done
 *             - visit_cancelled
 *             - visit_rescheduled
 *             - project_new
 *             - project_updated
 *             - booking_new
 *             - payment_received
 *             - commission_credited
 *             - task_created
 *             - task_reminder
 *             - task_completed
 *             - general
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
 *                   metadata: { source: "Facebook", budget: "80L" }
 *                   created_at: "2025-06-20T10:00:00Z"
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
 * /api/v1/notifications/types:
 *   get:
 *     summary: Get all available notification types
 *     description: >
 *       Returns the full list of notification types grouped by category.
 *       Use for filter dropdowns in the frontend.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Notification types returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 types:
 *                   - lead_assigned
 *                   - follow_up_due
 *                   - visit_scheduled
 *                 categories:
 *                   leads: [lead_assigned, lead_status_changed, lead_new, booking_new]
 *                   follow_ups: [follow_up_created, follow_up_due, follow_up_overdue, follow_up_completed]
 *                   site_visits: [visit_scheduled, visit_reminder, visit_done, visit_cancelled, visit_rescheduled]
 *                   projects: [project_new, project_updated]
 *                   payments: [payment_received, commission_credited]
 *                   tasks: [task_created, task_reminder, task_completed]
 *                   general: [general]
 */
router.get("/types", authenticate, notificationController.getNotificationTypes);

/**
 * @swagger
 * /api/v1/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
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
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       404:
 *         description: Notification not found
 */
router.patch("/:id/read", authenticate, notificationController.markOneRead);

/**
 * @swagger
 * /api/v1/notifications/{id}:
 *   delete:
 *     summary: Delete a single notification
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
 *     responses:
 *       200:
 *         description: Notification deleted
 *       404:
 *         description: Notification not found
 */
router.delete("/:id", authenticate, notificationController.deleteNotification);

/**
 * @swagger
 * /api/v1/notifications:
 *   delete:
 *     summary: Delete ALL notifications for the logged-in user
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications deleted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "24 notifications deleted"
 */
router.delete("/", authenticate, notificationController.deleteAllNotifications);

/**
 * @swagger
 * /api/v1/notifications/test-email:
 *   post:
 *     summary: Send a test email (admin only — use to verify SMTP is working)
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               email: { type: string, example: "admin@example.com" }
 *     responses:
 *       200:
 *         description: Test email sent successfully
 */
router.post('/test-email', authenticate, authorize('super_admin', 'admin'), async (req, res, next) => {
  try {
    const emailService = require('../utils/emailService');
    const to = req.body.email || req.user.email;
    if (!to) return next(new AppError('Provide email in body or ensure your account has an email', 400));
    await emailService.sendTestEmail(to);
    return res.json({ success: true, message: `Test email sent to ${to}` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Test email FAILED', error: err.message });
  }
});

module.exports = router;