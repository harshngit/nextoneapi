const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/notificationController');
const { authenticate, authorize } = require('../middleware/auth');
const AppError = require('../utils/AppError');

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notifications with real-time WebSocket + FCM push delivery.
 */

// GET    /api/v1/notifications
router.get('/',             authenticate, ctrl.getNotifications);

// GET    /api/v1/notifications/unread-count
router.get('/unread-count', authenticate, ctrl.getUnreadCount);

// GET    /api/v1/notifications/types
router.get('/types',        authenticate, ctrl.getNotificationTypes);

// PATCH  /api/v1/notifications/read-all
router.patch('/read-all',   authenticate, ctrl.markAllRead);

// PATCH  /api/v1/notifications/:id/read
router.patch('/:id/read',   authenticate, ctrl.markOneRead);

// DELETE /api/v1/notifications/:id
router.delete('/:id',       authenticate, ctrl.deleteNotification);

// DELETE /api/v1/notifications
router.delete('/',          authenticate, ctrl.deleteAllNotifications);

// POST   /api/v1/notifications/test-email  (admin only)
router.post('/test-email', authenticate, authorize('super_admin', 'admin'), async (req, res, next) => {
  try {
    const emailService = require('../utils/emailService');
    const to = req.body.email || req.user.email;
    if (!to) return next(new AppError('Provide email in body', 400));
    await emailService.sendTestEmail(to);
    return res.json({ success: true, message: `Test email sent to ${to}` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Test email FAILED', error: err.message });
  }
});

module.exports = router;