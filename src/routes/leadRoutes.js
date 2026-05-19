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
 *                   budget: "80-100L"
 *                   location_preference: "Andheri West"
 *                   callback_time: "2026-06-01T10:30:00Z"
 *                   next_followup_time: "2026-06-03T11:00:00Z"
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
 * /api/v1/leads/upload-recording:
 *   post:
 *     summary: Upload a call recording file — returns url to use in lead body
 *     description: >
 *       Step 1 of the 2-step recording flow.
 *       Upload an audio file here first — the API returns a url.
 *       Then pass that url inside call_recordings array when creating or updating a lead.
 *       Supported formats: mp3, wav, webm, ogg, aac, m4a. Max 25 MB.
 *       Field name must be voice_recording.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [voice_recording]
 *             properties:
 *               voice_recording:
 *                 type: string
 *                 format: binary
 *                 description: Audio file max 25 MB
 *     responses:
 *       201:
 *         description: File uploaded — use the returned url in call_recordings
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "File uploaded successfully"
 *               data:
 *                 url: "/uploads/leads/voice/voice_lead-uuid_1234567890.webm"
 *                 filename: "call_suresh_june1.webm"
 *                 size: 204800
 *       400:
 *         description: No file uploaded
 */
router.post(
  "/upload-recording",
  authenticate,
  require("../middleware/uploadMiddleware").uploadLeadVoice,
  leadController.uploadRecordingFile
);

/**
 * @swagger
 * /api/v1/leads:
 *   post:
 *     summary: Create a new lead
 *     description: >
 *       Creates a new lead. All fields are JSON — no file upload here.
 *
 *       Call recordings flow (2 steps):
 *       Step 1 - Upload file via POST /api/v1/leads/upload-recording to get a url.
 *       Step 2 - Pass that url in the call_recordings array in this request body.
 *       Multiple recordings can be attached at create time. Omit call_recordings if none.
 *
 *       Status defaults to new on creation.
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
 *               alternate_phone_number:
 *                 type: string
 *                 example: "+919876543211"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "suresh.patel@gmail.com"
 *               source:
 *                 type: string
 *                 example: "Facebook"
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *               budget:
 *                 type: string
 *                 example: "80-100L"
 *               location_preference:
 *                 type: string
 *                 example: "Andheri West"
 *               notes:
 *                 type: string
 *               callback_time:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-06-01T10:30:00Z"
 *               next_followup_time:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-06-03T11:00:00Z"
 *               call_recordings:
 *                 type: array
 *                 description: >
 *                   Optional. Get the url from POST /api/v1/leads/upload-recording first.
 *                   Pass null or omit entirely if no recordings.
 *                 items:
 *                   type: object
 *                   required: [url]
 *                   properties:
 *                     url:
 *                       type: string
 *                       description: File url returned from upload-recording endpoint
 *                       example: "/uploads/leads/voice/voice_abc123.webm"
 *                     phone_number:
 *                       type: string
 *                       description: Phone number of the person on the call
 *                       example: "+919876543210"
 *                     name:
 *                       type: string
 *                       description: Label for this recording
 *                       example: "First call - Suresh"
 *           example:
 *             name: "Suresh Patel"
 *             phone: "+919876543210"
 *             alternate_phone_number: "+919876543211"
 *             email: "suresh.patel@gmail.com"
 *             source: "Facebook"
 *             project_id: "proj-uuid-001"
 *             assigned_to: "user-uuid-001"
 *             budget: "80-100L"
 *             location_preference: "Andheri West"
 *             notes: "Interested in 2BHK"
 *             callback_time: "2026-06-01T10:30:00Z"
 *             next_followup_time: "2026-06-03T11:00:00Z"
 *             call_recordings:
 *               - url: "/uploads/leads/voice/voice_abc123.webm"
 *                 phone_number: "+919876543210"
 *                 name: "First call - Suresh"
 *     responses:
 *       201:
 *         description: Lead created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead created"
 *               data:
 *                 id: "lead-uuid-001"
 *                 name: "Suresh Patel"
 *                 status: "new"
 *                 callback_time: "2026-06-01T10:30:00Z"
 *                 next_followup_time: "2026-06-03T11:00:00Z"
 *                 call_recordings:
 *                   - id: "rec-uuid-001"
 *                     lead_id: "lead-uuid-001"
 *                     url: "/uploads/leads/voice/voice_abc123.webm"
 *                     phone_number: "+919876543210"
 *                     name: "First call - Suresh"
 *                     created_at: "2026-06-01T10:35:00Z"
 *       400:
 *         description: name and phone are required
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
 *                 callback_time: "2026-06-01T10:30:00Z"
 *                 next_followup_time: "2026-06-03T11:00:00Z"
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
 *               alternate_phone_number:
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
 *               callback_time:
 *                 type: string
 *                 format: date-time
 *                 description: Scheduled callback time (ISO 8601). Pass null to clear.
 *                 example: "2026-06-01T10:30:00Z"
 *               next_followup_time:
 *                 type: string
 *                 format: date-time
 *                 description: Scheduled next follow-up time (ISO 8601). Pass null to clear.
 *                 example: "2026-06-03T11:00:00Z"
 *           example:
 *             phone: "+919876543999"
 *             budget: "1Cr+"
 *             location_preference: "Bandra"
 *             callback_time: "2026-06-01T10:30:00Z"
 *             next_followup_time: "2026-06-03T11:00:00Z"
 *     responses:
 *       200:
 *         description: Lead updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead updated"
 *               data:
 *                 id: "lead-uuid-001"
 *                 callback_time: "2026-06-01T10:30:00Z"
 *                 next_followup_time: "2026-06-03T11:00:00Z"
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

/**
 * @swagger
 * /api/v1/leads/{id}/convert:
 *   patch:
 *     summary: Manually convert a lead to a booking
 *     description: >
 *       Marks a lead as converted (status = booked, is_converted = true).
 *       Use this for manual conversions. Automatic conversion also happens
 *       when status is set to "booked" via the status endpoint.
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               booking_amount:
 *                 type: string
 *                 example: "95L"
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               note:
 *                 type: string
 *                 example: "Booked 2BHK in Tower A"
 *     responses:
 *       200:
 *         description: Lead converted successfully
 *       400:
 *         description: Already converted
 *       404:
 *         description: Lead not found
 */
