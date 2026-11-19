/**
 * reportRoutes.js — Next One Realty CRM
 * Admin-only reports.
 */

const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const ctrl = require("../controllers/reportController");

const ADMIN = ["super_admin", "admin"];

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Admin / Super Admin only reports, computed live per IST day.
 */

/**
 * @swagger
 * /api/v1/reports/daily:
 *   get:
 *     summary: Daily activity report for all users (Admin / Super Admin only)
 *     description: >
 *       Per-user counts for the given IST day — attendance, new leads, lead
 *       activities (calls, WhatsApp, notes, status changes), follow-ups
 *       (done / due / pending / overdue), site visits, revisits and closures —
 *       plus tomorrow's scheduled follow-ups and visits, and combined totals.
 *     tags: [Reports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: Defaults to today (IST)
 *       - in: query
 *         name: team
 *         schema: { type: string, format: uuid }
 *         description: Manager user id — includes their whole reporting sub-tree
 *       - in: query
 *         name: user_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: source
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Daily report returned
 *       403:
 *         description: Insufficient permissions
 */
router.get("/daily", authenticate, authorize(...ADMIN), ctrl.getDailyReport);

/**
 * @swagger
 * /api/v1/reports/daily/{userId}/activities:
 *   get:
 *     summary: One user's activity timeline for a day (Admin / Super Admin only)
 *     tags: [Reports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: source
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Activity timeline returned
 */
router.get("/daily/:userId/activities", authenticate, authorize(...ADMIN), ctrl.getUserDailyActivities);

module.exports = router;
