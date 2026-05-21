const { pool } = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");
const fs       = require("fs");
const path     = require("path");

const VALID_STATUSES = ["active", "inactive", "upcoming", "completed"];

/**
 * GET /api/v1/projects
 */
const getAllProjects = async (req, res, next) => {
  try {
    const { status, city, search, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params = [];
    let idx = 1;

    if (status) { conditions.push(`p.status = $${idx++}`);          params.push(status); }
    else { conditions.push(`p.status != 'inactive'`); }
    if (city)   { conditions.push(`p.city ILIKE $${idx++}`);        params.push(`%${city}%`); }
    if (search) { conditions.push(`(p.name ILIKE $${idx} OR p.developer ILIKE $${idx})`); params.push(`%${search}%`); idx++; }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(`SELECT COUNT(*) FROM projects p ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM leads WHERE project_id = p.id AND is_archived = false) AS total_leads,
              (SELECT json_agg(d.*) FROM (
                 SELECT id, document_type, file_name, file_size, mime_type, uploaded_at 
                 FROM project_documents 
                 WHERE project_id = p.id
              ) d) AS documents
       FROM projects p ${where}
       ORDER BY p.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    const rows = dataResult.rows.map(row => {
      if (row.documents) {
        row.unit_plans = row.documents.filter(d => d.document_type === 'unit_plan').map(d => ({
          ...d,
          url: `/api/v1/projects/${row.id}/documents/${d.id}/download`
        }));
        row.creatives = row.documents.filter(d => d.document_type === 'creative').map(d => ({
          ...d,
          url: `/api/v1/projects/${row.id}/documents/${d.id}/download`
        }));
        delete row.documents;
      } else {
        row.unit_plans = [];
        row.creatives = [];
      }
      return row;
    });

    return res.json(paginate(rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/projects
 */
const createProject = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      name, developer, city, locality, address, configurations,
      price_range, total_units, possession_date, rera_number,
      amenities, status = "active", brochure_url, description,
      unit_plans, creatives, // Arrays of document objects from JSON body
    } = req.body;

    if (!name || !city) return next(new AppError("name and city are required", 400));

    await client.query("BEGIN");

    // ── 1. Insert project ─────────────────────────────────────────────────────
    const result = await client.query(
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

    const project = result.rows[0];

    // ── 2. Insert documents from JSON body ────────────────────
    const savedDocs = [];

    const processDocuments = async (docs, docType) => {
      for (const doc of (docs || [])) {
        const docResult = await client.query(
          `INSERT INTO project_documents
             (project_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            project.id, 
            docType, 
            doc.file_name, 
            doc.file_path, 
            doc.file_size || 0, 
            doc.mime_type || 'application/octet-stream', 
            req.user.id
          ]
        );
        savedDocs.push({
          ...docResult.rows[0],
          url: `/api/v1/projects/${project.id}/documents/${docResult.rows[0].id}/download`,
        });
      }
    };

    if (unit_plans && Array.isArray(unit_plans)) {
      await processDocuments(unit_plans, "unit_plan");
    }
    if (creatives && Array.isArray(creatives)) {
      await processDocuments(creatives, "creative");
    }

    await client.query("COMMIT");

    return sendSuccess(res, "Project created successfully", {
      ...project,
      documents: savedDocs.length > 0 ? {
        count:     savedDocs.length,
        unit_plans: savedDocs.filter(d => d.document_type === "unit_plan"),
        creatives:  savedDocs.filter(d => d.document_type === "creative"),
      } : null,
    }, 201);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/projects/:id
 */
const getProjectById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM leads WHERE project_id = p.id AND is_archived = false) AS total_leads,
              (SELECT json_agg(d.*) FROM (
                 SELECT id, document_type, file_name, file_size, mime_type, uploaded_at 
                 FROM project_documents 
                 WHERE project_id = p.id
              ) d) AS documents
       FROM projects p WHERE p.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return next(new AppError("Project not found", 404));
    
    const project = result.rows[0];
    if (project.documents) {
      project.unit_plans = project.documents.filter(d => d.document_type === 'unit_plan').map(d => ({
        ...d,
        url: `/api/v1/projects/${project.id}/documents/${d.id}/download`
      }));
      project.creatives = project.documents.filter(d => d.document_type === 'creative').map(d => ({
        ...d,
        url: `/api/v1/projects/${project.id}/documents/${d.id}/download`
      }));
      delete project.documents;
    } else {
      project.unit_plans = [];
      project.creatives = [];
    }

    return sendSuccess(res, "Project fetched successfully", project);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/projects/:id
 */
const updateProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT id FROM projects WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Project not found", 404));

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

    if (updates.length === 0) return next(new AppError("No fields to update", 400));
    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE projects SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );
    return sendSuccess(res, "Project updated successfully", result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/projects/:id
 */
const deleteProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query("SELECT id FROM projects WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Project not found", 404));
    await pool.query("UPDATE projects SET status = 'inactive', updated_at = NOW() WHERE id = $1", [id]);
    return sendSuccess(res, "Project deactivated successfully");
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/projects/:id/status
 */
const updateProjectStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return next(new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400));
    }

    const existing = await pool.query("SELECT id FROM projects WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Project not found", 404));

    const result = await pool.query(
      "UPDATE projects SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status",
      [status, id]
    );
    return sendSuccess(res, `Project status updated to ${status}`, result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/projects/:id/leads
 */
const getProjectLeads = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const project = await pool.query("SELECT id, name FROM projects WHERE id = $1", [id]);
    if (project.rows.length === 0) return next(new AppError("Project not found", 404));

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

    return sendSuccess(res, "Project leads fetched", {
      project: project.rows[0],
      leads: dataResult.rows,
      pagination: {
        total,
        page: parseInt(page),
        per_page: parseInt(per_page),
        total_pages: Math.ceil(total / parseInt(per_page))
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllProjects, createProject, getProjectById, updateProject, deleteProject, updateProjectStatus, getProjectLeads };