/**
 * exportRoutes.js
 * Mounted at: /api/v1/export
 */

const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/exportController')
const { authenticate, authorize } = require('../middleware/auth')

const ADMIN = ['super_admin', 'admin']

/**
 * @swagger
 * tags:
 *   name: Exports
 *   description: >
 *     Download Excel (.xlsx) reports for every module.
 *     Admin / Super Admin receive all data.
 *     All other roles receive only their own assigned data.
 *
 *     **Workbook tabs per export:**
 *     - Leads       → Leads list + Leads Summary + Leads By User & Date
 *     - Site Visits → Site Visits (with feedback) + Site Visits By User & Date
 *     - Site Revisits → Repeat visits after the first one, with feedback
 *     - Follow-Ups  → Tasks / Follow-ups + Follow-Ups By User & Date
 *     - Closures    → Bookings/closures with unit, price, and commission detail
 *     - Projects    → Projects with lead counts (admin only)
 *     - Users       → Team members with stats (admin only)
 *     - Attendance  → All Records + Monthly Grid + Summary
 *     - Holidays    → Company holiday calendar
 *     - Salary      → Salary Slips, Current Salaries, Incentives, Bonus, Appraisals (admin only)
 *     - Targets     → Monthly site-visit/closure targets vs achieved
 *     - Phone Reveal Requests → Who requested/approved phone number reveals
 *     - Lead Reassignments    → Lead reassignment audit trail
 *     - All         → Every tab above in one file (admin only)
 *
 *     Every "By User & Date" tab is a pivot grid: one row per user, one
 *     column per day in the selected range, cell = record count for that
 *     user on that day (with a Total column/row) — the user-wise + date-wise
 *     breakdown for leads, site visits, and follow-ups.
 */

/**
 * @swagger
 * /api/v1/export/leads:
 *   get:
 *     summary: Export leads to Excel
 *     description: >
 *       Admin gets all leads. Other roles get only their assigned leads.
 *       Two tabs: **Leads** (full detail) + **Leads Summary** (count by status).
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from,       schema: { type: string, format: date }, example: "2025-05-01" }
 *       - { in: query, name: to,         schema: { type: string, format: date }, example: "2025-05-31" }
 *       - { in: query, name: project_id, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Excel file download
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/leads',       authenticate, ctrl.exportLeads)

/**
 * @swagger
 * /api/v1/export/site-visits:
 *   get:
 *     summary: Export site visits to Excel
 *     description: Admin gets all visits. Others get their assigned visits. Includes feedback columns.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from,       schema: { type: string, format: date } }
 *       - { in: query, name: to,         schema: { type: string, format: date } }
 *       - { in: query, name: project_id, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/site-visits', authenticate, ctrl.exportSiteVisits)

/**
 * @swagger
 * /api/v1/export/follow-ups:
 *   get:
 *     summary: Export follow-ups / tasks to Excel
 *     description: Admin gets all tasks. Others get only their assigned tasks.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to,   schema: { type: string, format: date } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/follow-ups',  authenticate, ctrl.exportFollowUps)

/**
 * @swagger
 * /api/v1/export/projects:
 *   get:
 *     summary: Export all projects to Excel (admin only)
 *     description: Includes lead counts, booked counts, and site visit counts per project.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       403:
 *         description: Admin access required
 */
router.get('/projects',    authenticate, authorize(...ADMIN), ctrl.exportProjects)

/**
 * @swagger
 * /api/v1/export/users:
 *   get:
 *     summary: Export all users / team to Excel (admin only)
 *     description: Includes per-user stats — leads assigned, booked, site visits, pending tasks.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       403:
 *         description: Admin access required
 */
router.get('/users',       authenticate, authorize(...ADMIN), ctrl.exportUsers)

/**
 * @swagger
 * /api/v1/export/attendance:
 *   get:
 *     summary: Export attendance to Excel
 *     description: >
 *       Admin gets all employees. Others get only their own records.
 *       Three tabs: **Attendance Records** · **Monthly Grid** · **Attendance Summary**.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date }, example: "2025-05-01" }
 *       - { in: query, name: to,   schema: { type: string, format: date }, example: "2025-05-31" }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/attendance',  authenticate, ctrl.exportAttendance)

/**
 * @swagger
 * /api/v1/export/site-revisits:
 *   get:
 *     summary: Export site revisits to Excel
 *     description: Admin gets all revisits. Others get their assigned revisits. Includes feedback columns.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from,       schema: { type: string, format: date } }
 *       - { in: query, name: to,         schema: { type: string, format: date } }
 *       - { in: query, name: project_id, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/site-revisits', authenticate, ctrl.exportSiteRevisits)

/**
 * @swagger
 * /api/v1/export/closures:
 *   get:
 *     summary: Export closures / bookings to Excel
 *     description: Admin gets all closures. Others get only closures they closed.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from,       schema: { type: string, format: date } }
 *       - { in: query, name: to,         schema: { type: string, format: date } }
 *       - { in: query, name: project_id, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/closures', authenticate, ctrl.exportClosures)

/**
 * @swagger
 * /api/v1/export/holidays:
 *   get:
 *     summary: Export holiday calendar to Excel
 *     description: Company-wide holiday calendar, visible to all authenticated users.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to,   schema: { type: string, format: date } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/holidays', authenticate, ctrl.exportHolidays)

/**
 * @swagger
 * /api/v1/export/salary:
 *   get:
 *     summary: Export salary / payroll to Excel (admin only)
 *     description: >
 *       Sensitive financial data — admin/super_admin only.
 *       Five tabs: Salary Slips, Current Salaries, Incentives, Bonus, Appraisals.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to,   schema: { type: string, format: date } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       403:
 *         description: Admin access required
 */
router.get('/salary', authenticate, authorize(...ADMIN), ctrl.exportSalary)

/**
 * @swagger
 * /api/v1/export/targets:
 *   get:
 *     summary: Export sales targets vs achieved to Excel
 *     description: Admin gets all employees' targets. Others get only their own.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to,   schema: { type: string, format: date } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/targets', authenticate, ctrl.exportTargets)

/**
 * @swagger
 * /api/v1/export/phone-reveal-requests:
 *   get:
 *     summary: Export phone reveal requests to Excel
 *     description: Admin gets all requests. Others get only requests they made.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to,   schema: { type: string, format: date } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/phone-reveal-requests', authenticate, ctrl.exportPhoneReveal)

/**
 * @swagger
 * /api/v1/export/lead-reassignments:
 *   get:
 *     summary: Export lead reassignment history to Excel
 *     description: Admin gets all reassignments. Others get only reassignments involving them.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to,   schema: { type: string, format: date } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/lead-reassignments', authenticate, ctrl.exportReassignmentHistory)

/**
 * @swagger
 * /api/v1/export/all:
 *   get:
 *     summary: Export everything into one workbook (admin only)
 *     description: >
 *       Single Excel file with all tabs: Leads, Leads Summary, Site Visits,
 *       Follow-Ups, Projects, Users, Attendance Records, Monthly Grid, Attendance Summary.
 *     tags: [Exports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to,   schema: { type: string, format: date } }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       403:
 *         description: Admin access required
 */
router.get('/all',         authenticate, authorize(...ADMIN), ctrl.exportAll)

module.exports = router
