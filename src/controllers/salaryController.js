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
 *   present_days  = present + late + (0.5 × half_day)
 *   per_day       = monthly_salary / working_days
 *   earned        = per_day × present_days
 *   final         = earned - deductions
 *
 * Attendance → salary mapping (set by attendance rules):
 *   present / late  = 1 full day  (check-in 10:30–14:00 AND checkout ≥ 19:30)
 *   half_day        = 0.5 day     (check-in after 14:00 OR checkout before 19:30)
 *   absent / leave  = 0
 */

const { pool }      = require('../config/db')
const { sendSuccess } = require('../utils/response')
const AppError      = require('../utils/AppError')

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

// ─── 3. GENERATE SALARY SLIP (Admin) ─────────────────────────────────────────
/**
 * POST /api/v1/salary/generate
 * Body: { user_id, month, year, deductions?, notes?, working_days_override? }
 *
 * Calculates earned salary from attendance for the given month/year.
 * working_days_override allows admin to manually set the working days
 * (e.g. for months with holidays).
 */
const generateSalarySlip = async (req, res, next) => {
  try {
    const {
      user_id, month, year,
      deductions = 0,
      notes,
      working_days_override,
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

    // Get active salary
    const salary = await getActiveSalary(user_id)
    if (!salary) {
      return next(new AppError(
        `No salary has been set for this employee. Set a salary first via POST /api/v1/salary/set`, 400
      ))
    }

    // Date range for the month
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end   = new Date(y, m, 0).toISOString().split('T')[0]

    // Pull attendance summary for the month
    const attResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('present', 'late'))        AS present_count,
         COUNT(*) FILTER (WHERE status = 'half_day')                   AS half_day_count,
         COUNT(*) FILTER (WHERE status IN ('on_leave'))                AS leave_count,
         COUNT(*) FILTER (WHERE status = 'absent')                     AS absent_count
       FROM attendance
       WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
      [user_id, start, end]
    )

    const att = attResult.rows[0]
    const presentCount  = parseFloat(att.present_count)  || 0
    const halfDayCount  = parseFloat(att.half_day_count) || 0
    const leaveCount    = parseFloat(att.leave_count)    || 0
    const absentCount   = parseFloat(att.absent_count)   || 0

    // Salary rule:
    //   present / late  → 1.0 × per_day  (full salary)
    //   half_day        → 0.5 × per_day  (50% deduction — checked in after 2PM or left before 7:30PM)
    //   on_leave/absent → 0
    const presentDays = presentCount + (halfDayCount * 0.5)
    const absentDays  = absentCount
    const leaveDays   = leaveCount

    // Working days: Mon–Fri count for the month (or admin override)
    const workingDays = working_days_override
      ? parseInt(working_days_override)
      : countWorkingDays(y, m)

    if (workingDays <= 0) {
      return next(new AppError('working_days must be greater than 0', 400))
    }

    const monthlySalary = parseFloat(salary.monthly_salary)
    const perDaySalary  = parseFloat((monthlySalary / workingDays).toFixed(2))
    const earnedSalary  = parseFloat((perDaySalary * presentDays).toFixed(2))
    const deductionAmt  = parseFloat(deductions) || 0
    const finalSalary   = parseFloat((earnedSalary - deductionAmt).toFixed(2))

    // Upsert slip (overwrite if already generated for this month)
    const slip = await pool.query(
      `INSERT INTO salary_slips
         (user_id, month, year, monthly_salary, working_days, present_days,
          absent_days, leave_days, per_day_salary, earned_salary,
          deductions, final_salary, generated_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (user_id, month, year)
       DO UPDATE SET
         monthly_salary = EXCLUDED.monthly_salary,
         working_days   = EXCLUDED.working_days,
         present_days   = EXCLUDED.present_days,
         absent_days    = EXCLUDED.absent_days,
         leave_days     = EXCLUDED.leave_days,
         per_day_salary = EXCLUDED.per_day_salary,
         earned_salary  = EXCLUDED.earned_salary,
         deductions     = EXCLUDED.deductions,
         final_salary   = EXCLUDED.final_salary,
         generated_by   = EXCLUDED.generated_by,
         notes          = EXCLUDED.notes,
         updated_at     = NOW()
       RETURNING *`,
      [
        user_id, m, y, monthlySalary, workingDays, presentDays,
        absentDays, leaveDays, perDaySalary, earnedSalary,
        deductionAmt, finalSalary, req.user.id, notes || null,
      ]
    )

    const monthName = new Date(y, m - 1).toLocaleString('en-IN', { month: 'long' })

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
        monthly_salary: parseFloat(r.monthly_salary),
        per_day_salary: parseFloat(r.per_day_salary),
        earned_salary:  parseFloat(r.earned_salary),
        deductions:     parseFloat(r.deductions),
        final_salary:   parseFloat(r.final_salary),
        present_days:   parseFloat(r.present_days),
        absent_days:    parseFloat(r.absent_days),
        leave_days:     parseFloat(r.leave_days),
      })),
      pagination: {
        total, page: parseInt(page), per_page: parseInt(per_page),
        total_pages: Math.ceil(total / parseInt(per_page)),
      },
    })
  } catch (err) { next(err) }
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
        id:             r.id,
        month:          r.month,
        year:           r.year,
        month_label:    monthName(r.month, r.year),
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
        generated_at:   r.created_at,
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
      monthly_salary: parseFloat(slip.monthly_salary),
      per_day_salary: parseFloat(slip.per_day_salary),
      earned_salary:  parseFloat(slip.earned_salary),
      deductions:     parseFloat(slip.deductions),
      final_salary:   parseFloat(slip.final_salary),
      present_days:   parseFloat(slip.present_days),
      absent_days:    parseFloat(slip.absent_days),
      leave_days:     parseFloat(slip.leave_days),
    })
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
    const { month, year, deductions_map = {}, working_days_override, notes } = req.body

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

    // Fetch attendance for ALL employees in one query
    const attResult = await pool.query(
      `SELECT
         user_id,
         COUNT(*) FILTER (WHERE status IN ('present', 'late'))  AS present_count,
         COUNT(*) FILTER (WHERE status = 'half_day')             AS half_day_count,
         COUNT(*) FILTER (WHERE status IN ('on_leave'))          AS leave_count,
         COUNT(*) FILTER (WHERE status = 'absent')               AS absent_count
       FROM attendance
       WHERE date BETWEEN $1 AND $2
         AND user_id = ANY($3::uuid[])
       GROUP BY user_id`,
      [start, end, employees.rows.map(e => e.id)]
    )

    const attMap = {}
    attResult.rows.forEach(r => { attMap[r.user_id] = r })

    const results  = []
    const failures = []

    for (const emp of employees.rows) {
      try {
        const att = attMap[emp.id] || { present_count: 0, half_day_count: 0, leave_count: 0, absent_count: 0 }
        const presentCount = parseFloat(att.present_count)  || 0
        const halfDayCount = parseFloat(att.half_day_count) || 0
        const leaveCount   = parseFloat(att.leave_count)    || 0
        const absentCount  = parseFloat(att.absent_count)   || 0
        // present/late = full day, half_day = 0.5 day
        const presentDays  = presentCount + (halfDayCount * 0.5)
        const absentDays   = absentCount
        const leaveDays    = leaveCount

        const monthlySalary = parseFloat(emp.monthly_salary)
        const perDaySalary  = parseFloat((monthlySalary / workingDays).toFixed(2))
        const earnedSalary  = parseFloat((perDaySalary * presentDays).toFixed(2))
        const deductionAmt  = parseFloat(deductions_map[emp.id] || 0)
        const finalSalary   = parseFloat((earnedSalary - deductionAmt).toFixed(2))

        await pool.query(
          `INSERT INTO salary_slips
             (user_id, month, year, monthly_salary, working_days, present_days,
              absent_days, leave_days, per_day_salary, earned_salary,
              deductions, final_salary, generated_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (user_id, month, year)
           DO UPDATE SET
             monthly_salary = EXCLUDED.monthly_salary,
             working_days   = EXCLUDED.working_days,
             present_days   = EXCLUDED.present_days,
             absent_days    = EXCLUDED.absent_days,
             leave_days     = EXCLUDED.leave_days,
             per_day_salary = EXCLUDED.per_day_salary,
             earned_salary  = EXCLUDED.earned_salary,
             deductions     = EXCLUDED.deductions,
             final_salary   = EXCLUDED.final_salary,
             generated_by   = EXCLUDED.generated_by,
             notes          = EXCLUDED.notes,
             updated_at     = NOW()`,
          [
            emp.id, m, y, monthlySalary, workingDays, presentDays,
            absentDays, leaveDays, perDaySalary, earnedSalary,
            deductionAmt, finalSalary, req.user.id, notes || null,
          ]
        )

        results.push({
          user_id:       emp.id,
          full_name:     emp.full_name,
          monthly_salary: monthlySalary,
          present_days:  presentDays,
          earned_salary: earnedSalary,
          deductions:    deductionAmt,
          final_salary:  finalSalary,
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
  generateSalarySlip,
  generateAllSalarySlips,
  getSalarySlips,
  getMySalary,
  getSlipById,
  getSalaryHistory,
}