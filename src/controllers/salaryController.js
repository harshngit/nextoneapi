/**
 * salaryController.js — Next One Realty CRM
 *
 * Salary system flow:
 *  1. Admin sets monthly salary for an employee  → POST /api/v1/salary/set
 *  2. Admin generates a salary slip for a month  → POST /api/v1/salary/generate
 *  3. Admin views all slips / per employee        → GET  /api/v1/salary/slips
 *  4. Employee views their own earned salary      → GET  /api/v1/salary/my-salary
 *  5. Admin views salary set for all employees    → GET  /api/v1/salary/employees
 *
 * Earned salary formula:
 *   working_days  = total Mon–Fri days in the month (or manually overridable)
 *   present_days  = full_present + (0.5 × late_half_day) + (0.5 × half_day_leave)
 *   per_day       = monthly_salary / working_days
 *   earned        = per_day × present_days
 *   final         = earned - deductions
 *
 * Attendance → salary mapping:
 *   present                                   = 1 full day
 *   late, checked in by 10:35 AM (late_by_minutes <= 5)  = 1 full day
 *   late, checked in AFTER 10:35 AM (late_by_minutes > 5) = 0.5 day (50% cut for that day)
 *   leave (leave_type = half_day)             = 0.5 day
 *   absent / leave (other)                    = 0
 */

const { pool }      = require('../config/db')
const { sendSuccess } = require('../utils/response')
const AppError      = require('../utils/AppError')
const { createNotification, notifyAdmins } = require('./notificationController')
const { renderSalarySlipPdf } = require('../utils/salarySlipPdf')
const { ZipArchive } = require('archiver')
const { PassThrough } = require('stream')

const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/+$/, '')
// Builds the public URL from the real absolute disk path multer reports —
// never a hardcoded folder guess, so it can't drift out of sync.
const toRawFileUrl = (absolutePath) => {
  if (!absolutePath) return absolutePath
  const normalized = absolutePath.replace(/\\/g, '/')
  const marker = '/uploads/'
  const idx = normalized.indexOf(marker)
  const relative = idx === -1 ? normalized : normalized.slice(idx)
  return `${BACKEND_URL}${relative.startsWith('/') ? '' : '/'}${relative}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Count Mon–Fri days in a given month/year */
const countWorkingDays = (year, month) => {
  const daysInMonth = new Date(year, month, 0).getDate()
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month - 1, d).getDay()
    if (day !== 0 && day !== 6) count++
  }
  return count
}

/** Sum of employee_incentives for one user/month/year — pulled automatically
 *  onto the slip, never taken from the request body. */
const getMonthlyIncentiveTotal = async (userId, month, year) => {
  const r = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM employee_incentives
     WHERE user_id = $1 AND month = $2 AND year = $3`,
    [userId, month, year]
  )
  return parseFloat(r.rows[0].total) || 0
}

/** Same, but for many users at once — returns a Map<user_id, total>. */
const getMonthlyIncentiveTotals = async (userIds, month, year) => {
  const r = await pool.query(
    `SELECT user_id, COALESCE(SUM(amount), 0) AS total FROM employee_incentives
     WHERE user_id = ANY($1::uuid[]) AND month = $2 AND year = $3
     GROUP BY user_id`,
    [userIds, month, year]
  )
  const map = new Map()
  r.rows.forEach(row => map.set(row.user_id, parseFloat(row.total) || 0))
  return map
}

/** Get latest active salary for a user */
const getActiveSalary = async (userId) => {
  const r = await pool.query(
    `SELECT * FROM employee_salaries
     WHERE user_id = $1
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [userId]
  )
  return r.rows[0] || null
}

// ─── 1. SET / UPDATE EMPLOYEE SALARY (Admin only) ────────────────────────────
/**
 * POST /api/v1/salary/set
 * Body: { user_id, monthly_salary, effective_from?, notes? }
 *
 * Admin sends the salary amount from the frontend.
 * Creates a new salary record (history preserved).
 */
/**
 * POST /api/v1/salary/set
 * Body: { user_id, monthly_salary?, per_day_salary?, working_days_in_month?, effective_from?, notes? }
 *
 * Admin can provide EITHER monthly_salary OR per_day_salary — the other is auto-calculated.
 * If both are provided, monthly_salary takes priority and per_day is derived from it.
 *
 * working_days_in_month (optional, default 26): used only when deriving per_day from monthly.
 * History is always preserved — every call creates a new record.
 */
const setEmployeeSalary = async (req, res, next) => {
  try {
    const { user_id, monthly_salary, per_day_salary, working_days_in_month, effective_from, notes } = req.body

    if (!user_id) return next(new AppError('user_id is required', 400))

    if (monthly_salary == null && per_day_salary == null) {
      return next(new AppError('Provide at least one of: monthly_salary or per_day_salary', 400))
    }

    // Verify user exists
    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1 AND is_active = true`,
      [user_id]
    )
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404))

    // Working days used for per_day ↔ monthly conversion (default 26 — standard Indian payroll)
    const wdMonth = parseInt(working_days_in_month) || 26

    let finalMonthly, finalPerDay

    if (monthly_salary != null) {
      // Monthly provided → derive per_day
      finalMonthly = parseFloat(monthly_salary)
      if (isNaN(finalMonthly) || finalMonthly < 0) {
        return next(new AppError('monthly_salary must be a non-negative number', 400))
      }
      finalPerDay = parseFloat((finalMonthly / wdMonth).toFixed(2))
    } else {
      // Only per_day provided → derive monthly
      finalPerDay = parseFloat(per_day_salary)
      if (isNaN(finalPerDay) || finalPerDay < 0) {
        return next(new AppError('per_day_salary must be a non-negative number', 400))
      }
      finalMonthly = parseFloat((finalPerDay * wdMonth).toFixed(2))
    }

    const fromDate = effective_from || new Date().toISOString().split('T')[0]

    const result = await pool.query(
      `INSERT INTO employee_salaries (user_id, monthly_salary, per_day_salary, effective_from, set_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user_id, finalMonthly, finalPerDay, fromDate, req.user.id, notes || null]
    )

    // ── Push + in-app notifications ───────────────────────────────────────────
    setImmediate(async () => {
      try {
        const salaryStr = `₹${Number(finalMonthly).toLocaleString('en-IN')}/month`

        // Notify the employee
        await createNotification(user_id, {
          type:           'general',
          title:          'Your Salary Has Been Updated',
          message:        `Your monthly salary has been set to ${salaryStr} effective ${fromDate}`,
          reference_id:   result.rows[0].id,
          reference_type: 'salary',
          metadata:       { monthly_salary: finalMonthly, effective_from: fromDate },
        })

        // Notify admins (excluding the one who set it)
        await notifyAdmins({
          type:           'general',
          title:          'Employee Salary Updated',
          message:        `Salary for ${userChk.rows[0].full_name} set to ${salaryStr} effective ${fromDate}`,
          reference_id:   result.rows[0].id,
          reference_type: 'salary',
          metadata:       { user_id, monthly_salary: finalMonthly },
        })
      } catch (notifErr) {
        console.error('[Notification] setEmployeeSalary failed:', notifErr.message)
      }
    })

    return sendSuccess(res, 'Employee salary saved successfully', {
      salary: {
        ...result.rows[0],
        monthly_salary: finalMonthly,
        per_day_salary:  finalPerDay,
        working_days_used_for_calculation: wdMonth,
      },
      employee: userChk.rows[0],
    }, 201)
  } catch (err) { next(err) }
}

// ─── 2. GET ALL EMPLOYEES WITH THEIR CURRENT SALARY (Admin) ──────────────────
/**
 * GET /api/v1/salary/employees
 * Returns all active employees with their latest set salary.
 */
const getAllEmployeeSalaries = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id, CONCAT(u.first_name,' ',u.last_name) AS full_name,
         u.role, u.email, u.phone_number,
         es.monthly_salary, es.per_day_salary, es.effective_from,
         es.notes AS salary_notes,
         es.created_at AS salary_set_at,
         CONCAT(su.first_name,' ',su.last_name) AS set_by_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM employee_salaries
         WHERE user_id = u.id
         ORDER BY effective_from DESC, created_at DESC
         LIMIT 1
       ) es ON true
       LEFT JOIN users su ON su.id = es.set_by
       WHERE u.is_active = true
       ORDER BY u.first_name ASC`
    )

    return sendSuccess(res, 'Employee salaries fetched', {
      total: result.rows.length,
      data:  result.rows.map(r => ({
        ...r,
        monthly_salary: r.monthly_salary ? parseFloat(r.monthly_salary) : null,
        per_day_salary:  r.per_day_salary  ? parseFloat(r.per_day_salary)  : null,
        salary_set: !!r.monthly_salary,
      })),
    })
  } catch (err) { next(err) }
}

