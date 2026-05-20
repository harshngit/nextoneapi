const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/configController");
const { authenticate, authorize } = require("../middleware/auth");

const ADMIN = ["super_admin", "admin"];

/**
 * @swagger
 * tags:
 *   name: Config
 *   description: System configuration — roles, lead sources, lead statuses, settings
 */

// ═════════════════════════════════════════════════════════════════════════════
// LEAD SOURCES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/config/lead-sources:
 *   get:
 *     summary: List all lead sources
 *     description: >
 *       Returns all lead sources. Used to populate the Lead Source dropdown.
 *       All authenticated users can call this.
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Lead sources list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "uuid-001"
 *                   name: "Facebook"
 *                   is_active: true
 *                   created_at: "2025-01-01T00:00:00Z"
 *                 - id: "uuid-002"
 *                   name: "Instagram"
 *                   is_active: true
 */
router.get("/lead-sources", authenticate, ctrl.getLeadSources);

/**
 * @swagger
 * /api/v1/config/lead-sources:
 *   post:
 *     summary: Add a new lead source (Admin)
 *     description: Creates a new entry in the lead sources dropdown.
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Display name of the source
 *                 example: "LinkedIn"
 *           example:
 *             name: "LinkedIn"
 *     responses:
 *       201:
 *         description: Lead source created
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead source added successfully"
 *               data:
 *                 id: "uuid-010"
 *                 name: "LinkedIn"
 *                 is_active: true
 *       400:
 *         description: Name missing or duplicate
 */
router.post("/lead-sources", authenticate, authorize(...ADMIN), ctrl.createLeadSource);

/**
 * @swagger
 * /api/v1/config/lead-sources/{id}:
 *   put:
 *     summary: Update a lead source (Admin)
 *     description: Rename a source or toggle its active status.
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "uuid-001"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Meta Ads"
 *               is_active:
 *                 type: boolean
 *                 description: Set false to deactivate without deleting
 *                 example: false
 *           example:
 *             name: "Meta Ads"
 *             is_active: true
 *     responses:
 *       200:
 *         description: Lead source updated
 *       404:
 *         description: Lead source not found
 */
router.put("/lead-sources/:id", authenticate, authorize(...ADMIN), ctrl.updateLeadSource);

/**
 * @swagger
 * /api/v1/config/lead-sources/{id}:
 *   delete:
 *     summary: Delete a lead source (Admin)
 *     description: >
 *       Permanently removes a lead source.
 *       Will fail if any active leads are using this source — deactivate it instead.
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Lead source removed
 *       400:
 *         description: Source is in use by active leads
 *       404:
 *         description: Lead source not found
 */
router.delete("/lead-sources/:id", authenticate, authorize(...ADMIN), ctrl.deleteLeadSource);

// ═════════════════════════════════════════════════════════════════════════════
// LEAD STATUSES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/config/lead-statuses:
 *   get:
 *     summary: List all lead statuses
 *     description: >
 *       Returns all active lead statuses ordered by sort_order.
 *       Used to populate the status/stage dropdown on the Lead form.
 *       All authenticated users can call this.
 *       Pass include_inactive=true to also return deactivated statuses (admin use).
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: include_inactive
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Pass true to include deactivated statuses
 *         example: false
 *     responses:
 *       200:
 *         description: Lead statuses list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "uuid-001"
 *                   key: "new"
 *                   label: "New"
 *                   color: "#6b7280"
 *                   sort_order: 1
 *                   is_active: true
 *                   is_system: true
 *                 - id: "uuid-002"
 *                   key: "contacted"
 *                   label: "Contacted"
 *                   color: "#3b82f6"
 *                   sort_order: 2
 *                   is_active: true
 *                   is_system: true
 *                 - id: "uuid-010"
 *                   key: "warm_lead"
 *                   label: "Warm Lead"
 *                   color: "#f59e0b"
 *                   sort_order: 5
 *                   is_active: true
 *                   is_system: false
 */
router.get("/lead-statuses", authenticate, ctrl.getLeadStatuses);

