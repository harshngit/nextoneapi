const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/salaryController');
const { authenticate, authorize } = require('../middleware/auth');

const ADMIN   = ['super_admin', 'admin'];
const MANAGER = ['super_admin', 'admin', 'sales_manager'];

/**
 * @swagger
 * tags:
 *   name: Salary
 *   description: >
 *     Monthly salary management with incentives and appraisal history.
 *     Admin sets the monthly salary amount from the frontend.
 *     System calculates earned salary based on attendance.
 *     Incentives are added on top of earned salary as total_payout.
 *     Every salary change creates an appraisal record automatically.
 *     Employees can see their own earned salary and slips.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — SET & MANAGE SALARIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/set:
 *   post:
 *     summary: Set salary for an employee (Admin)
 *     description: >
 *       Admin sets the salary for an employee from the frontend form.
 *       You can provide EITHER monthly_salary OR per_day_salary — the other
 *       is auto-calculated using working_days_in_month (default 26).
 *       If the new salary differs from the previous one, an appraisal record
 *       is automatically saved with the increment/decrement details.
 *       Pass appraisal_note to store the reason for the salary change.
 *       Every call creates a new record — full history is preserved.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id]
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *                 example: "user-uuid-001"
 *               monthly_salary:
 *                 type: number
 *                 description: Gross monthly salary in INR. Per-day is auto-calculated.
 *                 example: 35000
 *               per_day_salary:
 *                 type: number
 *                 description: Per-day salary in INR. Monthly is auto-calculated.
 *                 example: 1346.15
 *               working_days_in_month:
 *                 type: integer
 *                 description: Working days used for monthly/per-day conversion (default 26)
 *                 example: 26
 *               effective_from:
 *                 type: string
 *                 format: date
 *                 description: Date from which this salary is active (defaults to today)
 *                 example: "2026-06-01"
 *               notes:
 *                 type: string
 *                 example: "Revised after appraisal"
 *               appraisal_note:
 *                 type: string
 *                 description: Reason or remark for the salary change, saved in appraisal history
 *                 example: "Exceeded targets by 120% for Q1 2026"
 *     responses:
 *       201:
 *         description: Salary saved and appraisal record created (if salary changed)
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Employee salary saved successfully"
 *               data:
 *                 salary:
 *                   id: "uuid"
 *                   user_id: "user-uuid-001"
 *                   monthly_salary: 40000
 *                   per_day_salary: 1538.46
 *                   effective_from: "2026-06-01"
 *                   working_days_used_for_calculation: 26
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 appraisal:
 *                   id: "appraisal-uuid"
 *                   from_salary: 35000
 *                   to_salary: 40000
 *                   increment_amount: 5000
 *                   increment_percent: 14.29
 *                   appraisal_note: "Exceeded targets by 120% for Q1 2026"
 *       400:
 *         description: Neither monthly_salary nor per_day_salary provided
 *       404:
 *         description: Employee not found
 */
router.post('/set', authenticate, authorize(...ADMIN), ctrl.setEmployeeSalary);

/**
 * @swagger
 * /api/v1/salary/employees:
 *   get:
 *     summary: Get all employees with their current salary (Admin)
 *     description: >
 *       Returns all active employees with their latest monthly salary set by admin.
 *       Employees with no salary set will have monthly_salary as null.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Employee salary list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 total: 10
 *                 data:
 *                   - id: "user-uuid-001"
 *                     full_name: "Rahul Sharma"
 *                     role: "sales_executive"
 *                     monthly_salary: 35000
 *                     effective_from: "2026-06-01"
 *                     salary_set: true
 *                   - id: "user-uuid-002"
 *                     full_name: "Priya Mehta"
 *                     role: "sales_executive"
 *                     monthly_salary: null
 *                     salary_set: false
 */
router.get('/employees', authenticate, authorize(...ADMIN), ctrl.getAllEmployeeSalaries);

/**
 * @swagger
 * /api/v1/salary/history/{user_id}:
 *   get:
 *     summary: Get salary revision history for an employee (Admin)
 *     description: Returns all salary records ever set for an employee, newest first.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Salary history
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 history:
 *                   - monthly_salary: 40000
 *                     effective_from: "2026-06-01"
 *                     set_by_name: "Admin"
 *                   - monthly_salary: 35000
 *                     effective_from: "2026-01-01"
 *                     set_by_name: "Admin"
 */
router.get('/history/:user_id', authenticate, authorize(...ADMIN), ctrl.getSalaryHistory);