// ─── 2b. UPLOAD AUTHORIZED SIGNATURE (Admin) ─────────────────────────────────
/**
 * POST /api/v1/salary/upload-signature
 * Single image upload (any field name). Returns a URL — pass that as
 * auth_signature when calling POST /api/v1/salary/generate.
 */
const uploadSalarySignature = async (req, res, next) => {
  try {
    const file = req.file || (req.files && req.files[0])
    if (!file) return next(new AppError('No signature image uploaded', 400))

    return sendSuccess(res, 'Signature uploaded successfully', {
      file_name: file.originalname,
      file_size: file.size,
      mime_type: file.mimetype,
      url: toRawFileUrl(file.path),
    }, 201)
  } catch (err) { next(err) }
}

// ─── 3. GENERATE SALARY SLIP (Admin) ─────────────────────────────────────────
/**
 * POST /api/v1/salary/generate
 * Body: {
 *   user_id, month, year, deductions?, notes?, working_days_override?,
 *   basic_salary?, payment_mode?, pay_date?, auth_signature?
 * }
 *
 * Calculates earned salary from attendance for the given month/year.
 * working_days_override allows admin to manually set the working days
 * (e.g. for months with holidays).
 *
 * basic_salary?    — overrides the employee's set monthly salary for just
 *                     this slip (e.g. a one-off adjustment). Defaults to
 *                     whatever's set via POST /api/v1/salary/set.
 * Incentive is NOT taken from the request — it's the sum of every
 * employee_incentives row already recorded for this user/month/year
 * (added via POST /api/v1/salary/incentive), so it always reflects
 * whatever's on file rather than something typed in here.
 * payment_mode?     — shown on the PDF slip. Defaults to "Bank Transfer".
 * pay_date?         — shown on the PDF slip. Defaults to the last day of
 *                     the given month.
 */
