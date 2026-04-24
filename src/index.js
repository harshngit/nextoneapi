const express = require("express");
const http = require("http");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const { initSocket } = require("./config/socket");
const { sendError } = require("./utils/response");
const AppError = require("./utils/AppError");

const app = express();
const server = http.createServer(app); // ← IMPORTANT: use http server for WS

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Swagger Docs ─────────────────────────────────────────────
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── Routes ───────────────────────────────────────────────────
app.use("/api/v1/auth",          require("./routes/auth.routes"));
app.use("/api/v1/users",         require("./routes/user.routes"));
app.use("/api/v1/leads",         require("./routes/leadRoutes"));
app.use("/api/v1/projects",      require("./routes/projectRoutes"));
app.use("/api/v1/site-visits",   require("./routes/siteVisitRoutes"));
app.use("/api/v1/tasks",         require("./routes/taskRoutes"));
app.use("/api/v1/notifications", require("./routes/notificationRoutes"));
app.use("/api/v1/dashboard",     require("./routes/dashboardRoutes"));

// ─── 404 Not Found Handler ──────────────────────────────────────
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// ─── Global Error Handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.message = err.message || "Internal Server Error";

  // PostgreSQL Unique Constraint Violation
  if (err.code === "23505") {
    err.statusCode = 400;
    const detail = err.detail || "";
    const match = detail.match(/\((.*?)\)=\((.*?)\)/);
    if (match) {
      err.message = `Duplicate field value: ${match[1]} '${match[2]}'. Please use another value!`;
    } else {
      err.message = "Duplicate field value entered!";
    }
  }

  // PostgreSQL Foreign Key Violation
  if (err.code === "23503") {
    err.statusCode = 400;
    const detail = err.detail || "";
    const match = detail.match(/Key \((.*?)\)=\((.*?)\) is not present in table "(.*?)"/);
    if (match) {
      err.message = `The referenced ${match[1]} '${match[2]}' does not exist in ${match[3]}.`;
    } else {
      err.message = "Referenced record not found!";
    }
  }

  // PostgreSQL Not Null Violation
  if (err.code === "23502") {
    err.statusCode = 400;
    err.message = `Field '${err.column}' cannot be empty!`;
  }

  // PostgreSQL Data Type Error (e.g. invalid UUID)
  if (err.code === "22P02") {
    err.statusCode = 400;
    err.message = "Invalid data format provided!";
  }

  // PostgreSQL String Data Right Truncation
  if (err.code === "22001") {
    err.statusCode = 400;
    err.message = "Value is too long for the field!";
  }

  // JWT Errors
  if (err.name === "JsonWebTokenError") {
    err.statusCode = 401;
    err.message = "Invalid token. Please log in again!";
  }
  if (err.name === "TokenExpiredError") {
    err.statusCode = 401;
    err.message = "Your token has expired! Please log in again.";
  }

  return sendError(res, err.message, err.statusCode, err);
});

// ─── Init WebSocket ───────────────────────────────────────────
initSocket(server);

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api/docs`);
  console.log(`WebSocket ready on ws://localhost:${PORT}`);
});