const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/closureController');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadClosureDocFile } = require('../middleware/uploadMiddleware');

const ADMIN   = ['super_admin', 'admin'];
const MANAGER = ['super_admin', 'admin', 'sales_manager'];

/**
 * @swagger
 * tags:
 *   name: Lead Closures
 *   description: Booking and closure management — created when a lead converts to a customer
 */

/**
 * @swagger
 * /api/v1/closures/summary:
 *   get:
 *     summary: Closure analytics summary (Admin/Manager)
 *     description: >
 *       Aggregated stats — total closures, deal value, commission earned,
 *       commission pending, and top performers. Scoped by role.
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *         example: "2026-05-01"
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *         example: "2026-05-31"
 *       - in: query
 *         name: project_id
 *         schema: { type: string }
 *         description: Project UUID or project name
 *     responses:
 *       200:
 *         description: Summary stats
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 total_closures: 8
 *                 total_deal_value: "64000000.00"
 *                 total_commission: "1280000.00"
 *                 commission_paid: "960000.00"
 *                 commission_pending: "320000.00"
 *                 avg_deal_value: "8000000.00"
 *                 projects_count: 3
 *                 closures_by_executives: 4
 *                 top_performers:
 *                   - exec_name: "Rahul Sharma"
 *                     closures: 3
 *                     total_value: "24000000.00"
 *                     total_commission: "480000.00"
 *                 period:
 *                   from: "2026-05-01"
 *                   to: "2026-05-31"
 */
router.get('/summary', authenticate, authorize(...MANAGER), ctrl.getClosureSummary);

/**
 * @swagger
 * /api/v1/closures/lead/{leadId}:
 *   get:
 *     summary: Get closure record for a specific lead
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Closure record
 *       404:
 *         description: No closure found for this lead
 */
router.get('/lead/:leadId', authenticate, ctrl.getClosureByLead);

/**
 * @swagger
 * /api/v1/closures:
 *   get:
 *     summary: List all closures (paginated, filterable)
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [confirmed, cancelled, on_hold] }
 *       - in: query
 *         name: project_id
 *         schema: { type: string }
 *         description: Project UUID or project name
 *       - in: query
 *         name: closed_by
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: commission_paid
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *         example: "2026-05-01"
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *         example: "2026-05-31"
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Closures list
 *         content:
 *           application/json:
 *             example:
 *               data:
 *                 - id: "closure-uuid-001"
 *                   lead_name: "Suresh Patel"
 *                   project_name: "Skyline Heights"
 *                   booking_date: "2026-05-20"
 *                   unit_number: "B-1204"
 *                   unit_type: "3BHK"
 *                   agreed_price: "9500000.00"
 *                   commission_amount: "190000.00"
 *                   commission_paid: false
 *                   status: "confirmed"
 *                   closed_by_name: "Rahul Sharma"
 *               pagination:
 *                 total: 8
 *                 page: 1
 *                 per_page: 20
 */
router.get('/', authenticate, ctrl.getAllClosures);

