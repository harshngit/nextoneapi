const { pool }                       = require('../config/db')
const { sendSuccess, sendError, paginate } = require('../utils/response')
const AppError                       = require('../utils/AppError')

// ─── Valid roles (matches users table / role_permissions) ─────────────────────
// 'all' is a special target meaning "every active role" — NOT a real role value,
// it is expanded at query time, never stored against a user.
const VALID_ROLES = [
  'super_admin', 'superadmin', 'admin', 'sales_manager', 'sales_executive',
  'external_caller', 'associate', 'associate_partner', 'partner', 'team_leader',
  'cluster', 'cluster_head', 'digital_marketing', 'hr_admin',
]

const getUserMeta = async (userId) => {
  const r = await pool.query(
    `SELECT id, first_name, last_name, role, email FROM users WHERE id=$1`, [userId]
  )
  if (!r.rows.length) return null
  const u = r.rows[0]
  return { id: u.id, full_name: `${u.first_name} ${u.last_name||''}`.trim(), role: u.role, email: u.email }
}

// Resolves a holiday's roles[]/user_ids[] target into a concrete list of active user IDs.
const resolveTargetUserIds = async (roles, userIds) => {
  const ids = new Set()

  if (roles.includes('all')) {
    const r = await pool.query(`SELECT id FROM users WHERE is_active = true`)
    r.rows.forEach(row => ids.add(row.id))
  } else if (roles.length) {
    const r = await pool.query(`SELECT id FROM users WHERE is_active = true AND role = ANY($1::varchar[])`, [roles])
    r.rows.forEach(row => ids.add(row.id))
  }

  if (userIds.length) {
    const r = await pool.query(`SELECT id FROM users WHERE is_active = true AND id = ANY($1::uuid[])`, [userIds])
    r.rows.forEach(row => ids.add(row.id))
  }

  return Array.from(ids)
}

// Writes/refreshes attendance rows (status='leave', leave_type='holiday') for every
// targeted user on the holiday date. Never overwrites an existing check-in — if the
// user already checked in (or checks in later), their check_in_time/photo/etc. are
// preserved; only status + leave_type + reason get set to reflect the holiday.
// Returns the number of attendance rows touched.
const syncHolidayAttendance = async (holidayDate, targetUserIds, holidayName) => {
  if (!targetUserIds.length) return 0

  const r = await pool.query(
    `INSERT INTO attendance (user_id, date, status, leave_type, reason)
       SELECT u.id, $1::date, 'leave', 'holiday', $2
       FROM unnest($3::uuid[]) AS u(id)
     ON CONFLICT (user_id, date) DO UPDATE
       SET status     = 'leave',
           leave_type = 'holiday',
           reason     = EXCLUDED.reason,
           updated_at = NOW()
       -- Don't downgrade a record that's already a non-holiday leave/manual entry approved by admin
       -- back to holiday wording if it was deliberately set otherwise — but DO still mark it,
       -- since holiday should take priority for display. Admin can always override via /status.
     RETURNING user_id`,
    [holidayDate, `Holiday: ${holidayName}`, targetUserIds]
  )
  return r.rows.length
}

// Reverts attendance rows that were auto-marked for this holiday back to a clean slate
// (only rows that are still untouched holiday placeholders — i.e. no check-in happened —
// get deleted; rows where the user actually checked in are left alone with their real data,
// just no longer tagged as a holiday).
const revertHolidayAttendance = async (holidayDate, targetUserIds) => {
  if (!targetUserIds.length) return
  await pool.query(
    `DELETE FROM attendance
     WHERE date = $1 AND user_id = ANY($2::uuid[])
       AND leave_type = 'holiday' AND check_in_time IS NULL`,
    [holidayDate, targetUserIds]
  )
  await pool.query(
    `UPDATE attendance SET leave_type = NULL, status = 'present', updated_at = NOW()
     WHERE date = $1 AND user_id = ANY($2::uuid[])
       AND leave_type = 'holiday' AND check_in_time IS NOT NULL`,
    [holidayDate, targetUserIds]
  )
}

