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
 *     - Leads     → Leads list + Leads Summary
 *     - Site Visits → Site Visits (with feedback)
 *     - Follow-Ups  → Tasks / Follow-ups
 *     - Projects    → Projects with lead counts (admin only)
 *     - Users       → Team members with stats (admin only)
 *     - Attendance  → All Records + Monthly Grid + Summary
 *     - All         → Every tab above in one file (admin only)
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