/**
 * @swagger
 * /api/v1/config/lead-statuses:
 *   post:
 *     summary: Create a custom lead status (Admin)
 *     description: >
 *       Adds a new custom stage to the lead lifecycle.
 *       The key is auto-slugified from what you provide (spaces → underscores, lowercase).
 *       System statuses (new, contacted, interested, etc.) cannot be overwritten.
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key, label]
 *             properties:
 *               key:
 *                 type: string
 *                 description: Internal identifier — slugified automatically
 *                 example: "warm_lead"
 *               label:
 *                 type: string
 *                 description: Display name shown in dropdowns
 *                 example: "Warm Lead"
 *               color:
 *                 type: string
 *                 description: Hex color for the badge (default grey)
 *                 example: "#f59e0b"
 *               sort_order:
 *                 type: integer
 *                 description: Position in the dropdown list (auto-appended if not set)
 *                 example: 5
 *           example:
 *             key: "warm_lead"
 *             label: "Warm Lead"
 *             color: "#f59e0b"
 *             sort_order: 5
 *     responses:
 *       201:
 *         description: Lead status created
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead status created successfully"
 *               data:
 *                 id: "uuid-new"
 *                 key: "warm_lead"
 *                 label: "Warm Lead"
 *                 color: "#f59e0b"
 *                 sort_order: 5
 *                 is_active: true
 *                 is_system: false
 *       400:
 *         description: key or label already exists
 */
router.post("/lead-statuses", authenticate, authorize(...ADMIN), ctrl.createLeadStatus);

/**
 * @swagger
 * /api/v1/config/lead-statuses/{id}:
 *   put:
 *     summary: Update a lead status (Admin)
 *     description: >
 *       Update the label, color, sort_order or is_active of any status.
 *       The key cannot be changed as it is stored directly in the leads table.
 *       To remove a status from the dropdown without deleting it, set is_active to false.
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *                 example: "Hot Lead"
 *               color:
 *                 type: string
 *                 example: "#ef4444"
 *               sort_order:
 *                 type: integer
 *                 example: 3
 *               is_active:
 *                 type: boolean
 *                 description: Set false to hide from dropdowns without deleting
 *                 example: false
 *           example:
 *             label: "Hot Lead"
 *             color: "#ef4444"
 *             is_active: true
 *     responses:
 *       200:
 *         description: Lead status updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 id: "uuid-010"
 *                 key: "warm_lead"
 *                 label: "Hot Lead"
 *                 color: "#ef4444"
 *                 sort_order: 3
 *                 is_active: true
 *       404:
 *         description: Lead status not found
 */
router.put("/lead-statuses/:id", authenticate, authorize(...ADMIN), ctrl.updateLeadStatus);

/**
 * @swagger
 * /api/v1/config/lead-statuses/{id}:
 *   delete:
 *     summary: Delete a custom lead status (Admin)
 *     description: >
 *       Permanently removes a lead status.
 *       System statuses (new, contacted, interested, etc.) cannot be deleted — only deactivated.
 *       Custom statuses in use by active leads cannot be deleted — deactivate instead.
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Lead status removed
 *       400:
 *         description: Status is system-level or in use by active leads
 *       404:
 *         description: Lead status not found
 */
router.delete("/lead-statuses/:id", authenticate, authorize(...ADMIN), ctrl.deleteLeadStatus);

/**
 * @swagger
 * /api/v1/config/lead-statuses/reorder:
 *   patch:
 *     summary: Bulk reorder lead statuses (Admin)
 *     description: >
 *       Update sort_order for multiple statuses at once.
 *       Used by drag-and-drop reordering in the frontend.
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [order]
 *             properties:
 *               order:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [id, sort_order]
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     sort_order:
 *                       type: integer
 *           example:
 *             order:
 *               - id: "uuid-001"
 *                 sort_order: 1
 *               - id: "uuid-010"
 *                 sort_order: 2
 *               - id: "uuid-002"
 *                 sort_order: 3
 *     responses:
 *       200:
 *         description: Statuses reordered — returns full updated list
 *       400:
 *         description: order array missing or empty
 */
router.patch("/lead-statuses/reorder", authenticate, authorize(...ADMIN), ctrl.reorderLeadStatuses);

// ═════════════════════════════════════════════════════════════════════════════
// ROLES & PERMISSIONS
// ═════════════════════════════════════════════════════════════════════════════

router.get("/roles",        authenticate, authorize(...ADMIN), ctrl.getRoles);
router.put("/roles/:role",  authenticate, authorize(...ADMIN), ctrl.updateRolePermissions);

// ═════════════════════════════════════════════════════════════════════════════
// GENERAL SETTINGS
// ═════════════════════════════════════════════════════════════════════════════

router.get("/modules",  authenticate, authorize(...ADMIN), ctrl.getModules);
router.get("/general",  authenticate, authorize(...ADMIN), ctrl.getGeneralSettings);
router.put("/general",  authenticate, authorize("super_admin"), ctrl.updateGeneralSettings);
router.get("/audit-log",authenticate, authorize("super_admin"), ctrl.getAuditLog);

module.exports = router;