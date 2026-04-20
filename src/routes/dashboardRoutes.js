const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Dashboard & Reporting
 *   description: >
 *     Real-time dashboard metrics and reports.
 *     Dashboard data is pushed via WebSocket when underlying data changes
 *     (lead status update, new booking, visit completed, etc).
 *
 *     **WebSocket Event — `dashboard:update`**
 *     ```json
 *     { "type": "lead_funnel", "data": { "new": 12, "booked": 3 } }
 *     ```
 */

/**
 * @swagger
 * /api/v1/dashboard/overview:
 *   get:
 *     summary: Lead funnel overview — counts per lifecycle stage
 *     description: >
 *       Returns total lead counts grouped by status stage.
 *       Super Admin / Admin see all leads; Sales Manager sees team leads;
 *       Sales Executive sees own leads. Supports date range filtering.
 *       Also subscribed via WebSocket — emits `dashboard:update` with type `lead_funnel`
 *       whenever a lead status changes.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-30"
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Lead funnel data returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 period: { from: "2025-04-01", to: "2025-04-30" }
 *                 total: 120
 *                 funnel:
 *                   new: 18
 *                   contacted: 25
 *                   interested: 22
 *                   follow_up: 15
 *                   site_visit_scheduled: 12
 *                   site_visit_done: 10
 *                   negotiation: 8
 *                   booked: 6
 *                   lost: 4
 *                 conversion_rate: 5.0
 */
router.get("/overview", authenticate, dashboardController.getOverview);

/**
 * @swagger
 * /api/v1/dashboard/team-performance:
 *   get:
 *     summary: Team-wise lead counts and conversion rates
 *     description: >
 *       Returns performance stats for each team member.
 *       Admin / Super Admin see all teams; Sales Manager sees their team only.
 *       Emits `dashboard:update` with type `team_performance` via WebSocket
 *       when any team lead is updated.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: manager_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by specific manager's team (Admin only)
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-30"
 *     responses:
 *       200:
 *         description: Team performance returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - user_id: "user-uuid-001"
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                   total_leads: 45
 *                   contacted: 38
 *                   site_visits_done: 12
 *                   booked: 5
 *                   lost: 8
 *                   conversion_rate: 11.1
 *                   pending_tasks: 7
 */
router.get(
  "/team-performance",
  authenticate,
  authorize("super_admin", "admin", "sales_manager"),
  dashboardController.getTeamPerformance
);

/**
 * @swagger
 * /api/v1/dashboard/site-visits:
 *   get:
 *     summary: Site visit analytics
 *     description: >
 *       Returns site visit counts by status and upcoming visits.
 *       Emits `dashboard:update` with type `site_visits` when visit status changes.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-30"
 *     responses:
 *       200:
 *         description: Site visit analytics returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 summary:
 *                   scheduled: 8
 *                   done: 12
 *                   cancelled: 3
 *                   rescheduled: 2
 *                   no_show: 1
 *                   total: 26
 *                 completion_rate: 46.2
 *                 upcoming:
 *                   - id: "sv-uuid-005"
 *                     lead_name: "Suresh Patel"
 *                     project_name: "Skyline Heights"
 *                     visit_date: "2025-04-22"
 *                     visit_time: "11:00"
 *                     assigned_to: "Rahul Sharma"
 */
router.get("/site-visits", authenticate, dashboardController.getSiteVisitAnalytics);

/**
 * @swagger
 * /api/v1/dashboard/followup-tracker:
 *   get:
 *     summary: Pending and overdue follow-up stats
 *     description: >
 *       Returns follow-up task stats — pending, overdue, and due today.
 *       Emits `dashboard:update` with type `followup_tracker` when tasks are updated.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Follow-up tracker data returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 total_pending: 28
 *                 overdue: 6
 *                 due_today: 9
 *                 due_this_week: 13
 *                 by_user:
 *                   - user_id: "user-uuid-001"
 *                     full_name: "Rahul Sharma"
 *                     pending: 7
 *                     overdue: 2
 */
router.get("/followup-tracker", authenticate, dashboardController.getFollowupTracker);

/**
 * @swagger
 * /api/v1/reports/leads:
 *   get:
 *     summary: Filtered lead report
 *     description: >
 *       Returns a detailed lead report filtered by date range, source, status, and assigned user.
 *       Useful for exporting and reviewing sales pipeline data.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-30"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *       - in: query
 *         name: assigned_to
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Lead report returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 summary:
 *                   total: 120
 *                   booked: 6
 *                   lost: 14
 *                 by_source:
 *                   - source: "Facebook"
 *                     count: 45
 *                     booked: 3
 *                   - source: "Walk-in"
 *                     count: 20
 *                     booked: 2
 *                 leads:
 *                   - id: "lead-uuid-001"
 *                     name: "Suresh Patel"
 *                     status: "booked"
 *                     source: "Facebook"
 *                     assigned_to: "Rahul Sharma"
 *                     created_at: "2025-04-10T09:00:00Z"
 */
router.get(
  "/reports/leads",
  authenticate,
  authorize("super_admin", "admin", "sales_manager"),
  dashboardController.getLeadsReport
);

/**
 * @swagger
 * /api/v1/reports/conversion:
 *   get:
 *     summary: Lead conversion rate report
 *     description: >
 *       Returns conversion rate metrics broken down by source, project,
 *       and team member for the given date range.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-30"
 *     responses:
 *       200:
 *         description: Conversion rate report returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 overall_conversion_rate: 5.0
 *                 by_source:
 *                   - source: "Facebook"
 *                     total: 45
 *                     booked: 3
 *                     rate: 6.7
 *                 by_project:
 *                   - project: "Skyline Heights"
 *                     total: 38
 *                     booked: 4
 *                     rate: 10.5
 *                 by_executive:
 *                   - name: "Rahul Sharma"
 *                     total: 45
 *                     booked: 5
 *                     rate: 11.1
 */
router.get(
  "/reports/conversion",
  authenticate,
  authorize("super_admin", "admin", "sales_manager"),
  dashboardController.getConversionReport
);

module.exports = router;
