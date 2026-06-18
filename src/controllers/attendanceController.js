const path     = require('path')
const fs       = require('fs')
const ExcelJS  = require('exceljs')
const { pool } = require('../config/db')
const { sendSuccess, sendError, paginate } = require('../utils/response')
const { getTeamIds, ADMIN_ROLES } = require('../utils/teamUtils')
const AppError = require('../utils/AppError')
const { createNotification, notifyAdmins } = require('./notificationController')

// ─── Salary recalculation helper ──────────────────────────────────────────────
// Counts Mon–Fri days in a given month/year (same logic as salaryController)
const countWorkingDays = (year, month) => {
  const daysInMonth = new Date(year, month, 0).getDate()
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month - 1, d).getDay()
    if (day !== 0 && day !== 6) count++
  }
  return count
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * ─── Attendance Rules ────────────────────────────────────────────────────────
 *
 * 4 statuses: present · late · absent · leave
 *
 * CHECK-IN (IST):
 *   Before or at 10:30 IST → present
 *   After 10:30 IST        → late  (+ late_by_minutes tracked)
 *
 * CHECK-OUT: recorded but does NOT change status.
 *
 * SALARY impact:
 *   present / late                      → 100% of per-day salary
 *   leave   (leave_type = 'half_day')   →  50% of per-day salary
 *   leave   (other)                     →   0%
 *   absent                              →   0%
 */

const CHECKIN_LATE_CUTOFF = '10:30' // after this IST → late

// Convert any Date to IST hours+minutes regardless of server timezone
const getISTMinutes = (date) => {
  const d = new Date(date)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d)
  const h = parseInt(parts.find(p => p.type === 'hour').value)
  const m = parseInt(parts.find(p => p.type === 'minute').value)
  return h * 60 + m
}

const resolveStatus = (checkInTime) => {
  try {
    const totalMinutes = getISTMinutes(checkInTime)
    const [cutH, cutM] = CHECKIN_LATE_CUTOFF.split(':').map(Number)
    const cutoffMins = cutH * 60 + cutM  // 10:30 = 630

    if (totalMinutes > cutoffMins) {
      return { status: 'late', lateMinutes: totalMinutes - cutoffMins }
    }
    return { status: 'present', lateMinutes: 0 }
  } catch {
    return { status: 'present', lateMinutes: 0 }
  }
}



const calcWorkingHours = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return null
  return parseFloat(((new Date(checkOut) - new Date(checkIn)) / 3600000).toFixed(2))
}

const getUserMeta = async (userId) => {
  const r = await pool.query(
    `SELECT id, first_name, last_name, role, email, phone_number FROM users WHERE id=$1`, [userId]
  )
  if (!r.rows.length) return null
  const u = r.rows[0]
  return { id: u.id, full_name: `${u.first_name} ${u.last_name||''}`.trim(), role: u.role, email: u.email, phone: u.phone_number }
}

const buildPhotoUrl = (file) => {
  if (!file) return null
  const subfolder = file.destination.split('attendance/')[1]
  return `/uploads/attendance/${subfolder}/${file.filename}`
}

// ─── Excel style helpers ──────────────────────────────────────────────────────

