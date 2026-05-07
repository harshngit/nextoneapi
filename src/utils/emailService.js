/**
 * emailService.js — Nextone Reality Email Automation
 * Uses nodemailer (SMTP / EmailJS-compatible settings)
 * All templates are HTML-rich, branded for Nextone Reality
 */

const nodemailer = require("nodemailer");
require("dotenv").config();

// ─── Transport ────────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST   || "smtp.gmail.com",
  port:   parseInt(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === "true",   // true for 465, false for 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Brand Palette ────────────────────────────────────────────────────────────

const BRAND = {
  primary:    "#1a3c6e",   // deep navy
  accent:     "#c9a84c",   // gold
  light:      "#f5f7fa",   // off-white bg
  dark:       "#111827",   // near-black
  muted:      "#6b7280",   // grey text
  success:    "#059669",
  warning:    "#d97706",
  danger:     "#dc2626",
  name:       "Nextone Reality",
  logo_text:  "NEXTONE REALITY",
  tagline:    "Your Dream. Our Reality.",
  website:    process.env.COMPANY_WEBSITE || "https://nextonereality.com",
  phone:      process.env.COMPANY_PHONE   || "+91 98765 43210",
  email:      process.env.COMPANY_EMAIL   || "info@nextonereality.com",
  address:    process.env.COMPANY_ADDRESS || "Mumbai, Maharashtra, India",
};

// ─── Shared Layout ────────────────────────────────────────────────────────────

const layout = ({ title, preheader = "", body, ctaUrl = "", ctaLabel = "" }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.light};font-family:'Segoe UI',Arial,sans-serif;">
  <!-- Preheader (hidden preview text) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</span>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.light};padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- ── Header ── -->
        <tr>
          <td style="background:${BRAND.primary};border-radius:12px 12px 0 0;padding:28px 40px;text-align:center;">
            <div style="font-size:24px;font-weight:800;letter-spacing:3px;color:#fff;">
              ${BRAND.logo_text}
            </div>
            <div style="font-size:11px;letter-spacing:2px;color:${BRAND.accent};margin-top:4px;">
              ${BRAND.tagline.toUpperCase()}
            </div>
          </td>
        </tr>

        <!-- ── Gold Rule ── -->
        <tr>
          <td style="background:${BRAND.accent};height:4px;"></td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td style="background:#ffffff;padding:40px 40px 28px 40px;color:${BRAND.dark};font-size:15px;line-height:1.7;">
            ${body}

            ${ctaUrl ? `
            <div style="text-align:center;margin:32px 0 8px;">
              <a href="${ctaUrl}"
                 style="display:inline-block;background:${BRAND.primary};color:#fff;
                        padding:14px 36px;border-radius:8px;text-decoration:none;
                        font-weight:700;font-size:15px;letter-spacing:0.5px;">
                ${ctaLabel}
              </a>
            </div>` : ""}
          </td>
        </tr>

        <!-- ── Divider ── -->
        <tr><td style="background:#ffffff;padding:0 40px;">
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
        </td></tr>

        <!-- ── Footer ── -->
        <tr>
          <td style="background:#ffffff;border-radius:0 0 12px 12px;padding:24px 40px 32px;
                     color:${BRAND.muted};font-size:12px;text-align:center;line-height:1.8;">
            <strong style="color:${BRAND.dark};">${BRAND.name}</strong><br/>
            ${BRAND.address}<br/>
            <a href="tel:${BRAND.phone}" style="color:${BRAND.accent};text-decoration:none;">${BRAND.phone}</a>
            &nbsp;|&nbsp;
            <a href="mailto:${BRAND.email}" style="color:${BRAND.accent};text-decoration:none;">${BRAND.email}</a>
            <br/><br/>
            <span style="font-size:11px;color:#9ca3af;">
              This is an automated email from ${BRAND.name} CRM. Please do not reply to this message.
            </span>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ─── Status Badge helper ──────────────────────────────────────────────────────

const STATUS_COLORS = {
  new:                    { bg: "#dbeafe", text: "#1e40af" },
  contacted:              { bg: "#ede9fe", text: "#5b21b6" },
  interested:             { bg: "#d1fae5", text: "#065f46" },
  follow_up:              { bg: "#fef3c7", text: "#92400e" },
  site_visit_scheduled:   { bg: "#e0f2fe", text: "#0369a1" },
  site_visit_done:        { bg: "#dcfce7", text: "#166534" },
  negotiation:            { bg: "#fce7f3", text: "#9d174d" },
  booked:                 { bg: "#d1fae5", text: "#064e3b" },
  lost:                   { bg: "#fee2e2", text: "#991b1b" },
  scheduled:              { bg: "#e0f2fe", text: "#0369a1" },
  done:                   { bg: "#d1fae5", text: "#166534" },
  cancelled:              { bg: "#fee2e2", text: "#991b1b" },
  rescheduled:            { bg: "#fef3c7", text: "#92400e" },
  no_show:                { bg: "#f3f4f6", text: "#374151" },
  pending:                { bg: "#fef3c7", text: "#92400e" },
  completed:              { bg: "#d1fae5", text: "#166534" },
  overdue:                { bg: "#fee2e2", text: "#991b1b" },
};

const badge = (status) => {
  const { bg, text } = STATUS_COLORS[status] || { bg: "#f3f4f6", text: "#374151" };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return `<span style="display:inline-block;background:${bg};color:${text};
    padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;
    letter-spacing:0.5px;">${label}</span>`;
};

// ─── Info Row helper ──────────────────────────────────────────────────────────

const infoRow = (label, value, highlight = false) =>
  value
    ? `<tr>
        <td style="padding:8px 16px 8px 0;color:${BRAND.muted};font-size:13px;width:38%;vertical-align:top;">${label}</td>
        <td style="padding:8px 0;color:${highlight ? BRAND.primary : BRAND.dark};
                   font-size:13px;font-weight:${highlight ? "700" : "500"};vertical-align:top;">${value}</td>
       </tr>`
    : "";

const infoTable = (rows) => `
  <table cellpadding="0" cellspacing="0" style="width:100%;background:${BRAND.light};
         border-radius:8px;padding:4px 16px;margin:20px 0;">
    <tbody>${rows}</tbody>
  </table>`;

// ─── Section heading ──────────────────────────────────────────────────────────

