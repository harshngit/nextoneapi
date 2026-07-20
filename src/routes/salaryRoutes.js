const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/salaryController');
const commissionCtrl = require('../controllers/commissionController');
const advanceCtrl    = require('../controllers/advanceController');
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
 *       - { in: query, name: month, schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,  schema: { type: integer }, example: 2026 }
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
 *                     total_payout: 36363.64
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
 *                   total_payout: 35363.64
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
 *     description: Returns all salary slips.
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
 *         description: Paginated salary slips with total_payout
 */
router.get('/slips', authenticate, authorize(...ADMIN), ctrl.getSalarySlips);

/**
 * @swagger
 * /api/v1/salary/slips/{id}:
 *   get:
 *     summary: Get a single salary slip by ID
 *     description: Admin can view any slip. Employee can only view their own. 
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
 *         description: Salary slip details
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
 *       and all their generated salary slips .
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
 *                     total_payout: 36363.64
 */
router.get('/my-salary', authenticate, ctrl.getMySalary);

/**
 * @swagger
 * /api/v1/salary/my-salary-history:
 *   get:
 *     summary: Get my salary history (Employee)
 *     description: Returns all salary records for the logged-in employee, ordered by effective date (newest first)
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Employee's salary history
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Your salary history fetched"
 *               data:
 *                 history:
 *                   - id: "salary-uuid-001"
 *                     monthly_salary: 40000
 *                     per_day_salary: 1538.46
 *                     effective_from: "2026-06-01"
 *                     set_by_name: "Admin"
 *                     created_at: "2026-06-01T10:00:00Z"
 *                   - id: "salary-uuid-002"
 *                     monthly_salary: 35000
 *                     per_day_salary: 1346.15
 *                     effective_from: "2026-01-01"
 *                     set_by_name: "Admin"
 *                     created_at: "2026-01-01T10:00:00Z"
 */
router.get('/my-salary-history', authenticate, ctrl.getMySalaryHistory);

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
 *                 example: "Updated note — exceeded all Q2 targets"
 *               effective_from:
 *                 type: string
 *                 format: date
 *                 example: "2026-07-01"
 *           example:
 *             appraisal_note: "Updated note — exceeded all Q2 targets"
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
// INCENTIVE APIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/incentive:
 *   post:
 *     summary: Add an incentive for an employee (Admin)
 *     description: >
 *       Adds a performance-based incentive for an employee for a specific month/year.
 *       Multiple incentives per employee per month are allowed.
 *       Sends push notification to the employee when incentive is added.
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
 *                 example: "Closed 5 deals in June — exceeded target by 150%"
 *           example:
 *             user_id: "user-uuid-001"
 *             month: 6
 *             year: 2026
 *             amount: 5000
 *             reason: "Closed 5 deals in June — exceeded target by 150%"
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
 *                   created_at: "2026-06-30T10:00:00Z"
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 month_label: "June 2026"
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
 *     description: Returns all incentive records across all employees. Paginated.
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
 *                     employee_name: "Rahul Sharma"
 *                     month: 6
 *                     year: 2026
 *                     amount: 5000
 *                     reason: "Closed 5 deals in June"
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
 * /api/v1/salary/incentives/user/{user_id}:
 *   get:
 *     summary: Get all incentives for a specific employee (Admin)
 *     description: >
 *       Returns every incentive for one employee with a total summary
 *       and records grouped by month for easy display.
 *       Optionally filter by month and/or year.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - { in: query, name: month, schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,  schema: { type: integer }, example: 2026 }
 *     responses:
 *       200:
 *         description: All incentives for the employee grouped by month
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Incentives for Rahul Sharma"
 *               data:
 *                 employee:
 *                   id: "user-uuid-001"
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 summary:
 *                   total_amount: 12000
 *                   total_count: 3
 *                 by_month:
 *                   - month: 6
 *                     year: 2026
 *                     month_label: "June 2026"
 *                     total: 7000
 *                     records:
 *                       - id: "incentive-uuid-001"
 *                         amount: 5000
 *                         reason: "Closed 5 deals in June"
 *                         given_by_name: "Super Admin"
 *                       - id: "incentive-uuid-002"
 *                         amount: 2000
 *                         reason: "Best attendance award"
 *                         given_by_name: "Super Admin"
 *                   - month: 5
 *                     year: 2026
 *                     month_label: "May 2026"
 *                     total: 5000
 *                     records:
 *                       - id: "incentive-uuid-003"
 *                         amount: 5000
 *                         reason: "Highest closures in team"
 *                         given_by_name: "Super Admin"
 *                 incentives:
 *                   - id: "incentive-uuid-001"
 *                     month: 6
 *                     year: 2026
 *                     amount: 5000
 *                     reason: "Closed 5 deals in June"
 *       404:
 *         description: Employee not found
 */
router.get('/incentives/user/:user_id', authenticate, authorize(...ADMIN), ctrl.getUserIncentives);

/**
 * @swagger
 * /api/v1/salary/my-incentives:
 *   get:
 *     summary: Get my incentives (Employee)
 *     description: Returns all incentives for the logged-in employee. Optionally filter by month/year.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: month, schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,  schema: { type: integer }, example: 2026 }
 *     responses:
 *       200:
 *         description: Employee incentive records with total
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 total_incentive_amount: 12000
 *                 total_count: 3
 *                 incentives:
 *                   - id: "incentive-uuid-001"
 *                     month: 6
 *                     year: 2026
 *                     amount: 5000
 *                     reason: "Closed 5 deals in June"
 *                     given_by_name: "Super Admin"
 */
router.get('/my-incentives', authenticate, ctrl.getMyIncentives);

