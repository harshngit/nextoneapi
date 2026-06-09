/**
 * salaryController.js — Next One Realty CRM
 *
 * Salary system flow:
 *  1. Admin sets monthly salary for an employee  → POST /api/v1/salary/set
 *  2. Admin generates a salary slip for a month  → POST /api/v1/salary/generate
 *  3. Admin views all slips / per employee        → GET  /api/v1/salary/slips
 *  4. Employee views their own earned salary      → GET  /api/v1/salary/my-salary
 *  5. Admin views salary set for all employees    → GET  /api/v1/salary/employees
 *  6. [NEW] Add incentive for an employee         → POST /api/v1/salary/incentive
 *  7. [NEW] Get incentives (all or per user)      → GET  /api/v1/salary/incentives
 *  8. [NEW] Delete an incentive                   → DELETE /api/v1/salary/incentive/:id
 *  9. [NEW] Get appraisal history for a user      → GET  /api/v1/salary/appraisals/:user_id
 * 10. [NEW] Get salary details for a specific user → GET /api/v1/salary/user/:user_id
 *
 * Earned salary formula:
 *   working_days  = total Mon–Fri days in the month (or manually overridable)
 *   present_days  = present + late + (0.5 × half_day)
 *   per_day       = monthly_salary / working_days
 *   earned        = per_day × present_days
 *   final         = earned - deductions
 *   total_payout  = final + incentive_amount   ← NEW
 *
 * Appraisal history is saved automatically every time setEmployeeSalary
 * is called AND the new salary differs from the previous one.
 */

const { pool }        = require('../config/db');
const { sendSuccess } = require('../utils/response');
const AppError        = require('../utils/AppError');

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Count Mon–Fri days in a given month/year */
const countWorkingDays = (year, month) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
};

/** Get latest active salary for a user */
const getActiveSalary = async (userId) => {
  const r = await pool.query(
    `SELECT * FROM employee_salaries
     WHERE user_id = $1
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
};

// ─── 1. SET / UPDATE EMPLOYEE SALARY (Admin only) ─────────────────────────────
/**
 * POST /api/v1/salary/set
 * Body: { user_id, monthly_salary?, per_day_salary?, working_days_in_month?,
 *         effective_from?, notes?, appraisal_note? }
 *
 * - Admin can provide EITHER monthly_salary OR per_day_salary.
 * - If the new salary differs from the last, an appraisal record is saved automatically.
 * - appraisal_note (optional) — reason / performance remark for the appraisal.
 */
const setEmployeeSalary = async (req, res, next) => {
  try {
    const {
      user_id,
      monthly_salary,
      per_day_salary,
      working_days_in_month,
      effective_from,
      notes,
      appraisal_note,
    } = req.body;

    if (!user_id) return next(new AppError('user_id is required', 400));

    if (monthly_salary == null && per_day_salary == null) {
      return next(new AppError('Provide at least one of: monthly_salary or per_day_salary', 400));
    }

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1 AND is_active = true`,
      [user_id]
    );
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404));

    const wdMonth = parseInt(working_days_in_month) || 26;
    let finalMonthly, finalPerDay;

    if (monthly_salary != null) {
      finalMonthly = parseFloat(monthly_salary);
      if (isNaN(finalMonthly) || finalMonthly < 0) {
        return next(new AppError('monthly_salary must be a non-negative number', 400));
      }
      finalPerDay = parseFloat((finalMonthly / wdMonth).toFixed(2));
    } else {
      finalPerDay = parseFloat(per_day_salary);
      if (isNaN(finalPerDay) || finalPerDay < 0) {
        return next(new AppError('per_day_salary must be a non-negative number', 400));
      }
      finalMonthly = parseFloat((finalPerDay * wdMonth).toFixed(2));
    }

    const fromDate = effective_from || new Date().toISOString().split('T')[0];

    // Fetch previous salary for appraisal delta calculation
    const previousSalary = await getActiveSalary(user_id);

    const result = await pool.query(
      `INSERT INTO employee_salaries
         (user_id, monthly_salary, per_day_salary, effective_from, set_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user_id, finalMonthly, finalPerDay, fromDate, req.user.id, notes || null]
    );

    // ── Auto-save appraisal if salary changed ────────────────────────────
    let appraisalRecord = null;
    const prevAmount = previousSalary ? parseFloat(previousSalary.monthly_salary) : null;

    if (prevAmount === null || prevAmount !== finalMonthly) {
      const incrementAmount  = prevAmount != null ? parseFloat((finalMonthly - prevAmount).toFixed(2)) : null;
      const incrementPercent = prevAmount != null && prevAmount > 0
        ? parseFloat(((incrementAmount / prevAmount) * 100).toFixed(2))
        : null;

      const apprRes = await pool.query(
        `INSERT INTO employee_appraisals
           (user_id, from_salary, to_salary, increment_amount, increment_percent,
            effective_from, appraisal_note, appraised_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          user_id,
          prevAmount,
          finalMonthly,
          incrementAmount,
          incrementPercent,
          fromDate,
          appraisal_note || notes || null,
          req.user.id,
        ]
      );
      appraisalRecord = apprRes.rows[0];
    }

    return sendSuccess(res, 'Employee salary saved successfully', {
      salary: {
        ...result.rows[0],
        monthly_salary:                     finalMonthly,
        per_day_salary:                     finalPerDay,
        working_days_used_for_calculation:  wdMonth,
      },
      employee:  userChk.rows[0],
      appraisal: appraisalRecord,
    }, 201);
  } catch (err) { next(err); }
};

