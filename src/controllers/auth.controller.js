const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { sendSuccess, sendError } = require("../utils/response");

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });

// Register
const register = async (req, res) => {
  try {
    const { email, first_name, last_name, phone_number, password, role } = req.body;
    if (!email || !first_name || !last_name || !phone_number || !password || !role) {
      return sendError(res, "All fields are required", 400);
    }
    const validRoles = ["superadmin", "admin", "sales_manager", "sales_executive", "external_caller"];
    if (!validRoles.includes(role)) {
      return sendError(res, "Invalid role", 400);
    }
    const existing = await pool.query("SELECT id FROM users WHERE email = $1 OR phone_number = $2", [email, phone_number]);
    if (existing.rows.length > 0) {
      return sendError(res, "Email or phone number already registered", 409);
    }
    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);
    const id = uuidv4();
    const result = await pool.query(
      "INSERT INTO users (id, email, first_name, last_name, phone_number, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [id, email.toLowerCase(), first_name, last_name, phone_number, password_hash, role]
    );
    const user = result.rows[0];
    const token = generateToken(user.id);
    return sendSuccess(res, { user, token }, "User registered successfully", 201);
  } catch (err) {
    console.error("Register error:", err);
    return sendError(res, "Registration failed", 500);
  }
};

// Login
const login = async (req, res) => {
  try {
    const { email, phone_number, password } = req.body;
    if (!password || (!email && !phone_number)) {
      return sendError(res, "Email or phone number and password are required", 400);
    }
    let query, params;
    if (email) {
      query = "SELECT * FROM users WHERE email = $1 AND is_active = true";
      params = [email.toLowerCase()];
    } else {
      query = "SELECT * FROM users WHERE phone_number = $1 AND is_active = true";
      params = [phone_number];
    }
    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return sendError(res, "Invalid credentials", 401);
    }
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return sendError(res, "Invalid credentials", 401);
    }
    await pool.query("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);
    const token = generateToken(user.id);
    const { password_hash, ...userData } = user;
    return sendSuccess(res, { user: userData, token }, "Login successful");
  } catch (err) {
    console.error("Login error:", err);
    return sendError(res, "Login failed", 500);
  }
};

// Auth Me
const authMe = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [req.user.id]
    );
    return sendSuccess(res, { user: result.rows[0] }, "User details fetched");
  } catch (err) {
    console.error("AuthMe error:", err);
    return sendError(res, "Failed to fetch user details", 500);
  }
};

// Forgot Password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return sendError(res, "Email is required", 400);
    const result = await pool.query("SELECT id FROM users WHERE email = $1 AND is_active = true", [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return sendSuccess(res, {}, "If this email exists, a reset link will be sent");
    }
    const userId = result.rows[0].id;
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await pool.query(
      "INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)",
      [uuidv4(), userId, resetToken, expiresAt]
    );
    // TODO: Send email with resetToken
    return sendSuccess(res, { reset_token: resetToken }, "Password reset token generated");
  } catch (err) {
    console.error("ForgotPassword error:", err);
    return sendError(res, "Failed to process forgot password", 500);
  }
};

// Change Password
const changePassword = async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) return sendError(res, "Token and new password are required", 400);
    if (new_password.length < 6) return sendError(res, "Password must be at least 6 characters", 400);
    const result = await pool.query(
      "SELECT * FROM password_reset_tokens WHERE token = $1 AND used = false AND expires_at > NOW()",
      [token]
    );
    if (result.rows.length === 0) {
      return sendError(res, "Invalid or expired reset token", 400);
    }
    const { user_id, id: tokenId } = result.rows[0];
    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(new_password, salt);
    await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [password_hash, user_id]);
    await pool.query("UPDATE password_reset_tokens SET used = true WHERE id = $1", [tokenId]);
    return sendSuccess(res, {}, "Password changed successfully");
  } catch (err) {
    console.error("ChangePassword error:", err);
    return sendError(res, "Failed to change password", 500);
  }
};

module.exports = { register, login, authMe, forgotPassword, changePassword };
