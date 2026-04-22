const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication and access control endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - first_name
 *         - last_name
 *         - email
 *         - password
 *         - role
 *       properties:
 *         first_name:
 *           type: string
 *           example: "Shubham"
 *         last_name:
 *           type: string
 *           example: "Shinde"
 *         email:
 *           type: string
 *           format: email
 *           example: "shubham.shinde@nextonerealty.com"
 *         password:
 *           type: string
 *           minLength: 8
 *           example: "Shinde@123"
 *         phone_number:
 *           type: string
 *           example: "+918850773797"
 *         role:
 *           type: string
 *           enum:
 *             - super_admin
 *             - admin
 *             - sales_manager
 *             - sales_executive
 *             - external_caller
 *           example: "super_admin"
 *         language_preferences:
 *           type: string
 *           example: "en"
 *           description: Language code. Default is "en"
 *         regions:
 *           type: array
 *           items:
 *             type: string
 *           example: ["Mumbai", "Pune"]
 *           description: List of cities or regions the user operates in
 *         manager_id:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           example: null
 *           description: Required when role is sales_executive. UUID of the Sales Manager.
 *
 *     LoginRequest:
 *       type: object
 *       required:
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: "shubham.shinde@nextonerealty.com"
 *           description: Either email or phone_number is required
 *         phone_number:
 *           type: string
 *           example: "+918850773797"
 *           description: Either email or phone_number is required
 *         password:
 *           type: string
 *           example: "Shinde@123"
 *
 *     LoginResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Login successful"
 *         data:
 *           type: object
 *           properties:
 *             access_token:
 *               type: string
 *               example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *             refresh_token:
 *               type: string
 *               example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *             expires_in:
 *               type: string
 *               example: "7d"
 *             user:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 first_name:
 *                   type: string
 *                 last_name:
 *                   type: string
 *                 email:
 *                   type: string
 *                 phone_number:
 *                   type: string
 *                 role:
 *                   type: string
 *                 is_active:
 *                   type: boolean
 *                 last_login:
 *                   type: string
 *                   format: date-time
 *
 *     RefreshTokenRequest:
 *       type: object
 *       required:
 *         - refresh_token
 *       properties:
 *         refresh_token:
 *           type: string
 *           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *
 *     ChangePasswordRequest:
 *       type: object
 *       required:
 *         - current_password
 *         - new_password
 *       properties:
 *         current_password:
 *           type: string
 *           example: "OldPass@123"
 *         new_password:
 *           type: string
 *           minLength: 8
 *           example: "NewPass@456"
 *
 *     ForgotPasswordRequest:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: "shubham.shinde@nextonerealty.com"
 *
 *     ResetPasswordRequest:
 *       type: object
 *       required:
 *         - token
 *         - new_password
 *       properties:
 *         token:
 *           type: string
 *           example: "a1b2c3d4e5f6g7h8..."
 *           description: Token received in the reset password email
 *         new_password:
 *           type: string
 *           minLength: 8
 *           example: "NewSecurePass@789"
 *
 *     SuccessResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Operation successful"
 *         data:
 *           type: object
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "Something went wrong"
 *         error:
 *           type: string
 *           example: "Detailed error description"
 */

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES — No token required
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     description: >
 *       Creates a new user account in the system.
 *
 *       **No token required when creating a `super_admin`** — this is the
 *       first-time setup scenario. For all other roles (admin, sales_manager,
 *       sales_executive, external_caller), a valid Bearer token belonging to a
 *       super_admin or admin is required.
 *
 *       When creating a `sales_executive`, the `manager_id` field is required
 *       to assign them under a Sales Manager.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *           examples:
 *             CreateSuperAdmin:
 *               summary: Create Super Admin (no token needed)
 *               value:
 *                 first_name: "Shubham"
 *                 last_name: "Shinde"
 *                 email: "shubhamshinde@gmail.com"
 *                 password: "Shinde@123"
 *                 phone_number: "+918850773797"
 *                 role: "super_admin"
 *                 language_preferences: "en"
 *                 regions: ["Mumbai", "Pune"]
 *             CreateSalesExecutive:
 *               summary: Create Sales Executive (token required)
 *               value:
 *                 first_name: "Rahul"
 *                 last_name: "Sharma"
 *                 email: "rahul.sharma@nextonerealty.com"
 *                 password: "StrongPass@123"
 *                 phone_number: "+919876543210"
 *                 role: "sales_executive"
 *                 language_preferences: "en"
 *                 regions: ["Mumbai"]
 *                 manager_id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *             CreateSalesManager:
 *               summary: Create Sales Manager (token required)
 *               value:
 *                 first_name: "Amit"
 *                 last_name: "Joshi"
 *                 email: "amit.joshi@nextonerealty.com"
 *                 password: "TempPass@321"
 *                 phone_number: "+919012345678"
 *                 role: "sales_manager"
 *                 regions: ["Pune"]
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               message: "User registered successfully"
 *               data:
 *                 id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 email: "shubhamshinde@gmail.com"
 *                 role: "super_admin"
 *                 first_name: "Shubham"
 *                 last_name: "Shinde"
 *                 created_at: "2025-04-22T10:00:00Z"
 *       400:
 *         description: Validation error or email already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               MissingFields:
 *                 summary: Missing required fields
 *                 value:
 *                   success: false
 *                   message: "first_name, last_name, email, password and role are required"
 *               DuplicateEmail:
 *                 summary: Email already registered
 *                 value:
 *                   success: false
 *                   message: "A user with this email already exists"
 *               InvalidRole:
 *                 summary: Invalid role value
 *                 value:
 *                   success: false
 *                   message: "Invalid role. Must be one of: super_admin, admin, sales_manager, sales_executive, external_caller"
 *       403:
 *         description: Forbidden — insufficient role permissions
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "You do not have permission to register users"
 */
