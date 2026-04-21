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
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     description: >
 *       Creates a new user account. Only accessible by Super Admin or Admin.
 *       The role assigned determines what modules the user can access.
 *       A temporary password is set and the user will be prompted to change it on first login.
 *       **Note:** Authentication token is not required if the role being created is 'super_admin'.
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *           example:
 *             first_name: "Rahul"
 *             last_name: "Sharma"
 *             email: "rahul.sharma@nextonerealty.com"
 *             password: "StrongPass@123"
 *             phone_number: "+919876543210"
 *             role: "sales_executive"
 *             language_preferences: "en"
 *             regions: ["Mumbai", "Pune"]
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
 *                 email: "rahul.sharma@nextonerealty.com"
 *                 role: "sales_executive"
 *       400:
 *         description: Validation error or email already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Email already in use"
 *       401:
 *         description: Unauthorized – token missing or invalid
 *       403:
 *         description: Forbidden – insufficient role permissions
 */
router.post("/register", authenticate, authController.register);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login with email and password
 *     description: >
 *       Authenticates a user with their email and password.
 *       Returns a short-lived JWT access token and a long-lived refresh token.
 *       Store the refresh token securely (httpOnly cookie recommended for web,
 *       secure storage for mobile).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             email: "rahul.sharma@nextonerealty.com"
 *             password: "StrongPass@123"
 *     responses:
 *       200:
 *         description: Login successful
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
 *                   first_name: "Rahul"
 *                   last_name: "Sharma"
 *                   email: "rahul.sharma@nextonerealty.com"
 *                   role: "sales_executive"
 *                   is_active: true
 *       400:
 *         description: Missing email or password
 *       401:
 *         description: Invalid credentials or account deactivated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Invalid email or password"
 */
router.post("/login", authController.login);

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout and invalidate refresh token
 *     description: >
 *       Invalidates the provided refresh token by removing it from the database.
 *       After logout, the access token will still be valid until it expires naturally.
 *       Client should delete both tokens from local storage on their end.
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
 *       401:
 *         description: Unauthorized
 */
router.post("/logout", authenticate, authController.logout);

/**
 * @swagger
 * /api/v1/auth/refresh-token:
 *   post:
 *     summary: Get new access token using refresh token
 *     description: >
 *       Issues a new JWT access token using a valid refresh token.
 *       Use this when the access token has expired (401 response).
 *       The refresh token itself is NOT rotated on each call — it remains valid
 *       until its own expiry (30 days) or until the user explicitly logs out.
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
 * /api/v1/auth/me:
 *   get:
 *     summary: Get currently authenticated user profile
 *     description: >
 *       Returns the full profile of the currently logged-in user based on
 *       the JWT access token. Used on app load to restore session state.
 *       Password hash is never returned.
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile returned successfully
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
 *                 language_preferences: "en"
 *                 regions: ["Mumbai", "Pune"]
 *                 is_active: true
 *                 last_login: "2025-04-20T10:30:00Z"
 *                 created_at: "2025-01-15T09:00:00Z"
 *       401:
 *         description: Token missing, invalid, or expired
 */
router.get("/me", authenticate, authController.getMe);

/**
 * @swagger
 * /api/v1/auth/change-password:
 *   put:
 *     summary: Change password for logged-in user
 *     description: >
 *       Allows an authenticated user to change their own password.
 *       Requires the current password for verification before updating.
 *       After a successful change, all existing refresh tokens for this user
 *       are invalidated — the user will need to log in again on other devices.
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
 *             current_password: "OldPass@123"
 *             new_password: "NewStrongPass@456"
 *     responses:
 *       200:
 *         description: Password changed successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Password changed successfully. Please log in again."
 *       400:
 *         description: New password same as old, or validation failed
 *       401:
 *         description: Current password is incorrect
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Current password is incorrect"
 */
router.put("/change-password", authenticate, authController.changePassword);

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Send password reset link to email
 *     description: >
 *       Sends a password reset link/OTP to the registered email address.
 *       The reset token is valid for 15 minutes.
 *       For security reasons, this endpoint always returns 200 even if the
 *       email is not found — to prevent email enumeration attacks.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *           example:
 *             email: "rahul.sharma@nextonerealty.com"
 *     responses:
 *       200:
 *         description: Reset link sent (always returns 200 for security)
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
 *       Resets the user's password using the token received via the forgot-password email.
 *       Token is single-use and expires after 15 minutes.
 *       After reset, all existing sessions (refresh tokens) are invalidated.
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
 *             new_password: "ResetPass@789"
 *     responses:
 *       200:
 *         description: Password reset successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Password reset successfully. Please log in."
 *       400:
 *         description: Token expired or invalid
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Reset token is invalid or has expired"
 */
router.post("/reset-password", authController.resetPassword);

module.exports = router;