const generateSalarySlip = async (req, res, next) => {
  try {
    const {
      user_id, month, year,
      deductions = 0,
      notes,
      working_days_override,
      basic_salary,
      payment_mode = 'Bank Transfer',
      pay_date,
      auth_signature,
    } = req.body

    if (!user_id) return next(new AppError('user_id is required', 400))
    if (!month || !year) return next(new AppError('month and year are required', 400))

    const m = parseInt(month)
    const y = parseInt(year)
    if (m < 1 || m > 12) return next(new AppError('month must be between 1 and 12', 400))
    if (y < 2020)        return next(new AppError('year must be 2020 or later', 400))

    // Verify user
    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1`,
      [user_id]
    )
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404))

    // Get active salary (skipped entirely when basic_salary overrides it)
    let salary = null
    if (basic_salary === undefined) {
      salary = await getActiveSalary(user_id)
      if (!salary) {
        return next(new AppError(
          `No salary has been set for this employee. Set a salary first via POST /api/v1/salary/set, or pass basic_salary directly.`, 400
        ))
      }
    }

    // Date range for the month
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end   = new Date(y, m, 0).toISOString().split('T')[0]

    // Pull attendance summary for the month.
    // late_by_minutes is minutes past the 10:30 AM cutoff (set at check-in) —
    // > 5 means the check-in was after 10:35 AM, which counts as a half day
    // (50% salary cut for that day) instead of a full day.
    const attResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('present', 'late') AND (late_by_minutes IS NULL OR late_by_minutes <= 5)) AS full_present_count,
         COUNT(*) FILTER (WHERE status = 'late' AND late_by_minutes > 5)                        AS late_half_day_count,
         COUNT(*) FILTER (WHERE status = 'leave' AND leave_type = 'half_day')                    AS half_day_leave_count,
         COUNT(*) FILTER (WHERE status = 'leave' AND (leave_type IS NULL OR leave_type != 'half_day')) AS full_leave_count,
         COUNT(*) FILTER (WHERE status = 'absent')                                               AS absent_count
       FROM attendance
       WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
      [user_id, start, end]
    )

    const att = attResult.rows[0]
    const fullPresentCount  = parseFloat(att.full_present_count)   || 0
    const lateHalfDayCount  = parseFloat(att.late_half_day_count)  || 0
    const halfDayLeaveCount = parseFloat(att.half_day_leave_count) || 0
    const fullLeaveCount    = parseFloat(att.full_leave_count)    || 0
    const absentCount       = parseFloat(att.absent_count)        || 0

    const presentDays = fullPresentCount + (lateHalfDayCount * 0.5) + (halfDayLeaveCount * 0.5)
    const absentDays  = absentCount
    const leaveDays   = fullLeaveCount + halfDayLeaveCount

    // Working days: Mon–Fri count for the month (or admin override)
    const workingDays = working_days_override
      ? parseInt(working_days_override)
      : countWorkingDays(y, m)

    if (workingDays <= 0) {
      return next(new AppError('working_days must be greater than 0', 400))
    }

    const monthlySalary = basic_salary !== undefined ? parseFloat(basic_salary) : parseFloat(salary.monthly_salary)
    if (isNaN(monthlySalary) || monthlySalary < 0) {
      return next(new AppError('basic_salary must be a non-negative number', 400))
    }
    const perDaySalary  = parseFloat((monthlySalary / workingDays).toFixed(2))
    const earnedSalary  = parseFloat((perDaySalary * presentDays).toFixed(2))
    const deductionAmt  = parseFloat(deductions) || 0
    const finalSalary   = parseFloat((earnedSalary - deductionAmt).toFixed(2))
    const incentiveAmt  = await getMonthlyIncentiveTotal(user_id, m, y)
    const totalPayout   = parseFloat((finalSalary + incentiveAmt).toFixed(2))
    const finalPayDate  = pay_date || new Date(y, m, 0).toISOString().split('T')[0] // last day of month

    // Upsert slip (overwrite if already generated for this month)
    const slip = await pool.query(
      `INSERT INTO salary_slips
         (user_id, month, year, monthly_salary, working_days, present_days,
          absent_days, leave_days, per_day_salary, earned_salary,
          deductions, final_salary, incentive_amount, total_payout,
          payment_mode, pay_date, auth_signature_url, generated_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (user_id, month, year)
       DO UPDATE SET
         monthly_salary      = EXCLUDED.monthly_salary,
         working_days        = EXCLUDED.working_days,
         present_days        = EXCLUDED.present_days,
         absent_days         = EXCLUDED.absent_days,
         leave_days          = EXCLUDED.leave_days,
         per_day_salary      = EXCLUDED.per_day_salary,
         earned_salary       = EXCLUDED.earned_salary,
         deductions          = EXCLUDED.deductions,
         final_salary        = EXCLUDED.final_salary,
         incentive_amount    = EXCLUDED.incentive_amount,
         total_payout        = EXCLUDED.total_payout,
         payment_mode        = EXCLUDED.payment_mode,
         pay_date            = EXCLUDED.pay_date,
         auth_signature_url  = EXCLUDED.auth_signature_url,
         generated_by        = EXCLUDED.generated_by,
         notes               = EXCLUDED.notes,
         updated_at          = NOW()
       RETURNING *`,
      [
        user_id, m, y, monthlySalary, workingDays, presentDays,
        absentDays, leaveDays, perDaySalary, earnedSalary,
        deductionAmt, finalSalary, incentiveAmt, totalPayout,
        payment_mode, finalPayDate, auth_signature || null, req.user.id, notes || null,
      ]
    )

    const monthName = new Date(y, m - 1).toLocaleString('en-IN', { month: 'long' })

    // ── Push + in-app notifications ───────────────────────────────────────────
    setImmediate(async () => {
      try {
        const payStr = `₹${Number(finalSalary).toLocaleString('en-IN')}`

        // Notify the employee
        await createNotification(user_id, {
          type:           'general',
          title:          `Salary Slip Generated — ${monthName} ${y}`,
          message:        `Your salary slip for ${monthName} ${y} is ready. Final salary: ${payStr}`,
          reference_id:   slip.rows[0].id,
          reference_type: 'salary_slip',
          metadata:       { month: m, year: y, final_salary: finalSalary },
        })

        // Notify admins
        await notifyAdmins({
          type:           'general',
          title:          'Salary Slip Generated',
          message:        `Salary slip for ${userChk.rows[0].full_name} (${monthName} ${y}) — ${payStr}`,
          reference_id:   slip.rows[0].id,
          reference_type: 'salary_slip',
          metadata:       { user_id, month: m, year: y, final_salary: finalSalary },
        })
      } catch (notifErr) {
        console.error('[Notification] generateSalarySlip failed:', notifErr.message)
      }
    })

    return sendSuccess(res, `Salary slip generated for ${monthName} ${y}`, {
      slip:      slip.rows[0],
      employee:  userChk.rows[0],
      breakdown: {
        month:           monthName,
        year:            y,
        monthly_salary:  monthlySalary,
        working_days:    workingDays,
        present_days:    presentDays,
        absent_days:     absentDays,
        leave_days:      leaveDays,
        per_day_salary:  perDaySalary,
        earned_salary:   earnedSalary,
        deductions:      deductionAmt,
        final_salary:    finalSalary,
        incentive_amount: incentiveAmt,
        total_payout:    totalPayout,
        payment_mode,
        pay_date:        finalPayDate,
        period:          { from: start, to: end },
      },
    }, 201)
  } catch (err) { next(err) }
}

// ─── 4. GET SALARY SLIPS — Admin (all employees or one) ──────────────────────
/**
 * GET /api/v1/salary/slips
 * Query: { user_id?, month?, year?, page?, per_page? }
 */
const getSalarySlips = async (req, res, next) => {
  try {
    const { user_id, month, year, page = 1, per_page = 20 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(per_page)

    const conds  = []
    const params = []
    let   idx    = 1

    if (user_id) { conds.push(`ss.user_id = $${idx++}`); params.push(user_id) }
    if (month)   { conds.push(`ss.month = $${idx++}`);   params.push(parseInt(month)) }
    if (year)    { conds.push(`ss.year = $${idx++}`);    params.push(parseInt(year)) }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const [cnt, data] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM salary_slips ss ${where}`, params),
      pool.query(
        `SELECT
           ss.*,
           CONCAT(u.first_name,' ',u.last_name)  AS employee_name,
           u.role AS employee_role, u.email AS employee_email,
           CONCAT(g.first_name,' ',g.last_name)  AS generated_by_name
         FROM salary_slips ss
         JOIN users u ON u.id = ss.user_id
         LEFT JOIN users g ON g.id = ss.generated_by
         ${where}
         ORDER BY ss.year DESC, ss.month DESC, u.first_name ASC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, parseInt(per_page), offset]
      ),
    ])

    const total = parseInt(cnt.rows[0].count)
    return res.json({
      success: true,
      data:    data.rows.map(r => ({
        ...r,
        monthly_salary:   parseFloat(r.monthly_salary),
        per_day_salary:   parseFloat(r.per_day_salary),
        earned_salary:    parseFloat(r.earned_salary),
        deductions:       parseFloat(r.deductions),
        final_salary:     parseFloat(r.final_salary),
        present_days:     parseFloat(r.present_days),
        absent_days:      parseFloat(r.absent_days),
        leave_days:       parseFloat(r.leave_days),
        incentive_amount: r.incentive_amount !== null ? parseFloat(r.incentive_amount) : 0,
        total_payout:     r.total_payout !== null ? parseFloat(r.total_payout) : null,
        pdf_url:          `${BACKEND_URL}/api/v1/salary/slips/${r.id}/pdf`,
      })),
      pagination: {
        total, page: parseInt(page), per_page: parseInt(per_page),
        total_pages: Math.ceil(total / parseInt(per_page)),
      },
    })
  } catch (err) { next(err) }
}

// ─── 4b. SALARY SLIPS FOR ONE EMPLOYEE (Admin) ───────────────────────────────
/**
 * GET /api/v1/salary/slips/user/:user_id
 * Same data as GET /slips?user_id=..., as a dedicated path for convenience.
 */
const getUserSalarySlips = (req, res, next) => {
  req.query.user_id = req.params.user_id
  return getSalarySlips(req, res, next)
}

// ─── 5. MY SALARY — Employee sees their own ──────────────────────────────────
/**
 * GET /api/v1/salary/my-salary
 * Query: { month?, year? }
 *
 * - Returns the employee's current monthly_salary (set by admin)
 * - Returns their salary slips (all or for a specific month/year)
 * - Visible to the employee themselves only
 */
const getMySalary = async (req, res, next) => {
  try {
    const userId          = req.user.id
    const { month, year } = req.query

    // Current salary set by admin
    const currentSalary = await getActiveSalary(userId)

    // Slips filter
    const conds  = ['ss.user_id = $1']
    const params = [userId]
    let   idx    = 2

    if (month) { conds.push(`ss.month = $${idx++}`); params.push(parseInt(month)) }
    if (year)  { conds.push(`ss.year = $${idx++}`);  params.push(parseInt(year)) }

    const slips = await pool.query(
      `SELECT ss.*, CONCAT(g.first_name,' ',g.last_name) AS generated_by_name
       FROM salary_slips ss
       LEFT JOIN users g ON g.id = ss.generated_by
       WHERE ${conds.join(' AND ')}
       ORDER BY ss.year DESC, ss.month DESC`,
      params
    )

    const monthName = (m, y) =>
      new Date(y, m - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })

    return sendSuccess(res, 'Your salary details', {
      current_monthly_salary: currentSalary
        ? {
            amount:         parseFloat(currentSalary.monthly_salary),
            per_day_salary:  currentSalary.per_day_salary ? parseFloat(currentSalary.per_day_salary) : null,
            effective_from: currentSalary.effective_from,
          }
        : null,
      salary_slips: slips.rows.map(r => ({
        id:               r.id,
        month:            r.month,
        year:             r.year,
        month_label:      monthName(r.month, r.year),
        monthly_salary:   parseFloat(r.monthly_salary),
        working_days:     r.working_days,
        present_days:     parseFloat(r.present_days),
        absent_days:      parseFloat(r.absent_days),
        leave_days:       parseFloat(r.leave_days),
        per_day_salary:   parseFloat(r.per_day_salary),
        earned_salary:    parseFloat(r.earned_salary),
        deductions:       parseFloat(r.deductions),
        final_salary:     parseFloat(r.final_salary),
        incentive_amount: r.incentive_amount !== null ? parseFloat(r.incentive_amount) : 0,
        total_payout:     r.total_payout !== null ? parseFloat(r.total_payout) : null,
        payment_mode:     r.payment_mode,
        pay_date:         r.pay_date,
        notes:            r.notes,
        generated_at:     r.created_at,
        pdf_url:          `${BACKEND_URL}/api/v1/salary/slips/${r.id}/pdf`,
      })),
    })
  } catch (err) { next(err) }
}

// ─── 6. GET SINGLE SLIP ───────────────────────────────────────────────────────
/**
 * GET /api/v1/salary/slips/:id
 * Admin sees any slip. Employee sees only their own.
 */
const getSlipById = async (req, res, next) => {
  try {
    const { id } = req.params
    const { role, id: callerId } = req.user

    const result = await pool.query(
      `SELECT
         ss.*,
         CONCAT(u.first_name,' ',u.last_name)  AS employee_name,
         u.role AS employee_role, u.email AS employee_email,
         CONCAT(g.first_name,' ',g.last_name)  AS generated_by_name
       FROM salary_slips ss
       JOIN users u ON u.id = ss.user_id
       LEFT JOIN users g ON g.id = ss.generated_by
       WHERE ss.id = $1`,
      [id]
    )

    if (!result.rows.length) return next(new AppError('Salary slip not found', 404))

    const slip = result.rows[0]

    // Employee can only see their own slips
    if (role === 'sales_executive' && slip.user_id !== callerId) {
      return next(new AppError('Access denied', 403))
    }

    return sendSuccess(res, 'Salary slip fetched', {
      ...slip,
      monthly_salary:   parseFloat(slip.monthly_salary),
      per_day_salary:   parseFloat(slip.per_day_salary),
      earned_salary:    parseFloat(slip.earned_salary),
      deductions:       parseFloat(slip.deductions),
      final_salary:     parseFloat(slip.final_salary),
      present_days:     parseFloat(slip.present_days),
      absent_days:      parseFloat(slip.absent_days),
      leave_days:       parseFloat(slip.leave_days),
      incentive_amount: slip.incentive_amount !== null ? parseFloat(slip.incentive_amount) : 0,
      total_payout:     slip.total_payout !== null ? parseFloat(slip.total_payout) : null,
      pdf_url:          `${BACKEND_URL}/api/v1/salary/slips/${slip.id}/pdf`,
    })
  } catch (err) { next(err) }
}

// ─── 6a2. EDIT AN EXISTING SALARY SLIP (Admin) ───────────────────────────────
/**
 * PATCH /api/v1/salary/slips/:id
 * Body: any subset of { basic_salary, deductions,
 *                        payment_mode, pay_date, auth_signature, notes }
 *
 * For correcting a slip's numbers/details without re-running the whole
 * attendance-based calculation. present_days/absent_days/leave_days/
 * working_days are left untouched — only basic_salary (-> monthly_salary)
 * and deductions actually change the money fields, and final_salary/
 * total_payout are recomputed from them. Incentive is always re-pulled
 * fresh from employee_incentives for this slip's user/month/year — not
 * something you can set here — so editing a slip also picks up any
 * incentive added/changed since it was generated.
 */
const updateSalarySlip = async (req, res, next) => {
  try {
    const { id } = req.params
    const {
      basic_salary, deductions,
      payment_mode, pay_date, auth_signature, notes,
    } = req.body

    const existing = await pool.query('SELECT * FROM salary_slips WHERE id = $1', [id])
    if (!existing.rows.length) return next(new AppError('Salary slip not found', 404))
    const slip = existing.rows[0]

    const monthlySalary = basic_salary !== undefined ? parseFloat(basic_salary) : parseFloat(slip.monthly_salary)
    if (isNaN(monthlySalary) || monthlySalary < 0) {
      return next(new AppError('basic_salary must be a non-negative number', 400))
    }
    const presentDays  = parseFloat(slip.present_days)
    const workingDays  = slip.working_days
    const perDaySalary = parseFloat((monthlySalary / workingDays).toFixed(2))
    const earnedSalary = parseFloat((perDaySalary * presentDays).toFixed(2))
    const deductionAmt = deductions !== undefined ? parseFloat(deductions) || 0 : parseFloat(slip.deductions)
    const finalSalary  = parseFloat((earnedSalary - deductionAmt).toFixed(2))
    const incentiveAmt = await getMonthlyIncentiveTotal(slip.user_id, slip.month, slip.year)
    const totalPayout  = parseFloat((finalSalary + incentiveAmt).toFixed(2))

    const result = await pool.query(
      `UPDATE salary_slips SET
         monthly_salary      = $1,
         per_day_salary      = $2,
         earned_salary        = $3,
         deductions           = $4,
         final_salary         = $5,
         incentive_amount     = $6,
         total_payout         = $7,
         payment_mode         = COALESCE($8, payment_mode),
         pay_date             = COALESCE($9, pay_date),
         auth_signature_url   = COALESCE($10, auth_signature_url),
         notes                = COALESCE($11, notes),
         updated_at           = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        monthlySalary, perDaySalary, earnedSalary, deductionAmt, finalSalary,
        incentiveAmt, totalPayout, payment_mode || null, pay_date || null,
        auth_signature || null, notes !== undefined ? notes : null, id,
      ]
    )

    const updated = result.rows[0]
    return sendSuccess(res, 'Salary slip updated successfully', {
      ...updated,
      monthly_salary:   parseFloat(updated.monthly_salary),
      per_day_salary:   parseFloat(updated.per_day_salary),
      earned_salary:    parseFloat(updated.earned_salary),
      deductions:       parseFloat(updated.deductions),
      final_salary:     parseFloat(updated.final_salary),
      incentive_amount: parseFloat(updated.incentive_amount || 0),
      total_payout:     parseFloat(updated.total_payout),
      pdf_url:          `${BACKEND_URL}/api/v1/salary/slips/${updated.id}/pdf`,
    })
  } catch (err) { next(err) }
}

