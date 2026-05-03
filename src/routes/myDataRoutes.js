/**
 * myDataRoutes.js
 * All routes return data scoped to the authenticated user only.
 * Mounted at:  /api/v1/me
 */

const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/myDataController");
const { authenticate } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: My Data
 *   description: >
 *     All endpoints return data belonging to / assigned to the authenticated user.
 *     No extra params needed — identity comes from the Bearer token.
 */

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/me/summary:
 *   get:
 *     summary: My dashboard summary — counts across every module
 *     description: >
 *       Returns a single object with count breakdowns for leads, site visits,
 *       tasks, notifications, lead activities, and attendance — all scoped to
 *       the logged-in user.
 *     tags: [My Data]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Summary fetched
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 user:
 *                   id: "user-uuid"
 *                   name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                   email: "rahul@n1r.com"
 *                   phone: "9876543210"
 *                 leads:
 *                   total: 48
 *                   new: 5
 *                   contacted: 10
 *                   interested: 8
 *                   follow_up: 6
 *                   site_visit_scheduled: 4
 *                   site_visit_done: 7
 *                   negotiation: 3
 *                   booked: 4
 *                   lost: 1
 *                   conversion_rate: 8.3
 *                 site_visits:
 *                   total: 22
 *                   scheduled: 4
 *                   done: 14
 *                   cancelled: 2
 *                   rescheduled: 1
 *                   no_show: 1
 *                   upcoming: 4
 *                 tasks:
 *                   total: 31
 *                   pending: 12
 *                   completed: 19
 *                   overdue: 3
 *                   due_today: 2
 *                 notifications:
 *                   unread: 5
 *                 activities_this_month: 67
 *                 attendance_this_month:
 *                   total_days: 18
 *                   present: 15
 *                   absent: 1
 *                   half_day: 1
 *                   on_leave: 1
 */
router.get("/summary", authenticate, ctrl.getMySummary);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/me/leads:
 *   get:
 *     summary: My assigned leads
 *     description: >
 *       Paginated list of leads assigned to the logged-in user.
 *       Supports filtering by status, source, project, date range, and search.
 *     tags: [My Data]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [new, contacted, interested, follow_up, site_visit_scheduled, site_visit_done, negotiation, booked, lost]
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *         example: Facebook
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
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
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, phone, or email
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
 *         description: Leads returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "lead-uuid"
 *                   name: "Suresh Patel"
 *                   phone: "9876543210"
 *                   alternate_phone_number: null
 *                   email: "suresh@gmail.com"
 *                   status: "interested"
 *                   source: "Facebook"
 *                   budget: "80L-1Cr"
 *                   location_preference: "Andheri West"
 *                   project_id: "proj-uuid"
 *                   project_name: "Skyline Heights"
 *                   project_city: "Mumbai"
 *                   created_at: "2025-04-10T09:00:00Z"
 *                   updated_at: "2025-04-12T11:00:00Z"
 *               pagination:
 *                 total: 48
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 3
 */
router.get("/leads", authenticate, ctrl.getMyLeads);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/me/site-visits:
 *   get:
 *     summary: My assigned site visits
 *     description: >
 *       Paginated list of site visits assigned to the logged-in user.
 *       Pass `upcoming=true` to get only future scheduled/rescheduled visits.
 *       Includes lead info, project info, and feedback if submitted.
 *     tags: [My Data]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, done, cancelled, rescheduled, no_show]
 *       - in: query
 *         name: upcoming
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *         description: If true, returns only future scheduled/rescheduled visits
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
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
 *         description: Site visits returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "sv-uuid"
 *                   visit_date: "2025-05-10"
 *                   visit_time: "10:00:00"
 *                   status: "scheduled"
 *                   transport_arranged: false
 *                   notes: "Client coming with family"
 *                   lead_id: "lead-uuid"
 *                   lead_name: "Suresh Patel"
 *                   lead_phone: "9876543210"
 *                   project_id: "proj-uuid"
 *                   project_name: "Skyline Heights"
 *                   project_city: "Mumbai"
 *                   project_locality: "Andheri West"
 *                   rating: null
 *                   client_reaction: null
 *                   next_step: null
 *                   remarks: null
 *               pagination:
 *                 total: 22
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 2
 */
