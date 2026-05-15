/**
 * emailService.js — Next One Realty CRM
 * Complete email notification service.
 *
 * Uses nodemailer with Gmail SMTP (App Password).
 * All functions are fire-and-forget safe — they throw on failure so
 * the caller can catch and log without crashing the main request.
 *
 * ENV required:
 *   EMAIL_HOST     smtp.gmail.com
 *   EMAIL_PORT     587
 *   EMAIL_SECURE   false
 *   EMAIL_USER     officialnextone2@gmail.com
 *   EMAIL_PASS     <Gmail App Password>
 *   EMAIL_FROM     "Next One Realty <officialnextone2@gmail.com>"
 *   FRONTEND_URL   https://nextonecrm.asynk.in
 */

const nodemailer = require('nodemailer');

// ── Transporter ──────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',   // false for port 587 STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
});

const FROM    = process.env.EMAIL_FROM    || `"Next One Realty" <${process.env.EMAIL_USER}>`;
const CRM_URL = process.env.FRONTEND_URL  || 'https://nextonecrm.asynk.in';
const BRAND   = '#0066CC';

// ── Shared HTML helpers ──────────────────────────────────────────────────────
const wrap = (body) => `
<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f7fb;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:30px 10px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
  <tr><td style="background:${BRAND};padding:24px 32px;">
    <h2 style="color:#fff;margin:0;font-size:20px;">Next One Realty CRM</h2>
  </td></tr>
  <tr><td style="padding:28px 32px;">${body}</td></tr>
  <tr><td style="background:#f4f7fb;padding:16px 32px;text-align:center;">
    <p style="color:#999;font-size:12px;margin:0;">This is an automated notification from Next One Realty CRM · <a href="${CRM_URL}" style="color:${BRAND};">Open CRM</a></p>
  </td></tr>
</table></td></tr></table>
</body></html>`;

const field  = (label, value) => value
  ? `<tr><td style="padding:4px 0;color:#555;font-size:13px;width:160px;"><strong>${label}:</strong></td><td style="padding:4px 0;color:#333;font-size:13px;">${value}</td></tr>`
  : '';
const table  = (rows) => `<table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;">${rows}</table>`;
const btn    = (text, url) => `<div style="margin:24px 0;"><a href="${url}" style="background:${BRAND};color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold;">${text}</a></div>`;
const badge  = (text, color = BRAND) => `<span style="background:${color};color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:bold;">${text.toUpperCase()}</span>`;

// ── send helper ───────────────────────────────────────────────────────────────
const send = async ({ to, subject, html, text }) => {
  if (!to) return;                               // skip if no recipient
  const recipients = Array.isArray(to) ? to.filter(Boolean).join(',') : to;
  if (!recipients) return;
  await transporter.sendMail({ from: FROM, to: recipients, subject, html, text: text || '' });
};

