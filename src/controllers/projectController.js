const { pool } = require("../config/db");
const { sendSuccess, sendError, paginate } = require("../utils/response");

const VALID_STATUSES = ["active", "inactive", "upcoming", "completed"];

/**
 * GET /api/v1/projects
 */
const getAllProjects = async (req, res) => {
  try {
    const { status, city, search, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params = [];
    let idx = 1;

    if (status) { conditions.push(`p.status = $${idx++}`);          params.push(status); }
    if (city)   { conditions.push(`p.city ILIKE $${idx++}`);        params.push(`%${city}%`); }
    if (search) { conditions.push(`(p.name ILIKE $${idx} OR p.developer ILIKE $${idx})`); params.push(`%${search}%`); idx++; }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(`SELECT COUNT(*) FROM projects p ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT p.id, p.name, p.developer, p.city, p.locality, p.status,
              p.configurations, p.price_range, p.total_units, p.possession_date,
              p.rera_number, p.created_at,
              (SELECT COUNT(*) FROM leads WHERE project_id = p.id AND is_archived = false) AS total_leads
       FROM projects p ${where}
       ORDER BY p.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    console.error("[getAllProjects]", err);
    return sendError(res, "Failed to fetch projects", 500);
  }
};

/**
 * POST /api/v1/projects
 */
const createProject = async (req, res) => {
  try {
    const {
      name, developer, city, locality, address, configurations,
      price_range, total_units, possession_date, rera_number,
      amenities, status = "active", brochure_url, description,
    } = req.body;

    if (!name || !city) return sendError(res, "name and city are required", 400);

    const result = await pool.query(
      `INSERT INTO projects
        (name, developer, city, locality, address, configurations, price_range,
         total_units, possession_date, rera_number, amenities, status, brochure_url, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        name.trim(), developer || null, city.trim(), locality || null, address || null,
        JSON.stringify(configurations || []), price_range || null, total_units || null,
        possession_date || null, rera_number || null, JSON.stringify(amenities || []),
        status, brochure_url || null, description || null, req.user.id,
      ]
    );
    return sendSuccess(res, "Project created successfully", result.rows[0], 201);
  } catch (err) {
    console.error("[createProject]", err);
    return sendError(res, "Failed to create project", 500);
  }
};

/**
 * GET /api/v1/projects/:id
 */
const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM leads WHERE project_id = p.id AND is_archived = false) AS total_leads
       FROM projects p WHERE p.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return sendError(res, "Project not found", 404);
    return sendSuccess(res, "Project fetched successfully", result.rows[0]);
  } catch (err) {
    console.error("[getProjectById]", err);
    return sendError(res, "Failed to fetch project", 500);
  }
};

/**
 * PUT /api/v1/projects/:id
 */
const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT id FROM projects WHERE id = $1", [id]);
    if (existing.rows.length === 0) return sendError(res, "Project not found", 404);

    const fields = ["name", "developer", "city", "locality", "address", "price_range",
                    "total_units", "possession_date", "rera_number", "brochure_url", "description"];
    const jsonFields = ["configurations", "amenities"];

    const updates = []; const params = []; let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(req.body[field]);
      }
    }
    for (const field of jsonFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(JSON.stringify(req.body[field]));
      }
    }

    if (updates.length === 0) return sendError(res, "No fields to update", 400);
    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE projects SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );
    return sendSuccess(res, "Project updated successfully", result.rows[0]);
  } catch (err) {
    console.error("[updateProject]", err);
    return sendError(res, "Failed to update project", 500);
  }
};

/**
 * DELETE /api/v1/projects/:id
 */
const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT id FROM projects WHERE id = $1", [id]);
    if (existing.rows.length === 0) return sendError(res, "Project not found", 404);
    await pool.query("UPDATE projects SET status = 'inactive', updated_at = NOW() WHERE id = $1", [id]);
    return sendSuccess(res, "Project deactivated successfully");
  } catch (err) {
    console.error("[deleteProject]", err);
    return sendError(res, "Failed to deactivate project", 500);
  }
};

/**
 * PATCH /api/v1/projects/:id/status
 */
const updateProjectStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return sendError(res, `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400);
    }

    const existing = await pool.query("SELECT id FROM projects WHERE id = $1", [id]);
    if (existing.rows.length === 0) return sendError(res, "Project not found", 404);

    const result = await pool.query(
      "UPDATE projects SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status",
      [status, id]
    );
    return sendSuccess(res, `Project status updated to ${status}`, result.rows[0]);
  } catch (err) {
    console.error("[updateProjectStatus]", err);
    return sendError(res, "Failed to update project status", 500);
  }
};

/**
 * GET /api/v1/projects/:id/leads
 */
const getProjectLeads = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const project = await pool.query("SELECT id, name FROM projects WHERE id = $1", [id]);
    if (project.rows.length === 0) return sendError(res, "Project not found", 404);

    let conditions = ["l.project_id = $1", "l.is_archived = false"];
    const params = [id];
    let idx = 2;

    if (status) { conditions.push(`l.status = $${idx++}`); params.push(status); }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const countResult = await pool.query(`SELECT COUNT(*) FROM leads l ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT l.id, l.name, l.phone, l.status, l.source, l.budget, l.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json({
      success: true,
      data: { project: project.rows[0], leads: dataResult.rows },
      pagination: { total, page: parseInt(page), per_page: parseInt(per_page), total_pages: Math.ceil(total / parseInt(per_page)) }
    });
  } catch (err) {
    console.error("[getProjectLeads]", err);
    return sendError(res, "Failed to fetch project leads", 500);
  }
};

module.exports = { getAllProjects, createProject, getProjectById, updateProject, deleteProject, updateProjectStatus, getProjectLeads };
