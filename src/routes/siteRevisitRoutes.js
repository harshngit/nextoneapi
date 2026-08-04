const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/siteRevisitController');
const { authenticate, authorize } = require('../middleware/auth');

const ADMIN   = ['super_admin', 'admin'];
const MANAGER = ['super_admin', 'admin', 'sales_manager'];

/**
 * @swagger
 * tags:
 *   name: Site Revisits
 *   description: Follow-up re-visits linked to an original site visit
 */

/**
 * @swagger
 * /api/v1/site-revisits:
 *   get:
 *     summary: List all re-visits (paginated, filterable)
 *     tags: [Site Revisits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, done, cancelled, rescheduled, no_show]
 *       - in: query
 *         name: lead_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: original_visit_id
 *         schema: { type: string, format: uuid }
 *         description: Filter by the original site visit
 *       - in: query
 *         name: assigned_to
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *         example: "2026-05-01"
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *         example: "2026-05-31"
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive partial match against lead name, lead phone, or project name
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Re-visits list
 *         content:
 *           application/json:
 *             example:
 *               data:
 *                 - id: "rv-uuid-001"
 *                   original_visit_id: "sv-uuid-001"
 *                   visit_date: "2026-06-10"
 *                   visit_time: "11:00"
 *                   status: "scheduled"
 *                   lead_name: "Suresh Patel"
 *                   project_name: "Skyline Heights"
 *                   assigned_to_name: "Rahul Sharma"
 *                   reason: "Client wanted to check 3BHK units again"
 *               pagination:
 *                 total: 5
 *                 page: 1
 *                 per_page: 20
 */
router.get('/', authenticate, ctrl.getAllRevisits);

/**
 * @swagger
 * /api/v1/site-revisits:
 *   post:
 *     summary: Schedule a re-visit linked to an original site visit
 *     description: >
 *       Creates a follow-up visit for a lead.
 *       The lead_id and project_id are inherited from the original visit.
 *       Use this when the client wants to see the property again before deciding.
 *     tags: [Site Revisits]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [original_visit_id, visit_date, visit_time]
 *             properties:
 *               original_visit_id:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the original site visit this re-visit is linked to
 *               visit_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-10"
 *               visit_time:
 *                 type: string
 *                 example: "11:00"
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: Override assigned exec. Defaults to original visit's assignee
 *               reason:
 *                 type: string
 *                 description: Why a re-visit was needed
 *                 example: "Client wanted to see 3BHK units again and check parking space"
 *               notes:
 *                 type: string
 *                 example: "Bring updated price list"
 *               transport_arranged:
 *                 type: boolean
 *                 default: false
 *           example:
 *             original_visit_id: "sv-uuid-001"
 *             visit_date: "2026-06-10"
 *             visit_time: "11:00"
 *             assigned_to: "user-uuid-001"
 *             reason: "Client wanted to see 3BHK units again"
 *             notes: "Bring updated price list and floor plans"
 *             transport_arranged: true
 *     responses:
 *       201:
 *         description: Re-visit scheduled
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Re-visit scheduled successfully"
 *               data:
 *                 id: "rv-uuid-001"
 *                 original_visit_id: "sv-uuid-001"
 *                 lead_id: "lead-uuid-001"
 *                 project_id: "proj-uuid-001"
 *                 visit_date: "2026-06-10"
 *                 visit_time: "11:00"
 *                 status: "scheduled"
 *                 transport_arranged: true
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: Original site visit not found
 */
router.post('/', authenticate, ctrl.createRevisit);

