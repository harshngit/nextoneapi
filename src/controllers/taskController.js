/**
 * taskController.js — Nextone Reality
 * Email notifications fire ONLY after confirmed DB writes:
 *   - createTask  → notifyFollowUpCreated (to assignee)
 *   - completeTask (is_completed=true) → notifyFollowUpCompleted (to managers)
 */

const { pool }       = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError       = require("../utils/AppError");
const { emitToUser } = require("../config/socket");
const emailService   = require("../utils/emailService");
const whatsappService = require("../utils/whatsappService");
const { getTeamIds, ADMIN_ROLES, LEAF_ROLES } = require("../utils/teamUtils");
const { createNotification, createBulkNotifications, notifyAdmins } = require("./notificationController");
const { resolveProjectId, resolveProjectName } = require("../utils/projectResolver");

const VALID_PRIORITIES = ["low", "medium", "high"];

// ─── Helper — fetch manager emails for completion notifications ───────────────
const getManagerEmails = async () => {
  const result = await pool.query(
    "SELECT email FROM users WHERE role IN ('admin','super_admin','sales_manager') AND is_active = true"
  );
  return result.rows.map(r => r.email);
};

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

    if (LEAF_ROLES.includes(role)) {
      conditions.push(`t.assigned_to = $${idx++}`); params.push(callerId);
    } else if (!ADMIN_ROLES.includes(role)) {
      const teamIds = await getTeamIds(callerId);
      conditions.push(`t.assigned_to = ANY($${idx++}::uuid[])`); params.push(teamIds);
    }

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
              l.name AS lead_name, l.phone AS lead_phone,
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
 * ✉ Sends email: Follow-Up Created (to assignee)
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

    const lead = await pool.query(
      `SELECT l.*, p.name AS project_name FROM leads l
       LEFT JOIN projects p ON p.id = l.project_id
       WHERE l.id = $1 AND l.is_archived = false`,
      [lead_id]
    );
    if (lead.rows.length === 0) return next(new AppError("Lead not found", 404));

    const execId = assigned_to || lead.rows[0].assigned_to || req.user.id;

    const result = await pool.query(
      `INSERT INTO tasks (title, lead_id, due_date, assigned_to, priority, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title.trim(), lead_id, due_date, execId, priority, notes || null, req.user.id]
    );

    const task = result.rows[0];

    // ── In-app notification: persist + WebSocket to assignee ────────────────
    await createNotification(execId, {
      type:           "follow_up_created",
      title:          "New Follow-Up Task Assigned",
      message:        `Task: ${task.title} — due ${new Date(task.due_date).toLocaleDateString()}`,
      reference_id:   task.id,
      reference_type: "task",
      metadata:       { lead_name: lead.rows[0]?.name, priority: task.priority },
    });

    // Also notify the sales_manager of the assignee (if different from assigner)
    const managerRow = await pool.query(
      `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [execId]
    );
    if (managerRow.rows.length && managerRow.rows[0].manager_id !== req.user.id) {
      await createNotification(managerRow.rows[0].manager_id, {
        type:           "follow_up_created",
        title:          "Follow-Up Task Created",
        message:        `${lead.rows[0]?.name || "A lead"}: "${task.title}" assigned to your team`,
        reference_id:   task.id,
        reference_type: "task",
        metadata:       { lead_name: lead.rows[0]?.name, priority: task.priority },
      });
    }

    // Notify all admins and super_admins
    await notifyAdmins({
      type:           "follow_up_created",
      title:          "New Follow-Up Task Created",
      message:        `${lead.rows[0]?.name || "A lead"}: "${task.title}" — due ${new Date(task.due_date).toLocaleDateString()}`,
      reference_id:   task.id,
      reference_type: "task",
      metadata:       { lead_name: lead.rows[0]?.name, priority: task.priority },
    });

    // NOTE: the "follow-up created" email (notifyFollowUpCreated) was removed
    // on purpose.

    // ── 📱 WhatsApp — client-facing "we'll be in touch" message ──────────────
    // Distinct from the internal staff email above — this goes to the LEAD's
    // phone, not the assignee's.
    setImmediate(async () => {
      try {
        const clientLead = lead.rows[0];
        if (!clientLead?.phone) return;
        await whatsappService.sendFollowUpScheduled({
          leadName:    clientLead.name,
          leadPhone:   clientLead.phone,
          projectName: clientLead.project_name,
        });
        await pool.query(
          `UPDATE tasks SET whatsapp_followup_sent = true WHERE id = $1`, [task.id]
        );
      } catch (waErr) {
        console.error("[WhatsApp] createTask follow-up message failed:", waErr.message);
      }
    });
    // ─────────────────────────────────────────────────────────────────────────

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
    const today  = new Date().toISOString().split("T")[0];

    const [overdue, dueToday, completedToday] = await Promise.all([
      pool.query(
        `SELECT t.id, t.title, t.lead_id, t.due_date, t.priority, l.name AS lead_name, l.phone AS lead_phone
         FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
         WHERE t.assigned_to = $1 AND t.is_completed = false AND t.due_date::date < $2
         ORDER BY t.due_date ASC`,
        [userId, today]
      ),
      pool.query(
        `SELECT t.id, t.title, t.lead_id, t.due_date, t.priority, l.name AS lead_name, l.phone AS lead_phone
         FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
         WHERE t.assigned_to = $1 AND t.is_completed = false AND t.due_date::date = $2
         ORDER BY t.due_date ASC`,
        [userId, today]
      ),
      pool.query(
        `SELECT t.id, t.title, t.lead_id, t.completed_at, l.name AS lead_name, l.phone AS lead_phone
         FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
         WHERE t.assigned_to = $1 AND t.is_completed = true AND t.completed_at::date = $2
         ORDER BY t.completed_at DESC`,
        [userId, today]
      ),
    ]);

    return sendSuccess(res, "Today's tasks fetched", {
      summary: {
        due_today:       dueToday.rows.length,
        overdue:         overdue.rows.length,
        completed_today: completedToday.rows.length,
      },
      overdue:         overdue.rows,
      due_today:       dueToday.rows,
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
      `SELECT t.*, l.name AS lead_name, l.phone AS lead_phone,
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
 * DELETE /api/v1/tasks/bulk
 * Body: { ids: [uuid, ...] }
 * Mirrors deleteTask's permission rule per item: super_admin/admin can
 * delete any task, everyone else only tasks they created. Items failing
 * that check land in denied_ids instead of failing the whole batch.
 */
const bulkDeleteTasks = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return next(new AppError("ids array is required and cannot be empty", 400));
    }

    const { role, id: callerId } = req.user;
    const existing = await pool.query(
      "SELECT id, created_by FROM tasks WHERE id = ANY($1::uuid[])",
      [ids]
    );
    const foundMap = new Map(existing.rows.map(r => [r.id, r.created_by]));
    const notFoundIds = ids.filter(id => !foundMap.has(id));

    const deletableIds = [];
    const deniedIds = [];
    for (const [id, createdBy] of foundMap) {
      if (["super_admin", "admin"].includes(role) || createdBy === callerId) {
        deletableIds.push(id);
      } else {
        deniedIds.push(id);
      }
    }

    if (deletableIds.length) {
      await pool.query("DELETE FROM tasks WHERE id = ANY($1::uuid[])", [deletableIds]);
    }

    return sendSuccess(res, `${deletableIds.length} task(s) deleted`, {
      deleted_count: deletableIds.length,
      deleted_ids: deletableIds,
      denied_ids: deniedIds,
      not_found_ids: notFoundIds,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/tasks/:id/complete
 * ✉ Sends email: Follow-Up Completed (to managers) — only when marking as completed
 */
const completeTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_completed } = req.body;
    if (is_completed === undefined) return next(new AppError("is_completed is required", 400));

    const existing = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Task not found", 404));

    // No email if task already in this completion state
    const alreadySame = existing.rows[0].is_completed === is_completed;

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

    // ── Push + in-app: task completed ────────────────────────────────────────
    if (is_completed && !alreadySame) {
      setImmediate(async () => {
        try {
          const leadRow = await pool.query(
            `SELECT l.*, p.name AS project_name FROM leads l
             LEFT JOIN projects p ON p.id = l.project_id WHERE l.id = $1`,
            [task.lead_id]
          );
          const lead = leadRow.rows[0];

          // Notify manager of the exec
          const mgrRow = await pool.query(
            `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [task.assigned_to]
          );
          if (mgrRow.rows.length) {
            await createNotification(mgrRow.rows[0].manager_id, {
              type:           'follow_up_completed',
              title:          'Follow-Up Completed',
              message:        `Task "${task.title}"${lead ? ` for "${lead.name}"` : ''} was completed`,
              reference_id:   task.id,
              reference_type: 'task',
              metadata:       { lead_id: task.lead_id, lead_name: lead?.name },
            });
          }
          // Notify admins
          await notifyAdmins({
            type:           'follow_up_completed',
            title:          'Follow-Up Task Completed',
            message:        `Task "${task.title}"${lead ? ` for "${lead.name}"` : ''} was completed`,
            reference_id:   task.id,
            reference_type: 'task',
            metadata:       { lead_id: task.lead_id },
          });

          // Email (existing)
          const completedByRow = await pool.query(
            "SELECT CONCAT(first_name,' ',last_name) AS name FROM users WHERE id = $1",
            [req.user.id]
          );
          const managerEmails = await getManagerEmails();
          await emailService.notifyFollowUpCompleted({
            task:           { ...task },
            lead:           lead || { name: "Unknown", phone: "" },
            completedBy:    completedByRow.rows[0]?.name || "System",
            managerEmails,
          });
        } catch (err) {
          console.error("[Notification/Email] completeTask failed:", err.message);
        }
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

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
      `SELECT t.id, t.title, t.lead_id, t.due_date, t.priority, t.is_completed, t.completed_at, t.notes,
              l.phone AS lead_phone,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_to
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.lead_id = $1 ORDER BY t.is_completed ASC, t.due_date ASC`,
      [leadId]
    );
    return sendSuccess(res, "Tasks fetched", result.rows);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/v1/tasks/create-with-lead ───────────────────────────────────────
const createTaskWithLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    // Extract lead data and task data from request body
    const {
      // Lead fields
      name, phone, alternate_phone_number, email, source, project_id, project_name,
      assigned_to: lead_assigned_to, budget, location_preference, configuration,
      lead_notes, callback_time, next_followup_time,
      // Task fields
      title, due_date, priority, notes,
    } = req.body;

    if (!name || !phone) {
      return next(new AppError('name and phone are required for lead', 400));
    }
    if (!title || !due_date) {
      return next(new AppError('title and due_date are required for task', 400));
    }

    // project_id takes precedence over project_name. Neither has to match an
    // existing project — if it doesn't, it's stored as free text instead
    // (project_name_text) rather than rejecting the request.
    let resolvedProjectId = null;
    let resolvedProjectNameText = null;
    if (project_id) {
      try {
        resolvedProjectId = await resolveProjectId(project_id);
      } catch (e) {
        resolvedProjectNameText = String(project_id).trim();
      }
    } else if (project_name) {
      const resolved = await resolveProjectName(project_name);
      resolvedProjectId = resolved.projectId;
      resolvedProjectNameText = resolved.projectNameText;
    }

    await client.query('BEGIN');

    // Duplicate phone check — a phone number already registered to an active
    // (non-archived) lead cannot be reused. Same rule as POST /api/v1/leads.
    const dupLead = await client.query(
      "SELECT id, name FROM leads WHERE phone = $1 AND is_archived = false LIMIT 1",
      [phone]
    );
    if (dupLead.rows.length) {
      await client.query('ROLLBACK');
      return next(new AppError(
        `This phone number is already registered with lead "${dupLead.rows[0].name}". Duplicate phone numbers are not allowed.`,
        400
      ));
    }

    // Create the lead first
    const leadResult = await client.query(
      `INSERT INTO leads (
        name, phone, alternate_phone_number, email, source,
        project_id, project_name_text, assigned_to, budget, location_preference, configuration,
        callback_time, next_followup_time, status, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'follow_up',$14) RETURNING *`,
      [
        name.trim(), phone, alternate_phone_number || null, email || null, source || null,
        resolvedProjectId || null, resolvedProjectNameText || null, lead_assigned_to || null, budget || null,
        location_preference || null, configuration || null, callback_time || null,
        next_followup_time || null, req.user.id
      ]
    );
    const lead = leadResult.rows[0];

    // Log lead creation activity
    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,'note',$2,$3)`,
      [lead.id, lead_notes || 'Lead created with follow-up task', req.user.id]
    );

    // Now create the task
    const execId = lead_assigned_to || lead.assigned_to || req.user.id;
    const taskResult = await client.query(
      `INSERT INTO tasks (
        title, lead_id, due_date, assigned_to, priority, notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title.trim(), lead.id, due_date, execId, priority || 'medium', notes || null, req.user.id]
    );
    const task = taskResult.rows[0];

    await client.query('COMMIT');

    // Send notifications (similar to createTask and createLead)
    setImmediate(async () => {
      try {
        // Notify assigned user
        if (execId) {
          const { createNotification, notifyAdmins } = require('./notificationController');
          await createNotification(execId, {
            type: 'follow_up_created',
            title: 'New Lead + Follow-Up Task Assigned',
            message: `New lead "${name}" with follow-up task: "${title}"`,
            reference_id: task.id,
            reference_type: 'task',
            metadata: { lead_id: lead.id, task_id: task.id },
          });
        }
        await notifyAdmins({
          type: 'follow_up_created',
          title: 'New Lead + Follow-Up Created',
          message: `New lead "${name}" with follow-up task: "${title}"`,
          reference_id: lead.id,
          reference_type: 'lead',
          metadata: { lead_id: lead.id, task_id: task.id },
        });
      } catch (notifErr) {
        console.error('[Notification] createTaskWithLead failed:', notifErr.message);
      }
    });

    return sendSuccess(res, 'Lead and follow-up task created successfully', {
      lead,
      task,
    }, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  getAllTasks, createTask, getTodayTasks, getTaskById,
  updateTask, deleteTask, bulkDeleteTasks, completeTask, getTasksByLead,
  createTaskWithLead,
};