const STATUS_FILL = {
  present: { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD1FAE5' } },
  late:    { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFEF3C7' } },
  absent:  { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFEE2E2' } },
  leave:   { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE0E7FF' } },
  weekend: { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF3F4F6' } },
}
const STATUS_FONT = {
  present:'065F46', late:'92400E', absent:'991B1B',
  leave:'3730A3', weekend:'6B7280',
}

const applyHeaderStyle = (cell, argb = 'FF1E40AF') => {
  cell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb } }
  cell.font      = { bold:true, color:{ argb:'FFFFFFFF' }, size:11 }
  cell.alignment = { vertical:'middle', horizontal:'center', wrapText:true }
  cell.border    = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} }
}

const styleHeader = (row, argb = 'FF1E40AF') => {
  // Handles both a full Row and a single Cell
  if (row && typeof row.eachCell === 'function') {
    row.eachCell({ includeEmpty: true }, cell => applyHeaderStyle(cell, argb))
    row.height = 30
  } else if (row && row.value !== undefined) {
    // It's a single Cell
    applyHeaderStyle(row, argb)
  }
}

const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString('en-IN',{ hour:'2-digit', minute:'2-digit', hour12:true }) : '-'
const fmtDate = (d) => d  ? new Date(d).toLocaleDateString('en-IN',{ day:'2-digit', month:'short', year:'numeric' }) : '-'
const toDateStr = (d) => d instanceof Date ? d.toISOString().split('T')[0] : String(d).split('T')[0]

// ─── 1. UPLOAD PHOTO ─────────────────────────────────────────────────────────
const uploadPhoto = (req, res, next) => {
  try {
    if (!req.file) return next(new AppError('No photo uploaded', 400))
    return sendSuccess(res, 'Photo uploaded', { photo_url: buildPhotoUrl(req.file) }, 201)
  } catch (err) { next(err) }
}

// ─── 2. CHECK IN ─────────────────────────────────────────────────────────────
const checkIn = async (req, res, next) => {
  try {
    const userId = req.user.id
    const today  = new Date().toISOString().split('T')[0]

    const existing = await pool.query(
      `SELECT id, check_in_time FROM attendance WHERE user_id=$1 AND date=$2`, [userId, today]
    )
    if (existing.rows[0]?.check_in_time) {
      if (req.file) fs.unlink(req.file.path, ()=>{})
      return next(new AppError('Already checked in today', 400))
    }

    const { latitude, longitude, address, device, notes } = req.body
    const checkInTime            = new Date()
    const { status, lateMinutes } = resolveStatus(checkInTime)
    const photo                  = buildPhotoUrl(req.file)
    const ip                     = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    const userMeta               = await getUserMeta(userId)

    let record
    if (existing.rows.length) {
      const r = await pool.query(
        `UPDATE attendance SET check_in_time=$1, status=$2, late_by_minutes=$3,
           checkin_photo=COALESCE($4,checkin_photo),
           checkin_latitude=$5, checkin_longitude=$6, checkin_address=$7,
           checkin_ip=$8, checkin_device=$9, notes=COALESCE($10,notes), updated_at=NOW()
         WHERE user_id=$11 AND date=$12 RETURNING *`,
        [checkInTime, status, lateMinutes||null, photo, latitude||null, longitude||null, address||null, ip, device||null, notes||null, userId, today]
      )
      record = r.rows[0]
    } else {
      const r = await pool.query(
        `INSERT INTO attendance
           (user_id,date,check_in_time,status,late_by_minutes,checkin_photo,
            checkin_latitude,checkin_longitude,checkin_address,checkin_ip,checkin_device,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [userId, today, checkInTime, status, lateMinutes||null, photo, latitude||null, longitude||null, address||null, ip, device||null, notes||null]
      )
      record = r.rows[0]
    }

    const checkInMsg = status === 'late'
      ? `Checked in late — ${lateMinutes} minute${lateMinutes !== 1 ? 's' : ''} after 10:30 AM`
      : 'Checked in successfully'

    return sendSuccess(res, checkInMsg, { attendance: record, user: userMeta }, 201)
  } catch (err) { next(err) }
}

// ─── 3. CHECK OUT ─────────────────────────────────────────────────────────────
const checkOut = async (req, res, next) => {
  try {
    const userId = req.user.id
    const today  = new Date().toISOString().split('T')[0]

    const existing = await pool.query(`SELECT * FROM attendance WHERE user_id=$1 AND date=$2`, [userId, today])
    if (!existing.rows[0]?.check_in_time) {
      if (req.file) fs.unlink(req.file.path, ()=>{})
      return next(new AppError('You have not checked in yet today', 400))
    }
    if (existing.rows[0].check_out_time) {
      if (req.file) fs.unlink(req.file.path, ()=>{})
      return next(new AppError('Already checked out today', 400))
    }

    const { latitude, longitude, address, device, notes } = req.body
    const checkOutTime = new Date()
    const workingHours = calcWorkingHours(existing.rows[0].check_in_time, checkOutTime)
    const photo        = buildPhotoUrl(req.file)
    const ip           = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    const userMeta     = await getUserMeta(userId)
    const currentStatus = existing.rows[0].status

    const r = await pool.query(
      `UPDATE attendance SET check_out_time=$1, working_hours=$2,
         checkout_photo=COALESCE($3,checkout_photo),
         checkout_latitude=$4, checkout_longitude=$5, checkout_address=$6,
         checkout_ip=$7, checkout_device=$8, notes=COALESCE($9,notes), updated_at=NOW()
       WHERE user_id=$10 AND date=$11 RETURNING *`,
      [checkOutTime, workingHours, photo, latitude||null, longitude||null, address||null, ip, device||null, notes||null, userId, today]
    )

    return sendSuccess(res, 'Checked out successfully', {
      attendance:    r.rows[0],
      user:          userMeta,
      working_hours: workingHours,
      status:        currentStatus,
    })
  } catch (err) { next(err) }
}

// ─── 4. TODAY ────────────────────────────────────────────────────────────────
const getToday = async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0]
    const r = await pool.query(
      `SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role
       FROM attendance a JOIN users u ON u.id=a.user_id
       WHERE a.user_id=$1 AND a.date=$2`, [req.user.id, today]
    )
    const rec = r.rows[0] || null
    return sendSuccess(res, "Today's attendance", {
      date: today,
      is_checked_in:  !!(rec?.check_in_time),
      is_checked_out: !!(rec?.check_out_time),
      status:         rec?.status || 'absent',
      check_in_time:  rec?.check_in_time  || null,
      check_out_time: rec?.check_out_time || null,
      working_hours:  rec?.working_hours  || null,
      checkin_photo:  rec?.checkin_photo  || null,
      checkout_photo: rec?.checkout_photo || null,
      checkin_location:  rec ? { latitude:rec.checkin_latitude,  longitude:rec.checkin_longitude,  address:rec.checkin_address  } : null,
      checkout_location: rec ? { latitude:rec.checkout_latitude, longitude:rec.checkout_longitude, address:rec.checkout_address } : null,
      full_record: rec,
    })
  } catch (err) { next(err) }
}

// ─── 5. MY HISTORY ───────────────────────────────────────────────────────────
const getMyAttendance = async (req, res, next) => {
  try {
    const { from, to, page=1, per_page=30 } = req.query
    const userId = req.user.id
    const offset = (parseInt(page)-1)*parseInt(per_page)
    const now    = new Date()
    const start  = from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const end    = to   || now.toISOString().split('T')[0]

    // Determine month/year from the date range for salary calc
    const rangeStart   = new Date(start)
    const salaryMonth  = rangeStart.getMonth() + 1
    const salaryYear   = rangeStart.getFullYear()

    const [cnt, data, sum, salaryRec, slipRec] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3`, [userId,start,end]),
      pool.query(`SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role
         FROM attendance a JOIN users u ON u.id=a.user_id
         WHERE a.user_id=$1 AND a.date BETWEEN $2 AND $3
         ORDER BY a.date DESC LIMIT $4 OFFSET $5`, [userId,start,end,parseInt(per_page),offset]),
      pool.query(`SELECT
           COUNT(*) FILTER (WHERE status IN ('present','late')) AS present,
           COUNT(*) FILTER (WHERE status='absent') AS absent,
           COUNT(*) FILTER (WHERE status='leave') AS leave,
           COUNT(*) FILTER (WHERE status='late') AS late,
           COUNT(*) FILTER (WHERE status='leave' AND leave_type='half_day') AS half_day_leave,
           COALESCE(SUM(working_hours),0) AS total_working_hours
         FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3`, [userId,start,end]),
      // Get current monthly salary set by admin
      pool.query(
        `SELECT monthly_salary FROM employee_salaries
         WHERE user_id=$1
         ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
        [userId]
      ),
      // Get generated slip for this month if exists
      pool.query(
        `SELECT * FROM salary_slips WHERE user_id=$1 AND month=$2 AND year=$3 LIMIT 1`,
        [userId, salaryMonth, salaryYear]
      ),
    ])

    const s = sum.rows[0]
    const presentCount   = parseInt(s.present)
    const halfDayLeave   = parseInt(s.half_day_leave) || 0
    const presentDays    = presentCount + (halfDayLeave * 0.5)

    // Calculate earned salary on the fly from attendance
    let earnedSalary = null
    let monthlySalary = null
    let perDaySalary  = null
    let slip = slipRec.rows[0] || null

    if (salaryRec.rows[0]?.monthly_salary) {
      monthlySalary = parseFloat(salaryRec.rows[0].monthly_salary)

      // Working days in the month (Mon–Fri count)
      const daysInMonth = new Date(salaryYear, salaryMonth, 0).getDate()
      let workingDays = 0
      for (let d = 1; d <= daysInMonth; d++) {
        const day = new Date(salaryYear, salaryMonth - 1, d).getDay()
        if (day !== 0 && day !== 6) workingDays++
      }

      perDaySalary  = parseFloat((monthlySalary / workingDays).toFixed(2))
      earnedSalary  = parseFloat((perDaySalary * presentDays).toFixed(2))
    }

    return res.json({
      ...paginate(data.rows, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
      summary: {
        present:              parseInt(s.present),
        absent:               parseInt(s.absent),
        leave:                parseInt(s.leave),
        late:                 parseInt(s.late),
        total_working_hours:  parseFloat(s.total_working_hours),
      },
      salary: {
        monthly_salary:       monthlySalary,
        present_days:         presentDays,
        per_day_salary:       perDaySalary,
        earned_salary:        earnedSalary,
        // If a slip was generated by admin, show that (it may include deductions)
        slip_generated:       !!slip,
        slip_final_salary:    slip ? parseFloat(slip.final_salary) : null,
        slip_deductions:      slip ? parseFloat(slip.deductions)   : null,
      },
      period: { from:start, to:end },
    })
  } catch (err) { next(err) }
}

// ─── 5b. TEAM ATTENDANCE (sales_manager — their team only) ───────────────────
const getTeamAttendance = async (req, res, next) => {
  try {
    const { from, to, page = 1, per_page = 30, manager_id } = req.query
    const { role, id: callerId } = req.user

    const now   = new Date()
    const start = from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const end   = to   || now.toISOString().split('T')[0]
    const offset = (parseInt(page) - 1) * parseInt(per_page)

    // admin/super_admin → can pass manager_id to scope, or see all
    // hierarchy roles → recursive sub-tree via getTeamIds
    let teamIds = []
    if (ADMIN_ROLES.includes(role)) {
      if (manager_id) {
        teamIds = await getTeamIds(manager_id)
        teamIds = teamIds.filter(id => id !== manager_id)
      } else {
        return next(new AppError('manager_id is required for admin', 400))
      }
    } else {
      teamIds = await getTeamIds(callerId)
      teamIds = teamIds.filter(id => id !== callerId)
    }

    if (teamIds.length === 0) {
      return sendSuccess(res, 'No team members found', {
        period: { from: start, to: end }, team_size: 0,
        data: [], summary: { present:0, absent:0, late:0, leave:0, total_working_hours:0 },
        pagination: { total:0, page:1, per_page:parseInt(per_page), total_pages:0 },
      })
    }

    const [cnt, data, sum] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM attendance a WHERE a.user_id = ANY($1::uuid[]) AND a.date BETWEEN $2 AND $3`, [teamIds, start, end]),
      pool.query(`SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role, u.email, u.phone_number
         FROM attendance a JOIN users u ON u.id = a.user_id
         WHERE a.user_id = ANY($1::uuid[]) AND a.date BETWEEN $2 AND $3
         ORDER BY a.date DESC, u.first_name ASC LIMIT $4 OFFSET $5`,
        [teamIds, start, end, parseInt(per_page), offset]),
      pool.query(`SELECT
           COUNT(*) FILTER (WHERE status IN ('present','late'))      AS present,
           COUNT(*) FILTER (WHERE status = 'absent')                 AS absent,
           COUNT(*) FILTER (WHERE status = 'leave')                  AS leave,
           COUNT(*) FILTER (WHERE status = 'late')                   AS late,
           COALESCE(SUM(working_hours), 0)                           AS total_working_hours
         FROM attendance WHERE user_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3`,
        [teamIds, start, end]),
    ])

    const s = sum.rows[0]
    return res.json({
      ...paginate(data.rows, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
      summary: { present:parseInt(s.present), absent:parseInt(s.absent), leave:parseInt(s.leave), late:parseInt(s.late), total_working_hours:parseFloat(s.total_working_hours) },
      period: { from: start, to: end },
      team_size: teamIds.length,
    })
  } catch (err) { next(err) }
}

// ─── 6. BY DATE (all users for one day) ──────────────────────────────────────
const getByDate = async (req, res, next) => {
  try {
    const { date, user_id } = req.query
    const { role, id: callerId } = req.user
    if (!date) return next(new AppError('date query param required (YYYY-MM-DD)', 400))

    // Scope: admin sees all (or filter by user_id), hierarchy roles see recursive sub-tree, leaf roles see self
    let scopeFilter     = ''
    let scopeParams     = [date]
    let noRecScopeWhere = 'u.is_active=true'
    let noRecParams     = [date]
    let idx             = 2

    const LEAF = ['sales_executive', 'external_caller', 'hr_admin', 'digital_marketing']

    if (LEAF.includes(role)) {
      scopeFilter     = `AND a.user_id=$${++idx}`
      scopeParams     = [date, callerId]
      noRecScopeWhere = `u.is_active=true AND u.id=$2`
      noRecParams     = [date, callerId]
    } else if (!ADMIN_ROLES.includes(role)) {
      const teamIds = await getTeamIds(callerId)
      scopeFilter     = `AND a.user_id = ANY($${++idx}::uuid[])`
      scopeParams     = [date, teamIds]
      noRecScopeWhere = `u.is_active=true AND u.id = ANY($2::uuid[])`
      noRecParams     = [date, teamIds]
    } else if (user_id) {
      scopeFilter     = `AND a.user_id=$${++idx}`
      scopeParams     = [date, user_id]
      noRecScopeWhere = `u.is_active=true AND u.id=$2`
      noRecParams     = [date, user_id]
    }

    const [recs, noRec] = await Promise.all([
      pool.query(
        `SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role, u.email, u.phone_number, u.manager_id
         FROM attendance a JOIN users u ON u.id=a.user_id
         WHERE a.date=$1 ${scopeFilter} ORDER BY u.first_name ASC`, scopeParams
      ),
      pool.query(
        `SELECT u.id, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role, u.email, u.phone_number, u.manager_id
         FROM users u WHERE ${noRecScopeWhere}
           AND u.id NOT IN (SELECT user_id FROM attendance WHERE date=$1)
         ORDER BY u.first_name ASC`, noRecParams
      ),
    ])

    const summary = {
      present:  recs.rows.filter(r=>['present','late'].includes(r.status)).length,
      late:     recs.rows.filter(r=>r.status==='late').length,
      absent:   recs.rows.filter(r=>r.status==='absent').length + noRec.rows.length,
      leave:    recs.rows.filter(r=>r.status==='leave').length,
      total:    recs.rows.length + noRec.rows.length,
    }

    return sendSuccess(res, `Attendance for ${date}`, {
      date, summary,
      records:   recs.rows,
      no_record: noRec.rows.map(u=>({ ...u, status:'absent', check_in_time:null, check_out_time:null })),
    })
  } catch (err) { next(err) }
}

// ─── 7. BY MONTH (user × day grid) ───────────────────────────────────────────
const getByMonth = async (req, res, next) => {
  try {
    const { month=new Date().getMonth()+1, year=new Date().getFullYear(), user_id, manager_id, page=1, per_page=50 } = req.query
    const { role, id: callerId } = req.user
    const m      = parseInt(month)
    const y      = parseInt(year)
    const start  = `${y}-${String(m).padStart(2,'0')}-01`
    const end    = new Date(y,m,0).toISOString().split('T')[0]
    const offset = (parseInt(page)-1)*parseInt(per_page)

    // Scope: admin sees all (or filter by user_id/manager_id), hierarchy → recursive sub-tree
    let uFilter   = ''
    let uParams   = [parseInt(per_page), offset]
    let cntFilter = ''
    let cntParams = []
    let attFilter = ''
    let attParams = [start, end]

    const LEAF = ['sales_executive', 'external_caller', 'hr_admin', 'digital_marketing']

    if (LEAF.includes(role)) {
      uFilter   = 'AND id=$3'
      uParams   = [parseInt(per_page), offset, callerId]
      cntFilter = 'AND id=$1'
      cntParams = [callerId]
      attFilter = 'AND a.user_id=$3'
      attParams = [start, end, callerId]
    } else if (!ADMIN_ROLES.includes(role)) {
      const teamIds = await getTeamIds(callerId)
      uFilter   = 'AND id = ANY($3::uuid[])'
      uParams   = [parseInt(per_page), offset, teamIds]
      cntFilter = 'AND id = ANY($1::uuid[])'
      cntParams = [teamIds]
      attFilter = 'AND a.user_id = ANY($3::uuid[])'
      attParams = [start, end, teamIds]
    } else if (user_id) {
      uFilter   = 'AND id=$3'
      uParams   = [parseInt(per_page), offset, user_id]
      cntFilter = 'AND id=$1'
      cntParams = [user_id]
      attFilter = 'AND a.user_id=$3'
      attParams = [start, end, user_id]
    } else if (manager_id) {
      const mTeamIds = await getTeamIds(manager_id)
      uFilter   = 'AND id = ANY($3::uuid[])'
      uParams   = [parseInt(per_page), offset, mTeamIds]
      cntFilter = 'AND id = ANY($1::uuid[])'
      cntParams = [mTeamIds]
      attFilter = 'AND a.user_id = ANY($3::uuid[])'
      attParams = [start, end, mTeamIds]
    }
    // else: admin/super_admin with no filter → all users

    const [users, cnt, attRows] = await Promise.all([
      pool.query(`SELECT id,first_name,last_name,role,email FROM users WHERE is_active=true ${uFilter} ORDER BY first_name ASC LIMIT $1 OFFSET $2`, uParams),
      pool.query(`SELECT COUNT(*) FROM users WHERE is_active=true ${cntFilter}`, cntParams),
      pool.query(`SELECT a.* FROM attendance a WHERE a.date BETWEEN $1 AND $2 ${attFilter}`, attParams),
    ])

    const lookup = {}
    attRows.rows.forEach(r => {
      const d = toDateStr(r.date)
      if (!lookup[r.user_id]) lookup[r.user_id] = {}
      lookup[r.user_id][d] = r
    })

    const allDays = []
    const cur = new Date(start)
    while (cur <= new Date(end)) { allDays.push(cur.toISOString().split('T')[0]); cur.setDate(cur.getDate()+1) }

    const data = users.rows.map(u => {
      const days = allDays.map(date => {
        const isWk = [0,6].includes(new Date(date).getDay())
        const rec  = lookup[u.id]?.[date]
        return {
          date,
          day:            new Date(date).toLocaleDateString('en-IN',{weekday:'short'}),
          is_weekend:     isWk,
          status:         rec?.status || (isWk ? 'weekend' : 'absent'),
          check_in_time:  rec?.check_in_time  || null,
          check_out_time: rec?.check_out_time || null,
          working_hours:  rec?.working_hours  || null,
          checkin_photo:  rec?.checkin_photo  || null,
          checkout_photo: rec?.checkout_photo || null,
          checkin_address:  rec?.checkin_address  || null,
          checkout_address: rec?.checkout_address || null,
          is_manual_entry:  rec?.is_manual_entry  || false,
          reason:           rec?.reason || null,
        }
      })
      const wd = days.filter(d=>!d.is_weekend)
      return {
        user: { id:u.id, full_name:`${u.first_name} ${u.last_name||''}`.trim(), role:u.role, email:u.email },
        days,
        summary: {
          present:             wd.filter(d=>['present','late'].includes(d.status)).length,
          absent:              wd.filter(d=>d.status==='absent').length,
          leave:               wd.filter(d=>d.status==='leave').length,
          late:                wd.filter(d=>d.status==='late').length,
          total_working_hours: parseFloat(wd.reduce((s,d)=>s+(parseFloat(d.working_hours)||0),0).toFixed(2)),
          working_days:        wd.length,
        },
      }
    })

    return res.json({
      ...paginate(data, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
      month:m, year:y, period:{from:start,to:end}, all_days:allDays,
    })
  } catch (err) { next(err) }
}

// ─── 8. CALENDAR (single user) ────────────────────────────────────────────────
const getCalendar = async (req, res, next) => {
  try {
    const { role, id:callerId } = req.user
    const { user_id, month=new Date().getMonth()+1, year=new Date().getFullYear() } = req.query
    const targetId = ['super_admin','admin','sales_manager'].includes(role) ? (user_id||callerId) : callerId
    const m=parseInt(month), y=parseInt(year)
    const start=`${y}-${String(m).padStart(2,'0')}-01`
    const end=new Date(y,m,0).toISOString().split('T')[0]

    const userMeta = await getUserMeta(targetId)
    if (!userMeta) return next(new AppError('User not found',404))

    const recs = await pool.query(`SELECT * FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date ASC`, [targetId,start,end])
    const map  = {}
    recs.rows.forEach(r=>{ map[toDateStr(r.date)] = r })

    const days=[], cur=new Date(start), endDate=new Date(end)
    while (cur<=endDate) {
      const ds=cur.toISOString().split('T')[0], isWk=[0,6].includes(cur.getDay())
      days.push({ date:ds, day:cur.toLocaleDateString('en-IN',{weekday:'short'}), is_weekend:isWk, ...(map[ds]||{status:isWk?'weekend':'absent'}) })
      cur.setDate(cur.getDate()+1)
    }
    const wd=days.filter(d=>!d.is_weekend)
    return sendSuccess(res,'Calendar fetched',{
      user:userMeta, month:m, year:y, days,
      summary:{
        present:wd.filter(d=>['present','late'].includes(d.status)).length,
        absent:wd.filter(d=>d.status==='absent').length,
        leave:wd.filter(d=>d.status==='leave').length,
        late:wd.filter(d=>d.status==='late').length,
        total_working_hours:parseFloat(wd.reduce((s,d)=>s+(parseFloat(d.working_hours)||0),0).toFixed(2)),
        working_days:wd.length,
      },
    })
  } catch (err) { next(err) }
}

// ─── 9. BY USER ──────────────────────────────────────────────────────────────
const getByUser = async (req, res, next) => {
  try {
    const {user_id}=req.params, {from,to,page=1,per_page=30}=req.query
    const offset=(parseInt(page)-1)*parseInt(per_page)
    const now=new Date(), start=from||new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0], end=to||now.toISOString().split('T')[0]
    const uChk=await pool.query(`SELECT id,first_name,last_name,role,email FROM users WHERE id=$1`,[user_id])
    if (!uChk.rows.length) return next(new AppError('User not found',404))
    const [cnt,data,sum]=await Promise.all([
      pool.query(`SELECT COUNT(*) FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3`,[user_id,start,end]),
      pool.query(`SELECT a.*,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.user_id=$1 AND a.date BETWEEN $2 AND $3 ORDER BY a.date DESC LIMIT $4 OFFSET $5`,[user_id,start,end,parseInt(per_page),offset]),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status IN('present','late')) AS present,COUNT(*) FILTER (WHERE status='absent') AS absent,COUNT(*) FILTER (WHERE status='leave') AS leave,COUNT(*) FILTER (WHERE status='late') AS late,COALESCE(SUM(working_hours),0) AS total_working_hours FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3`,[user_id,start,end]),
    ])
    const u=uChk.rows[0], s=sum.rows[0]
    return res.json({
      ...paginate(data.rows,parseInt(cnt.rows[0].count),parseInt(page),parseInt(per_page)),
      user:{id:u.id,full_name:`${u.first_name} ${u.last_name||''}`.trim(),role:u.role,email:u.email},
      summary:{present:parseInt(s.present),absent:parseInt(s.absent),leave:parseInt(s.leave),late:parseInt(s.late),total_working_hours:parseFloat(s.total_working_hours)},
      period:{from:start,to:end},
    })
  } catch (err) { next(err) }
}

// ─── 10. ALL (admin) ─────────────────────────────────────────────────────────
const getAll = async (req, res, next) => {
  try {
    const {from,to,user_id,status,page=1,per_page=30}=req.query
    const offset=(parseInt(page)-1)*parseInt(per_page)
    const now=new Date(), start=from||new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0], end=to||now.toISOString().split('T')[0]
    const conds=['a.date BETWEEN $1 AND $2'], params=[start,end]; let idx=3
    if (user_id){conds.push(`a.user_id=$${idx++}`);params.push(user_id)}
    if (status) {conds.push(`a.status=$${idx++}`); params.push(status)}
    const where=`WHERE ${conds.join(' AND ')}`
    const [cnt,data,sum]=await Promise.all([
      pool.query(`SELECT COUNT(*) FROM attendance a ${where}`,params),
      pool.query(`SELECT a.*,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email,u.phone_number FROM attendance a JOIN users u ON u.id=a.user_id ${where} ORDER BY a.date DESC,u.first_name ASC LIMIT $${idx++} OFFSET $${idx++}`,[...params,parseInt(per_page),offset]),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status IN('present','late')) AS present,COUNT(*) FILTER (WHERE status='absent') AS absent,COUNT(*) FILTER (WHERE status='leave') AS leave,COUNT(*) FILTER (WHERE status='late') AS late FROM attendance a ${where}`,params),
    ])
    const s=sum.rows[0]
    return res.json({
      ...paginate(data.rows,parseInt(cnt.rows[0].count),parseInt(page),parseInt(per_page)),
      summary:{present:parseInt(s.present),absent:parseInt(s.absent),leave:parseInt(s.leave),late:parseInt(s.late)},
      period:{from:start,to:end},
    })
  } catch (err) { next(err) }
}

