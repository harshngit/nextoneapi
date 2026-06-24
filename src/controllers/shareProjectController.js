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
        let folder;
        switch (doc.document_type) {
          case 'unit_plan':
            folder = 'Unit Plans';
            break;
          case 'creative':
            folder = 'Creatives';
            break;
          case 'payment_plan':
            folder = 'Payment Plans';
            break;
          case 'video':
            folder = 'Videos';
            break;
          default:
            folder = 'Other';
        }
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
    const { emails, message, document_ids, fields } = req.body;
    
    // Default fields to include in email
    const defaultFields = ['name', 'developer', 'location', 'address', 'price_range', 'configurations', 'total_units', 'possession_date', 'rera_number', 'status', 'description', 'amenities', 'video_url', 'payment_plan', 'home_loan_info'];
    const selectedFields = fields && fields.length > 0 ? fields : defaultFields;

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
    
    // Filter documents if document_ids are provided
    let selectedDocs = allDocs;
    if (document_ids && Array.isArray(document_ids) && document_ids.length > 0) {
      selectedDocs = allDocs.filter(d => document_ids.includes(d.id));
      if (selectedDocs.length === 0) {
        return next(new AppError('No valid documents found with the provided IDs', 400));
      }
    }
    
    const unitPlans  = selectedDocs.filter(d => d.document_type === 'unit_plan');
    const creatives  = selectedDocs.filter(d => d.document_type === 'creative');
    const paymentPlans = selectedDocs.filter(d => d.document_type === 'payment_plan');
    const videos = selectedDocs.filter(d => d.document_type === 'video');

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
    if (selectedDocs.length > 0) {
      zipBuffer  = await buildZipBuffer(selectedDocs);
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
      if (paymentPlans.length > 0) {
        items.push(`<li style="color:#333;font-size:13px;margin-bottom:4px;">
          <strong>Payment Plans</strong> (${paymentPlans.length} file${paymentPlans.length > 1 ? 's' : ''}) — 
          ${paymentPlans.map(d => d.file_name).join(', ')}
        </li>`);
      }
      if (videos.length > 0) {
        items.push(`<li style="color:#333;font-size:13px;margin-bottom:4px;">
          <strong>Videos</strong> (${videos.length} file${videos.length > 1 ? 's' : ''}) — 
          ${videos.map(d => d.file_name).join(', ')}
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
        ${selectedFields.includes('name') ? row('Project Name', project.name) : ''}
        ${selectedFields.includes('developer') ? row('Developer', project.developer) : ''}
        ${selectedFields.includes('location') ? row('Location', [project.locality, project.city].filter(Boolean).join(', ')) : ''}
        ${selectedFields.includes('address') ? row('Address', project.address) : ''}
        ${selectedFields.includes('price_range') ? row('Price Range', project.price_range) : ''}
        ${selectedFields.includes('configurations') ? row('Configurations', configs.length > 0 ? configs.join(' | ') : null) : ''}
        ${selectedFields.includes('total_units') ? row('Total Units', project.total_units) : ''}
        ${selectedFields.includes('possession_date') ? row('Possession', possDate) : ''}
        ${selectedFields.includes('rera_number') ? row('RERA No.', project.rera_number) : ''}
        ${selectedFields.includes('status') ? row('Status', project.status ? project.status.charAt(0).toUpperCase() + project.status.slice(1) : null) : ''}
        ${selectedFields.includes('video_url') && project.video_url ? row('Video', `<a href="${project.video_url}" style="color:${BRAND};">View Project Video</a>`) : ''}
        ${selectedFields.includes('payment_plan') && project.payment_plan ? row('Payment Plan', project.payment_plan) : ''}
        ${selectedFields.includes('home_loan_info') && project.home_loan_info ? row('Home Loan Info', project.home_loan_info) : ''}
      </table>`)}

      ${selectedFields.includes('description') && project.description ? section('About the Project', `
        <p style="color:#444;font-size:13px;line-height:1.7;margin:0;">${project.description}</p>
      `) : ''}

      ${selectedFields.includes('amenities') && amenList.length > 0 ? section('Amenities', `
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
      attached:     zipBuffer ? { zip_name: zipFileName, files: selectedDocs.length, document_ids: selectedDocs.map(d => d.id) } : null,
      fields:       selectedFields,
      shared_by:    sharedBy,
    });

  } catch (err) {
    next(err);
  }
};

// ── Share project document on WhatsApp ───────────────────────────────────────
const whatsapp = require('../utils/whatsappService');

const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/$/, '');

const shareProjectWhatsapp = async (req, res, next) => {
  try {
    const { id: projectId } = req.params;
    const { phone, document_id } = req.body;

    if (!phone) return next(new AppError('phone is required', 400));

    const cleanedPhone = whatsapp.cleanPhone(phone);
    if (!cleanedPhone) return next(new AppError('Invalid phone number', 400));

    if (!document_id) return next(new AppError('document_id is required', 400));

    if (!BACKEND_URL) return next(new AppError('BACKEND_URL is not configured on the server', 500));

    // ── Fetch project ────────────────────────────────────────────────────────
    const projectResult = await pool.query(
      'SELECT id, name FROM projects WHERE id = $1',
      [projectId]
    );
    if (projectResult.rows.length === 0) {
      return next(new AppError('Project not found', 404));
    }
    const project = projectResult.rows[0];

    // ── Fetch the document ───────────────────────────────────────────────────
    const docResult = await pool.query(
      'SELECT id, document_type, file_name, file_path, mime_type FROM project_documents WHERE id = $1 AND project_id = $2',
      [document_id, projectId]
    );
    if (docResult.rows.length === 0) {
      return next(new AppError('Document not found for this project', 404));
    }
    const doc = docResult.rows[0];

    // ── Construct public URL ─────────────────────────────────────────────────
    const filePath     = doc.file_path.startsWith('/') ? doc.file_path : `/${doc.file_path}`;
    const documentLink = `${BACKEND_URL}${filePath}`;

    const typeLabel = doc.document_type.replace(/_/g, ' ');
    const caption   = `${project.name} — ${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)}`;

    // ── Send via WhatsApp ────────────────────────────────────────────────────
    const result = await whatsapp.sendDocument({
      phone,
      documentLink,
      fileName: doc.file_name,
      caption,
    });

    return sendSuccess(res, 'Document shared via WhatsApp', {
      project_id:         projectId,
      project_name:       project.name,
      document:           { id: doc.id, file_name: doc.file_name, type: doc.document_type },
      sent_to:            phone,
      whatsapp_message_id: result?.messages?.[0]?.id || null,
    });

  } catch (err) {
    next(err);
  }
};

module.exports = { shareProject, shareProjectWhatsapp };
