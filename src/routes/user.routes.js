const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const configController = require("../controllers/configController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Users & Team Management
 *   description: >
 *     Manage users, roles, and team hierarchy.
 *     Super Admin and Admin have full access.
 *     Sales Manager can view their own team only.
 */

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: List all users
 *     description: >
 *       Returns a list of all users in the system.
 *       Super Admin and Admin can see all users.
 *       Sales Manager can only see users under their team.
 *       Supports filtering by role and active status.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [super_admin, admin, sales_manager, sales_executive, external_caller,
 *                  associate, associate_partner, partner, team_leader, cluster,
 *                  cluster_head, digital_marketing, hr_admin]
 *         description: Filter by user role
 *         example: sales_executive
 *       - in: query
 *         name: is_active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *         example: true
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive partial match against first name, last name, email, or phone number
 *         example: Rahul
 *       - in: query
 *         name: manager_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by manager (not usable by sales_manager callers)
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
 *         description: List of users returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 - id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   first_name: "Rahul"
 *                   last_name: "Sharma"
 *                   email: "rahul.sharma@nextonerealty.com"
 *                   role: "sales_executive"
 *                   is_active: true
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  authenticate,
  authorize(
    "super_admin", "admin",
    "associate", "associate_partner", "cluster_head", "cluster",
    "partner", "team_leader", "sales_manager"
  ),
  userController.getAllUsers
);

/**
 * @swagger
 * /api/v1/users/roles:
 *   get:
 *     summary: Get all valid roles with display labels
 *     description: >
 *       Returns every valid role value and its display label.
 *       Use this to populate the Role dropdown in the Create/Edit User form.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Roles list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - value: "admin"
 *                   label: "Admin"
 *                 - value: "sales_manager"
 *                   label: "Sales Manager"
 *                 - value: "sales_executive"
 *                   label: "Sales Executive"
 *                 - value: "external_caller"
 *                   label: "External Caller"
 *                 - value: "associate"
 *                   label: "Associate"
 *                 - value: "associate_partner"
 *                   label: "Associate Partner"
 *                 - value: "partner"
 *                   label: "Partner"
 *                 - value: "team_leader"
 *                   label: "Team Leader"
 *                 - value: "cluster"
 *                   label: "Cluster"
 *                 - value: "cluster_head"
 *                   label: "Cluster Head"
 *                 - value: "digital_marketing"
 *                   label: "Digital Marketing"
 *                 - value: "hr_admin"
 *                   label: "HR Admin"
 */
router.get("/roles", authenticate, userController.getRoles);

/**
 * @swagger
 * /api/v1/users/eligible-managers:
 *   get:
 *     summary: Get users eligible to be a manager for a given role
 *     description: >
 *       Returns all active users whose role is above the given role in the hierarchy.
 *       Use this to populate the "Assign Manager" dropdown in the UI.
 *       Example: for_role=sales_manager returns all team_leaders, partners,
 *       associate_partners, cluster_heads, clusters, associates, admins, super_admins.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: for_role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [associate_partner, cluster_head, cluster, partner, team_leader,
 *                  sales_manager, sales_executive, external_caller]
 *         example: sales_manager
 *     responses:
 *       200:
 *         description: Eligible managers list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 for_role: "sales_manager"
 *                 eligible_roles: ["super_admin","admin","associate","associate_partner","cluster_head","cluster","partner","team_leader"]
 *                 count: 5
 *                 managers:
 *                   - id: "uuid"
 *                     full_name: "Aniket Jha"
 *                     role: "associate_partner"
 *                     email: "aniket@example.com"
 *                     manager_name: "Super Admin"
 */
router.get("/eligible-managers", authenticate, authorize("super_admin", "admin"), userController.getEligibleManagers);

/**
 * @swagger
 * /api/v1/users/my-team:
 *   get:
 *     summary: Get the logged-in user's own recursive team (for Assign To / filter dropdowns)
 *     description: >
 *       Returns the logged-in user (as "Self") plus every user in their
 *       recursive manager_id sub-tree — active AND inactive. Each member
 *       includes is_active so the frontend can grey out / exclude inactive
 *       users from an "Assign To" picker while still showing them in a
 *       "filter by team member" picker (so leads/tasks/visits already
 *       assigned to a since-deactivated user remain filterable).
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Team members returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 count: 4
 *                 members:
 *                   - id: "user-uuid-001"
 *                     full_name: "Rahul Sharma"
 *                     email: "rahul@nextonerealty.com"
 *                     role: "sales_manager"
 *                     phone_number: "+919876543210"
 *                     manager_name: null
 *                     is_self: true
 *                     is_active: true
 *                   - id: "user-uuid-002"
 *                     full_name: "Priya Mehta"
 *                     email: "priya@nextonerealty.com"
 *                     role: "sales_executive"
 *                     phone_number: "+919876543211"
 *                     manager_name: "Rahul Sharma"
 *                     is_self: false
 *                     is_active: false
 */
