/**
 * attendanceCron.js — Next One Realty CRM
 *
 * Runs one daily reminder job using the same setTimeout+setInterval pattern
 * as whatsappCron.js (no npm packages needed):
 *
 *   09:30 AM IST — push + in-app notification to every active non-super_admin
 *                  user who has NOT yet checked in today.
 *
 * Excluded: super_admin
 * Included: admin, sales_manager, sales_executive, external_caller, hr_admin
 *
 * Called once from index.js: require('./config/attendanceCron').start()
 */

const { pool }               = require('./db');
const { createNotification } = require('../controllers/notificationController');

// ── IST helpers (same pattern as whatsappCron) ────────────────────────────────
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
    // All active non-super_admin users who haven't checked in today
    const result = await pool.query(
      `SELECT u.id, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role
       FROM users u
       WHERE u.is_active = true
         AND u.role != 'super_admin'
         AND u.id NOT IN (
           SELECT a.user_id FROM attendance a
           WHERE a.date = $1 AND a.check_in_time IS NOT NULL
         )`,
      [today]
    );

    console.log(`[Attendance Cron] ${result.rows.length} user(s) haven't checked in yet`);

    for (const user of result.rows) {
      try {
        await createNotification(user.id, {
          type:           'attendance_reminder',
          title:          "Don't forget to check in!",
          message:        "You haven't checked in yet today. Please mark your attendance.",
          reference_id:   null,
          reference_type: 'attendance',
          metadata:       { date: today, role: user.role },
        });
      } catch (e) {
        console.error(`[Attendance Cron] Failed for user ${user.id}:`, e.message);
      }
    }

    console.log(`[Attendance Cron] Reminders sent to ${result.rows.length} user(s)`);
  } catch (e) {
    console.error('[Attendance Cron] Query failed:', e.message);
  }
};

// ── Schedule at 09:30 IST daily ───────────────────────────────────────────────
const start = () => {
  console.log('[Attendance Cron] Scheduling check-in reminder (9:30 AM IST)...');

  const ms = msUntilIST(9, 30);
  console.log(`[Attendance Cron] First reminder fires in ${Math.round(ms / 60000)} min`);

  setTimeout(() => {
    runAttendanceReminders();
    setInterval(runAttendanceReminders, 24 * 60 * 60 * 1000);
  }, ms);

  console.log('[Attendance Cron] Scheduled');
};

module.exports = { start, runAttendanceReminders };
