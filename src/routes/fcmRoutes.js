const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/fcmController');
const { authenticate, authorize } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: FCM Push Notifications
 *   description: >
 *     Firebase Cloud Messaging (FCM) device token management and push notification delivery.
 *     Supports Android, iOS and Web browsers.
 *
 *     **Flow:**
 *     1. After login → call `POST /api/v1/fcm/token` to register device
 *     2. On logout  → call `DELETE /api/v1/fcm/token` to unregister device
 *     3. Web apps   → call `GET /api/v1/fcm/vapid-key` to get VAPID key first
 */

/**
 * @swagger
 * /api/v1/fcm/token:
 *   post:
 *     summary: Register or update a device FCM token
 *     description: >
 *       Call this after every login and whenever Firebase refreshes the token.
 *       Works for Android, iOS and Web.
 *     tags: [FCM Push Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fcm_token]
 *             properties:
 *               fcm_token:
 *                 type: string
 *                 example: "dX9k3Lm...long_fcm_token"
 *               platform:
 *                 type: string
 *                 enum: [android, ios, web]
 *                 default: android
 *     responses:
 *       200:
 *         description: Token saved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "FCM token saved successfully"
 *               data: { platform: "android" }
 *       400:
 *         description: fcm_token is required
 */
router.post('/token', authenticate, ctrl.saveToken);

/**
 * @swagger
 * /api/v1/fcm/token:
 *   delete:
 *     summary: Remove a device FCM token
 *     description: Call this on logout to stop push notifications on that device.
 *     tags: [FCM Push Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fcm_token]
 *             properties:
 *               fcm_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token removed
 */
router.delete('/token', authenticate, ctrl.removeToken);

/**
 * @swagger
 * /api/v1/fcm/devices:
 *   get:
 *     summary: Get all registered devices for the logged-in user
 *     tags: [FCM Push Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Devices returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 devices:
 *                   - id: "uuid"
 *                     platform: "android"
 *                     fcm_token_preview: "dX9k3Lm..."
 *                     created_at: "2025-06-01T10:00:00Z"
 *                     updated_at: "2025-06-20T08:00:00Z"
 */
router.get('/devices', authenticate, ctrl.getMyDevices);

/**
 * @swagger
 * /api/v1/fcm/devices:
 *   delete:
 *     summary: Remove ALL registered devices for the logged-in user
 *     description: Use for "logout from all devices" functionality.
 *     tags: [FCM Push Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All devices removed
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "2 device(s) removed"
 */
router.delete('/devices', authenticate, ctrl.removeAllDevices);

/**
 * @swagger
 * /api/v1/fcm/vapid-key:
 *   get:
 *     summary: Get Firebase VAPID public key (for web push)
 *     description: >
 *       The React web app calls this to get the VAPID key,
 *       then passes it to Firebase `getToken({ vapidKey })`.
 *     tags: [FCM Push Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: VAPID key returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 vapid_public_key: "BNt7y6...long_vapid_key"
 */
router.get('/vapid-key', authenticate, ctrl.getVapidKey);

/**
 * @swagger
 * /api/v1/fcm/test-push:
 *   post:
 *     summary: Send a test push notification (admin only)
 *     description: Sends a real FCM push to verify the full pipeline is working.
 *     tags: [FCM Push Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *                 description: Target user UUID. Defaults to the caller if omitted.
 *               title:
 *                 type: string
 *                 default: "Test Push — Next One Realty"
 *               body:
 *                 type: string
 *                 default: "FCM push notifications are working correctly!"
 *     responses:
 *       200:
 *         description: Test push sent
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Test push sent successfully"
 *               data:
 *                 devices_targeted: 2
 *       404:
 *         description: No FCM token registered for this user
 */
router.post('/test-push', authenticate, authorize('super_admin', 'admin'), ctrl.sendTestPush);

/**
 * @swagger
 * /api/v1/fcm/send:
 *   post:
 *     summary: Send a push notification to any user (admin only)
 *     description: Manually send a push to any user. Use for announcements or alerts.
 *     tags: [FCM Push Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, title, body]
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *               title:
 *                 type: string
 *                 example: "Important Update"
 *               body:
 *                 type: string
 *                 example: "Please check your leads dashboard."
 *               data:
 *                 type: object
 *                 description: Optional extra data sent with the push.
 *                 example: { reference_type: "lead", reference_id: "uuid" }
 *     responses:
 *       200:
 *         description: Push sent
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: No FCM token registered for this user
 */
router.post('/send', authenticate, authorize('super_admin', 'admin'), ctrl.sendPushToUser);

module.exports = router;