// ─── 2. GET ALL EMPLOYEES WITH THEIR CURRENT SALARY (Admin) ───────────────────
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
    );

    return sendSuccess(res, 'Employee salaries fetched', {
      total: result.rows.length,
      data:  result.rows.map(r => ({
        ...r,
        monthly_salary: r.monthly_salary ? parseFloat(r.monthly_salary) : null,
        per_day_salary: r.per_day_salary  ? parseFloat(r.per_day_salary)  : null,
        salary_set:     !!r.monthly_salary,
      })),
    });
  } catch (err) { next(err); }
};

// ─── 3. GENERATE SALARY SLIP (Admin) ──────────────────────────────────────────
/**
 * POST /api/v1/salary/generate
 * Body: { user_id, month, year, deductions?, notes?, working_days_override? }
 *
 * Now also picks up any incentives recorded for the user in that month/year
 * and adds them to total_payout.
 */
const generateSalarySlip = async (req, res, next) => {
  try {
    const {
      user_id, month, year,
      deductions = 0,
      notes,
      working_days_override,
    } = req.body;

    if (!user_id) return next(new AppError('user_id is required', 400));
    if (!month || !year) return next(new AppError('month and year are required', 400));

    const m = parseInt(month);
    const y = parseInt(year);
    if (m < 1 || m > 12) return next(new AppError('month must be between 1 and 12', 400));
    if (y < 2020)        return next(new AppError('year must be 2020 or later', 400));

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1`,
      [user_id]
    );
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404));

    const salary = await getActiveSalary(user_id);
    if (!salary) {
      return next(new AppError(
        'No salary has been set for this employee. Set a salary first via POST /api/v1/salary/set', 400
      ));
    }

    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end   = new Date(y, m, 0).toISOString().split('T')[0];

    // Attendance
    const attResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('present', 'late'))  AS present_count,
         COUNT(*) FILTER (WHERE status = 'half_day')             AS half_day_count,
         COUNT(*) FILTER (WHERE status IN ('on_leave'))          AS leave_count,
         COUNT(*) FILTER (WHERE status = 'absent')               AS absent_count
       FROM attendance
       WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
      [user_id, start, end]
    );

    const att          = attResult.rows[0];
    const presentCount = parseFloat(att.present_count)  || 0;
    const halfDayCount = parseFloat(att.half_day_count) || 0;
    const leaveCount   = parseFloat(att.leave_count)    || 0;
    const absentCount  = parseFloat(att.absent_count)   || 0;

    const presentDays  = presentCount + (halfDayCount * 0.5);
    const absentDays   = absentCount;
    const leaveDays    = leaveCount;

    const workingDays = working_days_override
      ? parseInt(working_days_override)
      : countWorkingDays(y, m);

    if (workingDays <= 0) {
      return next(new AppError('working_days must be greater than 0', 400));
    }

    const monthlySalary = parseFloat(salary.monthly_salary);
    const perDaySalary  = parseFloat((monthlySalary / workingDays).toFixed(2));
    const earnedSalary  = parseFloat((perDaySalary * presentDays).toFixed(2));
    const deductionAmt  = parseFloat(deductions) || 0;
    const finalSalary   = parseFloat((earnedSalary - deductionAmt).toFixed(2));

    // ── Sum incentives for this user + month + year ──────────────────────
    const incentiveRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_incentive
       FROM employee_incentives
       WHERE user_id = $1 AND month = $2 AND year = $3`,
      [user_id, m, y]
    );
    const incentiveAmount = parseFloat(incentiveRes.rows[0].total_incentive) || 0;
    const totalPayout     = parseFloat((finalSalary + incentiveAmount).toFixed(2));

    const slip = await pool.query(
      `INSERT INTO salary_slips
         (user_id, month, year, monthly_salary, working_days, present_days,
          absent_days, leave_days, per_day_salary, earned_salary,
          deductions, final_salary, incentive_amount, total_payout, generated_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (user_id, month, year)
       DO UPDATE SET
         monthly_salary   = EXCLUDED.monthly_salary,
         working_days     = EXCLUDED.working_days,
         present_days     = EXCLUDED.present_days,
         absent_days      = EXCLUDED.absent_days,
         leave_days       = EXCLUDED.leave_days,
         per_day_salary   = EXCLUDED.per_day_salary,
         earned_salary    = EXCLUDED.earned_salary,
         deductions       = EXCLUDED.deductions,
         final_salary     = EXCLUDED.final_salary,
         incentive_amount = EXCLUDED.incentive_amount,
         total_payout     = EXCLUDED.total_payout,
         generated_by     = EXCLUDED.generated_by,
         notes            = EXCLUDED.notes,
         updated_at       = NOW()
       RETURNING *`,
      [
        user_id, m, y, monthlySalary, workingDays, presentDays,
        absentDays, leaveDays, perDaySalary, earnedSalary,
        deductionAmt, finalSalary, incentiveAmount, totalPayout,
        req.user.id, notes || null,
      ]
    );

    const monthName = new Date(y, m - 1).toLocaleString('en-IN', { month: 'long' });

    return sendSuccess(res, `Salary slip generated for ${monthName} ${y}`, {
      slip:     slip.rows[0],
      employee: userChk.rows[0],
      breakdown: {
        month:            monthName,
        year:             y,
        monthly_salary:   monthlySalary,
        working_days:     workingDays,
        present_days:     presentDays,
        absent_days:      absentDays,
        leave_days:       leaveDays,
        per_day_salary:   perDaySalary,
        earned_salary:    earnedSalary,
        deductions:       deductionAmt,
        final_salary:     finalSalary,
        incentive_amount: incentiveAmount,
        total_payout:     totalPayout,
        period:           { from: start, to: end },
      },
    }, 201);
  } catch (err) { next(err); }
};

