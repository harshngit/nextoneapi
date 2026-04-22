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
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - first_name
 *         - last_name
 *         - email
 *         - phone_number
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
 *           example: "shubhamshinde@gmail.com"
 *         phone_number:
 *           type: string
 *           example: "+918850773797"
 *         password:
 *           type: string
 *           minLength: 8
 *           example: "Shinde@123"
 *         role:
 *           type: string
 *           enum:
 *             - super_admin
 *             - admin
 *             - sales_manager
 *             - sales_executive
 *             - external_caller
 *           example: "super_admin"
 *
 *     RegisterResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "User registered successfully"
 *         data:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               format: uuid
 *               example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *             email:
 *               type: string
 *               example: "shubhamshinde@gmail.com"
 *             first_name:
 *               type: string
 *               example: "Shubham"
 *             last_name:
 *               type: string
 *               example: "Shinde"
 *             phone_number:
 *               type: string
 *               example: "+918850773797"
 *             role:
 *               type: string
 *               example: "super_admin"
 *             is_active:
 *               type: boolean
 *               example: true
 *             created_at:
 *               type: string
 *               format: date-time
 *               example: "2025-04-22T10:00:00Z"
 *
 *     LoginRequest:
 *       type: object
 *       required:
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: "shubhamshinde@gmail.com"
 *           description: Use either email or phone_number
 *         phone_number:
 *           type: string
 *           example: "+918850773797"
 *           description: Use either email or phone_number
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
 *           example: "Shinde@123"
 *         new_password:
 *           type: string
 *           minLength: 8
 *           example: "NewShinde@456"
 *
 *     ForgotPasswordRequest:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: "shubhamshinde@gmail.com"
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
 *       Creates a new user account.
 *
 *       **No token required when creating `super_admin`** — this is the
 *       first-time setup. For all other roles a valid Bearer token from
 *       a super_admin or admin is required.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *           examples:
 *             SuperAdmin:
 *               summary: Create Super Admin (no token needed)
 *               value:
 *                 first_name: "Shubham"
 *                 last_name: "Shinde"
 *                 email: "shubhamshinde@gmail.com"
 *                 phone_number: "+918850773797"
 *                 password: "Shinde@123"
 *                 role: "super_admin"
 *             Admin:
 *               summary: Create Admin (token required)
 *               value:
 *                 first_name: "Amit"
 *                 last_name: "Joshi"
 *                 email: "amit.joshi@nextonerealty.com"
 *                 phone_number: "+919012345678"
 *                 password: "TempPass@321"
 *                 role: "admin"
 *             SalesManager:
 *               summary: Create Sales Manager (token required)
 *               value:
 *                 first_name: "Priya"
 *                 last_name: "Mehta"
 *                 email: "priya.mehta@nextonerealty.com"
 *                 phone_number: "+919123456789"
 *                 password: "TempPass@321"
 *                 role: "sales_manager"
 *             SalesExecutive:
 *               summary: Create Sales Executive (token required)
 *               value:
 *                 first_name: "Rahul"
 *                 last_name: "Sharma"
 *                 email: "rahul.sharma@nextonerealty.com"
 *                 phone_number: "+919876543210"
 *                 password: "TempPass@123"
 *                 role: "sales_executive"
 *             ExternalCaller:
 *               summary: Create External Caller (token required)
 *               value:
 *                 first_name: "Neha"
 *                 last_name: "Patil"
 *                 email: "neha.patil@nextonerealty.com"
 *                 phone_number: "+919988776655"
 *                 password: "TempPass@321"
 *                 role: "external_caller"
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RegisterResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               MissingFields:
 *                 value:
 *                   success: false
 *                   message: "first_name, last_name, email, phone_number, password and role are required"
 *               DuplicateEmail:
 *                 value:
 *                   success: false
 *                   message: "A user with this email already exists"
 *               DuplicatePhone:
 *                 value:
 *                   success: false
 *                   message: "A user with this phone number already exists"
 *               InvalidRole:
 *                 value:
 *                   success: false
 *                   message: "Invalid role. Must be one of: super_admin, admin, sales_manager, sales_executive, external_caller"
 *       403:
 *         description: Forbidden
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
 *       Login using either **email** or **phone number** with password.
 *       Returns JWT access token (7 days) and refresh token (30 days).
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
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Missing credentials
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Email or phone number, and password are required"
 *       401:
 *         description: Wrong credentials or deactivated account
 *         content:
 *           application/json:
 *             examples:
 *               InvalidCredentials:
 *                 value:
 *                   success: false
 *                   message: "Invalid credentials"
 *               Deactivated:
 *                 value:
 *                   success: false
 *                   message: "Your account has been deactivated. Contact admin."
 */
router.post("/login", authController.login);

/**
 * @swagger
 * /api/v1/auth/refresh-token:
 *   post:
 *     summary: Get new access token using refresh token
 *     description: >
 *       Call this when the access token has expired (401 response).
 *       The refresh token is valid for 30 days and is not rotated.
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
 *         description: New access token issued
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Token refreshed"
 *               data:
 *                 access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 expires_in: "7d"
 *       401:
 *         description: Refresh token invalid or expired
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
 *       Always returns 200 even if email is not found — prevents email enumeration.
 *       Reset token is valid for 15 minutes.
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
 *         description: Always 200 for security
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
 *     summary: Reset password using token from email
 *     description: >
 *       Single-use token valid for 15 minutes. All sessions are
 *       invalidated after a successful reset.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *           example:
 *             token: "a1b2c3d4e5f6g7h8i9j0..."
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
 *         description: Token invalid or expired
 *         content:
 *           application/json:
 *             examples:
 *               InvalidToken:
 *                 value:
 *                   success: false
 *                   message: "Reset token is invalid or has expired"
 *               ShortPassword:
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
 *       Removes the refresh token from the database.
 *       Client must also delete both tokens from local storage.
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
 *         description: Missing refresh token
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
 *       Returns profile of the logged-in user. Call on app load to restore session.
 *       Password hash is never returned.
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile returned
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
 *                 is_active: true
 *                 last_login: "2025-04-22T10:00:00Z"
 *                 created_at: "2025-04-22T09:00:00Z"
 *                 updated_at: "2025-04-22T09:00:00Z"
 *       401:
 *         description: Token missing or invalid
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
 *       Requires current password for verification. After success, all
 *       existing sessions are invalidated — user must log in again on all devices.
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
 *                 value:
 *                   success: false
 *                   message: "New password cannot be same as current password"
 *               TooShort:
 *                 value:
 *                   success: false
 *                   message: "New password must be at least 8 characters"
 *       401:
 *         description: Wrong current password
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Current password is incorrect"
 */
router.put("/change-password", authenticate, authController.changePassword);

module.exports = router;