// ─── 6b. DOWNLOAD ONE SALARY SLIP AS PDF ─────────────────────────────────────
/**
 * GET /api/v1/salary/slips/:id/pdf
 * Renders the Canva-designed salary slip template with this slip's data.
 * Same access rule as getSlipById: sales_executive can only download their own.
 */
const downloadSalarySlipPdf = async (req, res, next) => {
  try {
    const { id } = req.params
    const { role, id: callerId } = req.user

    const result = await pool.query(
      `SELECT ss.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name, u.role AS role
       FROM salary_slips ss
       JOIN users u ON u.id = ss.user_id
       WHERE ss.id = $1`,
      [id]
    )
    if (!result.rows.length) return next(new AppError('Salary slip not found', 404))

    const slip = result.rows[0]
    if (role === 'sales_executive' && slip.user_id !== callerId) {
      return next(new AppError('Access denied', 403))
    }

    const monthName = new Date(slip.year, slip.month - 1).toLocaleString('en-US', { month: 'long' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${slip.employee_name.replace(/\s+/g, '_')}_${monthName}_${slip.year}.pdf"`)

    renderSalarySlipPdf(slip, res)
  } catch (err) { next(err) }
}

// ─── 6c. BULK-DOWNLOAD SALARY SLIPS AS A ZIP OF PDFS (Admin) ─────────────────
/**
 * POST /api/v1/salary/slips/bulk-pdf
 * Body: { month, year, user_ids? }
 * Generates a PDF for every already-generated slip matching month/year
 * (optionally scoped to user_ids), zipped into one download.
 */
const bulkDownloadSalarySlipsPdf = async (req, res, next) => {
  try {
    const { month, year, user_ids } = req.body
    if (!month || !year) return next(new AppError('month and year are required', 400))

    const m = parseInt(month)
    const y = parseInt(year)

    let query = `
      SELECT ss.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name, u.role AS role
      FROM salary_slips ss
      JOIN users u ON u.id = ss.user_id
      WHERE ss.month = $1 AND ss.year = $2
    `
    const params = [m, y]
    if (Array.isArray(user_ids) && user_ids.length) {
      query += ` AND ss.user_id = ANY($3::uuid[])`
      params.push(user_ids)
    }

    const result = await pool.query(query, params)
    if (!result.rows.length) {
      return next(new AppError('No generated salary slips found for this month/year', 404))
    }

    const archive = new ZipArchive({ zlib: { level: 9 } })
    const monthName = new Date(y, m - 1).toLocaleString('en-US', { month: 'long' })

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="Salary_Slips_${monthName}_${y}.zip"`)
    archive.pipe(res)

    for (const slip of result.rows) {
      const stream = new PassThrough()
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      await new Promise((resolve, reject) => {
        stream.on('end', resolve)
        stream.on('error', reject)
        renderSalarySlipPdf(slip, stream)
      })
      archive.append(Buffer.concat(chunks), { name: `${slip.employee_name.replace(/\s+/g, '_')}_${monthName}_${y}.pdf` })
    }

    await archive.finalize()
  } catch (err) { next(err) }
}

// ─── 7. SALARY HISTORY FOR ONE EMPLOYEE ──────────────────────────────────────
/**
 * GET /api/v1/salary/history/:user_id
 * Admin only. Returns all salary records set for an employee over time.
 */
const getSalaryHistory = async (req, res, next) => {
  try {
    const { user_id } = req.params

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1`,
      [user_id]
    )
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404))

    const history = await pool.query(
      `SELECT es.*, CONCAT(u.first_name,' ',u.last_name) AS set_by_name
       FROM employee_salaries es
       LEFT JOIN users u ON u.id = es.set_by
       WHERE es.user_id = $1
       ORDER BY es.effective_from DESC, es.created_at DESC`,
      [user_id]
    )

    return sendSuccess(res, 'Salary history fetched', {
      employee: userChk.rows[0],
      history:  history.rows.map(r => ({
        ...r,
        monthly_salary: parseFloat(r.monthly_salary),
        per_day_salary:  r.per_day_salary ? parseFloat(r.per_day_salary) : null,
      })),
    })
  } catch (err) { next(err) }
}

