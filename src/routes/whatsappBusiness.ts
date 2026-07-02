// WhatsApp Business Cloud API Routes
// Webhook endpoints are public (Meta must reach them), all others require API key auth.
import express from 'express';
import { whatsappBusinessService } from '../services/whatsappBusinessService.js';
import { eventService } from '../services/eventService.js';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// ──────────────────────────────────────────────
// WEBHOOK ENDPOINTS (public — no API key auth)
// ──────────────────────────────────────────────

/**
 * GET /webhook — Meta verification challenge.
 * Meta sends: hub.mode, hub.verify_token, hub.challenge
 * We respond with hub.challenge if the verify_token matches ours.
 */
router.get('/webhook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe' || !token || !challenge) {
    return res.status(400).send('Missing parameters');
  }

  try {
    const config = await whatsappBusinessService.getConfig();
    if (!config.webhookVerifyToken) {
      console.warn('[WA Business Webhook] No verify token configured in settings.');
      return res.status(403).send('Verify token not configured');
    }

    if (token === config.webhookVerifyToken) {
      console.log('[WA Business Webhook] Verification successful');
      return res.status(200).send(challenge);
    } else {
      console.warn('[WA Business Webhook] Verify token mismatch');
      return res.status(403).send('Verification failed');
    }
  } catch (err) {
    console.error('[WA Business Webhook] Verification error:', err);
    return res.status(500).send('Internal error');
  }
});

/**
 * POST /webhook — Receive incoming messages and status updates from Meta.
 * We log them and broadcast via SSE for real-time UI updates.
 */
router.post('/webhook', async (req, res) => {
  // Always respond 200 quickly to Meta (they retry on non-2xx)
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body || body.object !== 'whatsapp_business_account') {
      return;
    }

    const entries = body.entry;
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      const changes = entry.changes;
      if (!Array.isArray(changes)) continue;

      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        if (!value) continue;

        // Handle incoming messages
        const messages = value.messages;
        if (Array.isArray(messages)) {
          for (const msg of messages) {
            const from = msg.from; // sender phone number
            const msgType = msg.type; // text, image, document, etc.
            const timestamp = msg.timestamp;

            let messageBody = '';
            if (msgType === 'text' && msg.text?.body) {
              messageBody = msg.text.body;
            } else if (msgType === 'image' || msgType === 'document' || msgType === 'audio' || msgType === 'video') {
              messageBody = `[${msgType}] ${msg[msgType]?.caption || '(no caption)'}`;
            } else {
              messageBody = `[${msgType}] (unsupported type)`;
            }

            console.log(`[WA Business] Incoming message from ${from}: ${messageBody.substring(0, 100)}`);

            // Log to action_logs
            try {
              const db = await dbManager.getConnection();
              await db.run(
                `INSERT INTO action_logs (action_type, description) VALUES (?, ?)`,
                ['WA_BUSINESS_INCOMING', `From: ${from} | Type: ${msgType} | Body: ${messageBody.substring(0, 500)}`]
              );
                          } catch (dbErr) {
              console.error('[WA Business Webhook] DB log error:', dbErr);
            }

            // Broadcast via SSE for real-time UI
            eventService.broadcast('wa_business_message', {
              from,
              type: msgType,
              body: messageBody,
              timestamp,
            });
          }
        }

        // Handle message status updates (sent, delivered, read)
        const statuses = value.statuses;
        if (Array.isArray(statuses)) {
          for (const status of statuses) {
            console.log(`[WA Business] Message ${status.id} → ${status.status} (to: ${status.recipient_id})`);
          }
        }
      }
    }
  } catch (err) {
    console.error('[WA Business Webhook] Processing error:', err);
  }
});

// ──────────────────────────────────────────────
// AUTHENTICATED ENDPOINTS (require API key)
// ──────────────────────────────────────────────

/**
 * POST /send — Send a text message via WhatsApp Business API.
 * Body: { number: string, message: string }
 */
router.post('/send', async (req, res) => {
  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ error: 'number and message are required' });
  }

  try {
    const result = await whatsappBusinessService.sendTextMessage(number, message);
    if (result.success) {
      res.json({ success: true, messageId: result.messageId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err: any) {
    console.error('[WA Business] Send error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * POST /send-template — Send a template message via WhatsApp Business API.
 * Body: { number: string, template_name: string, language?: string, components?: any[] }
 */
router.post('/send-template', async (req, res) => {
  const { number, template_name, language, components } = req.body;
  if (!number || !template_name) {
    return res.status(400).json({ error: 'number and template_name are required' });
  }

  try {
    const result = await whatsappBusinessService.sendTemplateMessage(
      number,
      template_name,
      language || 'en_US',
      components
    );
    if (result.success) {
      res.json({ success: true, messageId: result.messageId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err: any) {
    console.error('[WA Business] Send template error:', err);
    res.status(500).json({ error: 'Failed to send template message' });
  }
});

/**
 * POST /test — Test connection by verifying the access token and phone number ID.
 */
router.post('/test', async (_req, res) => {
  try {
    const result = await whatsappBusinessService.testConnection();
    res.json(result);
  } catch (err: any) {
    console.error('[WA Business] Test error:', err);
    res.status(500).json({ success: false, error: 'Failed to test connection' });
  }
});

/**
 * GET /status — Get current config status (enabled, has credentials, etc.)
 * Does NOT return actual secrets.
 */
router.get('/status', async (_req, res) => {
  try {
    const config = await whatsappBusinessService.getConfig();
    res.json({
      enabled: config.enabled,
      hasPhoneNumberId: !!config.phoneNumberId,
      hasAccessToken: !!config.accessToken,
      hasWabaId: !!config.wabaId,
      hasWebhookVerifyToken: !!config.webhookVerifyToken,
      webhookUrl: `${_req.protocol}://${_req.get('host')}/api/wa-business/webhook`,
    });
  } catch (err: any) {
    console.error('[WA Business] Status error:', err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

export default router;
