/**
 * shareProjectController.js — Next One Realty CRM
 * 
 * POST /api/v1/projects/:id/share
 * 
 * Shares a project with one or more email addresses.
 * Sends a branded HTML email with:
 *   - Full project details (name, location, price, configs, RERA, possession, amenities)
 *   - All unit plans + creatives attached as a single ZIP file
 *   - Separate listing of what's in the ZIP so recipient knows what to expect
 * 
 * Auth: All authenticated users
 */

const { pool }    = require('../config/db');
const { sendSuccess } = require('../utils/response');
const AppError    = require('../utils/AppError');
const nodemailer  = require('nodemailer');
const { ZipArchive } = require('archiver');
const fs          = require('fs');
const path        = require('path');
const stream      = require('stream');

// ── Re-use the same transporter from emailService ────────────────────────────
const cleanEnv   = (val) => (val || '').split('#')[0].trim();
const EMAIL_USER = cleanEnv(process.env.EMAIL_USER);
const EMAIL_PASS = cleanEnv(process.env.EMAIL_PASS);
const EMAIL_HOST = cleanEnv(process.env.EMAIL_HOST) || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(cleanEnv(process.env.EMAIL_PORT) || '587');
const EMAIL_SEC  = cleanEnv(process.env.EMAIL_SECURE) === 'true';
const USE_PORT   = EMAIL_PORT || 465;
const USE_SECURE = USE_PORT === 465 ? true : EMAIL_SEC;

const transporter = nodemailer.createTransport({
  host:   EMAIL_HOST,
  port:   USE_PORT,
  secure: USE_SECURE,
  auth:   { user: EMAIL_USER, pass: EMAIL_PASS },
  tls:    { rejectUnauthorized: false },
  connectionTimeout: 60000,
  greetingTimeout:   30000,
  socketTimeout:     60000,
});

const FROM    = process.env.EMAIL_FROM
  ? cleanEnv(process.env.EMAIL_FROM)
  : `"Next One Realty" <${EMAIL_USER}>`;
const BRAND   = '#0066CC';
const CRM_URL = cleanEnv(process.env.FRONTEND_URL) || 'https://nextonecrm.asynk.in';

// ── HTML helpers (same style as emailService) ─────────────────────────────────
const wrap = (body) => `
<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f7fb;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:30px 10px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
  <tr><td style="background:${BRAND};padding:24px 32px;">
    <h2 style="color:#fff;margin:0;font-size:22px;">Next One Realty</h2>
    <p style="color:#cce0ff;margin:4px 0 0 0;font-size:13px;">Project Brochure & Documents</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">${body}</td></tr>
  <tr><td style="background:#f4f7fb;padding:16px 32px;text-align:center;">
    <p style="color:#999;font-size:12px;margin:0;">
      Shared by Next One Realty CRM · 
      <a href="${CRM_URL}" style="color:${BRAND};">Visit Website</a>
    </p>
  </td></tr>
</table></td></tr></table>
</body></html>`;

const row = (label, value) => value
  ? `<tr>
      <td style="padding:6px 0;color:#777;font-size:13px;width:160px;vertical-align:top;"><strong>${label}</strong></td>
      <td style="padding:6px 0;color:#222;font-size:13px;">${value}</td>
    </tr>`
  : '';

const section = (title, content) => `
  <div style="margin:20px 0;">
    <h4 style="color:${BRAND};font-size:14px;margin:0 0 10px 0;border-bottom:2px solid #e8f0fe;padding-bottom:6px;">
      ${title}
    </h4>
    ${content}
  </div>`;

// ── Build ZIP from project documents ─────────────────────────────────────────
const buildZipBuffer = (docs) => {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks  = [];

    archive.on('data',  chunk => chunks.push(chunk));
    archive.on('end',   ()    => resolve(Buffer.concat(chunks)));
    archive.on('error', err   => reject(err));

    let addedCount = 0;
    for (const doc of docs) {
      if (doc.file_path && fs.existsSync(doc.file_path)) {
        const folder = doc.document_type === 'unit_plan' ? 'Unit Plans' : 'Creatives';
        archive.file(doc.file_path, { name: `${folder}/${doc.file_name}` });
        addedCount++;
      }
    }

    if (addedCount === 0) {
      // No valid files — resolve with null so caller can skip attachment
      archive.abort();
      resolve(null);
      return;
    }

    archive.finalize();
  });
};

