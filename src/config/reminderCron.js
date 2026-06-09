/**
 * reminderCron.js — Next One Realty CRM
 *
 * Runs every 15 minutes and fires push + in-app notifications for:
 *
 * 1. FOLLOW-UP REMINDER  — 2 hours before a task due_date
 *    → to: assigned exec
 *    → also notifies their manager + admins at the same time
 *    type: follow_up_due
 *
 * 2. FOLLOW-UP OVERDUE   — task is past due_date and still incomplete
 *    → to: assigned exec + their manager + admins
 *    type: follow_up_overdue
 *    (fires once per task, guarded by follow_up_overdue_sent column)
 *
 * 3. SITE VISIT REMINDER — 2 hours before visit_date + visit_time
 *    → to: assigned exec + their manager + admins
 *    type: visit_reminder
 *
 * 4. RE-VISIT REMINDER   — 2 hours before revisit date + time
 *    → to: assigned exec + their manager + admins
 *    type: visit_reminder
 *
 * All reminders are guarded by sentinel columns so they fire exactly once
 * even if the cron overlaps or the server restarts.
 *
 * Called once from index.js: require('./config/reminderCron').start()
 */

const { pool }               = require('./db');
const { createNotification, notifyAdmins } = require('../controllers/notificationController');

// ── IST helpers ───────────────────────────────────────────────────────────────
const toIST = (date) => {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + 330 * 60000);
};

/**
 * Combine a DATE string (YYYY-MM-DD) and a TIME string (HH:MM or HH:MM:SS)
 * into a JS Date in IST.
 */
const combineDateTime = (dateStr, timeStr) => {
  // timeStr may be "14:30", "14:30:00", or a pg TIME object coerced to string
  const t  = String(timeStr).slice(0, 5); // "HH:MM"
  const dt = new Date(`${dateStr}T${t}:00+05:30`);
  return dt;
};