// ─── 8. MY SALARY HISTORY (Employee) ──────────────────────────────────────────
/**
 * GET /api/v1/salary/my-salary-history
 * Returns the salary history for the logged-in employee
 */
const getMySalaryHistory = async (req, res, next) => {
  try {
    const userId = req.user.id

    const history = await pool.query(
      `SELECT es.*, CONCAT(u.first_name,' ',u.last_name) AS set_by_name
       FROM employee_salaries es
       LEFT JOIN users u ON u.id = es.set_by
       WHERE es.user_id = $1
       ORDER BY es.effective_from DESC, es.created_at DESC`,
      [userId]
    )

    return sendSuccess(res, 'Your salary history fetched', {
      history: history.rows.map(r => ({
        ...r,
        monthly_salary: parseFloat(r.monthly_salary),
        per_day_salary: r.per_day_salary ? parseFloat(r.per_day_salary) : null,
      })),
    })
  } catch (err) { next(err) }
}

// ─── 8. BULK GENERATE — Generate slips for ALL employees for a month ─────────
/**
 * POST /api/v1/salary/generate-all
 * Body: { month, year, deductions_map?: { user_id: amount }, working_days_override? }
 *
 * Admin generates salary slips for all employees in one shot.
 * deductions_map lets admin specify per-user deduction amounts.
 */
const generateAllSalarySlips = async (req, res, next) => {
  try {
    const {
      month, year,
      deductions_map = {},
      payment_mode = 'Bank Transfer',
      pay_date,
      auth_signature,
      working_days_override,
      notes,
    } = req.body

    if (!month || !year) return next(new AppError('month and year are required', 400))

    const m = parseInt(month)
    const y = parseInt(year)

    // Get all active employees who have a salary set
    const employees = await pool.query(
      `SELECT
         u.id, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role,
         es.monthly_salary, es.effective_from
       FROM users u
       JOIN LATERAL (
         SELECT * FROM employee_salaries
         WHERE user_id = u.id
         ORDER BY effective_from DESC, created_at DESC
         LIMIT 1
       ) es ON true
       WHERE u.is_active = true
       ORDER BY u.first_name ASC`
    )

    if (!employees.rows.length) {
      return next(new AppError('No employees with salaries set. Please set salaries first.', 400))
    }

    const start        = `${y}-${String(m).padStart(2, '0')}-01`
    const end          = new Date(y, m, 0).toISOString().split('T')[0]
    const workingDays  = working_days_override
      ? parseInt(working_days_override)
      : countWorkingDays(y, m)
    const monthName    = new Date(y, m - 1).toLocaleString('en-IN', { month: 'long' })
    const finalPayDate = pay_date || end // last day of month by default

    // Fetch attendance for ALL employees in one query.
    // late_by_minutes > 5 means check-in was after 10:35 AM → half day (50% cut).
    const attResult = await pool.query(
      `SELECT
         user_id,
         COUNT(*) FILTER (WHERE status IN ('present', 'late') AND (late_by_minutes IS NULL OR late_by_minutes <= 5)) AS full_present_count,
         COUNT(*) FILTER (WHERE status = 'late' AND late_by_minutes > 5)                        AS late_half_day_count,
         COUNT(*) FILTER (WHERE status = 'leave' AND leave_type = 'half_day')                    AS half_day_leave_count,
         COUNT(*) FILTER (WHERE status = 'leave' AND (leave_type IS NULL OR leave_type != 'half_day')) AS full_leave_count,
         COUNT(*) FILTER (WHERE status = 'absent')                                               AS absent_count
       FROM attendance
       WHERE date BETWEEN $1 AND $2
         AND user_id = ANY($3::uuid[])
       GROUP BY user_id`,
      [start, end, employees.rows.map(e => e.id)]
    )

    const attMap = {}
    attResult.rows.forEach(r => { attMap[r.user_id] = r })

    // Incentive per employee is pulled from employee_incentives, never from
    // the request — same rule as the single-slip generate endpoint.
    const incentiveMap = await getMonthlyIncentiveTotals(employees.rows.map(e => e.id), m, y)

    const results  = []
    const failures = []

    for (const emp of employees.rows) {
      try {
        const att = attMap[emp.id] || { full_present_count: 0, late_half_day_count: 0, half_day_leave_count: 0, full_leave_count: 0, absent_count: 0 }
        const fullPresentCount  = parseFloat(att.full_present_count)   || 0
        const lateHalfDayCount  = parseFloat(att.late_half_day_count)  || 0
        const halfDayLeaveCount = parseFloat(att.half_day_leave_count) || 0
        const fullLeaveCount    = parseFloat(att.full_leave_count)    || 0
        const absentCount       = parseFloat(att.absent_count)        || 0
        const presentDays  = fullPresentCount + (lateHalfDayCount * 0.5) + (halfDayLeaveCount * 0.5)
        const absentDays   = absentCount
        const leaveDays    = fullLeaveCount + halfDayLeaveCount

        const monthlySalary = parseFloat(emp.monthly_salary)
        const perDaySalary  = parseFloat((monthlySalary / workingDays).toFixed(2))
        const earnedSalary  = parseFloat((perDaySalary * presentDays).toFixed(2))
        const deductionAmt  = parseFloat(deductions_map[emp.id] || 0)
        const finalSalary   = parseFloat((earnedSalary - deductionAmt).toFixed(2))
        const incentiveAmt  = incentiveMap.get(emp.id) || 0
        const totalPayout   = parseFloat((finalSalary + incentiveAmt).toFixed(2))

        await pool.query(
          `INSERT INTO salary_slips
             (user_id, month, year, monthly_salary, working_days, present_days,
              absent_days, leave_days, per_day_salary, earned_salary,
              deductions, final_salary, incentive_amount, total_payout,
              payment_mode, pay_date, auth_signature_url, generated_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           ON CONFLICT (user_id, month, year)
           DO UPDATE SET
             monthly_salary     = EXCLUDED.monthly_salary,
             working_days       = EXCLUDED.working_days,
             present_days       = EXCLUDED.present_days,
             absent_days        = EXCLUDED.absent_days,
             leave_days         = EXCLUDED.leave_days,
             per_day_salary     = EXCLUDED.per_day_salary,
             earned_salary      = EXCLUDED.earned_salary,
             deductions         = EXCLUDED.deductions,
             final_salary       = EXCLUDED.final_salary,
             incentive_amount   = EXCLUDED.incentive_amount,
             total_payout       = EXCLUDED.total_payout,
             payment_mode       = EXCLUDED.payment_mode,
             pay_date           = EXCLUDED.pay_date,
             auth_signature_url = EXCLUDED.auth_signature_url,
             generated_by       = EXCLUDED.generated_by,
             notes              = EXCLUDED.notes,
             updated_at         = NOW()`,
          [
            emp.id, m, y, monthlySalary, workingDays, presentDays,
            absentDays, leaveDays, perDaySalary, earnedSalary,
            deductionAmt, finalSalary, incentiveAmt, totalPayout,
            payment_mode, finalPayDate, auth_signature || null, req.user.id, notes || null,
          ]
        )

        results.push({
          user_id:          emp.id,
          full_name:        emp.full_name,
          monthly_salary:   monthlySalary,
          present_days:     presentDays,
          earned_salary:    earnedSalary,
          deductions:       deductionAmt,
          final_salary:     finalSalary,
          incentive_amount: incentiveAmt,
          total_payout:     totalPayout,
        })
      } catch (empErr) {
        failures.push({ user_id: emp.id, full_name: emp.full_name, error: empErr.message })
      }
    }

    return sendSuccess(res, `Salary slips generated for ${monthName} ${y}`, {
      month:          monthName,
      year:           y,
      working_days:   workingDays,
      total_processed: results.length,
      total_failed:    failures.length,
      slips:           results,
      failures,
    }, 201)
  } catch (err) { next(err) }
}

