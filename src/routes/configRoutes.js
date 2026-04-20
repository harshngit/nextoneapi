const express = require("express");
const router = express.Router();
const configController = require("../controllers/configController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: System Configuration
 *   description: >
 *     Admin-level system settings — manage roles & permissions,
 *     lead sources, and module-level access control.
 *     Only Super Admin and Admin can access these endpoints.
 */

/**
 * @swagger
 * /api/v1/config/roles:
 *   get:
 *     summary: Get all roles and their module permissions
 *     description: >
 *       Returns the full permission matrix for all roles in the system.
 *       Each role has module-level access flags (view, create, edit, delete).
 *       Used by the admin panel to display and edit role permissions.
 *     tags: [System Configuration]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Roles and permissions returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - role: "sales_executive"
 *                   display_name: "Sales Executive"
 *                   permissions:
 *                     leads:        { view: true,  create: true,  edit: true,  delete: false }
 *                     projects:     { view: true,  create: false, edit: false, delete: false }
 *                     site_visits:  { view: true,  create: true,  edit: true,  delete: false }
 *                     tasks:        { view: true,  create: true,  edit: true,  delete: false }
 *                     users:        { view: false, create: false, edit: false, delete: false }
 *                     reports:      { view: false, create: false, edit: false, delete: false }
 *                 - role: "sales_manager"
 *                   display_name: "Sales Manager"
 *                   permissions:
 *                     leads:        { view: true,  create: true,  edit: true,  delete: false }
 *                     projects:     { view: true,  create: false, edit: false, delete: false }
 *                     site_visits:  { view: true,  create: true,  edit: true,  delete: false }
 *                     tasks:        { view: true,  create: true,  edit: true,  delete: true  }
 *                     users:        { view: true,  create: false, edit: false, delete: false }
 *                     reports:      { view: true,  create: false, edit: false, delete: false }
 *       403:
 *         description: Insufficient permissions
 */
router.get(
  "/roles",
  authenticate,
  authorize("super_admin", "admin"),
  configController.getRoles
);

/**
 * @swagger
 * /api/v1/config/roles/{role}:
 *   put:
 *     summary: Update module-level permissions for a role
 *     description: >
 *       Updates the permission matrix for a specific role.
 *       Only Super Admin can update permissions for admin role.
 *       Admin can update permissions for sales_manager, sales_executive,
 *       and external_caller roles only.
 *       Changes take effect immediately for all active sessions of that role.
 *     tags: [System Configuration]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [admin, sales_manager, sales_executive, external_caller]
 *         example: "sales_executive"
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
 *                 description: Module-level permission flags
 *                 properties:
 *                   leads:
 *                     type: object
 *                     properties:
 *                       view:   { type: boolean }
 *                       create: { type: boolean }
 *                       edit:   { type: boolean }
 *                       delete: { type: boolean }
 *                   projects:
 *                     type: object
 *                     properties:
 *                       view:   { type: boolean }
 *                       create: { type: boolean }
 *                       edit:   { type: boolean }
 *                       delete: { type: boolean }
 *                   site_visits:
 *                     type: object
 *                     properties:
 *                       view:   { type: boolean }
 *                       create: { type: boolean }
 *                       edit:   { type: boolean }
 *                       delete: { type: boolean }
 *                   tasks:
 *                     type: object
 *                     properties:
 *                       view:   { type: boolean }
 *                       create: { type: boolean }
 *                       edit:   { type: boolean }
 *                       delete: { type: boolean }
 *                   users:
 *                     type: object
 *                     properties:
 *                       view:   { type: boolean }
 *                       create: { type: boolean }
 *                       edit:   { type: boolean }
 *                       delete: { type: boolean }
 *                   reports:
 *                     type: object
 *                     properties:
 *                       view:   { type: boolean }
 *                       create: { type: boolean }
 *                       edit:   { type: boolean }
 *                       delete: { type: boolean }
 *           example:
 *             permissions:
 *               leads:       { view: true, create: true, edit: true,  delete: false }
 *               projects:    { view: true, create: false, edit: false, delete: false }
 *               site_visits: { view: true, create: true, edit: true,  delete: false }
 *               tasks:       { view: true, create: true, edit: true,  delete: true  }
 *               users:       { view: false, create: false, edit: false, delete: false }
 *               reports:     { view: true,  create: false, edit: false, delete: false }
 *     responses:
 *       200:
 *         description: Permissions updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Permissions updated for sales_executive"
 *               data:
 *                 role: "sales_executive"
 *                 permissions:
 *                   leads: { view: true, create: true, edit: true, delete: false }
 *       400:
 *         description: Invalid role or permission format
 *       403:
 *         description: Cannot update permissions for this role
 */
router.put(
  "/roles/:role",
  authenticate,
  authorize("super_admin", "admin"),
  configController.updateRolePermissions
);

/**
 * @swagger
 * /api/v1/config/lead-sources:
 *   get:
 *     summary: Get all configurable lead sources
 *     description: >
 *       Returns the list of configured lead sources used system-wide.
 *       These populate the source dropdown when creating or filtering leads.
 *       All authenticated users can read lead sources.
 *     tags: [System Configuration]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Lead sources returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "src-uuid-001"
 *                   name: "Facebook"
 *                   is_active: true
 *                   created_at: "2025-01-10T09:00:00Z"
 *                 - id: "src-uuid-002"
 *                   name: "99acres"
 *                   is_active: true
 *                   created_at: "2025-01-10T09:00:00Z"
 *                 - id: "src-uuid-003"
 *                   name: "Walk-in"
 *                   is_active: true
 *                   created_at: "2025-01-10T09:00:00Z"
 */
router.get(
  "/lead-sources",
  authenticate,
  configController.getLeadSources
);

/**
 * @swagger
 * /api/v1/config/lead-sources:
 *   post:
 *     summary: Add a new lead source
 *     description: >
 *       Adds a new lead source to the system.
 *       Once added, it becomes available in the source dropdown for all users.
 *       Only Admin and Super Admin can add lead sources.
 *       Duplicate source names are rejected (case-insensitive).
 *     tags: [System Configuration]
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
 *                 example: "Housing.com"
 *                 description: Display name for the lead source
 *           example:
 *             name: "Housing.com"
 *     responses:
 *       201:
 *         description: Lead source added successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead source added successfully"
 *               data:
 *                 id: "src-uuid-010"
 *                 name: "Housing.com"
 *                 is_active: true
 *                 created_at: "2025-04-20T10:00:00Z"
 *       400:
 *         description: Lead source with this name already exists
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Lead source 'Housing.com' already exists"
 */
router.post(
  "/lead-sources",
  authenticate,
  authorize("super_admin", "admin"),
  configController.createLeadSource
);

/**
 * @swagger
 * /api/v1/config/lead-sources/{id}:
 *   put:
 *     summary: Update a lead source name
 *     description: >
 *       Renames an existing lead source or toggles its active status.
 *       Deactivating a source hides it from dropdowns but retains
 *       historical data on existing leads.
 *     tags: [System Configuration]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "src-uuid-001"
 *     requestBody:
 *       required: true
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
 *                 example: true
 *           examples:
 *             Rename:
 *               summary: Rename a source
 *               value:
 *                 name: "Meta Ads"
 *             Deactivate:
 *               summary: Deactivate a source
 *               value:
 *                 is_active: false
 *     responses:
 *       200:
 *         description: Lead source updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead source updated successfully"
 *               data:
 *                 id: "src-uuid-001"
 *                 name: "Meta Ads"
 *                 is_active: true
 *       404:
 *         description: Lead source not found
 */
router.put(
  "/lead-sources/:id",
  authenticate,
  authorize("super_admin", "admin"),
  configController.updateLeadSource
);

/**
 * @swagger
 * /api/v1/config/lead-sources/{id}:
 *   delete:
 *     summary: Remove a lead source
 *     description: >
 *       Soft-deletes a lead source by setting is_active to false.
 *       Hard delete is blocked if any leads are using this source
 *       to protect data integrity. Use the update endpoint to deactivate instead.
 *       Only Super Admin can permanently delete a source.
 *     tags: [System Configuration]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "src-uuid-001"
 *     responses:
 *       200:
 *         description: Lead source removed
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Lead source removed successfully"
 *       400:
 *         description: Cannot delete — source is in use by existing leads
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Cannot delete — 34 leads are using this source. Deactivate it instead."
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Lead source not found
 */
router.delete(
  "/lead-sources/:id",
  authenticate,
  authorize("super_admin", "admin"),
  configController.deleteLeadSource
);

/**
 * @swagger
 * /api/v1/config/modules:
 *   get:
 *     summary: Get all modules and their descriptions
 *     description: >
 *       Returns the list of all configurable system modules.
 *       Used by the admin panel to know which modules exist for the permission matrix.
 *     tags: [System Configuration]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Module list returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - key: "leads"
 *                   display_name: "Lead Management"
 *                   description: "Create, assign, and track leads through the sales lifecycle"
 *                 - key: "projects"
 *                   display_name: "Project Management"
 *                   description: "Manage real estate projects and map leads to them"
 *                 - key: "site_visits"
 *                   display_name: "Site Visit Management"
 *                   description: "Schedule, track, and capture feedback for site visits"
 *                 - key: "tasks"
 *                   display_name: "Follow-Up & Tasks"
 *                   description: "Create and manage follow-up tasks with reminders"
 *                 - key: "users"
 *                   display_name: "User & Team Management"
 *                   description: "Manage users, roles, and team hierarchy"
 *                 - key: "reports"
 *                   display_name: "Dashboard & Reports"
 *                   description: "View analytics, conversion reports, and team performance"
 */
router.get(
  "/modules",
  authenticate,
  authorize("super_admin", "admin"),
  configController.getModules
);

/**
 * @swagger
 * /api/v1/config/general:
 *   get:
 *     summary: Get general system settings
 *     description: >
 *       Returns general platform settings such as company name,
 *       timezone, default language, and notification preferences.
 *     tags: [System Configuration]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: General settings returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 company_name: "Next One Realty"
 *                 timezone: "Asia/Kolkata"
 *                 default_language: "en"
 *                 task_reminder_minutes: 30
 *                 visit_reminder_hours: 24
 *                 max_leads_per_executive: 100
 *                 updated_at: "2025-04-01T09:00:00Z"
 */
router.get(
  "/general",
  authenticate,
  authorize("super_admin", "admin"),
  configController.getGeneralSettings
);

/**
 * @swagger
 * /api/v1/config/general:
 *   put:
 *     summary: Update general system settings
 *     description: >
 *       Updates platform-wide settings.
 *       Only Super Admin can update general settings.
 *       Changes take effect immediately across the platform.
 *     tags: [System Configuration]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               company_name:
 *                 type: string
 *                 example: "Next One Realty"
 *               timezone:
 *                 type: string
 *                 example: "Asia/Kolkata"
 *               default_language:
 *                 type: string
 *                 example: "en"
 *               task_reminder_minutes:
 *                 type: integer
 *                 example: 30
 *                 description: How many minutes before due time to send task reminder
 *               visit_reminder_hours:
 *                 type: integer
 *                 example: 24
 *                 description: How many hours before visit to send reminder
 *               max_leads_per_executive:
 *                 type: integer
 *                 example: 100
 *                 description: Max leads that can be assigned to one sales executive
 *           example:
 *             company_name: "Next One Realty"
 *             timezone: "Asia/Kolkata"
 *             task_reminder_minutes: 30
 *             visit_reminder_hours: 24
 *             max_leads_per_executive: 100
 *     responses:
 *       200:
 *         description: General settings updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "General settings updated successfully"
 *       403:
 *         description: Only Super Admin can update general settings
 */
router.put(
  "/general",
  authenticate,
  authorize("super_admin"),
  configController.updateGeneralSettings
);

/**
 * @swagger
 * /api/v1/config/audit-log:
 *   get:
 *     summary: Get system audit log
 *     description: >
 *       Returns a paginated log of all critical admin actions —
 *       role changes, permission updates, user creation/deactivation,
 *       and config changes. Only Super Admin can access the audit log.
 *     tags: [System Configuration]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [role_change, permission_update, user_created, user_deactivated, config_update, lead_source_change]
 *         example: role_change
 *       - in: query
 *         name: performed_by
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by the admin who performed the action
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
 *         description: Audit log returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "audit-uuid-001"
 *                   action: "role_change"
 *                   description: "Role of Rahul Sharma changed from sales_executive to sales_manager"
 *                   performed_by: "Admin User"
 *                   target_user: "Rahul Sharma"
 *                   metadata: { old_role: "sales_executive", new_role: "sales_manager" }
 *                   created_at: "2025-04-15T14:30:00Z"
 *               pagination:
 *                 total: 42
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 3
 *       403:
 *         description: Only Super Admin can view audit logs
 */
router.get(
  "/audit-log",
  authenticate,
  authorize("super_admin"),
  configController.getAuditLog
);

module.exports = router;