router.get("/site-visits", authenticate, ctrl.getMySiteVisits);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/me/tasks:
 *   get:
 *     summary: My assigned tasks / follow-ups
 *     description: >
 *       Paginated list of tasks assigned to the logged-in user.
 *       Results are ordered by completion status, then priority (high first),
 *       then due date (soonest first).
 *       Pass `overdue=true` or `due_today=true` for quick filters.
 *     tags: [My Data]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: is_completed
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *         description: Filter by completion status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [low, medium, high]
 *       - in: query
 *         name: overdue
 *         schema:
 *           type: string
 *           enum: ["true"]
 *         description: Return only overdue pending tasks
 *       - in: query
 *         name: due_today
 *         schema:
 *           type: string
 *           enum: ["true"]
 *         description: Return only tasks due today
 *       - in: query
 *         name: lead_id
 *         schema:
 *           type: string
 *           format: uuid
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
 *         description: Tasks returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "task-uuid"
 *                   title: "Follow up call"
 *                   notes: "Client asked for floor plan"
 *                   priority: "high"
 *                   due_date: "2025-05-05T10:00:00Z"
 *                   is_completed: false
 *                   completed_at: null
 *                   lead_id: "lead-uuid"
 *                   lead_name: "Suresh Patel"
 *                   lead_phone: "9876543210"
 *                   lead_status: "interested"
 *                   project_name: "Skyline Heights"
 *                   created_by_name: "Admin User"
 *               pagination:
 *                 total: 31
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 2
 */
router.get("/tasks", authenticate, ctrl.getMyTasks);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/me/notifications:
 *   get:
 *     summary: My notifications
 *     description: >
 *       Paginated list of notifications for the logged-in user.
 *       Response includes `unread_count` at the top level alongside pagination.
 *     tags: [My Data]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: is_read
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *         description: Filter by read/unread status
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by notification type (e.g. lead_assigned, follow_up_reminder)
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
 *         description: Notifications returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               unread_count: 5
 *               data:
 *                 - id: "notif-uuid"
 *                   type: "lead_assigned"
 *                   title: "New lead assigned"
 *                   message: "Suresh Patel has been assigned to you"
 *                   is_read: false
 *                   reference_id: "lead-uuid"
 *                   reference_type: "lead"
 *                   created_at: "2025-05-03T08:30:00Z"
 *               pagination:
 *                 total: 24
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 2
 */
router.get("/notifications", authenticate, ctrl.getMyNotifications);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/me/attendance:
 *   get:
 *     summary: My attendance records
 *     description: >
 *       Paginated attendance records for the logged-in user.
 *       Defaults to the current calendar month.
 *       Response includes a `summary` block with aggregated counts and average hours,
 *       and a `period` block showing the date range used.
 *     tags: [My Data]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (default = first day of current month)
 *         example: "2025-05-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (default = today)
 *         example: "2025-05-31"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [present, absent, half_day, on_leave]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 31
 *     responses:
 *       200:
 *         description: Attendance returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               period:
 *                 from: "2025-05-01"
 *                 to: "2025-05-31"
 *               summary:
 *                 total_days: 20
 *                 present: 17
 *                 absent: 1
 *                 half_day: 1
 *                 on_leave: 1
 *                 avg_hours_per_day: 8.35
 *               data:
 *                 - id: "att-uuid"
 *                   date: "2025-05-03"
 *                   status: "present"
 *                   leave_type: null
 *                   check_in_time: "2025-05-03T09:02:00Z"
 *                   check_out_time: "2025-05-03T18:15:00Z"
 *                   hours_worked: 9.22
 *                   is_manual_entry: false
 *                   manual_by_name: null
 *               pagination:
 *                 total: 20
 *                 page: 1
 *                 per_page: 31
 *                 total_pages: 1
 */
router.get("/attendance", authenticate, ctrl.getMyAttendance);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/me/activities:
 *   get:
 *     summary: Lead activities performed by me
 *     description: >
 *       Paginated list of lead activities (calls, notes, whatsapp, meetings,
 *       status changes, assignments) that were logged by the authenticated user.
 *     tags: [My Data]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [note, call, email, whatsapp, meeting, status_change, assignment]
 *       - in: query
 *         name: lead_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-05-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-05-31"
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
 *         description: Activities returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "act-uuid"
 *                   type: "call"
 *                   note: "Client confirmed site visit for next Saturday"
 *                   created_at: "2025-05-03T10:30:00Z"
 *                   lead_id: "lead-uuid"
 *                   lead_name: "Suresh Patel"
 *                   lead_phone: "9876543210"
 *                   lead_status: "site_visit_scheduled"
 *                   project_name: "Skyline Heights"
 *               pagination:
 *                 total: 67
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 4
 */
router.get("/activities", authenticate, ctrl.getMyActivities);

module.exports = router;
