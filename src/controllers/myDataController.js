/**
 * myDataController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All endpoints return data scoped to the authenticated user (req.user.id).
 * Each section is a separate endpoint under  GET /api/v1/me/*
 *
 *  GET /api/v1/me/summary          → counts across every module
 *  GET /api/v1/me/leads            → leads assigned to me
 *  GET /api/v1/me/site-visits      → site visits assigned to me
 *  GET /api/v1/me/tasks            → tasks assigned to me (follow-ups)
 *  GET /api/v1/me/notifications    → notifications for me
 *  GET /api/v1/me/attendance       → my attendance records
 *  GET /api/v1/me/activities       → lead activities performed by me
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { pool } = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");

// ─── Helper ───────────────────────────────────────────────────────────────────

const parsePage = (q) => ({
  page:     Math.max(1, parseInt(q.page)     || 1),
  per_page: Math.min(100, parseInt(q.per_page) || 20),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/summary
// Returns total counts for every module scoped to the logged-in user
// ─────────────────────────────────────────────────────────────────────────────
const getMySummary = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [
      leadsResult,
      visitsResult,
      tasksResult,
      overdueResult,
      notifsResult,
      activitiesResult,
      attendanceResult,
    ] = await Promise.all([
      // Leads assigned to me
      pool.query(
        `SELECT
           COUNT(*)                                                  AS total,
           COUNT(*) FILTER (WHERE status = 'new')                   AS new,
           COUNT(*) FILTER (WHERE status = 'contacted')             AS contacted,
           COUNT(*) FILTER (WHERE status = 'interested')            AS interested,
           COUNT(*) FILTER (WHERE status = 'follow_up')             AS follow_up,
           COUNT(*) FILTER (WHERE status = 'site_visit_scheduled')  AS site_visit_scheduled,
           COUNT(*) FILTER (WHERE status = 'site_visit_done')       AS site_visit_done,
           COUNT(*) FILTER (WHERE status = 'negotiation')           AS negotiation,
           COUNT(*) FILTER (WHERE status = 'booked')                AS booked,
           COUNT(*) FILTER (WHERE status = 'lost')                  AS lost
         FROM leads
         WHERE assigned_to = $1 AND is_archived = false`,
        [userId]
      ),

      // Site visits assigned to me
      pool.query(
        `SELECT
           COUNT(*)                                                   AS total,
           COUNT(*) FILTER (WHERE status = 'scheduled')              AS scheduled,
           COUNT(*) FILTER (WHERE status = 'done')                   AS done,
           COUNT(*) FILTER (WHERE status = 'cancelled')              AS cancelled,
           COUNT(*) FILTER (WHERE status = 'rescheduled')            AS rescheduled,
           COUNT(*) FILTER (WHERE status = 'no_show')                AS no_show,
           COUNT(*) FILTER (WHERE visit_date >= CURRENT_DATE
                               AND status IN ('scheduled','rescheduled')) AS upcoming
         FROM site_visits
         WHERE assigned_to = $1`,
        [userId]
      ),

      // Tasks / follow-ups assigned to me
      pool.query(
        `SELECT
           COUNT(*)                                                              AS total,
           COUNT(*) FILTER (WHERE is_completed = false)                         AS pending,
           COUNT(*) FILTER (WHERE is_completed = true)                          AS completed,
           COUNT(*) FILTER (WHERE is_completed = false AND due_date < NOW())    AS overdue,
           COUNT(*) FILTER (WHERE is_completed = false
                               AND due_date::date = CURRENT_DATE)               AS due_today
         FROM tasks
         WHERE assigned_to = $1`,
        [userId]
      ),

      // Overdue tasks (already in tasks query — kept separate for clarity above)
      pool.query(`SELECT 1 LIMIT 0`), // placeholder, removed below

      // Unread notifications
      pool.query(
        `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND is_read = false`,
        [userId]
      ),

      // Activities I performed this month
      pool.query(
        `SELECT COUNT(*) AS total
         FROM lead_activities
         WHERE performed_by = $1
           AND created_at >= DATE_TRUNC('month', NOW())`,
        [userId]
      ),

      // Attendance this month
      pool.query(
        `SELECT
           COUNT(*)                                              AS total_days,
           COUNT(*) FILTER (WHERE status = 'present')           AS present,
           COUNT(*) FILTER (WHERE status = 'absent')            AS absent,
           COUNT(*) FILTER (WHERE status = 'half_day')          AS half_day,
           COUNT(*) FILTER (WHERE status = 'on_leave')          AS on_leave
         FROM attendance
         WHERE user_id = $1
           AND date >= DATE_TRUNC('month', CURRENT_DATE)
           AND date <= CURRENT_DATE`,
        [userId]
      ),
    ]);

    const L = leadsResult.rows[0];
    const V = visitsResult.rows[0];
    const T = tasksResult.rows[0];
    const N = notifsResult.rows[0];
    const A = activitiesResult.rows[0];
    const ATT = attendanceResult.rows[0];

    return sendSuccess(res, "My summary fetched", {
      user: {
        id:         req.user.id,
        name:       `${req.user.first_name} ${req.user.last_name}`,
        role:       req.user.role,
        email:      req.user.email,
        phone:      req.user.phone_number,
      },
      leads: {
        total:                  parseInt(L.total),
        new:                    parseInt(L.new),
        contacted:              parseInt(L.contacted),
        interested:             parseInt(L.interested),
        follow_up:              parseInt(L.follow_up),
        site_visit_scheduled:   parseInt(L.site_visit_scheduled),
        site_visit_done:        parseInt(L.site_visit_done),
        negotiation:            parseInt(L.negotiation),
        booked:                 parseInt(L.booked),
        lost:                   parseInt(L.lost),
        conversion_rate:
          parseInt(L.total) > 0
            ? parseFloat(((parseInt(L.booked) / parseInt(L.total)) * 100).toFixed(1))
            : 0,
      },
      site_visits: {
        total:       parseInt(V.total),
        scheduled:   parseInt(V.scheduled),
        done:        parseInt(V.done),
        cancelled:   parseInt(V.cancelled),
        rescheduled: parseInt(V.rescheduled),
        no_show:     parseInt(V.no_show),
        upcoming:    parseInt(V.upcoming),
      },
      tasks: {
        total:     parseInt(T.total),
        pending:   parseInt(T.pending),
        completed: parseInt(T.completed),
        overdue:   parseInt(T.overdue),
        due_today: parseInt(T.due_today),
      },
      notifications: {
        unread: parseInt(N.unread),
      },
      activities_this_month: parseInt(A.total),
      attendance_this_month: {
        total_days: parseInt(ATT.total_days),
        present:    parseInt(ATT.present),
        absent:     parseInt(ATT.absent),
        half_day:   parseInt(ATT.half_day),
        on_leave:   parseInt(ATT.on_leave),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/leads
// Leads assigned to the logged-in user
// Query: status, source, project_id, from, to, search, page, per_page
// ─────────────────────────────────────────────────────────────────────────────
const getMyLeads = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, source, project_id, from, to, search } = req.query;
    const { page, per_page } = parsePage(req.query);
    const offset = (page - 1) * per_page;

    let conditions = ["l.assigned_to = $1", "l.is_archived = false"];
    const params = [userId];
    let idx = 2;

    if (status)     { conditions.push(`l.status = $${idx++}`);                   params.push(status); }
    if (source)     { conditions.push(`l.source ILIKE $${idx++}`);               params.push(`%${source}%`); }
    if (project_id) { conditions.push(`l.project_id = $${idx++}`);               params.push(project_id); }
    if (from)       { conditions.push(`l.created_at::date >= $${idx++}`);        params.push(from); }
    if (to)         { conditions.push(`l.created_at::date <= $${idx++}`);        params.push(to); }
    if (search) {
      conditions.push(`(l.name ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.email ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [countResult, dataResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM leads l ${where}`,
        params
      ),
      pool.query(
        `SELECT
           l.id, l.name, l.phone, l.alternate_phone_number, l.email,
           l.status, l.source, l.budget, l.location_preference,
           l.project_id, l.created_at, l.updated_at,
           p.name  AS project_name,
           p.city  AS project_city
         FROM leads l
         LEFT JOIN projects p ON p.id = l.project_id
         ${where}
         ORDER BY l.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, per_page, offset]
      ),
    ]);

    return res.json(paginate(dataResult.rows, parseInt(countResult.rows[0].count), page, per_page));
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/site-visits
// Site visits assigned to the logged-in user
// Query: status, from, to, page, per_page
// ─────────────────────────────────────────────────────────────────────────────
const getMySiteVisits = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, from, to, upcoming } = req.query;
    const { page, per_page } = parsePage(req.query);
    const offset = (page - 1) * per_page;

    let conditions = ["sv.assigned_to = $1"];
    const params = [userId];
    let idx = 2;

    if (status)   { conditions.push(`sv.status = $${idx++}`);              params.push(status); }
    if (from)     { conditions.push(`sv.visit_date >= $${idx++}`);         params.push(from); }
    if (to)       { conditions.push(`sv.visit_date <= $${idx++}`);         params.push(to); }
    if (upcoming === "true") {
      conditions.push(`sv.visit_date >= CURRENT_DATE`);
      conditions.push(`sv.status IN ('scheduled','rescheduled')`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM site_visits sv ${where}`, params),
      pool.query(
        `SELECT
           sv.id, sv.visit_date, sv.visit_time, sv.status,
           sv.transport_arranged, sv.notes,
           sv.created_at, sv.updated_at,
           l.id    AS lead_id,
           l.name  AS lead_name,
           l.phone AS lead_phone,
           p.id    AS project_id,
           p.name  AS project_name,
           p.city  AS project_city,
           p.locality AS project_locality,
           svf.rating, svf.client_reaction, svf.next_step, svf.remarks
         FROM site_visits sv
         JOIN    leads    l   ON l.id  = sv.lead_id
         JOIN    projects p   ON p.id  = sv.project_id
         LEFT JOIN site_visit_feedback svf ON svf.site_visit_id = sv.id
         ${where}
         ORDER BY sv.visit_date DESC, sv.visit_time DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, per_page, offset]
      ),
    ]);

    return res.json(paginate(dataResult.rows, parseInt(countResult.rows[0].count), page, per_page));
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/tasks
// Tasks / follow-ups assigned to the logged-in user
// Query: is_completed, priority, overdue, due_today, lead_id, page, per_page
// ─────────────────────────────────────────────────────────────────────────────
const getMyTasks = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { is_completed, priority, overdue, due_today, lead_id } = req.query;
    const { page, per_page } = parsePage(req.query);
    const offset = (page - 1) * per_page;

    let conditions = ["t.assigned_to = $1"];
    const params = [userId];
    let idx = 2;

    if (is_completed !== undefined) {
      conditions.push(`t.is_completed = $${idx++}`);
      params.push(is_completed === "true");
    }
    if (priority)  { conditions.push(`t.priority = $${idx++}`);  params.push(priority); }
    if (lead_id)   { conditions.push(`t.lead_id = $${idx++}`);   params.push(lead_id); }
    if (overdue === "true")    conditions.push(`t.is_completed = false AND t.due_date < NOW()`);
    if (due_today === "true")  conditions.push(`t.is_completed = false AND t.due_date::date = CURRENT_DATE`);

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM tasks t ${where}`, params),
      pool.query(
        `SELECT
           t.id, t.title, t.notes, t.priority,
           t.due_date, t.is_completed, t.completed_at,
           t.created_at, t.updated_at,
           l.id    AS lead_id,
           l.name  AS lead_name,
           l.phone AS lead_phone,
           l.status AS lead_status,
           p.name  AS project_name,
           CONCAT(cb.first_name,' ',cb.last_name) AS created_by_name
         FROM tasks t
         LEFT JOIN leads    l  ON l.id = t.lead_id
         LEFT JOIN projects p  ON p.id = l.project_id
         LEFT JOIN users    cb ON cb.id = t.created_by
         ${where}
         ORDER BY
           t.is_completed ASC,
           CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           t.due_date ASC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, per_page, offset]
      ),
    ]);

    return res.json(paginate(dataResult.rows, parseInt(countResult.rows[0].count), page, per_page));
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/notifications
// Notifications for the logged-in user
// Query: is_read, type, page, per_page
// ─────────────────────────────────────────────────────────────────────────────
const getMyNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { is_read, type } = req.query;
    const { page, per_page } = parsePage(req.query);
    const offset = (page - 1) * per_page;

    let conditions = ["n.user_id = $1"];
    const params = [userId];
    let idx = 2;

    if (is_read !== undefined) {
      conditions.push(`n.is_read = $${idx++}`);
      params.push(is_read === "true");
    }
    if (type) { conditions.push(`n.type = $${idx++}`); params.push(type); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [countResult, dataResult, unreadResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM notifications n ${where}`, params),
      pool.query(
        `SELECT
           n.id, n.type, n.title, n.message,
           n.is_read, n.reference_id, n.reference_type,
           n.created_at
         FROM notifications n
         ${where}
         ORDER BY n.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, per_page, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND is_read = false`,
        [userId]
      ),
    ]);

    const result = paginate(dataResult.rows, parseInt(countResult.rows[0].count), page, per_page);
    result.unread_count = parseInt(unreadResult.rows[0].unread);
    return res.json(result);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/attendance
// Attendance records for the logged-in user
// Query: from, to, status, page, per_page
// ─────────────────────────────────────────────────────────────────────────────
const getMyAttendance = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, from, to } = req.query;
    const { page, per_page } = parsePage(req.query);
    const offset = (page - 1) * per_page;

    // Default: current month
    const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString().split("T")[0];
    const toDate   = to   || new Date().toISOString().split("T")[0];

    let conditions = ["a.user_id = $1", "a.date BETWEEN $2 AND $3"];
    const params = [userId, fromDate, toDate];
    let idx = 4;

    if (status) { conditions.push(`a.status = $${idx++}`); params.push(status); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [countResult, dataResult, summaryResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM attendance a ${where}`, params),
      pool.query(
        `SELECT
           a.id, a.date, a.status, a.leave_type,
           a.check_in_time, a.check_out_time,
           a.checkin_ip, a.checkout_ip,
           a.is_manual_entry,
           CONCAT(mb.first_name,' ',mb.last_name) AS manual_by_name,
           CASE
             WHEN a.check_in_time IS NOT NULL AND a.check_out_time IS NOT NULL
             THEN EXTRACT(EPOCH FROM (a.check_out_time - a.check_in_time)) / 3600
             ELSE NULL
           END AS hours_worked
         FROM attendance a
         LEFT JOIN users mb ON mb.id = a.manual_by
         ${where}
         ORDER BY a.date DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, per_page, offset]
      ),
      pool.query(
        `SELECT
           COUNT(*)                                          AS total_days,
           COUNT(*) FILTER (WHERE status = 'present')       AS present,
           COUNT(*) FILTER (WHERE status = 'absent')        AS absent,
           COUNT(*) FILTER (WHERE status = 'half_day')      AS half_day,
           COUNT(*) FILTER (WHERE status = 'on_leave')      AS on_leave,
           ROUND(
             AVG(
               CASE
                 WHEN check_in_time IS NOT NULL AND check_out_time IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 3600
               END
             )::numeric, 2
           ) AS avg_hours_per_day
         FROM attendance
         WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
        [userId, fromDate, toDate]
      ),
    ]);

    const summary = summaryResult.rows[0];
    const result  = paginate(
      dataResult.rows.map((r) => ({
        ...r,
        hours_worked: r.hours_worked ? parseFloat(parseFloat(r.hours_worked).toFixed(2)) : null,
      })),
      parseInt(countResult.rows[0].count),
      page,
      per_page
    );
    result.period = { from: fromDate, to: toDate };
    result.summary = {
      total_days:       parseInt(summary.total_days),
      present:          parseInt(summary.present),
      absent:           parseInt(summary.absent),
      half_day:         parseInt(summary.half_day),
      on_leave:         parseInt(summary.on_leave),
      avg_hours_per_day: summary.avg_hours_per_day
        ? parseFloat(summary.avg_hours_per_day)
        : null,
    };
    return res.json(result);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/activities
// Lead activities performed by the logged-in user
// Query: type, lead_id, from, to, page, per_page
// ─────────────────────────────────────────────────────────────────────────────
const getMyActivities = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type, lead_id, from, to } = req.query;
    const { page, per_page } = parsePage(req.query);
    const offset = (page - 1) * per_page;

    let conditions = ["la.performed_by = $1"];
    const params = [userId];
    let idx = 2;

    if (type)    { conditions.push(`la.type = $${idx++}`);                params.push(type); }
    if (lead_id) { conditions.push(`la.lead_id = $${idx++}`);             params.push(lead_id); }
    if (from)    { conditions.push(`la.created_at::date >= $${idx++}`);   params.push(from); }
    if (to)      { conditions.push(`la.created_at::date <= $${idx++}`);   params.push(to); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM lead_activities la ${where}`, params),
      pool.query(
        `SELECT
           la.id, la.type, la.note, la.created_at,
           l.id    AS lead_id,
           l.name  AS lead_name,
           l.phone AS lead_phone,
           l.status AS lead_status,
           p.name  AS project_name
         FROM lead_activities la
         JOIN  leads    l ON l.id = la.lead_id
         LEFT JOIN projects p ON p.id = l.project_id
         ${where}
         ORDER BY la.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, per_page, offset]
      ),
    ]);

    return res.json(paginate(dataResult.rows, parseInt(countResult.rows[0].count), page, per_page));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMySummary,
  getMyLeads,
  getMySiteVisits,
  getMyTasks,
  getMyNotifications,
  getMyAttendance,
  getMyActivities,
};