// ─────────────────────────────────────────────────────────────────────────────
// [NEW] INCENTIVES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/incentive:
 *   post:
 *     summary: Add an incentive for an employee (Admin)
 *     description: >
 *       Adds a performance-based incentive for a specific employee for a given month/year.
 *       Multiple incentives per employee per month are allowed (e.g. different reasons).
 *       When a salary slip is generated/re-generated for that month, all incentives
 *       are summed and included in total_payout automatically.
 *       total_payout = final_salary + sum(incentives for that month)
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, month, year, amount]
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *                 example: "user-uuid-001"
 *               month:
 *                 type: integer
 *                 example: 6
 *               year:
 *                 type: integer
 *                 example: 2026
 *               amount:
 *                 type: number
 *                 description: Incentive amount in INR (must be >= 0)
 *                 example: 5000
 *               reason:
 *                 type: string
 *                 description: Reason for the incentive
 *                 example: "Closed 5 deals in June — exceeded target by 150%"
 *     responses:
 *       201:
 *         description: Incentive added successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Incentive of ₹5000 added for June 2026"
 *               data:
 *                 incentive:
 *                   id: "incentive-uuid"
 *                   user_id: "user-uuid-001"
 *                   month: 6
 *                   year: 2026
 *                   amount: 5000
 *                   reason: "Closed 5 deals in June"
 *                   given_by: "admin-uuid"
 *                   created_at: "2026-06-09T10:00:00Z"
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *       400:
 *         description: Missing required fields or invalid amount
 *       404:
 *         description: Employee not found
 */
router.post('/incentive', authenticate, authorize(...ADMIN), ctrl.addIncentive);

/**
 * @swagger
 * /api/v1/salary/incentives:
 *   get:
 *     summary: Get all incentives — filterable by user, month, year (Admin)
 *     description: >
 *       Returns all incentive records. Filter by user_id, month, or year.
 *       Paginated. Results include employee name and who gave the incentive.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: user_id,  schema: { type: string, format: uuid }, description: Filter by employee }
 *       - { in: query, name: month,    schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,     schema: { type: integer }, example: 2026 }
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 20 } }
 *     responses:
 *       200:
 *         description: Paginated incentive records
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 data:
 *                   - id: "incentive-uuid"
 *                     user_id: "user-uuid-001"
 *                     employee_name: "Rahul Sharma"
 *                     month: 6
 *                     year: 2026
 *                     amount: 5000
 *                     reason: "Exceeded targets"
 *                     given_by_name: "Super Admin"
 *                 pagination:
 *                   total: 15
 *                   page: 1
 *                   per_page: 20
 *                   total_pages: 1
 */
router.get('/incentives', authenticate, authorize(...ADMIN), ctrl.getIncentives);

/**
 * @swagger
 * /api/v1/salary/incentive/{id}:
 *   delete:
 *     summary: Delete an incentive record (Admin)
 *     description: Permanently removes an incentive record. Re-generate the salary slip to reflect the change.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incentive record UUID
 *     responses:
 *       200:
 *         description: Incentive deleted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Incentive deleted successfully"
 *               data:
 *                 deleted:
 *                   id: "incentive-uuid"
 *                   employee_name: "Rahul Sharma"
 *                   amount: 5000
 *       404:
 *         description: Incentive record not found
 */
router.delete('/incentive/:id', authenticate, authorize(...ADMIN), ctrl.deleteIncentive);

// ─────────────────────────────────────────────────────────────────────────────
// [NEW] APPRAISAL HISTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/appraisals/{user_id}:
 *   get:
 *     summary: Get appraisal history for an employee (Admin)
 *     description: >
 *       Returns the full appraisal history for an employee — every time their salary
 *       was changed, a record is saved here with from_salary, to_salary, increment
 *       amount, percentage hike, and the appraisal note (reason).
 *       Records are newest first.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Appraisal history
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 total: 2
 *                 history:
 *                   - id: "appraisal-uuid-002"
 *                     from_salary: 35000
 *                     to_salary: 40000
 *                     increment_amount: 5000
 *                     increment_percent: 14.29
 *                     effective_from: "2026-06-01"
 *                     appraisal_note: "Exceeded targets Q1 2026"
 *                     appraised_by_name: "Super Admin"
 *                   - id: "appraisal-uuid-001"
 *                     from_salary: null
 *                     to_salary: 35000
 *                     increment_amount: null
 *                     increment_percent: null
 *                     effective_from: "2026-01-01"
 *                     appraisal_note: "Initial salary"
 *                     appraised_by_name: "Super Admin"
 *       404:
 *         description: Employee not found
 */
