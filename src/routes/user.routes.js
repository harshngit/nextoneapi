const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
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
  authorize("super_admin", "admin", "sales_manager"),
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
router.get("/:id", authenticate, userController.getUserById);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   put:
 *     summary: Update user details
 *     description: >
 *       Updates profile information for a user.
 *       Super Admin and Admin can update any user.
 *       Users can update their own profile (excluding role and email).
 *       Email and role cannot be changed via this endpoint — use dedicated endpoints for those.
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
 *             $ref: '#/components/schemas/UpdateUserRequest'
 *           example:
 *             first_name: "Rahul"
 *             last_name: "Sharma"
 *             phone_number: "+919876543999"
 *             manager_id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
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
 *                 phone_number: "+919876543999"
 *                 address: "102, Andheri West, Mumbai - 400053"
 *                 emergency_contact_number: "+919876543211"
 *       400:
 *         description: Validation error
 *       403:
 *         description: Cannot update another user's profile
 *       404:
 *         description: User not found
 */
router.put("/:id", authenticate, userController.updateUser);

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