module.exports = {
  setEmployeeSalary,
  getAllEmployeeSalaries,
  uploadSalarySignature,
  generateSalarySlip,
  generateAllSalarySlips,
  getSalarySlips,
  getUserSalarySlips,
  getMySalary,
  getSlipById,
  updateSalarySlip,
  downloadSalarySlipPdf,
  bulkDownloadSalarySlipsPdf,
  getSalaryHistory,
  getMySalaryHistory,
}

// ─── GET APPRAISAL HISTORY ────────────────────────────────────────────────────
const getAppraisalHistory = async (req, res, next) => {
  try {
    const { user_id } = req.params
    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role
       FROM users WHERE id = $1`, [user_id]
    )
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404))
    const history = await pool.query(
      `SELECT ea.*, CONCAT(u.first_name,' ',u.last_name) AS appraised_by_name
       FROM employee_appraisals ea
       LEFT JOIN users u ON u.id = ea.appraised_by
       WHERE ea.user_id = $1
       ORDER BY ea.effective_from DESC, ea.created_at DESC`, [user_id]
    )
    return sendSuccess(res, 'Appraisal history fetched', {
      employee: userChk.rows[0],
      total:    history.rows.length,
      history:  history.rows.map(r => ({
        ...r,
        from_salary:       r.from_salary       ? parseFloat(r.from_salary)       : null,
        to_salary:         parseFloat(r.to_salary),
        increment_amount:  r.increment_amount  ? parseFloat(r.increment_amount)  : null,
        increment_percent: r.increment_percent ? parseFloat(r.increment_percent) : null,
      })),
    })
  } catch (err) { next(err) }
}

// ─── GET USER SALARY SUMMARY ──────────────────────────────────────────────────
const getUserSalarySummary = async (req, res, next) => {
  try {
    const { user_id }     = req.params
    const { month, year } = req.query
    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email, phone_number
       FROM users WHERE id = $1`, [user_id]
    )
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404))
    const currentSalary = await getActiveSalary(user_id)

    const slipConds = ['ss.user_id = $1'], slipParams = [user_id]
    let slipIdx = 2
    if (month) { slipConds.push(`ss.month = $${slipIdx++}`); slipParams.push(parseInt(month)) }
    if (year)  { slipConds.push(`ss.year = $${slipIdx++}`);  slipParams.push(parseInt(year)) }

    const incConds = ['ei.user_id = $1'], incParams = [user_id]
    let incIdx = 2
    if (month) { incConds.push(`ei.month = $${incIdx++}`); incParams.push(parseInt(month)) }
    if (year)  { incConds.push(`ei.year = $${incIdx++}`);  incParams.push(parseInt(year)) }

    const [slipsRes, incentivesRes, appraisalsRes] = await Promise.all([
      pool.query(
        `SELECT ss.*, CONCAT(g.first_name,' ',g.last_name) AS generated_by_name
         FROM salary_slips ss LEFT JOIN users g ON g.id = ss.generated_by
         WHERE ${slipConds.join(' AND ')} ORDER BY ss.year DESC, ss.month DESC`, slipParams
      ),
      pool.query(
        `SELECT ei.*, CONCAT(g.first_name,' ',g.last_name) AS given_by_name
         FROM employee_incentives ei LEFT JOIN users g ON g.id = ei.given_by
         WHERE ei.user_id = $1 ORDER BY ei.created_at DESC`, [user_id]
      ),
      pool.query(
        `SELECT ea.*, CONCAT(u.first_name,' ',u.last_name) AS appraised_by_name
         FROM employee_appraisals ea LEFT JOIN users u ON u.id = ea.appraised_by
         WHERE ea.user_id = $1 ORDER BY ea.effective_from DESC`, [user_id]
      ),
    ])

    const monthLabel = (m, y) => new Date(y, m - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })

    return sendSuccess(res, 'User salary summary fetched', {
      employee:       userChk.rows[0],
      current_salary: currentSalary ? {
        monthly_salary: parseFloat(currentSalary.monthly_salary),
        per_day_salary: currentSalary.per_day_salary ? parseFloat(currentSalary.per_day_salary) : null,
        effective_from: currentSalary.effective_from,
        notes:          currentSalary.notes,
      } : null,
      salary_slips: slipsRes.rows.map(r => ({
        id: r.id, month: r.month, year: r.year,
        month_label:    monthLabel(r.month, r.year),
        monthly_salary: parseFloat(r.monthly_salary),
        working_days:   r.working_days,
        present_days:   parseFloat(r.present_days),
        absent_days:    parseFloat(r.absent_days),
        leave_days:     parseFloat(r.leave_days),
        per_day_salary: parseFloat(r.per_day_salary),
        earned_salary:  parseFloat(r.earned_salary),
        deductions:     parseFloat(r.deductions),
        final_salary:   parseFloat(r.final_salary),
        notes:          r.notes,
        generated_by:   r.generated_by_name,
        generated_at:   r.created_at,
      })),

      incentives: incentivesRes.rows.map(r => ({ ...r, amount: parseFloat(r.amount) })),

      appraisal_history: appraisalsRes.rows.map(r => ({
        ...r,
        from_salary:       r.from_salary       ? parseFloat(r.from_salary)       : null,
        to_salary:         parseFloat(r.to_salary),
        increment_amount:  r.increment_amount  ? parseFloat(r.increment_amount)  : null,
        increment_percent: r.increment_percent ? parseFloat(r.increment_percent) : null,
      })),
    })
  } catch (err) { next(err) }
}
// Re-export everything including the new functions
Object.assign(module.exports, {
  getAppraisalHistory,
  getUserSalarySummary,
})