// ─── 11. SUMMARY ─────────────────────────────────────────────────────────────
const getSummary = async (req, res, next) => {
  try {
    const {from,to,user_id}=req.query
    const { role, id: callerId } = req.user
    const now=new Date(), start=from||new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0], end=to||now.toISOString().split('T')[0]
    const conds=['a.date BETWEEN $1 AND $2'], params=[start,end]; let idx=3
    const LEAF = ['sales_executive', 'external_caller', 'hr_admin', 'digital_marketing']
    if (LEAF.includes(role)) {
      conds.push(`u.id=$${idx++}`); params.push(callerId)
    } else if (!ADMIN_ROLES.includes(role)) {
      const teamIds = await getTeamIds(callerId)
      conds.push(`u.id = ANY($${idx++}::uuid[])`); params.push(teamIds)
    } else if (user_id) {
      conds.push(`u.id=$${idx++}`); params.push(user_id)
    }
    const r=await pool.query(
      `SELECT u.id,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email,
              COUNT(a.id) FILTER (WHERE a.status IN('present','late')) AS present,
              COUNT(a.id) FILTER (WHERE a.status='absent') AS absent,
              COUNT(a.id) FILTER (WHERE a.status='leave') AS leave,
              COUNT(a.id) FILTER (WHERE a.status='late') AS late,
              COUNT(a.id) AS total_days,
              COALESCE(SUM(a.working_hours),0) AS total_working_hours,
              MAX(a.date) FILTER (WHERE a.check_in_time IS NOT NULL) AS last_present
       FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND ${conds.join(' AND ')}
       WHERE u.is_active=true GROUP BY u.id ORDER BY u.first_name ASC`, params
    )
    return sendSuccess(res,'Summary fetched',{
      period:{from:start,to:end},
      data:r.rows.map(x=>({...x,present:parseInt(x.present),absent:parseInt(x.absent),leave:parseInt(x.leave),late:parseInt(x.late),total_days:parseInt(x.total_days),total_working_hours:parseFloat(x.total_working_hours),attendance_percent:parseInt(x.total_days)>0?parseFloat(((parseInt(x.present)/parseInt(x.total_days))*100).toFixed(1)):0})),
    })
  } catch (err) { next(err) }
}

