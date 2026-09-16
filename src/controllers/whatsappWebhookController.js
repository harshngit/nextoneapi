/**
 * whatsappWebhookController.js — Next One Realty CRM
 *
 * Receives Meta's WhatsApp Cloud API webhook callbacks — both the one-time
 * verification handshake (GET) and live event delivery (POST): incoming
 * customer messages, and delivery/read status updates for messages this
 * app sent via whatsappService.js.
 *
 * PUBLIC — no auth. Meta calls this directly; there's no user session.
 * Protected instead by the verify token below, which only Meta and whoever
 * configured the webhook in the Meta dashboard know.
 */

const { notifyAdmins } = require("./notificationController");

const VERIFY_TOKEN = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();

// ─── GET /api/v1/webhooks/whatsapp — verification handshake ───────────────────
// Meta calls this once when you click "Verify and save" in the dashboard.
// Must echo back hub.challenge as plain text if the mode/token match.
const verifyWebhook = (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    console.log("[WhatsApp Webhook] Verified successfully");
    return res.status(200).send(challenge);
  }

  console.warn("[WhatsApp Webhook] Verification failed — token mismatch");
  return res.sendStatus(403);
};

// ─── POST /api/v1/webhooks/whatsapp — incoming events ──────────────────────────
// Must respond 200 quickly (Meta retries/disables the webhook on repeated
// failures or timeouts) — all handling below is fire-and-forget after that.
const receiveWebhook = (req, res) => {
  try {
    res.sendStatus(200); // ack first, always — before any processing

    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        // Incoming customer messages
        for (const msg of value.messages || []) {
          const contact = (value.contacts || []).find(c => c.wa_id === msg.from);
          handleIncomingMessage({
            from:      msg.from,
            name:      contact?.profile?.name || null,
            type:      msg.type,
            text:      msg.text?.body || (msg.type !== "text" ? `[${msg.type} message]` : null),
            timestamp: msg.timestamp,
          }).catch(err => console.error("[WhatsApp Webhook] handleIncomingMessage failed:", err.message));
        }

        // Delivery/read status updates for messages this app sent
        for (const status of value.statuses || []) {
          console.log(`[WhatsApp Webhook] Status update — message ${status.id} to ${status.recipient_id}: ${status.status}`);
        }
      }
    }
  } catch (err) {
    // Response is already sent — just log, nothing left to do for the caller.
    console.error("[WhatsApp Webhook] Processing error:", err.message);
  }
};

// Logs the incoming message and notifies admins. Deliberately NOT
// auto-creating a lead/website-inquiry here yet — replying to/handling the
// message is a manual step for now; ping the team so someone picks it up.
const handleIncomingMessage = async ({ from, name, type, text }) => {
  console.log(`[WhatsApp Webhook] Message from ${name || "Unknown"} (${from}) [${type}]: ${text}`);

  await notifyAdmins({
    type: "general",
    title: "New WhatsApp Message",
    message: `${name || from} sent: "${text}"`,
    reference_id: null,
    reference_type: "whatsapp_message",
    metadata: { from, name, type, text },
  });
};

module.exports = { verifyWebhook, receiveWebhook };