// ════════════════════════════════════════════════════════════════════════════
// 1. LEAD CREATED
//    → Client welcome email (if lead has email)
//    → Admin notification emails
//    → Assignee notification (handled separately by notifyLeadAssigned)
// ════════════════════════════════════════════════════════════════════════════
const notifyLeadCreated = async ({ lead, assignedTo, createdBy, assigneeEmail, adminEmails }) => {
  const promises = [];

  // ── A. Welcome email to the lead (client) ──────────────────────────────
  if (lead.email) {
    const html = wrap(`
      <h3 style="color:${BRAND};margin-top:0;">Welcome to Next One Realty!</h3>
      <p style="color:#333;font-size:14px;">Dear <strong>${lead.name}</strong>,</p>
      <p style="color:#555;font-size:14px;">Thank you for your interest. Our team has received your enquiry and will reach out to you shortly.</p>
      ${table(
        field('Your Name',    lead.name)  +
        field('Phone',        lead.phone) +
        field('Email',        lead.email) +
        field('Budget',       lead.budget || '—') +
        field('Location',     lead.location_preference || '—')
      )}
      <p style="color:#555;font-size:14px;">Our team is preparing the best property options suited to your requirements. We will be in touch very soon.</p>
      ${btn('Visit Our Website', CRM_URL)}
      <p style="color:#888;font-size:12px;">If you did not make this enquiry, please ignore this email.</p>
    `);
    promises.push(send({ to: lead.email, subject: `Welcome to Next One Realty — We've received your enquiry`, html }));
  }

  // ── B. Admin notification ──────────────────────────────────────────────
  if (adminEmails?.length) {
    const html = wrap(`
      <h3 style="color:${BRAND};margin-top:0;">New Lead Created</h3>
      <p style="color:#555;font-size:14px;">A new lead has been added to the CRM by <strong>${createdBy}</strong>.</p>
      ${table(
        field('Lead Name',   lead.name)   +
        field('Phone',       lead.phone)  +
        field('Email',       lead.email || '—') +
        field('Source',      lead.source || '—') +
        field('Budget',      lead.budget || '—') +
        field('Location',    lead.location_preference || '—') +
        field('Assigned To', assignedTo || 'Unassigned') +
        field('Created By',  createdBy)
      )}
      ${btn('View Lead in CRM', `${CRM_URL}/leads`)}
    `);
    promises.push(send({ to: adminEmails, subject: `New Lead: ${lead.name} — ${lead.phone}`, html }));
  }

  await Promise.allSettled(promises);
};

// ════════════════════════════════════════════════════════════════════════════
// 2. LEAD ASSIGNED
//    → Assignee gets an email telling them they have a new lead
// ════════════════════════════════════════════════════════════════════════════
const notifyLeadAssigned = async ({ lead, assigneeName, assignerName, assigneeEmail, note }) => {
  if (!assigneeEmail) return;
  const html = wrap(`
    <h3 style="color:${BRAND};margin-top:0;">New Lead Assigned to You</h3>
    <p style="color:#333;font-size:14px;">Hi <strong>${assigneeName}</strong>,</p>
    <p style="color:#555;font-size:14px;">A lead has been assigned to you by <strong>${assignerName}</strong>. Please follow up as soon as possible.</p>
    ${table(
      field('Lead Name',   lead.name)   +
      field('Phone',       lead.phone)  +
      field('Email',       lead.email || '—') +
      field('Source',      lead.source || '—') +
      field('Budget',      lead.budget || '—') +
      field('Location',    lead.location_preference || '—') +
      field('Assigned By', assignerName) +
      (note ? field('Note', note) : '')
    )}
    ${btn('View Lead', `${CRM_URL}/leads/${lead.id}`)}
  `);
  await send({ to: assigneeEmail, subject: `Lead Assigned: ${lead.name} — ${lead.phone}`, html });
};

// ════════════════════════════════════════════════════════════════════════════
// 3. LEAD STATUS CHANGED
//    → Client email (if they have email + meaningful status change)
//    → Assignee update
// ════════════════════════════════════════════════════════════════════════════
const notifyLeadStatusChanged = async ({ lead, oldStatus, newStatus, changedBy, note }) => {
  const promises = [];
  const statusLabel = newStatus?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Client email for key milestones
  const clientStatuses = ['site_visit_scheduled', 'negotiation', 'booked'];
  if (lead.email && clientStatuses.includes(newStatus)) {
    const messages = {
      site_visit_scheduled: `Great news! A site visit has been scheduled for you. Our team will confirm the details shortly.`,
      negotiation:          `We're pleased to inform you that your property discussion has moved to the negotiation stage. Our team will contact you soon.`,
      booked:               `Congratulations! Your property booking has been confirmed. Welcome to the Next One Realty family!`,
    };
    const html = wrap(`
      <h3 style="color:${BRAND};margin-top:0;">Update on Your Property Enquiry</h3>
      <p style="color:#333;font-size:14px;">Dear <strong>${lead.name}</strong>,</p>
      <p style="color:#555;font-size:14px;">${messages[newStatus] || `Your enquiry status has been updated to: ${statusLabel}`}</p>
      ${note ? `<p style="color:#555;font-size:14px;background:#f4f7fb;padding:12px;border-left:4px solid ${BRAND};border-radius:0 6px 6px 0;">${note}</p>` : ''}
      <p style="color:#555;font-size:14px;">If you have any questions, please don't hesitate to reach out to us.</p>
    `);
    promises.push(send({ to: lead.email, subject: `Property Enquiry Update: ${statusLabel}`, html }));
  }

  await Promise.allSettled(promises);
};

