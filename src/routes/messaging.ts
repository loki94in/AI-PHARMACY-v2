// Messaging Hub API (Agent 2)
import express from 'express';
import { initClient, sendMessage, currentQr, isReady, forceReconnect, destroyClient, shouldRouteToBusiness } from '../whatsappClient.js';
import QRCode from 'qrcode';
import { dbManager } from '../database/connection.js';
import { eventService } from '../services/eventService.js';

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
let isLoginWindowActive = false;

function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe') : null
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

// Get current WhatsApp authentication status and QR code
router.get('/qr', async (req, res) => {
  try {
    if (isLoginWindowActive) {
      return res.json({ isReady: false, qrUrl: null, message: 'Chrome login window is open. Scan the QR code in Chrome.' });
    }

    const useBusiness = await shouldRouteToBusiness();
    if (useBusiness) {
      return res.json({ isReady: true, qrUrl: null, message: 'WhatsApp Business API is active.' });
    }

    if (isReady) {
      return res.json({ isReady: true, qrUrl: null });
    }
    if (currentQr) {
      const qrUrl = await QRCode.toDataURL(currentQr);
      return res.json({ isReady: false, qrUrl });
    }
    
    // Trigger initialization if it hasn't started or QR isn't ready
    initClient().catch(console.error);
    
    res.json({ isReady: false, qrUrl: null, message: 'Initializing WhatsApp client. Waiting for QR...' });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Launch non-headless login window for WhatsApp Web
router.post('/login-window', async (req, res) => {
  const chromePath = findChromePath();
  if (!chromePath) {
    return res.status(404).json({ error: 'Google Chrome was not found on your system. Please install Google Chrome to use this feature.' });
  }

  if (isLoginWindowActive) {
    return res.json({ success: true, message: 'Chrome login window is already open.' });
  }

  isLoginWindowActive = true;
  res.json({ success: true, message: 'Opening WhatsApp login window...' });

  (async () => {
    let browser;
    try {
      // 1. Destroy background client to release session folder locks
      await destroyClient();

      // Give the OS 2.5 seconds to fully release file locks on the profile directory
      await new Promise(resolve => setTimeout(resolve, 2500));

      console.log('[WhatsApp] Launching Chrome for WhatsApp login from:', chromePath);
      const authPath = path.resolve(process.cwd(), '.wwebjs_auth', 'session');
      const lockFiles = ['lockfile', 'SingletonLock', 'DevToolsActivePort'];
      for (const lf of lockFiles) {
        const p = path.join(authPath, lf);
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (e) {}
        }
      }

      browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: false,
        defaultViewport: null,
        args: [
          '--start-maximized',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ],
        userDataDir: authPath
      });

      const [page] = await browser.pages();
      await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded' });

      // Poll for login confirmation or user closure (up to 10 minutes)
      for (let i = 0; i < 600; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if browser was closed
        const isClosed = !browser.connected || (await browser.pages().catch(() => [])).length === 0;
        if (isClosed) {
          console.log('[WhatsApp] Login window closed by user.');
          break;
        }

        // Check if logged in (look for pane-side or chat-list or chat-icon)
        const isLoggedIn = await page.evaluate(() => {
          return !!(
            document.querySelector('[data-testid="chat-list"]') ||
            document.querySelector('#pane-side') ||
            document.querySelector('[data-icon="chat"]')
          );
        }).catch(() => false);

        if (isLoggedIn) {
          console.log('[WhatsApp] Login detected in Chrome popup!');
          try {
            const db = await dbManager.getConnection();
            await db.run(
              "INSERT INTO app_settings (key, value) VALUES ('whatsapp_preferred_system', 'automated') ON CONFLICT(key) DO UPDATE SET value = 'automated'"
            );
          } catch (e) {
            console.warn('[WhatsApp] Could not set whatsapp_preferred_system setting:', e);
          }
          // Give it a moment to sync cookies and IndexedDB to userDataDir
          await new Promise(resolve => setTimeout(resolve, 3000));
          break;
        }
      }
    } catch (err: any) {
      console.error('[WhatsApp] Error in Chrome login window:', err);
      // Broadcast error message to the frontend so the user knows why it failed
      try {
        eventService.broadcast('auth_failure', {
          message: `Failed to open WhatsApp login window: ${err.message || err}. Ensure Chrome is installed and not already open in another process.`
        });
      } catch (broadcastErr) {
        console.error('[WhatsApp] Failed to broadcast auth failure:', broadcastErr);
      }
    } finally {
      isLoginWindowActive = false;
      if (browser) {
        try {
          await browser.close();
        } catch (err) {
          console.error('[WhatsApp] Error closing browser:', err);
        }
      }
      // Re-initialize the background client now that Chrome is closed
      console.log('[WhatsApp] Re-initializing background client...');
      initClient().catch(err => {
        console.error('[WhatsApp] Re-initialization after popup failed:', err);
      });
    }
  })();
});

