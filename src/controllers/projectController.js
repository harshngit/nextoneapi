const { pool } = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");
const fs       = require("fs");
const path     = require("path");

const VALID_STATUSES = [
  "active", "inactive", "upcoming", "completed",
  "under_construction", "pre_launch", "nearby_possession", "ready_to_move",
];

const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/+$/, "");
const toFullUrl = (relativePath) => {
  if (!relativePath) return relativePath;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  return `${BACKEND_URL}${relativePath.startsWith("/") ? "" : "/"}${relativePath}`;
};

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
          url: toFullUrl(`/api/v1/projects/${row.id}/documents/${d.id}/download`)
        }));
        row.creatives = row.documents.filter(d => d.document_type === 'creative').map(d => ({
          ...d,
          url: toFullUrl(`/api/v1/projects/${row.id}/documents/${d.id}/download`),
          public_url: toFullUrl(`/api/v1/projects/${row.id}/documents/${d.id}/public`)
        }));
        row.payment_plans = row.documents.filter(d => d.document_type === 'payment_plan').map(d => ({
          ...d,
          url: toFullUrl(`/api/v1/projects/${row.id}/documents/${d.id}/download`)
        }));
        row.videos = row.documents.filter(d => d.document_type === 'video').map(d => ({
          ...d,
          url: toFullUrl(`/api/v1/projects/${row.id}/documents/${d.id}/download`)
        }));
        row.photos = row.documents.filter(d => d.document_type === 'photo').map(d => ({
          ...d,
          url: toFullUrl(`/api/v1/projects/${row.id}/documents/${d.id}/download`),
          public_url: toFullUrl(`/api/v1/projects/${row.id}/documents/${d.id}/public`)
        }));
        row.developer_logo = row.documents.filter(d => d.document_type === 'developer_logo').map(d => ({
          ...d,
          url: toFullUrl(`/api/v1/projects/${row.id}/documents/${d.id}/download`),
          public_url: toFullUrl(`/api/v1/projects/${row.id}/documents/${d.id}/public`)
        }))[0] || null;
        delete row.documents;
      } else {
        row.unit_plans = [];
        row.creatives = [];
        row.payment_plans = [];
        row.videos = [];
        row.photos = [];
        row.developer_logo = null;
      }
      row.brochure_url = toFullUrl(row.brochure_url);
      row.video_url = toFullUrl(row.video_url);
      row.payment_plan = toFullUrl(row.payment_plan);
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
        video_url, payment_plan, payment_plan_url, home_loan_info,
        unit_plans, creatives, payment_plans, videos, photos, developer_logo, // Arrays of document objects from JSON body
    } = req.body;

    const resolvedPaymentPlan = payment_plan !== undefined ? payment_plan : payment_plan_url;

    if (!name || !city) return next(new AppError("name and city are required", 400));

    await client.query("BEGIN");

    // ── 1. Insert project ─────────────────────────────────────────────────────
    const result = await client.query(
      `INSERT INTO projects
        (name, developer, city, locality, address, configurations, price_range,
         total_units, possession_date, rera_number, amenities, status, brochure_url, description,
         video_url, payment_plan, home_loan_info, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        name.trim(), developer || null, city.trim(), locality || null, address || null,
        JSON.stringify(configurations || []), price_range || null, total_units || null,
        possession_date || null, rera_number || null, JSON.stringify(amenities || []),
        status, brochure_url || null, description || null,
        video_url || null, resolvedPaymentPlan || null, home_loan_info || null,
        req.user.id,
      ]
    );

    const project = result.rows[0];

    // ── 2. Insert documents from JSON body ────────────────────
    const savedDocs = [];

    const processDocuments = async (docs, docType) => {
      for (const doc of (docs || [])) {
        if (!doc.file_name || !doc.file_path) {
          throw new AppError(`Each ${docType} entry requires 'file_name' and 'file_path' — upload the file first via the upload endpoint, then submit the returned metadata`, 400);
        }
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
          url: toFullUrl(`/api/v1/projects/${project.id}/documents/${docResult.rows[0].id}/download`),
          ...(['photo', 'creative', 'developer_logo'].includes(docType) ? {
            public_url: toFullUrl(`/api/v1/projects/${project.id}/documents/${docResult.rows[0].id}/public`),
          } : {}),
        });
      }
    };

    if (unit_plans && Array.isArray(unit_plans)) {
      await processDocuments(unit_plans, "unit_plan");
    }
    if (creatives && Array.isArray(creatives)) {
      await processDocuments(creatives, "creative");
    }
    if (payment_plans && Array.isArray(payment_plans)) {
      await processDocuments(payment_plans, "payment_plan");
    }
    if (videos && Array.isArray(videos)) {
      await processDocuments(videos, "video");
    }
    if (photos && Array.isArray(photos)) {
      await processDocuments(photos, "photo");
    }
    if (developer_logo) {
      await processDocuments(Array.isArray(developer_logo) ? developer_logo : [developer_logo], "developer_logo");
    }

    await client.query("COMMIT");

    project.brochure_url = toFullUrl(project.brochure_url);
    project.video_url = toFullUrl(project.video_url);
    project.payment_plan = toFullUrl(project.payment_plan);

    return sendSuccess(res, "Project created successfully", {
      ...project,
      documents: savedDocs.length > 0 ? {
        count:     savedDocs.length,
        unit_plans: savedDocs.filter(d => d.document_type === "unit_plan"),
        creatives:  savedDocs.filter(d => d.document_type === "creative"),
        payment_plans: savedDocs.filter(d => d.document_type === "payment_plan"),
        videos: savedDocs.filter(d => d.document_type === "video"),
        photos: savedDocs.filter(d => d.document_type === "photo"),
        developer_logo: savedDocs.find(d => d.document_type === "developer_logo") || null,
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
        url: toFullUrl(`/api/v1/projects/${project.id}/documents/${d.id}/download`)
      }));
      project.creatives = project.documents.filter(d => d.document_type === 'creative').map(d => ({
        ...d,
        url: toFullUrl(`/api/v1/projects/${project.id}/documents/${d.id}/download`),
        public_url: toFullUrl(`/api/v1/projects/${project.id}/documents/${d.id}/public`)
      }));
      project.payment_plans = project.documents.filter(d => d.document_type === 'payment_plan').map(d => ({
        ...d,
        url: toFullUrl(`/api/v1/projects/${project.id}/documents/${d.id}/download`)
      }));
      project.videos = project.documents.filter(d => d.document_type === 'video').map(d => ({
        ...d,
        url: toFullUrl(`/api/v1/projects/${project.id}/documents/${d.id}/download`)
      }));
      project.photos = project.documents.filter(d => d.document_type === 'photo').map(d => ({
        ...d,
        url: toFullUrl(`/api/v1/projects/${project.id}/documents/${d.id}/download`),
        public_url: toFullUrl(`/api/v1/projects/${project.id}/documents/${d.id}/public`)
      }));
      project.developer_logo = project.documents.filter(d => d.document_type === 'developer_logo').map(d => ({
        ...d,
        url: toFullUrl(`/api/v1/projects/${project.id}/documents/${d.id}/download`),
        public_url: toFullUrl(`/api/v1/projects/${project.id}/documents/${d.id}/public`)
      }))[0] || null;
      delete project.documents;
    } else {
      project.unit_plans = [];
      project.creatives = [];
      project.payment_plans = [];
      project.videos = [];
      project.photos = [];
      project.developer_logo = null;
    }
    project.brochure_url = toFullUrl(project.brochure_url);
    project.video_url = toFullUrl(project.video_url);
    project.payment_plan = toFullUrl(project.payment_plan);

    return sendSuccess(res, "Project fetched successfully", project);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/projects/:id
 */
const updateProject = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const existing = await client.query("SELECT id FROM projects WHERE id = $1", [id]);
    if (existing.rows.length === 0) return next(new AppError("Project not found", 404));

    const { unit_plans, creatives, payment_plans, videos, photos, developer_logo, payment_plan_url, status } = req.body;

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return next(new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400));
    }

    const fields = ["name", "developer", "city", "locality", "address", "price_range",
                    "total_units", "possession_date", "rera_number", "brochure_url", "description",
                    "video_url", "payment_plan", "home_loan_info", "status"];
    const jsonFields = ["configurations", "amenities"];

    const updates = []; const params = []; let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(req.body[field]);
      }
    }
    // `payment_plan_url` is accepted as an alias for the `payment_plan` column
    if (req.body.payment_plan === undefined && payment_plan_url !== undefined) {
      updates.push(`payment_plan = $${idx++}`);
      params.push(payment_plan_url);
    }
    for (const field of jsonFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(JSON.stringify(req.body[field]));
      }
    }

    await client.query("BEGIN");

    let project;
    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      params.push(id);
      const result = await client.query(
        `UPDATE projects SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
        params
      );
      project = result.rows[0];
    } else {
      const result = await client.query("SELECT * FROM projects WHERE id = $1", [id]);
      project = result.rows[0];
    }

    // ── Insert new documents (unit plans/creatives/payment plans/videos) from JSON body ──
    const savedDocs = [];
    const processDocuments = async (docs, docType) => {
      for (const doc of (docs || [])) {
        if (!doc.file_name || !doc.file_path) {
          throw new AppError(`Each ${docType} entry requires 'file_name' and 'file_path' — upload the file first via the upload endpoint, then submit the returned metadata`, 400);
        }
        const docResult = await client.query(
          `INSERT INTO project_documents
             (project_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [id, docType, doc.file_name, doc.file_path, doc.file_size || 0,
           doc.mime_type || 'application/octet-stream', req.user.id]
        );
        savedDocs.push({
          ...docResult.rows[0],
          url: toFullUrl(`/api/v1/projects/${id}/documents/${docResult.rows[0].id}/download`),
          ...(['photo', 'creative', 'developer_logo'].includes(docType) ? {
            public_url: toFullUrl(`/api/v1/projects/${id}/documents/${docResult.rows[0].id}/public`),
          } : {}),
        });
      }
    };

    if (unit_plans && Array.isArray(unit_plans)) await processDocuments(unit_plans, "unit_plan");
    if (creatives && Array.isArray(creatives)) await processDocuments(creatives, "creative");
    if (payment_plans && Array.isArray(payment_plans)) await processDocuments(payment_plans, "payment_plan");
    if (videos && Array.isArray(videos)) await processDocuments(videos, "video");
    if (photos && Array.isArray(photos)) await processDocuments(photos, "photo");
    if (developer_logo) {
      await processDocuments(Array.isArray(developer_logo) ? developer_logo : [developer_logo], "developer_logo");
    }

    if (updates.length === 0 && savedDocs.length === 0) {
      await client.query("ROLLBACK");
      return next(new AppError("No fields to update", 400));
    }

    await client.query("COMMIT");

    project.brochure_url = toFullUrl(project.brochure_url);
    project.video_url = toFullUrl(project.video_url);
    project.payment_plan = toFullUrl(project.payment_plan);

    return sendSuccess(res, "Project updated successfully", {
      ...project,
      documents: savedDocs.length > 0 ? {
        count: savedDocs.length,
        unit_plans: savedDocs.filter(d => d.document_type === "unit_plan"),
        creatives: savedDocs.filter(d => d.document_type === "creative"),
        payment_plans: savedDocs.filter(d => d.document_type === "payment_plan"),
        videos: savedDocs.filter(d => d.document_type === "video"),
        photos: savedDocs.filter(d => d.document_type === "photo"),
        developer_logo: savedDocs.find(d => d.document_type === "developer_logo") || null,
      } : null,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
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