router.get(
  "/my-team",
  authenticate,
  authorize(
    "super_admin", "admin",
    "associate", "associate_partner", "cluster_head", "cluster",
    "partner", "team_leader", "sales_manager",
    "sales_executive", "external_caller"
  ),
  userController.getMyTeam
);

/**
 * @swagger
 * /api/v1/users/me/permissions:
 *   get:
 *     summary: Get my effective permissions (any authenticated user)
 *     description: >
 *       Returns the logged-in user's effective permissions — their role's
 *       default permission matrix, with any per-user overrides applied on top.
 *       The frontend calls this once after login (and after any permission
 *       change notification) and caches the result to drive:
 *         - Sidebar visibility (show module if permissions[module].view)
 *         - Route guards (PermissionProtectedRoute)
 *         - Action buttons (show Create/Edit/Delete based on permissions)
 *
 *       super_admin always receives a full-access matrix (all true).
 *     tags: [Access Control]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Effective permissions for the logged-in user
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Effective permissions fetched"
 *               data:
 *                 role: "sales_executive"
 *                 has_overrides: true
 *                 modules: ["dashboard","leads","projects","site_visits","revisits","closures","follow_ups","attendance","salary","team","users","phone_requests","notifications"]
 *                 permission_keys: ["view","create","edit","delete","approve","export"]
 *                 permissions:
 *                   dashboard:  { view: true,  create: false, edit: false, delete: false, approve: false, export: false }
 *                   leads:      { view: true,  create: true,  edit: true,  delete: false, approve: false, export: false }
 *                   projects:   { view: true,  create: false, edit: false, delete: false, approve: false, export: false }
 *                   site_visits: { view: true, create: true,  edit: true,  delete: false, approve: false, export: false }
 *                   salary:     { view: true,  create: false, edit: false, delete: false, approve: false, export: false }
 *                   team:       { view: false, create: false, edit: false, delete: false, approve: false, export: false }
 *                   users:      { view: false, create: false, edit: false, delete: false, approve: false, export: false }
 *                   reports:    { view: true,  create: false, edit: false, delete: false, approve: false, export: false }
 */
router.get("/me/permissions", authenticate, configController.getMyPermissions);

/**
 * @swagger
 * /api/v1/users/{id}/permission-overrides:
 *   get:
 *     summary: Get per-user permission overrides (Admin)
 *     description: >
 *       Lists every permission override set for this specific user —
 *       exceptions to their role's default permissions.
 *     tags: [Access Control]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of overrides for this user
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Permission overrides fetched"
 *               data:
 *                 user:
 *                   id: "user-uuid-001"
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 overrides:
 *                   - module: "salary"
 *                     permission_key: "view"
 *                     value: true
 *                     set_by_name: "Super Admin"
 *                     updated_at: "2026-06-14T10:00:00Z"
 *       404:
 *         description: User not found
 *   put:
 *     summary: Set or clear per-user permission overrides (Admin)
 *     description: >
 *       Grants or revokes specific permissions for ONE user, overriding
 *       their role's defaults. Pass value: null to remove an override and
 *       revert that permission back to the role default.
 *       Cannot be used on super_admin (always full access).
 *     tags: [Access Control]
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
 *             required: [overrides]
 *             properties:
 *               overrides:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [module, permission_key, value]
 *                   properties:
 *                     module:         { type: string, example: "salary" }
 *                     permission_key: { type: string, example: "view" }
 *                     value:
 *                       description: true = grant, false = explicitly deny, null = remove override (use role default)
 *                       nullable: true
 *                       type: boolean
 *           example:
 *             overrides:
 *               - module: "salary"
 *                 permission_key: "view"
 *                 value: true
 *               - module: "team"
 *                 permission_key: "view"
 *                 value: null
 *     responses:
 *       200:
 *         description: Overrides updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Permission overrides updated"
 *               data:
 *                 user_id: "user-uuid-001"
 *                 overrides:
 *                   - module: "salary"
 *                     permission_key: "view"
 *                     value: true
 *       400:
 *         description: Invalid module, permission key, value, or target is super_admin
 *       404:
 *         description: User not found
 */
