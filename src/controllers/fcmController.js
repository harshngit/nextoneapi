const { pool }   = require('../config/db');
const { sendSuccess } = require('../utils/response');
const AppError   = require('../utils/AppError');
const { sendPushToToken, sendPushToMultipleTokens } = require('../utils/fcmService');

// ════════════════════════════════════════════════════════════════════════════
// HELPER
// ════════════════════════════════════════════════════════════════════════════

const getFcmTokensForUser = async (userId) => {
  const multi = await pool.query(
    'SELECT fcm_token FROM device_tokens WHERE user_id = $1',
    [userId]
  );
  if (multi.rows.length > 0) return multi.rows.map(r => r.fcm_token);

  const single = await pool.query(
    'SELECT fcm_token FROM users WHERE id = $1 AND fcm_token IS NOT NULL',
    [userId]
  );
  return single.rows.length ? [single.rows[0].fcm_token] : [];
};

// ════════════════════════════════════════════════════════════════════════════
// CONTROLLERS
// ════════════════════════════════════════════════════════════════════════════

// ─── 1. SAVE / UPDATE FCM TOKEN ───────────────────────────────────────────
/**
 * POST /api/v1/fcm/token
 * Body: { fcm_token: string, platform?: 'android' | 'ios' | 'web' }
 *
 * Call this from mobile app AND web app:
 *   - right after login
 *   - whenever Firebase refreshes the token (onTokenRefresh)
 */
const saveToken = async (req, res, next) => {
  try {
    const { fcm_token, platform = 'android' } = req.body;
    const userId = req.user.id;

    if (!fcm_token) return next(new AppError('fcm_token is required', 400));

    const validPlatforms = ['android', 'ios', 'web'];
    if (!validPlatforms.includes(platform)) {
      return next(new AppError(`platform must be one of: ${validPlatforms.join(', ')}`, 400));
    }

    // Upsert into device_tokens (multi-device table)
    await pool.query(
      `INSERT INTO device_tokens (user_id, fcm_token, platform, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, fcm_token)
       DO UPDATE SET platform = EXCLUDED.platform, updated_at = NOW()`,
      [userId, fcm_token, platform]
    );

    // Mirror on users.fcm_token as fast single-device fallback
    await pool.query(
      'UPDATE users SET fcm_token = $1 WHERE id = $2',
      [fcm_token, userId]
    );

    return sendSuccess(res, 'FCM token saved successfully', { platform });
  } catch (err) { next(err); }
};

// ─── 2. REMOVE FCM TOKEN ─────────────────────────────────────────────────
/**
 * DELETE /api/v1/fcm/token
 * Body: { fcm_token: string }
 *
 * Call this on logout so the device stops receiving pushes.
 */
const removeToken = async (req, res, next) => {
  try {
    const { fcm_token } = req.body;
    const userId        = req.user.id;

    if (!fcm_token) return next(new AppError('fcm_token is required', 400));

    await pool.query(
      'DELETE FROM device_tokens WHERE user_id = $1 AND fcm_token = $2',
      [userId, fcm_token]
    );

    // Clear from users table if it matches
    await pool.query(
      'UPDATE users SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2',
      [userId, fcm_token]
    );

    return sendSuccess(res, 'FCM token removed successfully');
  } catch (err) { next(err); }
};

// ─── 3. GET ALL DEVICES FOR LOGGED-IN USER ───────────────────────────────
/**
 * GET /api/v1/fcm/devices
 *
 * Returns all registered devices for the logged-in user.
 */
const getMyDevices = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, platform, LEFT(fcm_token, 20) || '...' AS fcm_token_preview,
              created_at, updated_at
       FROM device_tokens
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.user.id]
    );
    return sendSuccess(res, 'Devices returned', { devices: result.rows });
  } catch (err) { next(err); }
};

// ─── 4. REMOVE ALL DEVICES FOR LOGGED-IN USER ────────────────────────────
/**
 * DELETE /api/v1/fcm/devices
 *
 * Removes ALL registered devices for the logged-in user.
 * Useful for "logout from all devices".
 */
const removeAllDevices = async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM device_tokens WHERE user_id = $1',
      [req.user.id]
    );
    await pool.query(
      'UPDATE users SET fcm_token = NULL WHERE id = $1',
      [req.user.id]
    );
    return sendSuccess(res, `${result.rowCount} device(s) removed`);
  } catch (err) { next(err); }
};

// ─── 5. GET VAPID PUBLIC KEY (for web push) ───────────────────────────────
/**
 * GET /api/v1/fcm/vapid-key
 *
 * The React web app calls this to get the VAPID key,
 * then passes it to Firebase getToken({ vapidKey }).
 */
const getVapidKey = (req, res) => {
  return res.json({
    success : true,
    message : 'VAPID public key',
    data    : { vapid_public_key: process.env.FCM_VAPID_PUBLIC_KEY },
  });
};

// ─── 6. SEND TEST PUSH (admin only) ──────────────────────────────────────
/**
 * POST /api/v1/fcm/test-push
 * Body: { user_id?: uuid, title?: string, body?: string }
 *
 * Sends a real FCM push to a user's registered devices.
 * Use during integration testing to verify the full pipeline.
 */
const sendTestPush = async (req, res, next) => {
  try {
    const {
      user_id,
      title = 'Test Push — Next One Realty',
      body  = 'FCM push notifications are working correctly!',
    } = req.body;

    const targetId  = user_id || req.user.id;
    const fcmTokens = await getFcmTokensForUser(targetId);

    if (fcmTokens.length === 0) {
      return next(new AppError('No FCM token registered for this user. Register a device first.', 404));
    }

    let result;
    if (fcmTokens.length === 1) {
      result = await sendPushToToken(fcmTokens[0], { title, body });
    } else {
      result = await sendPushToMultipleTokens(fcmTokens, { title, body });
    }

    return sendSuccess(res, 'Test push sent successfully', {
      devices_targeted: fcmTokens.length,
      result,
    });
  } catch (err) { next(err); }
};

// ─── 7. SEND PUSH TO SPECIFIC USER (admin only) ──────────────────────────
/**
 * POST /api/v1/fcm/send
 * Body: { user_id: uuid, title: string, body: string, data?: object }
 *
 * Manually send a push notification to any user.
 * Useful for announcements or manual alerts from admin panel.
 */
const sendPushToUser = async (req, res, next) => {
  try {
    const { user_id, title, body, data = {} } = req.body;

    if (!user_id) return next(new AppError('user_id is required', 400));
    if (!title)   return next(new AppError('title is required', 400));
    if (!body)    return next(new AppError('body is required', 400));

    const fcmTokens = await getFcmTokensForUser(user_id);

    if (fcmTokens.length === 0) {
      return next(new AppError('No FCM token registered for this user', 404));
    }

    let result;
    if (fcmTokens.length === 1) {
      result = await sendPushToToken(fcmTokens[0], { title, body, data });
    } else {
      result = await sendPushToMultipleTokens(fcmTokens, { title, body, data });
    }

    return sendSuccess(res, 'Push notification sent', {
      devices_targeted: fcmTokens.length,
      result,
    });
  } catch (err) { next(err); }
};

module.exports = {
  saveToken,
  removeToken,
  getMyDevices,
  removeAllDevices,
  getVapidKey,
  sendTestPush,
  sendPushToUser,
};