// ── Main controller ───────────────────────────────────────────────────────────
const shareProject = async (req, res, next) => {
  try {
    const { id: projectId } = req.params;
    const { emails, message } = req.body;

    // ── Validate emails ──────────────────────────────────────────────────────
    if (!emails) return next(new AppError('emails field is required', 400));

    const emailList = Array.isArray(emails)
      ? emails.map(e => e.trim()).filter(Boolean)
      : [emails.trim()].filter(Boolean);

    if (emailList.length === 0) {
      return next(new AppError('Provide at least one email address', 400));
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalid = emailList.filter(e => !emailRegex.test(e));
    if (invalid.length > 0) {
      return next(new AppError(`Invalid email address(es): ${invalid.join(', ')}`, 400));
    }

    // ── Fetch project ────────────────────────────────────────────────────────
    const projectResult = await pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );
    if (projectResult.rows.length === 0) {
      return next(new AppError('Project not found', 404));
    }
    const project = projectResult.rows[0];

    // ── Fetch documents ──────────────────────────────────────────────────────
    const docsResult = await pool.query(
      `SELECT id, document_type, file_name, file_path, file_size, mime_type
       FROM project_documents WHERE project_id = $1 ORDER BY document_type, uploaded_at DESC`,
      [projectId]
    );
    const allDocs    = docsResult.rows;
    const unitPlans  = allDocs.filter(d => d.document_type === 'unit_plan');
    const creatives  = allDocs.filter(d => d.document_type === 'creative');

    // ── Parse project fields ─────────────────────────────────────────────────
    const configs  = (() => {
      try { return Array.isArray(project.configurations) ? project.configurations : JSON.parse(project.configurations || '[]') }
      catch { return [] }
    })();
    const amenList = (() => {
      try { return Array.isArray(project.amenities) ? project.amenities : JSON.parse(project.amenities || '[]') }
      catch { return [] }
    })();
    const possDate = project.possession_date
      ? new Date(project.possession_date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      : null;

    const sharedBy = req.user
      ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email
      : 'Next One Realty Team';

    // ── Build ZIP attachment ─────────────────────────────────────────────────
    let zipBuffer  = null;
    let zipFileName = null;
    if (allDocs.length > 0) {
      zipBuffer  = await buildZipBuffer(allDocs);
      zipFileName = `${project.name.replace(/[^a-zA-Z0-9 ]/g, '').trim()}_Documents.zip`;
    }

    // ── Build HTML email ─────────────────────────────────────────────────────
    const docListHtml = (() => {
      const items = [];
      if (unitPlans.length > 0) {
        items.push(`<li style="color:#333;font-size:13px;margin-bottom:4px;">
          <strong>Unit Plans</strong> (${unitPlans.length} file${unitPlans.length > 1 ? 's' : ''}) — 
          ${unitPlans.map(d => d.file_name).join(', ')}
        </li>`);
      }
      if (creatives.length > 0) {
        items.push(`<li style="color:#333;font-size:13px;margin-bottom:4px;">
          <strong>Creatives / Marketing Materials</strong> (${creatives.length} file${creatives.length > 1 ? 's' : ''}) — 
          ${creatives.map(d => d.file_name).join(', ')}
        </li>`);
      }
      return items.length > 0
        ? `<ul style="margin:8px 0;padding-left:20px;">${items.join('')}</ul>`
        : '<p style="color:#888;font-size:13px;">No documents attached.</p>';
    })();

    const html = wrap(`
      <h3 style="color:${BRAND};margin-top:0;font-size:18px;">
        Project Details — ${project.name}
      </h3>

      ${message ? `
      <div style="background:#f0f6ff;border-left:4px solid ${BRAND};border-radius:0 6px 6px 0;padding:12px 16px;margin-bottom:20px;">
        <p style="color:#333;font-size:13px;margin:0;font-style:italic;">"${message}"</p>
        <p style="color:#888;font-size:12px;margin:4px 0 0 0;">— ${sharedBy}</p>
      </div>` : ''}

      ${section('Project Overview', `<table cellpadding="0" cellspacing="0" style="width:100%;">
        ${row('Project Name',  project.name)}
        ${row('Developer',     project.developer)}
        ${row('Location',      [project.locality, project.city].filter(Boolean).join(', '))}
        ${row('Address',       project.address)}
        ${row('Price Range',   project.price_range)}
        ${row('Configurations',configs.length > 0 ? configs.join(' | ') : null)}
        ${row('Total Units',   project.total_units)}
        ${row('Possession',    possDate)}
        ${row('RERA No.',      project.rera_number)}
        ${row('Status',        project.status ? project.status.charAt(0).toUpperCase() + project.status.slice(1) : null)}
      </table>`)}

      ${project.description ? section('About the Project', `
        <p style="color:#444;font-size:13px;line-height:1.7;margin:0;">${project.description}</p>
      `) : ''}

      ${amenList.length > 0 ? section('Amenities', `
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${amenList.map(a => `
            <span style="background:#e8f0fe;color:${BRAND};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:bold;">
              ${a}
            </span>`).join('')}
        </div>
      `) : ''}

      ${allDocs.length > 0 ? section(`📎 Attached Documents (ZIP)`, `
        <p style="color:#555;font-size:13px;margin:0 0 8px 0;">
          The following files are included in the attached ZIP file:
        </p>
        ${docListHtml}
        <p style="color:#888;font-size:12px;margin:8px 0 0 0;">
          Extract the ZIP to access all files, organized into folders.
        </p>
      `) : section('Documents', `
        <p style="color:#888;font-size:13px;margin:0;">
          No documents have been uploaded for this project yet.
        </p>
      `)}

      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #eee;">
        <p style="color:#555;font-size:13px;margin:0;">
          For more information or to schedule a site visit, please contact us.
        </p>
        <p style="color:#888;font-size:12px;margin:8px 0 0 0;">
          Shared by: <strong>${sharedBy}</strong> · Next One Realty
        </p>
      </div>
    `);

    // ── Send email ───────────────────────────────────────────────────────────
    const mailOptions = {
      from:    FROM,
      to:      emailList.join(', '),
      subject: `Project Details: ${project.name} — Next One Realty`,
      html,
      text: `${project.name}\n\nShared by ${sharedBy} from Next One Realty.\n\nProject: ${project.name}\nLocation: ${[project.locality, project.city].filter(Boolean).join(', ')}\nPrice: ${project.price_range || 'Contact us'}\n\nFor more details, contact Next One Realty.`,
      attachments: [],
    };

    // Attach ZIP if we have valid files
    if (zipBuffer && zipFileName) {
      mailOptions.attachments.push({
        filename: zipFileName,
        content:  zipBuffer,
        contentType: 'application/zip',
      });
    }

    await transporter.sendMail(mailOptions);

    // ── Log activity (fire and forget) ───────────────────────────────────────
    pool.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by)
       SELECT l.id, 'email', $1, $2 FROM leads l WHERE l.project_id = $3 AND l.is_archived = false LIMIT 0`,
      [`Project shared via email to: ${emailList.join(', ')}`, req.user?.id, projectId]
    ).catch(() => {}); // non-critical

    return sendSuccess(res, 'Project shared successfully', {
      project_id:   projectId,
      project_name: project.name,
      sent_to:      emailList,
      total_sent:   emailList.length,
      attached:     zipBuffer ? { zip_name: zipFileName, files: allDocs.length } : null,
      shared_by:    sharedBy,
    });

  } catch (err) {
    next(err);
  }
};

module.exports = { shareProject };
