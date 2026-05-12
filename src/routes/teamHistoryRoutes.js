const express    = require("express");
const router     = express.Router();
const controller = require("../controllers/teamHistoryController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Team History
 *   description: >
 *     View the complete activity history — leads, follow-ups, and site visits —
 *     for any individual team member.
 *
 *     Access rules:
 *       - super_admin / admin  → can view history for any user.
 *       - sales_manager        → can view history only for their own team members
 *                                (users whose manager_id matches the caller's id).
 *       - sales_executive /
 *         external_caller      → can view only their own history
 *                                (pass their own user id as :userId).
 */

/**
 * @swagger
 * /api/v1/team-history/{userId}/leads:
 *   get:
 *     summary: Get leads history for a team member
 *     description: >
 *       Returns a paginated list of all leads assigned to the specified user.
 *       super_admin and admin can query any user.
 *       sales_manager can only query users on their own team.
 *       sales_executive and external_caller can only query themselves.
 *     tags: [Team History]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the sales_executive or external_caller
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [new, contacted, interested, follow_up, site_visit_scheduled, site_visit_done, negotiation, booked, lost]
 *         description: Filter by lead status
 *         example: booked
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *         description: Filter by lead source (partial match)
 *         example: Facebook
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start of date range (created_at)
 *         example: "2025-04-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End of date range (created_at)
 *         example: "2025-04-30"
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by lead name, phone, or email
 *         example: "Suresh"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Leads history returned successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               member:
 *                 id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 full_name: "Rahul Sharma"
 *                 role: "sales_executive"
 *               data:
 *                 - id: "lead-uuid-1"
 *                   name: "Suresh Patel"
 *                   phone: "+919876543210"
 *                   email: "suresh.patel@gmail.com"
 *                   status: "booked"
 *                   source: "Facebook"
 *                   budget: "80-100L"
 *                   location_preference: "Andheri West"
 *                   project_name: "DLF Andheri West"
 *                   created_at: "2025-04-10T08:00:00Z"
 *               pagination:
 *                 total: 45
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 3
 *       403:
 *         description: Access denied — user is not on your team
 *       404:
 *         description: User not found
 */
router.get(
  "/:userId/leads",
  authenticate,
  authorize("super_admin", "admin", "sales_manager", "sales_executive", "external_caller"),
  controller.getUserLeads
);

/**
 * @swagger
 * /api/v1/team-history/{userId}/follow-ups:
 *   get:
 *     summary: Get follow-ups history for a team member
 *     description: >
 *       Returns a paginated list of all follow-up tasks assigned to the specified user.
 *       super_admin and admin can query any user.
 *       sales_manager can only query users on their own team.
 *       sales_executive and external_caller can only query themselves.
 *     tags: [Team History]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the sales_executive or external_caller
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       - in: query
 *         name: is_completed
 *         schema:
 *           type: boolean
 *         description: Filter by completion status
 *         example: false
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [low, medium, high]
 *         description: Filter by priority
 *         example: high
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start of due_date range
 *         example: "2025-04-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End of due_date range
 *         example: "2025-04-30"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Follow-ups history returned successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               member:
 *                 id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 full_name: "Rahul Sharma"
 *                 role: "sales_executive"
 *               data:
 *                 - id: "task-uuid-1"
 *                   title: "Call back - Follow-up"
 *                   notes: "Client wants pricing details"
 *                   priority: "high"
 *                   due_date: "2025-04-15T10:00:00Z"
 *                   is_completed: false
 *                   lead_id: "lead-uuid-1"
 *                   lead_name: "Suresh Patel"
 *                   lead_phone: "+919876543210"
 *               pagination:
 *                 total: 12
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 1
 *       403:
 *         description: Access denied — user is not on your team
 *       404:
 *         description: User not found
 */
router.get(
  "/:userId/follow-ups",
  authenticate,
  authorize("super_admin", "admin", "sales_manager", "sales_executive", "external_caller"),
  controller.getUserFollowUps
);

/**
 * @swagger
 * /api/v1/team-history/{userId}/site-visits:
 *   get:
 *     summary: Get site visits history for a team member
 *     description: >
 *       Returns a paginated list of all site visits assigned to the specified user.
 *       super_admin and admin can query any user.
 *       sales_manager can only query users on their own team.
 *       sales_executive and external_caller can only query themselves.
 *     tags: [Team History]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the sales_executive or external_caller
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, completed, cancelled, no_show]
 *         description: Filter by site visit status
 *         example: completed
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start of visit_date range
 *         example: "2025-04-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End of visit_date range
 *         example: "2025-04-30"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Site visits history returned successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               member:
 *                 id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 full_name: "Rahul Sharma"
 *                 role: "sales_executive"
 *               data:
 *                 - id: "sv-uuid-1"
 *                   visit_date: "2025-04-12T11:00:00Z"
 *                   status: "completed"
 *                   notes: "Client liked the 3BHK unit"
 *                   transport_arranged: true
 *                   lead_id: "lead-uuid-1"
 *                   lead_name: "Suresh Patel"
 *                   lead_phone: "+919876543210"
 *                   project_id: "proj-uuid-1"
 *                   project_name: "DLF Andheri West"
 *               pagination:
 *                 total: 8
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 1
 *       403:
 *         description: Access denied — user is not on your team
 *       404:
 *         description: User not found
 */
router.get(
  "/:userId/site-visits",
  authenticate,
  authorize("super_admin", "admin", "sales_manager", "sales_executive", "external_caller"),
  controller.getUserSiteVisits
);

module.exports = router;