const sectionHead = (icon, text) =>
  `<p style="margin:24px 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;
             letter-spacing:1px;color:${BRAND.muted};">${icon}&nbsp;&nbsp;${text}</p>`;

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 1 — Lead Created
// ═══════════════════════════════════════════════════════════════════════════════

const leadCreatedTemplate = (data) => {
  const { lead, assignedTo, createdBy } = data;

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">🎉 New Lead Created</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      A new lead has been added to your CRM pipeline.
    </p>

    ${sectionHead("👤", "Lead Details")}
    ${infoTable(`
      ${infoRow("Lead Name",   `<strong>${lead.name}</strong>`, true)}
      ${infoRow("Phone",       lead.phone)}
      ${infoRow("Email",       lead.email)}
      ${infoRow("Source",      lead.source)}
      ${infoRow("Status",      badge("new"))}
      ${infoRow("Budget",      lead.budget ? `₹${lead.budget}` : null)}
      ${infoRow("Location",    lead.location_preference)}
    `)}

    ${lead.project_name ? `
    ${sectionHead("🏗️", "Project Interest")}
    ${infoTable(`${infoRow("Project", lead.project_name, true)}`)}
    ` : ""}

    ${sectionHead("👥", "Assignment")}
    ${infoTable(`
      ${infoRow("Assigned To", assignedTo || "Unassigned")}
      ${infoRow("Created By",  createdBy)}
      ${infoRow("Date",        new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }))}
    `)}

    <p style="background:#fffbeb;border-left:4px solid ${BRAND.accent};padding:12px 16px;
              border-radius:0 6px 6px 0;font-size:13px;color:${BRAND.dark};margin-top:24px;">
      ⚡ <strong>Action Required:</strong> Please follow up with this lead within 24 hours to maximise conversion chances.
    </p>
  `;

  return layout({
    title:     "New Lead Created — Nextone Reality",
    preheader: `New lead: ${lead.name} | ${lead.phone}`,
    body,
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 2 — Lead Status Changed
// ═══════════════════════════════════════════════════════════════════════════════

const leadStatusChangedTemplate = (data) => {
  const { lead, oldStatus, newStatus, changedBy, note } = data;

  const MILESTONE_MSGS = {
    interested:            "Great news! The lead has shown interest.",
    follow_up:             "This lead requires a follow-up call or meeting.",
    site_visit_scheduled:  "A site visit has been scheduled. Prepare well!",
    site_visit_done:       "Site visit completed. Gather feedback promptly.",
    negotiation:           "Lead is in negotiation. Close carefully!",
    booked:                "🎊 Congratulations! The lead has been booked.",
    lost:                  "This lead has been marked as lost. Review for learnings.",
  };

  const milestone = MILESTONE_MSGS[newStatus] || "The lead status has been updated.";

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">🔄 Lead Status Updated</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">${milestone}</p>

    ${sectionHead("👤", "Lead Information")}
    ${infoTable(`
      ${infoRow("Lead Name",   `<strong>${lead.name}</strong>`, true)}
      ${infoRow("Phone",       lead.phone)}
      ${infoRow("Email",       lead.email)}
      ${infoRow("Project",     lead.project_name)}
    `)}

    ${sectionHead("📊", "Status Change")}
    ${infoTable(`
      ${infoRow("Previous Status", badge(oldStatus))}
      ${infoRow("New Status",      badge(newStatus))}
      ${infoRow("Changed By",      changedBy)}
      ${infoRow("Date & Time",     new Date().toLocaleString("en-IN"))}
      ${note ? infoRow("Note", note) : ""}
    `)}

    ${newStatus === "booked" ? `
    <div style="background:#d1fae5;border:1px solid #a7f3d0;border-radius:10px;
                padding:20px;text-align:center;margin-top:24px;">
      <div style="font-size:32px;margin-bottom:8px;">🏠</div>
      <div style="font-size:18px;font-weight:800;color:#064e3b;">Booking Confirmed!</div>
      <div style="font-size:13px;color:#065f46;margin-top:6px;">
        Congratulations on closing this deal. Our team will get in touch for documentation.
      </div>
    </div>
    ` : ""}
  `;

  return layout({
    title:     `Lead Status Updated: ${lead.name} — Nextone Reality`,
    preheader: `${lead.name} → Status changed to ${newStatus.replace(/_/g, " ")}`,
    body,
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 3 — Lead Assigned
// ═══════════════════════════════════════════════════════════════════════════════

const leadAssignedTemplate = (data) => {
  const { lead, assigneeName, assignerName, note } = data;

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">📋 Lead Assigned to You</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      Hello <strong>${assigneeName}</strong>, a new lead has been assigned to you. Please take prompt action.
    </p>

    ${sectionHead("👤", "Lead Details")}
    ${infoTable(`
      ${infoRow("Lead Name",   `<strong>${lead.name}</strong>`, true)}
      ${infoRow("Phone",       lead.phone)}
      ${infoRow("Alt. Phone",  lead.alternate_phone_number)}
      ${infoRow("Email",       lead.email)}
      ${infoRow("Source",      lead.source)}
      ${infoRow("Status",      badge(lead.status))}
      ${infoRow("Budget",      lead.budget ? `₹${lead.budget}` : null)}
      ${infoRow("Location",    lead.location_preference)}
      ${infoRow("Project",     lead.project_name)}
    `)}

    ${sectionHead("📝", "Assignment Info")}
    ${infoTable(`
      ${infoRow("Assigned By", assignerName)}
      ${infoRow("Date",        new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }))}
      ${note ? infoRow("Note", note) : ""}
    `)}

    <p style="background:#eff6ff;border-left:4px solid ${BRAND.primary};padding:12px 16px;
              border-radius:0 6px 6px 0;font-size:13px;color:${BRAND.dark};margin-top:24px;">
      📞 <strong>Next Step:</strong> Contact <strong>${lead.name}</strong> at <strong>${lead.phone}</strong> within the next few hours.
    </p>
  `;

  return layout({
    title:     `Lead Assigned: ${lead.name} — Nextone Reality`,
    preheader: `New lead assigned to you: ${lead.name} | ${lead.phone}`,
    body,
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 4 — Site Visit Scheduled
// ═══════════════════════════════════════════════════════════════════════════════

const siteVisitScheduledTemplate = (data) => {
  const { lead, project, visit, assignedTo, scheduledBy } = data;

  const visitDate = new Date(visit.visit_date).toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric"
  });

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">🗓️ Site Visit Scheduled</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      A site visit has been booked. Please ensure everything is arranged for a great experience.
    </p>

    <!-- Visit Date Banner -->
    <div style="background:${BRAND.primary};border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
      <div style="color:${BRAND.accent};font-size:12px;font-weight:700;letter-spacing:2px;margin-bottom:6px;">VISIT DATE &amp; TIME</div>
      <div style="color:#fff;font-size:24px;font-weight:800;">${visitDate}</div>
      <div style="color:#cbd5e1;font-size:16px;margin-top:4px;">${visit.visit_time}</div>
      <div style="margin-top:12px;">${badge("scheduled")}</div>
    </div>

    ${sectionHead("👤", "Lead Information")}
    ${infoTable(`
      ${infoRow("Lead Name",  `<strong>${lead.name}</strong>`, true)}
      ${infoRow("Phone",      lead.phone)}
      ${infoRow("Email",      lead.email)}
    `)}

    ${sectionHead("🏗️", "Project")}
    ${infoTable(`
      ${infoRow("Project Name",    project.name, true)}
      ${infoRow("Address",         project.address)}
      ${infoRow("City",            project.city)}
    `)}

    ${sectionHead("📋", "Visit Details")}
    ${infoTable(`
      ${infoRow("Assigned To",       assignedTo)}
      ${infoRow("Scheduled By",      scheduledBy)}
      ${infoRow("Transport",         visit.transport_arranged ? "✅ Arranged" : "❌ Not Arranged")}
      ${visit.notes ? infoRow("Notes", visit.notes) : ""}
    `)}

    <p style="background:#fffbeb;border-left:4px solid ${BRAND.accent};padding:12px 16px;
              border-radius:0 6px 6px 0;font-size:13px;color:${BRAND.dark};margin-top:24px;">
      🌟 <strong>Reminder:</strong> Please confirm with the client 24 hours before the visit and ensure the project site is ready.
    </p>
  `;

  return layout({
    title:     `Site Visit Scheduled — ${lead.name} | Nextone Reality`,
    preheader: `Site visit on ${visitDate} at ${visit.visit_time} for ${lead.name}`,
    body,
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 5 — Site Visit Status Updated
// ═══════════════════════════════════════════════════════════════════════════════

const siteVisitStatusTemplate = (data) => {
  const { lead, project, visit, oldStatus, newStatus, updatedBy, note } = data;

  const visitDate = new Date(visit.visit_date).toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric"
  });

  const STATUS_ACTIONS = {
    done:        { icon: "✅", msg: "The site visit has been completed successfully." },
    cancelled:   { icon: "❌", msg: "The site visit has been cancelled." },
    rescheduled: { icon: "🔄", msg: "The site visit has been rescheduled." },
    no_show:     { icon: "😞", msg: "The client did not show up for the site visit." },
  };

  const action = STATUS_ACTIONS[newStatus] || { icon: "📋", msg: "Site visit status has been updated." };

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">${action.icon} Site Visit ${newStatus.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">${action.msg}</p>

    ${sectionHead("👤", "Lead & Project")}
    ${infoTable(`
      ${infoRow("Lead Name",    `<strong>${lead.name}</strong>`, true)}
      ${infoRow("Phone",        lead.phone)}
      ${infoRow("Project",      project.name)}
      ${infoRow("Visit Date",   visitDate)}
      ${infoRow("Visit Time",   visit.visit_time)}
    `)}

    ${sectionHead("📊", "Status Update")}
    ${infoTable(`
      ${infoRow("Previous Status", badge(oldStatus))}
      ${infoRow("New Status",      badge(newStatus))}
      ${infoRow("Updated By",      updatedBy)}
      ${infoRow("Date & Time",     new Date().toLocaleString("en-IN"))}
      ${note ? infoRow("Note / Reason", note) : ""}
    `)}

    ${newStatus === "done" ? `
    <p style="background:#d1fae5;border-left:4px solid #059669;padding:12px 16px;
              border-radius:0 6px 6px 0;font-size:13px;color:${BRAND.dark};margin-top:24px;">
      📝 <strong>Next Step:</strong> Please submit site visit feedback immediately to keep the pipeline moving.
    </p>
    ` : ""}
  `;

  return layout({
    title:     `Site Visit ${newStatus} — ${lead.name} | Nextone Reality`,
    preheader: `Site visit for ${lead.name} marked as ${newStatus}`,
    body,
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 6 — Follow-up / Task Created
// ═══════════════════════════════════════════════════════════════════════════════

const followUpCreatedTemplate = (data) => {
  const { task, lead, assigneeName, createdBy } = data;

  const dueDate = new Date(task.due_date).toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric"
  });

  const isOverdue = new Date(task.due_date) < new Date();
  const PRIORITY_COLORS = { high: BRAND.danger, medium: BRAND.warning, low: BRAND.success };
  const priorityColor = PRIORITY_COLORS[task.priority] || BRAND.muted;

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">📌 New Follow-Up Task</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      Hello <strong>${assigneeName}</strong>, a follow-up task has been assigned to you.
    </p>

    <!-- Task Card -->
    <div style="background:${BRAND.light};border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px;">
      <div style="font-size:18px;font-weight:700;color:${BRAND.dark};margin-bottom:12px;">
        ${task.title}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <span style="background:${priorityColor}20;color:${priorityColor};padding:3px 10px;
                     border-radius:20px;font-size:12px;font-weight:700;">
          ${task.priority.toUpperCase()} PRIORITY
        </span>
        ${isOverdue ? `<span style="background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">⚠️ OVERDUE</span>` : ""}
      </div>
    </div>

    ${sectionHead("📅", "Task Details")}
    ${infoTable(`
      ${infoRow("Due Date",    `<strong style="color:${isOverdue ? BRAND.danger : BRAND.dark};">${dueDate}</strong>`, true)}
      ${infoRow("Priority",    task.priority.charAt(0).toUpperCase() + task.priority.slice(1))}
      ${infoRow("Created By",  createdBy)}
      ${task.notes ? infoRow("Instructions", task.notes) : ""}
    `)}

    ${sectionHead("👤", "Related Lead")}
    ${infoTable(`
      ${infoRow("Lead Name",  `<strong>${lead.name}</strong>`, true)}
      ${infoRow("Phone",      lead.phone)}
      ${infoRow("Email",      lead.email)}
      ${infoRow("Status",     badge(lead.status))}
      ${infoRow("Project",    lead.project_name)}
    `)}

    <p style="background:${isOverdue ? "#fee2e2" : "#eff6ff"};
              border-left:4px solid ${isOverdue ? BRAND.danger : BRAND.primary};
              padding:12px 16px;border-radius:0 6px 6px 0;font-size:13px;
              color:${BRAND.dark};margin-top:24px;">
      ${isOverdue
        ? `⚠️ <strong>Overdue:</strong> This task was due on ${dueDate}. Please complete it immediately.`
        : `⏰ <strong>Reminder:</strong> Complete this follow-up by <strong>${dueDate}</strong> to keep the lead warm.`}
    </p>
  `;

  return layout({
    title:     `Follow-Up Task: ${task.title} — Nextone Reality`,
    preheader: `New follow-up task for ${lead.name} due ${dueDate}`,
    body,
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 7 — Follow-up / Task Completed
// ═══════════════════════════════════════════════════════════════════════════════

const followUpCompletedTemplate = (data) => {
  const { task, lead, completedBy } = data;

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">✅ Follow-Up Task Completed</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      A follow-up task has been marked as completed.
    </p>

    ${sectionHead("📌", "Task Summary")}
    ${infoTable(`
      ${infoRow("Task",          task.title, true)}
      ${infoRow("Priority",      task.priority)}
      ${infoRow("Completed By",  completedBy)}
      ${infoRow("Completed At",  new Date().toLocaleString("en-IN"))}
    `)}

    ${sectionHead("👤", "Related Lead")}
    ${infoTable(`
      ${infoRow("Lead Name",  `<strong>${lead.name}</strong>`, true)}
      ${infoRow("Phone",      lead.phone)}
      ${infoRow("Status",     badge(lead.status))}
      ${infoRow("Project",    lead.project_name)}
    `)}

    <div style="background:#d1fae5;border-radius:10px;padding:16px;text-align:center;margin-top:24px;">
      <div style="color:#065f46;font-size:14px;font-weight:700;">
        ✔ Task logged. Keep up the great work!
      </div>
    </div>
  `;

  return layout({
    title:     `Task Completed: ${task.title} — Nextone Reality`,
    preheader: `Follow-up task completed for ${lead.name}`,
    body,
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 8 — Site Visit Feedback Submitted
// ═══════════════════════════════════════════════════════════════════════════════

const siteVisitFeedbackTemplate = (data) => {
  const { lead, project, visit, feedback, submittedBy } = data;

  const REACTION_ICONS = {
    very_positive: "🤩", positive: "😊", neutral: "😐",
    negative: "😕", not_interested: "👎",
  };

  const reactionIcon = REACTION_ICONS[feedback.client_reaction] || "📋";

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">📝 Site Visit Feedback</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      Post-visit feedback has been submitted. Here is the summary.
    </p>

    ${sectionHead("👤", "Lead & Visit")}
    ${infoTable(`
      ${infoRow("Lead Name",  `<strong>${lead.name}</strong>`, true)}
      ${infoRow("Phone",      lead.phone)}
      ${infoRow("Project",    project.name)}
      ${infoRow("Visit Date", new Date(visit.visit_date).toLocaleDateString("en-IN"))}
    `)}

    ${sectionHead("💬", "Client Feedback")}
    <div style="background:${BRAND.light};border-radius:10px;padding:20px;margin:16px 0;">
      <div style="font-size:36px;margin-bottom:8px;">${reactionIcon}</div>
      <div style="font-size:16px;font-weight:700;color:${BRAND.dark};margin-bottom:4px;">
        ${feedback.client_reaction.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
      </div>
      ${feedback.rating ? `<div style="color:${BRAND.accent};font-size:13px;">Rating: ${"⭐".repeat(feedback.rating)}</div>` : ""}
    </div>

    ${infoTable(`
      ${infoRow("Interested In", feedback.interested_in)}
      ${infoRow("Next Step",     badge(feedback.next_step))}
      ${feedback.remarks ? infoRow("Remarks", feedback.remarks) : ""}
      ${infoRow("Submitted By",  submittedBy)}
    `)}

    <p style="background:#eff6ff;border-left:4px solid ${BRAND.primary};padding:12px 16px;
              border-radius:0 6px 6px 0;font-size:13px;color:${BRAND.dark};margin-top:24px;">
      ➡️ <strong>Next Action:</strong> ${feedback.next_step.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
      — Update the lead pipeline accordingly.
    </p>
  `;

  return layout({
    title:     `Visit Feedback: ${lead.name} — Nextone Reality`,
    preheader: `Site visit feedback: ${feedback.client_reaction} reaction for ${lead.name}`,
    body,
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT-FACING TEMPLATES  (warm, professional — addressed to the lead/client)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * CLIENT TEMPLATE 1 — Welcome / Lead Registered
 * Sent to the client when their enquiry is first recorded
 */
const clientWelcomeTemplate = (data) => {
  const { lead, assignedTo } = data;

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">
      Welcome to ${BRAND.name}, ${lead.name.split(" ")[0]}! 🏠
    </h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      Thank you for your interest. We are delighted to assist you on your property journey.
    </p>

    <p style="font-size:15px;color:${BRAND.dark};line-height:1.8;">
      Dear <strong>${lead.name}</strong>,
      <br/><br/>
      We have successfully received your enquiry and our team is excited to help you find
      your perfect property. A dedicated relationship manager has been assigned to you and
      will be in touch with you shortly.
    </p>

    ${sectionHead("📋", "Your Enquiry Summary")}
    ${infoTable(`
      ${infoRow("Name",              lead.name, true)}
      ${infoRow("Contact Number",    lead.phone)}
      ${infoRow("Project Interest",  lead.project_name || "To be discussed")}
      ${infoRow("Budget Range",      lead.budget ? `₹${lead.budget}` : "To be discussed")}
      ${infoRow("Preferred Location",lead.location_preference || "To be discussed")}
    `)}

    ${assignedTo ? `
    ${sectionHead("👤", "Your Relationship Manager")}
    <div style="background:${BRAND.light};border-radius:10px;padding:20px;margin:16px 0;
                border-left:4px solid ${BRAND.accent};">
      <div style="font-size:16px;font-weight:700;color:${BRAND.dark};">${assignedTo}</div>
      <div style="font-size:13px;color:${BRAND.muted};margin-top:4px;">${BRAND.name} — Sales Team</div>
      <div style="font-size:13px;color:${BRAND.primary};margin-top:6px;">
        📞 ${BRAND.phone} &nbsp;|&nbsp; ✉ ${BRAND.email}
      </div>
    </div>
    ` : ""}

    <p style="font-size:14px;color:${BRAND.dark};line-height:1.8;margin-top:20px;">
      We will reach out to you very soon to understand your requirements better and
      present the finest property options tailored just for you.
      <br/><br/>
      In the meantime, feel free to reach us at
      <a href="tel:${BRAND.phone}" style="color:${BRAND.accent};text-decoration:none;font-weight:700;">${BRAND.phone}</a>
      or reply to this email.
    </p>

    <div style="background:${BRAND.primary};border-radius:10px;padding:20px;text-align:center;margin-top:28px;">
      <div style="color:${BRAND.accent};font-size:13px;font-weight:700;letter-spacing:1px;">OUR PROMISE TO YOU</div>
      <div style="color:#fff;font-size:14px;margin-top:8px;line-height:1.7;">
        Transparent dealings &nbsp;·&nbsp; Expert guidance &nbsp;·&nbsp; Your best interest, always
      </div>
    </div>
  `;

  return layout({
    title:     `Welcome to ${BRAND.name}`,
    preheader: `Thank you ${lead.name}, your enquiry has been received. We will contact you shortly.`,
    body,
  });
};

/**
 * CLIENT TEMPLATE 2 — Status Update (client-friendly version)
 * Sent when lead status changes — phrased from the client's perspective
 */
const clientStatusUpdateTemplate = (data) => {
  const { lead, newStatus, assignedTo } = data;

  const STATUS_CLIENT_MSG = {
    contacted: {
      heading: "We've Been in Touch! 📞",
      msg: `Our team has reached out to you regarding your property enquiry. We hope the conversation was helpful and informative.`,
    },
    interested: {
      heading: "Great News — We're Moving Forward! 🎉",
      msg: `We are delighted to know you are interested in exploring our properties further. Our team is preparing the best options suited to your requirements.`,
    },
    follow_up: {
      heading: "We Will Follow Up With You Soon 📅",
      msg: `We wanted to let you know that our team will be following up with you shortly. We look forward to answering all your questions and helping you make the right decision.`,
    },
    site_visit_scheduled: {
      heading: "Your Site Visit Has Been Scheduled! 🏗️",
      msg: `We are pleased to inform you that a site visit has been arranged for you. Our team will confirm the details with you before the visit.`,
    },
    site_visit_done: {
      heading: "Thank You for Visiting Our Site! 🙏",
      msg: `We hope your site visit was an informative and enjoyable experience. We would love to hear your thoughts and assist you with the next steps.`,
    },
    negotiation: {
      heading: "You're One Step Closer to Your Dream Home! 🏠",
      msg: `We are actively working on the best possible offer for you. Our team will be in touch very shortly to discuss the details.`,
    },
    booked: {
      heading: "Congratulations on Your Booking! 🎊",
      msg: `We are absolutely thrilled to welcome you to the ${BRAND.name} family! Your booking has been confirmed. Our team will get in touch shortly for the documentation formalities.`,
    },
    lost: null, // We do NOT send email to client for "lost" status
  };

  const content = STATUS_CLIENT_MSG[newStatus];
  if (!content) return null; // Signal to skip sending

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">${content.heading}</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">An update on your property enquiry with ${BRAND.name}</p>

    <p style="font-size:15px;color:${BRAND.dark};line-height:1.8;">
      Dear <strong>${lead.name}</strong>,
      <br/><br/>
      ${content.msg}
    </p>

    ${newStatus === "booked" ? `
    <div style="background:#d1fae5;border:2px solid #a7f3d0;border-radius:12px;
                padding:24px;text-align:center;margin:24px 0;">
      <div style="font-size:40px;margin-bottom:8px;">🏠</div>
      <div style="font-size:20px;font-weight:800;color:#064e3b;">Welcome Home!</div>
      <div style="font-size:14px;color:#065f46;margin-top:8px;">
        You are now a proud member of the ${BRAND.name} family.
      </div>
    </div>
    ` : ""}

    ${assignedTo ? `
    ${sectionHead("👤", "Your Relationship Manager")}
    <div style="background:${BRAND.light};border-radius:10px;padding:16px 20px;
                margin:16px 0;border-left:4px solid ${BRAND.accent};">
      <div style="font-size:15px;font-weight:700;color:${BRAND.dark};">${assignedTo}</div>
      <div style="font-size:13px;color:${BRAND.primary};margin-top:6px;">
        📞 ${BRAND.phone} &nbsp;|&nbsp; ✉ ${BRAND.email}
      </div>
    </div>
    ` : ""}

    <p style="font-size:14px;color:${BRAND.dark};line-height:1.8;margin-top:16px;">
      Should you have any questions at any time, please do not hesitate to reach out to us.
      We are always here to help.
    </p>

    <p style="font-size:14px;color:${BRAND.muted};margin-top:4px;">
      Warm regards,<br/>
      <strong style="color:${BRAND.dark};">The ${BRAND.name} Team</strong>
    </p>
  `;

  return layout({
    title:     `Update from ${BRAND.name}`,
    preheader: `${content.heading} — An update on your property journey with ${BRAND.name}.`,
    body,
  });
};

/**
 * CLIENT TEMPLATE 3 — Site Visit Confirmation
 * Warm confirmation email to the client with visit details
 */
const clientSiteVisitConfirmationTemplate = (data) => {
  const { lead, project, visit, assignedTo } = data;

  const visitDate = new Date(visit.visit_date).toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">
      Your Site Visit is Confirmed! 🗓️
    </h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      We look forward to welcoming you — here are your visit details.
    </p>

    <p style="font-size:15px;color:${BRAND.dark};line-height:1.8;">
      Dear <strong>${lead.name}</strong>,
      <br/><br/>
      We are pleased to confirm your site visit to <strong>${project.name}</strong>.
      Our team is looking forward to giving you a wonderful experience and showing
      you everything this exceptional project has to offer.
    </p>

    <!-- Visit Banner -->
    <div style="background:${BRAND.primary};border-radius:12px;padding:24px;
                text-align:center;margin:24px 0;">
      <div style="color:${BRAND.accent};font-size:11px;font-weight:700;
                  letter-spacing:2px;margin-bottom:8px;">YOUR VISIT DETAILS</div>
      <div style="color:#fff;font-size:22px;font-weight:800;">${visitDate}</div>
      <div style="color:#cbd5e1;font-size:16px;margin-top:6px;">at ${visit.visit_time}</div>
      <div style="color:${BRAND.accent};font-size:15px;font-weight:700;margin-top:10px;">
        📍 ${project.name}${project.city ? `, ${project.city}` : ""}
      </div>
    </div>

    ${project.address ? `
    ${sectionHead("📍", "Project Location")}
    ${infoTable(`
      ${infoRow("Project",  project.name, true)}
      ${infoRow("Address",  project.address)}
      ${infoRow("City",     project.city)}
    `)}
    ` : ""}

    ${visit.transport_arranged ? `
    <div style="background:#d1fae5;border-radius:8px;padding:14px 18px;margin:16px 0;
                display:flex;align-items:center;">
      <span style="font-size:20px;margin-right:10px;">🚗</span>
      <span style="font-size:14px;color:#065f46;font-weight:600;">
        Transportation has been arranged for your visit. Our team will coordinate with you.
      </span>
    </div>
    ` : ""}

    ${assignedTo ? `
    ${sectionHead("👤", "Your Point of Contact")}
    <div style="background:${BRAND.light};border-radius:10px;padding:16px 20px;margin:16px 0;
                border-left:4px solid ${BRAND.accent};">
      <div style="font-size:15px;font-weight:700;color:${BRAND.dark};">${assignedTo}</div>
      <div style="font-size:13px;color:${BRAND.primary};margin-top:6px;">
        📞 ${BRAND.phone}
      </div>
    </div>
    ` : ""}

    ${sectionHead("📝", "What to Expect")}
    <ul style="padding-left:20px;color:${BRAND.dark};font-size:14px;line-height:2;">
      <li>A guided tour of the project site and sample flats</li>
      <li>Detailed presentation of floor plans, amenities, and pricing</li>
      <li>One-on-one consultation to answer all your queries</li>
      <li>Transparent discussion about payment plans and financing options</li>
    </ul>

    <p style="background:#fffbeb;border-left:4px solid ${BRAND.accent};padding:14px 16px;
              border-radius:0 8px 8px 0;font-size:13px;color:${BRAND.dark};margin-top:20px;">
      ⏰ <strong>Kindly note:</strong> Please arrive a few minutes early. If you need to
      reschedule, call us at
      <a href="tel:${BRAND.phone}" style="color:${BRAND.accent};text-decoration:none;">${BRAND.phone}</a>
      at least 24 hours in advance.
    </p>

    <p style="font-size:14px;color:${BRAND.muted};margin-top:24px;">
      We look forward to seeing you!<br/>
      <strong style="color:${BRAND.dark};">The ${BRAND.name} Team</strong>
    </p>
  `;

  return layout({
    title:     `Site Visit Confirmed — ${BRAND.name}`,
    preheader: `Your site visit to ${project.name} is confirmed for ${visitDate} at ${visit.visit_time}.`,
    body,
  });
};

/**
 * CLIENT TEMPLATE 4 — Site Visit Status (done / cancelled / rescheduled / no_show)
 */
const clientSiteVisitStatusTemplate = (data) => {
  const { lead, project, visit, newStatus } = data;

  const visitDate = new Date(visit.visit_date).toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });

  const STATUS_CLIENT = {
    done: {
      heading: "Thank You for Visiting! 🙏",
      msg: `We sincerely hope your visit to <strong>${project.name}</strong> was a delightful experience. It was truly a pleasure hosting you. Our team will be in touch shortly to understand your feedback and assist you with the next steps on your property journey.`,
      closing: "We hope to welcome you home soon!",
    },
    cancelled: {
      heading: "Your Site Visit Has Been Cancelled 📋",
      msg: `We understand that plans can change. Your scheduled visit to <strong>${project.name}</strong> on ${visitDate} has been cancelled as requested. We would love to reschedule at a time convenient for you — simply give us a call and we will arrange everything.`,
      closing: "We look forward to meeting you soon.",
    },
    rescheduled: {
      heading: "Your Site Visit Has Been Rescheduled 🔄",
      msg: `Your visit to <strong>${project.name}</strong> has been rescheduled. Our team will reach out to you shortly to confirm the new date and time. We apologise for any inconvenience and appreciate your understanding.`,
      closing: "We look forward to showing you the project.",
    },
    no_show: {
      heading: "We Missed You Today 😊",
      msg: `We were looking forward to welcoming you at <strong>${project.name}</strong> today but unfortunately could not meet you. We completely understand — life gets busy! Please let us know when you would like to reschedule and we will make it happen.`,
      closing: "We hope to connect with you very soon.",
    },
  };

  const content = STATUS_CLIENT[newStatus];
  if (!content) return null;

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">${content.heading}</h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      Regarding your visit to ${project.name}
    </p>

    <p style="font-size:15px;color:${BRAND.dark};line-height:1.8;">
      Dear <strong>${lead.name}</strong>,
      <br/><br/>
      ${content.msg}
    </p>

    ${sectionHead("📋", "Visit Summary")}
    ${infoTable(`
      ${infoRow("Project",    project.name, true)}
      ${infoRow("Visit Date", visitDate)}
      ${infoRow("Status",     badge(newStatus))}
    `)}

    <div style="background:${BRAND.light};border-radius:10px;padding:16px 20px;margin:24px 0;
                border-left:4px solid ${BRAND.accent};">
      <div style="font-size:13px;font-weight:700;color:${BRAND.dark};margin-bottom:6px;">
        Need assistance?
      </div>
      <div style="font-size:13px;color:${BRAND.muted};line-height:1.7;">
        📞 <a href="tel:${BRAND.phone}" style="color:${BRAND.accent};text-decoration:none;">${BRAND.phone}</a>
        &nbsp;|&nbsp;
        ✉ <a href="mailto:${BRAND.email}" style="color:${BRAND.accent};text-decoration:none;">${BRAND.email}</a>
      </div>
    </div>

    <p style="font-size:14px;color:${BRAND.muted};margin-top:8px;">
      ${content.closing}<br/>
      <strong style="color:${BRAND.dark};">The ${BRAND.name} Team</strong>
    </p>
  `;

  return layout({
    title:     `${content.heading} — ${BRAND.name}`,
    preheader: `Update regarding your site visit to ${project.name} — ${BRAND.name}`,
    body,
  });
};

/**
 * CLIENT TEMPLATE 5 — Follow-Up Reminder
 * Friendly heads-up to the client that the team will be following up
 */
const clientFollowUpTemplate = (data) => {
  const { lead, task, assignedTo } = data;

  const dueDate = new Date(task.due_date).toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">
      We Will Be in Touch Soon! 📞
    </h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      A quick note from the ${BRAND.name} team
    </p>

    <p style="font-size:15px;color:${BRAND.dark};line-height:1.8;">
      Dear <strong>${lead.name}</strong>,
      <br/><br/>
      We hope this message finds you well. We wanted to let you know that
      our team has scheduled a follow-up with you and will be reaching out
      to you by <strong>${dueDate}</strong>.
      <br/><br/>
      We are committed to helping you find the perfect property and want to
      ensure you have all the information and support you need to make the
      best decision.
    </p>

    ${sectionHead("🏡", "Your Enquiry")}
    ${infoTable(`
      ${infoRow("Project Interest", lead.project_name || "To be discussed", true)}
      ${infoRow("Budget Range",     lead.budget ? `₹${lead.budget}` : "To be discussed")}
      ${infoRow("Location",         lead.location_preference || "To be discussed")}
    `)}

    ${assignedTo ? `
    ${sectionHead("👤", "Your Relationship Manager")}
    <div style="background:${BRAND.light};border-radius:10px;padding:16px 20px;margin:16px 0;
                border-left:4px solid ${BRAND.accent};">
      <div style="font-size:15px;font-weight:700;color:${BRAND.dark};">${assignedTo}</div>
      <div style="font-size:13px;color:${BRAND.primary};margin-top:6px;">
        📞 ${BRAND.phone} &nbsp;|&nbsp; ✉ ${BRAND.email}
      </div>
    </div>
    ` : ""}

    <p style="background:#eff6ff;border-left:4px solid ${BRAND.primary};padding:14px 16px;
              border-radius:0 8px 8px 0;font-size:13px;color:${BRAND.dark};margin-top:20px;">
      💡 <strong>Can't wait?</strong> Feel free to reach us directly at
      <a href="tel:${BRAND.phone}" style="color:${BRAND.accent};text-decoration:none;font-weight:700;">${BRAND.phone}</a>
      — we are always happy to assist.
    </p>

    <p style="font-size:14px;color:${BRAND.muted};margin-top:24px;">
      Warm regards,<br/>
      <strong style="color:${BRAND.dark};">The ${BRAND.name} Team</strong>
    </p>
  `;

  return layout({
    title:     `We Will Be in Touch — ${BRAND.name}`,
    preheader: `Our team will be following up with you by ${dueDate}. — ${BRAND.name}`,
    body,
  });
};

/**
 * CLIENT TEMPLATE 6 — Follow-Up Completed (Post-call thank you)
 * Sent after a follow-up task is marked done — acknowledges the interaction
 */
const clientFollowUpDoneTemplate = (data) => {
  const { lead, assignedTo } = data;

  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${BRAND.primary};">
      Thank You for Speaking with Us! 🤝
    </h2>
    <p style="margin:0 0 20px;color:${BRAND.muted};font-size:14px;">
      We appreciate your time and trust in ${BRAND.name}
    </p>

    <p style="font-size:15px;color:${BRAND.dark};line-height:1.8;">
      Dear <strong>${lead.name}</strong>,
      <br/><br/>
      Thank you for taking the time to connect with our team. We value your
      interest in ${BRAND.name} and remain fully committed to helping you
      find your ideal property.
      <br/><br/>
      Our team will continue to support you at every step of your journey.
      Should you have any questions, require more information, or wish to
      schedule a site visit, please do not hesitate to get in touch.
    </p>

    ${assignedTo ? `
    ${sectionHead("👤", "Your Dedicated Manager")}
    <div style="background:${BRAND.light};border-radius:10px;padding:16px 20px;margin:16px 0;
                border-left:4px solid ${BRAND.accent};">
      <div style="font-size:15px;font-weight:700;color:${BRAND.dark};">${assignedTo}</div>
      <div style="font-size:13px;color:${BRAND.primary};margin-top:6px;">
        📞 ${BRAND.phone} &nbsp;|&nbsp; ✉ ${BRAND.email}
      </div>
    </div>
    ` : ""}

    <div style="background:${BRAND.primary};border-radius:10px;padding:20px;
                text-align:center;margin-top:28px;">
      <div style="color:${BRAND.accent};font-size:13px;font-weight:700;letter-spacing:1px;
                  margin-bottom:8px;">WE ARE WITH YOU EVERY STEP OF THE WAY</div>
      <div style="color:#fff;font-size:14px;line-height:1.7;">
        Your dream home is closer than you think. We are here to make it a reality.
      </div>
    </div>

    <p style="font-size:14px;color:${BRAND.muted};margin-top:24px;">
      With warm regards,<br/>
      <strong style="color:${BRAND.dark};">The ${BRAND.name} Team</strong>
    </p>
  `;

  return layout({
    title:     `Thank You — ${BRAND.name}`,
    preheader: `Thank you for connecting with ${BRAND.name}. We look forward to helping you find your dream home.`,
    body,
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEND HELPER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * sendEmail — core mailer
 * @param {string|string[]} to
 * @param {string} subject
 * @param {string} html
 */
const sendEmail = async (to, subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("[EmailService] EMAIL_USER or EMAIL_PASS not set — skipping email.");
    return;
  }

  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (recipients.length === 0) {
    console.warn("[EmailService] No valid recipients — skipping email.");
    return;
  }

  try {
    const info = await transporter.sendMail({
      from:    `"${BRAND.name}" <${process.env.EMAIL_USER}>`,
      to:      recipients.join(", "),
      subject: `[${BRAND.name}] ${subject}`,
      html,
    });
    console.log(`[EmailService] Sent "${subject}" → ${recipients.join(", ")} (${info.messageId})`);
  } catch (err) {
    // Log but never crash the API
    console.error(`[EmailService] Failed to send "${subject}":`, err.message);
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────
// Each function sends TWO emails in parallel (Promise.all):
//   1. Internal email  → staff (existing template, operational detail)
//   2. Client email    → lead's email (warm, professional, client-facing template)
//
// Client email is silently skipped if lead.email is null/empty.
// "lost" status never emails the client — that would be poor UX.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  /**
   * Called after a lead is created in DB
   * Internal: New Lead Created  |  Client: Welcome email
   */
  notifyLeadCreated: async (data) => {
    const { lead, assigneeEmail, adminEmails = [] } = data;

    const internalHtml = leadCreatedTemplate(data);
    const internalTo   = [assigneeEmail, ...adminEmails].filter(Boolean);

    const clientHtml   = clientWelcomeTemplate(data);

    await Promise.all([
      sendEmail(internalTo, `New Lead: ${lead.name}`, internalHtml),
      lead.email
        ? sendEmail(lead.email, `Welcome to ${BRAND.name} — We're Here to Help!`, clientHtml)
        : Promise.resolve(),
    ]);
  },

  /**
   * Called after lead status is updated in DB
   * Internal: Status Updated  |  Client: Friendly status update (skipped for "lost")
   */
  notifyLeadStatusChanged: async (data) => {
    const { lead, newStatus, assigneeEmail, adminEmails = [] } = data;

    const internalHtml = leadStatusChangedTemplate(data);
    const internalTo   = [assigneeEmail, ...adminEmails].filter(Boolean);

    const clientHtml   = clientStatusUpdateTemplate(data); // returns null for "lost"

    await Promise.all([
      sendEmail(internalTo, `Lead Status Updated: ${lead.name} → ${newStatus.replace(/_/g, " ")}`, internalHtml),
      lead.email && clientHtml
        ? sendEmail(lead.email, `An Update on Your Property Enquiry — ${BRAND.name}`, clientHtml)
        : Promise.resolve(),
    ]);
  },

  /**
   * Called after a lead is assigned
   * Internal: Assigned to executive  |  Client: No separate email (welcome already sent)
   * Note: If this is a RE-assignment, we still don't email the client — avoids confusion.
   */
  notifyLeadAssigned: async (data) => {
    const { lead, assigneeEmail } = data;
    const html = leadAssignedTemplate(data);
    await sendEmail(assigneeEmail, `Lead Assigned to You: ${lead.name}`, html);
    // No client email for assignment — the welcome email (notifyLeadCreated) already covers it.
  },

  /**
   * Called after a site visit is created in DB
   * Internal: Visit Scheduled (ops detail)  |  Client: Confirmation with visit info
   */
  notifySiteVisitScheduled: async (data) => {
    const { lead, assigneeEmail, adminEmails = [] } = data;

    const internalHtml = siteVisitScheduledTemplate(data);
    const internalTo   = [assigneeEmail, ...adminEmails].filter(Boolean);

    const clientHtml   = clientSiteVisitConfirmationTemplate(data);

    await Promise.all([
      sendEmail(internalTo, `Site Visit Scheduled: ${lead.name}`, internalHtml),
      lead.email
        ? sendEmail(lead.email, `Your Site Visit is Confirmed — ${BRAND.name}`, clientHtml)
        : Promise.resolve(),
    ]);
  },

  /**
   * Called after site visit status is changed in DB
   * Internal: Status change detail  |  Client: Friendly update (done/cancelled/rescheduled/no_show)
   */
  notifySiteVisitStatusChanged: async (data) => {
    const { lead, newStatus, assigneeEmail, adminEmails = [] } = data;

    const internalHtml = siteVisitStatusTemplate(data);
    const internalTo   = [assigneeEmail, ...adminEmails].filter(Boolean);

    const clientHtml   = clientSiteVisitStatusTemplate(data); // returns null for unsupported statuses

    await Promise.all([
      sendEmail(internalTo, `Site Visit ${newStatus.replace(/_/g, " ")}: ${lead.name}`, internalHtml),
      lead.email && clientHtml
        ? sendEmail(lead.email, `Update on Your Site Visit — ${BRAND.name}`, clientHtml)
        : Promise.resolve(),
    ]);
  },

  /**
   * Called after a follow-up task is created in DB
   * Internal: Task details for assignee  |  Client: "We'll follow up soon" heads-up
   */
  notifyFollowUpCreated: async (data) => {
    const { task, lead, assigneeEmail } = data;

    const internalHtml = followUpCreatedTemplate(data);
    const clientHtml   = clientFollowUpTemplate(data);

    await Promise.all([
      sendEmail(assigneeEmail, `Follow-Up Task: ${task.title} for ${lead.name}`, internalHtml),
      lead.email
        ? sendEmail(lead.email, `We Will Be in Touch Soon — ${BRAND.name}`, clientHtml)
        : Promise.resolve(),
    ]);
  },

  /**
   * Called after a follow-up task is completed in DB
   * Internal: Completion summary for managers  |  Client: Thank you / post-call note
   */
  notifyFollowUpCompleted: async (data) => {
    const { task, lead, managerEmails = [] } = data;

    const internalHtml = followUpCompletedTemplate(data);
    const clientHtml   = clientFollowUpDoneTemplate(data);

    await Promise.all([
      sendEmail(managerEmails, `Task Completed: ${task.title} — ${lead.name}`, internalHtml),
      lead.email
        ? sendEmail(lead.email, `Thank You for Connecting with ${BRAND.name}`, clientHtml)
        : Promise.resolve(),
    ]);
  },

  /**
   * Called after site visit feedback is submitted in DB
   * Internal: Feedback details for managers  |  No client email (internal-only data)
   */
  notifySiteVisitFeedback: async (data) => {
    const { lead, managerEmails = [] } = data;
    const html = siteVisitFeedbackTemplate(data);
    // Feedback is internal CRM data — we don't share ratings/reactions with the client
    await sendEmail(managerEmails, `Visit Feedback Submitted: ${lead.name}`, html);
  },
};