// ─── 4. GET SALARY SLIPS — Admin ──────────────────────────────────────────────
const getSalarySlips = async (req, res, next) => {
  try {
    const { user_id, month, year, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const conds  = [];
    const params = [];
    let   idx    = 1;

    if (user_id) { conds.push(`ss.user_id = $${idx++}`); params.push(user_id); }
    if (month)   { conds.push(`ss.month = $${idx++}`);   params.push(parseInt(month)); }
    if (year)    { conds.push(`ss.year = $${idx++}`);    params.push(parseInt(year)); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

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
    ]);

    const total = parseInt(cnt.rows[0].count);
    return res.json({
      success: true,
      data:    data.rows.map(r => ({
        ...r,
        monthly_salary:   parseFloat(r.monthly_salary),
        per_day_salary:   parseFloat(r.per_day_salary),
        earned_salary:    parseFloat(r.earned_salary),
        deductions:       parseFloat(r.deductions),
        final_salary:     parseFloat(r.final_salary),
        incentive_amount: parseFloat(r.incentive_amount || 0),
        total_payout:     parseFloat(r.total_payout || r.final_salary),
        present_days:     parseFloat(r.present_days),
        absent_days:      parseFloat(r.absent_days),
        leave_days:       parseFloat(r.leave_days),
      })),
      pagination: {
        total, page: parseInt(page), per_page: parseInt(per_page),
        total_pages: Math.ceil(total / parseInt(per_page)),
      },
    });
  } catch (err) { next(err); }
};