// ─── 12. LATE ARRIVALS ───────────────────────────────────────────────────────
const getLateArrivals = async (req, res, next) => {
  try {
    const {from,to,user_id}=req.query
    const now=new Date(), start=from||new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0], end=to||now.toISOString().split('T')[0]
    const conds=[`a.status='late'`,'a.date BETWEEN $1 AND $2'], params=[start,end]; let idx=3
    if (user_id){conds.push(`a.user_id=$${idx++}`);params.push(user_id)}
    const r=await pool.query(`SELECT a.id,a.date,a.check_in_time,a.check_out_time,a.working_hours,a.checkin_address,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email FROM attendance a JOIN users u ON u.id=a.user_id WHERE ${conds.join(' AND ')} ORDER BY a.date DESC`,params)
    return sendSuccess(res,'Late arrivals fetched',{period:{from:start,to:end},total:r.rows.length,data:r.rows})
  } catch (err) { next(err) }
}

// ─── 13. MARK LEAVE ──────────────────────────────────────────────────────────
const markLeave = async (req, res, next) => {
  try {
    const {user_id,date,leave_type='full_day',reason}=req.body
    if (!user_id||!date) return next(new AppError('user_id and date required',400))
    const valid=['full_day','half_day','sick','casual','unpaid']
    if (!valid.includes(leave_type)) return next(new AppError(`leave_type must be one of: ${valid.join(', ')}`,400))
    const userMeta=await getUserMeta(user_id)
    if (!userMeta) return next(new AppError('User not found',404))
    const r=await pool.query(`INSERT INTO attendance (user_id,date,status,leave_type,reason,is_manual_entry,manual_by) VALUES ($1,$2,'leave',$3,$4,true,$5) ON CONFLICT (user_id,date) DO UPDATE SET status='leave',leave_type=EXCLUDED.leave_type,reason=EXCLUDED.reason,is_manual_entry=true,manual_by=EXCLUDED.manual_by,updated_at=NOW() RETURNING *`,[user_id,date,leave_type,reason||null,req.user.id])
    return sendSuccess(res,'Leave marked',{attendance:r.rows[0],user:userMeta},201)
  } catch (err) { next(err) }
}