// ════════════════════════════════════════════════════════════════════════════
// 4. LEAD REASSIGNED
//    → Old assignee notified their lead was taken
// ════════════════════════════════════════════════════════════════════════════
const notifyLeadReassigned = async ({ lead, oldAssigneeName, oldAssigneeEmail, newAssigneeName, performedBy, reason }) => {
  if (!oldAssigneeEmail) return;
  const html = wrap(`
    <h3 style="color:${BRAND};margin-top:0;">Lead Reassigned</h3>
    <p style="color:#333;font-size:14px;">Hi <strong>${oldAssigneeName}</strong>,</p>
    <p style="color:#555;font-size:14px;">The following lead has been reassigned from you to <strong>${newAssigneeName}</strong> by <strong>${performedBy}</strong>.</p>
    ${table(
      field('Lead Name',    lead.name)        +
      field('Phone',        lead.phone)       +
      field('New Assignee', newAssigneeName)  +
      field('Performed By', performedBy)      +
      (reason ? field('Reason', reason) : '')
    )}
    <p style="color:#888;font-size:12px;">If you have questions about this reassignment, please contact your manager.</p>
  `);
  await send({ to: oldAssigneeEmail, subject: `Lead Reassigned: ${lead.name}`, html });
};

// ════════════════════════════════════════════════════════════════════════════
// 5. BULK LEADS ASSIGNED
//    → New assignee notified of bulk assignment
// ════════════════════════════════════════════════════════════════════════════
const notifyBulkLeadsAssigned = async ({ assigneeName, assigneeEmail, leadsCount, performedBy, reason }) => {
  if (!assigneeEmail) return;
  const html = wrap(`
    <h3 style="color:${BRAND};margin-top:0;">${leadsCount} Leads Assigned to You</h3>
    <p style="color:#333;font-size:14px;">Hi <strong>${assigneeName}</strong>,</p>
    <p style="color:#555;font-size:14px;"><strong>${leadsCount} lead${leadsCount > 1 ? 's have' : ' has'}</strong> been assigned to you by <strong>${performedBy}</strong>.</p>
    ${table(
      field('Total Leads',  String(leadsCount)) +
      field('Assigned By',  performedBy)        +
      (reason ? field('Reason', reason) : '')
    )}
    ${btn('View My Leads', `${CRM_URL}/leads`)}
  `);
  await send({ to: assigneeEmail, subject: `${leadsCount} Leads Assigned to You`, html });
};

// ════════════════════════════════════════════════════════════════════════════
// 6. FOLLOW-UP CREATED
//    → Assignee gets a task notification
// ════════════════════════════════════════════════════════════════════════════
const notifyFollowUpCreated = async ({ task, lead, assigneeName, createdBy, assigneeEmail }) => {
  if (!assigneeEmail) return;
  const dueDate = task.due_date
    ? new Date(task.due_date).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';
  const html = wrap(`
    <h3 style="color:${BRAND};margin-top:0;">New Follow-Up Task Assigned</h3>
    <p style="color:#333;font-size:14px;">Hi <strong>${assigneeName}</strong>,</p>
    <p style="color:#555;font-size:14px;">A follow-up task has been assigned to you by <strong>${createdBy}</strong>.</p>
    ${table(
      field('Task Title',   task.title)          +
      field('Lead Name',    lead.name)            +
      field('Lead Phone',   lead.phone)           +
      field('Due Date',     dueDate)              +
      field('Priority',     task.priority || '—') +
      field('Created By',   createdBy)
    )}
    ${task.notes ? `<p style="background:#f4f7fb;padding:12px;border-left:4px solid ${BRAND};border-radius:0 6px 6px 0;color:#555;font-size:13px;">${task.notes}</p>` : ''}
    ${btn('View Follow-Up', `${CRM_URL}/follow-ups`)}
  `);
  await send({ to: assigneeEmail, subject: `Follow-Up Task: ${task.title} — ${lead.name}`, html });
};