// ═════════════════════════════════════════════════════════════════════════════
// APPRAISAL APIs
// ═════════════════════════════════════════════════════════════════════════════

// ─── CREATE APPRAISAL (Admin) ─────────────────────────────────────────────────
/**
 * POST /api/v1/salary/appraisal
 * Creates a formal appraisal record AND updates the employee's salary.
 *
 * Body: { user_id, new_salary, effective_from?, appraisal_note?, working_days_in_month? }
 *
 * Flow:
 *  1. Fetch employee's current salary
 *  2. Save new salary in employee_salaries
 *  3. Save appraisal record in employee_appraisals with delta calculations
 *  4. Push notification to employee + admins
 */
const createAppraisal = async (req, res, next) => {
  try {
    const {
      user_id,
      new_salary,
      working_days_in_month,
      effective_from,
      appraisal_note,
    } = req.body

    if (!user_id)    return next(new AppError('user_id is required', 400))
    if (!new_salary) return next(new AppError('new_salary is required', 400))

    const newSalary = parseFloat(new_salary)
    if (isNaN(newSalary) || newSalary < 0)
      return next(new AppError('new_salary must be a non-negative number', 400))

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1 AND is_active = true`,
      [user_id]
    )
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404))

    const wdMonth   = parseInt(working_days_in_month) || 26
    const perDay    = parseFloat((newSalary / wdMonth).toFixed(2))
    const fromDate  = effective_from || new Date().toISOString().split('T')[0]

    // Fetch current/previous salary
    const prevSalaryRow = await getActiveSalary(user_id)
    const prevAmount    = prevSalaryRow ? parseFloat(prevSalaryRow.monthly_salary) : null

    // Insert new salary record
    const salaryResult = await pool.query(
      `INSERT INTO employee_salaries (user_id, monthly_salary, per_day_salary, effective_from, set_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user_id, newSalary, perDay, fromDate, req.user.id, appraisal_note || null]
    )

    // Calculate delta
    const incrementAmount  = prevAmount != null ? parseFloat((newSalary - prevAmount).toFixed(2)) : null
    const incrementPercent = prevAmount != null && prevAmount > 0
      ? parseFloat(((incrementAmount / prevAmount) * 100).toFixed(2))
      : null

    // Save appraisal record
    const appraisalResult = await pool.query(
      `INSERT INTO employee_appraisals
         (user_id, from_salary, to_salary, increment_amount, increment_percent,
          effective_from, appraisal_note, appraised_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        user_id,
        prevAmount,
        newSalary,
        incrementAmount,
        incrementPercent,
        fromDate,
        appraisal_note || null,
        req.user.id,
      ]
    )

    // Push notifications
    setImmediate(async () => {
      try {
        const newSalStr  = `₹${Number(newSalary).toLocaleString('en-IN')}/month`
        const hikeStr    = incrementPercent != null
          ? ` (${incrementPercent > 0 ? '+' : ''}${incrementPercent}% hike)`
          : ''

        await createNotification(user_id, {
          type:           'general',
          title:          'Your Appraisal Has Been Processed',
          message:        `Your new salary is ${newSalStr}${hikeStr}, effective ${fromDate}`,
          reference_id:   appraisalResult.rows[0].id,
          reference_type: 'appraisal',
          metadata:       { new_salary: newSalary, from_salary: prevAmount, increment_percent: incrementPercent },
        })

        await notifyAdmins({
          type:           'general',
          title:          'Employee Appraisal Processed',
          message:        `${userChk.rows[0].full_name} appraised to ${newSalStr}${hikeStr}`,
          reference_id:   appraisalResult.rows[0].id,
          reference_type: 'appraisal',
          metadata:       { user_id, new_salary: newSalary, from_salary: prevAmount },
        })
      } catch (e) {
        console.error('[Notification] createAppraisal failed:', e.message)
      }
    })

    const monthName = new Date(fromDate).toLocaleString('en-IN', { month: 'long', year: 'numeric' })

    return sendSuccess(res, `Appraisal processed for ${userChk.rows[0].full_name}`, {
      appraisal: {
        ...appraisalResult.rows[0],
        from_salary:       prevAmount,
        to_salary:         newSalary,
        increment_amount:  incrementAmount,
        increment_percent: incrementPercent,
      },
      salary: {
        ...salaryResult.rows[0],
        monthly_salary: newSalary,
        per_day_salary: perDay,
        effective_from: fromDate,
      },
      employee: userChk.rows[0],
      summary: {
        previous_salary:   prevAmount ? `₹${Number(prevAmount).toLocaleString('en-IN')}` : 'Not set',
        new_salary:        `₹${Number(newSalary).toLocaleString('en-IN')}`,
        increment_amount:  incrementAmount  != null ? `₹${Number(incrementAmount).toLocaleString('en-IN')}` : null,
        increment_percent: incrementPercent != null ? `${incrementPercent}%` : null,
        effective_from:    fromDate,
        month_label:       monthName,
      },
    }, 201)
  } catch (err) { next(err) }
}

// ─── UPDATE APPRAISAL (Admin) ─────────────────────────────────────────────────
/**
 * PUT /api/v1/salary/appraisal/:id
 * Update appraisal note or effective_from on an existing appraisal.
 * Does NOT change salary values — those are immutable once set.
 */
const updateAppraisal = async (req, res, next) => {
  try {
    const { id } = req.params
    const { appraisal_note, effective_from } = req.body

    const existing = await pool.query(
      `SELECT ea.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name
       FROM employee_appraisals ea JOIN users u ON u.id = ea.user_id WHERE ea.id = $1`,
      [id]
    )
    if (!existing.rows.length) return next(new AppError('Appraisal record not found', 404))

    const updates = []; const params = []; let idx = 1
    if (appraisal_note !== undefined) { updates.push(`appraisal_note = $${idx++}`); params.push(appraisal_note) }
    if (effective_from !== undefined) { updates.push(`effective_from = $${idx++}`); params.push(effective_from) }
    if (!updates.length) return next(new AppError('Nothing to update. Provide appraisal_note or effective_from', 400))

    updates.push(`updated_at = NOW()`)
    params.push(id)

    const result = await pool.query(
      `UPDATE employee_appraisals SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    )

    return sendSuccess(res, 'Appraisal updated', {
      appraisal:     result.rows[0],
      employee_name: existing.rows[0].employee_name,
    })
  } catch (err) { next(err) }
}

// ═════════════════════════════════════════════════════════════════════════════
// INCENTIVE APIs
// ═════════════════════════════════════════════════════════════════════════════

