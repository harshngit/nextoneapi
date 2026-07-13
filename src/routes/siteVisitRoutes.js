const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/siteVisitController');
const { authenticate, authorize } = require('../middleware/auth');

const ADMIN   = ['super_admin', 'admin'];
const MANAGER = ['super_admin', 'admin', 'sales_manager'];

/**
 * @swagger
 * tags:
 *   name: Site Visits
 *   description: Management of original site visits
 */

/**
 * @swagger
 * /api/v1/site-visits:
 *   get:
 *     summary: List all site visits (paginated, filterable)
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [scheduled, done, cancelled, rescheduled, no_show] }
 *       - in: query
 *         name: lead_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: project_id
 *         schema: { type: string }
 *         description: Project UUID or project name
 *       - in: query
 *         name: assigned_to
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Site visits list
 */
router.get('/', authenticate, ctrl.getAllSiteVisits);

/**
 * @swagger
 * /api/v1/site-visits:
 *   post:
 *     summary: Schedule a new site visit
 *     description: >
 *       project_id accepts a project UUID, an existing project's name, or any
 *       free-text project name that doesn't exist yet in the system — it does
 *       NOT have to match a real project. If it matches, the visit links to
 *       that project. If it doesn't match, the text is stored as-is (same
 *       fallback behavior as leads.project_name_text) instead of the request
 *       being rejected.
 *     tags: [Site Visits]
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
 *               project_id:
 *                 type: string
 *                 description: >
 *                   Project UUID, an existing project's name, or any free-text
 *                   project name — does not have to already exist.
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
 *                 description: Defaults to lead's assigned executive if not provided
 *               notes:
 *                 type: string
 *                 example: "Bring updated brochure and price list"
 *               transport_arranged:
 *                 type: boolean
 *                 default: false
 *           example:
 *             lead_id: "lead-uuid-001"
 *             project_id: "proj-uuid-001"
 *             visit_date: "2026-06-15"
 *             visit_time: "11:00"
 *             assigned_to: "user-uuid-001"
 *             notes: "Bring updated brochure and price list"
 *             transport_arranged: false
 *     responses:
 *       201:
 *         description: Site visit scheduled
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Site visit scheduled"
 *               data:
 *                 id: "sv-uuid-001"
 *                 lead_id: "lead-uuid-001"
 *                 project_id: "proj-uuid-001"
 *                 visit_date: "2026-06-15"
 *                 visit_time: "11:00:00"
 *                 status: "scheduled"
 *                 transport_arranged: false
 */
router.post('/', authenticate, ctrl.createSiteVisit);

/**
 * @swagger
 * /api/v1/site-visits/{id}:
 *   get:
 *     summary: Get site visit details
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site visit details
 */
router.get('/:id', authenticate, ctrl.getSiteVisitById);

/**
 * @swagger
 * /api/v1/site-visits/{id}:
 *   put:
 *     summary: Update site visit
 *     description: >
 *       Same fields as Create Site Visit — all optional on update.
 *       If visit_date or visit_time changes, a reschedule activity is logged automatically.
 *     tags: [Site Visits]
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
 *               lead_id:
 *                 type: string
 *                 format: uuid
 *               project_id:
 *                 type: string
 *                 description: Project UUID or project name
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
 *               notes:
 *                 type: string
 *                 example: "Bring updated brochure and price list"
 *               transport_arranged:
 *                 type: boolean
 *           example:
 *             lead_id: "lead-uuid-001"
 *             project_id: "proj-uuid-001"
 *             visit_date: "2026-06-15"
 *             visit_time: "11:00"
 *             assigned_to: "user-uuid-001"
 *             notes: "Client rescheduled to afternoon"
 *             transport_arranged: true
 *     responses:
 *       200:
 *         description: Site visit updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Site visit updated"
 *               data:
 *                 id: "sv-uuid-001"
 *                 visit_date: "2026-06-15"
 *                 visit_time: "11:00:00"
 *                 status: "scheduled"
 *       404:
 *         description: Site visit not found
 */
