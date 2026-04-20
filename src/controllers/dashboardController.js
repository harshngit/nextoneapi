const { pool } = require("../config/db");
const { sendSuccess, sendError } = require("../utils/response");
const { emitToRole, emitToUser } = require("../config/socket");

const defaultRange = () => {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0],
    to:   now.toISOString().split("T")[0],
  };
};

/**
 * Helper — broadcast dashboard update to relevant users
 * Called from other controllers (leadController, taskController, etc.)
 */
const broadcastDashboardUpdate = (type, data, userId = null) => {
  const payload = { type, data };
  if (userId) {
    emitToUser(userId, "dashboard:update", payload);
  } else {
    emitToRole("super_admin", "dashboard:update", payload);
    emitToRole("admin", "dashboard:update", payload);
    emitToRole("sales_manager", "dashboard:update", payload);
  }
};

/**
 * GET /api/v1/dashboard/overview
 */
const getOverview = async (req, res) => {
  try {
    const { role, id: callerId } = req.user;
    const { from, to, project_id } = req.query;
    const range = { from: from || defaultRange().from, to: to || defaultRange().to };

    let conditions = ["is_archived = false", "created_at::date BETWEEN $1 AND $2"];
    const params = [range.from, range.to];
    let idx = 3;

    if (role === "sales_executive") { conditions.push(`assigned_to = $${idx++}`); params.push(callerId); }
    else if (role === "sales_manager") {
      conditions.push(`assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx++})`);
      params.push(callerId);
    }
    if (project_id) { conditions.push(`project_id = $${idx++}`); params.push(project_id); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const result = await pool.query(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'new')                  AS new,
        COUNT(*) FILTER (WHERE status = 'contacted')            AS contacted,
        COUNT(*) FILTER (WHERE status = 'interested')           AS interested,
        COUNT(*) FILTER (WHERE status = 'follow_up')            AS follow_up,
        COUNT(*) FILTER (WHERE status = 'site_visit_scheduled') AS site_visit_scheduled,
        COUNT(*) FILTER (WHERE status = 'site_visit_done')      AS site_visit_done,
        COUNT(*) FILTER (WHERE status = 'negotiation')          AS negotiation,
        COUNT(*) FILTER (WHERE status = 'booked')               AS booked,
        COUNT(*) FILTER (WHERE status = 'lost')                 AS lost
       FROM leads ${where}`,
      params
    );

    const d = result.rows[0];
    const total = parseInt(d.total);
    const booked = parseInt(d.booked);

    const data = {
      period: range,
      total,
      funnel: {
        new: parseInt(d.new), contacted: parseInt(d.contacted),
        interested: parseInt(d.interested), follow_up: parseInt(d.follow_up),
        site_visit_scheduled: parseInt(d.site_visit_scheduled),
        site_visit_done: parseInt(d.site_visit_done),
        negotiation: parseInt(d.negotiation), booked,
        lost: parseInt(d.lost),
      },
      conversion_rate: total > 0 ? parseFloat(((booked / total) * 100).toFixed(1)) : 0,
    };

    return sendSuccess(res, "Overview fetched", data);
  } catch (err) {
    console.error("[getOverview]", err);
    return sendError(res, "Failed to fetch overview", 500);
  }
};

/**
 * GET /api/v1/dashboard/team-performance
 */
const getTeamPerformance = async (req, res) => {
  try {
    const { role, id: callerId } = req.user;
    const { manager_id, from, to } = req.query;
    const range = { from: from || defaultRange().from, to: to || defaultRange().to };

    let managerFilter = "";
    const params = [range.from, range.to];
    let idx = 3;

    if (role === "sales_manager") {
      managerFilter = `AND u.manager_id = $${idx++}`;
      params.push(callerId);
    } else if (manager_id) {
      managerFilter = `AND u.manager_id = $${idx++}`;
      params.push(manager_id);
    }

    const result = await pool.query(
      `SELECT u.id AS user_id,
              CONCAT(u.first_name,' ',u.last_name) AS full_name,
              u.role,
              COUNT(l.id) AS total_leads,
              COUNT(l.id) FILTER (WHERE l.status = 'contacted')       AS contacted,
              COUNT(l.id) FILTER (WHERE l.status = 'site_visit_done') AS site_visits_done,
              COUNT(l.id) FILTER (WHERE l.status = 'booked')          AS booked,
              COUNT(l.id) FILTER (WHERE l.status = 'lost')            AS lost,
              (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = u.id AND t.is_completed = false) AS pending_tasks
       FROM users u
       LEFT JOIN leads l ON l.assigned_to = u.id
         AND l.is_archived = false
         AND l.created_at::date BETWEEN $1 AND $2
       WHERE u.is_active = true
         AND u.role IN ('sales_executive','external_caller')
         ${managerFilter}
       GROUP BY u.id
       ORDER BY booked DESC`,
      params
    );

    const data = result.rows.map(r => ({
      ...r,
      total_leads:  parseInt(r.total_leads),
      contacted:    parseInt(r.contacted),
      site_visits_done: parseInt(r.site_visits_done),
      booked:       parseInt(r.booked),
      lost:         parseInt(r.lost),
      pending_tasks: parseInt(r.pending_tasks),
      conversion_rate: parseInt(r.total_leads) > 0
        ? parseFloat(((parseInt(r.booked) / parseInt(r.total_leads)) * 100).toFixed(1))
        : 0,
    }));

    return sendSuccess(res, "Team performance fetched", data);
  } catch (err) {
    console.error("[getTeamPerformance]", err);
    return sendError(res, "Failed to fetch team performance", 500);
  }
};

/**
 * GET /api/v1/dashboard/site-visits
 */
const getSiteVisitAnalytics = async (req, res) => {
  try {
    const { role, id: callerId } = req.user;
    const { from, to } = req.query;
    const range = { from: from || defaultRange().from, to: to || defaultRange().to };

    let roleFilter = "";
    const params = [range.from, range.to];
    let idx = 3;

    if (role === "sales_executive") { roleFilter = `AND sv.assigned_to = $${idx++}`; params.push(callerId); }
    else if (role === "sales_manager") {
      roleFilter = `AND sv.assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx++})`;
      params.push(callerId);
    }

    const summary = await pool.query(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'scheduled')   AS scheduled,
        COUNT(*) FILTER (WHERE status = 'done')        AS done,
        COUNT(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
        COUNT(*) FILTER (WHERE status = 'rescheduled') AS rescheduled,
        COUNT(*) FILTER (WHERE status = 'no_show')     AS no_show
       FROM site_visits sv
       WHERE sv.visit_date BETWEEN $1 AND $2 ${roleFilter}`,
      params
    );

    const upcoming = await pool.query(
      `SELECT sv.id, sv.visit_date, sv.visit_time, sv.status,
              l.name AS lead_name, p.name AS project_name,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_to
       FROM site_visits sv
       LEFT JOIN leads l ON l.id = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       LEFT JOIN users u ON u.id = sv.assigned_to
       WHERE sv.visit_date >= CURRENT_DATE AND sv.status = 'scheduled'
       ORDER BY sv.visit_date ASC, sv.visit_time ASC
       LIMIT 10`
    );

    const s = summary.rows[0];
    const total = parseInt(s.total);
    const done  = parseInt(s.done);

    return sendSuccess(res, "Site visit analytics fetched", {
      summary: {
        scheduled: parseInt(s.scheduled), done, cancelled: parseInt(s.cancelled),
        rescheduled: parseInt(s.rescheduled), no_show: parseInt(s.no_show), total,
      },
      completion_rate: total > 0 ? parseFloat(((done / total) * 100).toFixed(1)) : 0,
      upcoming: upcoming.rows,
    });
  } catch (err) {
    console.error("[getSiteVisitAnalytics]", err);
    return sendError(res, "Failed to fetch analytics", 500);
  }
};