// Force reconnect and clear session
router.post('/reconnect', async (req, res) => {

  try {
    // Return early to the client, the forceReconnect runs asynchronously 
    // and takes a few seconds to destroy and restart the browser
    forceReconnect().catch(console.error);
    res.json({ success: true, message: 'Reconnecting...' });
  } catch (err) {
    console.error('Reconnect error:', err);
    res.status(500).json({ error: 'Failed to reconnect' });
  }
});

// Send a WhatsApp message via the hub — waits up to 8 seconds for real result
router.post('/send', async (req, res) => {
  const { number, message, mediaUrl, file } = req.body;
  if (!number || (!message && !file)) {
    return res.status(400).json({ error: 'number and either message or file are required' });
  }

  // Race: actual send vs 8-second timeout
  // - Resolves in time  → return real success/failure to frontend
  // - Times out         → fall back to queue + 202 (client may still be initializing)
  const SEND_TIMEOUT_MS = 8000;

  let timedOut = false;
  const timeoutPromise = new Promise<'timeout'>(resolve =>
    setTimeout(() => { timedOut = true; resolve('timeout'); }, SEND_TIMEOUT_MS)
  );

  try {
    const result = await Promise.race([
      sendMessage(number, mediaUrl, message, file).then(() => 'ok' as const),
      timeoutPromise
    ]);

    if (result === 'timeout') {
      // Client is slow to init — queue for retry and return 202
      try {
        const db = await dbManager.getConnection();
        await db.run(
          `INSERT INTO whatsapp_send_queue (number, message, created_at) VALUES (?, ?, ?)
           ON CONFLICT DO NOTHING`,
          [number, message || '', Date.now()]
        );
        console.log(`[Messaging] Send timed out for ${number}, queued for retry.`);
      } catch (qErr: any) {
        console.error('[Messaging] Failed to queue timed-out message:', qErr?.message || qErr);
      }
      return res.status(202).json({ success: true, message: 'Message queued for delivery (client initializing)' });
    }

    // Real success
    console.log(`[Messaging] Send OK → ${number}`);
    return res.status(200).json({ success: true });
  } catch (err: any) {
    // Real failure — surface the error message to the frontend
    const errMsg = err?.message || String(err) || 'Failed to send WhatsApp message';
    console.warn(`[Messaging] Send failed for ${number}:`, errMsg);
    return res.status(400).json({ error: errMsg });
  }
});

// Get all WhatsApp chats
router.get('/chats', async (req, res) => {
  try {
    const { getChats } = await import('../whatsappClient.js');
    const chats = await getChats();
    // Sanitize the objects to prevent circular JSON stringify issues
    const sanitizedChats = chats.map(c => {
      if (c.id && typeof c.id === 'string') {
        // Flat format from local database
        return {
          id: c.id,
          name: c.name || c.id.split('@')[0],
          unreadCount: c.unreadCount || 0,
          timestamp: c.timestamp,
          isGroup: !!c.isGroup,
          lastMessage: c.lastMessage,
          resolvedNumber: c.resolvedNumber || c.id.split('@')[0]
        };
      }
      // Raw nested format from whatsapp-web.js client
      return {
        id: c.id._serialized,
        name: c.name || c.id.user,
        unreadCount: c.unreadCount,
        timestamp: c.timestamp,
        isGroup: c.isGroup,
        lastMessage: c.lastMessage ? c.lastMessage.body : null,
        resolvedNumber: c.id.user
      };
    });
    res.json(sanitizedChats);
  } catch (err: any) {
    console.error('Error fetching chats:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch chats' });
  }
});

