const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging }                  = require('firebase-admin/messaging');

// ── Initialise Firebase Admin once ───────────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId    : process.env.FCM_PROJECT_ID,
      clientEmail  : process.env.FCM_CLIENT_EMAIL,
      privateKey   : (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

const messaging = getMessaging();

// ─────────────────────────────────────────────────────────────────────────────
// sendPushToToken
//   Sends a push notification to a single FCM device token.
//   Returns the FCM message ID on success, null on error.
// ─────────────────────────────────────────────────────────────────────────────
const sendPushToToken = async (fcmToken, { title, body, data = {} }) => {
  try {
    const message = {
      token       : fcmToken,
      notification: { title, body },
      data        : Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    const response = await messaging.send(message);
    console.log(`[FCM] Sent to token …${fcmToken.slice(-10)}: ${response}`);
    return response;
  } catch (err) {
    console.error('[FCM] sendPushToToken error:', err.message);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// sendPushToMultipleTokens
//   Sends the same notification to up to 500 tokens (FCM multicast limit).
//   Returns { successCount, failureCount, failedTokens }.
// ─────────────────────────────────────────────────────────────────────────────
const sendPushToMultipleTokens = async (fcmTokens, { title, body, data = {} }) => {
  if (!fcmTokens || fcmTokens.length === 0) return { successCount: 0, failureCount: 0, failedTokens: [] };

  try {
    const message = {
      tokens      : fcmTokens,
      notification: { title, body },
      data        : Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    const response = await messaging.sendEachForMulticast(message);

    const failedTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) failedTokens.push(fcmTokens[idx]);
    });

    console.log(`[FCM] Multicast: ${response.successCount} sent, ${response.failureCount} failed`);
    return {
      successCount : response.successCount,
      failureCount : response.failureCount,
      failedTokens,
    };
  } catch (err) {
    console.error('[FCM] sendPushToMultipleTokens error:', err.message);
    return { successCount: 0, failureCount: fcmTokens.length, failedTokens: fcmTokens };
  }
};

module.exports = { sendPushToToken, sendPushToMultipleTokens };