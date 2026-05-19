/**
 * whatsappCron.js — Next One Realty CRM
 *
 * Runs two reminder jobs daily using setInterval (no npm packages needed):
 *   1. 09:00 AM IST — sends "tomorrow" reminder for visits happening next day
 *   2. 08:00 AM IST — sends "today" reminder for visits happening today
 *
 * Called once from index.js: require('./config/whatsappCron').start()
 */

const { pool }                    = require('./db');
const { sendSiteVisitReminder1Day, sendSiteVisitReminderToday } = require('../utils/whatsappService');

// ── Helpers ───────────────────────────────────────────────────────────────────
const toIST = (date) => {
  // IST = UTC + 5:30
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + 330 * 60000);
};

const todayIST = () => {
  const ist = toIST(new Date());
  return ist.toISOString().split('T')[0]; // YYYY-MM-DD
};

const tomorrowIST = () => {
  const ist = toIST(new Date());
  ist.setDate(ist.getDate() + 1);
  return ist.toISOString().split('T')[0];
};

// Milliseconds until next HH:MM in IST
const msUntilIST = (targetHour, targetMin) => {
  const now = toIST(new Date());
  const target = new Date(now);
  target.setHours(targetHour, targetMin, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1); // next day
  return target.getTime() - now.getTime();
};

// ── 1-day reminder job ────────────────────────────────────────────────────────
const runOneDayReminders = async () => {
  const tomorrow = tomorrowIST();
  console.log(`[WA Cron] Running 1-day reminders for ${tomorrow}`);

  try {
    const result = await pool.query(
      `SELECT sv.id, sv.visit_date, sv.visit_time,
              l.name  AS lead_name,
              l.phone AS lead_phone,
              p.name  AS project_name,
              sv.whatsapp_1day_sent
       FROM site_visits sv
       JOIN leads    l ON l.id = sv.lead_id
       JOIN projects p ON p.id = sv.project_id
       WHERE sv.visit_date = $1
         AND sv.status = 'scheduled'
         AND (sv.whatsapp_1day_sent IS NULL OR sv.whatsapp_1day_sent = false)
         AND l.phone IS NOT NULL`,
      [tomorrow]
    );

    console.log(`[WA Cron] Found ${result.rows.length} visit(s) for tomorrow`);

    for (const row of result.rows) {
      try {
        await sendSiteVisitReminder1Day({
          leadName:    row.lead_name,
          leadPhone:   row.lead_phone,
          projectName: row.project_name,
          visitDate:   row.visit_date,
          visitTime:   row.visit_time,
        });
        // Mark as sent so we don't double-send
        await pool.query(
          `UPDATE site_visits SET whatsapp_1day_sent = true WHERE id = $1`,
          [row.id]
        );
      } catch (e) {
        console.error(`[WA Cron] 1-day reminder failed for visit ${row.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[WA Cron] 1-day reminder query failed:', e.message);
  }
};

// ── Day-of reminder job ───────────────────────────────────────────────────────
const runTodayReminders = async () => {
  const today = todayIST();
  console.log(`[WA Cron] Running day-of reminders for ${today}`);

  try {
    const result = await pool.query(
      `SELECT sv.id, sv.visit_date, sv.visit_time,
              l.name  AS lead_name,
              l.phone AS lead_phone,
              p.name  AS project_name,
              sv.whatsapp_today_sent
       FROM site_visits sv
       JOIN leads    l ON l.id = sv.lead_id
       JOIN projects p ON p.id = sv.project_id
       WHERE sv.visit_date = $1
         AND sv.status = 'scheduled'
         AND (sv.whatsapp_today_sent IS NULL OR sv.whatsapp_today_sent = false)
         AND l.phone IS NOT NULL`,
      [today]
    );

    console.log(`[WA Cron] Found ${result.rows.length} visit(s) for today`);

    for (const row of result.rows) {
      try {
        await sendSiteVisitReminderToday({
          leadName:    row.lead_name,
          leadPhone:   row.lead_phone,
          projectName: row.project_name,
          visitDate:   row.visit_date,
          visitTime:   row.visit_time,
        });
        await pool.query(
          `UPDATE site_visits SET whatsapp_today_sent = true WHERE id = $1`,
          [row.id]
        );
      } catch (e) {
        console.error(`[WA Cron] Day-of reminder failed for visit ${row.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[WA Cron] Day-of reminder query failed:', e.message);
  }
};

// ── Schedule ──────────────────────────────────────────────────────────────────
const start = () => {
  console.log('[WA Cron] Scheduling WhatsApp reminder jobs (IST)...');

  // 1-day reminder at 09:00 IST daily
  const ms1Day = msUntilIST(9, 0);
  console.log(`[WA Cron] 1-day reminder fires in ${Math.round(ms1Day / 60000)} min`);
  setTimeout(() => {
    runOneDayReminders();
    setInterval(runOneDayReminders, 24 * 60 * 60 * 1000); // repeat every 24h
  }, ms1Day);

  // Day-of reminder at 08:00 IST daily
  const msToday = msUntilIST(8, 0);
  console.log(`[WA Cron] Day-of reminder fires in ${Math.round(msToday / 60000)} min`);
  setTimeout(() => {
    runTodayReminders();
    setInterval(runTodayReminders, 24 * 60 * 60 * 1000);
  }, msToday);

  console.log('[WA Cron] ✅ WhatsApp reminder jobs scheduled');
};

module.exports = { start, runOneDayReminders, runTodayReminders };