router.get('/appraisals/:user_id', authenticate, authorize(...ADMIN), ctrl.getAppraisalHistory);

// ─────────────────────────────────────────────────────────────────────────────
// [NEW] USER-WISE SALARY SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/user/{user_id}:
 *   get:
 *     summary: Get comprehensive salary summary for a specific user (Admin)
 *     description: >
 *       Returns everything salary-related for one user in a single API call:
 *       - Current salary (latest set by admin)
 *       - All salary slips (optionally filtered by month/year)
 *       - All incentives given (optionally filtered by month/year)
 *       - Full appraisal history
 *       Ideal for a "View Employee Salary" detail page in the admin panel.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - { in: query, name: month, schema: { type: integer }, example: 6,    description: Filter slips and incentives by month }
 *       - { in: query, name: year,  schema: { type: integer }, example: 2026, description: Filter slips and incentives by year  }
 *     responses:
 *       200:
 *         description: Full salary summary for the user
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "User salary summary fetched"
 *               data:
 *                 employee:
 *                   id: "user-uuid-001"
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                   email: "rahul@example.com"
 *                 current_salary:
 *                   monthly_salary: 40000
 *                   per_day_salary: 1538.46
 *                   effective_from: "2026-06-01"
 *                 salary_slips:
 *                   - month: 6
 *                     year: 2026
 *                     month_label: "June 2026"
 *                     monthly_salary: 40000
 *                     working_days: 22
 *                     present_days: 20
 *                     absent_days: 2
 *                     per_day_salary: 1818.18
 *                     earned_salary: 36363.64
 *                     deductions: 0
 *                     final_salary: 36363.64
 *                     incentive_amount: 5000
 *                     total_payout: 41363.64
 *                 incentives:
 *                   - id: "incentive-uuid"
 *                     month: 6
 *                     year: 2026
 *                     amount: 5000
 *                     reason: "Exceeded targets"
 *                     given_by_name: "Super Admin"
 *                 appraisal_history:
 *                   - from_salary: 35000
 *                     to_salary: 40000
 *                     increment_amount: 5000
 *                     increment_percent: 14.29
 *                     effective_from: "2026-06-01"
 *                     appraisal_note: "Q1 appraisal"
 *       404:
 *         description: Employee not found
 */
router.get('/user/:user_id', authenticate, authorize(...ADMIN), ctrl.getUserSalarySummary);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — GENERATE SLIPS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/generate:
 *   post:
 *     summary: Generate salary slip for one employee (Admin)
 *     description: >
 *       Calculates earned salary for a given month/year based on attendance.
 *       Formula: (monthly_salary / working_days) × present_days - deductions
 *       present_days = present + late + (half_day × 0.5)
 *       Incentives for the month are automatically summed and added to total_payout.
 *       total_payout = final_salary + incentive_amount
 *       If a slip already exists for that month, it will be regenerated/overwritten.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, month, year]
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *               month:
 *                 type: integer
 *                 example: 6
 *               year:
 *                 type: integer
 *                 example: 2026
 *               deductions:
 *                 type: number
 *                 description: Any manual deduction amount in INR
 *                 example: 1000
 *               working_days_override:
 *                 type: integer
 *                 description: Override the default Mon–Fri count (e.g. for holidays)
 *                 example: 22
 *               notes:
 *                 type: string
 *                 example: "June 2026 salary"
 *     responses:
 *       201:
 *         description: Salary slip generated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Salary slip generated for June 2026"
 *               data:
 *                 breakdown:
 *                   monthly_salary: 40000
 *                   working_days: 22
 *                   present_days: 20
 *                   earned_salary: 36363.64
 *                   deductions: 1000
 *                   final_salary: 35363.64
 *                   incentive_amount: 5000
 *                   total_payout: 40363.64
 *       400:
 *         description: No salary set for this employee
 */
router.post('/generate', authenticate, authorize(...ADMIN), ctrl.generateSalarySlip);

