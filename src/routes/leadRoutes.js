const express = require("express");
const router = express.Router();
const leadController = require("../controllers/leadController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Lead Management
 *   description: >
 *     Full lead lifecycle management — create, assign, track status,
 *     log activities, and manage notes. Sales Executives handle their
 *     own leads; Managers see their team's leads; Admins see all.
 */

/**
 * @swagger
 * /api/v1/leads:
 *   get:
 *     summary: List all leads with filters
 *     description: >
 *       Returns a paginated list of leads. Visibility is role-based:
 *       Super Admin / Admin see all leads, Sales Manager sees their team's leads,
 *       Sales Executive sees only their assigned leads.
 *       Supports filtering by status, source, assigned user, project, and date range.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [new, contacted, interested, follow_up, site_visit_scheduled, site_visit_done, negotiation, booked, lost]
 *         example: interested
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *         description: Lead source (e.g. Facebook, Walk-in, Referral)
 *         example: Facebook
 *       - in: query
 *         name: assigned_to
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by assigned sales executive ID
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter leads mapped to a specific project
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
 *         description: Search by lead name, email, or phone
 *         example: rahul
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
 *         description: Leads list returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "lead-uuid-001"
 *                   name: "Suresh Patel"
 *                   phone: "+919876543210"
 *                   email: "suresh.patel@gmail.com"
 *                   status: "interested"
 *                   source: "Facebook"
 *                   project_id: "proj-uuid-001"
 *                   assigned_to: "user-uuid-001"
 *                   assigned_name: "Rahul Sharma"
 *                   created_at: "2025-04-10T09:00:00Z"
 *               pagination:
 *                 total: 120
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 6
 */
router.get("/", authenticate, leadController.getAllLeads);

/**
 * @swagger
 * /api/v1/leads:
 *   post:
 *     summary: Create a new lead
 *     description: >
 *       Creates a new lead in the system. The lead can be assigned immediately
 *       to a sales executive or left unassigned for the manager to assign later.
 *       Status defaults to 'new' on creation.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Suresh Patel"
 *               phone:
 *                 type: string
 *                 example: "+919876543210"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "suresh.patel@gmail.com"
 *               source:
 *                 type: string
 *                 example: "Facebook"
 *                 description: Where the lead came from
 *               project_id:
 *                 type: string
 *                 format: uuid
 *                 example: "proj-uuid-001"
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 example: "user-uuid-001"
 *                 description: Sales Executive to assign this lead to
 *               budget:
 *                 type: string
 *                 example: "80-100L"
 *               location_preference:
 *                 type: string
 *                 example: "Andheri West"
 *               notes:
 *                 type: string
 *                 example: "Interested in 2BHK, wants sea view"
 *           example:
 *             name: "Suresh Patel"
 *             phone: "+919876543210"
 *             email: "suresh.patel@gmail.com"
 *             source: "Facebook"
 *             project_id: "proj-uuid-001"
 *             assigned_to: "user-uuid-001"
 *             budget: "80-100L"
 *             location_preference: "Andheri West"
 *             notes: "Interested in 2BHK, wants sea view"
 *     responses:
 *       201:
 *         description: Lead created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead created successfully"
 *               data:
 *                 id: "lead-uuid-001"
 *                 name: "Suresh Patel"
 *                 status: "new"
 *                 created_at: "2025-04-20T10:00:00Z"
 *       400:
 *         description: Validation error
 */
router.post("/", authenticate, leadController.createLead);

/**
 * @swagger
 * /api/v1/leads/{id}:
 *   get:
 *     summary: Get lead details by ID
 *     description: >
 *       Returns full lead details including assigned user, linked project,
 *       and latest activity. Sales Executive can only view their own leads.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "lead-uuid-001"
 *     responses:
 *       200:
 *         description: Lead details returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 id: "lead-uuid-001"
 *                 name: "Suresh Patel"
 *                 phone: "+919876543210"
 *                 email: "suresh.patel@gmail.com"
 *                 status: "interested"
 *                 source: "Facebook"
 *                 budget: "80-100L"
 *                 location_preference: "Andheri West"
 *                 assigned_to:
 *                   id: "user-uuid-001"
 *                   full_name: "Rahul Sharma"
 *                 project:
 *                   id: "proj-uuid-001"
 *                   name: "Skyline Heights"
 *                 created_at: "2025-04-10T09:00:00Z"
 *       404:
 *         description: Lead not found
 *       403:
 *         description: Access denied
 */
router.get("/:id", authenticate, leadController.getLeadById);

/**
 * @swagger
 * /api/v1/leads/{id}:
 *   put:
 *     summary: Update lead information
 *     description: >
 *       Updates lead details such as name, contact info, budget, or project mapping.
 *       Does NOT change status or assignment — use the dedicated endpoints for those.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "lead-uuid-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               source:
 *                 type: string
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               budget:
 *                 type: string
 *               location_preference:
 *                 type: string
 *           example:
 *             phone: "+919876543999"
 *             budget: "1Cr+"
 *             location_preference: "Bandra"
 *     responses:
 *       200:
 *         description: Lead updated successfully
 *       404:
 *         description: Lead not found
 */
router.put("/:id", authenticate, leadController.updateLead);

/**
 * @swagger
 * /api/v1/leads/{id}:
 *   delete:
 *     summary: Delete / archive a lead
 *     description: >
 *       Soft-deletes a lead by marking it as archived. The lead is retained
 *       in the database for historical reporting. Only Admin and Super Admin
 *       can delete leads.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "lead-uuid-001"
 *     responses:
 *       200:
 *         description: Lead archived successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Lead not found
 */
router.delete("/:id", authenticate, authorize("super_admin", "admin"), leadController.deleteLead);

/**
 * @swagger
 * /api/v1/leads/{id}/status:
 *   patch:
 *     summary: Update lead lifecycle status
 *     description: >
 *       Transitions a lead to a new status in the lifecycle.
 *       Every status change is automatically recorded in the activity log.
 *       Valid statuses: new → contacted → interested → follow_up →
 *       site_visit_scheduled → site_visit_done → negotiation → booked / lost
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "lead-uuid-001"
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
 *                 enum: [new, contacted, interested, follow_up, site_visit_scheduled, site_visit_done, negotiation, booked, lost]
 *               note:
 *                 type: string
 *                 description: Optional note to attach with this status change
 *           example:
 *             status: "site_visit_scheduled"
 *             note: "Site visit booked for 25th April at 11am"
 *     responses:
 *       200:
 *         description: Status updated and activity logged
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead status updated to site_visit_scheduled"
 *               data:
 *                 id: "lead-uuid-001"
 *                 status: "site_visit_scheduled"
 *                 updated_at: "2025-04-20T11:00:00Z"
 *       400:
 *         description: Invalid status value
 */
router.patch("/:id/status", authenticate, leadController.updateLeadStatus);

/**
 * @swagger
 * /api/v1/leads/{id}/assign:
 *   patch:
 *     summary: Assign or reassign a lead to a team member
 *     description: >
 *       Assigns or reassigns a lead to a Sales Executive.
 *       Only Admin, Super Admin, and Sales Manager (for their own team) can assign leads.
 *       The assignment is logged in the activity history.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "lead-uuid-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assigned_to]
 *             properties:
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: User ID of the Sales Executive to assign
 *               note:
 *                 type: string
 *                 description: Optional reason for reassignment
 *           example:
 *             assigned_to: "user-uuid-002"
 *             note: "Reassigned due to territory change"
 *     responses:
 *       200:
 *         description: Lead assigned successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead assigned to Priya Mehta"
 *       403:
 *         description: Cannot assign to user outside your team
 *       404:
 *         description: Lead or user not found
 */
router.patch("/:id/assign", authenticate, authorize("super_admin", "admin", "sales_manager"), leadController.assignLead);

/**
 * @swagger
 * /api/v1/leads/{id}/activity:
 *   get:
 *     summary: Get full activity log for a lead
 *     description: >
 *       Returns the complete chronological activity history for a lead —
 *       including status changes, notes, assignments, calls, and site visits.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "lead-uuid-001"
 *     responses:
 *       200:
 *         description: Activity log returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "act-uuid-001"
 *                   type: "status_change"
 *                   note: "Status changed from new to contacted"
 *                   performed_by: "Rahul Sharma"
 *                   created_at: "2025-04-11T10:00:00Z"
 *                 - id: "act-uuid-002"
 *                   type: "note"
 *                   note: "Client interested in 2BHK"
 *                   performed_by: "Rahul Sharma"
 *                   created_at: "2025-04-12T15:30:00Z"
 */
router.get("/:id/activity", authenticate, leadController.getLeadActivity);

/**
 * @swagger
 * /api/v1/leads/{id}/activity:
 *   post:
 *     summary: Add a note or activity entry to a lead
 *     description: >
 *       Manually adds a note, call log, or any activity entry to the lead's history.
 *       Status changes are logged automatically — use this for manual notes and calls.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "lead-uuid-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, note]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [note, call, email, whatsapp, meeting]
 *                 example: "call"
 *               note:
 *                 type: string
 *                 example: "Called client, discussed 2BHK options. Will visit on weekend."
 *           example:
 *             type: "call"
 *             note: "Called client, discussed 2BHK options. Will visit on weekend."
 *     responses:
 *       201:
 *         description: Activity added successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Activity logged successfully"
 *               data:
 *                 id: "act-uuid-003"
 *                 type: "call"
 *                 note: "Called client, discussed 2BHK options."
 *                 created_at: "2025-04-20T11:30:00Z"
 */
router.post("/:id/activity", authenticate, leadController.addLeadActivity);

/**
 * @swagger
 * /api/v1/leads/sources:
 *   get:
 *     summary: Get list of all lead sources
 *     description: >
 *       Returns all distinct lead sources currently in the system.
 *       Used for populating source dropdown when creating or filtering leads.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Lead sources returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data: ["Facebook", "Instagram", "Walk-in", "Referral", "99acres", "MagicBricks", "Housing.com"]
 */
router.get("/sources", authenticate, leadController.getLeadSources);

module.exports = router;
