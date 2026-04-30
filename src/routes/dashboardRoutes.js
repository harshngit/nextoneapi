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
 *     Dashboard data is pushed via WebSocket when underlying data changes.
 *
 *     **WebSocket Event — `dashboard:update`**
 *     ```json
 *     { "type": "lead_funnel", "data": { "new": 12, "booked": 3 } }
 *     ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// NEW DASHBOARD ENDPOINTS (matching the UI design)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/dashboard/stats:
 *   get:
 *     summary: Top KPI cards — Total Leads, Site Visits, Follow Ups, Projects with % change
 *     description: >
 *       Returns the 4 main KPI stat cards shown at the top of the dashboard.
 *       Each value comes with a % change vs the previous period of equal length.
 *       Role-scoped: sales_executive sees own data; sales_manager sees team data;
 *       admin/super_admin see everything.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (default = first day of current month)
 *         example: "2025-06-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (default = today)
 *         example: "2025-06-30"
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Optional project filter
 *     responses:
 *       200:
 *         description: KPI stats returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 period: { from: "2025-06-01", to: "2025-06-30" }
 *                 stats:
 *                   total_leads:
 *                     value: 2845
 *                     change: 12.5
 *                     prev_value: 2529
 *                   total_site_visits:
 *                     value: 45
 *                     change: -4.3
 *                     prev_value: 47
 *                   total_follow_ups:
 *                     value: 156
 *                     change: 18.2
 *                     prev_value: 132
 *                   total_projects:
 *                     value: 12
 *                     change: 5.7
 *                     prev_value: 11
 */
router.get("/stats", authenticate, dashboardController.getDashboardStats);

/**
 * @swagger
 * /api/v1/dashboard/revenue:
 *   get:
 *     summary: Revenue / lead trend chart data (week / month / year)
 *     description: >
 *       Returns time-series data for the Revenue chart.
 *       Use `range=week` for daily points, `range=month` for last 6 months (default),
 *       `range=year` for last 5 years.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         schema:
 *           type: string
 *           enum: [week, month, year]
 *           default: month
 *         description: Aggregation period
 *         example: month
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Revenue trend returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 range_type: month
 *                 data:
 *                   - label: "Jan 2025"
 *                     total_leads: 380
 *                     booked: 4
 *                     site_visits: 22
 *                   - label: "Feb 2025"
 *                     total_leads: 510
 *                     booked: 6
 *                     site_visits: 28
 */
router.get("/revenue", authenticate, dashboardController.getRevenueTrend);

/**
 * @swagger
 * /api/v1/dashboard/lead-sources:
 *   get:
 *     summary: Lead source distribution for the donut chart
 *     description: >
 *       Returns lead counts grouped by source (Facebook, Google Ads, 99acres,
 *       MagicBricks, Referral, Walk-in, Website, Other) with percentages.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-06-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-06-30"
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Lead sources returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 period: { from: "2025-06-01", to: "2025-06-30" }
 *                 total: 2845
 *                 sources:
 *                   - source: "Facebook"
 *                     count: 820
 *                     booked: 45
 *                     percentage: 28.8
 *                   - source: "Google Ads"
 *                     count: 610
 *                     booked: 38
 *                     percentage: 21.4
 */
router.get("/lead-sources", authenticate, dashboardController.getLeadSources);

/**
 * @swagger
 * /api/v1/dashboard/lead-pipeline:
 *   get:
 *     summary: Lead pipeline — current distribution across all stages
 *     description: >
 *       Returns current (not date-filtered) lead counts across pipeline stages
 *       for the Lead Pipeline card: Qualified, Site Visit, Negotiation, Booking,
 *       Closed Won, Closed Lost.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Pipeline data returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 total: 850
 *                 stages:
 *                   - label: "Qualified"
 *                     key: "new"
 *                     value: 150
 *                   - label: "Site Visit"
 *                     key: "site_visit"
 *                     value: 145
 *                   - label: "Negotiation"
 *                     key: "negotiation"
 *                     value: 80
 *                   - label: "Booking"
 *                     key: "booking"
 *                     value: 45
 *                   - label: "Closed Won"
 *                     key: "closed_won"
 *                     value: 89
 *                   - label: "Closed Lost"
 *                     key: "closed_lost"
 *                     value: 341
 */
router.get("/lead-pipeline", authenticate, dashboardController.getLeadPipeline);

/**
 * @swagger
 * /api/v1/dashboard/recent-activity:
 *   get:
 *     summary: Recent activity feed (bookings, payments, status changes, etc.)
 *     description: >
 *       Returns the latest activity items for the Recent Activity card.
 *       Includes lead activities and site visit updates.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Recent activities returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "uuid"
 *                   activity_type: "lead_activity"
 *                   sub_type: "status_change"
 *                   message: "Lead Karthik Menon moved to booked"
 *                   lead_name: "Karthik Menon"
 *                   project_name: "Lodha Park"
 *                   performed_by: "Rahul Sharma"
 *                   unit_info: "Unit T-301"
 *                   created_at: "2025-06-28T08:00:00Z"
 */
router.get("/recent-activity", authenticate, dashboardController.getRecentActivity);

/**
 * @swagger
 * /api/v1/dashboard/upcoming-site-visits:
 *   get:
 *     summary: Upcoming scheduled site visits list
 *     description: >
 *       Returns upcoming site visits for the Upcoming Site Visits card.
 *       Sorted by visit_date ASC.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Upcoming site visits returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "sv-uuid"
 *                   lead_name: "Rajesh Khanna"
 *                   lead_phone: "9876543210"
 *                   project_name: "Lodha Park"
 *                   project_locality: "Worli"
 *                   visit_date: "2025-06-28"
 *                   visit_time: "10:00:00"
 *                   status: "scheduled"
 *                   assigned_to_name: "Priya Sharma"
 */
router.get("/upcoming-site-visits", authenticate, dashboardController.getUpcomingSiteVisits);

/**
 * @swagger
 * /api/v1/dashboard/commission-overview:
 *   get:
 *     summary: Commission overview (coming soon placeholder)
 *     description: Placeholder endpoint for future real-time commission tracking.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Commission overview placeholder
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 status: "coming_soon"
 *                 message: "Real-time commission tracking"
 */
router.get("/commission-overview", authenticate, dashboardController.getCommissionOverview);

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY ENDPOINTS (kept for backward compatibility)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/dashboard/overview:
 *   get:
 *     summary: "[Legacy] Lead funnel overview"
 *     description: >
 *       Legacy endpoint. Use `/api/v1/dashboard/stats` and `/api/v1/dashboard/lead-pipeline`
 *       for the new dashboard design.
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 */
router.get("/overview", authenticate, dashboardController.getOverview);

/**
 * @swagger
 * /api/v1/dashboard/team-performance:
 *   get:
 *     summary: Team-wise lead counts and conversion rates
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
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
 *     summary: Site visit analytics summary
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 */
router.get("/site-visits", authenticate, dashboardController.getSiteVisitAnalytics);

/**
 * @swagger
 * /api/v1/dashboard/followup-tracker:
 *   get:
 *     summary: Pending and overdue follow-up stats
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 */
router.get("/followup-tracker", authenticate, dashboardController.getFollowupTracker);

/**
 * @swagger
 * /api/v1/reports/leads:
 *   get:
 *     summary: Filtered lead report
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
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
 *     tags: [Dashboard & Reporting]
 *     security:
 *       - BearerAuth: []
 */
router.get(
  "/reports/conversion",
  authenticate,
  authorize("super_admin", "admin", "sales_manager"),
  dashboardController.getConversionReport
);

module.exports = router;