/**
 * @swagger
 * /api/v1/site-revisits/from-lead:
 *   post:
 *     summary: Directly convert a lead into a re-visit (no existing site visit needed)
 *     description: >
 *       Creates a re-visit straight from a lead_id — for leads whose first
 *       site visit isn't on record in this system, or where you simply don't
 *       have a site_visit_id to reference. The normal POST /site-revisits
 *       endpoint requires an existing original_visit_id; this one only needs
 *       lead_id. Internally it still creates a minimal placeholder site visit
 *       to satisfy the database's original_visit_id link, but that's
 *       transparent to the caller — the resulting re-visit behaves exactly
 *       like any other and shows up in GET /site-revisits normally.
 *       Project defaults to the lead's own project unless project_id or
 *       project_name is passed to override it.
 *     tags: [Site Revisits]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lead_id, visit_date, visit_time]
 *             properties:
 *               lead_id:
 *                 type: string
 *                 format: uuid
 *                 example: "lead-uuid-001"
 *               project_id:
 *                 type: string
 *                 description: Optional override — project UUID or name. Defaults to the lead's own project.
 *               project_name:
 *                 type: string
 *                 description: Optional override — free-text project name (used if project_id not given)
 *               visit_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-08-10"
 *               visit_time:
 *                 type: string
 *                 example: "15:30"
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: Defaults to the lead's currently assigned user
 *               transport_arranged:
 *                 type: boolean
 *                 default: false
 *               reason:
 *                 type: string
 *                 example: "Client wants to revisit before finalizing"
 *               notes:
 *                 type: string
 *           example:
 *             lead_id: "lead-uuid-001"
 *             visit_date: "2026-08-10"
 *             visit_time: "15:30"
 *             reason: "Client wants to revisit before finalizing"
 *     responses:
 *       201:
 *         description: Lead converted to re-visit successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead converted to re-visit successfully"
 *               data:
 *                 id: "rv-uuid-010"
 *                 lead_id: "lead-uuid-001"
 *                 original_visit_id: "sv-uuid-auto-001"
 *                 visit_date: "2026-08-10"
 *                 visit_time: "15:30"
 *                 status: "scheduled"
 *       400:
 *         description: lead_id, visit_date, or visit_time missing
 *       404:
 *         description: Lead not found
 */
router.post('/from-lead', authenticate, ctrl.convertLeadToRevisit);

/**
 * @swagger
 * /api/v1/site-revisits/original/{visitId}:
 *   get:
 *     summary: Get all re-visits for a specific original site visit
 *     tags: [Site Revisits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: visitId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Original site visit ID
 *     responses:
 *       200:
 *         description: Re-visits for this original visit
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 original_visit_id: "sv-uuid-001"
 *                 revisits:
 *                   - id: "rv-uuid-001"
 *                     visit_date: "2026-06-10"
 *                     visit_time: "11:00"
 *                     status: "done"
 *                     reason: "Client wanted to see 3BHK again"
 *                     assigned_to_name: "Rahul Sharma"
 *                     rating: 4
 *                     client_reaction: "positive"
 *                     next_step: "negotiation"
 */
router.get('/original/:visitId', authenticate, ctrl.getRevisitsByOriginalVisit);

/**
 * @swagger
 * /api/v1/site-revisits/{id}:
 *   get:
 *     summary: Get a re-visit by ID
 *     tags: [Site Revisits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Re-visit details
 *       404:
 *         description: Re-visit not found
 */
router.get('/:id', authenticate, ctrl.getRevisitById);

