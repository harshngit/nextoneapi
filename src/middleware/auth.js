const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { sendError } = require("../utils/response");
const AppError = require("../utils/AppError");
const { isWithinAccessWindow, formatISTTime, EXEMPT_ROLES } = require("../utils/istAccessWindow");

const authenticate = async (req, res, next) => {
  try {
    // Bypass authentication for super_admin and admin registration
    if (req.path === "/register" && req.body && ["super_admin", "admin"].includes(req.body.role)) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(new AppError("Access token required", 401));
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query("SELECT * FROM users WHERE id = $1 AND is_active = true", [decoded.id]);
    if (result.rows.length === 0) {
      return next(new AppError("User not found or inactive", 401));
    }
    const user = result.rows[0];

    // Non-admin roles are auto-logged-out outside 9:00 AM–9:00 PM IST, even
    // mid-session on a still-valid token — every request past the cutoff
    // fails, which is what forces the already-logged-in user off the app at 9 PM.
    if (!EXEMPT_ROLES.includes(user.role) && !isWithinAccessWindow()) {
      return next(new AppError(`Your session has ended — access is only allowed between 9:00 AM and 9:00 PM IST (current time is ${formatISTTime()} IST). Please log in again after 9:00 AM.`, 401));
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError("You do not have permission to perform this action", 403));
    }
    next();
  };
};

module.exports = { authenticate, authorize };
