const { pool } = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");
const { emitToUser } = require("../config/socket");

const VALID_PRIORITIES = ["low", "medium", "high"];

/**
 * GET /api/v1/tasks
 */
const getAllTasks = async (req, res, next) => {
  try {
    const { is_completed, lead_id, assigned_to, due_from, due_to, overdue, page = 1, per_page = 20 } = req.query;
    const { role, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params = [];
    let idx = 1;

    if (role === "sales_executive") { conditions.push(`t.assigned_to = $${idx++}`); params.push(callerId); }
    else if (role === "sales_manager") { conditions.push(`u.manager_id = $${idx++}`); params.push(callerId); }

    if (is_completed !== undefined) { conditions.push(`t.is_completed = $${idx++}`); params.push(is_completed === "true"); }
    if (lead_id)     { conditions.push(`t.lead_id = $${idx++}`);               params.push(lead_id); }
    if (assigned_to) { conditions.push(`t.assigned_to = $${idx++}`);           params.push(assigned_to); }
    if (due_from)    { conditions.push(`t.due_date::date >= $${idx++}`);       params.push(due_from); }
    if (due_to)      { conditions.push(`t.due_date::date <= $${idx++}`);       params.push(due_to); }
    if (overdue === "true") { conditions.push(`t.due_date < NOW() AND t.is_completed = false`); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT t.id, t.title, t.lead_id, t.due_date, t.priority, t.notes,
              t.is_completed, t.completed_at, t.created_at,
              l.name AS lead_name,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       LEFT JOIN users u ON u.id = t.assigned_to
       ${where}
       ORDER BY t.is_completed ASC, t.due_date ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/tasks
 */
const createTask = async (req, res, next) => {
  try {
    const { title, lead_id, due_date, assigned_to, priority = "medium", notes } = req.body;
    if (!title || !lead_id || !due_date) {
      return next(new AppError("title, lead_id, and due_date are required", 400));
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      return next(new AppError("priority must be low, medium, or high", 400));
    }

    const lead = await pool.query("SELECT id, assigned_to FROM leads WHERE id = $1 AND is_archived = false", [lead_id]);
    if (lead.rows.length === 0) return next(new AppError("Lead not found", 404));

    const execId = assigned_to || lead.rows[0].assigned_to || req.user.id;

    const result = await pool.query(
      `INSERT INTO tasks (title, lead_id, due_date, assigned_to, priority, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title.trim(), lead_id, due_date, execId, priority, notes || null, req.user.id]
    );

    const task = result.rows[0];

    // WebSocket: notify assigned user
    emitToUser(execId, "task:created", {
      id: task.id, title: task.title, lead_id: task.lead_id,
      due_date: task.due_date, priority: task.priority,
    });

    // Also emit notification:new
    emitToUser(execId, "notification:new", {
      type: "task_created",
      title: "New Task Assigned",
      message: `Task: ${task.title} — due ${new Date(task.due_date).toLocaleDateString()}`,
      reference_id: task.id,
      reference_type: "task",
    });

    return sendSuccess(res, "Task created successfully", task, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/tasks/today
 */
const getTodayTasks = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().split("T")[0];

    const [overdue, dueToday, completedToday] = await Promise.all([
      pool.query(
        `SELECT t.id, t.title, t.due_date, t.priority, l.name AS lead_name
         FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
         WHERE t.assigned_to = $1 AND t.is_completed = false AND t.due_date::date < $2
         ORDER BY t.due_date ASC`,
        [userId, today]
      ),
      pool.query(
        `SELECT t.id, t.title, t.due_date, t.priority, l.name AS lead_name
         FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
         WHERE t.assigned_to = $1 AND t.is_completed = false AND t.due_date::date = $2
         ORDER BY t.due_date ASC`,
        [userId, today]
      ),
      pool.query(
        `SELECT t.id, t.title, t.completed_at, l.name AS lead_name
         FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
         WHERE t.assigned_to = $1 AND t.is_completed = true AND t.completed_at::date = $2
         ORDER BY t.completed_at DESC`,
        [userId, today]
      ),
    ]);

    return sendSuccess(res, "Today's tasks fetched", {
      summary: {
        due_today: dueToday.rows.length,
        overdue: overdue.rows.length,
        completed_today: completedToday.rows.length,
      },
      overdue: overdue.rows,
      due_today: dueToday.rows,
      completed_today: completedToday.rows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/tasks/:id
 */
const getTaskById = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.*, l.name AS lead_name,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_name
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return next(new AppError("Task not found", 404));
    return sendSuccess(res, "Task fetched", result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/tasks/:id
 */
const updateTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Task not found", 404));

    const { title, due_date, priority, notes } = req.body;
    const updates = []; const params = []; let idx = 1;

    if (title)             { updates.push(`title = $${idx++}`);    params.push(title.trim()); }
    if (due_date)          { updates.push(`due_date = $${idx++}`); params.push(due_date); }
    if (priority) {
      if (!VALID_PRIORITIES.includes(priority)) return next(new AppError("Invalid priority", 400));
      updates.push(`priority = $${idx++}`); params.push(priority);
    }
    if (notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(notes); }
    if (updates.length === 0) return next(new AppError("No fields to update", 400));
    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE tasks SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`, params
    );

    const task = result.rows[0];
    emitToUser(task.assigned_to, "task:updated", {
      id: task.id, title: task.title, due_date: task.due_date, priority: task.priority,
    });

    return sendSuccess(res, "Task updated successfully", task);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/tasks/:id
 */
const deleteTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT created_by FROM tasks WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Task not found", 404));

    const { role, id: callerId } = req.user;
    if (!["super_admin", "admin"].includes(role) && existing.rows[0].created_by !== callerId) {
      return next(new AppError("You can only delete tasks you created", 403));
    }

    await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
    return sendSuccess(res, "Task deleted successfully");
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/tasks/:id/complete
 */
const completeTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_completed } = req.body;
    if (is_completed === undefined) return next(new AppError("is_completed is required", 400));

    const existing = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Task not found", 404));

    const completedAt = is_completed ? new Date() : null;
    const result = await pool.query(
      `UPDATE tasks SET is_completed = $1, completed_at = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [is_completed, completedAt, id]
    );

    const task = result.rows[0];
    if (is_completed) {
      emitToUser(task.assigned_to, "task:completed", {
        id: task.id, is_completed: true, completed_at: task.completed_at,
      });
    }

    return sendSuccess(
      res,
      is_completed ? "Task marked as completed" : "Task marked as pending",
      { id: task.id, is_completed: task.is_completed, completed_at: task.completed_at }
    );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/tasks/lead/:leadId
 */
const getTasksByLead = async (req, res, next) => {
  try {
    const { leadId } = req.params;
    const lead = await pool.query("SELECT id FROM leads WHERE id = $1", [leadId]);
    if (lead.rows.length === 0) return next(new AppError("Lead not found", 404));

    const result = await pool.query(
      `SELECT t.id, t.title, t.due_date, t.priority, t.is_completed, t.completed_at, t.notes,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_to
       FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.lead_id = $1 ORDER BY t.is_completed ASC, t.due_date ASC`,
      [leadId]
    );
    return sendSuccess(res, "Tasks fetched", result.rows);
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllTasks, createTask, getTodayTasks, getTaskById, updateTask, deleteTask, completeTask, getTasksByLead };