/**
 * @swagger
 * /api/v1/salary/generate-all:
 *   post:
 *     summary: Generate salary slips for ALL employees for a month (Admin)
 *     description: >
 *       Bulk generates salary slips for all employees who have a salary set.
 *       Incentives for the month are automatically included in total_payout.
 *       Existing slips for the month are overwritten.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [month, year]
 *             properties:
 *               month:
 *                 type: integer
 *                 example: 6
 *               year:
 *                 type: integer
 *                 example: 2026
 *               working_days_override:
 *                 type: integer
 *                 description: Apply same override to all employees
 *               deductions_map:
 *                 type: object
 *                 description: Per-user deduction amounts keyed by user UUID.
 *                 example: { "user-uuid-001": 500, "user-uuid-002": 0 }
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Bulk slips generated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 month: "June"
 *                 year: 2026
 *                 working_days: 22
 *                 total_processed: 8
 *                 total_failed: 0
 *                 slips:
 *                   - user_id: "user-uuid-001"
 *                     full_name: "Rahul Sharma"
 *                     final_salary: 35363.64
 *                     incentive_amount: 5000
 *                     total_payout: 40363.64
 */
router.post('/generate-all', authenticate, authorize(...ADMIN), ctrl.generateAllSalarySlips);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — VIEW SLIPS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/slips:
 *   get:
 *     summary: Get all salary slips (Admin, filterable)
 *     description: Now includes incentive_amount and total_payout in each slip.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: user_id,  schema: { type: string, format: uuid } }
 *       - { in: query, name: month,    schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,     schema: { type: integer }, example: 2026 }
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 20 } }
 *     responses:
 *       200:
 *         description: Paginated salary slips with incentive_amount and total_payout
 */
router.get('/slips', authenticate, authorize(...ADMIN), ctrl.getSalarySlips);

/**
 * @swagger
 * /api/v1/salary/slips/{id}:
 *   get:
 *     summary: Get a single salary slip by ID
 *     description: Admin can view any slip. Employee can only view their own. Includes incentive_amount and total_payout.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Salary slip details with incentive and payout info
 *       403:
 *         description: Access denied
 *       404:
 *         description: Slip not found
 */
router.get('/slips/:id', authenticate, ctrl.getSlipById);

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEE — VIEW OWN SALARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/my-salary:
 *   get:
 *     summary: Get my salary details (Employee)
 *     description: >
 *       Returns the employee's current monthly salary (set by admin)
 *       and all their generated salary slips including incentive_amount and total_payout.
 *       Optionally filter slips by month/year.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: month, schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,  schema: { type: integer }, example: 2026 }
 *     responses:
 *       200:
 *         description: Employee salary and slips
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 current_monthly_salary:
 *                   amount: 40000
 *                   effective_from: "2026-06-01"
 *                 salary_slips:
 *                   - month: 6
 *                     year: 2026
 *                     month_label: "June 2026"
 *                     monthly_salary: 40000
 *                     working_days: 22
 *                     present_days: 20
 *                     earned_salary: 36363.64
 *                     deductions: 0
 *                     final_salary: 36363.64
 *                     incentive_amount: 5000
 *                     total_payout: 41363.64
 */
router.get('/my-salary', authenticate, ctrl.getMySalary);

// ─────────────────────────────────────────────────────────────────────────────
// APPRAISAL APIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/appraisal:
 *   post:
 *     summary: Create an appraisal for an employee (Admin)
 *     description: >
 *       Creates a formal appraisal record AND updates the employee's salary in one call.
 *       Automatically calculates increment amount and percentage from previous salary.
 *       Sends push notification to the employee with their new salary and hike %.
 *       Every call saves a record in employee_appraisals — full history is preserved.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, new_salary]
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *                 example: "user-uuid-001"
 *               new_salary:
 *                 type: number
 *                 description: New monthly salary after appraisal (INR)
 *                 example: 45000
 *               effective_from:
 *                 type: string
 *                 format: date
 *                 description: Date from which new salary is effective (defaults to today)
 *                 example: "2026-07-01"
 *               appraisal_note:
 *                 type: string
 *                 description: Reason or performance remark saved with the appraisal record
 *                 example: "Exceeded Q1 targets by 130%. Promoted to Senior Executive."
 *               working_days_in_month:
 *                 type: integer
 *                 description: Used to calculate per_day_salary (default 26)
 *                 example: 26
 *           example:
 *             user_id: "user-uuid-001"
 *             new_salary: 45000
 *             effective_from: "2026-07-01"
 *             appraisal_note: "Exceeded Q1 targets by 130%. Promoted to Senior Executive."
 *             working_days_in_month: 26
 *     responses:
 *       201:
 *         description: Appraisal processed and salary updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Appraisal processed for Rahul Sharma"
 *               data:
 *                 appraisal:
 *                   id: "appraisal-uuid"
 *                   user_id: "user-uuid-001"
 *                   from_salary: 35000
 *                   to_salary: 45000
 *                   increment_amount: 10000
 *                   increment_percent: 28.57
 *                   effective_from: "2026-07-01"
 *                   appraisal_note: "Exceeded Q1 targets by 130%"
 *                 salary:
 *                   monthly_salary: 45000
 *                   per_day_salary: 1730.77
 *                   effective_from: "2026-07-01"
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 summary:
 *                   previous_salary: "₹35,000"
 *                   new_salary: "₹45,000"
 *                   increment_amount: "₹10,000"
 *                   increment_percent: "28.57%"
 *                   effective_from: "2026-07-01"
 *       400:
 *         description: Missing required fields or invalid salary amount
 *       404:
 *         description: Employee not found
 */