// ─── ADD INCENTIVE (Admin) ────────────────────────────────────────────────────
const addIncentive = async (req, res, next) => {
  try {
    const { user_id, month, year, amount, reason } = req.body
    if (!user_id || !month || !year || amount == null)
      return next(new AppError('user_id, month, year, and amount are required', 400))
    const m = parseInt(month), y = parseInt(year)
    if (m < 1 || m > 12) return next(new AppError('month must be between 1 and 12', 400))
    if (y < 2020)        return next(new AppError('year must be 2020 or later', 400))
    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount < 0)
      return next(new AppError('amount must be a non-negative number', 400))

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role
       FROM users WHERE id = $1 AND is_active = true`, [user_id]
    )
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404))

    const result = await pool.query(
      `INSERT INTO employee_incentives (user_id, month, year, amount, reason, given_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [user_id, m, y, parsedAmount, reason || null, req.user.id]
    )
    const monthName = new Date(y, m - 1).toLocaleString('en-IN', { month: 'long' })

    setImmediate(async () => {
      try {
        const amtStr = `₹${Number(parsedAmount).toLocaleString('en-IN')}`
        await createNotification(user_id, {
          type:           'general',
          title:          'Incentive Added',
          message:        `An incentive of ${amtStr} has been added for ${monthName} ${y}${reason ? ` — ${reason}` : ''}`,
          reference_id:   result.rows[0].id,
          reference_type: 'incentive',
          metadata:       { amount: parsedAmount, month: m, year: y },
        })
        await notifyAdmins({
          type:           'general',
          title:          `Incentive Added — ${userChk.rows[0].full_name}`,
          message:        `Incentive of ${amtStr} added for ${userChk.rows[0].full_name} (${monthName} ${y})`,
          reference_id:   result.rows[0].id,
          reference_type: 'incentive',
          metadata:       { user_id, amount: parsedAmount, month: m, year: y },
        })
      } catch (e) { console.error('[Notification] addIncentive failed:', e.message) }
    })

    return sendSuccess(res, `Incentive of ₹${parsedAmount} added for ${monthName} ${y}`, {
      incentive:   result.rows[0],
      employee:    userChk.rows[0],
      month_label: `${monthName} ${y}`,
    }, 201)
  } catch (err) { next(err) }
}

// ─── GET ALL INCENTIVES (Admin, filterable) ───────────────────────────────────
const getIncentives = async (req, res, next) => {
  try {
    const { user_id, month, year, page = 1, per_page = 20 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(per_page)
    const conds = []; const params = []; let idx = 1
    if (user_id) { conds.push(`ei.user_id = $${idx++}`); params.push(user_id) }
    if (month)   { conds.push(`ei.month = $${idx++}`);   params.push(parseInt(month)) }
    if (year)    { conds.push(`ei.year = $${idx++}`);    params.push(parseInt(year)) }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    const [cnt, data] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM employee_incentives ei ${where}`, params),
      pool.query(
        `SELECT ei.*,
                CONCAT(u.first_name,' ',u.last_name) AS employee_name, u.role AS employee_role,
                CONCAT(g.first_name,' ',g.last_name) AS given_by_name
         FROM employee_incentives ei
         JOIN  users u ON u.id = ei.user_id
         LEFT JOIN users g ON g.id = ei.given_by
         ${where}
         ORDER BY ei.year DESC, ei.month DESC, ei.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, parseInt(per_page), offset]
      ),
    ])
    const total = parseInt(cnt.rows[0].count)
    return sendSuccess(res, 'Incentives fetched', {
      data: data.rows.map(r => ({ ...r, amount: parseFloat(r.amount) })),
      pagination: {
        total, page: parseInt(page), per_page: parseInt(per_page),
        total_pages: Math.ceil(total / parseInt(per_page)),
      },
    })
  } catch (err) { next(err) }
}

// ─── GET INCENTIVES FOR ONE EMPLOYEE (Admin) ──────────────────────────────────
const getUserIncentives = async (req, res, next) => {
  try {
    const { user_id } = req.params
    const { month, year } = req.query

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1`,
      [user_id]
    )
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404))

    const conds = ['ei.user_id = $1']; const params = [user_id]; let idx = 2
    if (month) { conds.push(`ei.month = $${idx++}`); params.push(parseInt(month)) }
    if (year)  { conds.push(`ei.year = $${idx++}`);  params.push(parseInt(year)) }

    const result = await pool.query(
      `SELECT ei.*, CONCAT(g.first_name,' ',g.last_name) AS given_by_name
       FROM employee_incentives ei
       LEFT JOIN users g ON g.id = ei.given_by
       WHERE ${conds.join(' AND ')}
       ORDER BY ei.year DESC, ei.month DESC, ei.created_at DESC`,
      params
    )

    const rows     = result.rows.map(r => ({ ...r, amount: parseFloat(r.amount) }))
    const totalAmt = rows.reduce((s, r) => s + r.amount, 0)

    // Group by month-year for easy display
    const byMonth = {}
    rows.forEach(r => {
      const key = `${r.year}-${String(r.month).padStart(2,'0')}`
      const label = new Date(r.year, r.month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
      if (!byMonth[key]) byMonth[key] = { month: r.month, year: r.year, month_label: label, total: 0, records: [] }
      byMonth[key].total  = parseFloat((byMonth[key].total + r.amount).toFixed(2))
      byMonth[key].records.push(r)
    })

    return sendSuccess(res, `Incentives for ${userChk.rows[0].full_name}`, {
      employee: userChk.rows[0],
      summary: {
        total_amount: parseFloat(totalAmt.toFixed(2)),
        total_count:  rows.length,
      },
      by_month:   Object.values(byMonth).sort((a, b) => b.year - a.year || b.month - a.month),
      incentives: rows,
    })
  } catch (err) { next(err) }
}

// ─── GET MY INCENTIVES (Employee) ────────────────────────────────────────────
const getMyIncentives = async (req, res, next) => {
  try {
    const userId = req.user.id
    const { month, year } = req.query
    const conds = ['ei.user_id = $1']; const params = [userId]; let idx = 2
    if (month) { conds.push(`ei.month = $${idx++}`); params.push(parseInt(month)) }
    if (year)  { conds.push(`ei.year = $${idx++}`);  params.push(parseInt(year)) }

    const result = await pool.query(
      `SELECT ei.*, CONCAT(g.first_name,' ',g.last_name) AS given_by_name
       FROM employee_incentives ei
       LEFT JOIN users g ON g.id = ei.given_by
       WHERE ${conds.join(' AND ')}
       ORDER BY ei.year DESC, ei.month DESC, ei.created_at DESC`,
      params
    )
    const rows  = result.rows.map(r => ({ ...r, amount: parseFloat(r.amount) }))
    const total = rows.reduce((s, r) => s + r.amount, 0)
    return sendSuccess(res, 'Your incentives', {
      total_incentive_amount: parseFloat(total.toFixed(2)),
      total_count:            rows.length,
      incentives:             rows,
    })
  } catch (err) { next(err) }
}

// ─── DELETE INCENTIVE (Admin) ─────────────────────────────────────────────────
const deleteIncentive = async (req, res, next) => {
  try {
    const { id } = req.params
    const check = await pool.query(
      `SELECT ei.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name
       FROM employee_incentives ei JOIN users u ON u.id = ei.user_id WHERE ei.id = $1`, [id]
    )
    if (!check.rows.length) return next(new AppError('Incentive record not found', 404))
    await pool.query('DELETE FROM employee_incentives WHERE id = $1', [id])
    return sendSuccess(res, 'Incentive deleted successfully', { deleted: check.rows[0] })
  } catch (err) { next(err) }
}

Object.assign(module.exports, {
  createAppraisal,
  updateAppraisal,
  addIncentive,
  getIncentives,
  getUserIncentives,
  getMyIncentives,
  deleteIncentive,
})