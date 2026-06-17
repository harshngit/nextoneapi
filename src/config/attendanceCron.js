/**
 * attendanceCron.js — Next One Realty CRM
 *
 *   10:00 AM IST — push + in-app notification to every active non-super_admin
 *                  user who has NOT yet checked in today.
 *
 * Sends both:
 *   1. FCM push notification (if device token registered)
 *   2. In-app notification (always)
 *
 * Called once from index.js: require('./config/attendanceCron').start()
 */

const { pool }                    = require('./db');
const { createNotification }      = require('../controllers/notificationController');
const { sendPushToMultipleTokens } = require('../utils/fcmService');

// ── IST helpers ───────────────────────────────────────────────────────────────
const toIST = (date) => {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + 330 * 60000);
};

const todayIST = () => toIST(new Date()).toISOString().split('T')[0];

const msUntilIST = (targetHour, targetMin) => {
  const now    = toIST(new Date());
  const target = new Date(now);
  target.setHours(targetHour, targetMin, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
};

// ── Core job ──────────────────────────────────────────────────────────────────
const runAttendanceReminders = async () => {
  const today = todayIST();
  console.log(`[Attendance Cron] Running check-in reminders for ${today}`);

  try {
    // Active non-super_admin users who haven't checked in, with all their FCM tokens
    const result = await pool.query(
      `SELECT u.id, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role,
              u.fcm_token,
              ARRAY_AGG(dt.fcm_token) FILTER (WHERE dt.fcm_token IS NOT NULL) AS device_tokens
       FROM users u
       LEFT JOIN device_tokens dt ON dt.user_id = u.id
       WHERE u.is_active = true
         AND u.role != 'super_admin'
         AND u.id NOT IN (
           SELECT a.user_id FROM attendance a
           WHERE a.date = $1 AND a.check_in_time IS NOT NULL
         )
       GROUP BY u.id`,
      [today]
    );

    console.log(`[Attendance Cron] ${result.rows.length} user(s) haven't checked in yet`);

    // Collect all unique FCM tokens across all users
    const allFcmTokens = [];
    const seenTokens   = new Set();
    for (const user of result.rows) {
      const tokens = (user.device_tokens || []).filter(Boolean);
      if (!tokens.length && user.fcm_token) tokens.push(user.fcm_token);
      tokens.forEach(t => {
        if (!seenTokens.has(t)) { seenTokens.add(t); allFcmTokens.push(t); }
      });
    }

    // Send FCM push to all tokens at once
    if (allFcmTokens.length > 0) {
      await sendPushToMultipleTokens(allFcmTokens, {
        title: 'Attendance Reminder',
        body:  "You haven't checked in yet. Please mark your attendance before 10:30 AM.",
        data:  { type: 'attendance_reminder', date: today },
      });
      console.log(`[Attendance Cron] FCM push sent to ${allFcmTokens.length} device(s)`);
    }

    // In-app notifications (always, per user)
    for (const user of result.rows) {
      try {
        await createNotification(user.id, {
          type:           'attendance_reminder',
          title:          "Don't forget to check in!",
          message:        "You haven't checked in yet today. Please mark your attendance before 10:30 AM.",
          reference_id:   null,
          reference_type: 'attendance',
          metadata:       { date: today, role: user.role },
        });
      } catch (e) {
        console.error(`[Attendance Cron] In-app notif failed for ${user.id}:`, e.message);
      }
    }

    console.log(`[Attendance Cron] Done — reminders sent to ${result.rows.length} user(s)`);
  } catch (e) {
    console.error('[Attendance Cron] Query failed:', e.message);
  }
};

// ── Schedule at 10:00 AM IST daily ───────────────────────────────────────────
const start = () => {
  console.log('[Attendance Cron] Scheduling check-in reminder (10:00 AM IST)...');

  const ms = msUntilIST(10, 0);
  console.log(`[Attendance Cron] First reminder fires in ${Math.round(ms / 60000)} min`);

  setTimeout(() => {
    runAttendanceReminders();
    setInterval(runAttendanceReminders, 24 * 60 * 60 * 1000);
  }, ms);

  console.log('[Attendance Cron] Scheduled');
};

module.exports = { start, runAttendanceReminders };