router.post('/appraisal', authenticate, authorize(...ADMIN), ctrl.createAppraisal);

/**
 * @swagger
 * /api/v1/salary/appraisal/{id}:
 *   put:
 *     summary: Update appraisal note or effective date (Admin)
 *     description: >
 *       Only appraisal_note and effective_from can be updated.
 *       Salary values (from_salary, to_salary) are immutable once saved.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               appraisal_note:
 *                 type: string
 *                 example: "Updated note — also awarded spot bonus"
 *               effective_from:
 *                 type: string
 *                 format: date
 *                 example: "2026-07-01"
 *           example:
 *             appraisal_note: "Updated note — also awarded spot bonus"
 *             effective_from: "2026-07-01"
 *     responses:
 *       200:
 *         description: Appraisal updated
 *       400:
 *         description: Nothing to update
 *       404:
 *         description: Appraisal record not found
 */
router.put('/appraisal/:id', authenticate, authorize(...ADMIN), ctrl.updateAppraisal);

/**
 * @swagger
 * /api/v1/salary/appraisals/{user_id}:
 *   get:
 *     summary: Get full appraisal history for an employee (Admin)
 *     description: >
 *       Returns all appraisal records for an employee, newest first.
 *       Each record shows from_salary → to_salary, increment amount and %,
 *       effective date and appraisal note.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Appraisal history
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 total: 2
 *                 history:
 *                   - id: "appraisal-uuid-002"
 *                     from_salary: 35000
 *                     to_salary: 45000
 *                     increment_amount: 10000
 *                     increment_percent: 28.57
 *                     effective_from: "2026-07-01"
 *                     appraisal_note: "Exceeded Q1 targets"
 *                     appraised_by_name: "Super Admin"
 *                   - id: "appraisal-uuid-001"
 *                     from_salary: null
 *                     to_salary: 35000
 *                     increment_amount: null
 *                     increment_percent: null
 *                     effective_from: "2026-01-01"
 *                     appraisal_note: "Initial salary"
 *       404:
 *         description: Employee not found
 */
router.get('/appraisals/:user_id', authenticate, authorize(...ADMIN), ctrl.getAppraisalHistory);

// ─────────────────────────────────────────────────────────────────────────────
// BONUS APIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/bonus:
 *   post:
 *     summary: Add a bonus for an employee (Admin)
 *     description: >
 *       Adds a one-time bonus payout for an employee.
 *       Bonus types: diwali | annual | performance | spot_award | joining | referral | general
 *       Month and year are optional — provide them to link the bonus to a specific pay period.
 *       Sends push notification to the employee when bonus is added.
 *       When paid is set to true, a second notification is sent confirming disbursement.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, amount]
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *                 example: "user-uuid-001"
 *               amount:
 *                 type: number
 *                 description: Bonus amount in INR (must be > 0)
 *                 example: 15000
 *               bonus_type:
 *                 type: string
 *                 enum: [diwali, annual, performance, spot_award, joining, referral, general]
 *                 default: general
 *                 example: "performance"
 *               month:
 *                 type: integer
 *                 description: Month this bonus applies to (1-12), optional
 *                 example: 6
 *               year:
 *                 type: integer
 *                 example: 2026
 *               reason:
 *                 type: string
 *                 example: "Closed 8 deals in June — highest in team"
 *               paid:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the bonus has already been disbursed
 *               paid_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-30"
 *           example:
 *             user_id: "user-uuid-001"
 *             amount: 15000
 *             bonus_type: "performance"
 *             month: 6
 *             year: 2026
 *             reason: "Closed 8 deals in June — highest in team"
 *             paid: false
 *     responses:
 *       201:
 *         description: Bonus added and employee notified
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Bonus of ₹15000 added for Rahul Sharma"
 *               data:
 *                 bonus:
 *                   id: "bonus-uuid"
 *                   user_id: "user-uuid-001"
 *                   amount: 15000
 *                   bonus_type: "performance"
 *                   month: 6
 *                   year: 2026
 *                   reason: "Closed 8 deals in June"
 *                   paid: false
 *                   paid_date: null
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 month_label: "June 2026"
 *       400:
 *         description: Missing required fields or invalid amount
 *       404:
 *         description: Employee not found
 */
