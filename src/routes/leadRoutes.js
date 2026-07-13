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
 *         description: Filter leads mapped to a specific project (accepts project UUID or name)
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
 *       Payment proof flow (2 steps):
 *       Step 1 - Upload file via POST /api/v1/upload/payment-proof to get a url
 *       (same upload endpoint used by the front-page form).
 *       Step 2 - Pass that url in the payment_proof array in this request body.
 *       Multiple proofs can be attached at create time. Omit payment_proof if none.
 *
 *       Photo flow (2 steps) — separate from payment proof, same pattern as call recordings:
 *       Step 1 - Upload file via POST /api/v1/leads/upload-photo to get a url.
 *       Step 2 - Pass that url in the photos array in this request body.
 *       Multiple photos can be attached at create time. Omit photos if none.
 *
 *       Status defaults to "new" on creation — pass status explicitly to start
 *       the lead further along the lifecycle (e.g. "booked" for an already-closed
 *       deal being backfilled). Must be one of the values from
 *       GET /api/v1/config/lead-statuses.
 *
 *       A single phone number can only be used on up to 3 leads (e.g. interested
 *       in multiple projects). The 4th attempt with the same phone is rejected.
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
 *               status:
 *                 type: string
 *                 description: >
 *                   Optional. Defaults to "new" if omitted. Set this to start the
 *                   lead at a later lifecycle stage (e.g. importing a lead that's
 *                   already booked). Must match a key from GET /api/v1/config/lead-statuses.
 *                 enum: [new, contacted, interested, follow_up, site_visit_scheduled, site_visit_done, negotiation, booked, lost]
 *                 example: "booked"
 *               project_id:
 *                 type: string
 *                 description: Project UUID or project name
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *               budget:
 *                 type: string
 *                 example: "80-100L"
 *               location_preference:
 *                 type: string
 *                 example: "Andheri West"
 *               configuration:
 *                 type: string
 *                 example: "2BHK"
 *                 description: Unit type the lead is interested in (e.g. 1BHK, 2BHK, 3BHK)
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
 *               payment_proof:
 *                 type: array
 *                 description: >
 *                   Optional. Get the url from POST /api/v1/upload/payment-proof first
 *                   (same upload endpoint the front-page form uses).
 *                   Pass null or omit entirely if no payment proof yet.
 *                 items:
 *                   type: object
 *                   required: [url]
 *                   properties:
 *                     url:
 *                       type: string
 *                       description: File url returned from POST /api/v1/upload/payment-proof
 *                       example: "/uploads/payment-proofs/payment_proof_receipt_123.jpg"
 *                     name:
 *                       type: string
 *                       description: Label for this proof
 *                       example: "Booking token receipt"
 *                     amount:
 *                       type: string
 *                       description: Amount shown on the proof
 *                       example: "50000"
 *               photos:
 *                 type: array
 *                 description: >
 *                   Optional. Separate from payment_proof — this is the front-page
 *                   form photo. Get the url from POST /api/v1/leads/upload-photo first.
 *                   Pass null or omit entirely if no photo yet.
 *                 items:
 *                   type: object
 *                   required: [url]
 *                   properties:
 *                     url:
 *                       type: string
 *                       description: File url returned from upload-photo endpoint
 *                       example: "/uploads/leads/photos/photo_lead-uuid_123.jpg"
 *                     name:
 *                       type: string
 *                       description: Label for this photo
 *                       example: "Customer photo"
 *           example:
 *             name: "Suresh Patel"
 *             phone: "+919876543210"
 *             alternate_phone_number: "+919876543211"
 *             email: "suresh.patel@gmail.com"
 *             source: "Facebook"
 *             status: "booked"
 *             project_id: "proj-uuid-001"
 *             assigned_to: "user-uuid-001"
 *             budget: "80-100L"
 *             location_preference: "Andheri West"
 *             configuration: "2BHK"
 *             notes: "Interested in 2BHK"
 *             callback_time: "2026-06-01T10:30:00Z"
 *             next_followup_time: "2026-06-03T11:00:00Z"
 *             call_recordings:
 *               - url: "/uploads/leads/voice/voice_abc123.webm"
 *                 phone_number: "+919876543210"
 *                 name: "First call - Suresh"
 *             payment_proof:
 *               - url: "/uploads/payment-proofs/payment_proof_receipt_123.jpg"
 *                 name: "Booking token receipt"
 *                 amount: "50000"
 *             photos:
 *               - url: "/uploads/leads/photos/photo_lead-uuid_123.jpg"
 *                 name: "Customer photo"
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
 *                 status: "booked"
 *                 callback_time: "2026-06-01T10:30:00Z"
 *                 next_followup_time: "2026-06-03T11:00:00Z"
 *                 call_recordings:
 *                   - id: "rec-uuid-001"
 *                     lead_id: "lead-uuid-001"
 *                     url: "/uploads/leads/voice/voice_abc123.webm"
 *                     phone_number: "+919876543210"
 *                     name: "First call - Suresh"
 *                     created_at: "2026-06-01T10:35:00Z"
 *                 payment_proofs:
 *                   - id: "proof-uuid-001"
 *                     lead_id: "lead-uuid-001"
 *                     url: "/uploads/payment-proofs/payment_proof_receipt_123.jpg"
 *                     name: "Booking token receipt"
 *                     amount: "50000"
 *                     created_at: "2026-06-01T10:35:00Z"
 *                 photos:
 *                   - id: "photo-uuid-001"
 *                     lead_id: "lead-uuid-001"
 *                     url: "/uploads/leads/photos/photo_lead-uuid_123.jpg"
 *                     name: "Customer photo"
 *                     created_at: "2026-06-01T10:35:00Z"
 *       400:
 *         description: name and phone are required, or invalid status
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
 *       If the phone number is changed, the same 3-leads-per-phone-number limit applies.
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
 *             description: Same fields as Create Lead — all optional on update (send only what changed)
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
 *                 description: Project UUID or project name
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: Reassign lead to a different user
 *               budget:
 *                 type: string
 *                 example: "80-100L"
 *               location_preference:
 *                 type: string
 *                 example: "Andheri West"
 *               configuration:
 *                 type: string
 *                 example: "2BHK"
 *                 description: Unit type the lead is interested in
 *               notes:
 *                 type: string
 *                 description: Saved as a lead_activity note entry
 *                 example: "Client now interested in 3BHK"
 *               callback_time:
 *                 type: string
 *                 format: date-time
 *                 description: Pass null to clear
 *                 example: "2026-06-01T10:30:00Z"
 *               next_followup_time:
 *                 type: string
 *                 format: date-time
 *                 description: Pass null to clear
 *                 example: "2026-06-03T11:00:00Z"
 *           example:
 *             name: "Suresh Patel"
 *             phone: "+919876543999"
 *             alternate_phone_number: "+919876543211"
 *             email: "suresh.patel@gmail.com"
 *             source: "Facebook"
 *             project_id: "proj-uuid-001"
 *             assigned_to: "user-uuid-001"
 *             budget: "1Cr+"
 *             location_preference: "Bandra"
 *             configuration: "3BHK"
 *             notes: "Client upgraded interest to 3BHK"
 *             callback_time: "2026-06-01T10:30:00Z"
 *             next_followup_time: "2026-06-03T11:00:00Z"
 *             call_recordings:
 *               - url: "/uploads/leads/voice/voice_abc123.webm"
 *                 phone_number: "+919876543210"
 *                 name: "First call - Suresh"
 *     responses:
 *       200:
 *         description: Lead updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead updated successfully"
 *               data:
 *                 id: "lead-uuid-001"
 *                 name: "Suresh Patel"
 *                 phone: "+919876543999"
 *                 configuration: "3BHK"
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
router.delete("/:id", authenticate, leadController.deleteLead);

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
 * /api/v1/leads/{id}/notes:
 *   get:
 *     summary: Get all notes for a lead
 *     description: >
 *       Returns only the "note" type entries from the lead's activity log
 *       (a filtered view of GET /:id/activity).
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
 *         description: Notes returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "act-uuid-002"
 *                   type: "note"
 *                   note: "Client interested in 2BHK"
 *                   performed_by: "Rahul Sharma"
 *                   created_at: "2025-04-12T15:30:00Z"
 *       404:
 *         description: Lead not found
 */