// ─── 14. MANUAL ENTRY ────────────────────────────────────────────────────────
const manualEntry = async (req, res, next) => {
  try {
    const {user_id,date,status,check_in_time,check_out_time,reason}=req.body
    if (!user_id||!date||!status) return next(new AppError('user_id, date and status required',400))
    const valid=['present','absent','leave','late']
    if (!valid.includes(status)) return next(new AppError(`status must be one of: ${valid.join(', ')}`,400))
    const userMeta=await getUserMeta(user_id)
    if (!userMeta) return next(new AppError('User not found',404))
    const wh=calcWorkingHours(check_in_time,check_out_time)
    const r=await pool.query(`INSERT INTO attendance (user_id,date,status,check_in_time,check_out_time,working_hours,reason,is_manual_entry,manual_by) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) ON CONFLICT (user_id,date) DO UPDATE SET status=EXCLUDED.status,check_in_time=EXCLUDED.check_in_time,check_out_time=EXCLUDED.check_out_time,working_hours=EXCLUDED.working_hours,reason=EXCLUDED.reason,is_manual_entry=true,manual_by=EXCLUDED.manual_by,updated_at=NOW() RETURNING *`,[user_id,date,status,check_in_time||null,check_out_time||null,wh,reason||null,req.user.id])
    return sendSuccess(res,'Manual entry saved',{attendance:r.rows[0],user:userMeta},201)
  } catch (err) { next(err) }
}

// ─── 15. UPDATE ──────────────────────────────────────────────────────────────
const updateAttendance = async (req, res, next) => {
  try {
    const {id}=req.params
    const ex=await pool.query(`SELECT * FROM attendance WHERE id=$1`,[id])
    if (!ex.rows.length) return next(new AppError('Record not found',404))
    const {check_in_time,check_out_time,status,reason,notes}=req.body
    const rec=ex.rows[0]
    const ni=check_in_time!==undefined?check_in_time:rec.check_in_time
    const no=check_out_time!==undefined?check_out_time:rec.check_out_time
    const r=await pool.query(`UPDATE attendance SET check_in_time=COALESCE($1,check_in_time),check_out_time=COALESCE($2,check_out_time),working_hours=$3,status=COALESCE($4,status),reason=COALESCE($5,reason),notes=COALESCE($6,notes),is_manual_entry=true,manual_by=$7,updated_at=NOW() WHERE id=$8 RETURNING *`,[check_in_time||null,check_out_time||null,calcWorkingHours(ni,no),status||null,reason||null,notes||null,req.user.id,id])
    return sendSuccess(res,'Updated',{attendance:r.rows[0],user:await getUserMeta(r.rows[0].user_id)})
  } catch (err) { next(err) }
}

// ─── 16. DELETE ──────────────────────────────────────────────────────────────
const deleteAttendance = async (req, res, next) => {
  try {
    const r=await pool.query(`DELETE FROM attendance WHERE id=$1 RETURNING *`,[req.params.id])
    if (!r.rows.length) return next(new AppError('Record not found',404))
    const rec=r.rows[0]
    ;[rec.checkin_photo,rec.checkout_photo].forEach(p=>{if(p){const f=path.join(process.cwd(),p);if(fs.existsSync(f))fs.unlinkSync(f)}})
    return sendSuccess(res,'Record deleted')
  } catch (err) { next(err) }
}

