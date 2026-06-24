/**
 * whatsappCron.js — Next One Realty CRM
 *
 * Runs reminder jobs daily using setInterval (no npm packages needed):
 *   Site visits:
 *     1. 09:00 AM IST — "tomorrow" reminder for visits happening next day
 *     2. 08:00 AM IST — "today" reminder for visits happening today
 *   Re-visits (site_revisits):
 *     3. 09:00 AM IST — "tomorrow" reminder for re-visits happening next day
 *     4. Every 15 min — 2-hour-before reminder (visit_time is a free-text
 *        VARCHAR like "14:30", so this can't be a fixed daily clock time —
 *        it's checked on a rolling window instead, same approach reminderCron.js
 *        uses for the in-app version of this same reminder)
 *
 * Called once from index.js: require('./config/whatsappCron').start()
 */

const { pool }                    = require('./db');
const {
  sendSiteVisitReminder1Day, sendSiteVisitReminderToday,
  sendRevisitReminder1Day, sendRevisitReminder2Hour,
} = require('../utils/whatsappService');

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

// Combine a DATE string and a free-text TIME string ("14:30" or "14:30:00") into
// a JS Date in IST. site_revisits.visit_time is VARCHAR, not a real TIME column.
const combineDateTime = (dateStr, timeStr) => {
  const t = String(timeStr).slice(0, 5); // "HH:MM"
  return new Date(`${dateStr}T${t}:00+05:30`);
};

// ── Re-visit 1-day reminder job ────────────────────────────────────────────────
const runRevisitOneDayReminders = async () => {
  const tomorrow = tomorrowIST();
  console.log(`[WA Cron] Running re-visit 1-day reminders for ${tomorrow}`);

  try {
    const result = await pool.query(
      `SELECT sr.id, sr.visit_date, sr.visit_time,
              l.name  AS lead_name,
              l.phone AS lead_phone,
              p.name  AS project_name
       FROM site_revisits sr
       JOIN leads    l ON l.id = sr.lead_id
       JOIN projects p ON p.id = sr.project_id
       WHERE sr.visit_date = $1
         AND sr.status = 'scheduled'
         AND (sr.whatsapp_1day_sent IS NULL OR sr.whatsapp_1day_sent = false)
         AND l.phone IS NOT NULL`,
      [tomorrow]
    );

    console.log(`[WA Cron] Found ${result.rows.length} re-visit(s) for tomorrow`);

    for (const row of result.rows) {
      try {
        await sendRevisitReminder1Day({
          leadPhone:   row.lead_phone,
          projectName: row.project_name,
          visitDate:   row.visit_date,
          visitTime:   row.visit_time,
        });
        await pool.query(
          `UPDATE site_revisits SET whatsapp_1day_sent = true WHERE id = $1`,
          [row.id]
        );
      } catch (e) {
        console.error(`[WA Cron] Re-visit 1-day reminder failed for ${row.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[WA Cron] Re-visit 1-day reminder query failed:', e.message);
  }
};

// ── Re-visit 2-hour reminder job — rolling window, runs every 15 min ──────────
const runRevisitTwoHourReminders = async () => {
  const now          = new Date();
  const windowStart  = new Date(now.getTime() + (1 * 60 + 45) * 60 * 1000);
  const windowEnd    = new Date(now.getTime() + (2 * 60 + 15) * 60 * 1000);
  const today        = todayIST();
  const tomorrow     = tomorrowIST();

  try {
    // visit_time is VARCHAR — fetch today/tomorrow candidates, then filter the
    // exact window in JS (same approach reminderCron.js uses for the in-app version)
    const result = await pool.query(
      `SELECT sr.id, sr.visit_date, sr.visit_time,
              l.name  AS lead_name,
              l.phone AS lead_phone,
              p.name  AS project_name
       FROM site_revisits sr
       JOIN leads    l ON l.id = sr.lead_id
       JOIN projects p ON p.id = sr.project_id
       WHERE sr.status = 'scheduled'
         AND (sr.whatsapp_2hour_sent IS NULL OR sr.whatsapp_2hour_sent = false)
         AND sr.visit_date IN ($1, $2)
         AND l.phone IS NOT NULL`,
      [today, tomorrow]
    );

    for (const row of result.rows) {
      try {
        const visitDt = combineDateTime(row.visit_date, row.visit_time);
        if (visitDt < windowStart || visitDt > windowEnd) continue;

        await sendRevisitReminder2Hour({
          leadPhone:   row.lead_phone,
          projectName: row.project_name,
          visitTime:   row.visit_time,
        });
        await pool.query(
          `UPDATE site_revisits SET whatsapp_2hour_sent = true WHERE id = $1`,
          [row.id]
        );
      } catch (e) {
        console.error(`[WA Cron] Re-visit 2-hour reminder failed for ${row.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[WA Cron] Re-visit 2-hour reminder query failed:', e.message);
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
    runRevisitOneDayReminders();
    setInterval(() => {
      runOneDayReminders();
      runRevisitOneDayReminders();
    }, 24 * 60 * 60 * 1000); // repeat every 24h
  }, ms1Day);

  // Day-of reminder at 08:00 IST daily
  const msToday = msUntilIST(8, 0);
  console.log(`[WA Cron] Day-of reminder fires in ${Math.round(msToday / 60000)} min`);
  setTimeout(() => {
    runTodayReminders();
    setInterval(runTodayReminders, 24 * 60 * 60 * 1000);
  }, msToday);

  // Re-visit 2-hour reminder — rolling window, checked every 15 min (visit_time
  // is free-text VARCHAR so it can't be scheduled at one fixed clock time)
  setInterval(runRevisitTwoHourReminders, 15 * 60 * 1000);
  console.log('[WA Cron] Re-visit 2-hour reminder checking every 15 min');

  console.log('[WA Cron] ✅ WhatsApp reminder jobs scheduled');
};

module.exports = {
  start,
  runOneDayReminders,
  runTodayReminders,
  runRevisitOneDayReminders,
  runRevisitTwoHourReminders,
};