router.put('/:id', authenticate, ctrl.updateSiteVisit);

/**
 * @swagger
 * /api/v1/site-visits/{id}/status:
 *   patch:
 *     summary: Update site visit status
 *     tags: [Site Visits]
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
 *               status: { type: string, enum: [scheduled, done, cancelled, rescheduled, no_show] }
 *               note: { type: string }
 *               closing_manager:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the manager closing the visit (from users table)
 *               closing_person:
 *                 type: string
 *                 description: Free-text name of the person who closed the visit (not linked to users table)
 *                 example: "Rajesh Kumar"
 *     responses:
 *       200:
 *         description: Status updated
 */
router.patch('/:id/status', authenticate, ctrl.updateSiteVisitStatus);

/**
 * @swagger
 * /api/v1/site-visits/{id}:
 *   delete:
 *     summary: Delete site visit
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site visit deleted
 */
router.delete('/:id', authenticate, authorize(...ADMIN), ctrl.deleteSiteVisit);

/**
 * @swagger
 * /api/v1/site-visits/{id}/feedback:
 *   post:
 *     summary: Submit feedback for site visit
 *     tags: [Site Visits]
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
 *               rating: { type: integer, minimum: 1, maximum: 5, description: "Rating from 1 to 5" }
 *               client_reaction: { type: string, enum: ["very_positive", "positive", "neutral", "negative", "not_interested"], description: "Client's reaction to the site visit" }
 *               interested_in: { type: string, description: "What the client is interested in" }
 *               next_step: { type: string, enum: ["negotiation", "follow_up", "send_proposal", "booked", "lost", "site_revisit"], description: "Next step to take" }
 *               remarks: { type: string, description: "Additional remarks or notes" }
 *     responses:
 *       201:
 *         description: Feedback submitted
 */
router.post('/:id/feedback', authenticate, ctrl.submitSiteVisitFeedback);

/**
 * @swagger
 * /api/v1/site-visits/create-with-lead:
 *   post:
 *     summary: Create a new lead along with a site visit
 *     description: Creates a new lead with status "site_visit_scheduled" and a linked site visit in a single request
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - phone
 *               - visit_date
 *               - visit_time
 *             properties:
 *               # Lead fields
 *               name:
 *                 type: string
 *                 description: Lead name
 *               phone:
 *                 type: string
 *                 description: Lead phone number
 *               alternate_phone_number:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               source:
 *                 type: string
 *               project_id:
 *                 type: string
 *                 description: >
 *                   Project UUID, an existing project's name, or any free-text
 *                   project name. Either project_id or project_name is required
 *                   (project_id takes precedence if both are sent). Does NOT
 *                   have to match an existing project — if it doesn't, the
 *                   text is stored as-is (same fallback as leads.project_name_text)
 *                   instead of the request being rejected.
 *               project_name:
 *                 type: string
 *                 description: >
 *                   Project name, used when the user typed a name instead of
 *                   picking from the dropdown. Looked up case-insensitively;
 *                   falls back to free text if no matching project is found.
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: User to assign both lead and site visit to
 *               budget:
 *                 type: string
 *               location_preference:
 *                 type: string
 *               configuration:
 *                 type: string
 *               lead_notes:
 *                 type: string
 *                 description: Notes for lead activity
 *               callback_time:
 *                 type: string
 *                 format: date-time
 *               next_followup_time:
 *                 type: string
 *                 format: date-time
 *               # Site visit fields
 *               visit_date:
 *                 type: string
 *                 format: date
 *               visit_time:
 *                 type: string
 *               notes:
 *                 type: string
 *               transport_arranged:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Lead and site visit created successfully
 */
router.post('/create-with-lead', authenticate, ctrl.createSiteVisitWithLead);

module.exports = router;