router.post("/register", authController.register);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login with email or phone number
 *     description: >
 *       Authenticates a user using either their **email** or **phone number**
 *       along with their password. Returns a JWT access token (expires in 7 days)
 *       and a refresh token (expires in 30 days).
 *
 *       Store the `access_token` in memory and the `refresh_token` in secure
 *       storage (httpOnly cookie for web, SecureStorage for mobile).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           examples:
 *             LoginWithEmail:
 *               summary: Login using email
 *               value:
 *                 email: "shubhamshinde@gmail.com"
 *                 password: "Shinde@123"
 *             LoginWithPhone:
 *               summary: Login using phone number
 *               value:
 *                 phone_number: "+918850773797"
 *                 password: "Shinde@123"
 *     responses:
 *       200:
 *         description: Login successful — returns tokens and user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *             example:
 *               success: true
 *               message: "Login successful"
 *               data:
 *                 access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 expires_in: "7d"
 *                 user:
 *                   id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   first_name: "Shubham"
 *                   last_name: "Shinde"
 *                   email: "shubhamshinde@gmail.com"
 *                   phone_number: "+918850773797"
 *                   role: "super_admin"
 *                   is_active: true
 *                   last_login: "2025-04-22T10:00:00Z"
 *       400:
 *         description: Missing email/phone or password
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Email or phone number, and password are required"
 *       401:
 *         description: Wrong credentials or account deactivated
 *         content:
 *           application/json:
 *             examples:
 *               InvalidCredentials:
 *                 summary: Wrong email or password
 *                 value:
 *                   success: false
 *                   message: "Invalid credentials"
 *               AccountDeactivated:
 *                 summary: Account is deactivated
 *                 value:
 *                   success: false
 *                   message: "Your account has been deactivated. Contact admin."
 */
router.post("/login", authController.login);

/**
 * @swagger
 * /api/v1/auth/refresh-token:
 *   post:
 *     summary: Get a new access token using refresh token
 *     description: >
 *       Use this endpoint when the access token has expired (you receive a 401).
 *       Pass the stored refresh token to receive a new access token without
 *       requiring the user to log in again.
 *
 *       The refresh token is **not rotated** — it stays valid until its 30-day
 *       expiry or until the user logs out.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *           example:
 *             refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     responses:
 *       200:
 *         description: New access token issued successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Token refreshed"
 *               data:
 *                 access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 expires_in: "7d"
 *       401:
 *         description: Refresh token is invalid or expired
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Invalid or expired refresh token"
 */