router.patch("/:id/convert", authenticate, authorize("super_admin", "admin", "sales_manager"), leadController.convertLead);

/**
 * @swagger
 * /api/v1/leads/{id}/send-whatsapp:
 *   post:
 *     summary: Send project details to lead via WhatsApp
 *     description: >
 *       Logs a WhatsApp activity on the lead with the project details message.
 *       If WHATSAPP_API_URL and WHATSAPP_API_TOKEN env vars are configured,
 *       also triggers an actual WhatsApp send to the lead's phone number.
 *       Activity is always logged regardless of external API availability.
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_id:
 *                 type: string
 *                 format: uuid
 *                 description: Override project to share details for (defaults to lead's assigned project)
 *               message:
 *                 type: string
 *                 description: Custom message override (auto-generated if omitted)
 *           example:
 *             project_id: "proj-uuid-001"
 *             message: "Hi! Here are the details for Skyline Heights you enquired about."
 *     responses:
 *       200:
 *         description: WhatsApp activity logged (and message sent if API is configured)
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "WhatsApp details sent and activity logged"
 *               data:
 *                 lead_id: "lead-uuid-001"
 *                 phone: "+919876543210"
 *                 whatsapp_sent: false
 *                 activity_logged: true
 *       403:
 *         description: Access denied
 *       404:
 *         description: Lead not found
 */
router.post("/:id/send-whatsapp", authenticate, leadController.sendLeadWhatsapp);

/**
 * @swagger
 * /api/v1/leads/{id}/send-email:
 *   post:
 *     summary: Send project details to lead via email
 *     description: >
 *       Sends a formatted project details email to the lead's registered email address
 *       and logs an email activity entry on the lead. The lead must have an email on record.
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email sent and activity logged
 *       400:
 *         description: Lead has no email address on record
 */
router.post("/:id/send-email", authenticate, leadController.sendLeadEmail);

