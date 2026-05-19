const path      = require("path");
const express   = require("express");
const http      = require("http");
const cors      = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const { initSocket }    = require("./config/socket");
const whatsappCron      = require("./config/whatsappCron");
const { sendError }  = require("./utils/response");
const AppError       = require("./utils/AppError");
const bulkLeadsRoutes = require('./routes/bulkLeadsRoutes');
const projectDocumentsRoutes = require('./routes/projectDocumentsRoutes');
const leadReassignRoutes = require('./routes/leadReassignRoutes');
const phoneRevealRoutes  = require('./routes/phoneRevealRoutes');

const app    = express();
const server = http.createServer(app);

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Static — serve uploaded files (attendance photos, etc.) ──
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ─── Swagger Docs ─────────────────────────────────────────────
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── Routes ───────────────────────────────────────────────────
// IMPORTANT: More specific routes MUST come BEFORE general routes!

// Lead-specific routes (most specific first)
app.use('/api/v1/leads/bulk', bulkLeadsRoutes);  // Must be BEFORE /api/v1/leads

app.use("/api/v1/auth",          require("./routes/auth.routes"));
app.use("/api/v1/users",         require("./routes/user.routes"));
app.use("/api/v1/leads",         leadReassignRoutes);  // Reassignment routes (includes /:id/reassign, /bulk-reassign, /:id/reassignment-history)
app.use("/api/v1/leads",         require("./routes/leadRoutes"));  // General lead routes
app.use("/api/v1/projects",      require("./routes/projectRoutes"));
app.use("/api/v1/site-visits",   require("./routes/siteVisitRoutes"));
app.use("/api/v1/tasks",         require("./routes/taskRoutes"));
app.use("/api/v1/notifications", require("./routes/notificationRoutes"));
app.use("/api/v1/dashboard",     require("./routes/dashboardRoutes"));
app.use("/api/v1/attendance",    require("./routes/attendanceRoutes"));
app.use("/api/v1/me",            require("./routes/myDataRoutes"));
app.use("/api/v1/export",        require("./routes/exportRoutes"));
app.use("/api/v1/convert",       require("./routes/conversionRoutes"));
app.use("/api/v1/team-history",  require("./routes/teamHistoryRoutes"));

// Project documents routes
app.use('/api/v1/projects',     projectDocumentsRoutes);
app.use('/api/v1/phone-reveal',  phoneRevealRoutes);


// ─── 404 Not Found Handler ────────────────────────────────────
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// ─── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.message    = err.message    || "Internal Server Error";

  if (err.code === "23505") {
    err.statusCode = 400;
    const detail = err.detail || "";
    const match  = detail.match(/\((.*?)\)=\((.*?)\)/);
    err.message  = match
      ? `Duplicate field value: ${match[1]} '${match[2]}'. Please use another value!`
      : "Duplicate field value entered!";
  }

  if (err.code === "23503") {
    err.statusCode = 400;
    const detail = err.detail || "";
    const match  = detail.match(/Key \((.*?)\)=\((.*?)\) is not present in table "(.*?)"/);
    err.message  = match
      ? `The referenced ${match[1]} '${match[2]}' does not exist in ${match[3]}.`
      : "Referenced record not found!";
  }

  if (err.code === "23502") { err.statusCode = 400; err.message = `Field '${err.column}' cannot be empty!`; }
  if (err.code === "22P02") { err.statusCode = 400; err.message = "Invalid data format provided!"; }
  if (err.code === "22001") { err.statusCode = 400; err.message = "Value is too long for the field!"; }

  if (err.name === "JsonWebTokenError") { err.statusCode = 401; err.message = "Invalid token. Please log in again!"; }
  if (err.name === "TokenExpiredError") { err.statusCode = 401; err.message = "Your token has expired! Please log in again."; }

  return sendError(res, err.message, err.statusCode, err);
});

// ─── Init WebSocket ───────────────────────────────────────────
initSocket(server);
whatsappCron.start();

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api/docs`);
  console.log(`WebSocket ready on ws://localhost:${PORT}`);
});