// ─── 5. MY SALARY — Employee sees their own ───────────────────────────────────
const getMySalary = async (req, res, next) => {
  try {
    const userId          = req.user.id;
    const { month, year } = req.query;

    const currentSalary = await getActiveSalary(userId);

    const conds  = ['ss.user_id = $1'];
    const params = [userId];
    let   idx    = 2;

    if (month) { conds.push(`ss.month = $${idx++}`); params.push(parseInt(month)); }
    if (year)  { conds.push(`ss.year = $${idx++}`);  params.push(parseInt(year)); }

    const slips = await pool.query(
      `SELECT ss.*, CONCAT(g.first_name,' ',g.last_name) AS generated_by_name
       FROM salary_slips ss
       LEFT JOIN users g ON g.id = ss.generated_by
       WHERE ${conds.join(' AND ')}
       ORDER BY ss.year DESC, ss.month DESC`,
      params
    );

    const monthName = (m, y) =>
      new Date(y, m - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

    return sendSuccess(res, 'Your salary details', {
      current_monthly_salary: currentSalary
        ? {
            amount:          parseFloat(currentSalary.monthly_salary),
            per_day_salary:  currentSalary.per_day_salary ? parseFloat(currentSalary.per_day_salary) : null,
            effective_from:  currentSalary.effective_from,
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
        incentive_amount: parseFloat(r.incentive_amount || 0),
        total_payout:     parseFloat(r.total_payout || r.final_salary),
        notes:            r.notes,
        generated_at:     r.created_at,
      })),
    });
  } catch (err) { next(err); }
};

// ─── 6. GET SINGLE SLIP ───────────────────────────────────────────────────────
const getSlipById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: callerId } = req.user;

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
    );

    if (!result.rows.length) return next(new AppError('Salary slip not found', 404));

    const slip = result.rows[0];
    if (role === 'sales_executive' && slip.user_id !== callerId) {
      return next(new AppError('Access denied', 403));
    }

    return sendSuccess(res, 'Salary slip fetched', {
      ...slip,
      monthly_salary:   parseFloat(slip.monthly_salary),
      per_day_salary:   parseFloat(slip.per_day_salary),
      earned_salary:    parseFloat(slip.earned_salary),
      deductions:       parseFloat(slip.deductions),
      final_salary:     parseFloat(slip.final_salary),
      incentive_amount: parseFloat(slip.incentive_amount || 0),
      total_payout:     parseFloat(slip.total_payout || slip.final_salary),
      present_days:     parseFloat(slip.present_days),
      absent_days:      parseFloat(slip.absent_days),
      leave_days:       parseFloat(slip.leave_days),
    });
  } catch (err) { next(err); }
};

