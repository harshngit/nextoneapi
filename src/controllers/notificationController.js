const { pool } = require("../config/db");
const { sendSuccess, sendError, paginate } = require("../utils/response");
const { emitToUser } = require("../config/socket");
const AppError = require("../utils/AppError");

// ─── Notification Types ───────────────────────────────────────────────────────
// lead_assigned        — a lead is assigned to a user
// lead_status_changed  — lead status updated
// lead_new             — new lead created (for admins/managers)
// follow_up_created    — a follow-up task is created
// follow_up_due        — follow-up task is due today
// follow_up_overdue    — follow-up task is overdue
// follow_up_completed  — follow-up task is marked complete
// visit_scheduled      — site visit scheduled
// visit_reminder       — site visit reminder (day before / same day)
// visit_done           — site visit completed
// visit_cancelled      — site visit cancelled
// visit_rescheduled    — site visit rescheduled
// project_new          — new project added
// project_updated      — project details updated
// booking_new          — new booking created (lead moved to booked)
// payment_received     — payment received against a booking
// commission_credited  — commission credited to agent
// task_created         — generic task assigned to user
// task_reminder        — task due reminder
// task_completed       — task marked complete
// general              — general announcements / system messages

const VALID_TYPES = [
  "lead_assigned",
  "lead_status_changed",
  "lead_new",
  "follow_up_created",
  "follow_up_due",
  "follow_up_overdue",
  "follow_up_completed",
  "visit_scheduled",
  "visit_reminder",
  "visit_done",
  "visit_cancelled",
  "visit_rescheduled",
  "project_new",
  "project_updated",
  "booking_new",
  "payment_received",
  "commission_credited",
  "task_created",
  "task_reminder",
  "task_completed",
  "attendance_checkin",
  "attendance_checkout",
  "attendance_pending",
  "attendance_manual",
  "attendance_approved",
  "general",
];

/**
 * Helper — create a notification in DB and push via WebSocket.
 * Called from other controllers.
 *
 * @param {string} userId
 * @param {{ type, title, message, reference_id?, reference_type?, metadata? }} payload
 */
const createNotification = async (userId, { type, title, message, reference_id, reference_type, metadata }) => {
  const result = await pool.query(
    `INSERT INTO notifications
       (user_id, type, title, message, reference_id, reference_type, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [userId, type, title, message, reference_id || null, reference_type || null, metadata ? JSON.stringify(metadata) : null]
  );
  const notif = result.rows[0];
  emitToUser(userId, "notification:new", notif);
  return notif;
};

/**
 * Helper — create notifications for multiple users at once.
 */
const createBulkNotifications = async (userIds, payload) => {
  const notifications = await Promise.all(userIds.map((uid) => createNotification(uid, payload)));
  return notifications;
};

/**
 * Helper — notify all admins and super_admins
 */
const notifyAdmins = async (payload) => {
  const result = await pool.query(
    `SELECT id FROM users WHERE role IN ('super_admin','admin','superadmin') AND is_active = true`
  );
  return createBulkNotifications(result.rows.map((r) => r.id), payload);
};

/**
 * Helper — notify the sales_manager when a lead assigned to their team member
 */
const notifyManagerOfLeadAssignment = async (assignedToUserId, lead) => {
  const mgrRow = await pool.query(
    `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [assignedToUserId]
  );
  if (!mgrRow.rows.length) return;
  return createNotification(mgrRow.rows[0].manager_id, {
    type:           "lead_assigned",
    title:          "Lead Assigned to Your Team",
    message:        `Lead "${lead.name}" (${lead.phone}) has been assigned to your team member.`,
    reference_id:   lead.id,
    reference_type: "lead",
    metadata:       { lead_id: lead.id, lead_name: lead.name, assigned_to: assignedToUserId },
  });
};

/**
 * Helper — notify all admins + the lead's sales manager
 */
