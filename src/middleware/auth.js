const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { sendError } = require("../utils/response");

const authenticate = async (req, res, next) => {
  try {
    // Bypass authentication for super_admin registration
    if (req.path === "/register" && req.body && req.body.role === "super_admin") {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendError(res, "Access token required", 401);
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query("SELECT * FROM users WHERE id = $1 AND is_active = true", [decoded.id]);
    if (result.rows.length === 0) {
      return sendError(res, "User not found or inactive", 401);
    }
    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return sendError(res, "Invalid or expired token", 401);
    }
    return sendError(res, "Authentication failed", 500);
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return sendError(res, "You do not have permission to perform this action", 403);
    }
    next();
  };
};

module.exports = { authenticate, authorize };