/**
 * @swagger
 * /api/v1/closures:
 *   post:
 *     summary: Create a closure (book a lead)
 *     description: >
 *       Creates a booking record when a lead converts to a customer.
 *       Automatically updates the lead status to booked.
 *       Only one closure per lead is allowed — use PUT to update an existing one.
 *       commission_amount is auto-calculated from commission_percent × agreed_price
 *       if amount is not provided directly.
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lead_id, booking_date]
 *             properties:
 *               lead_id:
 *                 type: string
 *                 format: uuid
 *                 description: The lead being booked (required)
 *               project_id:
 *                 type: string
 *                 description: Override project. Defaults to lead's assigned project (accepts project UUID or name)
 *               booking_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-05-20"
 *               unit_number:
 *                 type: string
 *                 example: "B-1204"
 *               tower_block:
 *                 type: string
 *                 example: "Tower B"
 *               floor_number:
 *                 type: integer
 *                 example: 12
 *               unit_type:
 *                 type: string
 *                 example: "3BHK"
 *               carpet_area_sqft:
 *                 type: number
 *                 example: 1250
 *               super_area_sqft:
 *                 type: number
 *                 example: 1650
 *               closure_notes:
 *                 type: string
 *                 example: "Client opted for construction linked plan. Home loan through HDFC."
 *               agreed_price:
 *                 type: number
 *                 example: 9500000
 *               booking_amount:
 *                 type: number
 *                 example: 500000
 *               payment_plan:
 *                 type: string
 *                 example: "Construction Linked Plan"
 *               loan_required:
 *                 type: boolean
 *                 default: false
 *               loan_bank:
 *                 type: string
 *                 example: "HDFC Bank"
 *               commission_percent:
 *                 type: number
 *                 description: Auto-calculates commission_amount = agreed_price × percent / 100
 *                 example: 2
 *               commission_amount:
 *                 type: number
 *                 description: Manual override. Leave blank if using commission_percent
 *               closed_by_manager:
 *                 type: array
 *                 description: Array of manager UUIDs who supervised this closure. Use GET /api/v1/closures/managers to get valid UUIDs.
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 example: ["manager-uuid-001", "manager-uuid-002"]
 *               commission_paid:
 *                 type: boolean
 *                 default: false
 *               commission_paid_date:
 *                 type: string
 *                 format: date
 *               site_visit_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional link to site visit that led to this booking
 *               documents:
 *                 type: array
 *                 description: >
 *                   Optional. Cost sheet and/or payment proof — get the url from
 *                   POST /api/v1/closures/upload-document first, then pass it here.
 *                   Accepts images (JPEG/PNG/WEBP) or PDF.
 *                 items:
 *                   type: object
 *                   required: [url, document_type]
 *                   properties:
 *                     url:
 *                       type: string
 *                       description: File url returned from upload-document endpoint
 *                       example: "/uploads/closures/documents/closure_doc_costsheet_123.pdf"
 *                     document_type:
 *                       type: string
 *                       enum: [cost_sheet, payment_proof]
 *                       example: "cost_sheet"
 *                     name:
 *                       type: string
 *                       description: Label for this document
 *                       example: "Cost Sheet - Tower B"
 *           example:
 *             lead_id: "lead-uuid-001"
 *             project_id: "proj-uuid-001"
 *             site_visit_id: "sv-uuid-001"
 *             booking_date: "2026-05-20"
 *             unit_number: "B-1204"
 *             tower_block: "Tower B"
 *             floor_number: 12
 *             unit_type: "3BHK"
 *             carpet_area_sqft: 1250
 *             super_area_sqft: 1650
 *             closure_notes: "Client opted for construction linked plan. Home loan through HDFC."
 *             agreed_price: 9500000
 *             booking_amount: 500000
 *             payment_plan: "Construction Linked Plan"
 *             loan_required: true
 *             loan_bank: "HDFC Bank"
 *             commission_percent: 2
 *             commission_paid: false
 *             closed_by_manager:
 *               - "manager-uuid-001"
 *               - "manager-uuid-002"
 *             documents:
 *               - url: "/uploads/closures/documents/closure_doc_costsheet_123.pdf"
 *                 document_type: "cost_sheet"
 *                 name: "Cost Sheet - Tower B"
 *     responses:
 *       201:
 *         description: Lead closed/booked successfully. Response includes managers array for Reporting Manager dropdown.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead closed/booked successfully"
 *               data:
 *                 closure:
 *                   id: "closure-uuid-001"
 *                   lead_id: "lead-uuid-001"
 *                   project_id: "proj-uuid-001"
 *                   site_visit_id: "sv-uuid-001"
 *                   booking_date: "2026-05-20"
 *                   unit_number: "B-1204"
 *                   tower_block: "Tower B"
 *                   floor_number: 12
 *                   unit_type: "3BHK"
 *                   carpet_area_sqft: "1250.00"
 *                   super_area_sqft: "1650.00"
 *                   agreed_price: "9500000.00"
 *                   booking_amount: "500000.00"
 *                   payment_plan: "Construction Linked Plan"
 *                   loan_required: true
 *                   loan_bank: "HDFC Bank"
 *                   commission_percent: "2.00"
 *                   commission_amount: "190000.00"
 *                   commission_paid: false
 *                   commission_paid_date: null
 *                   closed_by: "user-uuid-001"
 *                   closed_by_manager:
 *                     - id: "manager-uuid-001"
 *                       name: "Rahul Sharma"
 *                       role: "sales_manager"
 *                     - id: "manager-uuid-002"
 *                       name: "Priya Mehta"
 *                       role: "sales_manager"
 *                   closure_notes: "Client opted for construction linked plan. Home loan through HDFC."
 *                   status: "confirmed"
 *                   created_at: "2026-05-20T10:00:00Z"
 *                 documents:
 *                   - id: "doc-uuid-001"
 *                     closure_id: "closure-uuid-001"
 *                     document_type: "cost_sheet"
 *                     url: "/uploads/closures/documents/closure_doc_costsheet_123.pdf"
 *                     name: "Cost Sheet - Tower B"
 *                     created_at: "2026-05-20T10:00:00Z"
 *                 managers:
 *                   - id: "manager-uuid-001"
 *                     name: "Rahul Sharma"
 *                     role: "sales_manager"
 *                   - id: "manager-uuid-002"
 *                     name: "Priya Mehta"
 *                     role: "sales_manager"
 *                   - id: "admin-uuid-001"
 *                     name: "Super Admin"
 *                     role: "super_admin"
 *       400:
 *         description: Missing required fields or closure already exists for this lead
 *       404:
 *         description: Lead not found
 */