// ── Helper — notify exec + manager + admins ───────────────────────────────────
const notifyAll = async ({ execId, type, title, message, referenceId, referenceType, metadata }) => {
  if (execId) {
    await createNotification(execId, {
      type, title, message,
      reference_id:   referenceId,
      reference_type: referenceType,
      metadata,
    });
    // Manager
    const mgrRow = await pool.query(
      `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [execId]
    );
    if (mgrRow.rows.length) {
      await createNotification(mgrRow.rows[0].manager_id, {
        type,
        title:   `${title} (Your Team)`,
        message,
        reference_id:   referenceId,
        reference_type: referenceType,
        metadata,
      });
    }
  }
  // Admins always
  await notifyAdmins({ type, title, message, reference_id: referenceId, reference_type: referenceType, metadata });
};

// ─────────────────────────────────────────────────────────────────────────────
// JOB 1 — Follow-up 2-hour reminder
// Find tasks due in the next 2 hours (±15 min window) that haven't been reminded
// ─────────────────────────────────────────────────────────────────────────────
const runFollowUpReminders = async () => {
  const now      = new Date();
  const twoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  // Window: due in [now, now+2h+15min] to catch this cron tick
  const windowEnd = new Date(now.getTime() + (2 * 60 + 15) * 60 * 1000);

  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.due_date, t.priority, t.assigned_to,
              l.name AS lead_name
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       WHERE t.is_completed            = false
         AND t.follow_up_reminder_sent = false
         AND t.due_date BETWEEN $1 AND $2`,
      [twoHours, windowEnd]
    );

    for (const task of result.rows) {
      try {
        const dueStr = new Date(task.due_date).toLocaleTimeString('en-IN', {
          hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
        });

        await notifyAll({
          execId:        task.assigned_to,
          type:          'follow_up_due',
          title:         'Follow-Up Due in 2 Hours',
          message:       `Task "${task.title}"${task.lead_name ? ` for "${task.lead_name}"` : ''} is due at ${dueStr}`,
          referenceId:   task.id,
          referenceType: 'task',
          metadata:      { lead_name: task.lead_name, due_date: task.due_date, priority: task.priority },
        });

        // Mark reminded so we don't fire again
        await pool.query(
          `UPDATE tasks SET follow_up_reminder_sent = true WHERE id = $1`, [task.id]
        );
      } catch (e) {
        console.error(`[Reminder Cron] Follow-up reminder failed for task ${task.id}:`, e.message);
      }
    }

    if (result.rows.length) {
      console.log(`[Reminder Cron] Follow-up 2h reminders sent: ${result.rows.length}`);
    }
  } catch (e) {
    console.error('[Reminder Cron] Follow-up reminder query failed:', e.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// JOB 2 — Follow-up overdue notification
// Find tasks that are past due, still open, and haven't been notified yet
// ─────────────────────────────────────────────────────────────────────────────
const runFollowUpOverdue = async () => {
  const now = new Date();

  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.due_date, t.priority, t.assigned_to,
              l.name AS lead_name
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       WHERE t.is_completed           = false
         AND t.follow_up_overdue_sent = false
         AND t.due_date               < $1`,
      [now]
    );

    for (const task of result.rows) {
      try {
        const overdueBy = Math.round((now - new Date(task.due_date)) / 60000); // minutes
        const overdueStr = overdueBy >= 60
          ? `${Math.floor(overdueBy / 60)}h ${overdueBy % 60}m`
          : `${overdueBy}m`;

        await notifyAll({
          execId:        task.assigned_to,
          type:          'follow_up_overdue',
          title:         'Follow-Up Overdue',
          message:       `Task "${task.title}"${task.lead_name ? ` for "${task.lead_name}"` : ''} is overdue by ${overdueStr}`,
          referenceId:   task.id,
          referenceType: 'task',
          metadata:      { lead_name: task.lead_name, due_date: task.due_date, overdue_minutes: overdueBy },
        });

        await pool.query(
          `UPDATE tasks SET follow_up_overdue_sent = true WHERE id = $1`, [task.id]
        );
      } catch (e) {
        console.error(`[Reminder Cron] Overdue notification failed for task ${task.id}:`, e.message);
      }
    }

    if (result.rows.length) {
      console.log(`[Reminder Cron] Follow-up overdue notifications sent: ${result.rows.length}`);
    }
  } catch (e) {
    console.error('[Reminder Cron] Overdue query failed:', e.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// JOB 3 — Site visit 2-hour reminder
// ─────────────────────────────────────────────────────────────────────────────
const runSiteVisitReminders = async () => {
  const now       = new Date();
  const nowIST    = toIST(now);

  // We want visits whose combined (visit_date + visit_time) is in [now+1h45m, now+2h15m]
  // This 30-min window means the cron (runs every 15min) will catch it once
  const windowStart = new Date(now.getTime() + (1 * 60 + 45) * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + (2 * 60 + 15) * 60 * 1000);

  // Convert window to date+time components in IST for the DB query
  // Easier: cast visit_date+visit_time to TIMESTAMPTZ in the query
  try {
    const result = await pool.query(
      `SELECT sv.id, sv.visit_date, sv.visit_time, sv.assigned_to,
              l.name  AS lead_name,
              l.phone AS lead_phone,
              p.name  AS project_name
       FROM site_visits sv
       LEFT JOIN leads    l ON l.id = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       WHERE sv.status               = 'scheduled'
         AND sv.visit_reminder_sent  = false
         AND (sv.visit_date + sv.visit_time) AT TIME ZONE 'Asia/Kolkata'
             BETWEEN $1 AND $2`,
      [windowStart, windowEnd]
    );

    for (const sv of result.rows) {
      try {
        const visitDateStr = new Date(sv.visit_date).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata',
        });
        const visitTimeStr = String(sv.visit_time).slice(0, 5); // "HH:MM"

        await notifyAll({
          execId:        sv.assigned_to,
          type:          'visit_reminder',
          title:         'Site Visit in 2 Hours',
          message:       `Site visit for "${sv.lead_name || 'lead'}" at ${sv.project_name || 'project'} — today at ${visitTimeStr}`,
          referenceId:   sv.id,
          referenceType: 'site_visit',
          metadata:      {
            lead_name:    sv.lead_name,
            lead_phone:   sv.lead_phone,
            project_name: sv.project_name,
            visit_date:   sv.visit_date,
            visit_time:   visitTimeStr,
          },
        });

        await pool.query(
          `UPDATE site_visits SET visit_reminder_sent = true WHERE id = $1`, [sv.id]
        );
      } catch (e) {
        console.error(`[Reminder Cron] Site visit reminder failed for ${sv.id}:`, e.message);
      }
    }

    if (result.rows.length) {
      console.log(`[Reminder Cron] Site visit 2h reminders sent: ${result.rows.length}`);
    }
  } catch (e) {
    console.error('[Reminder Cron] Site visit reminder query failed:', e.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// JOB 4 — Site re-visit 2-hour reminder
// site_revisits.visit_time is VARCHAR "HH:MM", not TIME — handle separately
// ─────────────────────────────────────────────────────────────────────────────
const runRevisitReminders = async () => {
  const now         = new Date();
  const windowStart = new Date(now.getTime() + (1 * 60 + 45) * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + (2 * 60 + 15) * 60 * 1000);

  try {
    // Fetch all scheduled re-visits today and tomorrow that haven't been reminded yet
    // We check the window in JS because visit_time is VARCHAR
    const today    = toIST(now).toISOString().split('T')[0];
    const tomorrow = (() => { const d = toIST(now); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })();

    const result = await pool.query(
      `SELECT sr.id, sr.visit_date, sr.visit_time, sr.assigned_to,
              l.name  AS lead_name,
              l.phone AS lead_phone,
              p.name  AS project_name
       FROM site_revisits sr
       LEFT JOIN leads    l ON l.id = sr.lead_id
       LEFT JOIN projects p ON p.id = sr.project_id
       WHERE sr.status               = 'scheduled'
         AND sr.visit_reminder_sent  = false
         AND sr.visit_date IN ($1, $2)`,
      [today, tomorrow]
    );

    for (const rv of result.rows) {
      try {
        // Build datetime from visit_date + visit_time VARCHAR
        const visitDt = combineDateTime(rv.visit_date, rv.visit_time);

        // Only fire if within the 2-hour window
        if (visitDt < windowStart || visitDt > windowEnd) continue;

        const visitTimeStr = String(rv.visit_time).slice(0, 5);

        await notifyAll({
          execId:        rv.assigned_to,
          type:          'visit_reminder',
          title:         'Re-visit in 2 Hours',
          message:       `Re-visit for "${rv.lead_name || 'lead'}" at ${rv.project_name || 'project'} — today at ${visitTimeStr}`,
          referenceId:   rv.id,
          referenceType: 'site_revisit',
          metadata:      {
            lead_name:    rv.lead_name,
            lead_phone:   rv.lead_phone,
            project_name: rv.project_name,
            visit_date:   rv.visit_date,
            visit_time:   visitTimeStr,
          },
        });

        await pool.query(
          `UPDATE site_revisits SET visit_reminder_sent = true WHERE id = $1`, [rv.id]
        );
      } catch (e) {
        console.error(`[Reminder Cron] Re-visit reminder failed for ${rv.id}:`, e.message);
      }
    }

    if (result.rows.length > 0) {
      console.log(`[Reminder Cron] Re-visit 2h reminders checked: ${result.rows.length} candidates`);
    }
  } catch (e) {
    console.error('[Reminder Cron] Re-visit reminder query failed:', e.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Master tick — runs all 4 jobs every 15 minutes
// ─────────────────────────────────────────────────────────────────────────────
const runAllJobs = async () => {
  console.log(`[Reminder Cron] Tick at ${new Date().toISOString()}`);
  await Promise.allSettled([
    runFollowUpReminders(),
    runFollowUpOverdue(),
    runSiteVisitReminders(),
    runRevisitReminders(),
  ]);
};

// ── Schedule ──────────────────────────────────────────────────────────────────
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const start = () => {
  console.log('[Reminder Cron] Starting — runs every 15 minutes');
  console.log('[Reminder Cron] Jobs: follow_up_reminder, follow_up_overdue, visit_reminder, revisit_reminder');

  // Run once immediately on startup (catches anything missed during downtime)
  runAllJobs();

  // Then every 15 minutes
  setInterval(runAllJobs, INTERVAL_MS);

  console.log('[Reminder Cron] Scheduled');
};

module.exports = {
  start,
  // Export individual jobs for manual testing
  runFollowUpReminders,
  runFollowUpOverdue,
  runSiteVisitReminders,
  runRevisitReminders,
};