/**
 * GET /api/v1/dashboard/followup-tracker
 */
const getFollowupTracker = async (req, res) => {
  try {
    const { role, id: callerId } = req.user;

    let userFilter = "";
    const params = [];
    let idx = 1;

    if (role === "sales_executive") { userFilter = `WHERE t.assigned_to = $${idx++}`; params.push(callerId); }
    else if (role === "sales_manager") {
      userFilter = `WHERE t.assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx++})`;
      params.push(callerId);
    }

    const summary = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE is_completed = false)                         AS total_pending,
        COUNT(*) FILTER (WHERE is_completed = false AND due_date < NOW())    AS overdue,
        COUNT(*) FILTER (WHERE is_completed = false AND due_date::date = CURRENT_DATE) AS due_today,
        COUNT(*) FILTER (WHERE is_completed = false AND due_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS due_this_week
       FROM tasks t ${userFilter}`,
      params
    );

    const byUser = await pool.query(
      `SELECT u.id AS user_id,
              CONCAT(u.first_name,' ',u.last_name) AS full_name,
              COUNT(t.id) FILTER (WHERE t.is_completed = false)                     AS pending,
              COUNT(t.id) FILTER (WHERE t.is_completed = false AND t.due_date < NOW()) AS overdue
       FROM users u
       LEFT JOIN tasks t ON t.assigned_to = u.id
       WHERE u.is_active = true AND u.role IN ('sales_executive','external_caller')
       ${role === "sales_manager" ? `AND u.manager_id = '${callerId}'` : ""}
       GROUP BY u.id
       ORDER BY overdue DESC`
    );

    const s = summary.rows[0];
    return sendSuccess(res, "Follow-up tracker fetched", {
      total_pending: parseInt(s.total_pending),
      overdue:       parseInt(s.overdue),
      due_today:     parseInt(s.due_today),
      due_this_week: parseInt(s.due_this_week),
      by_user: byUser.rows.map(r => ({
        ...r, pending: parseInt(r.pending), overdue: parseInt(r.overdue),
      })),
    });
  } catch (err) {
    console.error("[getFollowupTracker]", err);
    return sendError(res, "Failed to fetch tracker", 500);
  }
};

/**
 * GET /api/v1/reports/leads
 */
const getLeadsReport = async (req, res) => {
  try {
    const { from, to, status, source, assigned_to, project_id } = req.query;
    if (!from || !to) return sendError(res, "from and to date are required", 400);

    const { role, id: callerId } = req.user;

    let conditions = ["l.is_archived = false", "l.created_at::date BETWEEN $1 AND $2"];
    const params = [from, to];
    let idx = 3;

    if (role === "sales_manager") { conditions.push(`u.manager_id = $${idx++}`); params.push(callerId); }
    if (status)      { conditions.push(`l.status = $${idx++}`);        params.push(status); }
    if (source)      { conditions.push(`l.source ILIKE $${idx++}`);    params.push(`%${source}%`); }
    if (assigned_to) { conditions.push(`l.assigned_to = $${idx++}`);   params.push(assigned_to); }
    if (project_id)  { conditions.push(`l.project_id = $${idx++}`);    params.push(project_id); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [totals, bySource, leads] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE l.status = 'booked') AS booked,
                COUNT(*) FILTER (WHERE l.status = 'lost')   AS lost
         FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ${where}`,
        params
      ),
      pool.query(
        `SELECT l.source, COUNT(*) AS count,
                COUNT(*) FILTER (WHERE l.status = 'booked') AS booked
         FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ${where}
         GROUP BY l.source ORDER BY count DESC`,
        params
      ),
      pool.query(
        `SELECT l.id, l.name, l.phone, l.status, l.source, l.budget, l.created_at,
                p.name AS project_name,
                CONCAT(u.first_name,' ',u.last_name) AS assigned_to
         FROM leads l
         LEFT JOIN projects p ON p.id = l.project_id
         LEFT JOIN users u ON u.id = l.assigned_to
         ${where} ORDER BY l.created_at DESC`,
        params
      ),
    ]);

    return sendSuccess(res, "Leads report fetched", {
      summary: {
        total:  parseInt(totals.rows[0].total),
        booked: parseInt(totals.rows[0].booked),
        lost:   parseInt(totals.rows[0].lost),
      },
      by_source: bySource.rows.map(r => ({ ...r, count: parseInt(r.count), booked: parseInt(r.booked) })),
      leads: leads.rows,
    });
  } catch (err) {
    console.error("[getLeadsReport]", err);
    return sendError(res, "Failed to generate report", 500);
  }
};