/**
 * @swagger
 * /api/v1/closures/managers:
 *   get:
 *     summary: Get list of managers for Reporting Manager dropdown
 *     description: >
 *       Returns all active users with role sales_manager, admin, or super_admin.
 *       Use this to populate the Reporting Manager dropdown on the Create/Edit Closure form.
 *       Ordered by first name A–Z.
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of managers
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "manager-uuid-001"
 *                   name: "Priya Mehta"
 *                   role: "sales_manager"
 *                 - id: "manager-uuid-002"
 *                   name: "Rahul Sharma"
 *                   role: "sales_manager"
 *                 - id: "admin-uuid-001"
 *                   name: "Super Admin"
 *                   role: "super_admin"
 */
router.get('/managers', authenticate, ctrl.getManagers);

router.post('/', authenticate, ctrl.createClosure);

/**
 * @swagger
 * /api/v1/closures/upload-document:
 *   post:
 *     summary: Upload a closure document (cost sheet / payment proof) — returns url to use in closure body
 *     description: >
 *       Full URL: POST https://api.nextonerealty.in/api/v1/closures/upload-document
 *
 *       Step 1 of the 2-step document flow (same pattern as lead payment proof / photos).
 *       Upload a file here first — the API returns a url.
 *       Then pass that url inside the documents array when creating or updating a closure,
 *       or attach it directly via POST /api/v1/closures/{id}/documents.
 *       Supported formats: PDF, JPEG, PNG, WEBP. Max 10 MB.
 *       Field name must be document.
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document]
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: Cost sheet / payment proof — PDF, JPEG, PNG, or WEBP, max 10 MB
 *     responses:
 *       201:
 *         description: File uploaded — use the returned url in documents
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "File uploaded successfully"
 *               data:
 *                 url: "/uploads/closures/documents/closure_doc_costsheet_1234567890.pdf"
 *                 filename: "cost_sheet.pdf"
 *                 size: 204800
 *       400:
 *         description: No file uploaded, or unsupported file type
 */
router.post('/upload-document', authenticate, uploadClosureDocFile, ctrl.uploadDocumentFile);

