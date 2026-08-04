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
// LEAD CONFIGURATIONS (1RK, 1BHK, 2BHK, ...)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/config/lead-configurations:
 *   get:
 *     summary: List all lead configurations
 *     description: >
 *       Returns all configuration types (1RK, 1BHK, 2BHK, etc). Used to
 *       populate the Configuration dropdown on the Lead form.
 *       All authenticated users can call this.
 *     tags: [Config]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Lead configurations list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "uuid-001"
 *                   name: "1BHK"
 *                   is_active: true
 *                   created_at: "2026-08-01T00:00:00Z"
 *                 - id: "uuid-002"
 *                   name: "2BHK"
 *                   is_active: true
 */
router.get("/lead-configurations", authenticate, ctrl.getLeadConfigurations);

/**
 * @swagger
 * /api/v1/config/lead-configurations:
 *   post:
 *     summary: Add a new lead configuration
 *     description: >
 *       Creates a new entry in the configuration dropdown. Any authenticated
 *       user (not just admins) can add one — e.g. a sales exec entering a new
 *       configuration type that isn't in the list yet.
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
 *                 description: Display name of the configuration
 *                 example: "5BHK"
 *           example:
 *             name: "5BHK"
 *     responses:
 *       201:
 *         description: Configuration created
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Configuration added successfully"
 *               data:
 *                 id: "uuid-010"
 *                 name: "5BHK"
 *                 is_active: true
 *       400:
 *         description: Name missing or duplicate
 */
router.post("/lead-configurations", authenticate, ctrl.createLeadConfiguration);

/**
 * @swagger
 * /api/v1/config/lead-configurations/{id}:
 *   put:
 *     summary: Update a lead configuration (Admin)
 *     description: Rename a configuration or toggle its active status.
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
 *               name:
 *                 type: string
 *                 example: "2.5BHK"
 *               is_active:
 *                 type: boolean
 *                 description: Set false to deactivate without deleting
 *                 example: false
 *     responses:
 *       200:
 *         description: Configuration updated
 *       404:
 *         description: Configuration not found
 */
router.put("/lead-configurations/:id", authenticate, authorize(...ADMIN), ctrl.updateLeadConfiguration);

/**
 * @swagger
 * /api/v1/config/lead-configurations/{id}:
 *   delete:
 *     summary: Delete a lead configuration (Admin)
 *     description: >
 *       Permanently removes a configuration.
 *       Will fail if any active leads are using this configuration — deactivate it instead.
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
 *         description: Configuration removed
 *       400:
 *         description: Configuration is in use by active leads
 *       404:
 *         description: Configuration not found
 */
router.delete("/lead-configurations/:id", authenticate, authorize(...ADMIN), ctrl.deleteLeadConfiguration);

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
 *       Update the key, label, color, sort_order or is_active of any status.
 *       The key of a SYSTEM status (is_system = true) cannot be changed — the
 *       app's business logic (WhatsApp triggers, notifications, exports) hardcodes
 *       those key strings. Custom statuses can freely rename their key; any leads
 *       already using the old key are automatically migrated to the new key.
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
 *               key:
 *                 type: string
 *                 description: >
 *                   Custom statuses only — renaming a system status's key is rejected.
 *                   Lowercased, spaces become underscores, other characters stripped.
 *                 example: "urgent_lead"
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
 *             key: "urgent_lead"
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
 *       400:
 *         description: Key belongs to a system status, or the new key already exists
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
// ROLES & PERMISSIONS — Access Control
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/config/roles:
 *   get:
 *     summary: Get permission matrix for all configurable roles (Admin)
 *     description: >
 *       Returns the full permissions JSONB for all 12 configurable roles
 *       (everything except super_admin, which always has full access and
 *       is never stored here). Use this to render the Access Control grid:
 *       12 roles x 13 modules x 6 permission keys.
 *     tags: [Access Control]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Permission matrix for all roles
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Roles and permissions fetched"
 *               data:
 *                 modules: ["dashboard","leads","projects","site_visits","revisits","closures","follow_ups","attendance","salary","team","users","phone_requests","notifications"]
 *                 permission_keys: ["view","create","edit","delete","approve","export"]
 *                 roles:
 *                   - role: "admin"
 *                     display_name: "Admin"
 *                     permissions:
 *                       leads: { view: true, create: true, edit: true, delete: true, approve: false, export: true }
 *                       salary: { view: true, create: true, edit: true, delete: true, approve: true, export: true }
 *                     updated_at: "2026-06-14T10:00:00Z"
 *                   - role: "sales_manager"
 *                     display_name: "Sales Manager"
 *                     permissions:
 *                       leads: { view: true, create: true, edit: true, delete: false, approve: false, export: true }
 */
router.get("/roles", authenticate, authorize(...ADMIN), ctrl.getRoles);