/**
 * @swagger
 * /api/v1/site-revisits/{id}:
 *   put:
 *     summary: Update a re-visit
 *     description: >
 *       Same fields as Create Re-visit (except original_visit_id which cannot change).
 *       All fields optional — send only what changed.
 *       If visit_date or visit_time changes, status is automatically set to rescheduled
 *       and a reschedule activity is logged.
 *     tags: [Site Revisits]
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
 *               visit_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-15"
 *               visit_time:
 *                 type: string
 *                 example: "11:00"
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: Override assigned exec. Defaults to original visit's assignee
 *               reason:
 *                 type: string
 *                 description: Why a re-visit was needed
 *                 example: "Client wanted to see 3BHK units again and check parking space"
 *               notes:
 *                 type: string
 *                 example: "Bring updated price list"
 *               transport_arranged:
 *                 type: boolean
 *               reschedule_reason:
 *                 type: string
 *                 description: Logged as lead activity if date/time changes
 *                 example: "Client requested morning slot"
 *           example:
 *             visit_date: "2026-06-15"
 *             visit_time: "11:00"
 *             assigned_to: "user-uuid-001"
 *             reason: "Client wanted to see 3BHK units again"
 *             notes: "Bring updated price list and floor plans"
 *             transport_arranged: true
 *             reschedule_reason: "Client requested morning slot"
 *     responses:
 *       200:
 *         description: Re-visit updated or rescheduled
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Re-visit rescheduled"
 *               data:
 *                 id: "rv-uuid-001"
 *                 visit_date: "2026-06-15"
 *                 visit_time: "11:00"
 *                 status: "rescheduled"
 *       400:
 *         description: Cannot update a completed re-visit
 *       404:
 *         description: Re-visit not found
 */
router.put('/:id', authenticate, ctrl.updateRevisit);

/**
 * @swagger
 * /api/v1/site-revisits/{id}/status:
 *   patch:
 *     summary: Update re-visit status
 *     description: >
 *       Valid statuses: scheduled, done, cancelled, rescheduled, no_show.
 *       note is required when setting cancelled or no_show.
 *       When set to done, lead status is updated to site_visit_done.
 *     tags: [Site Revisits]
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [scheduled, done, complete, completed, cancelled, rescheduled, no_show]
 *               note:
 *                 type: string
 *                 description: Required for cancelled and no_show
 *               closing_manager:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the manager closing the re-visit (from users table)
 *               closing_person:
 *                 type: string
 *                 description: Free-text name of the person who closed the re-visit (not linked to users table)
 *                 example: "Rajesh Kumar"
 *           example:
 *             status: "done"
 *             note: "Client visited, very positive reaction"
 *             closing_person: "Rajesh Kumar"
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Invalid status or missing note
 */
router.patch('/:id/status', authenticate, ctrl.updateRevisitStatus);

/**
 * @swagger
 * /api/v1/site-revisits/{id}/feedback:
 *   post:
 *     summary: Submit feedback after a completed re-visit
 *     description: >
 *       Can only be submitted once and only when the re-visit status is done.
 *       next_step includes an extra option: another_revisit (unlike site visit feedback).
 *     tags: [Site Revisits]
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
 *             required: [client_reaction, next_step]
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               client_reaction:
 *                 type: string
 *                 enum: [very_positive, positive, neutral, negative, not_interested]
 *               interested_in:
 *                 type: string
 *                 example: "3BHK with study room, high floor, west facing"
 *               next_step:
 *                 type: string
 *                 enum: [negotiation, follow_up, send_proposal, booked, lost, another_revisit]
 *                 description: another_revisit is available here (not in site_visit_feedback)
 *               remarks:
 *                 type: string
 *                 example: "Client liked Tower B units, comparing with competitor project"
 *           example:
 *             rating: 4
 *             client_reaction: "positive"
 *             interested_in: "3BHK, floor 12-15, west facing"
 *             next_step: "negotiation"
 *             remarks: "Client happy with amenities. Wants final price quote."
 *     responses:
 *       201:
 *         description: Feedback submitted
 *       400:
 *         description: Visit not done or feedback already submitted
 */
router.post('/:id/feedback', authenticate, ctrl.submitRevisitFeedback);

/**
 * @swagger
 * /api/v1/site-revisits/{id}:
 *   delete:
 *     summary: Delete a scheduled re-visit (Admin/Manager)
 *     description: Cannot delete a completed (done) re-visit.
 *     tags: [Site Revisits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Re-visit deleted
 *       400:
 *         description: Cannot delete a completed re-visit
 */
router.delete('/:id', authenticate, authorize(...MANAGER), ctrl.deleteRevisit);

module.exports = router;