/**
 * @swagger
 * /api/v1/closures/{id}/documents:
 *   post:
 *     summary: Add a document (cost sheet / payment proof) to a closure
 *     description: >
 *       Two modes supported (same pattern as lead payment proof / photos):
 *
 *       **Mode 1 — File Upload** (multipart/form-data):
 *       Upload a file directly. Field name must be `document`.
 *       `document_type` is required as a form field (cost_sheet or payment_proof).
 *       Optionally include `name`. Supported formats: PDF, JPEG, PNG, WEBP. Max 10 MB.
 *
 *       **Mode 2 — JSON URL Array** (application/json):
 *       Pass `documents` as an array (or single object) of documents that already
 *       exist at a URL (e.g. from POST /api/v1/closures/upload-document).
 *       Each item must have a `url` and `document_type`. `name` is optional.
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document, document_type]
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: Cost sheet / payment proof (PDF, JPEG, PNG, WEBP, max 10 MB)
 *               document_type:
 *                 type: string
 *                 enum: [cost_sheet, payment_proof]
 *               name:
 *                 type: string
 *                 example: "Cost Sheet - Tower B"
 *         application/json:
 *           schema:
 *             type: object
 *             required: [documents]
 *             properties:
 *               documents:
 *                 description: Single object or array of documents
 *                 oneOf:
 *                   - type: array
 *                     items:
 *                       type: object
 *                       required: [url, document_type]
 *                       properties:
 *                         url: { type: string, example: "/uploads/closures/documents/closure_doc_costsheet_123.pdf" }
 *                         document_type: { type: string, enum: [cost_sheet, payment_proof] }
 *                         name: { type: string, example: "Cost Sheet - Tower B" }
 *                   - type: object
 *                     required: [url, document_type]
 *                     properties:
 *                       url: { type: string }
 *                       document_type: { type: string, enum: [cost_sheet, payment_proof] }
 *                       name: { type: string }
 *           example:
 *             documents:
 *               - url: "/uploads/closures/documents/closure_doc_costsheet_123.pdf"
 *                 document_type: "cost_sheet"
 *                 name: "Cost Sheet - Tower B"
 *     responses:
 *       201:
 *         description: Document(s) saved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "1 document(s) saved"
 *               data:
 *                 closure_id: "closure-uuid-001"
 *                 documents:
 *                   - id: "doc-uuid-001"
 *                     closure_id: "closure-uuid-001"
 *                     document_type: "cost_sheet"
 *                     url: "/uploads/closures/documents/closure_doc_costsheet_123.pdf"
 *                     name: "Cost Sheet - Tower B"
 *                     created_at: "2026-06-01T10:35:00Z"
 *       400:
 *         description: No file or documents provided
 *       404:
 *         description: Closure not found
 */
router.post('/:id/documents', authenticate, uploadClosureDocFile, ctrl.addClosureDocument);

/**
 * @swagger
 * /api/v1/closures/{id}/documents:
 *   get:
 *     summary: Get all documents for a closure
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Documents list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 closure_id: "closure-uuid-001"
 *                 total: 1
 *                 documents:
 *                   - id: "doc-uuid-001"
 *                     document_type: "cost_sheet"
 *                     url: "/uploads/closures/documents/closure_doc_costsheet_123.pdf"
 *                     name: "Cost Sheet - Tower B"
 *                     uploaded_by_name: "Rahul Sharma"
 *                     created_at: "2026-06-01T10:35:00Z"
 */
router.get('/:id/documents', authenticate, ctrl.getClosureDocuments);

/**
 * @swagger
 * /api/v1/closures/{id}/documents/{did}:
 *   patch:
 *     summary: Update a closure document's name
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: did
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Document ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: "Updated cost sheet label" }
 *     responses:
 *       200:
 *         description: Document updated
 *       404:
 *         description: Document not found
 */
router.patch('/:id/documents/:did', authenticate, ctrl.updateClosureDocument);