router.get('/chats/:id/messages', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 500;
    const { getChatMessages } = await import('../whatsappClient.js');
    const messages = await getChatMessages(req.params.id, limit);
    const sanitizedMessages = messages.map(m => {
      if (m.id && typeof m.id === 'string') {
        // Flat format from local database
        return {
          id: m.id,
          body: m.body,
          fromMe: !!m.fromMe,
          timestamp: m.timestamp,
          type: m.type,
          hasMedia: !!m.hasMedia,
          scannedResult: m.scannedResult || null
        };
      }
      // Raw nested format from whatsapp-web.js client
      return {
        id: m.id._serialized,
        body: m.body,
        fromMe: m.fromMe,
        timestamp: m.timestamp,
        type: m.type,
        hasMedia: m.hasMedia
      };
    });
    res.json(sanitizedMessages);
  } catch (err: any) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch messages' });
  }
});

// Get media for a specific message
router.get('/chats/:chatId/messages/:messageId/media', async (req, res) => {
  try {
    const { getMessageMedia } = await import('../whatsappClient.js');
    const media = await getMessageMedia(req.params.chatId, req.params.messageId);
    res.json(media);
  } catch (err: any) {
    console.error('Error fetching message media:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch media' });
  }
});

// GET list of ignored numbers
router.get('/ignored-phones', async (req, res) => {
  try {
    const { dbManager } = await import('../database/connection.js');
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT phone, reason, added_at FROM ignored_whatsapp_numbers');
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching ignored phones:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch ignored numbers' });
  }
});

// POST toggle ignore state for a number
router.post('/toggle-ignore', async (req, res) => {
  try {
    const { phone, ignore, reason = '' } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const { dbManager } = await import('../database/connection.js');
    const db = await dbManager.getConnection();

    const isGroupOrBroadcast = phone.endsWith('@g.us') || phone.endsWith('@broadcast') || phone.includes('broadcast') || phone === 'status@broadcast' || phone.includes('-');

    if (ignore) {
      // Always INSERT the ignore record (groups, broadcasts, and regular numbers)
      await db.run(
        'INSERT OR REPLACE INTO ignored_whatsapp_numbers (phone, reason) VALUES (?, ?)',
        [phone, reason || 'ignored']
      );
      // Delete all cached chats and messages for this number from DB to remove it from the UI immediately
      await db.run('DELETE FROM whatsapp_messages WHERE chat_id = ?', [phone]);
      await db.run('DELETE FROM whatsapp_chats WHERE id = ?', [phone]);
      const phoneDigits = phone.split('@')[0];
      await db.run('DELETE FROM whatsapp_messages WHERE chat_id = ?', [phoneDigits]);
      await db.run('DELETE FROM whatsapp_chats WHERE id = ?', [phoneDigits]);
    } else {
      // Always DELETE the ignore record to un-ignore (groups, broadcasts, and regular numbers)
      await db.run('DELETE FROM ignored_whatsapp_numbers WHERE phone = ?', [phone]);
    }

    res.json({ success: true, ignore });
  } catch (err: any) {
    console.error('Error toggling ignore status:', err);
    res.status(500).json({ error: err.message || 'Failed to toggle ignore status' });
  }
});

// POST manual trigger scan of a specific message ID (OCR intent pipeline)
router.post('/chats/:chatId/messages/:messageId/scan', async (req, res) => {
  const { chatId, messageId } = req.params;
  try {
    const { dbManager } = await import('../database/connection.js');
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT * FROM whatsapp_messages WHERE id = ?', [messageId]);
    if (!row) {
      return res.status(404).json({ error: 'Message not found in database cache' });
    }

    const mockMsg = {
      from: row.chat_id,
      to: 'business@c.us',
      body: row.body,
      id: row.id,
      hasMedia: !!row.has_media,
      downloadMedia: async () => {
        const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
        if (fs.existsSync(uploadsDir)) {
          const files = fs.readdirSync(uploadsDir);
          const matched = files.find(f => f.startsWith(messageId));
          if (matched) {
            const ext = path.extname(matched).toLowerCase();
            const data = fs.readFileSync(path.join(uploadsDir, matched)).toString('base64');
            let mimetype = 'image/jpeg';
            if (ext === '.png') mimetype = 'image/png';
            else if (ext === '.pdf') mimetype = 'application/pdf';
            return { mimetype, data };
          }
        }
        return null;
      }
    };

    const { whatsappIntentService } = await import('../services/whatsappIntentService.js');
    await whatsappIntentService.handleInbound(mockMsg);

    res.json({ success: true, message: 'Message queued for manual scan' });
  } catch (err: any) {
    console.error('Failed to trigger scan:', err);
    res.status(500).json({ error: err.message || 'Failed to trigger scan' });
  }
});

