/**
 * reportController.js — Next One Realty CRM
 * Daily Activity Report (Admin / Super Admin only).
 *
 * Every number is computed live from the source tables for the requested
 * IST calendar day, so the report is always current — nothing to reset or
 * snapshot at midnight.
 */

const { pool } = require("../config/db");
const { sendSuccess } = require("../utils/response");
const AppError = require("../utils/AppError");
const { getTeamIds } = require("../utils/teamUtils");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Today's date in IST as YYYY-MM-DD
const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

// IST day [start, end) as absolute instants — lets the timestamptz indexes be used
const istDayBounds = (date) => {
  const start = new Date(`${date}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
};

const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
};

// Validates query params shared by both endpoints
const parseCommonQuery = (query) => {
  const date = query.date || todayIST();
  if (!DATE_RE.test(date) || isNaN(new Date(`${date}T00:00:00Z`))) {
    throw new AppError("date must be in YYYY-MM-DD format", 400);
  }
  const project_id = query.project_id || null;
  if (project_id && !UUID_RE.test(project_id)) throw new AppError("Invalid project_id", 400);
  const source = query.source ? String(query.source).trim() : null;
  return { date, project_id, source };
};

// Lead-level filter applied to every lead-linked metric. $2 = project_id, $3 = source
const leadFilter = (alias) =>
  `($2::uuid IS NULL OR ${alias}.project_id = $2::uuid) AND ($3::text IS NULL OR ${alias}.source ILIKE $3::text)`;

/**
 * GET /api/v1/reports/daily
 * Query: date (YYYY-MM-DD, default today IST), team (manager user id — includes
 *        their whole sub-tree), user_id, project_id, source
 */
const getDailyReport = async (req, res, next) => {
  try {
    const { date, project_id, source } = parseCommonQuery(req.query);
    const { team, user_id } = req.query;
    if (team && !UUID_RE.test(team)) throw new AppError("Invalid team", 400);
    if (user_id && !UUID_RE.test(user_id)) throw new AppError("Invalid user_id", 400);

    // Resolve which users are in scope
    let userIds = null;
    if (team) userIds = await getTeamIds(team);
    if (user_id) userIds = userIds ? userIds.filter((id) => id === user_id) : [user_id];

    const { start, end } = istDayBounds(date);
    const tomorrow = addDays(date, 1);

    // $1 date, $2 project_id, $3 source, $4 user ids, $5 day start, $6 day end, $7 tomorrow
    const params = [date, project_id, source, userIds, start, end, tomorrow];

    const sql = `
      WITH u AS (
        SELECT u.id, u.first_name, u.last_name, u.role, u.manager_id
        FROM users u
        WHERE u.is_active = true
          AND ($4::uuid[] IS NULL OR u.id = ANY($4::uuid[]))
      ),
      new_leads AS (
        SELECT l.assigned_to AS user_id, COUNT(*)::int AS n
        FROM leads l
        WHERE l.created_at >= $5 AND l.created_at < $6 AND ${leadFilter("l")}
        GROUP BY 1
      ),
      acts AS (
        SELECT a.performed_by AS user_id,
               COUNT(*)::int                                   AS total,
               COUNT(*) FILTER (WHERE a.type = 'call')::int     AS calls,
               COUNT(*) FILTER (WHERE a.type = 'whatsapp')::int AS whatsapp,
               COUNT(*) FILTER (WHERE a.type = 'status_change')::int AS status_changes,
               COUNT(*) FILTER (WHERE a.type = 'note')::int     AS notes,
               COUNT(DISTINCT a.lead_id)::int                   AS leads_touched
        FROM lead_activities a
        JOIN leads l ON l.id = a.lead_id
        WHERE a.created_at >= $5 AND a.created_at < $6 AND ${leadFilter("l")}
        GROUP BY 1
      ),
      fu AS (
        SELECT t.assigned_to AS user_id,
               COUNT(*) FILTER (WHERE t.completed_at >= $5 AND t.completed_at < $6)::int AS done,
               COUNT(*) FILTER (WHERE t.due_date >= $5 AND t.due_date < $6)::int        AS due,
               COUNT(*) FILTER (WHERE t.due_date >= $5 AND t.due_date < $6
                                  AND NOT COALESCE(t.is_completed, false))::int        AS pending,
               COUNT(*) FILTER (WHERE t.due_date < $5
                                  AND NOT COALESCE(t.is_completed, false))::int        AS overdue,
               COUNT(*) FILTER (WHERE t.due_date >= $6 AND t.due_date < $6 + INTERVAL '1 day'
                                  AND NOT COALESCE(t.is_completed, false))::int        AS tomorrow
        FROM tasks t
        LEFT JOIN leads l ON l.id = t.lead_id
        WHERE ${leadFilter("l")}
        GROUP BY 1
      ),
      sv AS (
        SELECT s.assigned_to AS user_id,
               COUNT(*) FILTER (WHERE s.visit_date = $1::date)::int                     AS scheduled,
               COUNT(*) FILTER (WHERE s.visit_date = $1::date AND s.status = 'done')::int AS done,
               COUNT(*) FILTER (WHERE s.visit_date = $7::date
                                  AND s.status IN ('scheduled','rescheduled'))::int     AS tomorrow
        FROM site_visits s
        JOIN leads l ON l.id = s.lead_id
        WHERE s.visit_date IN ($1::date, $7::date)
          AND ($2::uuid IS NULL OR COALESCE(s.project_id, l.project_id) = $2::uuid)
          AND ($3::text IS NULL OR l.source ILIKE $3::text)
        GROUP BY 1
      ),
      rv AS (
        SELECT r.assigned_to AS user_id,
               COUNT(*) FILTER (WHERE r.visit_date = $1::date)::int                     AS scheduled,
               COUNT(*) FILTER (WHERE r.visit_date = $1::date AND r.status = 'done')::int AS done
        FROM site_revisits r
        JOIN leads l ON l.id = r.lead_id
        WHERE r.visit_date = $1::date
          AND ($2::uuid IS NULL OR COALESCE(r.project_id, l.project_id) = $2::uuid)
          AND ($3::text IS NULL OR l.source ILIKE $3::text)
        GROUP BY 1
      ),
      cl AS (
        SELECT c.closed_by AS user_id, COUNT(*)::int AS n,
               COALESCE(SUM(c.agreed_price), 0)::numeric AS value
        FROM lead_closures c
        JOIN leads l ON l.id = c.lead_id
        WHERE c.booking_date = $1::date AND c.status <> 'cancelled'
          AND ($2::uuid IS NULL OR COALESCE(c.project_id, l.project_id) = $2::uuid)
          AND ($3::text IS NULL OR l.source ILIKE $3::text)
        GROUP BY 1
      )
      SELECT u.id AS user_id,
             TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS name,
             u.role,
             -- Daily performance score: higher-value outcomes weigh more
             ( COALESCE(a.total, 0)
             + COALESCE(nl.n, 0)
             + COALESCE(fu.done, 0) * 2
             + COALESCE(sv.done, 0) * 5
             + COALESCE(rv.done, 0) * 5
             + COALESCE(cl.n, 0)    * 20 )::int AS score,
             TRIM(m.first_name || ' ' || COALESCE(m.last_name, '')) AS manager_name,
             att.status          AS attendance_status,
             att.check_in_time,
             att.check_out_time,
             att.late_by_minutes,
             COALESCE(nl.n, 0)              AS new_leads,
             COALESCE(a.total, 0)           AS activities,
             COALESCE(a.calls, 0)           AS calls,
             COALESCE(a.whatsapp, 0)        AS whatsapp,
             COALESCE(a.status_changes, 0)  AS status_changes,
             COALESCE(a.notes, 0)           AS notes,
             COALESCE(a.leads_touched, 0)   AS leads_touched,
             COALESCE(fu.done, 0)           AS follow_ups_done,
             COALESCE(fu.due, 0)            AS follow_ups_due,
             COALESCE(fu.pending, 0)        AS follow_ups_pending,
             COALESCE(fu.overdue, 0)        AS follow_ups_overdue,
             COALESCE(fu.tomorrow, 0)       AS follow_ups_tomorrow,
             COALESCE(sv.scheduled, 0)      AS site_visits_scheduled,
             COALESCE(sv.done, 0)           AS site_visits_done,
             COALESCE(sv.tomorrow, 0)       AS site_visits_tomorrow,
             COALESCE(rv.scheduled, 0)      AS revisits_scheduled,
             COALESCE(rv.done, 0)           AS revisits_done,
             COALESCE(cl.n, 0)              AS closures,
             COALESCE(cl.value, 0)          AS closure_value
      FROM u
      LEFT JOIN users m       ON m.id = u.manager_id
      LEFT JOIN attendance att ON att.user_id = u.id AND att.date = $1::date
      LEFT JOIN new_leads nl  ON nl.user_id = u.id
      LEFT JOIN acts a        ON a.user_id  = u.id
      LEFT JOIN fu            ON fu.user_id = u.id
      LEFT JOIN sv            ON sv.user_id = u.id
      LEFT JOIN rv            ON rv.user_id = u.id
      LEFT JOIN cl            ON cl.user_id = u.id
      ORDER BY score DESC, closures DESC, site_visits_done DESC, follow_ups_done DESC, activities DESC, name ASC
    `;

    const [rowsRes, managersRes, sourcesRes, projectsRes] = await Promise.all([
      pool.query(sql, params),
      // Anyone with at least one active report counts as a "team" head
      pool.query(
        `SELECT DISTINCT m.id, TRIM(m.first_name || ' ' || COALESCE(m.last_name, '')) AS name, m.role
         FROM users m
         JOIN users r ON r.manager_id = m.id AND r.is_active = true
         WHERE m.is_active = true
         ORDER BY name`
      ),
      pool.query(`SELECT name FROM lead_sources WHERE is_active = true ORDER BY name`),
      pool.query(`SELECT id, name FROM projects ORDER BY name`),
    ]);

    const users = rowsRes.rows.map((r, i) => ({ ...r, rank: i + 1, closure_value: Number(r.closure_value) }));

    const sumKeys = [
      "new_leads", "activities", "calls", "whatsapp", "leads_touched",
      "follow_ups_done", "follow_ups_due", "follow_ups_pending", "follow_ups_overdue", "follow_ups_tomorrow",
      "site_visits_scheduled", "site_visits_done", "site_visits_tomorrow",
      "revisits_scheduled", "revisits_done", "closures", "closure_value",
    ];
    const summary = Object.fromEntries(sumKeys.map((k) => [k, users.reduce((s, u) => s + (u[k] || 0), 0)]));
    summary.total_users = users.length;
    summary.active_users = users.filter((u) => u.activities > 0 || u.follow_ups_done > 0 || u.new_leads > 0).length;
    summary.attendance = {
      present: users.filter((u) => u.attendance_status === "present").length,
      late:    users.filter((u) => u.attendance_status === "late").length,
      leave:   users.filter((u) => u.attendance_status === "leave").length,
      absent:  users.filter((u) => u.attendance_status === "absent").length,
      not_marked: users.filter((u) => !u.attendance_status).length,
    };

    return sendSuccess(res, "Daily report fetched", {
      date,
      tomorrow,
      summary,
      users,
      filters: {
        teams: managersRes.rows,
        sources: sourcesRes.rows.map((s) => s.name),
        projects: projectsRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/reports/daily/:userId/activities
 * Timeline of everything one user did on the given day (lead activities,
 * completed follow-ups, site visits, closures), newest first.
 */
const getUserDailyActivities = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!UUID_RE.test(userId)) throw new AppError("Invalid user id", 400);
    const { date, project_id, source } = parseCommonQuery(req.query);
    const { start, end } = istDayBounds(date);

    const result = await pool.query(
      `SELECT * FROM (
         SELECT a.id, a.type AS kind, a.note AS description, a.created_at AS at,
                l.id AS lead_id, l.name AS lead_name
         FROM lead_activities a
         JOIN leads l ON l.id = a.lead_id
         WHERE a.performed_by = $1 AND a.created_at >= $4 AND a.created_at < $5 AND ${leadFilter("l")}
         UNION ALL
         SELECT t.id, 'follow_up_done', t.title, t.completed_at, l.id, l.name
         FROM tasks t
         LEFT JOIN leads l ON l.id = t.lead_id
         WHERE t.assigned_to = $1 AND t.completed_at >= $4 AND t.completed_at < $5
           AND ${leadFilter("l")}
         UNION ALL
         SELECT s.id, 'site_visit_' || s.status,
                'Site visit' || COALESCE(' · ' || COALESCE(p.name, s.project_name_text), ''),
                ((s.visit_date + s.visit_time) AT TIME ZONE 'Asia/Kolkata'), l.id, l.name
         FROM site_visits s
         JOIN leads l ON l.id = s.lead_id
         LEFT JOIN projects p ON p.id = s.project_id
         WHERE s.assigned_to = $1 AND s.visit_date = $6::date
           AND ($2::uuid IS NULL OR COALESCE(s.project_id, l.project_id) = $2::uuid)
           AND ($3::text IS NULL OR l.source ILIKE $3::text)
         UNION ALL
         SELECT c.id, 'closure',
                'Booking' || COALESCE(' · ' || COALESCE(p.name, c.project_name_text), '')
                  || COALESCE(' · Unit ' || c.unit_number, ''),
                c.created_at, l.id, l.name
         FROM lead_closures c
         JOIN leads l ON l.id = c.lead_id
         LEFT JOIN projects p ON p.id = c.project_id
         WHERE c.closed_by = $1 AND c.booking_date = $6::date AND c.status <> 'cancelled'
           AND ($2::uuid IS NULL OR COALESCE(c.project_id, l.project_id) = $2::uuid)
           AND ($3::text IS NULL OR l.source ILIKE $3::text)
       ) x
       ORDER BY at DESC NULLS LAST
       LIMIT 500`,
      [userId, project_id, source, start, end, date]
    );

    return sendSuccess(res, "User daily activities fetched", result.rows);
  } catch (err) {
    next(err);
  }
};

module.exports = { getDailyReport, getUserDailyActivities };
