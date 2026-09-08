/**
 * weeklyHolidayCron.js — Next One Realty CRM
 *
 * Marks every active user's attendance as the default weekly holiday every
 * Monday (IST) — runs once daily at 00:05 AM IST, no-ops on any other day.
 *
 * Uses the exact same row shape as an admin-created holiday
 * (status='leave', leave_type='holiday') so it's a fully paid day via
 * computeMonthlyAttendanceBreakdown (src/utils/attendanceSalary.js), and it
 * never blocks or overwrites a real check-in:
 *   - ON CONFLICT DO NOTHING — if a row already exists for that user/Monday
 *     (an admin-created holiday, an approved leave, etc.), it's left alone.
 *   - Once the user actually checks in later that day, checkIn() in
 *     attendanceController.js overwrites status/leave_type with the real
 *     present/late outcome based on check-in time — the holiday placeholder
 *     is just a default, never a block.
 *
 * Called once from index.js: require('./config/weeklyHolidayCron').start()
 */

const { pool } = require('./db')

// ── IST helpers (same pattern as attendanceCron.js) ────────────────────────────
const toIST = (date) => {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000
  return new Date(utc + 330 * 60000)
}

const todayIST = () => toIST(new Date()).toISOString().split('T')[0]
const isMondayIST = () => toIST(new Date()).getDay() === 1 // 0=Sun, 1=Mon

const msUntilIST = (targetHour, targetMin) => {
  const now = toIST(new Date())
  const target = new Date(now)
  target.setHours(targetHour, targetMin, 0, 0)
  if (target <= now) target.setDate(target.getDate() + 1)
  return target.getTime() - now.getTime()
}

// ── Core job ──────────────────────────────────────────────────────────────────
const syncMondayHoliday = async () => {
  if (!isMondayIST()) return
  const today = todayIST()
  console.log(`[Weekly Holiday Cron] Syncing Monday weekly-off for ${today}`)

  try {
    const r = await pool.query(
      `INSERT INTO attendance (user_id, date, status, leave_type, reason)
         SELECT id, $1::date, 'leave', 'holiday', 'Weekly Off (Monday)'
         FROM users WHERE is_active = true
       ON CONFLICT (user_id, date) DO NOTHING
       RETURNING user_id`,
      [today]
    )
    console.log(`[Weekly Holiday Cron] Marked ${r.rows.length} user(s) as Monday weekly-off for ${today}`)
  } catch (e) {
    console.error('[Weekly Holiday Cron] Sync failed:', e.message)
  }
}

// ── Schedule at 00:05 AM IST daily (no-ops on non-Mondays) ────────────────────
const start = () => {
  console.log('[Weekly Holiday Cron] Scheduling Monday weekly-off sync (12:05 AM IST)...')

  // Covers the case where the server starts up mid-Monday, after 00:05 AM
  // already passed for today.
  syncMondayHoliday()

  const ms = msUntilIST(0, 5)
  console.log(`[Weekly Holiday Cron] Next sync check in ${Math.round(ms / 60000)} min`)

  setTimeout(() => {
    syncMondayHoliday()
    setInterval(syncMondayHoliday, 24 * 60 * 60 * 1000)
  }, ms)

  console.log('[Weekly Holiday Cron] Scheduled')
}

module.exports = { start, syncMondayHoliday }
