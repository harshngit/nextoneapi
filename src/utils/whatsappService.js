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
 *   site_visit_confirmation   — on site visit creation
 *   site_visit_reminder_1day  — sent 1 day before visit
 *   site_visit_reminder_today — sent morning of visit day
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

module.exports = {
  sendSiteVisitConfirmation,
  sendSiteVisitReminder1Day,
  sendSiteVisitReminderToday,
  sendTemplate,   // export for custom use
  cleanPhone,
};