// ─── 17. EXPORT EXCEL ────────────────────────────────────────────────────────
const exportExcel = async (req, res, next) => {
  try {
    const { month=new Date().getMonth()+1, year=new Date().getFullYear(), from, to, user_id } = req.query
    const m=parseInt(month), y=parseInt(year)
    const start = from || `${y}-${String(m).padStart(2,'0')}-01`
    const end   = to   || new Date(y,m,0).toISOString().split('T')[0]

    const uF   = user_id ? 'AND a.user_id=$3' : ''
    const uP   = user_id ? [start,end,user_id] : [start,end]
    const usrF = user_id ? 'AND id=$1' : ''
    const usrP = user_id ? [user_id] : []

    const [allRecs, usersRes] = await Promise.all([
      pool.query(`SELECT a.*,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email,u.phone_number FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.date BETWEEN $1 AND $2 ${uF} ORDER BY a.date ASC,u.first_name ASC`, uP),
      pool.query(`SELECT id,first_name,last_name,role,email FROM users WHERE is_active=true ${usrF} ORDER BY first_name ASC`, usrP),
    ])

    const allDays=[]
    const cur=new Date(start)
    while(cur<=new Date(end)){allDays.push(cur.toISOString().split('T')[0]);cur.setDate(cur.getDate()+1)}

    const lookup={}
    allRecs.rows.forEach(r=>{const d=toDateStr(r.date);if(!lookup[r.user_id])lookup[r.user_id]={};lookup[r.user_id][d]=r})

    const wb = new ExcelJS.Workbook()
    wb.creator='NextOne Realty CRM'; wb.created=new Date()

    // ── TAB 1: All Records ─────────────────────────────────────────
    const ws1 = wb.addWorksheet('All Records',{views:[{state:'frozen',xSplit:0,ySplit:2}],properties:{tabColor:{argb:'FF1E40AF'}}})
    ws1.mergeCells('A1:L1')
    const t1=ws1.getCell('A1')
    t1.value=`Attendance Records  |  ${fmtDate(start)} – ${fmtDate(end)}`
    t1.font={bold:true,size:13,color:{argb:'FFFFFFFF'}}; t1.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A8A'}}
    t1.alignment={vertical:'middle',horizontal:'center'}; ws1.getRow(1).height=32

    ws1.columns=[
      {key:'sno',width:6},{key:'name',width:24},{key:'role',width:18},{key:'date',width:14},
      {key:'status',width:14},{key:'in',width:12},{key:'out',width:12},{key:'wh',width:12},
      {key:'loc',width:26},{key:'manual',width:10},{key:'reason',width:22},{key:'email',width:26},
    ]
    const h1=ws1.getRow(2)
    h1.values=['#','Name','Role','Date','Status','Check-In','Check-Out','Working Hrs','Location','Manual?','Reason','Email']
    styleHeader(h1)

    allRecs.rows.forEach((r,i)=>{
      const d=toDateStr(r.date)
      const row=ws1.addRow({sno:i+1,name:r.full_name,role:r.role?.replace(/_/g,' '),date:fmtDate(d),
        status:r.status?.toUpperCase(),in:fmtTime(r.check_in_time),out:fmtTime(r.check_out_time),
        wh:r.working_hours?`${r.working_hours}h`:'-',loc:r.checkin_address||'-',
        manual:r.is_manual_entry?'Yes':'No',reason:r.reason||'-',email:r.email})
      row.height=20
      const stCell=row.getCell('status')
      if(STATUS_FILL[r.status]) stCell.fill=STATUS_FILL[r.status]
      stCell.font={bold:true,size:10,color:{argb:`FF${STATUS_FONT[r.status]||'111827'}`}}
      stCell.alignment={horizontal:'center',vertical:'middle'}
      if(i%2===0 && typeof row.eachCell==='function') row.eachCell(cell=>{if(!cell.fill?.fgColor?.argb||cell.fill.fgColor.argb==='00000000') cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF9FAFB'}}})
    })
    ws1.autoFilter={from:'A2',to:'L2'}

    // ── TAB 2: By Month Grid ───────────────────────────────────────
    const ws2 = wb.addWorksheet('By Month',{views:[{state:'frozen',xSplit:3,ySplit:3}],properties:{tabColor:{argb:'FF059669'}}})
    const monthLabel = new Date(y,m-1).toLocaleString('en-IN',{month:'long'})
    ws2.mergeCells(1,1,1,3+allDays.length)
    const t2=ws2.getCell('A1')
    t2.value=`Monthly Grid  |  ${monthLabel} ${y}`
    t2.font={bold:true,size:13,color:{argb:'FFFFFFFF'}}; t2.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF065F46'}}
    t2.alignment={vertical:'middle',horizontal:'center'}; ws2.getRow(1).height=32

    // DOW row
    const dow=ws2.getRow(2)
    ;[1,2,3].forEach(c=>{dow.getCell(c).value=''})
    allDays.forEach((d,i)=>{
      const isWk=[0,6].includes(new Date(d).getDay())
      const cell=dow.getCell(4+i)
      cell.value=new Date(d).toLocaleDateString('en-IN',{weekday:'short'})
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:isWk?'FFE5E7EB':'FFD1FAE5'}}
      cell.font={bold:true,size:8,color:{argb:isWk?'FF6B7280':'FF065F46'}}
      cell.alignment={horizontal:'center',vertical:'middle'}
    })
    ws2.getRow(2).height=16

    // Date numbers row
    const dr=ws2.getRow(3)
    dr.getCell(1).value='#'; dr.getCell(2).value='Employee'; dr.getCell(3).value='Role'
    ;[1,2,3].forEach(c=>styleHeader(dr.getCell(c)))
    allDays.forEach((d,i)=>{
      const isWk=[0,6].includes(new Date(d).getDay())
      const cell=dr.getCell(4+i)
      cell.value=parseInt(d.split('-')[2])
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:isWk?'FFD1D5DB':'FF1E40AF'}}
      cell.font={bold:true,size:8,color:{argb:'FFFFFFFF'}}
      cell.alignment={horizontal:'center',vertical:'middle'}
      cell.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'hair'},right:{style:'hair'}}
    })
    ws2.getRow(3).height=22

    ws2.getColumn(1).width=5; ws2.getColumn(2).width=22; ws2.getColumn(3).width=15
    allDays.forEach((_,i)=>{ ws2.getColumn(4+i).width=4.5 })

    usersRes.rows.forEach((u,ui)=>{
      const row=ws2.getRow(4+ui)
      row.getCell(1).value=ui+1
      row.getCell(2).value=`${u.first_name} ${u.last_name||''}`.trim()
      row.getCell(3).value=u.role?.replace(/_/g,' ')
      ;[1,2,3].forEach(c=>{row.getCell(c).font={size:10};row.getCell(c).alignment={vertical:'middle'};row.getCell(c).border={top:{style:'hair'},bottom:{style:'hair'},left:{style:'thin'},right:{style:'thin'}}})
      allDays.forEach((d,i)=>{
        const isWk=[0,6].includes(new Date(d).getDay())
        const rec=lookup[u.id]?.[d]
        const st=rec?.status||(isWk?'weekend':'absent')
        const abbr={present:'P',late:'L',absent:'A',leave:'LV',weekend:'-'}
        const cell=row.getCell(4+i)
        cell.value=abbr[st]||st.charAt(0).toUpperCase()
        cell.alignment={horizontal:'center',vertical:'middle'}
        cell.font={size:8,bold:true,color:{argb:`FF${STATUS_FONT[st]||'111827'}`}}
        if(STATUS_FILL[st]) cell.fill=STATUS_FILL[st]
        cell.border={top:{style:'hair'},bottom:{style:'hair'},left:{style:'hair'},right:{style:'hair'}}
      })
      row.height=18
    })

    // Legend
    const legRow=ws2.getRow(4+usersRes.rows.length+2)
    legRow.getCell(1).value='Legend:'; legRow.getCell(1).font={bold:true,size:10}
    const leg=[['P','Present','D1FAE5','065F46'],['L','Late','FEF3C7','92400E'],['A','Absent','FEE2E2','991B1B'],['LV','Leave','E0E7FF','3730A3'],['-','Weekend','F3F4F6','6B7280']]
    leg.forEach((l,i)=>{
      const c=legRow.getCell(2+i)
      c.value=`${l[0]}=${l[1]}`; c.fill={type:'pattern',pattern:'solid',fgColor:{argb:`FF${l[2]}`}}
      c.font={size:9,bold:true,color:{argb:`FF${l[3]}`}}; c.alignment={horizontal:'center',vertical:'middle'}
      c.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}
    })
    legRow.height=20

    // ── TAB 3: Summary ─────────────────────────────────────────────
    const ws3=wb.addWorksheet('Summary',{views:[{state:'frozen',xSplit:0,ySplit:2}],properties:{tabColor:{argb:'FF7C3AED'}}})
    ws3.mergeCells('A1:K1')
    const t3=ws3.getCell('A1')
    t3.value=`Summary  |  ${fmtDate(start)} – ${fmtDate(end)}`
    t3.font={bold:true,size:13,color:{argb:'FFFFFFFF'}}; t3.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF4C1D95'}}
    t3.alignment={vertical:'middle',horizontal:'center'}; ws3.getRow(1).height=32
    ws3.columns=[{key:'sno',width:6},{key:'name',width:24},{key:'role',width:18},{key:'present',width:10},{key:'late',width:8},{key:'absent',width:10},{key:'leave',width:10},{key:'wh',width:14},{key:'pct',width:14},{key:'last',width:16},{key:'email',width:26}]
    const h3=ws3.getRow(2)
    h3.values=['#','Employee','Role','Present','Late','Absent','Leave','Working Hrs','Attend %','Last Seen','Email']
    styleHeader(h3,'FF4C1D95')

    const sr=await pool.query(`SELECT u.id,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email,COUNT(a.id) FILTER(WHERE a.status IN('present','late')) AS present,COUNT(a.id) FILTER(WHERE a.status='late') AS late,COUNT(a.id) FILTER(WHERE a.status='absent') AS absent,COUNT(a.id) FILTER(WHERE a.status='leave') AS leave,COUNT(a.id) AS total_days,COALESCE(SUM(a.working_hours),0) AS total_wh,MAX(a.date) FILTER(WHERE a.check_in_time IS NOT NULL) AS last_present FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date BETWEEN $1 AND $2 WHERE u.is_active=true ${user_id?'AND u.id=$3':''} GROUP BY u.id ORDER BY u.first_name ASC`, user_id?[start,end,user_id]:[start,end])

    sr.rows.forEach((r,i)=>{
      const pct=parseInt(r.total_days)>0?((parseInt(r.present)/parseInt(r.total_days))*100).toFixed(1):0
      const row=ws3.addRow({sno:i+1,name:r.full_name,role:r.role?.replace(/_/g,' '),present:parseInt(r.present),late:parseInt(r.late),absent:parseInt(r.absent),leave:parseInt(r.leave),wh:`${parseFloat(r.total_wh).toFixed(1)}h`,pct:`${pct}%`,last:r.last_present?fmtDate(r.last_present):'-',email:r.email})
      row.height=20
      if(typeof row.eachCell==='function'){row.eachCell(c=>{c.alignment={vertical:'middle',horizontal:'center'}})}
      row.getCell(2).alignment={vertical:'middle',horizontal:'left'}; row.getCell(3).alignment={vertical:'middle',horizontal:'left'}
      const pn=parseFloat(pct)
      const pc=row.getCell('pct')
      pc.fill={type:'pattern',pattern:'solid',fgColor:{argb:pn>=90?'FFD1FAE5':pn>=75?'FFFEF3C7':'FFFEE2E2'}}
      pc.font={bold:true,color:{argb:`FF${pn>=90?'065F46':pn>=75?'92400E':'991B1B'}`}}
      if(i%2===0 && typeof row.eachCell==='function') row.eachCell(c=>{if(!c.fill?.fgColor?.argb||c.fill.fgColor.argb==='00000000') c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF9FAFB'}}})
    })
    ws3.autoFilter={from:'A2',to:'K2'}

    // ── TAB 4: Late Arrivals ───────────────────────────────────────
    const ws4=wb.addWorksheet('Late Arrivals',{views:[{state:'frozen',xSplit:0,ySplit:2}],properties:{tabColor:{argb:'FFD97706'}}})
    ws4.mergeCells('A1:H1')
    const t4=ws4.getCell('A1')
    t4.value=`Late Arrivals  |  ${fmtDate(start)} – ${fmtDate(end)}`
    t4.font={bold:true,size:13,color:{argb:'FFFFFFFF'}}; t4.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF92400E'}}
    t4.alignment={vertical:'middle',horizontal:'center'}; ws4.getRow(1).height=32
    ws4.columns=[{key:'sno',width:6},{key:'name',width:24},{key:'role',width:18},{key:'date',width:14},{key:'in',width:12},{key:'out',width:12},{key:'wh',width:12},{key:'loc',width:30}]
    const h4=ws4.getRow(2); h4.values=['#','Employee','Role','Date','Check-In','Check-Out','Working Hrs','Location']; styleHeader(h4,'FF92400E')

    allRecs.rows.filter(r=>r.status==='late').forEach((r,i)=>{
      const d=toDateStr(r.date)
      const row=ws4.addRow({sno:i+1,name:r.full_name,role:r.role?.replace(/_/g,' '),date:fmtDate(d),in:fmtTime(r.check_in_time),out:fmtTime(r.check_out_time),wh:r.working_hours?`${r.working_hours}h`:'-',loc:r.checkin_address||'-'})
      row.height=20
      const ic=row.getCell('in'); ic.fill=STATUS_FILL.late; ic.font={bold:true,color:{argb:'FF92400E'}}; ic.alignment={horizontal:'center',vertical:'middle'}
      if(i%2===0 && typeof row.eachCell==='function') row.eachCell(c=>{if(!c.fill?.fgColor?.argb||c.fill.fgColor.argb==='00000000') c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFBEB'}}})
    })
    ws4.autoFilter={from:'A2',to:'H2'}

    // ── Stream ─────────────────────────────────────────────────────
    const filename=`Attendance_${monthLabel}_${y}.xlsx`
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`)
    res.setHeader('Cache-Control','no-cache')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

// ─── EOD CRON ─────────────────────────────────────────────────────────────────
const markAbsentEOD = async () => {
  try {
    const today=new Date().toISOString().split('T')[0]
    const r=await pool.query(`INSERT INTO attendance(user_id,date,status) SELECT u.id,$1,'absent' FROM users u WHERE u.is_active=true AND u.id NOT IN(SELECT user_id FROM attendance WHERE date=$1) ON CONFLICT(user_id,date) DO NOTHING RETURNING user_id`,[today])
    console.log(`[EOD Cron] ${r.rows.length} users marked absent for ${today}`)
    return r.rows.length
  } catch(err) { console.error('[markAbsentEOD]',err) }
}


// ─── APPROVE / CHANGE STATUS (admin/super_admin only) ────────────────────────
/**
 * PATCH /api/v1/attendance/:id/approve
 * Body: { status: 'present'|'absent'|'leave'|'late', reason? }
 * Only super_admin and admin can call this.
 * Use case: employee checks in, admin reviews and approves/changes status.
 */
const approveStatus = async (req, res, next) => {
  try {
    const { id } = req.params
    const { status, reason } = req.body

    const validStatuses = ['present', 'absent', 'leave', 'late']
    if (!status || !validStatuses.includes(status)) {
      return next(new AppError(`status is required and must be one of: ${validStatuses.join(', ')}`, 400))
    }

    // Check record exists
    const existing = await pool.query(
      `SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role, u.email
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`, [id]
    )
    if (!existing.rows.length) return next(new AppError('Attendance record not found', 404))

    const rec       = existing.rows[0]
    const oldStatus = rec.status

    const result = await pool.query(
      `UPDATE attendance SET
         status          = $1,
         manual_reason   = $2,
         is_manual_entry = true,
         manual_by       = $3,
         updated_at      = NOW()
       WHERE id = $4 RETURNING *`,
      [status, reason || `Status changed from ${oldStatus} to ${status} by admin`, req.user.id, id]
    )

    const approvedBy = await getUserMeta(req.user.id)

    return sendSuccess(res, `Status updated to "${status}" successfully`, {
      attendance: result.rows[0],
      employee: {
        full_name: rec.full_name,
        role:      rec.role,
        email:     rec.email,
      },
      change: {
        old_status: oldStatus,
        new_status: status,
        reason:     reason || null,
        approved_by: approvedBy?.full_name,
        approved_at: new Date().toISOString(),
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/v1/attendance/pending
 * Returns today's records that are missing check-out (still "open") 
 * or records flagged for admin review.
 * Admin uses this to see who needs approval.
 */
const getPendingApprovals = async (req, res, next) => {
  try {
    const { date = new Date().toISOString().split('T')[0] } = req.query

    const result = await pool.query(
      `SELECT
         a.*,
         CONCAT(u.first_name,' ',u.last_name) AS full_name,
         u.role, u.email, u.phone_number
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.date = $1
         AND (
           -- Checked in but not out yet (past office hours)
           (a.check_in_time IS NOT NULL AND a.check_out_time IS NULL)
           OR
           -- Not checked in at all (absent — may need approval as leave)
           (a.check_in_time IS NULL AND a.status = 'absent')
           OR
           -- Flagged late
           (a.status = 'late')
         )
       ORDER BY u.first_name ASC`,
      [date]
    )

    const summary = {
      not_checked_out:  result.rows.filter(r => r.check_in_time && !r.check_out_time).length,
      absent:           result.rows.filter(r => !r.check_in_time && r.status === 'absent').length,
      late:             result.rows.filter(r => r.status === 'late').length,
      total:            result.rows.length,
    }

    return sendSuccess(res, 'Pending approvals fetched', { date, summary, records: result.rows })
  } catch (err) {
    next(err)
  }
}

// ─── PATCH /api/v1/attendance/:id/status ─────────────────────────────────────
/**
 * Change an attendance record status AND automatically recalculate
 * the salary slip for that month if one exists.
 *
 * Body: { status, reason? }
 * status: present | absent | leave | late
 *
 * Salary recalculation rules (same as generateSalarySlip):
 *   present / late  → 1.0 day
 *   leave (half_day leave_type) → 0.5 day
 *   leave (other) / absent → 0 day
 *
 * Response includes:
 *   - updated attendance record
 *   - updated salary slip (if it existed for that month)
 *   - salary diff showing how much changed
 */
const changeAttendanceStatus = async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { id }             = req.params
    const { status, reason } = req.body

    const VALID = ['present', 'absent', 'leave', 'late']
    if (!status || !VALID.includes(status)) {
      return next(new AppError(`status is required and must be one of: ${VALID.join(', ')}`, 400))
    }

    // ── Fetch attendance record ───────────────────────────────────────────────
    const attRes = await pool.query(
      `SELECT a.*, 
              CONCAT(u.first_name,' ',u.last_name) AS full_name,
              u.role, u.email, u.id AS uid
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [id]
    )
    if (!attRes.rows.length) return next(new AppError('Attendance record not found', 404))

    const rec       = attRes.rows[0]
    const oldStatus = rec.status
    const userId    = rec.user_id

    if (oldStatus === status) {
      return next(new AppError(`Status is already "${status}"`, 400))
    }

    // ── Extract month and year from attendance date ───────────────────────────
    const attDate = new Date(rec.date)
    const month   = attDate.getMonth() + 1   // 1–12
    const year    = attDate.getFullYear()

    await client.query('BEGIN')

    // ── Step 1: Update attendance status ─────────────────────────────────────
    const updatedAtt = await client.query(
      `UPDATE attendance
       SET status          = $1,
           manual_reason   = $2,
           is_manual_entry = true,
           manual_by       = $3,
           updated_at      = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        status,
        reason || `Status changed from ${oldStatus} to ${status} by admin`,
        req.user.id,
        id,
      ]
    )

    // ── Step 2: Check if a salary slip exists for this month ──────────────────
    const slipRes = await client.query(
      `SELECT * FROM salary_slips WHERE user_id = $1 AND month = $2 AND year = $3`,
      [userId, month, year]
    )

    let updatedSlip   = null
    let salaryImpact  = null

    if (slipRes.rows.length) {
      const existingSlip = slipRes.rows[0]

      // ── Step 3: Recalculate attendance totals for the whole month ─────────
      const start = `${year}-${String(month).padStart(2, '0')}-01`
      const end   = new Date(year, month, 0).toISOString().split('T')[0]

      const attSummary = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('present','late'))                       AS present_count,
           COUNT(*) FILTER (WHERE status = 'leave' AND leave_type = 'half_day')      AS half_day_leave_count,
           COUNT(*) FILTER (WHERE status = 'leave' AND (leave_type IS NULL OR leave_type != 'half_day')) AS full_leave_count,
           COUNT(*) FILTER (WHERE status = 'absent')                                 AS absent_count
         FROM attendance
         WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
        [userId, start, end]
      )

      const att              = attSummary.rows[0]
      const presentCount     = parseFloat(att.present_count)          || 0
      const halfDayLeaveCount = parseFloat(att.half_day_leave_count) || 0
      const fullLeaveCount   = parseFloat(att.full_leave_count)      || 0
      const absentCount      = parseFloat(att.absent_count)          || 0

      const newPresentDays = presentCount + (halfDayLeaveCount * 0.5)
      const newAbsentDays  = absentCount
      const newLeaveDays   = fullLeaveCount + halfDayLeaveCount

      const workingDays   = parseFloat(existingSlip.working_days) || countWorkingDays(year, month)
      const monthlySalary = parseFloat(existingSlip.monthly_salary)
      const perDaySalary  = parseFloat((monthlySalary / workingDays).toFixed(2))
      const earnedSalary  = parseFloat((perDaySalary * newPresentDays).toFixed(2))
      const deductions    = parseFloat(existingSlip.deductions) || 0
      const newFinalSalary = parseFloat((earnedSalary - deductions).toFixed(2))
      const oldFinalSalary = parseFloat(existingSlip.final_salary)

      // ── Step 4: Update salary slip ────────────────────────────────────────
      const slipUpdate = await client.query(
        `UPDATE salary_slips
         SET present_days  = $1,
             absent_days   = $2,
             leave_days    = $3,
             per_day_salary = $4,
             earned_salary  = $5,
             final_salary   = $6,
             updated_at     = NOW()
         WHERE user_id = $7 AND month = $8 AND year = $9
         RETURNING *`,
        [
          newPresentDays, newAbsentDays, newLeaveDays,
          perDaySalary, earnedSalary, newFinalSalary,
          userId, month, year,
        ]
      )

      updatedSlip  = slipUpdate.rows[0]
      const diff   = parseFloat((newFinalSalary - oldFinalSalary).toFixed(2))
      salaryImpact = {
        old_final_salary:  oldFinalSalary,
        new_final_salary:  newFinalSalary,
        difference:        diff,
        difference_label:  diff > 0 ? `+₹${diff}` : diff < 0 ? `-₹${Math.abs(diff)}` : 'No change',
        old_present_days:  parseFloat(existingSlip.present_days),
        new_present_days:  newPresentDays,
        per_day_salary:    perDaySalary,
        month,
        year,
      }
    }

    await client.query('COMMIT')

    // ── Push notifications ────────────────────────────────────────────────────
    setImmediate(async () => {
      try {
        const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'long' })
        const salaryMsg = salaryImpact
          ? ` Your ${monthName} salary has been updated to ₹${salaryImpact.new_final_salary.toLocaleString('en-IN')}.`
          : ''

        // Notify the employee
        await createNotification(userId, {
          type:           'attendance_approved',
          title:          'Attendance Status Changed',
          message:        `Your attendance for ${new Date(rec.date).toLocaleDateString('en-IN')} was changed from "${oldStatus}" to "${status}".${salaryMsg}`,
          reference_id:   id,
          reference_type: 'attendance',
          metadata:       { old_status: oldStatus, new_status: status, salary_impact: salaryImpact },
        })

        // Notify admins
        await notifyAdmins({
          type:           'attendance_approved',
          title:          'Attendance Status Updated',
          message:        `${rec.full_name}'s attendance changed from "${oldStatus}" to "${status}"${salaryImpact ? ` — salary updated to ₹${salaryImpact.new_final_salary.toLocaleString('en-IN')}` : ''}`,
          reference_id:   id,
          reference_type: 'attendance',
          metadata:       { user_id: userId, old_status: oldStatus, new_status: status },
        })
      } catch (e) {
        console.error('[Notification] changeAttendanceStatus failed:', e.message)
      }
    })

    // ── Response ──────────────────────────────────────────────────────────────
    const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'long' })

    return sendSuccess(res, `Attendance changed from "${oldStatus}" to "${status}" successfully`, {
      attendance: {
        ...updatedAtt.rows[0],
        employee_name: rec.full_name,
        role:          rec.role,
      },
      salary_slip: updatedSlip ? {
        ...updatedSlip,
        month_label:    `${monthName} ${year}`,
        present_days:   parseFloat(updatedSlip.present_days),
        absent_days:    parseFloat(updatedSlip.absent_days),
        leave_days:     parseFloat(updatedSlip.leave_days),
        monthly_salary: parseFloat(updatedSlip.monthly_salary),
        per_day_salary: parseFloat(updatedSlip.per_day_salary),
        earned_salary:  parseFloat(updatedSlip.earned_salary),
        deductions:     parseFloat(updatedSlip.deductions),
        final_salary:   parseFloat(updatedSlip.final_salary),
      } : null,
      salary_impact:    salaryImpact,
      slip_updated:     !!updatedSlip,
      slip_not_found:   !updatedSlip
        ? `No salary slip found for ${monthName} ${year}. Generate one via POST /api/v1/salary/generate to reflect this change.`
        : null,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

// ─── TODAY ALL (admin) ────────────────────────────────────────────────────────
const getTodayAll = async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0]

    const [checkedIn, notCheckedIn] = await Promise.all([
      pool.query(
        `SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS full_name,
                u.role, u.email, u.phone_number
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         WHERE a.date = $1 AND u.is_active = true
         ORDER BY a.check_in_time ASC NULLS LAST`,
        [today]
      ),
      pool.query(
        `SELECT u.id, CONCAT(u.first_name,' ',u.last_name) AS full_name,
                u.role, u.email, u.phone_number
         FROM users u
         WHERE u.is_active = true
           AND u.id NOT IN (SELECT user_id FROM attendance WHERE date = $1)
         ORDER BY u.first_name ASC`,
        [today]
      ),
    ])

    const rows = checkedIn.rows
    const summary = {
      total_employees: rows.length + notCheckedIn.rows.length,
      checked_in:      rows.filter(r => r.check_in_time).length,
      not_checked_in:  notCheckedIn.rows.length,
      present:         rows.filter(r => r.status === 'present').length,
      late:            rows.filter(r => r.status === 'late').length,
      leave:           rows.filter(r => r.status === 'leave').length,
      absent:          rows.filter(r => r.status === 'absent').length + notCheckedIn.rows.length,
    }

    return sendSuccess(res, `Today's attendance (${today})`, {
      date:          today,
      summary,
      checked_in:    rows,
      not_checked_in: notCheckedIn.rows.map(u => ({
        ...u,
        status:         'absent',
        check_in_time:  null,
        check_out_time: null,
      })),
    })
  } catch (err) { next(err) }
}

