/**
 * whatsappWebhookRoutes.js — Next One Realty CRM
 * PUBLIC — no auth. Mounted at /api/v1/webhooks/whatsapp.
 */

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/whatsappWebhookController");

/**
 * @swagger
 * tags:
 *   name: WhatsApp Webhook
 *   description: >
 *     Meta WhatsApp Cloud API webhook — PUBLIC, called by Meta's servers
 *     directly, not by the frontend. Protected by a verify token instead of
 *     a Bearer token (WHATSAPP_WEBHOOK_VERIFY_TOKEN env var).
 */

/**
 * @swagger
 * /api/v1/webhooks/whatsapp:
 *   get:
 *     summary: Webhook verification handshake (called once by Meta)
 *     description: >
 *       Paste this URL as the Callback URL in Meta's dashboard
 *       (WhatsApp > Configuration > Webhooks), along with the value of
 *       WHATSAPP_WEBHOOK_VERIFY_TOKEN as the Verify Token. Meta calls this
 *       with hub.mode=subscribe, hub.verify_token, and hub.challenge when
 *       you click "Verify and save" — this echoes hub.challenge back if the
 *       token matches.
 *     tags: [WhatsApp Webhook]
 *     parameters:
 *       - { in: query, name: hub.mode,          schema: { type: string } }
 *       - { in: query, name: hub.verify_token,  schema: { type: string } }
 *       - { in: query, name: hub.challenge,     schema: { type: string } }
 *     responses:
 *       200:
 *         description: Verified — returns hub.challenge as plain text
 *       403:
 *         description: Token mismatch
 */
router.get("/", ctrl.verifyWebhook);

/**
 * @swagger
 * /api/v1/webhooks/whatsapp:
 *   post:
 *     summary: Receive WhatsApp events (incoming messages, delivery/read status)
 *     description: >
 *       Called by Meta for every incoming customer message and every
 *       delivery/read status update for messages this app sent. Always
 *       responds 200 immediately; incoming messages are logged and trigger
 *       an admin notification.
 *     tags: [WhatsApp Webhook]
 *     responses:
 *       200:
 *         description: Acknowledged
 */
router.post("/", ctrl.receiveWebhook);

module.exports = router;
