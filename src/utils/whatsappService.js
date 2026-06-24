/**
 * whatsappService.js — Next One Realty CRM
 *
 * Sends WhatsApp messages via Meta's Cloud API (HTTPS — no npm package needed).
 * Free tier: 1,000 conversations/month.
 *
 * Required env vars (add to Render):
 *   WHATSAPP_TOKEN     — permanent system user token from Meta Business
 *   WHATSAPP_PHONE_ID  — Phone Number ID from WhatsApp dashboard (not the number)
 *
 * Template names (must be approved in Meta Business Manager):
 *   site_visit_confirmation     — on site visit creation
 *   site_visit_reminder_1day    — sent 1 day before visit
 *   site_visit_reminder_today   — sent morning of visit day
 *   lead_welcome                — on lead creation
 *   lead_status_interested      — lead status → interested
 *   lead_status_negotiation     — lead status → negotiation
 *   lead_project_details        — "send project details" action (mirrors the email version)
 *   revisit_confirmation        — on re-visit creation
 *   revisit_reminder_1day       — sent 1 day before re-visit
 *   revisit_reminder_2hour      — sent 2 hours before re-visit
 *   booking_confirmed           — on closure created (status confirmed)
 *   booking_cancelled           — closure status → cancelled or on_hold
 *   followup_scheduled          — on follow-up task creation (client-facing)
 */

const https = require('https');

const TOKEN    = (process.env.WHATSAPP_TOKEN    || '').trim();
const PHONE_ID = (process.env.WHATSAPP_PHONE_ID || '').trim();
const API_VER  = 'v19.0';

// ── Startup check ─────────────────────────────────────────────────────────────
if (!TOKEN || !PHONE_ID) {
  console.warn('[WhatsApp] ⚠ WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set — WA messages disabled');
} else {
  console.log('[WhatsApp] ✅ Configured — Phone ID:', PHONE_ID);
}

// ── Clean phone number → E.164 format (+91XXXXXXXXXX) ─────────────────────────
const cleanPhone = (phone) => {
  if (!phone) return null;
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');
  // If 10 digits, prepend India country code
  if (digits.length === 10) digits = '91' + digits;
  // If 11 digits starting with 0, replace leading 0 with 91
  if (digits.length === 11 && digits.startsWith('0')) digits = '91' + digits.slice(1);
  // Must be 12 digits for Indian numbers
  if (digits.length < 10 || digits.length > 15) return null;
  return digits; // Return without + (WhatsApp API expects digits only)
};

// ── Core API call ─────────────────────────────────────────────────────────────
const callWhatsAppAPI = (payload) => new Promise((resolve, reject) => {
  if (!TOKEN || !PHONE_ID) {
    console.warn('[WhatsApp] Skipped — credentials not set');
    return resolve(null);
  }

  const body = JSON.stringify(payload);
  const options = {
    hostname: 'graph.facebook.com',
    port:     443,
    path:     `/${API_VER}/${PHONE_ID}/messages`,
    method:   'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[WhatsApp] ✉ Sent to', payload.to, '| MsgId:', parsed.messages?.[0]?.id);
          resolve(parsed);
        } else {
          const errMsg = parsed.error?.message || data;
          console.error('[WhatsApp] ✗ API error', res.statusCode, '→', errMsg);
          reject(new Error(`WhatsApp API ${res.statusCode}: ${errMsg}`));
        }
      } catch (e) {
        reject(new Error(`WhatsApp parse error: ${e.message}`));
      }
    });
  });

  req.on('error', (e) => {
    console.error('[WhatsApp] ✗ Request failed:', e.message);
    reject(e);
  });

  req.write(body);
  req.end();
});

// ── Send template message ─────────────────────────────────────────────────────
// parameters: array of strings matching {{1}}, {{2}}, etc. in your template
const sendTemplate = async ({ phone, templateName, parameters = [], language = 'en' }) => {
  const to = cleanPhone(phone);
  if (!to) {
    console.warn('[WhatsApp] Invalid phone number:', phone);
    return null;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name:     templateName,
      language: { code: language },
      components: parameters.length > 0 ? [{
        type:       'body',
        parameters: parameters.map(p => ({ type: 'text', text: String(p) })),
      }] : [],
    },
  };

  return callWhatsAppAPI(payload);
};

// ── Format date for WhatsApp message ─────────────────────────────────────────
const fmtDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};