router.post('/bonus', authenticate, authorize(...ADMIN), ctrl.addBonus);

/**
 * @swagger
 * /api/v1/salary/bonuses:
 *   get:
 *     summary: Get all bonuses — filterable (Admin)
 *     description: Filter by user_id, bonus_type, month, year, paid status. Paginated.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: user_id,    schema: { type: string, format: uuid } }
 *       - { in: query, name: bonus_type, schema: { type: string, enum: [diwali, annual, performance, spot_award, joining, referral, general] } }
 *       - { in: query, name: month,      schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,       schema: { type: integer }, example: 2026 }
 *       - { in: query, name: paid,       schema: { type: boolean }, description: "true = paid only, false = unpaid only" }
 *       - { in: query, name: page,       schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page,   schema: { type: integer, default: 20 } }
 *     responses:
 *       200:
 *         description: Paginated bonus records
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 data:
 *                   - id: "bonus-uuid"
 *                     employee_name: "Rahul Sharma"
 *                     amount: 15000
 *                     bonus_type: "performance"
 *                     month: 6
 *                     year: 2026
 *                     reason: "Closed 8 deals in June"
 *                     paid: false
 *                     given_by_name: "Super Admin"
 *                 pagination:
 *                   total: 12
 *                   page: 1
 *                   per_page: 20
 *                   total_pages: 1
 */
router.get('/bonuses', authenticate, authorize(...ADMIN), ctrl.getBonuses);

/**
 * @swagger
 * /api/v1/salary/bonus/{id}:
 *   patch:
 *     summary: Update bonus — mark as paid or edit details (Admin)
 *     description: >
 *       Update any bonus field. Most commonly used to mark a bonus as paid.
 *       When paid flips from false to true, a push notification is sent to the employee.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paid:       { type: boolean, example: true }
 *               paid_date:  { type: string, format: date, example: "2026-06-30" }
 *               amount:     { type: number, example: 15000 }
 *               bonus_type: { type: string, enum: [diwali, annual, performance, spot_award, joining, referral, general] }
 *               reason:     { type: string, example: "Updated reason" }
 *           example:
 *             paid: true
 *             paid_date: "2026-06-30"
 *     responses:
 *       200:
 *         description: Bonus updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Bonus updated"
 *               data:
 *                 bonus:
 *                   id: "bonus-uuid"
 *                   paid: true
 *                   paid_date: "2026-06-30"
 *                 employee_name: "Rahul Sharma"
 *       404:
 *         description: Bonus not found
 *   delete:
 *     summary: Delete a bonus record (Admin)
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Bonus deleted
 *       404:
 *         description: Bonus not found
 */
router.patch('/bonus/:id', authenticate, authorize(...ADMIN), ctrl.updateBonus);
router.delete('/bonus/:id', authenticate, authorize(...ADMIN), ctrl.deleteBonus);

/**
 * @swagger
 * /api/v1/salary/my-bonuses:
 *   get:
 *     summary: Get my bonuses (Employee)
 *     description: Returns all bonuses for the logged-in employee with total amount.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Employee's bonus records
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 total_bonus_amount: 25000
 *                 total_count: 2
 *                 bonuses:
 *                   - id: "bonus-uuid-001"
 *                     amount: 15000
 *                     bonus_type: "performance"
 *                     month: 6
 *                     year: 2026
 *                     reason: "Closed 8 deals in June"
 *                     paid: true
 *                     paid_date: "2026-06-30"
 *                   - id: "bonus-uuid-002"
 *                     amount: 10000
 *                     bonus_type: "diwali"
 *                     reason: "Diwali 2026 bonus"
 *                     paid: false
 */
router.get('/my-bonuses', authenticate, ctrl.getMyBonuses);

module.exports = router;