const notifyManagersAndAdmins = async (leadId, payload) => {
  const result = await pool.query(
    `SELECT DISTINCT u.id
     FROM users u
     WHERE u.is_active = true
       AND (
         u.role IN ('super_admin','admin','superadmin')
         OR (u.role = 'sales_manager' AND u.id IN (
           SELECT manager_id FROM users WHERE id = (
             SELECT assigned_to FROM leads WHERE id = $1
           )
         ))
       )`,
    [leadId]
  );
  return createBulkNotifications(result.rows.map((r) => r.id), payload);
};

// ─── Public Notification Factories ──────────────────────────────────────────

/**
 * Called from leadController when a lead is assigned
 */
const notifyLeadAssigned = async (assignedToUserId, lead) => {
  return createNotification(assignedToUserId, {
    type: "lead_assigned",
    title: "New Lead Assigned",
    message: `Lead ${lead.name} (${lead.phone}) has been assigned to you`,
    reference_id: lead.id,
    reference_type: "lead",
    metadata: { source: lead.source, budget: lead.budget },
  });
};

/**
 * Called from leadController when lead status changes
 */
const notifyLeadStatusChanged = async (lead, oldStatus, changedByUser) => {
  const promises = [];

  // Notify assigned executive
  if (lead.assigned_to) {
    promises.push(
      createNotification(lead.assigned_to, {
        type: "lead_status_changed",
        title: "Lead Status Updated",
        message: `Lead ${lead.name} status changed from ${oldStatus} to ${lead.status}`,
        reference_id: lead.id,
        reference_type: "lead",
        metadata: { old_status: oldStatus, new_status: lead.status },
      })
    );
  }

  // If booked — notify admins & managers
  if (lead.status === "booked") {
    promises.push(
      notifyManagersAndAdmins(lead.id, {
        type: "booking_new",
        title: "New Booking!",
        message: `${lead.name} has been booked for ${lead.project_name || "a project"}`,
        reference_id: lead.id,
        reference_type: "lead",
        metadata: { booked_by: changedByUser?.name, budget: lead.budget },
      })
    );
  }

  await Promise.all(promises);
};

/**
 * Called from leadController when a new lead is created
 */
const notifyNewLead = async (lead, createdByUser) => {
  return notifyManagersAndAdmins(lead.id, {
    type: "lead_new",
    title: "New Lead Added",
    message: `New lead ${lead.name} (${lead.source || "unknown source"}) added by ${createdByUser?.name || "system"}`,
    reference_id: lead.id,
    reference_type: "lead",
    metadata: { source: lead.source, budget: lead.budget },
  });
};

/**
 * Called from taskController when a follow-up task is created
 */
const notifyFollowUpCreated = async (task, lead) => {
  if (!task.assigned_to) return;
  return createNotification(task.assigned_to, {
    type: "follow_up_created",
    title: "Follow-up Scheduled",
    message: `Follow-up task "${task.title}" created${lead ? ` for lead ${lead.name}` : ""}. Due: ${new Date(task.due_date).toLocaleDateString("en-IN")}`,
    reference_id: task.id,
    reference_type: "task",
    metadata: { lead_id: lead?.id, lead_name: lead?.name, due_date: task.due_date, priority: task.priority },
  });
};

/**
 * Called from taskController when a follow-up is marked complete
 */
const notifyFollowUpCompleted = async (task, lead, completedByUser) => {
  const promises = [];

  // Notify the task creator (manager)
  if (task.created_by && task.created_by !== task.assigned_to) {
    promises.push(
      createNotification(task.created_by, {
        type: "follow_up_completed",
        title: "Follow-up Completed",
        message: `"${task.title}" follow-up${lead ? ` for ${lead.name}` : ""} marked complete by ${completedByUser?.name || "agent"}`,
        reference_id: task.id,
        reference_type: "task",
        metadata: { lead_id: lead?.id, completed_by: completedByUser?.id },
      })
    );
  }

  await Promise.all(promises);
};