// ─── 1. CREATE HOLIDAY (admin/super_admin only — enforced at route level) ────
const createHoliday = async (req, res, next) => {
  try {
    const { date, name, description, roles = [], user_ids = [] } = req.body

    if (!date)  return next(new AppError('date is required (YYYY-MM-DD)', 400))
    if (!name)  return next(new AppError('name is required', 400))

    const cleanRoles   = Array.isArray(roles)    ? [...new Set(roles)]    : []
    const cleanUserIds = Array.isArray(user_ids) ? [...new Set(user_ids)] : []

    if (cleanRoles.length === 0 && cleanUserIds.length === 0) {
      return next(new AppError('You must target at least one role (or "all") or specific user', 400))
    }

    const invalidRoles = cleanRoles.filter(r => r !== 'all' && !VALID_ROLES.includes(r))
    if (invalidRoles.length) {
      return next(new AppError(`Invalid role(s): ${invalidRoles.join(', ')}`, 400))
    }

    if (cleanUserIds.length) {
      const check = await pool.query(`SELECT id FROM users WHERE id = ANY($1::uuid[])`, [cleanUserIds])
      if (check.rows.length !== cleanUserIds.length) {
        return next(new AppError('One or more user_ids do not exist', 400))
      }
    }

    const r = await pool.query(
      `INSERT INTO holidays (date, name, description, roles, user_ids, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [date, name, description || null, cleanRoles, cleanUserIds, req.user.id]
    )
    const holiday = r.rows[0]

    const targetUserIds = await resolveTargetUserIds(cleanRoles, cleanUserIds)
    const affected = await syncHolidayAttendance(date, targetUserIds, name)

    return sendSuccess(res, 'Holiday created', {
      holiday,
      affected_users: targetUserIds.length,
      attendance_rows_updated: affected,
    }, 201)
  } catch (err) { next(err) }
}

// ─── 2. LIST HOLIDAYS ─────────────────────────────────────────────────────────
// Admin/super_admin: see all holidays (optionally filtered by year/month/upcoming).
// Any other authenticated user: see only holidays that apply to them.
const getHolidays = async (req, res, next) => {
  try {
    const { role, id: callerId } = req.user
    const { year, month, upcoming_only, page = 1, per_page = 50 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(per_page)
    const ADMIN_ROLES = ['super_admin', 'admin', 'superadmin']

    const conds = []
    const params = []
    let idx = 1

    if (year) {
      conds.push(`EXTRACT(YEAR FROM date) = $${idx++}`)
      params.push(parseInt(year))
    }
    if (month) {
      conds.push(`EXTRACT(MONTH FROM date) = $${idx++}`)
      params.push(parseInt(month))
    }
    if (upcoming_only === 'true') {
      conds.push(`date >= CURRENT_DATE`)
    }

    if (!ADMIN_ROLES.includes(role)) {
      // Self-service: only holidays targeting my role or my user_id
      const myRoleParam = idx++; params.push(role)
      const myIdParam   = idx++; params.push(callerId)
      conds.push(`('all' = ANY(roles) OR $${myRoleParam} = ANY(roles) OR $${myIdParam} = ANY(user_ids))`)
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const [cnt, data] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM holidays ${where}`, params),
      pool.query(
        `SELECT h.*, CONCAT(u.first_name,' ',u.last_name) AS created_by_name
         FROM holidays h LEFT JOIN users u ON u.id = h.created_by
         ${where} ORDER BY h.date ASC LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, parseInt(per_page), offset]
      ),
    ])

    return res.json({
      ...paginate(data.rows, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
    })
  } catch (err) { next(err) }
}

// ─── 3. GET ONE HOLIDAY ───────────────────────────────────────────────────────
const getHolidayById = async (req, res, next) => {
  try {
    const { id } = req.params
    const r = await pool.query(
      `SELECT h.*, CONCAT(u.first_name,' ',u.last_name) AS created_by_name
       FROM holidays h LEFT JOIN users u ON u.id = h.created_by WHERE h.id=$1`, [id]
    )
    if (!r.rows.length) return next(new AppError('Holiday not found', 404))

    const holiday = r.rows[0]
    const targetUserIds = await resolveTargetUserIds(holiday.roles, holiday.user_ids)

    return sendSuccess(res, 'Holiday fetched', { holiday, affected_users: targetUserIds.length })
  } catch (err) { next(err) }
}

// ─── 4. UPDATE HOLIDAY (admin/super_admin only) ──────────────────────────────
const updateHoliday = async (req, res, next) => {
  try {
    const { id } = req.params
    const { date, name, description, roles, user_ids } = req.body

    const existing = await pool.query(`SELECT * FROM holidays WHERE id=$1`, [id])
    if (!existing.rows.length) return next(new AppError('Holiday not found', 404))
    const old = existing.rows[0]

    const newRoles    = roles    !== undefined ? [...new Set(roles)]    : old.roles
    const newUserIds  = user_ids !== undefined ? [...new Set(user_ids)] : old.user_ids
    const newDate     = date || old.date
    const newName     = name || old.name

    if (newRoles.length === 0 && newUserIds.length === 0) {
      return next(new AppError('You must target at least one role (or "all") or specific user', 400))
    }
    const invalidRoles = newRoles.filter(r => r !== 'all' && !VALID_ROLES.includes(r))
    if (invalidRoles.length) {
      return next(new AppError(`Invalid role(s): ${invalidRoles.join(', ')}`, 400))
    }

    // Revert old targets first (in case targeting shrank or the date changed),
    // then re-sync the new targets — keeps attendance rows consistent either way.
    const oldTargetIds = await resolveTargetUserIds(old.roles, old.user_ids)
    await revertHolidayAttendance(old.date, oldTargetIds)

    const r = await pool.query(
      `UPDATE holidays SET date=$1, name=$2, description=$3, roles=$4, user_ids=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [newDate, newName, description !== undefined ? description : old.description, newRoles, newUserIds, id]
    )
    const holiday = r.rows[0]

    const newTargetIds = await resolveTargetUserIds(newRoles, newUserIds)
    const affected = await syncHolidayAttendance(newDate, newTargetIds, newName)

    return sendSuccess(res, 'Holiday updated', {
      holiday,
      affected_users: newTargetIds.length,
      attendance_rows_updated: affected,
    })
  } catch (err) { next(err) }
}