router.get("/:id/notes", authenticate, leadController.getLeadNotes);

/**
 * @swagger
 * /api/v1/leads/{id}/notes:
 *   post:
 *     summary: Add a note to a lead
 *     description: >
 *       Adds a note — stored in the same activity log as
 *       POST /:id/activity (type is always "note"), so it also shows up
 *       in GET /:id/activity.
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
 *             required: [note]
 *             properties:
 *               note:
 *                 type: string
 *                 example: "Client interested in 2BHK"
 *           example:
 *             note: "Client interested in 2BHK"
 *     responses:
 *       201:
 *         description: Note added successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Note added successfully"
 *               data:
 *                 id: "act-uuid-003"
 *                 type: "note"
 *                 note: "Client interested in 2BHK"
 *                 created_at: "2025-04-20T11:30:00Z"
 *       400:
 *         description: note is required
 *       404:
 *         description: Lead not found
 */
router.post("/:id/notes", authenticate, leadController.addLeadNote);

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
 *                 description: Project UUID or project name
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
 *       Sends an approved WhatsApp template message ('lead_project_details') to the
 *       lead's phone number via Meta's WhatsApp Cloud API — the same provider used
 *       for site visit confirmations/reminders (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID
 *       env vars). This is a templated transactional message, not free text — Meta
 *       requires pre-approved templates for business-initiated WhatsApp messages.
 *       An activity entry is logged on the lead regardless of send outcome.
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
 *                 description: Override project to share details for (defaults to lead's assigned project) (accepts project UUID or name)
 *           example:
 *             project_id: "proj-uuid-001"
 *     responses:
 *       200:
 *         description: WhatsApp message sent (or send failed — check whatsapp_sent) and activity logged
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Project details sent via WhatsApp and activity logged"
 *               data:
 *                 lead_id: "lead-uuid-001"
 *                 phone: "+919876543210"
 *                 project: "Skyline Heights"
 *                 whatsapp_sent: true
 *                 activity_logged: true
 *       400:
 *         description: Lead has no phone number on record
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
 *                 description: Project UUID or project name
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
 * /api/v1/leads/{id}/payment-proofs:
 *   post:
 *     summary: Add a payment proof to a lead
 *     description: >
 *       Two modes supported (same pattern as call recordings):
 *
 *       **Mode 1 — File Upload** (multipart/form-data):
 *       Upload a file directly. Field name must be `payment_proof`.
 *       Optionally include `name` and `amount` as form fields.
 *       Supported formats: PDF, JPEG, PNG, WEBP. Max 10 MB.
 *
 *       **Mode 2 — JSON URL Array** (application/json):
 *       Pass `payment_proof` as an array (or single object) of proofs
 *       that already exist at a URL (e.g. from POST /api/v1/upload/payment-proof).
 *       Each item must have a `url`. `name` and `amount` are optional.
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
 *             required: [payment_proof]
 *             properties:
 *               payment_proof:
 *                 type: string
 *                 format: binary
 *                 description: Receipt / screenshot / PDF (max 10 MB)
 *               name:
 *                 type: string
 *                 example: "Booking token receipt"
 *               amount:
 *                 type: string
 *                 example: "50000"
 *         application/json:
 *           schema:
 *             type: object
 *             required: [payment_proof]
 *             properties:
 *               payment_proof:
 *                 description: Single object or array of proofs
 *                 oneOf:
 *                   - type: array
 *                     items:
 *                       type: object
 *                       required: [url]
 *                       properties:
 *                         url:
 *                           type: string
 *                           example: "/uploads/payment-proofs/payment_proof_receipt_123.jpg"
 *                         name:
 *                           type: string
 *                           example: "Booking token receipt"
 *                         amount:
 *                           type: string
 *                           example: "50000"
 *                   - type: object
 *                     required: [url]
 *                     properties:
 *                       url:
 *                         type: string
 *                       name:
 *                         type: string
 *                       amount:
 *                         type: string
 *           example:
 *             payment_proof:
 *               - url: "/uploads/payment-proofs/payment_proof_receipt_123.jpg"
 *                 name: "Booking token receipt"
 *                 amount: "50000"
 *     responses:
 *       201:
 *         description: Payment proof(s) saved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "1 payment proof(s) saved"
 *               data:
 *                 lead_id: "lead-uuid-001"
 *                 payment_proofs:
 *                   - id: "proof-uuid-001"
 *                     lead_id: "lead-uuid-001"
 *                     url: "/uploads/payment-proofs/payment_proof_receipt_123.jpg"
 *                     name: "Booking token receipt"
 *                     amount: "50000"
 *                     created_at: "2026-06-01T10:35:00Z"
 *       400:
 *         description: No file or payment_proof provided
 *       403:
 *         description: Access denied
 *       404:
 *         description: Lead not found
 */
router.post(
  "/:id/payment-proofs",
  authenticate,
  require("../middleware/uploadMiddleware").uploadPaymentProofFile,
  leadController.addPaymentProof
);

/**
 * @swagger
 * /api/v1/leads/{id}/payment-proofs:
 *   get:
 *     summary: Get all payment proofs for a lead
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
 *         description: Payment proofs list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 lead_id: "lead-uuid-001"
 *                 total: 1
 *                 payment_proofs:
 *                   - id: "proof-uuid-001"
 *                     url: "/uploads/payment-proofs/payment_proof_receipt_123.jpg"
 *                     name: "Booking token receipt"
 *                     amount: "50000"
 *                     uploaded_by_name: "Rahul Sharma"
 *                     created_at: "2026-06-01T10:35:00Z"
 */
router.get("/:id/payment-proofs", authenticate, leadController.getPaymentProofs);

/**
 * @swagger
 * /api/v1/leads/{id}/payment-proofs/{pid}:
 *   patch:
 *     summary: Update a payment proof's name or amount
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
 *         name: pid
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payment proof ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Updated receipt label"
 *               amount:
 *                 type: string
 *                 example: "75000"
 *     responses:
 *       200:
 *         description: Payment proof updated
 *       404:
 *         description: Payment proof not found
 */
router.patch("/:id/payment-proofs/:pid", authenticate, leadController.updatePaymentProof);

/**
 * @swagger
 * /api/v1/leads/{id}/payment-proofs/{pid}:
 *   delete:
 *     summary: Delete a payment proof
 *     description: Deletes the payment proof record and removes the file from disk if it was uploaded locally.
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
 *         name: pid
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payment proof ID
 *     responses:
 *       200:
 *         description: Payment proof deleted
 *       404:
 *         description: Payment proof not found
 */
router.delete("/:id/payment-proofs/:pid", authenticate, leadController.deletePaymentProof);

/**
 * @swagger
 * /api/v1/leads/upload-photo:
 *   post:
 *     summary: Upload a lead photo — returns url to use in lead body
 *     description: >
 *       Step 1 of the 2-step photo flow (same pattern as call recordings).
 *       This is separate from payment proof — use this only for the front-page
 *       form photo. Upload a file here first — the API returns a url.
 *       Then pass that url inside the photos array when creating or updating a lead,
 *       or attach it directly via POST /api/v1/leads/{id}/photos.
 *       Supported formats: JPEG, PNG, WEBP. Max 10 MB.
 *       Field name must be photo.
 *     tags: [Lead Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [photo]
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: JPEG, PNG, or WEBP image, max 10 MB
 *     responses:
 *       201:
 *         description: File uploaded — use the returned url in photos
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "File uploaded successfully"
 *               data:
 *                 url: "/uploads/leads/photos/photo_lead-uuid_1234567890.jpg"
 *                 filename: "customer.jpg"
 *                 size: 204800
 *       400:
 *         description: No file uploaded, or unsupported file type
 */
router.post(
  "/upload-photo",
  authenticate,
  require("../middleware/uploadMiddleware").uploadLeadPhotoFile,
  leadController.uploadPhotoFile
);

/**
 * @swagger
 * /api/v1/leads/{id}/photos:
 *   post:
 *     summary: Add a photo to a lead
 *     description: >
 *       Two modes supported (same pattern as call recordings):
 *
 *       **Mode 1 — File Upload** (multipart/form-data):
 *       Upload a file directly. Field name must be `photo`.
 *       Optionally include `name` as a form field.
 *       Supported formats: JPEG, PNG, WEBP. Max 10 MB.
 *
 *       **Mode 2 — JSON URL Array** (application/json):
 *       Pass `photos` as an array (or single object) of photos
 *       that already exist at a URL (e.g. from POST /api/v1/leads/upload-photo).
 *       Each item must have a `url`. `name` is optional.
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
 *             required: [photo]
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: JPEG, PNG, or WEBP image (max 10 MB)
 *               name:
 *                 type: string
 *                 example: "Customer photo"
 *         application/json:
 *           schema:
 *             type: object
 *             required: [photos]
 *             properties:
 *               photos:
 *                 description: Single object or array of photos
 *                 oneOf:
 *                   - type: array
 *                     items:
 *                       type: object
 *                       required: [url]
 *                       properties:
 *                         url:
 *                           type: string
 *                           example: "/uploads/leads/photos/photo_lead-uuid_123.jpg"
 *                         name:
 *                           type: string
 *                           example: "Customer photo"
 *                   - type: object
 *                     required: [url]
 *                     properties:
 *                       url:
 *                         type: string
 *                       name:
 *                         type: string
 *           example:
 *             photos:
 *               - url: "/uploads/leads/photos/photo_lead-uuid_123.jpg"
 *                 name: "Customer photo"
 *     responses:
 *       201:
 *         description: Photo(s) saved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "1 photo(s) saved"
 *               data:
 *                 lead_id: "lead-uuid-001"
 *                 photos:
 *                   - id: "photo-uuid-001"
 *                     lead_id: "lead-uuid-001"
 *                     url: "/uploads/leads/photos/photo_lead-uuid_123.jpg"
 *                     name: "Customer photo"
 *                     created_at: "2026-06-01T10:35:00Z"
 *       400:
 *         description: No file or photos provided
 *       403:
 *         description: Access denied
 *       404:
 *         description: Lead not found
 */
router.post(
  "/:id/photos",
  authenticate,
  require("../middleware/uploadMiddleware").uploadLeadPhotoFile,
  leadController.addPhoto
);

/**
 * @swagger
 * /api/v1/leads/{id}/photos:
 *   get:
 *     summary: Get all photos for a lead
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
 *         description: Photos list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 lead_id: "lead-uuid-001"
 *                 total: 1
 *                 photos:
 *                   - id: "photo-uuid-001"
 *                     url: "/uploads/leads/photos/photo_lead-uuid_123.jpg"
 *                     name: "Customer photo"
 *                     uploaded_by_name: "Rahul Sharma"
 *                     created_at: "2026-06-01T10:35:00Z"
 */
router.get("/:id/photos", authenticate, leadController.getPhotos);

/**
 * @swagger
 * /api/v1/leads/{id}/photos/{pid}:
 *   patch:
 *     summary: Update a photo's name
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
 *         name: pid
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Photo ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Updated photo label"
 *     responses:
 *       200:
 *         description: Photo updated
 *       404:
 *         description: Photo not found
 */
router.patch("/:id/photos/:pid", authenticate, leadController.updatePhoto);

/**
 * @swagger
 * /api/v1/leads/{id}/photos/{pid}:
 *   delete:
 *     summary: Delete a photo
 *     description: Deletes the photo record and removes the file from disk if it was uploaded locally.
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
 *         name: pid
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Photo ID
 *     responses:
 *       200:
 *         description: Photo deleted
 *       404:
 *         description: Photo not found
 */
router.delete("/:id/photos/:pid", authenticate, leadController.deletePhoto);



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
 *                 description: Override project to share details for (defaults to lead's assigned project) (accepts project UUID or name)
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