// ════════════════════════════════════════════════════════════════════════════
// 7. FOLLOW-UP COMPLETED
//    → Manager / admin notification
// ════════════════════════════════════════════════════════════════════════════
const notifyFollowUpCompleted = async ({ task, lead, completedBy, managerEmail }) => {
  if (!managerEmail) return;
  const html = wrap(`
    <h3 style="color:${BRAND};margin-top:0;">Follow-Up Completed</h3>
    <p style="color:#555;font-size:14px;">A follow-up task has been marked as completed by <strong>${completedBy}</strong>.</p>
    ${table(
      field('Task Title',    task.title)                       +
      field('Lead Name',     lead.name)                        +
      field('Lead Phone',    lead.phone)                       +
      field('Completed By',  completedBy)                      +
      field('Outcome',       task.outcome || task.notes || '—')
    )}
    ${btn('View Follow-Ups', `${CRM_URL}/follow-ups`)}
  `);
  await send({ to: managerEmail, subject: `Follow-Up Completed: ${task.title} — ${lead.name}`, html });
};

// ════════════════════════════════════════════════════════════════════════════
// 8. SITE VISIT SCHEDULED
//    → Client email with visit details
//    → Assignee notification
//    → Admin summary
// ════════════════════════════════════════════════════════════════════════════
const notifySiteVisitScheduled = async ({ lead, project, visit, assignedTo, scheduledBy, assigneeEmail, adminEmails }) => {
  const promises = [];
  const visitDate = visit.visit_date
    ? new Date(visit.visit_date).toLocaleDateString('en-IN', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
    : '—';
  const visitTime = visit.visit_time || '—';

  // Client email
  if (lead.email) {
    const html = wrap(`
      <h3 style="color:${BRAND};margin-top:0;">Your Site Visit is Confirmed!</h3>
      <p style="color:#333;font-size:14px;">Dear <strong>${lead.name}</strong>,</p>
      <p style="color:#555;font-size:14px;">Your site visit to <strong>${project.name}</strong> has been scheduled. We look forward to showing you the property!</p>
      ${table(
        field('Project',    project.name)          +
        field('Location',   project.locality || project.city || '—') +
        field('Visit Date', visitDate)             +
        field('Visit Time', visitTime)             +
        field('Our Rep',    assignedTo || '—')
      )}
      <p style="color:#555;font-size:14px;">Please arrive on time. If you need to reschedule, contact us immediately.</p>
    `);
    promises.push(send({ to: lead.email, subject: `Site Visit Confirmed — ${project.name} on ${visitDate}`, html }));
  }

  // Assignee email
  if (assigneeEmail) {
    const html = wrap(`
      <h3 style="color:${BRAND};margin-top:0;">Site Visit Assigned to You</h3>
      <p style="color:#555;font-size:14px;">You have been assigned to conduct a site visit scheduled by <strong>${scheduledBy}</strong>.</p>
      ${table(
        field('Lead Name',  lead.name)    +
        field('Phone',      lead.phone)   +
        field('Project',    project.name) +
        field('Date',       visitDate)    +
        field('Time',       visitTime)
      )}
      ${btn('View Site Visit', `${CRM_URL}/site-visits`)}
    `);
    promises.push(send({ to: assigneeEmail, subject: `Site Visit: ${lead.name} — ${visitDate}`, html }));
  }

  // Admin email
  if (adminEmails?.length) {
    const html = wrap(`
      <h3 style="color:${BRAND};margin-top:0;">Site Visit Scheduled</h3>
      <p style="color:#555;font-size:14px;">A site visit has been scheduled by <strong>${scheduledBy}</strong>.</p>
      ${table(
        field('Lead',      lead.name)    +
        field('Phone',     lead.phone)   +
        field('Project',   project.name) +
        field('Date',      visitDate)    +
        field('Time',      visitTime)    +
        field('Assigned',  assignedTo || '—')
      )}
      ${btn('View in CRM', `${CRM_URL}/site-visits`)}
    `);
    promises.push(send({ to: adminEmails, subject: `Site Visit Scheduled: ${lead.name} — ${project.name}`, html }));
  }

  await Promise.allSettled(promises);
};

// ════════════════════════════════════════════════════════════════════════════
// 9. SITE VISIT STATUS CHANGED
//    → Assignee + admin update
// ════════════════════════════════════════════════════════════════════════════
const notifySiteVisitStatusChanged = async ({ lead, project, visit, oldStatus, newStatus, updatedBy, note, assigneeEmail }) => {
  if (!assigneeEmail) return;
  const statusLabel = newStatus?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const html = wrap(`
    <h3 style="color:${BRAND};margin-top:0;">Site Visit Status Updated</h3>
    <p style="color:#555;font-size:14px;">The status of a site visit has been updated by <strong>${updatedBy}</strong>.</p>
    ${table(
      field('Lead',        lead.name)     +
      field('Project',     project.name)  +
      field('Old Status',  oldStatus?.replace(/_/g,' ')) +
      field('New Status',  statusLabel)   +
      field('Updated By',  updatedBy)     +
      (note ? field('Note', note) : '')
    )}
    ${btn('View Site Visit', `${CRM_URL}/site-visits`)}
  `);
  await send({ to: assigneeEmail, subject: `Site Visit ${statusLabel}: ${lead.name} — ${project.name}`, html });
};

// ════════════════════════════════════════════════════════════════════════════
// 10. SITE VISIT FEEDBACK
//     → Manager summary of client reaction
// ════════════════════════════════════════════════════════════════════════════
const notifySiteVisitFeedback = async ({ lead, project, visit, feedback, submittedBy, managerEmails }) => {
  if (!managerEmails?.length) return;
  const ratingStars = feedback.rating ? '⭐'.repeat(Math.min(parseInt(feedback.rating), 5)) : '—';
  const html = wrap(`
    <h3 style="color:${BRAND};margin-top:0;">Site Visit Feedback Received</h3>
    <p style="color:#555;font-size:14px;">Feedback has been submitted by <strong>${submittedBy}</strong> for a site visit.</p>
    ${table(
      field('Lead',              lead.name)                 +
      field('Phone',             lead.phone)                +
      field('Project',           project.name)              +
      field('Rating',            ratingStars)               +
      field('Client Reaction',   feedback.client_reaction || '—') +
      field('Interested In',     feedback.interested_in    || '—') +
      field('Next Step',         feedback.next_step        || '—') +
      (feedback.remarks ? field('Remarks', feedback.remarks) : '')
    )}
    ${btn('View Visit', `${CRM_URL}/site-visits`)}
  `);
  await send({ to: managerEmails, subject: `Site Visit Feedback: ${lead.name} — ${project.name}`, html });
};

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════
module.exports = {
  notifyLeadCreated,
  notifyLeadAssigned,
  notifyLeadStatusChanged,
  notifyLeadReassigned,
  notifyBulkLeadsAssigned,
  notifyFollowUpCreated,
  notifyFollowUpCompleted,
  notifySiteVisitScheduled,
  notifySiteVisitStatusChanged,
  notifySiteVisitFeedback,
};