const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { sendSuccess } = require("../utils/response");
const AppError = require("../utils/AppError");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateAccessToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );

const generateRefreshToken = (user) =>
  jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d" }
  );

const generateResetToken = () =>
  require("crypto").randomBytes(32).toString("hex");

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Roles: super_admin, admin
 */
const register = async (req, res, next) => {
  try {
    const { role: requestedRole } = req.body;

    // RBAC: only admin-level can register users
    // Exception: super_admin can be created without a token (req.user will be undefined)
    if (requestedRole !== "super_admin") {
      if (!req.user || !["super_admin", "admin"].includes(req.user.role)) {
        return next(new AppError("You do not have permission to register users", 403));
      }
    }

    const {
      first_name, last_name, email, password, phone_number,
      role, language_preferences, regions,
    } = req.body;

    if (!first_name || !last_name || !email || !password || !role) {
      return next(new AppError("first_name, last_name, email, password and role are required", 400));
    }

    const validRoles = ["super_admin", "admin", "sales_manager", "sales_executive", "external_caller"];
    if (!validRoles.includes(role)) {
      return next(new AppError(`Invalid role. Must be one of: ${validRoles.join(", ")}`, 400));
    }

    // Prevent non-super_admin from creating super_admin
    if (role === "super_admin" && req.user && req.user.role !== "super_admin") {
      return next(new AppError("Only Super Admin can create another Super Admin", 403));
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return next(new AppError("A user with this email already exists", 400));
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users
        (first_name, last_name, email, password_hash, phone_number, role, language_preferences, regions, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING id, email, role, first_name, last_name, created_at`,
      [
        first_name.trim(), last_name.trim(), email.toLowerCase(),
        passwordHash, phone_number || null, role,
        Array.isArray(language_preferences) && language_preferences.length ? `{${language_preferences.join(',')}}` : (language_preferences ? `{${language_preferences}}` : '{en}'),
        Array.isArray(regions) && regions.length ? `{${regions.join(',')}}` : (regions ? `{${regions}}` : '{}'),
      ]
    );

    return sendSuccess(res, "User registered successfully", result.rows[0], 201);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email, phone_number, password } = req.body;
    
    if ((!email && !phone_number) || !password) {
      return next(new AppError("Email or phone number, and password are required", 400));
    }

    let result;
    if (email) {
      result = await pool.query(
        "SELECT * FROM users WHERE email = $1",
        [email.toLowerCase()]
      );
    } else {
      result = await pool.query(
        "SELECT * FROM users WHERE phone_number = $1",
        [phone_number]
      );
    }
    
    const user = result.rows[0];

    if (!user) return next(new AppError("Invalid credentials", 401));
    if (!user.is_active) return next(new AppError("Your account has been deactivated. Contact admin.", 401));

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return next(new AppError("Invalid credentials", 401));

    const accessToken  = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store refresh token
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, refreshToken]
    );

    // Update last_login
    await pool.query("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);

    const { password_hash, ...safeUser } = user;

    return sendSuccess(res, "Login successful", {
      access_token:  accessToken,
      refresh_token: refreshToken,
      expires_in:    process.env.JWT_EXPIRES_IN || "7d",
      user:          safeUser,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout
 */
const logout = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return next(new AppError("Refresh token is required", 400));

    await pool.query(
      "DELETE FROM refresh_tokens WHERE user_id = $1 AND token = $2",
      [req.user.id, refresh_token]
    );

    return sendSuccess(res, "Logged out successfully");
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/refresh-token
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return next(new AppError("Refresh token is required", 400));

    // Verify token signature
    let decoded;
    try {
      decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return next(new AppError("Invalid or expired refresh token", 401));
    }

    // Check token exists in DB
    const stored = await pool.query(
      "SELECT * FROM refresh_tokens WHERE user_id = $1 AND token = $2 AND expires_at > NOW()",
      [decoded.id, refresh_token]
    );
    if (stored.rows.length === 0) {
      return next(new AppError("Invalid or expired refresh token", 401));
    }

    const userResult = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND is_active = true",
      [decoded.id]
    );
    if (userResult.rows.length === 0) {
      return next(new AppError("User not found or inactive", 401));
    }

    const newAccessToken = generateAccessToken(userResult.rows[0]);

    return sendSuccess(res, "Token refreshed", {
      access_token: newAccessToken,
      expires_in:   process.env.JWT_EXPIRES_IN || "7d",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 */
const getMe = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, phone_number, role,
              language_preferences, regions, is_active, last_login, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return next(new AppError("User not found", 404));
    return sendSuccess(res, "User profile fetched", result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/auth/change-password
 */
const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return next(new AppError("current_password and new_password are required", 400));
    }
    if (new_password.length < 8) {
      return next(new AppError("New password must be at least 8 characters", 400));
    }

    const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    const isValid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!isValid) return next(new AppError("Current password is incorrect", 401));

    const isSame = await bcrypt.compare(new_password, result.rows[0].password_hash);
    if (isSame) return next(new AppError("New password cannot be same as current password", 400));

    const newHash = await bcrypt.hash(new_password, 12);
    await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [newHash, req.user.id]);

    // Invalidate all refresh tokens for this user
    await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [req.user.id]);

    return sendSuccess(res, "Password changed successfully. Please log in again.");
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/forgot-password
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return next(new AppError("Email is required", 400));

    const result = await pool.query(
      "SELECT id FROM users WHERE email = $1 AND is_active = true",
      [email.toLowerCase()]
    );

    // Always return 200 to prevent email enumeration
    if (result.rows.length > 0) {
      const token = generateResetToken();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3`,
        [result.rows[0].id, token, expiresAt]
      );

      // TODO: Send email via email service (nodemailer / sendgrid)
      // await emailService.sendPasswordReset(email, token);
      console.log(`[DEV] Password reset token for ${email}: ${token}`);
    }

    return sendSuccess(res, "If this email is registered, a reset link has been sent.");
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/reset-password
 */
const resetPassword = async (req, res, next) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return next(new AppError("token and new_password are required", 400));
    }
    if (new_password.length < 8) {
      return next(new AppError("Password must be at least 8 characters", 400));
    }

    const result = await pool.query(
      `SELECT user_id FROM password_reset_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );
    if (result.rows.length === 0) {
      return next(new AppError("Reset token is invalid or has expired", 400));
    }

    const userId = result.rows[0].user_id;
    const newHash = await bcrypt.hash(new_password, 12);

    await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [newHash, userId]);
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);

    return sendSuccess(res, "Password reset successfully. Please log in.");
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, logout, refreshToken, getMe, changePassword, forgotPassword, resetPassword };