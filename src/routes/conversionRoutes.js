/**
 * conversionRoutes.js
 * Mounted at: /api/v1/convert
 */

const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/conversionController')
const { authenticate } = require('../middleware/auth')

/**
 * @swagger
 * tags:
 *   name: Conversions
 *   description: >
 *     Convert records between modules.
 *     Always call the OPTIONS endpoint first to get the field schema and
 *     pre-fill data for the frontend modal, then POST with the filled form.
 */

// ─────────────────────────────────────────────────────────────────────────────
// LEAD → options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/convert/lead/{leadId}/options:
 *   get:
 *     summary: Get conversion options & field schema for a lead
 *     description: >
 *       Returns the complete field schema for both "Convert to Follow-Up" and
 *       "Convert to Site Visit" modals, plus pre-filled defaults from the lead,
 *       and the full list of users and projects for dropdowns.
 *       Call this when the user clicks "Convert" on a lead — render the modal
 *       based on the returned `fields` array.
 *     tags: [Conversions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Conversion options returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 lead:
 *                   id: "lead-uuid"
 *                   name: "Suresh Patel"
 *                   phone: "9876543210"
 *                   status: "interested"
 *                   project_id: "proj-uuid"
 *                   assigned_to: "user-uuid"
 *                 conversions:
 *                   to_follow_up:
 *                     label: "Convert to Follow-Up"
 *                     available: true
 *                     fields:
 *                       - { key: "title", label: "Follow-up Title", type: "text", required: true }
 *                       - { key: "due_date", label: "Due Date & Time", type: "datetime", required: true }
 *                       - { key: "priority", label: "Priority", type: "select", required: false, options: [...] }
 *                       - { key: "assigned_to", label: "Assign To", type: "user_select", required: false }
 *                       - { key: "notes", label: "Notes", type: "textarea", required: false }
 *                     prefill:
 *                       title: "Follow-up with Suresh Patel"
 *                       assigned_to: "user-uuid"
 *                       priority: "medium"
 *                   to_site_visit:
 *                     label: "Convert to Site Visit"
 *                     available: true
 *                     fields:
 *                       - { key: "project_id", label: "Project", type: "project_select", required: true }
 *                       - { key: "visit_date", label: "Visit Date", type: "date", required: true }
 *                       - { key: "visit_time", label: "Visit Time", type: "time", required: true }
 *                       - { key: "assigned_to", label: "Assign To", type: "user_select", required: false }
 *                       - { key: "transport_arranged", label: "Transport Arranged?", type: "boolean", required: false }
 *                       - { key: "notes", label: "Notes", type: "textarea", required: false }
 *                     prefill:
 *                       project_id: "proj-uuid"
 *                       assigned_to: "user-uuid"
 *                       transport_arranged: false
 *                 users:
 *                   - { id: "user-uuid", name: "Aditya Jha", role: "sales_executive" }
 *                 projects:
 *                   - { id: "proj-uuid", name: "Skyline Heights", city: "Mumbai" }
 *       404:
 *         description: Lead not found
 */
router.get('/lead/:leadId/options', authenticate, ctrl.getLeadConversionOptions)

// ─────────────────────────────────────────────────────────────────────────────
// LEAD → Follow-Up
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/convert/lead/{leadId}/to-follow-up:
 *   post:
 *     summary: Convert a lead to a follow-up task
 *     description: >
 *       Creates a follow-up task linked to the lead.
 *       If the lead status is new / contacted / interested, it is automatically
 *       updated to "follow_up". An activity log entry is added to the lead.
 *     tags: [Conversions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, due_date]
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Call back about 2BHK pricing"
 *               due_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-05-10T11:00:00.000Z"
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 default: medium
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: Defaults to the lead's currently assigned user
 *               notes:
 *                 type: string
 *                 example: "Client is interested in 2BHK, needs floor plan"
 *     responses:
 *       201:
 *         description: Follow-up created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead converted to follow-up successfully"
 *               data:
 *                 conversion:
 *                   type: "lead_to_follow_up"
 *                   lead_id: "lead-uuid"
 *                   lead_name: "Suresh Patel"
 *                   lead_status_updated_to: "follow_up"
 *                 task:
 *                   id: "task-uuid"
 *                   title: "Call back about 2BHK pricing"
 *                   due_date: "2026-05-10T11:00:00Z"
 *                   priority: "medium"
 *                   assigned_to: "user-uuid"
 *                   notes: "Client is interested in 2BHK"
 *                   lead_id: "lead-uuid"
 *       400:
 *         description: Validation error — missing required fields
 *       404:
 *         description: Lead not found
 */
router.post('/lead/:leadId/to-follow-up', authenticate, ctrl.convertLeadToFollowUp)

// ─────────────────────────────────────────────────────────────────────────────
// LEAD → Site Visit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/convert/lead/{leadId}/to-site-visit:
 *   post:
 *     summary: Convert a lead to a site visit
 *     description: >
 *       Creates a scheduled site visit for the lead and updates the lead status
 *       to "site_visit_scheduled". Also updates the lead's project_id if provided.
 *       An activity log entry is added. Cannot be used on leads with status
 *       "booked" or "lost".
 *     tags: [Conversions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [project_id, visit_date, visit_time]
 *             properties:
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               visit_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-05-12"
 *               visit_time:
 *                 type: string
 *                 example: "10:30"
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: Defaults to the lead's currently assigned user
 *               transport_arranged:
 *                 type: boolean
 *                 default: false
 *               notes:
 *                 type: string
 *                 example: "Client bringing family of 4"
 *     responses:
 *       201:
 *         description: Site visit created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead converted to site visit successfully"
 *               data:
 *                 conversion:
 *                   type: "lead_to_site_visit"
 *                   lead_id: "lead-uuid"
 *                   lead_name: "Suresh Patel"
 *                   lead_status_updated_to: "site_visit_scheduled"
 *                 site_visit:
 *                   id: "sv-uuid"
 *                   project_name: "Skyline Heights"
 *                   visit_date: "2026-05-12"
 *                   visit_time: "10:30:00"
 *                   status: "scheduled"
 *                   transport_arranged: false
 *       400:
 *         description: Validation error — missing required fields
 *       404:
 *         description: Lead or project not found
 *       422:
 *         description: Lead status prevents site visit (booked or lost)
 */
router.post('/lead/:leadId/to-site-visit', authenticate, ctrl.convertLeadToSiteVisit)

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UP → options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/convert/follow-up/{taskId}/options:
 *   get:
 *     summary: Get conversion options & field schema for a follow-up
 *     description: >
 *       Returns the field schema for "Convert to Site Visit" modal, plus
 *       the follow-up's current data and pre-fill defaults.
 *     tags: [Conversions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Options returned
 *       404:
 *         description: Follow-up not found
 */
router.get('/follow-up/:taskId/options', authenticate, ctrl.getFollowUpConversionOptions)

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UP → Site Visit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/convert/follow-up/{taskId}/to-site-visit:
 *   post:
 *     summary: Convert a follow-up to a site visit
 *     description: >
 *       Marks the follow-up task as completed and creates a site visit for the
 *       same lead. If the lead status is upgradeable (new / contacted / interested
 *       / follow_up), it is updated to "site_visit_scheduled". An activity log
 *       entry is added. The follow-up must be linked to a lead and must not
 *       already be completed.
 *     tags: [Conversions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [project_id, visit_date, visit_time]
 *             properties:
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               visit_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-05-12"
 *               visit_time:
 *                 type: string
 *                 example: "10:30"
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *               transport_arranged:
 *                 type: boolean
 *                 default: false
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Site visit created, follow-up marked completed
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Follow-up converted to site visit successfully"
 *               data:
 *                 conversion:
 *                   type: "follow_up_to_site_visit"
 *                   task_id: "task-uuid"
 *                   task_title: "Call back about 2BHK"
 *                   task_completed: true
 *                   lead_id: "lead-uuid"
 *                   lead_name: "Suresh Patel"
 *                   lead_status_updated_to: "site_visit_scheduled"
 *                 site_visit:
 *                   id: "sv-uuid"
 *                   project_name: "Skyline Heights"
 *                   visit_date: "2026-05-12"
 *                   visit_time: "10:30:00"
 *                   status: "scheduled"
 *       400:
 *         description: Validation error
 *       404:
 *         description: Follow-up or project not found
 *       422:
 *         description: Follow-up has no linked lead, or is already completed
 */
router.post('/follow-up/:taskId/to-site-visit', authenticate, ctrl.convertFollowUpToSiteVisit)

module.exports = router