// ─── 7. SALARY HISTORY FOR ONE EMPLOYEE ──────────────────────────────────────
const getSalaryHistory = async (req, res, next) => {
  try {
    const { user_id } = req.params;

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1`,
      [user_id]
    );
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404));

    const history = await pool.query(
      `SELECT es.*, CONCAT(u.first_name,' ',u.last_name) AS set_by_name
       FROM employee_salaries es
       LEFT JOIN users u ON u.id = es.set_by
       WHERE es.user_id = $1
       ORDER BY es.effective_from DESC, es.created_at DESC`,
      [user_id]
    );

    return sendSuccess(res, 'Salary history fetched', {
      employee: userChk.rows[0],
      history:  history.rows.map(r => ({
        ...r,
        monthly_salary: parseFloat(r.monthly_salary),
        per_day_salary: r.per_day_salary ? parseFloat(r.per_day_salary) : null,
      })),
    });
  } catch (err) { next(err); }
};

// ─── 8. BULK GENERATE ─────────────────────────────────────────────────────────
const generateAllSalarySlips = async (req, res, next) => {
  try {
    const { month, year, deductions_map = {}, working_days_override, notes } = req.body;

    if (!month || !year) return next(new AppError('month and year are required', 400));

    const m = parseInt(month);
    const y = parseInt(year);

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
    );

    if (!employees.rows.length) {
      return next(new AppError('No employees with salaries set. Please set salaries first.', 400));
    }

    const start       = `${y}-${String(m).padStart(2, '0')}-01`;
    const end         = new Date(y, m, 0).toISOString().split('T')[0];
    const workingDays = working_days_override
      ? parseInt(working_days_override)
      : countWorkingDays(y, m);
    const monthName   = new Date(y, m - 1).toLocaleString('en-IN', { month: 'long' });

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
    );

    // Incentives for all users in this month
    const incentiveResult = await pool.query(
      `SELECT user_id, COALESCE(SUM(amount), 0) AS total_incentive
       FROM employee_incentives
       WHERE month = $1 AND year = $2
         AND user_id = ANY($3::uuid[])
       GROUP BY user_id`,
      [m, y, employees.rows.map(e => e.id)]
    );

    const attMap       = {};
    const incentiveMap = {};
    attResult.rows.forEach(r => { attMap[r.user_id] = r; });
    incentiveResult.rows.forEach(r => { incentiveMap[r.user_id] = parseFloat(r.total_incentive) || 0; });

    const results  = [];
    const failures = [];

    for (const emp of employees.rows) {
      try {
        const att = attMap[emp.id] || {
          present_count: 0, half_day_count: 0, leave_count: 0, absent_count: 0,
        };
        const presentCount   = parseFloat(att.present_count)  || 0;
        const halfDayCount   = parseFloat(att.half_day_count) || 0;
        const leaveCount     = parseFloat(att.leave_count)    || 0;
        const absentCount    = parseFloat(att.absent_count)   || 0;
        const presentDays    = presentCount + (halfDayCount * 0.5);
        const absentDays     = absentCount;
        const leaveDays      = leaveCount;
        const monthlySalary  = parseFloat(emp.monthly_salary);
        const perDaySalary   = parseFloat((monthlySalary / workingDays).toFixed(2));
        const earnedSalary   = parseFloat((perDaySalary * presentDays).toFixed(2));
        const deductionAmt   = parseFloat(deductions_map[emp.id] || 0);
        const finalSalary    = parseFloat((earnedSalary - deductionAmt).toFixed(2));
        const incentiveAmt   = incentiveMap[emp.id] || 0;
        const totalPayout    = parseFloat((finalSalary + incentiveAmt).toFixed(2));

        await pool.query(
          `INSERT INTO salary_slips
             (user_id, month, year, monthly_salary, working_days, present_days,
              absent_days, leave_days, per_day_salary, earned_salary,
              deductions, final_salary, incentive_amount, total_payout, generated_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (user_id, month, year)
           DO UPDATE SET
             monthly_salary   = EXCLUDED.monthly_salary,
             working_days     = EXCLUDED.working_days,
             present_days     = EXCLUDED.present_days,
             absent_days      = EXCLUDED.absent_days,
             leave_days       = EXCLUDED.leave_days,
             per_day_salary   = EXCLUDED.per_day_salary,
             earned_salary    = EXCLUDED.earned_salary,
             deductions       = EXCLUDED.deductions,
             final_salary     = EXCLUDED.final_salary,
             incentive_amount = EXCLUDED.incentive_amount,
             total_payout     = EXCLUDED.total_payout,
             generated_by     = EXCLUDED.generated_by,
             notes            = EXCLUDED.notes,
             updated_at       = NOW()`,
          [
            emp.id, m, y, monthlySalary, workingDays, presentDays,
            absentDays, leaveDays, perDaySalary, earnedSalary,
            deductionAmt, finalSalary, incentiveAmt, totalPayout,
            req.user.id, notes || null,
          ]
        );

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
        });
      } catch (empErr) {
        failures.push({ user_id: emp.id, full_name: emp.full_name, error: empErr.message });
      }
    }

    return sendSuccess(res, `Salary slips generated for ${monthName} ${y}`, {
      month:           monthName,
      year:            y,
      working_days:    workingDays,
      total_processed: results.length,
      total_failed:    failures.length,
      slips:           results,
      failures,
    }, 201);
  } catch (err) { next(err); }
};

// ─── 9. [NEW] ADD INCENTIVE (Admin) ───────────────────────────────────────────
/**
 * POST /api/v1/salary/incentive
 * Body: { user_id, month, year, amount, reason? }
 *
 * Adds an incentive payout for an employee for a given month/year.
 * Multiple incentives per user per month are allowed (e.g. different reasons).
 * When generating/re-generating the salary slip, all incentives for that
 * month are summed and added to total_payout automatically.
 */
const addIncentive = async (req, res, next) => {
  try {
    const { user_id, month, year, amount, reason } = req.body;

    if (!user_id || !month || !year || amount == null) {
      return next(new AppError('user_id, month, year, and amount are required', 400));
    }

    const m = parseInt(month);
    const y = parseInt(year);
    if (m < 1 || m > 12) return next(new AppError('month must be between 1 and 12', 400));
    if (y < 2020)        return next(new AppError('year must be 2020 or later', 400));

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      return next(new AppError('amount must be a non-negative number', 400));
    }

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1 AND is_active = true`,
      [user_id]
    );
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404));

    const result = await pool.query(
      `INSERT INTO employee_incentives (user_id, month, year, amount, reason, given_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user_id, m, y, parsedAmount, reason || null, req.user.id]
    );

    const monthName = new Date(y, m - 1).toLocaleString('en-IN', { month: 'long' });

    return sendSuccess(res, `Incentive of ₹${parsedAmount} added for ${monthName} ${y}`, {
      incentive: result.rows[0],
      employee:  userChk.rows[0],
    }, 201);
  } catch (err) { next(err); }
};

// ─── 10. [NEW] GET INCENTIVES (Admin, filterable) ─────────────────────────────
/**
 * GET /api/v1/salary/incentives
 * Query: { user_id?, month?, year?, page?, per_page? }
 */
const getIncentives = async (req, res, next) => {
  try {
    const { user_id, month, year, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const conds  = [];
    const params = [];
    let   idx    = 1;

    if (user_id) { conds.push(`ei.user_id = $${idx++}`); params.push(user_id); }
    if (month)   { conds.push(`ei.month = $${idx++}`);   params.push(parseInt(month)); }
    if (year)    { conds.push(`ei.year = $${idx++}`);    params.push(parseInt(year)); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [cnt, data] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM employee_incentives ei ${where}`, params),
      pool.query(
        `SELECT
           ei.*,
           CONCAT(u.first_name,' ',u.last_name)  AS employee_name,
           u.role AS employee_role,
           CONCAT(g.first_name,' ',g.last_name)  AS given_by_name
         FROM employee_incentives ei
         JOIN users u ON u.id = ei.user_id
         LEFT JOIN users g ON g.id = ei.given_by
         ${where}
         ORDER BY ei.year DESC, ei.month DESC, ei.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, parseInt(per_page), offset]
      ),
    ]);

    const total = parseInt(cnt.rows[0].count);

    return sendSuccess(res, 'Incentives fetched', {
      data: data.rows.map(r => ({
        ...r,
        amount: parseFloat(r.amount),
      })),
      pagination: {
        total, page: parseInt(page), per_page: parseInt(per_page),
        total_pages: Math.ceil(total / parseInt(per_page)),
      },
    });
  } catch (err) { next(err); }
};

// ─── 11. [NEW] DELETE INCENTIVE (Admin) ───────────────────────────────────────
/**
 * DELETE /api/v1/salary/incentive/:id
 */
const deleteIncentive = async (req, res, next) => {
  try {
    const { id } = req.params;

    const check = await pool.query(
      `SELECT ei.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name
       FROM employee_incentives ei
       JOIN users u ON u.id = ei.user_id
       WHERE ei.id = $1`,
      [id]
    );

    if (!check.rows.length) return next(new AppError('Incentive record not found', 404));

    await pool.query('DELETE FROM employee_incentives WHERE id = $1', [id]);

    return sendSuccess(res, 'Incentive deleted successfully', { deleted: check.rows[0] });
  } catch (err) { next(err); }
};

// ─── 12. [NEW] APPRAISAL HISTORY FOR ONE EMPLOYEE (Admin) ─────────────────────
/**
 * GET /api/v1/salary/appraisals/:user_id
 * Returns full appraisal history (salary revisions) for an employee.
 */
const getAppraisalHistory = async (req, res, next) => {
  try {
    const { user_id } = req.params;

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email
       FROM users WHERE id = $1`,
      [user_id]
    );
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404));

    const history = await pool.query(
      `SELECT ea.*, CONCAT(u.first_name,' ',u.last_name) AS appraised_by_name
       FROM employee_appraisals ea
       LEFT JOIN users u ON u.id = ea.appraised_by
       WHERE ea.user_id = $1
       ORDER BY ea.effective_from DESC, ea.created_at DESC`,
      [user_id]
    );

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
    });
  } catch (err) { next(err); }
};

