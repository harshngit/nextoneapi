/**
 * phoneRevealRoutes.js
 * Mounted at /api/v1/phone-reveal
 */

const express   = require('express');
const router    = express.Router();
const ctrl      = require('../controllers/phoneRevealController');
const { authenticate, authorize } = require('../middleware/auth');

const ADMIN   = ['super_admin', 'admin'];
const MANAGER = ['super_admin', 'admin', 'sales_manager'];
const ALL     = ['super_admin', 'admin', 'sales_manager', 'sales_executive', 'external_caller'];

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   - name: Phone Reveal
 *     description: Request and manage access to lead phone numbers
 */

/**
 * @swagger
 * /api/v1/phone-reveal/request:
 *   post:
 *     summary: Request access to a lead's phone number
 *     description: >
 *       Non-admin users submit a request to view a masked phone number.
 *       Admins are notified via in-app notification.
 *       Duplicate pending/approved requests are rejected.
 *     tags: [Phone Reveal]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lead_id]
 *             properties:
 *               lead_id:  { type: string, format: uuid, example: "lead-uuid" }
 *               reason:   { type: string, example: "Need to follow up on site visit" }
 *     responses:
 *       201:
 *         description: Request submitted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 id: "request-uuid"
 *                 lead_id: "lead-uuid"
 *                 requested_by: "user-uuid"
 *                 reason: "Need to follow up"
 *                 status: "pending"
 *                 created_at: "2026-05-15T10:00:00Z"
 *       409:
 *         description: Already has pending or approved request
 */
router.post('/request', authenticate, authorize(...ALL), ctrl.requestPhoneReveal);

/**
 * @swagger
 * /api/v1/phone-reveal/bulk-request:
 *   post:
 *     summary: Request access to multiple lead phone numbers at once
 *     description: >
 *       Submit a single request for up to 50 leads.
 *       Leads already having a pending/approved request are skipped (not an error).
 *       Admins receive ONE consolidated notification instead of one per lead.
 *     tags: [Phone Reveal]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lead_ids]
 *             properties:
 *               lead_ids:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 maxItems: 50
 *                 example: ["lead-uuid-1", "lead-uuid-2", "lead-uuid-3"]
 *               reason:
 *                 type: string
 *                 example: "Bulk follow-up campaign"
 *     responses:
 *       201:
 *         description: Bulk request processed
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 total_requested: 3
 *                 inserted: 2
 *                 skipped: 1
 *                 requests:
 *                   - { lead_id: "uuid-1", lead_name: "Suresh Patel", request_id: "req-uuid-1" }
 *                   - { lead_id: "uuid-2", lead_name: "Priya Mehta",  request_id: "req-uuid-2" }
 *                 skipped_details:
 *                   - { lead_id: "uuid-3", lead_name: "Amit Shah", reason: "Already has a pending request" }
 *       400:
 *         description: lead_ids missing or exceeds 50
 */
router.post('/bulk-request', authenticate, authorize(...ALL), ctrl.bulkRequestPhoneReveal);

/**
 * @swagger
 * /api/v1/phone-reveal/my-requests:
 *   get:
 *     summary: Get my own phone reveal request history
 *     tags: [Phone Reveal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 20 } }
 *       - { in: query, name: status,   schema: { type: string, enum: [pending, approved, declined] } }
 *     responses:
 *       200:
 *         description: My requests with lead name; phone revealed only if approved
 */
router.get('/my-requests', authenticate, authorize(...ALL), ctrl.getMyRequests);

/**
 * @swagger
 * /api/v1/phone-reveal/pending:
 *   get:
 *     summary: Get all pending requests (admin only)
 *     tags: [Phone Reveal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 20 } }
 *     responses:
 *       200:
 *         description: Pending requests with requester info and lead phone
 */
router.get('/pending', authenticate, authorize(...ADMIN), ctrl.getPendingRequests);

/**
 * @swagger
 * /api/v1/phone-reveal/all:
 *   get:
 *     summary: Get all requests with filters (admin / sales_manager)
 *     description: >
 *       admin/super_admin see all requests.
 *       sales_manager see only requests from users in their team.
 *     tags: [Phone Reveal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: page,         schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page,     schema: { type: integer, default: 20 } }
 *       - { in: query, name: status,       schema: { type: string, enum: [pending, approved, declined] } }
 *       - { in: query, name: requested_by, schema: { type: string, format: uuid }, description: "filter by user UUID" }
 *       - { in: query, name: lead_id,      schema: { type: string, format: uuid }, description: "filter by lead UUID" }
 *     responses:
 *       200:
 *         description: Paginated list of requests
 */
router.get('/all', authenticate, authorize(...MANAGER), ctrl.getAllRequests);

/**
 * @swagger
 * /api/v1/phone-reveal/{id}/approve:
 *   patch:
 *     summary: Approve a phone reveal request (admin only)
 *     tags: [Phone Reveal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               note: { type: string, example: "Approved for site visit follow-up" }
 *     responses:
 *       200:
 *         description: Request approved; response includes revealed phone number
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 id: "request-uuid"
 *                 status: "approved"
 *                 lead_phone: "+919876543210"
 *                 lead_name: "Suresh Patel"
 *                 requester_name: "Rahul Sharma"
 */
router.patch('/:id/approve', authenticate, authorize(...ADMIN), ctrl.approveRequest);

/**
 * @swagger
 * /api/v1/phone-reveal/{id}/decline:
 *   patch:
 *     summary: Decline a phone reveal request (admin only)
 *     tags: [Phone Reveal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               note: { type: string, example: "Not required at this stage" }
 *     responses:
 *       200:
 *         description: Request declined; requester notified
 */
router.patch('/:id/decline', authenticate, authorize(...ADMIN), ctrl.declineRequest);

/**
 * @swagger
 * /api/v1/phone-reveal/lead/{leadId}:
 *   get:
 *     summary: Get all phone reveal requests for a specific lead
 *     description: >
 *       admin/super_admin can see all.
 *       sales_manager can see only if lead belongs to their team.
 *     tags: [Phone Reveal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: leadId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: All requests for this lead with requester info
 */
router.get('/lead/:leadId', authenticate, authorize(...MANAGER), ctrl.getLeadRequests);

/**
 * @swagger
 * /api/v1/phone-reveal/check/{leadId}:
 *   get:
 *     summary: Check if current user has approved access to a lead's phone
 *     description: >
 *       Returns has_access: true with the phone number if approved (or if admin).
 *       Returns has_access: false with the pending request object if waiting.
 *       Returns has_access: false with request: null if never requested.
 *     tags: [Phone Reveal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: leadId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Access status
 *         content:
 *           application/json:
 *             examples:
 *               approved:
 *                 value: { success: true, data: { has_access: true, phone: "+919876543210", request: { id: "uuid", status: "approved" } } }
 *               pending:
 *                 value: { success: true, data: { has_access: false, phone: null, request: { id: "uuid", status: "pending", created_at: "..." } } }
 *               none:
 *                 value: { success: true, data: { has_access: false, phone: null, request: null } }
 */
router.get('/check/:leadId', authenticate, authorize(...ALL), ctrl.checkAccess);

module.exports = router;