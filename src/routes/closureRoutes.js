const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/closureController');
const { authenticate, authorize } = require('../middleware/auth');

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
 *         schema: { type: string, format: uuid }
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
 *         schema: { type: string, format: uuid }
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
 *                 description: The lead being closed/booked
 *               project_id:
 *                 type: string
 *                 format: uuid
 *                 description: Override project. Defaults to lead's assigned project
 *               site_visit_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional — link to the site visit that led to this booking
 *               booking_date:
 *                 type: string
 *                 format: date
 *                 description: Date of booking confirmation
 *                 example: "2026-05-20"
 *               unit_number:
 *                 type: string
 *                 description: Flat or unit number
 *                 example: "B-1204"
 *               tower_block:
 *                 type: string
 *                 example: "Tower B"
 *               floor_number:
 *                 type: integer
 *                 example: 12
 *               unit_type:
 *                 type: string
 *                 description: Configuration type
 *                 example: "3BHK"
 *               carpet_area_sqft:
 *                 type: number
 *                 example: 1250.00
 *               super_area_sqft:
 *                 type: number
 *                 example: 1650.00
 *               agreed_price:
 *                 type: number
 *                 description: Final negotiated sale price in INR
 *                 example: 9500000
 *               booking_amount:
 *                 type: number
 *                 description: Initial token/booking amount paid by client
 *                 example: 500000
 *               payment_plan:
 *                 type: string
 *                 description: Payment structure
 *                 example: "Construction Linked Plan"
 *               loan_required:
 *                 type: boolean
 *                 default: false
 *               loan_bank:
 *                 type: string
 *                 example: "HDFC Bank"
 *               commission_amount:
 *                 type: number
 *                 description: Commission in INR. Auto-calculated if commission_percent given
 *                 example: 190000
 *               commission_percent:
 *                 type: number
 *                 description: Commission as % of agreed_price. Used to auto-calculate amount
 *                 example: 2
 *               commission_paid:
 *                 type: boolean
 *                 default: false
 *               commission_paid_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-01"
 *               closed_by_manager:
 *                 type: string
 *                 format: uuid
 *                 description: Manager who supervised this closure
 *               closure_notes:
 *                 type: string
 *                 example: "Client opted for construction linked plan. Home loan through HDFC."
 *           example:
 *             lead_id: "lead-uuid-001"
 *             project_id: "proj-uuid-001"
 *             site_visit_id: "sv-uuid-001"
 *             booking_date: "2026-05-20"
 *             unit_number: "B-1204"
 *             tower_block: "Tower B"
 *             floor_number: 12
 *             unit_type: "3BHK"
 *             carpet_area_sqft: 1250.00
 *             super_area_sqft: 1650.00
 *             agreed_price: 9500000
 *             booking_amount: 500000
 *             payment_plan: "Construction Linked Plan"
 *             loan_required: true
 *             loan_bank: "HDFC Bank"
 *             commission_percent: 2
 *             commission_paid: false
 *             closed_by_manager: "manager-uuid-001"
 *             closure_notes: "Client opted for construction linked plan. Home loan through HDFC."
 *     responses:
 *       201:
 *         description: Lead closed/booked successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead closed/booked successfully"
 *               data:
 *                 id: "closure-uuid-001"
 *                 lead_id: "lead-uuid-001"
 *                 booking_date: "2026-05-20"
 *                 unit_number: "B-1204"
 *                 unit_type: "3BHK"
 *                 agreed_price: "9500000.00"
 *                 commission_amount: "190000.00"
 *                 status: "confirmed"
 *       400:
 *         description: Missing required fields or closure already exists for this lead
 *       404:
 *         description: Lead not found
 */
router.post('/', authenticate, ctrl.createClosure);

/**
 * @swagger
 * /api/v1/closures/{id}:
 *   get:
 *     summary: Get a closure by ID (full details)
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
 *         description: Full closure details with lead, project, unit and commission breakdown
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
 *       Update any field — unit details, financials, commission, payment plan, notes.
 *       Does not change lead status (use PATCH /status for that).
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
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               booking_date:
 *                 type: string
 *                 format: date
 *               unit_number:
 *                 type: string
 *               tower_block:
 *                 type: string
 *               floor_number:
 *                 type: integer
 *               unit_type:
 *                 type: string
 *               carpet_area_sqft:
 *                 type: number
 *               super_area_sqft:
 *                 type: number
 *               agreed_price:
 *                 type: number
 *               booking_amount:
 *                 type: number
 *               payment_plan:
 *                 type: string
 *               loan_required:
 *                 type: boolean
 *               loan_bank:
 *                 type: string
 *               commission_amount:
 *                 type: number
 *               commission_percent:
 *                 type: number
 *               commission_paid:
 *                 type: boolean
 *               commission_paid_date:
 *                 type: string
 *                 format: date
 *               closure_notes:
 *                 type: string
 *           example:
 *             commission_paid: true
 *             commission_paid_date: "2026-06-01"
 *             closure_notes: "Commission transferred to exec on June 1"
 *     responses:
 *       200:
 *         description: Closure updated
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
