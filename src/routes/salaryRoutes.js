const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/salaryController')
const { authenticate, authorize } = require('../middleware/auth')

const ADMIN   = ['super_admin', 'admin']
const MANAGER = ['super_admin', 'admin', 'sales_manager']

/**
 * @swagger
 * tags:
 *   name: Salary
 *   description: >
 *     Monthly salary management.
 *     Admin sets the monthly salary amount from the frontend.
 *     System calculates earned salary based on attendance.
 *     Employees can see their own earned salary and slips.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — SET & MANAGE SALARIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/set:
 *   post:
 *     summary: Set monthly salary for an employee (Admin)
 *     description: >
 *       Admin sets the monthly gross salary for an employee.
 *       The amount comes from the frontend form.
 *       Each update creates a new record — history is preserved.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, monthly_salary]
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *                 example: "user-uuid-001"
 *               monthly_salary:
 *                 type: number
 *                 description: Gross monthly salary in INR
 *                 example: 35000
 *               effective_from:
 *                 type: string
 *                 format: date
 *                 description: Date from which this salary is active (defaults to today)
 *                 example: "2026-06-01"
 *               notes:
 *                 type: string
 *                 example: "Revised after appraisal"
 *     responses:
 *       201:
 *         description: Salary set successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Employee salary set successfully"
 *               data:
 *                 salary:
 *                   id: "uuid"
 *                   user_id: "user-uuid-001"
 *                   monthly_salary: 35000
 *                   effective_from: "2026-06-01"
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *       404:
 *         description: Employee not found
 */
router.post('/set', authenticate, authorize(...ADMIN), ctrl.setEmployeeSalary)

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
router.get('/employees', authenticate, authorize(...ADMIN), ctrl.getAllEmployeeSalaries)

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
 *                   - monthly_salary: 35000
 *                     effective_from: "2026-06-01"
 *                     set_by_name: "Admin"
 *                   - monthly_salary: 30000
 *                     effective_from: "2026-01-01"
 *                     set_by_name: "Admin"
 */
router.get('/history/:user_id', authenticate, authorize(...ADMIN), ctrl.getSalaryHistory)

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
 *                 example: 5
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
 *                 example: "May 2026 salary"
 *     responses:
 *       201:
 *         description: Salary slip generated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Salary slip generated for May 2026"
 *               data:
 *                 slip:
 *                   id: "slip-uuid-001"
 *                   month: 5
 *                   year: 2026
 *                   earned_salary: 31818.18
 *                   final_salary: 30818.18
 *                 breakdown:
 *                   monthly_salary: 35000
 *                   working_days: 22
 *                   present_days: 20
 *                   absent_days: 2
 *                   per_day_salary: 1590.91
 *                   earned_salary: 31818.18
 *                   deductions: 1000
 *                   final_salary: 30818.18
 *       400:
 *         description: No salary set for this employee
 */
router.post('/generate', authenticate, authorize(...ADMIN), ctrl.generateSalarySlip)

/**
 * @swagger
 * /api/v1/salary/generate-all:
 *   post:
 *     summary: Generate salary slips for ALL employees for a month (Admin)
 *     description: >
 *       Bulk generates salary slips for all employees who have a salary set.
 *       Only processes employees with a salary record — others are skipped.
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
 *                 example: 5
 *               year:
 *                 type: integer
 *                 example: 2026
 *               working_days_override:
 *                 type: integer
 *                 description: Apply same override to all employees
 *               deductions_map:
 *                 type: object
 *                 description: Per-user deduction amounts — { "user_uuid": amount }
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
 *                 month: "May"
 *                 year: 2026
 *                 working_days: 22
 *                 total_processed: 8
 *                 total_failed: 0
 *                 slips: []
 */
router.post('/generate-all', authenticate, authorize(...ADMIN), ctrl.generateAllSalarySlips)

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — VIEW SLIPS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/salary/slips:
 *   get:
 *     summary: Get all salary slips (Admin, filterable)
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: user_id,  schema: { type: string, format: uuid } }
 *       - { in: query, name: month,    schema: { type: integer }, example: 5 }
 *       - { in: query, name: year,     schema: { type: integer }, example: 2026 }
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 20 } }
 *     responses:
 *       200:
 *         description: Paginated salary slips
 */
router.get('/slips', authenticate, authorize(...ADMIN), ctrl.getSalarySlips)

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
router.get('/slips/:id', authenticate, ctrl.getSlipById)

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
 *       and all their generated salary slips.
 *       Optionally filter slips by month/year.
 *     tags: [Salary]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: month, schema: { type: integer }, example: 5 }
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
 *                   amount: 35000
 *                   effective_from: "2026-01-01"
 *                 salary_slips:
 *                   - month: 5
 *                     year: 2026
 *                     month_label: "May 2026"
 *                     monthly_salary: 35000
 *                     working_days: 22
 *                     present_days: 20
 *                     absent_days: 2
 *                     per_day_salary: 1590.91
 *                     earned_salary: 31818.18
 *                     deductions: 0
 *                     final_salary: 31818.18
 */
router.get('/my-salary', authenticate, ctrl.getMySalary)

module.exports = router