// ─── 13. [NEW] USER-WISE SALARY SUMMARY (Admin) ────────────────────────────────
/**
 * GET /api/v1/salary/user/:user_id
 * Query: { month?, year? }
 *
 * Returns a comprehensive salary summary for a specific user:
 *  - Current salary set by admin
 *  - All salary slips (optionally filtered by month/year)
 *  - All incentives (optionally filtered by month/year)
 *  - Appraisal history
 */
const getUserSalarySummary = async (req, res, next) => {
  try {
    const { user_id }     = req.params;
    const { month, year } = req.query;

    const userChk = await pool.query(
      `SELECT id, CONCAT(first_name,' ',last_name) AS full_name, role, email, phone_number
       FROM users WHERE id = $1`,
      [user_id]
    );
    if (!userChk.rows.length) return next(new AppError('Employee not found', 404));

    const currentSalary = await getActiveSalary(user_id);

    // Slips filter
    const slipConds  = ['ss.user_id = $1'];
    const slipParams = [user_id];
    let   slipIdx    = 2;
    if (month) { slipConds.push(`ss.month = $${slipIdx++}`); slipParams.push(parseInt(month)); }
    if (year)  { slipConds.push(`ss.year = $${slipIdx++}`);  slipParams.push(parseInt(year)); }

    // Incentive filter
    const incConds  = ['ei.user_id = $1'];
    const incParams = [user_id];
    let   incIdx    = 2;
    if (month) { incConds.push(`ei.month = $${incIdx++}`); incParams.push(parseInt(month)); }
    if (year)  { incConds.push(`ei.year = $${incIdx++}`);  incParams.push(parseInt(year)); }

    const [slipsRes, incentivesRes, appraisalsRes] = await Promise.all([
      pool.query(
        `SELECT ss.*, CONCAT(g.first_name,' ',g.last_name) AS generated_by_name
         FROM salary_slips ss
         LEFT JOIN users g ON g.id = ss.generated_by
         WHERE ${slipConds.join(' AND ')}
         ORDER BY ss.year DESC, ss.month DESC`,
        slipParams
      ),
      pool.query(
        `SELECT ei.*, CONCAT(g.first_name,' ',g.last_name) AS given_by_name
         FROM employee_incentives ei
         LEFT JOIN users g ON g.id = ei.given_by
         WHERE ${incConds.join(' AND ')}
         ORDER BY ei.year DESC, ei.month DESC, ei.created_at DESC`,
        incParams
      ),
      pool.query(
        `SELECT ea.*, CONCAT(u.first_name,' ',u.last_name) AS appraised_by_name
         FROM employee_appraisals ea
         LEFT JOIN users u ON u.id = ea.appraised_by
         WHERE ea.user_id = $1
         ORDER BY ea.effective_from DESC, ea.created_at DESC`,
        [user_id]
      ),
    ]);

    const monthLabel = (m, y) =>
      new Date(y, m - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

    return sendSuccess(res, 'User salary summary fetched', {
      employee: userChk.rows[0],
      current_salary: currentSalary
        ? {
            monthly_salary: parseFloat(currentSalary.monthly_salary),
            per_day_salary: currentSalary.per_day_salary ? parseFloat(currentSalary.per_day_salary) : null,
            effective_from: currentSalary.effective_from,
            notes:          currentSalary.notes,
          }
        : null,
      salary_slips: slipsRes.rows.map(r => ({
        id:               r.id,
        month:            r.month,
        year:             r.year,
        month_label:      monthLabel(r.month, r.year),
        monthly_salary:   parseFloat(r.monthly_salary),
        working_days:     r.working_days,
        present_days:     parseFloat(r.present_days),
        absent_days:      parseFloat(r.absent_days),
        leave_days:       parseFloat(r.leave_days),
        per_day_salary:   parseFloat(r.per_day_salary),
        earned_salary:    parseFloat(r.earned_salary),
        deductions:       parseFloat(r.deductions),
        final_salary:     parseFloat(r.final_salary),
        incentive_amount: parseFloat(r.incentive_amount || 0),
        total_payout:     parseFloat(r.total_payout || r.final_salary),
        notes:            r.notes,
        generated_by:     r.generated_by_name,
        generated_at:     r.created_at,
      })),
      incentives: incentivesRes.rows.map(r => ({
        ...r,
        amount: parseFloat(r.amount),
      })),
      appraisal_history: appraisalsRes.rows.map(r => ({
        ...r,
        from_salary:       r.from_salary       ? parseFloat(r.from_salary)       : null,
        to_salary:         parseFloat(r.to_salary),
        increment_amount:  r.increment_amount  ? parseFloat(r.increment_amount)  : null,
        increment_percent: r.increment_percent ? parseFloat(r.increment_percent) : null,
      })),
    });
  } catch (err) { next(err); }
};

module.exports = {
  setEmployeeSalary,
  getAllEmployeeSalaries,
  generateSalarySlip,
  generateAllSalarySlips,
  getSalarySlips,
  getMySalary,
  getSlipById,
  getSalaryHistory,
  // NEW
  addIncentive,
  getIncentives,
  deleteIncentive,
  getAppraisalHistory,
  getUserSalarySummary,
};