/**
 * @swagger
 * /api/v1/closures/{id}/documents/{did}:
 *   delete:
 *     summary: Delete a closure document
 *     description: Deletes the document record and removes the file from disk if it was uploaded locally.
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: did
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document deleted
 *       404:
 *         description: Document not found
 */
router.delete('/:id/documents/:did', authenticate, ctrl.deleteClosureDocument);

/**
 * @swagger
 * /api/v1/closures/{id}:
 *   get:
 *     summary: Get a closure by ID (full details + managers for edit form)
 *     description: >
 *       Returns full closure details with lead, project, unit and commission breakdown.
 *       Also returns a managers array containing all active sales_manager/admin/super_admin
 *       users — used to populate the Reporting Manager dropdown on the Edit Closure form.
 *     tags: [Lead Closures]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Full closure details with managers list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 id: "closure-uuid"
 *                 booking_date: "2026-06-10"
 *                 status: "confirmed"
 *                 unit:
 *                   unit_number: "B-1204"
 *                   tower_block: "Tower B"
 *                   floor_number: 12
 *                   unit_type: "3BHK"
 *                   carpet_area_sqft: "1250.00"
 *                   super_area_sqft: "1650.00"
 *                 financials:
 *                   agreed_price: "9500000.00"
 *                   booking_amount: "500000.00"
 *                   payment_plan: "Construction Linked Plan"
 *                   loan_required: true
 *                   loan_bank: "HDFC Bank"
 *                 commission:
 *                   amount: "190000.00"
 *                   percent: "2.00"
 *                   paid: false
 *                   paid_date: null
 *                 lead:
 *                   id: "lead-uuid"
 *                   name: "Rahul Patel"
 *                   phone: "9876543210"
 *                 project:
 *                   id: "proj-uuid"
 *                   name: "Skyline Heights"
 *                 closed_by:
 *                   id: "user-uuid"
 *                   name: "Suresh Shah"
 *                 closed_by_manager:
 *                   id: "manager-uuid"
 *                   name: "Priya Mehta"
 *                 closure_notes: "Client opted for CLP. Loan via HDFC."
 *                 managers:
 *                   - id: "manager-uuid-001"
 *                     name: "Priya Mehta"
 *                     role: "sales_manager"
 *                   - id: "admin-uuid-001"
 *                     name: "Super Admin"
 *                     role: "super_admin"
 *       404:
 *         description: Closure not found
 */
router.get('/:id', authenticate, ctrl.getClosureById);