// ─── APPLY LEAVE (any authenticated user) ────────────────────────────────────
const applyLeave = async (req, res, next) => {
  try {
    const userId = req.user.id
    const { date, leave_type = 'full_day', reason } = req.body

    if (!date) return next(new AppError('date is required (YYYY-MM-DD)', 400))

    const valid = ['full_day', 'half_day', 'sick', 'casual', 'unpaid']
    if (!valid.includes(leave_type)) {
      return next(new AppError(`leave_type must be one of: ${valid.join(', ')}`, 400))
    }

    const leaveDate = new Date(date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (leaveDate < today) {
      return next(new AppError('Cannot apply leave for past dates', 400))
    }

    const existing = await pool.query(
      `SELECT id, status, check_in_time FROM attendance WHERE user_id = $1 AND date = $2`,
      [userId, date]
    )
    if (existing.rows[0]?.check_in_time) {
      return next(new AppError('You have already checked in for this date. Contact admin to change status.', 400))
    }

    const userMeta = await getUserMeta(userId)

    const r = await pool.query(
      `INSERT INTO attendance (user_id, date, status, leave_type, reason)
       VALUES ($1, $2, 'leave', $3, $4)
       ON CONFLICT (user_id, date) DO UPDATE
         SET status = 'leave', leave_type = EXCLUDED.leave_type,
             reason = EXCLUDED.reason, updated_at = NOW()
       RETURNING *`,
      [userId, date, leave_type, reason || null]
    )

    setImmediate(async () => {
      try {
        await notifyAdmins({
          type: 'leave_applied',
          title: 'Leave Application',
          message: `${userMeta.full_name} (${userMeta.role}) applied for ${leave_type.replace('_', ' ')} leave on ${date}.${reason ? ` Reason: ${reason}` : ''}`,
          reference_id: r.rows[0].id,
          reference_type: 'attendance',
          metadata: { user_id: userId, date, leave_type },
        })
      } catch (e) {
        console.error('[Notification] applyLeave failed:', e.message)
      }
    })

    return sendSuccess(res, 'Leave applied successfully', {
      attendance: r.rows[0],
      user: userMeta,
    }, 201)
  } catch (err) { next(err) }
}

// ─── TODAY'S LEAVES (admin) ──────────────────────────────────────────────────
const getTodayLeaves = async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0]

    const result = await pool.query(
      `SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) AS full_name,
              u.role, u.email, u.phone_number
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.date = $1 AND a.status = 'leave' AND u.is_active = true
       ORDER BY u.first_name ASC`,
      [today]
    )

    return sendSuccess(res, `Today's leaves (${today})`, {
      date: today,
      total: result.rows.length,
      leaves: result.rows,
    })
  } catch (err) { next(err) }
}

