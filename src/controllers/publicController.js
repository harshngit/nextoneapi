/**
 * publicController.js — Nextone Reality
 *
 * Endpoints for the public marketing website — NO authentication.
 * Only marketing-safe project fields are exposed; internal fields
 * (created_by, lead counts, etc.) are never returned here.
 */

const { pool } = require("../config/db");
const { sendSuccess, paginate } = require("../utils/response");
const AppError = require("../utils/AppError");
const { notifyAdmins } = require("./notificationController");
const emailService = require("../utils/emailService");

const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/+$/, "");
const toFullUrl = (relativePath) => {
  if (!relativePath) return relativePath;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  return `${BACKEND_URL}${relativePath.startsWith("/") ? "" : "/"}${relativePath}`;
};

// project_documents.file_path is a full OS-absolute path (e.g.
// "/var/www/nextoneapi/uploads/projects/xxx/creatives/yyy.jpg"), NOT a
// URL-relative one like brochure_url/video_url are — so it needs the
// server's own filesystem prefix stripped before it can become a public URL.
const toPublicFileUrl = (absolutePath) => {
  if (!absolutePath) return absolutePath;
  if (/^https?:\/\//i.test(absolutePath)) return absolutePath;
  const normalized = absolutePath.replace(/\\/g, "/");
  const marker = "/uploads/";
  const idx = normalized.indexOf(marker);
  const relative = idx === -1 ? normalized : normalized.slice(idx);
  return `${BACKEND_URL}${relative.startsWith("/") ? "" : "/"}${relative}`;
};

// Every website lead notification always reaches this inbox, regardless of
// who's registered as admin in the system.
const WEBSITE_INQUIRY_NOTIFY_EMAIL = "nextonerealty77@gmail.com";

// ─── Helper — active admin/super_admin email addresses ────────────────────────
const getAdminEmails = async () => {
  const result = await pool.query(
    "SELECT email FROM users WHERE role IN ('admin','super_admin') AND is_active = true"
  );
  const emails = new Set(result.rows.map(r => r.email));
  emails.add(WEBSITE_INQUIRY_NOTIFY_EMAIL);
  return [...emails];
};

const PUBLIC_PROJECT_FIELDS = `
  id, name, developer, city, locality, configurations, price_range,
  total_units, possession_date, amenities, status, brochure_url,
  description, video_url, payment_plan, home_loan_info, created_at
`;

const PUBLIC_PROJECT_DETAIL_FIELDS = `
  id, name, developer, city, locality, address, configurations, price_range,
  total_units, possession_date, rera_number, amenities, status, brochure_url,
  description, video_url, payment_plan, home_loan_info, created_at
`;

// ─── GET /api/v1/public/projects ───────────────────────────────────────────────
const getPublicProjects = async (req, res, next) => {
  try {
    const { city, location, search, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [`status != 'inactive'`];
    let params = [];
    let idx = 1;

    if (city) { conditions.push(`city ILIKE $${idx++}`); params.push(city); }
    if (location) { conditions.push(`locality ILIKE $${idx++}`); params.push(`%${location}%`); }
    if (search) {
      conditions.push(`(name ILIKE $${idx} OR developer ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(`SELECT COUNT(*) FROM projects ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT ${PUBLIC_PROJECT_FIELDS} FROM projects ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    dataResult.rows.forEach(row => {
      row.brochure_url = toFullUrl(row.brochure_url);
      row.video_url     = toFullUrl(row.video_url);
      row.payment_plan  = toFullUrl(row.payment_plan);
    });

    return res.json(paginate(dataResult.rows, total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/v1/public/projects/:id ───────────────────────────────────────────
const getPublicProjectById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT ${PUBLIC_PROJECT_DETAIL_FIELDS} FROM projects WHERE id = $1 AND status != 'inactive'`,
      [id]
    );
    if (!result.rows.length) return next(new AppError("Project not found", 404));
    const project = result.rows[0];
    project.brochure_url = toFullUrl(project.brochure_url);
    project.video_url     = toFullUrl(project.video_url);
    project.payment_plan  = toFullUrl(project.payment_plan);

    const docsResult = await pool.query(
      `SELECT id, document_type, file_name, file_path, file_size, mime_type
       FROM project_documents WHERE project_id = $1
       ORDER BY uploaded_at ASC`,
      [id]
    );
    docsResult.rows.forEach(doc => { doc.file_path = toPublicFileUrl(doc.file_path); });

    const grouped = { photos: [], videos: [], creatives: [], unit_plans: [], payment_plans: [], developer_logo: null };
    for (const doc of docsResult.rows) {
      if (doc.document_type === "photo")         grouped.photos.push(doc);
      else if (doc.document_type === "video")     grouped.videos.push(doc);
      else if (doc.document_type === "creative")  grouped.creatives.push(doc);
      else if (doc.document_type === "unit_plan") grouped.unit_plans.push(doc);
      else if (doc.document_type === "payment_plan") grouped.payment_plans.push(doc);
      else if (doc.document_type === "developer_logo") grouped.developer_logo = doc;
    }

    return sendSuccess(res, "Project fetched", { ...project, ...grouped });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/v1/public/projects/:id/inquiry (PUBLIC — "website lead" API) ───
// A visitor fills the enquiry form on a project's page — creates a Lead
// directly, tied to that project. No auth, no staging table.
const submitProjectInquiry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, phone, email, message, budget, location_preference, configuration } = req.body;

    if (!name || !phone) {
      return next(new AppError("name and phone are required", 400));
    }

    const project = await pool.query(
      `SELECT id, name FROM projects WHERE id = $1 AND status != 'inactive'`,
      [id]
    );
    if (!project.rows.length) return next(new AppError("Project not found", 404));

    const result = await pool.query(
      `INSERT INTO leads (name, phone, email, source, project_id, budget, location_preference, configuration, status, created_by)
       VALUES ($1,$2,$3,'Website',$4,$5,$6,$7,'new',NULL)
       RETURNING *`,
      [String(name).trim(), phone, email || null, id, budget || null, location_preference || null, configuration || null]
    );
    const lead = result.rows[0];

    // Fire-and-forget: in-app/push notification to admins + email to admins
    // and the enquirer. None of this should block or fail the public response.
    notifyAdmins({
      type: "lead_new",
      title: "New Website Lead",
      message: `${lead.name} (${lead.phone}) enquired about "${project.rows[0].name}" on the website`,
      reference_id: lead.id,
      reference_type: "lead",
      metadata: { lead_id: lead.id, project_id: id, message: message || null },
    }).catch(() => {});

    getAdminEmails()
      .then(adminEmails => emailService.notifyLeadCreated({
        lead,
        assignedTo: null,
        createdBy: `Website — ${project.rows[0].name}`,
        assigneeEmail: null,
        adminEmails,
      }))
      .catch(err => console.error("[Email] website lead notify failed:", err.message));

    return sendSuccess(res, "Thank you for your interest — our team will contact you shortly", lead, 201);
  } catch (err) {
    next(err);
  }
};

module.exports = { getPublicProjects, getPublicProjectById, submitProjectInquiry };