/**
 * @swagger
 * /api/v1/closures/{id}:
 *   put:
 *     summary: Update closure details
 *     description: >
 *       Same fields as Create Closure — all optional on update (send only what changed).
 *       Matches the Edit Closure form exactly.
 *       commission_amount is auto-calculated from commission_percent × agreed_price
 *       if percent is sent but amount is not.
 *       Response includes managers array for the Reporting Manager dropdown.
 *     tags: [Lead Closures]
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
 *               project_id:
 *                 type: string
 *                 description: Override the project linked to this closure (accepts project UUID or name)
 *               site_visit_id:
 *                 type: string
 *                 format: uuid
 *               booking_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-10"
 *               unit_number:
 *                 type: string
 *                 example: "B-1204"
 *               tower_block:
 *                 type: string
 *                 example: "Tower B"
 *               floor_number:
 *                 type: integer
 *                 example: 12
 *               unit_type:
 *                 type: string
 *                 example: "3BHK"
 *               carpet_area_sqft:
 *                 type: number
 *                 example: 1250
 *               super_area_sqft:
 *                 type: number
 *                 example: 1650
 *               agreed_price:
 *                 type: number
 *                 example: 9500000
 *               booking_amount:
 *                 type: number
 *                 example: 500000
 *               payment_plan:
 *                 type: string
 *                 example: "Construction Linked Plan"
 *               loan_required:
 *                 type: boolean
 *                 example: true
 *               loan_bank:
 *                 type: string
 *                 example: "HDFC Bank"
 *               commission_percent:
 *                 type: number
 *                 description: Auto-calculates commission_amount from agreed_price
 *                 example: 2
 *               commission_amount:
 *                 type: number
 *                 description: Manual override. If omitted and commission_percent given, auto-calculated
 *               commission_paid:
 *                 type: boolean
 *                 example: false
 *               commission_paid_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-01"
 *               closed_by_manager:
 *                 type: array
 *                 description: Array of manager UUIDs. Pass empty array [] to clear.
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 example: ["manager-uuid-001", "manager-uuid-002"]
 *               closure_notes:
 *                 type: string
 *                 example: "Client opted for construction linked plan. Home loan through HDFC."
 *               documents:
 *                 type: array
 *                 description: >
 *                   Optional. Adds MORE cost sheet / payment proof documents (does not
 *                   replace existing ones). Get the url from
 *                   POST /api/v1/closures/upload-document first, then pass it here.
 *                 items:
 *                   type: object
 *                   required: [url, document_type]
 *                   properties:
 *                     url: { type: string, example: "/uploads/closures/documents/closure_doc_costsheet_123.pdf" }
 *                     document_type: { type: string, enum: [cost_sheet, payment_proof] }
 *                     name: { type: string, example: "Cost Sheet - Tower B" }
 *           example:
 *             project_id: "proj-uuid-001"
 *             site_visit_id: "sv-uuid-001"
 *             booking_date: "2026-05-20"
 *             unit_number: "B-1204"
 *             tower_block: "Tower B"
 *             floor_number: 12
 *             unit_type: "3BHK"
 *             carpet_area_sqft: 1250
 *             super_area_sqft: 1650
 *             closure_notes: "Client opted for construction linked plan. Home loan through HDFC."
 *             agreed_price: 9500000
 *             booking_amount: 500000
 *             payment_plan: "Construction Linked Plan"
 *             loan_required: true
 *             loan_bank: "HDFC Bank"
 *             commission_percent: 2
 *             commission_paid: false
 *             closed_by_manager:
 *               - "manager-uuid-001"
 *               - "manager-uuid-002"
 *             documents:
 *               - url: "/uploads/closures/documents/closure_doc_paymentproof_456.jpg"
 *                 document_type: "payment_proof"
 *                 name: "Booking payment screenshot"
 *     responses:
 *       200:
 *         description: Closure updated with managers list for dropdown
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Closure updated"
 *               data:
 *                 closure:
 *                   id: "closure-uuid"
 *                   booking_date: "2026-06-10"
 *                   unit_number: "B-1204"
 *                   unit_type: "3BHK"
 *                   agreed_price: "9500000.00"
 *                   commission_amount: "190000.00"
 *                   commission_paid: false
 *                   closure_notes: "Client opted for construction linked plan."
 *                 managers:
 *                   - id: "manager-uuid-001"
 *                     name: "Rahul Sharma"
 *                     role: "sales_manager"
 *                   - id: "admin-uuid-001"
 *                     name: "Super Admin"
 *                     role: "super_admin"
 *       404:
 *         description: Closure not found
 */
router.put('/:id', authenticate, ctrl.updateClosure);

/**
 * @swagger
 * /api/v1/closures/{id}/status:
 *   patch:
 *     summary: Update closure status (Admin/Manager)
 *     description: >
 *       confirmed → on_hold or cancelled.
 *       If cancelled, the lead status is reverted to negotiation.
 *     tags: [Lead Closures]
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
 *                 enum: [confirmed, cancelled, on_hold]
 *               note:
 *                 type: string
 *                 description: Reason for the status change
 *           example:
 *             status: "cancelled"
 *             note: "Client cancelled due to financial constraints"
 *     responses:
 *       200:
 *         description: Closure status updated
 *       400:
 *         description: Invalid status
 */
router.patch('/:id/status', authenticate, authorize(...MANAGER), ctrl.updateClosureStatus);

module.exports = router;