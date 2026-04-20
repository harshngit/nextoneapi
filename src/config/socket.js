const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { pool } = require("./db");

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // ─── JWT Auth Middleware for Socket ──────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(" ")[1];
      if (!token) return next(new Error("Authentication token required"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await pool.query(
        "SELECT id, role, first_name, last_name FROM users WHERE id = $1 AND is_active = true",
        [decoded.id]
      );
      if (result.rows.length === 0) return next(new Error("User not found"));

      socket.user = result.rows[0];
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  // ─── Connection Handler ───────────────────────────────────────
  io.on("connection", (socket) => {
    const user = socket.user;
    console.log(`[WS] Connected: ${user.first_name} ${user.last_name} (${user.role}) — ${socket.id}`);

    // Join personal room for targeted notifications
    socket.join(`user:${user.id}`);

    // Join role-based room
    socket.join(`role:${user.role}`);

    socket.on("disconnect", () => {
      console.log(`[WS] Disconnected: ${user.first_name} ${user.last_name} — ${socket.id}`);
    });
  });

  return io;
};

// ─── Emit Helpers (used across controllers) ──────────────────

/**
 * Send notification to a specific user
 */
const emitToUser = (userId, event, data) => {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
};

/**
 * Send notification to all users of a role
 */
const emitToRole = (role, event, data) => {
  if (!io) return;
  io.to(`role:${role}`).emit(event, data);
};

/**
 * Broadcast to all connected clients
 */
const emitToAll = (event, data) => {
  if (!io) return;
  io.emit(event, data);
};

const getIO = () => io;

module.exports = { initSocket, emitToUser, emitToRole, emitToAll, getIO };