/**
 * @swagger
 * /api/v1/leads/{id}/call-recordings:
 *   post:
 *     summary: Add a call recording to a lead
 *     description: >
 *       Two modes supported:
 *
 *       **Mode 1 — File Upload** (multipart/form-data):
 *       Upload an audio file directly. Field name must be `voice_recording`.
 *       Optionally include `phone_number` and `name` as form fields.
 *       Supported formats: webm, ogg, mp3, wav, aac, m4a. Max 25 MB.
 *
 *       **Mode 2 — JSON URL Array** (application/json):
 *       Pass `call_recording` as an array (or single object) of recordings
 *       that already exist at a URL (e.g. from a phone system or CRM).
 *       Each item must have a `url`. `phone_number` and `name` are optional.
 *       Multiple recordings can be added in one request.
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
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [voice_recording]
 *             properties:
 *               voice_recording:
 *                 type: string
 *                 format: binary
 *                 description: Audio file — webm, mp3, wav, ogg, aac (max 25 MB)
 *               phone_number:
 *                 type: string
 *                 example: "+919876543210"
 *               name:
 *                 type: string
 *                 example: "Call with Suresh - 1 June"
 *         application/json:
 *           schema:
 *             type: object
 *             required: [call_recording]
 *             properties:
 *               call_recording:
 *                 description: Single object or array of recordings
 *                 oneOf:
 *                   - type: array
 *                     items:
 *                       type: object
 *                       required: [url]
 *                       properties:
 *                         url:
 *                           type: string
 *                           example: "https://calls.example.com/rec_abc123.mp3"
 *                         phone_number:
 *                           type: string
 *                           example: "+919876543210"
 *                         name:
 *                           type: string
 *                           example: "Call with Suresh - 1 June"
 *                   - type: object
 *                     required: [url]
 *                     properties:
 *                       url:
 *                         type: string
 *                       phone_number:
 *                         type: string
 *                       name:
 *                         type: string
 *           example:
 *             call_recording:
 *               - url: "https://calls.example.com/rec_abc123.mp3"
 *                 phone_number: "+919876543210"
 *                 name: "Call with Suresh - 1 June"
 *               - url: "https://calls.example.com/rec_def456.mp3"
 *                 phone_number: "+919876543211"
 *                 name: "Follow-up call"
 *     responses:
 *       201:
 *         description: Recording(s) saved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "2 call recording(s) saved"
 *               data:
 *                 lead_id: "lead-uuid-001"
 *                 recordings:
 *                   - id: "rec-uuid-001"
 *                     lead_id: "lead-uuid-001"
 *                     url: "https://calls.example.com/rec_abc123.mp3"
 *                     phone_number: "+919876543210"
 *                     name: "Call with Suresh - 1 June"
 *                     uploaded_by_name: "Rahul Sharma"
 *                     created_at: "2026-06-01T10:35:00Z"
 *       400:
 *         description: No file or call_recording provided
 *       403:
 *         description: Access denied
 *       404:
 *         description: Lead not found
 */
router.post(
  "/:id/call-recordings",
  authenticate,
  require("../middleware/uploadMiddleware").uploadLeadVoice,
  leadController.addCallRecording
);

/**
 * @swagger
 * /api/v1/leads/{id}/call-recordings:
 *   get:
 *     summary: Get all call recordings for a lead
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
 *         description: Recordings list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 lead_id: "lead-uuid-001"
 *                 total: 2
 *                 recordings:
 *                   - id: "rec-uuid-001"
 *                     url: "https://calls.example.com/rec_abc123.mp3"
 *                     phone_number: "+919876543210"
 *                     name: "Call with Suresh - 1 June"
 *                     file_size: 204800
 *                     uploaded_by_name: "Rahul Sharma"
 *                     created_at: "2026-06-01T10:35:00Z"
 */
router.get("/:id/call-recordings", authenticate, leadController.getCallRecordings);

/**
 * @swagger
 * /api/v1/leads/{id}/call-recordings/{rid}:
 *   patch:
 *     summary: Update a recording's name or phone number
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
 *       - in: path
 *         name: rid
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Recording ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Updated call label"
 *               phone_number:
 *                 type: string
 *                 example: "+919876543210"
 *     responses:
 *       200:
 *         description: Recording updated
 *       404:
 *         description: Recording not found
 */
router.patch("/:id/call-recordings/:rid", authenticate, leadController.updateCallRecording);

/**
 * @swagger
 * /api/v1/leads/{id}/call-recordings/{rid}:
 *   delete:
 *     summary: Delete a call recording
 *     description: Deletes the recording record and removes the file from disk if it was uploaded locally.
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
 *       - in: path
 *         name: rid
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Recording ID
 *     responses:
 *       200:
 *         description: Recording deleted
 *       404:
 *         description: Recording not found
 */
router.delete("/:id/call-recordings/:rid", authenticate, leadController.deleteCallRecording);





/**
 * @swagger
 * /api/v1/leads/{id}/send-email:
 *   post:
 *     summary: Send project details to lead via email
 *     description: >
 *       Sends a formatted project details email to the lead's registered email address
 *       and logs an email activity entry on the lead. The lead must have an email on record.
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_id:
 *                 type: string
 *                 format: uuid
 *                 description: Override project to share details for (defaults to lead's assigned project)
 *               message:
 *                 type: string
 *                 description: Custom intro message in the email body
 *           example:
 *             project_id: "proj-uuid-001"
 *             message: "As discussed, please find the project details below."
 *     responses:
 *       200:
 *         description: Email sent and activity logged
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Project details emailed to lead and activity logged"
 *               data:
 *                 lead_id: "lead-uuid-001"
 *                 email_sent_to: "suresh.patel@gmail.com"
 *                 project: "Skyline Heights"
 *                 activity_logged: true
 *       400:
 *         description: Lead has no email address on record
 *       403:
 *         description: Access denied
 *       404:
 *         description: Lead not found
 */
router.post("/:id/send-email", authenticate, leadController.sendLeadEmail);



router.get("/sources", authenticate, leadController.getLeadSources);

module.exports = router;