// ─── 5. DELETE HOLIDAY (admin/super_admin only) ──────────────────────────────
const deleteHoliday = async (req, res, next) => {
  try {
    const { id } = req.params
    const existing = await pool.query(`SELECT * FROM holidays WHERE id=$1`, [id])
    if (!existing.rows.length) return next(new AppError('Holiday not found', 404))
    const holiday = existing.rows[0]

    const targetUserIds = await resolveTargetUserIds(holiday.roles, holiday.user_ids)
    await revertHolidayAttendance(holiday.date, targetUserIds)
    await pool.query(`DELETE FROM holidays WHERE id=$1`, [id])

    return sendSuccess(res, 'Holiday deleted', { id })
  } catch (err) { next(err) }
}

// ─── 6. CHECK IF A SPECIFIC DATE/USER IS ON HOLIDAY (helper endpoint) ────────
// Used by the frontend to show "Today is a holiday for you" banners, etc.
const checkHoliday = async (req, res, next) => {
  try {
    const { date } = req.query
    const userId = req.query.user_id || req.user.id
    if (!date) return next(new AppError('date query param required (YYYY-MM-DD)', 400))

    const userRow = await pool.query(`SELECT role FROM users WHERE id=$1`, [userId])
    if (!userRow.rows.length) return next(new AppError('User not found', 404))
    const role = userRow.rows[0].role

    const r = await pool.query(
      `SELECT id, name, description FROM holidays
       WHERE date=$1 AND ('all' = ANY(roles) OR $2 = ANY(roles) OR $3 = ANY(user_ids))`,
      [date, role, userId]
    )

    return sendSuccess(res, 'Holiday check complete', {
      date, user_id: userId,
      is_holiday: r.rows.length > 0,
      holidays: r.rows,
    })
  } catch (err) { next(err) }
}

module.exports = {
  createHoliday, getHolidays, getHolidayById, updateHoliday, deleteHoliday, checkHoliday,
  VALID_ROLES,
}