// ─── ALL LEAVES (admin, filterable) ──────────────────────────────────────────
const getAllLeaves = async (req, res, next) => {
  try {
    const { from, to, user_id, leave_type, page = 1, per_page = 30 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(per_page)
    const now = new Date()
    const start = from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const end = to || now.toISOString().split('T')[0]

    const conds = [`a.date BETWEEN $1 AND $2`, `a.status = 'leave'`]
    const params = [start, end]
    let idx = 3

    if (user_id) { conds.push(`a.user_id = $${idx++}`); params.push(user_id) }
    if (leave_type) { conds.push(`a.leave_type = $${idx++}`); params.push(leave_type) }

    const where = `WHERE ${conds.join(' AND ')}`

    const [cnt, data] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM attendance a ${where}`, params),
      pool.query(
        `SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) AS full_name,
                u.role, u.email, u.phone_number
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         ${where}
         ORDER BY a.date DESC, u.first_name ASC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, parseInt(per_page), offset]
      ),
    ])

    return res.json({
      ...paginate(data.rows, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
      period: { from: start, to: end },
    })
  } catch (err) { next(err) }
}

module.exports = {
  uploadPhoto, checkIn, checkOut, getToday, getMyAttendance,
  getByDate, getByMonth, getByUser, getAll,
  getCalendar, getSummary, getLateArrivals,
  markLeave, manualEntry, updateAttendance, deleteAttendance,
  exportExcel, markAbsentEOD,
  approveStatus, getPendingApprovals,
  getTeamAttendance,
  changeAttendanceStatus,
  getTodayAll,
  applyLeave, getTodayLeaves, getAllLeaves,
}