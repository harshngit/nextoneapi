/**
 * attendanceSalary.js — Next One Realty CRM
 *
 * Single source of truth for converting a month's attendance rows into
 * salary-relevant day counts (present/absent/leave), shared by every place
 * that computes or recalculates earned salary:
 *   - salaryController.generateSalarySlip / generateAllSalarySlips
 *   - attendanceController.changeAttendanceStatus / bulkChangeAttendanceStatus
 *   - attendanceController.getMyAttendance (live earned-salary preview)
 *
 * Pay rules:
 *   present                                            → 1.0 day
 *   late — 1st–3rd occurrence in the month, non-admin   → 1.0 day
 *   late — 4th+ occurrence in the month, non-admin      → 0.5 day (50% cut)
 *   late — any occurrence, admin/super_admin            → 1.0 day (never penalized)
 *   leave (leave_type = 'half_day')                     → 0.5 day
 *   leave (leave_type = 'holiday')                      → 1.0 day (paid — covers both
 *                                                            admin-created holidays and
 *                                                            the default weekly Monday off)
 *   leave (any other leave_type)                        → 0 day
 *   absent                                               → 0 day
 *
 * "Occurrence in the month" is ranked by date within the same user — the Nth
 * late check-in that calendar month, oldest first.
 */

const { pool } = require('../config/db')
const { ADMIN_ROLES } = require('./teamUtils')

// First N late arrivals in a month are free (full pay); the (N+1)th onward
// is a half-day, for non-admin roles only.
const LATE_FREE_COUNT = 3

/**
 * @param {string[]} userIds
 * @param {number} month 1-12
 * @param {number} year
 * @param {import('pg').Pool|import('pg').PoolClient} [db] — pass the active
 *   transaction client when called mid-transaction (e.g. right after an
 *   UPDATE on the same connection that hasn't committed yet), so this reads
 *   those uncommitted changes instead of stale data from a separate
 *   connection. Defaults to the shared pool.
 * @returns {Promise<Map<string, { presentDays:number, absentDays:number, leaveDays:number, halfDayFromLateCount:number }>>}
 */
const computeMonthlyAttendanceBreakdown = async (userIds, month, year, db = pool) => {
  const breakdown = new Map()
  if (!userIds.length) return breakdown

  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end   = new Date(year, month, 0).toISOString().split('T')[0]

  const r = await db.query(
    `WITH att AS (
       SELECT a.id, a.user_id, a.date, a.status, a.leave_type,
              (u.role = ANY($4::varchar[])) AS is_admin
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id = ANY($1::uuid[]) AND a.date BETWEEN $2 AND $3
     ),
     late_ranked AS (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY date ASC) AS late_seq
       FROM att WHERE status = 'late'
     )
     SELECT
       att.user_id,
       COUNT(*) FILTER (
         WHERE att.status = 'present'
            OR (att.status = 'leave' AND att.leave_type = 'holiday')
            OR (att.status = 'late' AND (att.is_admin OR lr.late_seq <= $5))
       ) AS full_present_count,
       COUNT(*) FILTER (
         WHERE att.status = 'late' AND NOT att.is_admin AND lr.late_seq > $5
       ) AS late_half_day_count,
       COUNT(*) FILTER (WHERE att.status = 'leave' AND att.leave_type = 'half_day') AS half_day_leave_count,
       COUNT(*) FILTER (
         WHERE att.status = 'leave' AND (att.leave_type IS NULL OR att.leave_type NOT IN ('half_day', 'holiday'))
       ) AS full_leave_count,
       COUNT(*) FILTER (WHERE att.status = 'absent') AS absent_count
     FROM att
     LEFT JOIN late_ranked lr ON lr.id = att.id
     GROUP BY att.user_id`,
    [userIds, start, end, ADMIN_ROLES, LATE_FREE_COUNT]
  )

  for (const row of r.rows) {
    const fullPresent  = parseFloat(row.full_present_count)   || 0
    const lateHalfDay  = parseFloat(row.late_half_day_count)  || 0
    const halfDayLeave = parseFloat(row.half_day_leave_count) || 0
    const fullLeave    = parseFloat(row.full_leave_count)     || 0
    const absent       = parseFloat(row.absent_count)         || 0

    breakdown.set(row.user_id, {
      presentDays:          fullPresent + (lateHalfDay * 0.5) + (halfDayLeave * 0.5),
      absentDays:           absent,
      leaveDays:            fullLeave + halfDayLeave,
      halfDayFromLateCount: lateHalfDay,
    })
  }

  // Users with zero attendance rows this month get an all-zero breakdown
  // rather than being absent from the Map entirely.
  userIds.forEach(id => {
    if (!breakdown.has(id)) {
      breakdown.set(id, { presentDays: 0, absentDays: 0, leaveDays: 0, halfDayFromLateCount: 0 })
    }
  })

  return breakdown
}

module.exports = { computeMonthlyAttendanceBreakdown, LATE_FREE_COUNT }