router.post("/refresh-token", authController.refreshToken);

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Send password reset link to email
 *     description: >
 *       Sends a password reset link to the provided email address.
 *       The reset token is valid for **15 minutes**.
 *
 *       This endpoint **always returns 200** even if the email is not found —
 *       this is intentional to prevent email enumeration attacks.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *           example:
 *             email: "shubhamshinde@gmail.com"
 *     responses:
 *       200:
 *         description: Always returns 200 for security reasons
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "If this email is registered, a reset link has been sent."
 */
router.post("/forgot-password", authController.forgotPassword);

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Reset password using the token from email
 *     description: >
 *       Resets the user's password using the token received in the
 *       forgot-password email. The token is **single-use** and expires
 *       after 15 minutes.
 *
 *       After a successful reset, all existing sessions (refresh tokens)
 *       for that user are invalidated.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *           example:
 *             token: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6..."
 *             new_password: "NewSecurePass@789"
 *     responses:
 *       200:
 *         description: Password reset successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Password reset successfully. Please log in."
 *       400:
 *         description: Token is invalid or has expired
 *         content:
 *           application/json:
 *             examples:
 *               InvalidToken:
 *                 summary: Token not found or expired
 *                 value:
 *                   success: false
 *                   message: "Reset token is invalid or has expired"
 *               ShortPassword:
 *                 summary: Password too short
 *                 value:
 *                   success: false
 *                   message: "Password must be at least 8 characters"
 */
router.post("/reset-password", authController.resetPassword);

// ─────────────────────────────────────────────────────────────
// PROTECTED ROUTES — Bearer token required
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout and invalidate refresh token
 *     description: >
 *       Removes the refresh token from the database, invalidating the session.
 *       The access token will remain technically valid until it naturally expires,
 *       so the client must also delete both tokens from local storage.
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *           example:
 *             refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Logged out successfully"
 *       400:
 *         description: Refresh token missing in request body
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Refresh token is required"
 *       401:
 *         description: Access token missing or invalid
 */
router.post("/logout", authenticate, authController.logout);

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current authenticated user profile
 *     description: >
 *       Returns the full profile of the currently logged-in user based on
 *       the Bearer token. Call this on app load to restore the session.
 *       The password hash is never included in the response.
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile returned successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "User profile fetched"
 *               data:
 *                 id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 first_name: "Shubham"
 *                 last_name: "Shinde"
 *                 email: "shubhamshinde@gmail.com"
 *                 phone_number: "+918850773797"
 *                 role: "super_admin"
 *                 language_preferences: ["en"]
 *                 regions: ["Mumbai", "Pune"]
 *                 is_active: true
 *                 last_login: "2025-04-22T10:00:00Z"
 *                 created_at: "2025-04-22T09:00:00Z"
 *                 updated_at: "2025-04-22T09:00:00Z"
 *       401:
 *         description: Token missing, invalid, or expired
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Invalid data format provided!"
 *       404:
 *         description: User not found
 */
router.get("/me", authenticate, authController.getMe);

/**
 * @swagger
 * /api/v1/auth/change-password:
 *   put:
 *     summary: Change password for logged-in user
 *     description: >
 *       Allows the currently authenticated user to change their own password.
 *       Requires the current password for verification.
 *
 *       After a successful change, **all refresh tokens** for this user are
 *       invalidated — they will need to log in again on all devices.
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *           example:
 *             current_password: "Shinde@123"
 *             new_password: "NewShinde@456"
 *     responses:
 *       200:
 *         description: Password changed — all sessions invalidated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Password changed successfully. Please log in again."
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             examples:
 *               SamePassword:
 *                 summary: New password same as current
 *                 value:
 *                   success: false
 *                   message: "New password cannot be same as current password"
 *               TooShort:
 *                 summary: Password too short
 *                 value:
 *                   success: false
 *                   message: "New password must be at least 8 characters"
 *       401:
 *         description: Current password is wrong or token invalid
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Current password is incorrect"
 */
router.put("/change-password", authenticate, authController.changePassword);

module.exports = router;