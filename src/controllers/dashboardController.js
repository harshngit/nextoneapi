const { pool } = require("../config/db");
const { sendSuccess, sendError } = require("../utils/response");
const { emitToRole, emitToUser } = require("../config/socket");
const AppError = require("../utils/AppError");

const defaultRange = () => {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0],
    to: now.toISOString().split("T")[0],
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
 * GET /api/v1/dashboard/stats
 * Returns the 4 top KPI cards:
 *   Total Leads, Total Site Visits, Total Follow Ups, Total Projects
 *   with % change vs previous period
 */
const getDashboardStats = async (req, res, next) => {
  try {
    const { role, id: callerId } = req.user;
    const { from, to, project_id } = req.query;
    const range = {
      from: from || defaultRange().from,
      to: to || defaultRange().to,
    };

    // Calculate previous period of same length for % change
    const fromDate = new Date(range.from);
    const toDate = new Date(range.to);
    const diffMs = toDate - fromDate;
    const prevTo = new Date(fromDate - 1);
    const prevFrom = new Date(prevTo - diffMs);
    const prevRange = {
      from: prevFrom.toISOString().split("T")[0],
      to: prevTo.toISOString().split("T")[0],
    };

    // Build role-based filter for leads
    let leadConditions = ["is_archived = false"];
    let leadPrevConditions = ["is_archived = false"];
    const leadParams = [range.from, range.to];
    const leadPrevParams = [prevRange.from, prevRange.to];
    let idx = 3;

    if (role === "sales_executive") {
      leadConditions.push(`assigned_to = $${idx}`);
      leadPrevConditions.push(`assigned_to = $${idx}`);
      leadParams.push(callerId);
      leadPrevParams.push(callerId);
      idx++;
    } else if (role === "sales_manager") {
      leadConditions.push(`assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx})`);
      leadPrevConditions.push(`assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx})`);
      leadParams.push(callerId);
      leadPrevParams.push(callerId);
      idx++;
    }
    if (project_id) {
      leadConditions.push(`project_id = $${idx}`);
      leadPrevConditions.push(`project_id = $${idx}`);
      leadParams.push(project_id);
      leadPrevParams.push(project_id);
      idx++;
    }

    // Build role-based filter for site visits
    let svConditions = [];
    let svPrevConditions = [];
    const svParams = [range.from, range.to];
    const svPrevParams = [prevRange.from, prevRange.to];
    let svIdx = 3;

    if (role === "sales_executive") {
      svConditions.push(`assigned_to = $${svIdx}`);
      svPrevConditions.push(`assigned_to = $${svIdx}`);
      svParams.push(callerId);
      svPrevParams.push(callerId);
      svIdx++;
    } else if (role === "sales_manager") {
      svConditions.push(`assigned_to IN (SELECT id FROM users WHERE manager_id = $${svIdx})`);
      svPrevConditions.push(`assigned_to IN (SELECT id FROM users WHERE manager_id = $${svIdx})`);
      svParams.push(callerId);
      svPrevParams.push(callerId);
      svIdx++;
    }

    const svWhere =
      svConditions.length > 0
        ? `WHERE visit_date BETWEEN $1 AND $2 AND ${svConditions.join(" AND ")}`
        : `WHERE visit_date BETWEEN $1 AND $2`;
    const svPrevWhere =
      svPrevConditions.length > 0
        ? `WHERE visit_date BETWEEN $1 AND $2 AND ${svPrevConditions.join(" AND ")}`
        : `WHERE visit_date BETWEEN $1 AND $2`;

    const leadWhere = `WHERE ${[...leadConditions, "created_at::date BETWEEN $1 AND $2"].join(" AND ")}`;
    const leadPrevWhere = `WHERE ${[...leadPrevConditions, "created_at::date BETWEEN $1 AND $2"].join(" AND ")}`;

    // Follow-ups: tasks with type follow_up or notes containing follow_up (use tasks table)
    let taskConditions = ["t.is_completed = false"];
    let taskPrevConditions = ["t.is_completed = false"];
    const taskParams = [range.from, range.to];
    const taskPrevParams = [prevRange.from, prevRange.to];
    let tIdx = 3;

    if (role === "sales_executive") {
      taskConditions.push(`t.assigned_to = $${tIdx}`);
      taskPrevConditions.push(`t.assigned_to = $${tIdx}`);
      taskParams.push(callerId);
      taskPrevParams.push(callerId);
      tIdx++;
    } else if (role === "sales_manager") {
      taskConditions.push(`t.assigned_to IN (SELECT id FROM users WHERE manager_id = $${tIdx})`);
      taskPrevConditions.push(`t.assigned_to IN (SELECT id FROM users WHERE manager_id = $${tIdx})`);
      taskParams.push(callerId);
      taskPrevParams.push(callerId);
      tIdx++;
    }

    const taskWhere = `WHERE ${[...taskConditions, "t.due_date::date BETWEEN $1 AND $2"].join(" AND ")}`;
    const taskPrevWhere = `WHERE ${[...taskPrevConditions, "t.due_date::date BETWEEN $1 AND $2"].join(" AND ")}`;

    const [
      leadsResult,
      leadsPrevResult,
      svResult,
      svPrevResult,
      followupsResult,
      followupsPrevResult,
      projectsResult,
      projectsPrevResult,
    ] = await Promise.all([
      // Current period leads
      pool.query(`SELECT COUNT(*) AS total FROM leads ${leadWhere}`, leadParams),
      // Previous period leads
      pool.query(`SELECT COUNT(*) AS total FROM leads ${leadPrevWhere}`, leadPrevParams),
      // Current period site visits
      pool.query(`SELECT COUNT(*) AS total FROM site_visits ${svWhere}`, svParams),
      // Previous period site visits
      pool.query(`SELECT COUNT(*) AS total FROM site_visits ${svPrevWhere}`, svPrevParams),
      // Current period follow-ups (pending tasks in range)
      pool.query(`SELECT COUNT(*) AS total FROM tasks t ${taskWhere}`, taskParams),
      // Previous period follow-ups
      pool.query(`SELECT COUNT(*) AS total FROM tasks t ${taskPrevWhere}`, taskPrevParams),
      // Current active projects
      pool.query(
        `SELECT COUNT(*) AS total FROM projects WHERE status IN ('active','upcoming') AND created_at::date <= $1`,
        [range.to]
      ),
      // Previous active projects
      pool.query(
        `SELECT COUNT(*) AS total FROM projects WHERE status IN ('active','upcoming') AND created_at::date <= $1`,
        [prevRange.to]
      ),
    ]);

    const calcChange = (current, previous) => {
      const curr = parseInt(current);
      const prev = parseInt(previous);
      if (prev === 0) return curr > 0 ? 100 : 0;
      return parseFloat((((curr - prev) / prev) * 100).toFixed(1));
    };

    const totalLeads = parseInt(leadsResult.rows[0].total);
    const prevLeads = parseInt(leadsPrevResult.rows[0].total);
    const totalSiteVisits = parseInt(svResult.rows[0].total);
    const prevSiteVisits = parseInt(svPrevResult.rows[0].total);
    const totalFollowUps = parseInt(followupsResult.rows[0].total);
    const prevFollowUps = parseInt(followupsPrevResult.rows[0].total);
    const totalProjects = parseInt(projectsResult.rows[0].total);
    const prevProjects = parseInt(projectsPrevResult.rows[0].total);

    return sendSuccess(res, "Dashboard stats fetched", {
      period: range,
      stats: {
        total_leads: {
          value: totalLeads,
          change: calcChange(totalLeads, prevLeads),
          prev_value: prevLeads,
        },
        total_site_visits: {
          value: totalSiteVisits,
          change: calcChange(totalSiteVisits, prevSiteVisits),
          prev_value: prevSiteVisits,
        },
        total_follow_ups: {
          value: totalFollowUps,
          change: calcChange(totalFollowUps, prevFollowUps),
          prev_value: prevFollowUps,
        },
        total_projects: {
          value: totalProjects,
          change: calcChange(totalProjects, prevProjects),
          prev_value: prevProjects,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/dashboard/revenue
 * Returns monthly/weekly/yearly revenue trend (booked lead count as revenue proxy)
 * Query param: range = week | month | year (default: month)
 */
const getRevenueTrend = async (req, res, next) => {
  try {
    const { role, id: callerId } = req.user;
    const { range: rangeType = "month", project_id } = req.query;

    let dateFormat, periodLabel, fromDate;
    const now = new Date();

    if (rangeType === "week") {
      dateFormat = "YYYY-MM-DD";
      periodLabel = "day";
      fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 6);
    } else if (rangeType === "year") {
      dateFormat = "YYYY";
      periodLabel = "year";
      fromDate = new Date(now);
      fromDate.setFullYear(now.getFullYear() - 4);
    } else {
      // month (default) — show last 6 months
      dateFormat = "Mon YYYY";
      periodLabel = "month";
      fromDate = new Date(now);
      fromDate.setMonth(now.getMonth() - 5);
      fromDate.setDate(1);
    }

    const fromStr = fromDate.toISOString().split("T")[0];
    const toStr = now.toISOString().split("T")[0];

    let roleFilter = "";
    const params = [fromStr, toStr];
    let idx = 3;

    if (role === "sales_executive") {
      roleFilter = `AND l.assigned_to = $${idx++}`;
      params.push(callerId);
    } else if (role === "sales_manager") {
      roleFilter = `AND l.assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx++})`;
      params.push(callerId);
    }
    if (project_id) {
      roleFilter += ` AND l.project_id = $${idx++}`;
      params.push(project_id);
    }

    let groupExpr, labelExpr;
    if (rangeType === "week") {
      groupExpr = "l.created_at::date";
      labelExpr = "TO_CHAR(l.created_at::date, 'DD Mon')";
    } else if (rangeType === "year") {
      groupExpr = "DATE_TRUNC('year', l.created_at)";
      labelExpr = "TO_CHAR(DATE_TRUNC('year', l.created_at), 'YYYY')";
    } else {
      groupExpr = "DATE_TRUNC('month', l.created_at)";
      labelExpr = "TO_CHAR(DATE_TRUNC('month', l.created_at), 'Mon YYYY')";
    }

    const result = await pool.query(
      `SELECT
         ${labelExpr} AS label,
         ${groupExpr} AS period,
         COUNT(*) AS total_leads,
         COUNT(*) FILTER (WHERE l.status = 'booked') AS booked,
         COUNT(*) FILTER (WHERE l.status = 'site_visit_done' OR l.status = 'site_visit_scheduled') AS site_visits
       FROM leads l
       WHERE l.is_archived = false
         AND l.created_at::date BETWEEN $1 AND $2
         ${roleFilter}
       GROUP BY ${groupExpr}, label
       ORDER BY ${groupExpr} ASC`,
      params
    );

    return sendSuccess(res, "Revenue trend fetched", {
      range_type: rangeType,
      data: result.rows.map((r) => ({
        label: r.label,
        total_leads: parseInt(r.total_leads),
        booked: parseInt(r.booked),
        site_visits: parseInt(r.site_visits),
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/dashboard/lead-sources
 * Returns lead count grouped by source for the donut chart
 */
// Fixed source list — names must match frontend defaultSources exactly
const LEAD_SOURCE_CONFIG = [
  { source: "Facebook",      color: "#3B82F6" }, // blue
  { source: "Instagram",     color: "#EC4899" }, // pink
  { source: "Google Ads",    color: "#F97316" }, // orange
  { source: "YouTube",       color: "#EF4444" }, // red
  { source: "LinkedIn",      color: "#0EA5E9" }, // sky blue
  { source: "WhatsApp",      color: "#22C55E" }, // green
  { source: "Twitter / X",   color: "#64748B" }, // slate
  { source: "Website",       color: "#8B5CF6" }, // violet
  { source: "IVR",           color: "#14B8A6" }, // teal
  { source: "Walk-in",       color: "#EAB308" }, // yellow
  { source: "Referral",      color: "#F43F5E" }, // rose
  { source: "99acres",       color: "#A855F7" }, // purple
  { source: "Housing.com",   color: "#06B6D4" }, // cyan
  { source: "MagicBricks",   color: "#F59E0B" }, // amber
  { source: "NoBroker",      color: "#10B981" }, // emerald
];

const getLeadSources = async (req, res, next) => {
  try {
    const { role, id: callerId } = req.user;
    const { from, to, project_id } = req.query;
    const range = {
      from: from || defaultRange().from,
      to: to || defaultRange().to,
    };

    let conditions = ["l.is_archived = false", "l.created_at::date BETWEEN $1 AND $2"];
    const params = [range.from, range.to];
    let idx = 3;

    if (role === "sales_executive") {
      conditions.push(`l.assigned_to = $${idx++}`);
      params.push(callerId);
    } else if (role === "sales_manager") {
      conditions.push(`l.assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx++})`);
      params.push(callerId);
    }
    if (project_id) {
      conditions.push(`l.project_id = $${idx++}`);
      params.push(project_id);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    // Map any source not in our known list → NULL (ignored) so counts stay clean
    const knownSources = LEAD_SOURCE_CONFIG.map((s) => s.source);
    const knownList = knownSources.map((s) => `'${s.replace("'", "''")}'`).join(", ");

    const result = await pool.query(
      `SELECT
         l.source,
         COUNT(*) AS count,
         COUNT(*) FILTER (WHERE l.status = 'booked') AS booked
       FROM leads l
       ${where}
         AND l.source IN (${knownList})
       GROUP BY l.source`,
      params
    );

    // Build a lookup map from DB results
    const dbMap = {};
    for (const row of result.rows) {
      dbMap[row.source] = {
        count:  parseInt(row.count),
        booked: parseInt(row.booked),
      };
    }

    // Always return all 15 sources in fixed order, with 0s for missing ones
    const total = Object.values(dbMap).reduce((sum, r) => sum + r.count, 0);

    const sources = LEAD_SOURCE_CONFIG.map(({ source, color }) => {
      const data   = dbMap[source] || { count: 0, booked: 0 };
      return {
        source,
        color,
        count:      data.count,
        booked:     data.booked,
        percentage: total > 0 ? parseFloat(((data.count / total) * 100).toFixed(1)) : 0,
      };
    });

    return sendSuccess(res, "Lead sources fetched", {
      period: range,
      total,
      sources,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/dashboard/lead-pipeline
 * Returns current lead distribution across all pipeline stages
 */
const getLeadPipeline = async (req, res, next) => {
  try {
    const { role, id: callerId } = req.user;
    const { project_id } = req.query;

    let conditions = ["is_archived = false"];
    const params = [];
    let idx = 1;

    if (role === "sales_executive") {
      conditions.push(`assigned_to = $${idx++}`);
      params.push(callerId);
    } else if (role === "sales_manager") {
      conditions.push(`assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx++})`);
      params.push(callerId);
    }
    if (project_id) {
      conditions.push(`project_id = $${idx++}`);
      params.push(project_id);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'new')                  AS new,
         COUNT(*) FILTER (WHERE status = 'contacted')            AS contacted,
         COUNT(*) FILTER (WHERE status = 'interested')           AS interested,
         COUNT(*) FILTER (WHERE status = 'follow_up')            AS follow_up,
         COUNT(*) FILTER (WHERE status = 'site_visit_scheduled') AS site_visit_scheduled,
         COUNT(*) FILTER (WHERE status = 'site_visit_done')      AS site_visit_done,
         COUNT(*) FILTER (WHERE status = 'negotiation')          AS negotiation,
         COUNT(*) FILTER (WHERE status = 'booked')               AS booked,
         COUNT(*) FILTER (WHERE status = 'lost')                 AS closed_lost,
         COUNT(*) AS total
       FROM leads ${where}`,
      params
    );

    const d = result.rows[0];
    const total = parseInt(d.total);

    // Stages matching the Lead Pipeline UI card
    const stages = [
      { label: "Qualified", key: "new", value: parseInt(d.new) + parseInt(d.contacted) + parseInt(d.interested) },
      { label: "Site Visit", key: "site_visit", value: parseInt(d.site_visit_scheduled) + parseInt(d.site_visit_done) },
      { label: "Negotiation", key: "negotiation", value: parseInt(d.negotiation) },
      { label: "Booking", key: "booking", value: parseInt(d.booked) },
      { label: "Closed Won", key: "closed_won", value: parseInt(d.booked) },
      { label: "Closed Lost", key: "closed_lost", value: parseInt(d.closed_lost) },
    ];

    // Recalculate qualified to not double-count
    stages[0].value = parseInt(d.new) + parseInt(d.contacted) + parseInt(d.interested) + parseInt(d.follow_up);

    return sendSuccess(res, "Lead pipeline fetched", {
      total,
      stages,
      detailed: {
        new: parseInt(d.new),
        contacted: parseInt(d.contacted),
        interested: parseInt(d.interested),
        follow_up: parseInt(d.follow_up),
        site_visit_scheduled: parseInt(d.site_visit_scheduled),
        site_visit_done: parseInt(d.site_visit_done),
        negotiation: parseInt(d.negotiation),
        booked: parseInt(d.booked),
        closed_lost: parseInt(d.closed_lost),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/dashboard/recent-activity
 * Returns recent activity feed: bookings, payments, commission, etc.
 * Query param: limit (default 10)
 */
const getRecentActivity = async (req, res, next) => {
  try {
    const { role, id: callerId } = req.user;
    const { limit = 10, project_id } = req.query;

    let roleFilter = "";
    const params = [];
    let idx = 1;

    if (role === "sales_executive") {
      roleFilter = `AND l.assigned_to = $${idx++}`;
      params.push(callerId);
    } else if (role === "sales_manager") {
      roleFilter = `AND l.assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx++})`;
      params.push(callerId);
    }
    if (project_id) {
      roleFilter += ` AND l.project_id = $${idx++}`;
      params.push(project_id);
    }

    params.push(parseInt(limit));
    const limitParam = `$${idx++}`;

    // Combine recent lead activities + recent site visits into a unified feed
    const result = await pool.query(
      `(
        SELECT
          la.id,
          'lead_activity'                        AS activity_type,
          la.type                                AS sub_type,
          la.note                                AS message,
          l.name                                 AS lead_name,
          p.name                                 AS project_name,
          CONCAT(u.first_name,' ',u.last_name)   AS performed_by,
          NULL::text                             AS unit_info,
          la.created_at
        FROM lead_activities la
        JOIN leads l ON l.id = la.lead_id
        LEFT JOIN projects p ON p.id = l.project_id
        LEFT JOIN users u ON u.id = la.performed_by
        WHERE l.is_archived = false ${roleFilter}
        ORDER BY la.created_at DESC
        LIMIT ${limitParam}
      )
      UNION ALL
      (
        SELECT
          sv.id,
          'site_visit'                           AS activity_type,
          sv.status                              AS sub_type,
          CONCAT('Site visit ', sv.status, ' for ', l.name) AS message,
          l.name                                 AS lead_name,
          p.name                                 AS project_name,
          CONCAT(u.first_name,' ',u.last_name)   AS performed_by,
          NULL::text                             AS unit_info,
          sv.updated_at                          AS created_at
        FROM site_visits sv
        JOIN leads l ON l.id = sv.lead_id
        LEFT JOIN projects p ON p.id = sv.project_id
        LEFT JOIN users u ON u.id = sv.assigned_to
        WHERE l.is_archived = false ${roleFilter}
        ORDER BY sv.updated_at DESC
        LIMIT ${limitParam}
      )
      ORDER BY created_at DESC
      LIMIT ${limitParam}`,
      params
    );

    return sendSuccess(res, "Recent activity fetched", result.rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/dashboard/upcoming-site-visits
 * Returns upcoming confirmed/scheduled site visits
 */
const getUpcomingSiteVisits = async (req, res, next) => {
  try {
    const { role, id: callerId } = req.user;
    const { limit = 10 } = req.query;

    let roleFilter = "";
    const params = [];
    let idx = 1;

    if (role === "sales_executive") {
      roleFilter = `AND sv.assigned_to = $${idx++}`;
      params.push(callerId);
    } else if (role === "sales_manager") {
      roleFilter = `AND sv.assigned_to IN (SELECT id FROM users WHERE manager_id = $${idx++})`;
      params.push(callerId);
    }

    params.push(parseInt(limit));

    const result = await pool.query(
      `SELECT
         sv.id,
         sv.visit_date,
         sv.visit_time,
         sv.status,
         sv.transport_arranged,
         sv.notes,
         l.name   AS lead_name,
         l.phone  AS lead_phone,
         p.name   AS project_name,
         p.locality AS project_locality,
         CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name
       FROM site_visits sv
       JOIN leads l ON l.id = sv.lead_id
       LEFT JOIN projects p ON p.id = sv.project_id
       LEFT JOIN users u ON u.id = sv.assigned_to
       WHERE sv.visit_date >= CURRENT_DATE
         AND sv.status IN ('scheduled','rescheduled')
         ${roleFilter}
       ORDER BY sv.visit_date ASC, sv.visit_time ASC
       LIMIT $${idx}`,
      params
    );

    return sendSuccess(res, "Upcoming site visits fetched", result.rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/dashboard/commission-overview
 * Placeholder — real commission tracking coming soon
 */
const getCommissionOverview = async (req, res, next) => {
  try {
    return sendSuccess(res, "Commission overview fetched", {
      status: "coming_soon",
      message: "Real-time commission tracking",
      data: null,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Legacy endpoints kept for backward compatibility ─────────────────────────

/**
 * GET /api/v1/dashboard/overview  (legacy — lead funnel)
 */
const getOverview = async (req, res, next) => {
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

    return sendSuccess(res, "Overview fetched", {
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
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/dashboard/team-performance
 */
const getTeamPerformance = async (req, res, next) => {
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

    const data = result.rows.map((r) => ({
      ...r,
      total_leads: parseInt(r.total_leads),
      contacted: parseInt(r.contacted),
      site_visits_done: parseInt(r.site_visits_done),
      booked: parseInt(r.booked),
      lost: parseInt(r.lost),
      pending_tasks: parseInt(r.pending_tasks),
      conversion_rate:
        parseInt(r.total_leads) > 0
          ? parseFloat(((parseInt(r.booked) / parseInt(r.total_leads)) * 100).toFixed(1))
          : 0,
    }));

    return sendSuccess(res, "Team performance fetched", data);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/dashboard/site-visits
 */
const getSiteVisitAnalytics = async (req, res, next) => {
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
    const done = parseInt(s.done);

    return sendSuccess(res, "Site visit analytics fetched", {
      summary: {
        scheduled: parseInt(s.scheduled), done, cancelled: parseInt(s.cancelled),
        rescheduled: parseInt(s.rescheduled), no_show: parseInt(s.no_show), total,
      },
      completion_rate: total > 0 ? parseFloat(((done / total) * 100).toFixed(1)) : 0,
      upcoming: upcoming.rows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/dashboard/followup-tracker
 */
const getFollowupTracker = async (req, res, next) => {
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
      overdue: parseInt(s.overdue),
      due_today: parseInt(s.due_today),
      due_this_week: parseInt(s.due_this_week),
      by_user: byUser.rows.map((r) => ({
        ...r, pending: parseInt(r.pending), overdue: parseInt(r.overdue),
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/reports/leads
 */
const getLeadsReport = async (req, res, next) => {
  try {
    const { from, to, status, source, assigned_to, project_id } = req.query;
    if (!from || !to) return next(new AppError("from and to date are required", 400));

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
        total: parseInt(totals.rows[0].total),
        booked: parseInt(totals.rows[0].booked),
        lost: parseInt(totals.rows[0].lost),
      },
      by_source: bySource.rows.map((r) => ({ ...r, count: parseInt(r.count), booked: parseInt(r.booked) })),
      leads: leads.rows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/reports/conversion
 */
const getConversionReport = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return next(new AppError("from and to date are required", 400));

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
      by_source: bySource.rows.map((r) => ({ ...r, total: parseInt(r.total), booked: parseInt(r.booked), rate: calcRate(r.booked, r.total) })),
      by_project: byProject.rows.map((r) => ({ ...r, total: parseInt(r.total), booked: parseInt(r.booked), rate: calcRate(r.booked, r.total) })),
      by_executive: byExec.rows.map((r) => ({ ...r, total: parseInt(r.total), booked: parseInt(r.booked), rate: calcRate(r.booked, r.total) })),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  // New dashboard endpoints
  getDashboardStats,
  getRevenueTrend,
  getLeadSources,
  getLeadPipeline,
  getRecentActivity,
  getUpcomingSiteVisits,
  getCommissionOverview,
  // Legacy endpoints
  getOverview,
  getTeamPerformance,
  getSiteVisitAnalytics,
  getFollowupTracker,
  getLeadsReport,
  getConversionReport,
  broadcastDashboardUpdate,
};