router.get("/:id/permission-overrides", authenticate, authorize(...["super_admin","admin"]), configController.getUserOverrides);
router.put("/:id/permission-overrides", authenticate, authorize(...["super_admin","admin"]), configController.setUserOverrides);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   get:
 *     summary: Get a user by ID
 *     description: >
 *       Returns full profile details of a specific user.
 *       Super Admin and Admin can view any user.
 *       Sales Manager can only view users in their team.
 *       Sales Executive can only view their own profile.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User UUID
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     responses:
 *       200:
 *         description: User details returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 first_name: "Rahul"
 *                 last_name: "Sharma"
 *                 email: "rahul.sharma@nextonerealty.com"
 *                 phone_number: "+919876543210"
 *                 role: "sales_executive"
 *                 is_active: true
 *                 last_login: "2025-04-20T10:30:00Z"
 *                 manager:
 *                   id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *                   full_name: "Amit Joshi"
 *       404:
 *         description: User not found
 *       403:
 *         description: Access denied to this user's profile
 */
/**
 * @swagger
 * /api/v1/users/{id}/team-tree:
 *   get:
 *     summary: Get all users in the full recursive sub-tree under a manager
 *     description: >
 *       Returns every user who reports (directly or indirectly) to the given manager,
 *       following the manager_id chain recursively.
 *       Admin/Super Admin can view any manager's tree.
 *       Other roles can only view their own tree.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: The manager's user ID
 *     responses:
 *       200:
 *         description: Full team tree returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 manager:
 *                   id: "uuid"
 *                   full_name: "Aniket Jha"
 *                   role: "associate_partner"
 *                 team_count: 12
 *                 team:
 *                   - id: "uuid"
 *                     full_name: "Rahul Sharma"
 *                     role: "sales_manager"
 *                     manager_name: "Aniket Jha"
 *                   - id: "uuid"
 *                     full_name: "Priya Mehta"
 *                     role: "sales_executive"
 *                     manager_name: "Rahul Sharma"
 */
router.get(
  "/:id/team-tree",
  authenticate,
  authorize("super_admin", "admin", "associate", "associate_partner", "cluster_head", "cluster", "partner", "team_leader", "sales_manager"),
  userController.getTeamTree
);

router.get("/:id", authenticate, userController.getUserById);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   put:
 *     summary: Update user details
 *     description: >
 *       Updates profile information for a user.
 *       Super Admin and Admin can update any user, including their email.
 *       Regular users can update their own profile (first_name, last_name, phone, address)
 *       but cannot change email — only Admin/Super Admin can do that.
 *       Role changes use the dedicated PATCH /:id/role endpoint.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               first_name:
 *                 type: string
 *                 example: "Rahul"
 *               last_name:
 *                 type: string
 *                 example: "Sharma"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Admin / Super Admin only. Must be unique across all users.
 *                 example: "rahul.new@nextonerealty.com"
 *               phone_number:
 *                 type: string
 *                 example: "+919876543999"
 *               address:
 *                 type: string
 *                 example: "102, Andheri West, Mumbai - 400053"
 *               emergency_contact_number:
 *                 type: string
 *                 example: "+919876543211"
 *               manager_id:
 *                 type: string
 *                 format: uuid
 *                 description: Admin / Super Admin only.
 *           example:
 *             first_name: "Rahul"
 *             last_name: "Sharma"
 *             email: "rahul.new@nextonerealty.com"
 *             phone_number: "+919876543999"
 *             address: "102, Andheri West, Mumbai - 400053"
 *             emergency_contact_number: "+919876543211"
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "User updated successfully"
 *               data:
 *                 id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 first_name: "Rahul"
 *                 last_name: "Sharma"
 *                 email: "rahul.new@nextonerealty.com"
 *                 phone_number: "+919876543999"
 *                 address: "102, Andheri West, Mumbai - 400053"
 *                 emergency_contact_number: "+919876543211"
 *       400:
 *         description: Validation error or email already in use
 *       403:
 *         description: Cannot update another user's profile
 *       404:
 *         description: User not found
 */
