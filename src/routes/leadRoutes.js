/**
 * leadReassignRoutes.js — Nextone Reality
 * Routes for lead reassignment operations
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  reassignLead,
  bulkReassignLeads,
  getReassignmentHistory,
} = require('../controllers/leadReassignController');

/**
 * @swagger
 * /api/v1/leads/{id}/reassign:
 *   patch:
 *     summary: Reassign a single lead to a new user
 *     description: Reassign a lead from current assignee to a new user. Only admins, super_admins, and sales_managers can perform this action.
 *     tags: [Lead Reassignment]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Lead ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - assigned_to
 *             properties:
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: User ID of the new assignee
 *                 example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *               reason:
 *                 type: string
 *                 description: Reason for reassignment (optional)
 *                 example: "Better territorial alignment"
 *     responses:
 *       200:
 *         description: Lead reassigned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Lead reassigned successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     leadId:
 *                       type: string
 *                       format: uuid
 *                     leadName:
 *                       type: string
 *                     oldAssignee:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         name:
 *                           type: string
 *                     newAssignee:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         name:
 *                           type: string
 *                         email:
 *                           type: string
 *                     reason:
 *                       type: string
 *                     performedBy:
 *                       type: string
 *       400:
 *         description: Bad request - Invalid input or lead already assigned to this user
 *       403:
 *         description: Access denied - Insufficient permissions
 *       404:
 *         description: Lead or new assignee not found
 */
router.patch('/:id/reassign', authenticate, reassignLead);

/**
 * @swagger
 * /api/v1/leads/bulk-reassign:
 *   post:
 *     summary: Bulk reassign multiple leads to a new user
 *     description: Reassign multiple leads at once to a new user. Maximum 100 leads per request. Only admins, super_admins, and sales_managers can perform this action.
 *     tags: [Lead Reassignment]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lead_ids
 *               - assigned_to
 *             properties:
 *               lead_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 description: Array of lead IDs to reassign (max 100)
 *                 example: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890", "b2c3d4e5-f6a7-8901-bcde-f12345678901"]
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: User ID of the new assignee
 *                 example: "c3d4e5f6-a7b8-9012-cdef-123456789012"
 *               reason:
 *                 type: string
 *                 description: Reason for bulk reassignment (optional)
 *                 example: "Workload balancing"
 *     responses:
 *       200:
 *         description: Bulk reassignment completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Bulk reassignment completed"
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalRequested:
 *                       type: integer
 *                       example: 10
 *                     successful:
 *                       type: integer
 *                       example: 8
 *                     skipped:
 *                       type: integer
 *                       example: 2
 *                     newAssignee:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         name:
 *                           type: string
 *                         email:
 *                           type: string
 *                     successfulReassignments:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           leadId:
 *                             type: string
 *                             format: uuid
 *                           leadName:
 *                             type: string
 *                           oldAssignee:
 *                             type: string
 *                     skippedLeads:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           leadId:
 *                             type: string
 *                             format: uuid
 *                           leadName:
 *                             type: string
 *                           reason:
 *                             type: string
 *                     reason:
 *                       type: string
 *                     performedBy:
 *                       type: string
 *       400:
 *         description: Bad request - Invalid input or too many leads
 *       403:
 *         description: Access denied - Insufficient permissions
 *       404:
 *         description: No valid leads found or new assignee not found
 */
router.post('/bulk-reassign', authenticate, bulkReassignLeads);

/**
 * @swagger
 * /api/v1/leads/{id}/reassignment-history:
 *   get:
 *     summary: Get reassignment history for a lead
 *     description: >
 *       Returns paginated reassignment history for a specific lead —
 *       every time the lead changed hands, who did it, when, and why.
 *
 *       Access rules:
 *         - super_admin / admin / sales_manager → can view history for any lead.
 *         - sales_executive / external_caller   → can only view history for leads currently assigned to them.
 *     tags: [Lead Reassignment]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Lead UUID
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Reassignment history fetched successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Reassignment history fetched successfully"
 *               data:
 *                 lead:
 *                   id: "lead-uuid"
 *                   name: "Suresh Patel"
 *                   phone: "+919876543210"
 *                   current_assignee_name: "Rahul Sharma"
 *                   current_assignee_role: "sales_executive"
 *                 total_reassignments: 3
 *                 pagination:
 *                   total: 3
 *                   page: 1
 *                   per_page: 20
 *                   total_pages: 1
 *                 history:
 *                   - id: "history-uuid-1"
 *                     from:
 *                       id: "user-uuid-1"
 *                       name: "Amit Joshi"
 *                       role: "sales_executive"
 *                     to:
 *                       id: "user-uuid-2"
 *                       name: "Rahul Sharma"
 *                       role: "sales_executive"
 *                     reason: "Better territorial alignment"
 *                     performed_by:
 *                       id: "admin-uuid"
 *                       name: "Admin User"
 *                       role: "admin"
 *                     reassigned_at: "2026-05-10T14:30:00.000Z"
 *                   - id: "history-uuid-2"
 *                     from: null
 *                     to:
 *                       id: "user-uuid-1"
 *                       name: "Amit Joshi"
 *                       role: "sales_executive"
 *                     reason: null
 *                     performed_by:
 *                       id: "admin-uuid"
 *                       name: "Admin User"
 *                       role: "admin"
 *                     reassigned_at: "2026-05-01T10:00:00.000Z"
 *       403:
 *         description: Access denied — lead not assigned to you
 *       404:
 *         description: Lead not found
 */
router.get('/:id/reassignment-history', authenticate, getReassignmentHistory);

module.exports = router;