/**
 * GET /api/v1/reports/conversion
 */
const getConversionReport = async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return sendError(res, "from and to date are required", 400);

    const params = [from, to];
    const baseWhere = "WHERE l.is_archived = false AND l.created_at::date BETWEEN $1 AND $2";

    const [overall, bySource, byProject, byExec] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='booked') AS booked FROM leads l ${baseWhere}`, params),
      pool.query(
        `SELECT l.source, COUNT(*) AS total, COUNT(*) FILTER (WHERE l.status='booked') AS booked
         FROM leads l ${baseWhere} GROUP BY l.source ORDER BY total DESC`, params
      ),
      pool.query(
        `SELECT p.name AS project, COUNT(*) AS total, COUNT(*) FILTER (WHERE l.status='booked') AS booked
         FROM leads l LEFT JOIN projects p ON p.id = l.project_id ${baseWhere} GROUP BY p.name ORDER BY total DESC`, params
      ),
      pool.query(
        `SELECT CONCAT(u.first_name,' ',u.last_name) AS name,
                COUNT(*) AS total, COUNT(*) FILTER (WHERE l.status='booked') AS booked
         FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ${baseWhere}
         GROUP BY u.id ORDER BY booked DESC`, params
      ),
    ]);

    const calcRate = (booked, total) =>
      parseInt(total) > 0 ? parseFloat(((parseInt(booked) / parseInt(total)) * 100).toFixed(1)) : 0;

    return sendSuccess(res, "Conversion report fetched", {
      overall_conversion_rate: calcRate(overall.rows[0].booked, overall.rows[0].total),
      by_source:    bySource.rows.map(r => ({ ...r, total: parseInt(r.total), booked: parseInt(r.booked), rate: calcRate(r.booked, r.total) })),
      by_project:   byProject.rows.map(r => ({ ...r, total: parseInt(r.total), booked: parseInt(r.booked), rate: calcRate(r.booked, r.total) })),
      by_executive: byExec.rows.map(r => ({ ...r, total: parseInt(r.total), booked: parseInt(r.booked), rate: calcRate(r.booked, r.total) })),
    });
  } catch (err) {
    console.error("[getConversionReport]", err);
    return sendError(res, "Failed to generate report", 500);
  }
};

module.exports = { getOverview, getTeamPerformance, getSiteVisitAnalytics, getFollowupTracker, getLeadsReport, getConversionReport, broadcastDashboardUpdate };