router.put("/:id", authenticate, userController.updateUser);

/**
 * @swagger
 * /api/v1/users/{id}/status:
 *   patch:
 *     summary: Activate or deactivate a user
 *     description: >
 *       Toggles a user's active status. Pass `is_active: true` to reactivate
 *       a deactivated user, or `is_active: false` to deactivate them.
 *       When deactivating, all existing sessions (refresh tokens) are revoked
 *       so the user is logged out immediately.
 *       Only Admin and Super Admin can use this endpoint.
 *       Super Admin status cannot be changed.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [is_active]
 *             properties:
 *               is_active:
 *                 type: boolean
 *                 description: true = activate, false = deactivate
 *                 example: true
 *           examples:
 *             activate:
 *               summary: Activate a user
 *               value: { "is_active": true }
 *             deactivate:
 *               summary: Deactivate a user
 *               value: { "is_active": false }
 *     responses:
 *       200:
 *         description: User status updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "User activated successfully"
 *               data:
 *                 id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 full_name: "Ritu Ritu"
 *                 is_active: true
 *       400:
 *         description: is_active missing, not boolean, or user already in that state
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: User not found
 */
router.patch(
  "/:id/status",
  authenticate,
  authorize("super_admin", "admin"),
  userController.toggleUserStatus
);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   delete:
 *     summary: Deactivate (soft-delete) a user
 *     description: >
 *       Deactivates a user account by setting is_active to false.
 *       This is a soft delete — the user record is retained in the database
 *       for historical data (leads, activity logs, etc.).
 *       Deactivated users cannot log in.
 *       Only Super Admin and Admin can deactivate users.
 *       A Super Admin cannot be deactivated.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     responses:
 *       200:
 *         description: User deactivated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "User deactivated successfully"
 *       400:
 *         description: Cannot deactivate a Super Admin
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: User not found
 */
router.delete(
  "/:id",
  authenticate,
  authorize("super_admin", "admin"),
  userController.deleteUser
);

/**
 * @swagger
 * /api/v1/users/{id}/role:
 *   patch:
 *     summary: Update a user's role
 *     description: >
 *       Changes the role of a user. Only Super Admin can perform this action.
 *       Changing roles may affect what data the user can access.
 *       If a sales_executive is promoted to sales_manager, their manager_id
 *       is cleared automatically.
 *       This action is logged in the audit trail.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateRoleRequest'
 *           example:
 *             role: "sales_manager"
 *     responses:
 *       200:
 *         description: Role updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "User role updated to sales_manager"
 *               data:
 *                 id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 role: "sales_manager"
 *       400:
 *         description: Invalid role value
 *       403:
 *         description: Only Super Admin can change roles
 *       404:
 *         description: User not found
 */
router.patch(
  "/:id/role",
  authenticate,
  authorize("super_admin"),
  userController.updateRole
);

/**
 * @swagger
 * /api/v1/users/team:
 *   get:
 *     summary: Get team members under a Sales Manager
 *     description: >
 *       Returns all Sales Executives assigned under the currently logged-in
 *       Sales Manager. Admin and Super Admin can pass a manager_id query param
 *       to view any manager's team. Includes basic performance stats per member.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: manager_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: >
 *           (Admin/Super Admin only) View team of a specific manager.
 *           If not provided, returns the logged-in manager's own team.
 *         example: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *     responses:
 *       200:
 *         description: Team members returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 manager:
 *                   id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *                   full_name: "Amit Joshi"
 *                   role: "sales_manager"
 *                 team_size: 4
 *                 members:
 *                   - id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                     full_name: "Rahul Sharma"
 *                     role: "sales_executive"
 *                     is_active: true
 *                     total_leads: 45
 *                     pending_followups: 7
 *       403:
 *         description: Sales Executive cannot access team view
 */
router.get(
  "/team",
  authenticate,
  authorize("super_admin", "admin", "sales_manager"),
  userController.getTeam
);

