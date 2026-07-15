const express = require("express");
const router = express.Router();
const taskController = require("../controllers/taskController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Follow-Up & Task Management
 *   description: >
 *     Create and manage follow-up tasks for leads.
 *     Real-time updates via WebSocket — connect to ws://your-server
 *     with a valid JWT token. Listen to events: task:created,
 *     task:updated, task:completed, task:reminder.
 */

/**
 * @swagger
 * /api/v1/tasks:
 *   get:
 *     summary: List tasks with filters
 *     description: >
 *       Returns paginated tasks. Sales Executive sees only their own tasks.
 *       Sales Manager sees their team's tasks. Admin sees all.
 *       Filter by status, due date, or lead.
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: is_completed
 *         schema:
 *           type: boolean
 *         example: false
 *       - in: query
 *         name: lead_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: assigned_to
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: due_from
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-20"
 *       - in: query
 *         name: due_to
 *         schema:
 *           type: string
 *           format: date
 *         example: "2025-04-30"
 *       - in: query
 *         name: overdue
 *         schema:
 *           type: boolean
 *         description: If true, returns only overdue tasks
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Tasks list returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "task-uuid-001"
 *                   title: "Follow up call with Suresh Patel"
 *                   lead_id: "lead-uuid-001"
 *                   lead_name: "Suresh Patel"
 *                   due_date: "2025-04-22T10:00:00Z"
 *                   is_completed: false
 *                   priority: "high"
 *                   assigned_to: "Rahul Sharma"
 *               pagination:
 *                 total: 35
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 2
 */
router.get("/", authenticate, taskController.getAllTasks);

/**
 * @swagger
 * /api/v1/tasks:
 *   post:
 *     summary: Create a follow-up task
 *     description: >
 *       Creates a new follow-up task linked to a lead.
 *       On creation, a real-time WebSocket event `task:created` is emitted
 *       to the assigned user's socket room.
 *
 *       **WebSocket Event — `task:created`**
 *       ```json
 *       {
 *         "id": "task-uuid-001",
 *         "title": "Follow up call with Suresh",
 *         "lead_id": "lead-uuid-001",
 *         "due_date": "2025-04-22T10:00:00Z",
 *         "priority": "high"
 *       }
 *       ```
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, lead_id, due_date]
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Follow up call with Suresh Patel"
 *               lead_id:
 *                 type: string
 *                 format: uuid
 *                 example: "lead-uuid-001"
 *               due_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-04-22T10:00:00Z"
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 example: "user-uuid-001"
 *                 description: Defaults to lead's assigned executive
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 example: "high"
 *               notes:
 *                 type: string
 *                 example: "Client asked to call after 10am. Discuss pricing."
 *           example:
 *             title: "Follow up call with Suresh Patel"
 *             lead_id: "lead-uuid-001"
 *             due_date: "2026-06-22T10:00:00Z"
 *             assigned_to: "user-uuid-001"
 *             priority: "high"
 *             notes: "Client asked to call after 10am. Discuss pricing."
 *     responses:
 *       201:
 *         description: Task created and WebSocket event emitted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Task created successfully"
 *               data:
 *                 id: "task-uuid-001"
 *                 title: "Follow up call with Suresh Patel"
 *                 due_date: "2025-04-22T10:00:00Z"
 *                 priority: "high"
 *                 is_completed: false
 */
router.post("/", authenticate, taskController.createTask);

/**
 * @swagger
 * /api/v1/tasks/today:
 *   get:
 *     summary: Get today's task dashboard for logged-in user
 *     description: >
 *       Returns today's pending tasks, overdue tasks, and completed tasks
 *       for the logged-in user. Designed for the daily task dashboard view
 *       on both web and mobile.
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Today's tasks returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 summary:
 *                   due_today: 5
 *                   overdue: 3
 *                   completed_today: 2
 *                 overdue:
 *                   - id: "task-uuid-000"
 *                     title: "Follow up with Amit"
 *                     due_date: "2025-04-19T09:00:00Z"
 *                     lead_name: "Amit Verma"
 *                     priority: "high"
 *                 due_today:
 *                   - id: "task-uuid-001"
 *                     title: "Follow up call with Suresh"
 *                     due_date: "2025-04-20T10:00:00Z"
 *                     lead_name: "Suresh Patel"
 *                     priority: "high"
 *                 completed_today:
 *                   - id: "task-uuid-002"
 *                     title: "Send brochure to Priya"
 *                     completed_at: "2025-04-20T09:15:00Z"
 */
router.get("/today", authenticate, taskController.getTodayTasks);

/**
 * @swagger
 * /api/v1/tasks/{id}:
 *   get:
 *     summary: Get task by ID
 *     description: Returns full details of a specific task.
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "task-uuid-001"
 *     responses:
 *       200:
 *         description: Task details returned
 *       404:
 *         description: Task not found
 */
router.get("/:id", authenticate, taskController.getTaskById);

/**
 * @swagger
 * /api/v1/tasks/{id}:
 *   put:
 *     summary: Update task details
 *     description: >
 *       Same fields as Create Task — all optional on update (send only what changed).
 *       Emits `task:updated` WebSocket event to the assigned user.
 *       If due_date changes, the reminder_sent and overdue_sent sentinel columns
 *       are reset so the cron will fire reminders again for the new date.
 *
 *       **WebSocket Event — `task:updated`**
 *       ```json
 *       { "id": "task-uuid-001", "title": "Updated title", "due_date": "..." }
 *       ```
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Follow up call with Suresh Patel"
 *               lead_id:
 *                 type: string
 *                 format: uuid
 *                 description: Reassign task to a different lead
 *               due_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-06-22T10:00:00Z"
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: Reassign task to a different executive
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 example: "high"
 *               notes:
 *                 type: string
 *                 example: "Client asked to call after 10am. Discuss pricing."
 *           example:
 *             title: "Follow up call with Suresh Patel"
 *             lead_id: "lead-uuid-001"
 *             due_date: "2026-06-22T10:00:00Z"
 *             assigned_to: "user-uuid-001"
 *             priority: "high"
 *             notes: "Client rescheduled. Call after 10am."
 *     responses:
 *       200:
 *         description: Task updated and WebSocket event emitted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Task updated successfully"
 *               data:
 *                 id: "task-uuid-001"
 *                 title: "Follow up call with Suresh Patel"
 *                 due_date: "2026-06-22T10:00:00Z"
 *                 priority: "high"
 *                 assigned_to: "user-uuid-001"
 *       404:
 *         description: Task not found
 */
router.put("/:id", authenticate, taskController.updateTask);

/**
 * @swagger
 * /api/v1/tasks/bulk:
 *   delete:
 *     summary: Bulk delete follow-up tasks
 *     description: >
 *       Deletes multiple tasks in one call. Admin/Super Admin can delete any
 *       task; other roles can only delete tasks they created — ids failing
 *       that check are returned in denied_ids instead of failing the batch.
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Deletion summary
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "2 task(s) deleted"
 *               data:
 *                 deleted_count: 2
 *                 deleted_ids: ["uuid1", "uuid2"]
 *                 denied_ids: []
 *                 not_found_ids: []
 *       400:
 *         description: ids array missing or empty
 */
router.delete("/bulk", authenticate, taskController.bulkDeleteTasks);

/**
 * @swagger
 * /api/v1/tasks/{id}:
 *   delete:
 *     summary: Delete a task
 *     description: Permanently deletes a task. Only Admin or the task creator can delete.
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Task deleted
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id", authenticate, taskController.deleteTask);

/**
 * @swagger
 * /api/v1/tasks/{id}/complete:
 *   patch:
 *     summary: Mark task as complete or pending
 *     description: >
 *       Toggles a task between completed and pending state.
 *       Emits `task:completed` WebSocket event when marked complete.
 *
 *       **WebSocket Event — `task:completed`**
 *       ```json
 *       { "id": "task-uuid-001", "is_completed": true, "completed_at": "2025-04-20T11:00:00Z" }
 *       ```
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [is_completed]
 *             properties:
 *               is_completed:
 *                 type: boolean
 *           example:
 *             is_completed: true
 *     responses:
 *       200:
 *         description: Task status toggled and WebSocket event emitted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Task marked as completed"
 *               data:
 *                 id: "task-uuid-001"
 *                 is_completed: true
 *                 completed_at: "2025-04-20T11:00:00Z"
 */
router.patch("/:id/complete", authenticate, taskController.completeTask);

/**
 * @swagger
 * /api/v1/leads/{leadId}/tasks:
 *   get:
 *     summary: Get all tasks linked to a lead
 *     description: Returns all tasks associated with a specific lead, ordered by due date.
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Tasks for lead returned
 */
router.get("/lead/:leadId", authenticate, taskController.getTasksByLead);

/**
 * @swagger
 * /api/v1/tasks/create-with-lead:
 *   post:
 *     summary: Create a new lead along with a follow-up task
 *     description: Creates a new lead with status "follow_up" and a linked follow-up task in a single request
 *     tags: [Follow-Up & Task Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - phone
 *               - title
 *               - due_date
 *             properties:
 *               # Lead fields
 *               name:
 *                 type: string
 *                 description: Lead name
 *               phone:
 *                 type: string
 *                 description: Lead phone number
 *               alternate_phone_number:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               source:
 *                 type: string
 *               project_id:
 *                 type: string
 *                 format: uuid
 *                 description: >
 *                   Project UUID, from the dropdown selection. Optional —
 *                   takes precedence over project_name if both are sent.
 *               project_name:
 *                 type: string
 *                 description: >
 *                   Free-text project name, used when the user typed a name
 *                   instead of picking from the dropdown. Looked up
 *                   case-insensitively; if no matching project exists, the
 *                   raw text is stored on the lead instead of erroring.
 *               assigned_to:
 *                 type: string
 *                 format: uuid
 *                 description: User to assign both lead and task to
 *               budget:
 *                 type: string
 *               location_preference:
 *                 type: string
 *               configuration:
 *                 type: string
 *               lead_notes:
 *                 type: string
 *                 description: Notes for lead activity
 *               callback_time:
 *                 type: string
 *                 format: date-time
 *               next_followup_time:
 *                 type: string
 *                 format: date-time
 *               # Task fields
 *               title:
 *                 type: string
 *                 description: Task title
 *               due_date:
 *                 type: string
 *                 format: date-time
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *               notes:
 *                 type: string
 *                 description: Task notes
 *     responses:
 *       201:
 *         description: Lead and task created successfully
 */
router.post("/create-with-lead", authenticate, taskController.createTaskWithLead);

module.exports = router;