/**
 * Called from siteVisitController when a visit is scheduled
 */
const notifyVisitScheduled = async (visit, lead, project) => {
  const promises = [];

  // Notify assigned agent
  if (visit.assigned_to) {
    promises.push(
      createNotification(visit.assigned_to, {
        type: "visit_scheduled",
        title: "Site Visit Scheduled",
        message: `Site visit for ${lead.name} at ${project?.name || "the project"} on ${visit.visit_date} at ${visit.visit_time}`,
        reference_id: visit.id,
        reference_type: "site_visit",
        metadata: { lead_id: lead.id, project_id: project?.id, visit_date: visit.visit_date, visit_time: visit.visit_time },
      })
    );
  }

  // Notify admins/managers
  promises.push(
    notifyManagersAndAdmins(lead.id, {
      type: "visit_scheduled",
      title: "New Site Visit Scheduled",
      message: `Site visit for ${lead.name} at ${project?.name || "a project"} on ${visit.visit_date} at ${visit.visit_time}`,
      reference_id: visit.id,
      reference_type: "site_visit",
      metadata: { lead_id: lead.id, project_id: project?.id, visit_date: visit.visit_date, visit_time: visit.visit_time },
    })
  );

  await Promise.all(promises);
};

/**
 * Called when a site visit status is updated (done / cancelled / rescheduled / no_show)
 */
const notifyVisitStatusChanged = async (visit, lead, project, newStatus) => {
  const typeMap = {
    done: "visit_done",
    cancelled: "visit_cancelled",
    rescheduled: "visit_rescheduled",
  };
  const titleMap = {
    done: "Site Visit Completed",
    cancelled: "Site Visit Cancelled",
    rescheduled: "Site Visit Rescheduled",
    no_show: "Site Visit - No Show",
  };

  const notifType = typeMap[newStatus] || "visit_scheduled";
  const notifTitle = titleMap[newStatus] || "Site Visit Updated";

  const promises = [];

  if (visit.assigned_to) {
    promises.push(
      createNotification(visit.assigned_to, {
        type: notifType,
        title: notifTitle,
        message: `Site visit for ${lead.name} at ${project?.name || "the project"} is now ${newStatus}`,
        reference_id: visit.id,
        reference_type: "site_visit",
        metadata: { lead_id: lead.id, project_id: project?.id, new_status: newStatus },
      })
    );
  }

  promises.push(
    notifyManagersAndAdmins(lead.id, {
      type: notifType,
      title: notifTitle,
      message: `Site visit for ${lead.name} at ${project?.name || "a project"} is now ${newStatus}`,
      reference_id: visit.id,
      reference_type: "site_visit",
      metadata: { lead_id: lead.id, project_id: project?.id, new_status: newStatus },
    })
  );

  await Promise.all(promises);
};

/**
 * Called from projectController when a new project is created
 */
const notifyProjectNew = async (project) => {
  const result = await pool.query(
    `SELECT id FROM users WHERE is_active = true AND role IN ('super_admin','admin','superadmin','sales_manager','sales_executive','external_caller')`
  );
  return createBulkNotifications(result.rows.map((r) => r.id), {
    type: "project_new",
    title: "New Project Added",
    message: `New project "${project.name}" in ${project.city}${project.locality ? `, ${project.locality}` : ""} is now available`,
    reference_id: project.id,
    reference_type: "project",
    metadata: { city: project.city, locality: project.locality, status: project.status },
  });
};

/**
 * Called from projectController when a project is updated
 */
const notifyProjectUpdated = async (project, updatedByUser) => {
  const result = await pool.query(
    `SELECT id FROM users WHERE is_active = true AND role IN ('super_admin','admin','superadmin','sales_manager')`
  );
  return createBulkNotifications(result.rows.map((r) => r.id), {
    type: "project_updated",
    title: "Project Updated",
    message: `Project "${project.name}" has been updated by ${updatedByUser?.name || "admin"}`,
    reference_id: project.id,
    reference_type: "project",
    metadata: { city: project.city, updated_by: updatedByUser?.id },
  });
};