/**
 * @swagger
 * /api/v1/salary/incentive/{id}:
 *   delete:
 *     summary: Delete an incentive record (Admin)
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

/**
 * @swagger
 * tags:
 *   name: Commissions
 *   description: Employee commission tracking, linked to a lead + project.
 */

/**
 * @swagger
 * /api/v1/salary/commission:
 *   post:
 *     summary: Record a commission for an employee (Admin/Super Admin)
 *     tags: [Commissions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, lead_id]
 *             properties:
 *               user_id:               { type: string, format: uuid }
 *               lead_id:               { type: string, format: uuid }
 *               project_id:            { type: string, format: uuid, description: "Optional — UUID or exact project name" }
 *               project_name:          { type: string, description: "Optional free-text project name" }
 *               commission_amount:     { type: number, example: 25000 }
 *               commission_percentage: { type: number, example: 2.5 }
 *               notes:                 { type: string }
 *               paid:                  { type: boolean, default: true, description: "Defaults to true (paid immediately). Pass false to leave it pending instead." }
 *     responses:
 *       201:
 *         description: Commission recorded
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: User or lead not found
 */
router.post('/commission', authenticate, authorize(...ADMIN), commissionCtrl.addCommission);

/**
 * @swagger
 * /api/v1/salary/commissions:
 *   get:
 *     summary: List every employee's commissions (Admin/Super Admin)
 *     tags: [Commissions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: paid
 *         schema: { type: boolean }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Commissions list returned
 */
router.get('/commissions', authenticate, authorize(...ADMIN), commissionCtrl.getAllCommissions);

/**
 * @swagger
 * /api/v1/salary/commissions/user/{user_id}:
 *   get:
 *     summary: List one employee's commissions (Admin/Super Admin)
 *     tags: [Commissions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Commissions list returned
 */
router.get('/commissions/user/:user_id', authenticate, authorize(...ADMIN), commissionCtrl.getUserCommissions);

/**
 * @swagger
 * /api/v1/salary/my-commissions:
 *   get:
 *     summary: Get my own commissions
 *     description: Every role can call this — always scoped to the logged-in user, never anyone else's.
 *     tags: [Commissions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: My commissions returned
 */
router.get('/my-commissions', authenticate, commissionCtrl.getMyCommissions);

/**
 * @swagger
 * /api/v1/salary/commission/{id}/paid:
 *   patch:
 *     summary: Change a commission's paid/unpaid status (Admin/Super Admin)
 *     description: >
 *       Body is optional — omit it (or send no body) to mark paid, matching
 *       the old one-way behavior. Pass { "paid": false } to flip it back to
 *       pending, or { "paid": true } explicitly.
 *     tags: [Commissions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paid: { type: boolean, default: true, example: false }
 *     responses:
 *       200:
 *         description: Commission paid status updated
 *       404:
 *         description: Commission record not found
 */
router.patch('/commission/:id/paid', authenticate, authorize(...ADMIN), commissionCtrl.markCommissionPaid);

/**
 * @swagger
 * /api/v1/salary/commission/{id}:
 *   delete:
 *     summary: Delete a commission record (Admin/Super Admin)
 *     tags: [Commissions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Commission record deleted
 *       404:
 *         description: Commission record not found
 */
router.delete('/commission/:id', authenticate, authorize(...ADMIN), commissionCtrl.deleteCommission);

/**
 * @swagger
 * tags:
 *   name: Advances
 *   description: Employee advance payment tracking.
 */

/**
 * @swagger
 * /api/v1/salary/advance:
 *   post:
 *     summary: Record an advance payment for an employee (Admin/Super Admin)
 *     tags: [Advances]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, advance_date, amount]
 *             properties:
 *               user_id:               { type: string, format: uuid }
 *               advance_date:          { type: string, format: date }
 *               amount:                { type: number, example: 10000 }
 *               transaction_reference: { type: string, example: "TXN123456789" }
 *               payment_proof_url:     { type: string, description: "Upload the file first via POST /api/v1/upload, then pass its URL here" }
 *               notes:                 { type: string }
 *     responses:
 *       201:
 *         description: Advance payment recorded
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: User not found
 */
router.post('/advance', authenticate, authorize(...ADMIN), advanceCtrl.addAdvance);

/**
 * @swagger
 * /api/v1/salary/advances:
 *   get:
 *     summary: List every employee's advance payments (Admin/Super Admin)
 *     tags: [Advances]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Advance payments list returned
 */
router.get('/advances', authenticate, authorize(...ADMIN), advanceCtrl.getAllAdvances);

/**
 * @swagger
 * /api/v1/salary/advances/user/{user_id}:
 *   get:
 *     summary: List one employee's advance payments (Admin/Super Admin)
 *     tags: [Advances]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Advance payments list returned
 */
router.get('/advances/user/:user_id', authenticate, authorize(...ADMIN), advanceCtrl.getUserAdvances);

/**
 * @swagger
 * /api/v1/salary/my-advances:
 *   get:
 *     summary: Get my own advance payments
 *     description: Every role can call this — always scoped to the logged-in user, never anyone else's.
 *     tags: [Advances]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: My advance payments returned
 */
router.get('/my-advances', authenticate, advanceCtrl.getMyAdvances);

/**
 * @swagger
 * /api/v1/salary/advance/{id}:
 *   delete:
 *     summary: Delete an advance payment record (Admin/Super Admin)
 *     tags: [Advances]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Advance payment record deleted
 *       404:
 *         description: Advance payment record not found
 */
router.delete('/advance/:id', authenticate, authorize(...ADMIN), advanceCtrl.deleteAdvance);

module.exports = router;