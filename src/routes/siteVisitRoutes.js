const express = require("express");
const router = express.Router();
const siteVisitController = require("../controllers/siteVisitController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Site Visit Management
 *   description: >
 *     Schedule, manage, and track site visits for leads.
 *     Supports calendar-based scheduling, rescheduling, status updates,
 *     and post-visit feedback capture.
 */

/**
 * @swagger
 * /api/v1/site-visits:
 *   get:
 *     summary: List all site visits with filters
 *     description: >
 *       Returns a paginated list of site visits.
 *       Sales Executive sees only their own visits.
 *       Sales Manager sees their team's visits.
 *       Admin and Super Admin see all visits.
 *       Supports filtering by status, date range, and assigned user.
 *     tags: [Site Visit Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, done, cancelled, rescheduled, no_show]
 *         example: scheduled
 *       - in: query
 *         name: assigned_to
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by assigned sales executive
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter visits for a specific project
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-20"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
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
 *         description: Site visits list returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "sv-uuid-001"
 *                   lead_id: "lead-uuid-001"
 *                   lead_name: "Suresh Patel"
 *                   project_id: "proj-uuid-001"
 *                   project_name: "Skyline Heights"
 *                   visit_date: "2025-04-25"
 *                   visit_time: "11:00"
 *                   status: "scheduled"
 *                   assigned_to: "Rahul Sharma"
 *               pagination:
 *                 total: 30
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 2
 */
router.get("/", authenticate, siteVisitController.getAllSiteVisits);

/**
 * @swagger
 * /api/v1/site-visits:
 *   post:
 *     summary: Schedule a new site visit
 *     description: >
 *       Schedules a site visit for a lead at a specific project.
 *       The lead's status is automatically updated to 'site_visit_scheduled'.
 *       A notification is sent to the assigned sales executive.
 *     tags: [Site Visit Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lead_id, project_id, visit_date, visit_time]
 *             properties:
 *               lead_id:
 *                 type: string
 *                 format: uuid
 *                 example: "lead-uuid-001"
 *               project_id:
 *                 type: string
 *                 format: uuid
 *                 example: "proj-uuid-001"
 *               visit_date:
 *                 type: string
 *                 format: date
 *                 example: "2025-04-25"
 *               visit_time:
 *                 type: string
 *                 example: "11:00"
 *                 description: Time in HH:MM (24hr) format
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 example: "user-uuid-001"
 *                 description: Sales Executive conducting the visit (defaults to lead's assigned executive)
 *               notes:
 *                 type: string
 *                 example: "Client wants to see 2BHK and 3BHK units. Prefers upper floors."
 *               transport_arranged:
 *                 type: boolean
 *                 example: true
 *                 description: Whether pickup/transport has been arranged for the client
 *           example:
 *             lead_id: "lead-uuid-001"
 *             project_id: "proj-uuid-001"
 *             visit_date: "2025-04-25"
 *             visit_time: "11:00"
 *             assigned_to: "user-uuid-001"
 *             notes: "Client wants to see 2BHK and 3BHK units. Prefers upper floors."
 *             transport_arranged: true
 *     responses:
 *       201:
 *         description: Site visit scheduled successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Site visit scheduled successfully"
 *               data:
 *                 id: "sv-uuid-001"
 *                 lead_id: "lead-uuid-001"
 *                 visit_date: "2025-04-25"
 *                 visit_time: "11:00"
 *                 status: "scheduled"
 *       400:
 *         description: Missing required fields or invalid date
 *       404:
 *         description: Lead or project not found
 */
router.post("/", authenticate, siteVisitController.createSiteVisit);

/**
 * @swagger
 * /api/v1/site-visits/{id}:
 *   get:
 *     summary: Get site visit details
 *     description: >
 *       Returns full details of a site visit including lead info,
 *       project info, assigned executive, and any feedback submitted.
 *     tags: [Site Visit Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "sv-uuid-001"
 *     responses:
 *       200:
 *         description: Site visit details returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 id: "sv-uuid-001"
 *                 lead:
 *                   id: "lead-uuid-001"
 *                   name: "Suresh Patel"
 *                   phone: "+919876543210"
 *                 project:
 *                   id: "proj-uuid-001"
 *                   name: "Skyline Heights"
 *                   address: "Plot 14, Andheri West"
 *                 visit_date: "2025-04-25"
 *                 visit_time: "11:00"
 *                 status: "done"
 *                 transport_arranged: true
 *                 notes: "Client wants to see 2BHK and 3BHK units"
 *                 feedback:
 *                   rating: 4
 *                   client_reaction: "positive"
 *                   interested_in: "3BHK"
 *                   next_step: "negotiation"
 *                   remarks: "Client loved the view, wants to negotiate price"
 *                 assigned_to:
 *                   id: "user-uuid-001"
 *                   full_name: "Rahul Sharma"
 *                 created_at: "2025-04-20T10:00:00Z"
 *       404:
 *         description: Site visit not found
 */
router.get("/:id", authenticate, siteVisitController.getSiteVisitById);

/**
 * @swagger
 * /api/v1/site-visits/{id}:
 *   put:
 *     summary: Update or reschedule a site visit
 *     description: >
 *       Updates the details of a site visit — including rescheduling the date/time.
 *       If visit_date or visit_time is changed, status is automatically set to 'rescheduled'.
 *       Rescheduling is logged in the lead's activity history.
 *     tags: [Site Visit Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "sv-uuid-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               visit_date:
 *                 type: string
 *                 format: date
 *               visit_time:
 *                 type: string
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *               notes:
 *                 type: string
 *               transport_arranged:
 *                 type: boolean
 *               reschedule_reason:
 *                 type: string
 *                 description: Required if rescheduling the visit
 *           example:
 *             visit_date: "2025-04-27"
 *             visit_time: "14:00"
 *             reschedule_reason: "Client requested later date due to travel"
 *     responses:
 *       200:
 *         description: Site visit updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Site visit rescheduled to 2025-04-27 at 14:00"
 *       400:
 *         description: Cannot update a completed visit
 *       404:
 *         description: Site visit not found
 */
router.put("/:id", authenticate, siteVisitController.updateSiteVisit);

/**
 * @swagger
 * /api/v1/site-visits/{id}/status:
 *   patch:
 *     summary: Update site visit status
 *     description: >
 *       Updates the status of a site visit.
 *       When marked as 'done', the lead's status is automatically
 *       updated to 'site_visit_done'.
 *       When marked as 'cancelled' or 'no_show', a note is added to the lead's activity log.
 *     tags: [Site Visit Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "sv-uuid-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [scheduled, done, cancelled, rescheduled, no_show]
 *               note:
 *                 type: string
 *                 description: Required when cancelling or marking no_show
 *           examples:
 *             MarkDone:
 *               summary: Mark visit as done
 *               value:
 *                 status: "done"
 *             Cancel:
 *               summary: Cancel visit
 *               value:
 *                 status: "cancelled"
 *                 note: "Client cancelled — going out of town"
 *             NoShow:
 *               summary: Mark as no-show
 *               value:
 *                 status: "no_show"
 *                 note: "Client did not show up, not reachable on phone"
 *     responses:
 *       200:
 *         description: Visit status updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Site visit marked as done"
 *       400:
 *         description: Invalid status or note required
 */
router.patch("/:id/status", authenticate, siteVisitController.updateSiteVisitStatus);

/**
 * @swagger
 * /api/v1/site-visits/{id}/feedback:
 *   post:
 *     summary: Submit post-visit feedback
 *     description: >
 *       Submits feedback after a site visit is completed.
 *       Can only be submitted for visits with status 'done'.
 *       Feedback captures client reaction, interest level, and suggested next step.
 *       The lead's activity log is updated with the feedback summary.
 *     tags: [Site Visit Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "sv-uuid-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_reaction, next_step]
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 4
 *                 description: Overall visit rating out of 5
 *               client_reaction:
 *                 type: string
 *                 enum: [very_positive, positive, neutral, negative, not_interested]
 *                 example: "positive"
 *               interested_in:
 *                 type: string
 *                 example: "3BHK - Floor 12"
 *                 description: Specific unit/config the client showed interest in
 *               next_step:
 *                 type: string
 *                 enum: [negotiation, follow_up, send_proposal, booked, lost]
 *                 example: "negotiation"
 *               remarks:
 *                 type: string
 *                 example: "Client loved the view from 12th floor. Concerned about parking. Will discuss pricing next week."
 *           example:
 *             rating: 4
 *             client_reaction: "positive"
 *             interested_in: "3BHK - Floor 12"
 *             next_step: "negotiation"
 *             remarks: "Client loved the view. Concerned about parking. Will discuss pricing next week."
 *     responses:
 *       201:
 *         description: Feedback submitted successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Visit feedback submitted successfully"
 *               data:
 *                 id: "fb-uuid-001"
 *                 site_visit_id: "sv-uuid-001"
 *                 rating: 4
 *                 client_reaction: "positive"
 *                 next_step: "negotiation"
 *       400:
 *         description: Feedback already submitted or visit not completed yet
 */
router.post("/:id/feedback", authenticate, siteVisitController.submitFeedback);

/**
 * @swagger
 * /api/v1/leads/{leadId}/site-visits:
 *   get:
 *     summary: Get all site visits for a specific lead
 *     description: >
 *       Returns the complete history of site visits for a lead,
 *       ordered from most recent to oldest. Includes feedback for completed visits.
 *     tags: [Site Visit Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "lead-uuid-001"
 *     responses:
 *       200:
 *         description: Site visits for this lead returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "sv-uuid-001"
 *                   project_name: "Skyline Heights"
 *                   visit_date: "2025-04-25"
 *                   visit_time: "11:00"
 *                   status: "done"
 *                   feedback:
 *                     rating: 4
 *                     client_reaction: "positive"
 *                     next_step: "negotiation"
 *                 - id: "sv-uuid-002"
 *                   project_name: "Marina Bay Residences"
 *                   visit_date: "2025-04-15"
 *                   visit_time: "15:00"
 *                   status: "cancelled"
 */
router.get("/lead/:leadId", authenticate, siteVisitController.getVisitsByLead);

module.exports = router;