/**
 * Scheduled job helper — send follow-up due reminders (call from a cron)
 */
const sendFollowUpReminders = async () => {
  try {
    // Tasks due today not yet completed
    const due = await pool.query(
      `SELECT t.id, t.title, t.due_date, t.assigned_to,
              l.id AS lead_id, l.name AS lead_name,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_name
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.is_completed = false
         AND t.due_date::date = CURRENT_DATE
         AND t.assigned_to IS NOT NULL`
    );

    for (const task of due.rows) {
      // Check if reminder already sent today
      const existing = await pool.query(
        `SELECT id FROM notifications
         WHERE user_id = $1 AND reference_id = $2 AND type = 'follow_up_due'
           AND created_at::date = CURRENT_DATE`,
        [task.assigned_to, task.id]
      );
      if (existing.rows.length === 0) {
        await createNotification(task.assigned_to, {
          type: "follow_up_due",
          title: "Follow-up Due Today",
          message: `Your follow-up "${task.title}"${task.lead_name ? ` for ${task.lead_name}` : ""} is due today`,
          reference_id: task.id,
          reference_type: "task",
          metadata: { lead_id: task.lead_id, due_date: task.due_date },
        });
      }
    }

    // Overdue tasks
    const overdue = await pool.query(
      `SELECT t.id, t.title, t.due_date, t.assigned_to,
              l.id AS lead_id, l.name AS lead_name
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       WHERE t.is_completed = false
         AND t.due_date < NOW()
         AND t.due_date::date < CURRENT_DATE
         AND t.assigned_to IS NOT NULL`
    );

    for (const task of overdue.rows) {
      const existing = await pool.query(
        `SELECT id FROM notifications
         WHERE user_id = $1 AND reference_id = $2 AND type = 'follow_up_overdue'
           AND created_at::date = CURRENT_DATE`,
        [task.assigned_to, task.id]
      );
      if (existing.rows.length === 0) {
        await createNotification(task.assigned_to, {
          type: "follow_up_overdue",
          title: "Follow-up Overdue",
          message: `Follow-up "${task.title}"${task.lead_name ? ` for ${task.lead_name}` : ""} was due on ${new Date(task.due_date).toLocaleDateString("en-IN")}`,
          reference_id: task.id,
          reference_type: "task",
          metadata: { lead_id: task.lead_id, due_date: task.due_date },
        });
      }
    }

    console.log(`[Reminders] Follow-up reminders sent: ${due.rows.length} due, ${overdue.rows.length} overdue`);
  } catch (err) {
    console.error("[sendFollowUpReminders]", err);
  }
};

/**
 * Scheduled job helper — send site visit reminders (call from a cron — day before)
 */
const sendVisitReminders = async () => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const visits = await pool.query(
      `SELECT sv.id, sv.visit_date, sv.visit_time, sv.assigned_to,
              l.name AS lead_name,
              p.name AS project_name
       FROM site_visits sv
       JOIN leads l ON l.id = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       WHERE sv.visit_date = $1 AND sv.status = 'scheduled' AND sv.assigned_to IS NOT NULL`,
      [tomorrowStr]
    );

    for (const visit of visits.rows) {
      const existing = await pool.query(
        `SELECT id FROM notifications
         WHERE user_id = $1 AND reference_id = $2 AND type = 'visit_reminder'
           AND created_at::date = CURRENT_DATE`,
        [visit.assigned_to, visit.id]
      );
      if (existing.rows.length === 0) {
        await createNotification(visit.assigned_to, {
          type: "visit_reminder",
          title: "Site Visit Tomorrow",
          message: `Reminder: Site visit for ${visit.lead_name} at ${visit.project_name || "the project"} is tomorrow at ${visit.visit_time}`,
          reference_id: visit.id,
          reference_type: "site_visit",
          metadata: { visit_date: visit.visit_date, visit_time: visit.visit_time },
        });
      }
    }

    console.log(`[Reminders] Visit reminders sent: ${visits.rows.length}`);
  } catch (err) {
    console.error("[sendVisitReminders]", err);
  }
};