// ── Message Templates Endpoints ───────────────────────────────────────────────

// GET /messaging/templates — List all message templates
router.get('/templates', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run(`
      CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    let rows = await db.all(
      'SELECT id, name, category, body, created_at as createdAt, updated_at as updatedAt FROM whatsapp_message_templates ORDER BY category ASC, name ASC'
    );

    if (!rows || rows.length === 0) {
      const now = Date.now();
      const seedTemplates = [
        { name: 'Refill Reminder', category: 'Patients', body: 'Hello {{name}}, this is a friendly reminder from AI Pharmacy that your prescription for {{medicine}} is due for refill. Reply to confirm order delivery.' },
        { name: 'Payment Dues Reminder', category: 'Patients', body: 'Dear {{name}}, your bill invoice #{{invoice}} of ₹{{amount}} is due. Kindly let us know if you need assistance with payment.' },
        { name: 'Stock Availability Inquiry', category: 'Distributors', body: 'Dear {{distributor}}, please check stock availability and rate for: {{medicines}}. Thank you.' },
        { name: 'General Reply', category: 'General', body: 'Hello! Thank you for contacting AI Pharmacy. How can we help you today?' }
      ];
      for (const t of seedTemplates) {
        await db.run(
          'INSERT INTO whatsapp_message_templates (name, category, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [t.name, t.category, t.body, now, now]
        );
      }
      rows = await db.all(
        'SELECT id, name, category, body, created_at as createdAt, updated_at as updatedAt FROM whatsapp_message_templates ORDER BY category ASC, name ASC'
      );
    }

    res.json(rows);
  } catch (err: any) {
    console.error('Failed to fetch message templates:', err);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST /messaging/templates — Create new template
router.post('/templates', async (req, res) => {
  const { name, category, body } = req.body;
  if (!name || !body) {
    return res.status(400).json({ error: 'name and body are required' });
  }
  try {
    const db = await dbManager.getConnection();
    const now = Date.now();
    const result = await db.run(
      'INSERT INTO whatsapp_message_templates (name, category, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), (category || 'General').trim(), body.trim(), now, now]
    );
    res.status(201).json({
      id: result.lastID,
      name: name.trim(),
      category: (category || 'General').trim(),
      body: body.trim(),
      createdAt: now,
      updatedAt: now
    });
  } catch (err: any) {
    console.error('Failed to create message template:', err);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT /messaging/templates/:id — Update template
router.put('/templates/:id', async (req, res) => {
  const { id } = req.params;
  const { name, category, body } = req.body;
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT id FROM whatsapp_message_templates WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }
    const now = Date.now();
    await db.run(
      `UPDATE whatsapp_message_templates 
       SET name = COALESCE(?, name),
           category = COALESCE(?, category),
           body = COALESCE(?, body),
           updated_at = ?
       WHERE id = ?`,
      [name ? name.trim() : null, category ? category.trim() : null, body ? body.trim() : null, now, id]
    );
    const updated = await db.get('SELECT id, name, category, body, created_at as createdAt, updated_at as updatedAt FROM whatsapp_message_templates WHERE id = ?', [id]);
    res.json(updated);
  } catch (err: any) {
    console.error('Failed to update message template:', err);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// DELETE /messaging/templates/:id — Delete template
router.delete('/templates/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM whatsapp_message_templates WHERE id = ?', [id]);
    res.json({ success: true, message: 'Template deleted' });
  } catch (err: any) {
    console.error('Failed to delete message template:', err);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

export default router;
