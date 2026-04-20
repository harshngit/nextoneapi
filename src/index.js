const express = require("express");
const http = require("http");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const { initSocket } = require("./config/socket");

const app = express();
const server = http.createServer(app); // ← IMPORTANT: use http server for WS

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Swagger Docs ─────────────────────────────────────────────
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── Routes ───────────────────────────────────────────────────
app.use("/api/v1/auth",         require("./routes/auth.routes"));
app.use("/api/v1/users",        require("./routes/user.routes"));
app.use("/api/v1/leads",        require("./routes/leadRoutes"));
app.use("/api/v1/projects",     require("./routes/projectRoutes"));
app.use("/api/v1/site-visits",  require("./routes/siteVisitRoutes"));
app.use("/api/v1/tasks",        require("./routes/taskRoutes"));
app.use("/api/v1/notifications",require("./routes/notificationRoutes"));
app.use("/api/v1/dashboard",    require("./routes/dashboardRoutes"));

// ─── Init WebSocket ───────────────────────────────────────────
initSocket(server);

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api/docs`);
  console.log(`WebSocket ready on ws://localhost:${PORT}`);
});