/**
 * @swagger
 * /api/v1/users/{id}/performance:
 *   get:
 *     summary: Get performance statistics for a user
 *     description: >
 *       Returns lead conversion stats and activity metrics for a specific user.
 *       Super Admin and Admin can view any user's performance.
 *       Sales Manager can view performance of their own team members only.
 *       Sales Executive can view only their own performance.
 *       Supports date range filtering for period-specific reports.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for performance period
 *         example: "2025-04-01"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for performance period
 *         example: "2025-04-30"
 *     responses:
 *       200:
 *         description: Performance stats returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 user_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 full_name: "Rahul Sharma"
 *                 period: { from: "2025-04-01", to: "2025-04-30" }
 *                 total_leads: 45
 *                 contacted: 38
 *                 interested: 22
 *                 site_visits_scheduled: 15
 *                 site_visits_done: 12
 *                 negotiation: 7
 *                 booked: 5
 *                 lost: 8
 *                 conversion_rate: 11.1
 *                 pending_followups: 7
 *                 overdue_followups: 2
 *       403:
 *         description: Access denied to this user's performance data
 *       404:
 *         description: User not found
 */
router.get("/:id/performance", authenticate, userController.getUserPerformance);

/**
 * @swagger
 * /api/v1/users/{id}/assign-manager:
 *   patch:
 *     summary: Assign a sales_executive or external_caller to a sales_manager
 *     description: >
 *       Assigns or reassigns a sales_executive or external_caller to a given sales_manager.
 *       Allowed roles: super_admin, admin, sales_manager.
 *       A sales_manager can only assign users to themselves — they cannot assign
 *       users to other managers or reassign users belonging to a different manager.
 *       super_admin and admin can assign any eligible user to any active sales_manager.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the user (sales_executive or external_caller) to assign
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [manager_id]
 *             properties:
 *               manager_id:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the sales_manager to assign this user to
 *                 example: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *     responses:
 *       200:
 *         description: User assigned to manager successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "User assigned to manager successfully"
 *               data:
 *                 user_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 user_name: "Rahul Sharma"
 *                 role: "sales_executive"
 *                 manager_id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *                 manager_name: "Amit Joshi"
 *       400:
 *         description: Validation error (wrong role, manager not found, etc.)
 *       403:
 *         description: sales_manager trying to assign to another manager or poach from another team
 *       404:
 *         description: User or manager not found
 */
router.patch(
  "/:id/assign-manager",
  authenticate,
  authorize("super_admin", "admin", "sales_manager"),
  userController.assignManager
);

/**
 * @swagger
 * /api/v1/users:
 *   post:
 *     summary: Create a new user (Admin)
 *     description: >
 *       Creates a new user account in the system.
 *       Only Super Admin and Admin can create users.
 *       For the full list of valid roles call GET /api/v1/users/roles.
 *     tags: [Users & Team Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [first_name, last_name, email, password, role]
 *             properties:
 *               first_name:
 *                 type: string
 *                 example: "Rahul"
 *               last_name:
 *                 type: string
 *                 example: "Sharma"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "rahul.sharma@nextonerealty.com"
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: "SecurePass@123"
 *               phone_number:
 *                 type: string
 *                 example: "+919876543210"
 *               role:
 *                 type: string
 *                 description: >
 *                   One of: admin, sales_manager, sales_executive, external_caller,
 *                   associate, associate_partner, partner, team_leader, cluster,
 *                   cluster_head, digital_marketing, hr_admin
 *                 example: "sales_executive"
 *               manager_id:
 *                 type: string
 *                 format: uuid
 *                 description: Required when role is sales_executive
 *                 example: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *               address:
 *                 type: string
 *                 description: Employee residential address
 *                 example: "102, Andheri West, Mumbai - 400053"
 *               emergency_contact_number:
 *                 type: string
 *                 description: Emergency contact phone number
 *                 example: "+919876543211"
 *           example:
 *             first_name: "Rahul"
 *             last_name: "Sharma"
 *             email: "rahul.sharma@nextonerealty.com"
 *             password: "SecurePass@123"
 *             phone_number: "+919876543210"
 *             role: "associate"
 *             address: "102, Andheri West, Mumbai - 400053"
 *             emergency_contact_number: "+919876543211"
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "User created successfully"
 *               data:
 *                 id: "uuid"
 *                 email: "rahul.sharma@nextonerealty.com"
 *                 role: "associate"
 *                 first_name: "Rahul"
 *                 last_name: "Sharma"
 *                 phone_number: "+919876543210"
 *                 address: "102, Andheri West, Mumbai - 400053"
 *                 emergency_contact_number: "+919876543211"
 *                 created_at: "2026-05-20T10:00:00Z"
 *       400:
 *         description: Validation error or duplicate email
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/",
  authenticate,
  authorize("super_admin", "admin"),
  userController.createUser
);



module.exports = router;