/**
 * @swagger
 * /api/v1/config/roles/{role}:
 *   get:
 *     summary: Get permission matrix for a single role (Admin)
 *     description: >
 *       Returns the permission matrix for one role — used to populate the
 *       single-role edit panel. Pass role=super_admin to get a read-only
 *       synthetic full-access matrix (editable: false).
 *     tags: [Access Control]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [admin, sales_manager, sales_executive, external_caller, associate, associate_partner, partner, team_leader, cluster, cluster_head, digital_marketing, hr_admin, super_admin]
 *         example: sales_manager
 *     responses:
 *       200:
 *         description: Permission matrix for the role
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Permissions for sales_manager"
 *               data:
 *                 role: "sales_manager"
 *                 display_name: "Sales Manager"
 *                 editable: true
 *                 permissions:
 *                   dashboard:  { view: true,  create: false, edit: false, delete: false, approve: false, export: true }
 *                   leads:      { view: true,  create: true,  edit: true,  delete: false, approve: false, export: true }
 *                   salary:     { view: false, create: false, edit: false, delete: false, approve: false, export: false }
 *                 updated_at: "2026-06-14T10:00:00Z"
 *       400:
 *         description: Invalid role
 *       404:
 *         description: Role not yet configured
 *   put:
 *     summary: Update permission matrix for a role (Admin)
 *     description: >
 *       Updates one or more modules' permissions for a role. Only the
 *       modules/keys included in the request body are changed — everything
 *       else in the existing matrix is preserved (deep merge per module).
 *
 *       Only Super Admin can update the 'admin' role's permissions.
 *       Changes take effect immediately on the next request — the
 *       permission cache is refreshed automatically, no restart needed.
 *     tags: [Access Control]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [admin, sales_manager, sales_executive, external_caller, associate, associate_partner, partner, team_leader, cluster, cluster_head, digital_marketing, hr_admin]
 *         example: sales_manager
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [permissions]
 *             properties:
 *               permissions:
 *                 type: object
 *                 description: Keyed by module. Only included modules/keys are changed.
 *                 additionalProperties:
 *                   type: object
 *                   properties:
 *                     view:    { type: boolean }
 *                     create:  { type: boolean }
 *                     edit:    { type: boolean }
 *                     delete:  { type: boolean }
 *                     approve: { type: boolean }
 *                     export:  { type: boolean }
 *           example:
 *             permissions:
 *               leads:
 *                 view: true
 *                 create: true
 *                 edit: true
 *                 delete: false
 *               salary:
 *                 view: true
 *                 export: true
 *     responses:
 *       200:
 *         description: Permissions updated and cache refreshed
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Permissions updated for sales_manager"
 *               data:
 *                 role: "sales_manager"
 *                 display_name: "Sales Manager"
 *                 permissions:
 *                   leads: { view: true, create: true, edit: true, delete: false, approve: false, export: true }
 *                   salary: { view: true, create: false, edit: false, delete: false, approve: false, export: true }
 *                 updated_at: "2026-06-14T10:05:00Z"
 *       400:
 *         description: Invalid role, module, permission key, or non-boolean value
 *       403:
 *         description: Only Super Admin can update admin role permissions
 */
router.get("/roles/:role",  authenticate, authorize(...ADMIN), ctrl.getRolePermissions);
router.put("/roles/:role",  authenticate, authorize(...ADMIN), ctrl.updateRolePermissions);

/**
 * @swagger
 * /api/v1/config/roles/{role}/reset:
 *   post:
 *     summary: Reset a role's permissions to all-false (Admin)
 *     description: >
 *       Sets every module/key for this role to false — full lockout.
 *       Use this as a clean slate before reconfiguring a role from scratch.
 *       Cannot be used on super_admin.
 *     tags: [Access Control]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [admin, sales_manager, sales_executive, external_caller, associate, associate_partner, partner, team_leader, cluster, cluster_head, digital_marketing, hr_admin]
 *     responses:
 *       200:
 *         description: Role permissions reset to all-false
 *       400:
 *         description: Invalid role
 *       404:
 *         description: Role not found in role_permissions
 */
router.post("/roles/:role/reset", authenticate, authorize(...ADMIN), ctrl.resetRolePermissions);

// ═════════════════════════════════════════════════════════════════════════════
// GENERAL SETTINGS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/config/modules:
 *   get:
 *     summary: Get all access-control modules and permission keys (Admin)
 *     description: >
 *       Returns metadata for all 13 modules (display name, description, which
 *       of the 6 permission keys each module supports), the full list of
 *       permission keys, and the list of configurable roles.
 *       Use this to render the Access Control grid headers/columns.
 *     tags: [Access Control]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Module metadata
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Modules fetched"
 *               data:
 *                 permission_keys: ["view","create","edit","delete","approve","export"]
 *                 configurable_roles: ["admin","sales_manager","sales_executive","external_caller","associate","associate_partner","partner","team_leader","cluster","cluster_head","digital_marketing","hr_admin"]
 *                 modules:
 *                   - key: "leads"
 *                     display_name: "Lead Management"
 *                     description: "Create, assign, and track leads through the sales lifecycle"
 *                     supports: ["view","create","edit","delete","export"]
 *                   - key: "salary"
 *                     display_name: "Salary & Incentives"
 *                     description: "Salary slips, incentives, appraisals"
 *                     supports: ["view","create","edit","delete","approve","export"]
 *                   - key: "team"
 *                     display_name: "Team"
 *                     description: "View team hierarchy and member performance"
 *                     supports: ["view"]
 */
router.get("/modules",  authenticate, authorize(...ADMIN), ctrl.getModules);
router.get("/general",  authenticate, authorize(...ADMIN), ctrl.getGeneralSettings);
router.put("/general",  authenticate, authorize("super_admin"), ctrl.updateGeneralSettings);
router.get("/audit-log",authenticate, authorize("super_admin"), ctrl.getAuditLog);

module.exports = router;