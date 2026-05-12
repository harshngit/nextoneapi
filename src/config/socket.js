const { Server } = require("socket.io");
const jwt        = require("jsonwebtoken");
const { pool }   = require("./db");

let io;

// ─── Allowed origins ──────────────────────────────────────────
// Production custom domain + local dev — no env vars needed
const ALLOWED_ORIGINS = [
  "https://nextonecrm.asynk.in",  // production custom domain
  "http://localhost:5173",         // Vite local dev
  "http://localhost:3000",         // fallback local dev
];

const initSocket = (httpServer) => {
  io = new Server(httpServer, {

    // ── CORS ─────────────────────────────────────────────────
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (Postman, mobile apps)
        if (!origin) return callback(null, true);

        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);

        console.warn(`[WS] Blocked origin: ${origin}`);
        return callback(new Error(`Origin ${origin} not allowed`));
      },
      methods:     ["GET", "POST"],
      credentials: true,
    },

    // ── Keep-alive — fixes Render's 5-minute idle disconnect ──
    // Render kills idle connections after 5 min.
    // pingInterval 25 s keeps the connection alive by sending
    // a PING before Render's idle timer fires.
    pingInterval: 25000,  // server pings client every 25 s
    pingTimeout:  60000,  // drop connection if no PONG in 60 s

    // ── WebSocket only ────────────────────────────────────────
    // Render's proxy can block the polling→WebSocket upgrade.
    // WebSocket-only skips polling and connects instantly.
    transports: ["websocket"],

    maxHttpBufferSize: 1e6,
  });

  // ─── JWT Auth Middleware ────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1];

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
      console.error("[WS] Auth error:", err.message);
      next(new Error("Invalid or expired token"));
    }
  });

  // ─── Connection Handler ─────────────────────────────────────
  io.on("connection", (socket) => {
    const user = socket.user;

    console.log(
      `[WS] Connected: ${user.first_name} ${user.last_name} (${user.role}) — ${socket.id}`
    );

    // Personal room — targeted notifications
    socket.join(`user:${user.id}`);

    // Role room — broadcast to all users of a role
    socket.join(`role:${user.role}`);

    socket.on("disconnect", (reason) => {
      console.log(
        `[WS] Disconnected: ${user.first_name} ${user.last_name} — ${reason}`
      );
    });

    socket.on("error", (err) => {
      console.error(`[WS] Socket error (${user.first_name}):`, err.message);
    });
  });

  return io;
};

// ─── Emit Helpers ───────────────────────────────────────────

/** Send event to one specific user */
const emitToUser = (userId, event, data) => {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
};

/** Send event to all users of a role */
const emitToRole = (role, event, data) => {
  if (!io) return;
  io.to(`role:${role}`).emit(event, data);
};

/** Broadcast to every connected socket */
const emitToAll = (event, data) => {
  if (!io) return;
  io.emit(event, data);
};

/** Get raw io instance */
const getIO = () => io;

module.exports = { initSocket, emitToUser, emitToRole, emitToAll, getIO };