// ─── REST Handlers ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/notifications
 */
const getNotifications = async (req, res, next) => {
  try {
    const { is_read, type, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [`user_id = $1`];
    const params = [req.user.id];
    let idx = 2;

    if (is_read !== undefined) { conditions.push(`is_read = $${idx++}`); params.push(is_read === "true"); }
    if (type)                  { conditions.push(`type = $${idx++}`);    params.push(type); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(`SELECT COUNT(*) FROM notifications ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT id, type, title, message, is_read, reference_id, reference_type, metadata, created_at
       FROM notifications ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/notifications/unread-count
 */
const getUnreadCount = async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false",
      [req.user.id]
    );
    return sendSuccess(res, "Unread count fetched", { unread_count: parseInt(result.rows[0].count) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/notifications/types
 * Returns all available notification types (useful for filter dropdowns)
 */
const getNotificationTypes = async (req, res, next) => {
  try {
    return sendSuccess(res, "Notification types fetched", {
      types: VALID_TYPES,
      categories: {
        leads: ["lead_assigned", "lead_status_changed", "lead_new", "booking_new"],
        follow_ups: ["follow_up_created", "follow_up_due", "follow_up_overdue", "follow_up_completed"],
        site_visits: ["visit_scheduled", "visit_reminder", "visit_done", "visit_cancelled", "visit_rescheduled"],
        projects: ["project_new", "project_updated"],
        payments: ["payment_received", "commission_credited"],
        tasks: ["task_created", "task_reminder", "task_completed"],
        general: ["general"],
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/notifications/read-all
 */
const markAllRead = async (req, res, next) => {
  try {
    const result = await pool.query(
      "UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
      [req.user.id]
    );
    return sendSuccess(res, `${result.rowCount} notifications marked as read`);
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/notifications/:id/read
 */
const markOneRead = async (req, res, next) => {
  try {
    const result = await pool.query(
      "UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return next(new AppError("Notification not found", 404));
    return sendSuccess(res, "Notification marked as read");
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/notifications/:id
 */
const deleteNotification = async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return sendError(res, "Notification not found", 404);
    return sendSuccess(res, "Notification deleted");
  } catch (err) {
    console.error("[deleteNotification]", err);
    return sendError(res, "Failed to delete notification", 500);
  }
};

/**
 * DELETE /api/v1/notifications  (delete all for current user)
 */
const deleteAllNotifications = async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM notifications WHERE user_id = $1",
      [req.user.id]
    );
    return sendSuccess(res, `${result.rowCount} notifications deleted`);
  } catch (err) {
    console.error("[deleteAllNotifications]", err);
    return sendError(res, "Failed to delete notifications", 500);
  }
};

module.exports = {
  // REST handlers
  getNotifications,
  getUnreadCount,
  getNotificationTypes,
  markAllRead,
  markOneRead,
  deleteNotification,
  deleteAllNotifications,

  // Factory helpers (called from other controllers)
  createNotification,
  notifyManagerOfLeadAssignment,
  createBulkNotifications,
  notifyAdmins,

  // Specific event notifications
  notifyLeadAssigned,
  notifyLeadStatusChanged,
  notifyNewLead,
  notifyFollowUpCreated,
  notifyFollowUpCompleted,
  notifyVisitScheduled,
  notifyVisitStatusChanged,
  notifyProjectNew,
  notifyProjectUpdated,

  // Scheduled job helpers
  sendFollowUpReminders,
  sendVisitReminders,

  // Constants
  VALID_TYPES,
};