const fmtTime = (timeStr) => {
  if (!timeStr) return '—';
  // timeStr may be "14:30" or "14:30:00"
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${displayHour}:${m} ${suffix}`;
};

// ── Format currency for WhatsApp message (Indian numbering: ₹12,34,567) ──────
const fmtCurrency = (amount) => {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = Number(amount);
  if (Number.isNaN(n)) return null;
  return `₹${n.toLocaleString('en-IN')}`;
};

// ════════════════════════════════════════════════════════════════════════════
// 1. SITE VISIT CONFIRMATION — send when visit is created
//
// Template: site_visit_confirmation
// Body: "Your site visit is confirmed! 🏠\nName: {{1}}\nProject: {{2}}\nDate: {{3}}\nTime: {{4}}\n..."
// ════════════════════════════════════════════════════════════════════════════
const sendSiteVisitConfirmation = async ({ leadName, leadPhone, projectName, visitDate, visitTime }) => {
  console.log('[WhatsApp] Sending site visit confirmation to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'site_visit_confirmation',
    parameters:   [
      leadName,
      projectName,
      fmtDate(visitDate),
      fmtTime(visitTime),
    ],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 2. REMINDER — 1 day before visit
//
// Template: site_visit_reminder_1day
// Body: "Reminder: Your site visit is tomorrow! 🗓️\nProject: {{1}}\nDate: {{2}}\nTime: {{3}}\n..."
// ════════════════════════════════════════════════════════════════════════════
const sendSiteVisitReminder1Day = async ({ leadName, leadPhone, projectName, visitDate, visitTime }) => {
  console.log('[WhatsApp] Sending 1-day reminder to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'site_visit_reminder_1day',
    parameters:   [
      projectName,
      fmtDate(visitDate),
      fmtTime(visitTime),
    ],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 3. REMINDER — morning of visit day
//
// Template: site_visit_reminder_today
// Body: "Your site visit is today! ⏰\nProject: {{1}}\nTime: {{2}}\n..."
// ════════════════════════════════════════════════════════════════════════════
const sendSiteVisitReminderToday = async ({ leadName, leadPhone, projectName, visitDate, visitTime }) => {
  console.log('[WhatsApp] Sending day-of reminder to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'site_visit_reminder_today',
    parameters:   [
      projectName,
      fmtTime(visitTime),
    ],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 4. LEAD — Welcome message (on lead creation)
//
// Template: lead_welcome
// Body: "Hi {{1}}, thank you for your interest in Next One Realty! 🏠\nOur team will reach out to you shortly regarding {{2}}."
// ════════════════════════════════════════════════════════════════════════════
const sendLeadWelcome = async ({ leadName, leadPhone, projectName }) => {
  console.log('[WhatsApp] Sending lead welcome to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'lead_welcome',
    parameters:   [leadName, projectName || 'our projects'],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 5. LEAD — Status changed to "Interested"
//
// Template: lead_status_interested
// Body: "Hi {{1}}, great to know you're interested in {{2}}! Our team will share more details with you shortly."
// ════════════════════════════════════════════════════════════════════════════
const sendLeadStatusInterested = async ({ leadName, leadPhone, projectName }) => {
  console.log('[WhatsApp] Sending "interested" status update to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'lead_status_interested',
    parameters:   [leadName, projectName || 'the project'],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 6. LEAD — Status changed to "Negotiation"
//
// Template: lead_status_negotiation
// Body: "Hi {{1}}, your discussion for {{2}} has moved to the negotiation stage. Our team will be in touch shortly to finalize details."
// ════════════════════════════════════════════════════════════════════════════
const sendLeadStatusNegotiation = async ({ leadName, leadPhone, projectName }) => {
  console.log('[WhatsApp] Sending "negotiation" status update to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'lead_status_negotiation',
    parameters:   [leadName, projectName || 'the project'],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 7. LEAD — Project details (mirrors the existing project-details EMAIL)
//
// Template: lead_project_details
// Body: "Hi {{1}}, thank you for your interest in Next One Realty.\nWe'd love to share details about {{2}} in {{3}}.\nPrice Range: {{4}}\nOur team will be in touch with you shortly."
// ════════════════════════════════════════════════════════════════════════════
const sendLeadProjectDetailsWhatsapp = async ({ leadName, leadPhone, projectName, projectCity, priceRange }) => {
  console.log('[WhatsApp] Sending project details to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'lead_project_details',
    parameters:   [
      leadName,
      projectName || 'our project',
      projectCity || '',
      priceRange  || 'Contact us for pricing',
    ],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 8. RE-VISIT — Confirmation (on re-visit creation)
//
// Template: revisit_confirmation
// Body: "Hi {{1}}, your re-visit is confirmed! 🏠\nProject: {{2}}\nDate: {{3}}\nTime: {{4}}"
// ════════════════════════════════════════════════════════════════════════════
const sendRevisitConfirmation = async ({ leadName, leadPhone, projectName, visitDate, visitTime }) => {
  console.log('[WhatsApp] Sending re-visit confirmation to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'revisit_confirmation',
    parameters:   [leadName, projectName, fmtDate(visitDate), fmtTime(visitTime)],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 9. RE-VISIT — 1 day before reminder
//
// Template: revisit_reminder_1day
// Body: "Reminder: Your re-visit is tomorrow! 🗓️\nProject: {{1}}\nDate: {{2}}\nTime: {{3}}"
// ════════════════════════════════════════════════════════════════════════════
const sendRevisitReminder1Day = async ({ leadPhone, projectName, visitDate, visitTime }) => {
  console.log('[WhatsApp] Sending re-visit 1-day reminder to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'revisit_reminder_1day',
    parameters:   [projectName, fmtDate(visitDate), fmtTime(visitTime)],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 10. RE-VISIT — 2 hours before reminder
//
// Template: revisit_reminder_2hour
// Body: "Reminder: Your re-visit is in 2 hours! ⏰\nProject: {{1}}\nTime: {{2}}"
// ════════════════════════════════════════════════════════════════════════════
const sendRevisitReminder2Hour = async ({ leadPhone, projectName, visitTime }) => {
  console.log('[WhatsApp] Sending re-visit 2-hour reminder to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'revisit_reminder_2hour',
    parameters:   [projectName, fmtTime(visitTime)],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 11. CLOSURE — Booking confirmed
//
// Template: booking_confirmed
// Body: "Congratulations {{1}}! 🎉\nYour booking for {{2}} at {{3}} is confirmed.\nUnit: {{4}}\nBooking Date: {{5}}"
// ════════════════════════════════════════════════════════════════════════════
const sendBookingConfirmed = async ({ leadName, leadPhone, projectName, unitDesc, bookingDate }) => {
  console.log('[WhatsApp] Sending booking confirmation to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'booking_confirmed',
    parameters:   [
      leadName,
      'your unit',
      projectName || 'the project',
      unitDesc    || 'TBD',
      fmtDate(bookingDate),
    ],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 12. CLOSURE — Booking cancelled / on-hold
//
// Template: booking_cancelled
// Body: "Hi {{1}}, your booking for {{2}} has been marked as {{3}}. Please contact us for more details."
// ════════════════════════════════════════════════════════════════════════════
const sendBookingCancelled = async ({ leadName, leadPhone, projectName, newStatus }) => {
  console.log('[WhatsApp] Sending booking status update to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'booking_cancelled',
    parameters:   [
      leadName,
      projectName || 'your booking',
      newStatus === 'on_hold' ? 'on hold' : 'cancelled',
    ],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 13. FOLLOW-UP — Scheduled (client-facing — "we'll be in touch")
//
// Template: followup_scheduled
// Body: "Hi {{1}}, we'll be reaching out to you shortly regarding {{2}}. Thank you for your patience!"
// ════════════════════════════════════════════════════════════════════════════
const sendFollowUpScheduled = async ({ leadName, leadPhone, projectName }) => {
  console.log('[WhatsApp] Sending follow-up scheduled message to', leadPhone);
  return sendTemplate({
    phone:        leadPhone,
    templateName: 'followup_scheduled',
    parameters:   [leadName, projectName || 'your enquiry'],
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 14. DOCUMENT — Send a document (PDF, image, etc.) via WhatsApp
//
// Uses the WhatsApp Cloud API "document" message type with a public link.
// ════════════════════════════════════════════════════════════════════════════
const sendDocument = async ({ phone, documentLink, fileName, caption }) => {
  const to = cleanPhone(phone);
  if (!to) {
    console.warn('[WhatsApp] Invalid phone number:', phone);
    return null;
  }

  console.log('[WhatsApp] Sending document to', phone, '| File:', fileName);
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: {
      link:     documentLink,
      filename: fileName,
    },
  };
  if (caption) payload.document.caption = caption;

  return callWhatsAppAPI(payload);
};

module.exports = {
  sendSiteVisitConfirmation,
  sendSiteVisitReminder1Day,
  sendSiteVisitReminderToday,
  sendLeadWelcome,
  sendLeadStatusInterested,
  sendLeadStatusNegotiation,
  sendLeadProjectDetailsWhatsapp,
  sendRevisitConfirmation,
  sendRevisitReminder1Day,
  sendRevisitReminder2Hour,
  sendBookingConfirmed,
  sendBookingCancelled,
  sendFollowUpScheduled,
  sendDocument,
  sendTemplate,   // export for custom use
  cleanPhone,
  fmtCurrency,
};