// Settings API (Agent 2)
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbManager } from '../database/connection.js';
import { telegramBotService } from '../telegramBot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads');

const router = express.Router();

// Get all settings
router.get('/', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    const rows = await db.all('SELECT * FROM app_settings');
    const settingsObj: Record<string, string> = {};
    rows.forEach(r => {
      settingsObj[r.key] = r.value;
    });
    res.json(settingsObj);
  } catch (error) {
    console.error('All settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Get a setting value
router.get('/:key', async (req, res) => {
  const { key } = req.params;
  try {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return res.status(404).json({ error: 'Setting not found' });
    res.json({ key, value: row.value });
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// Update or create a setting
router.post('/', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    const db = await dbManager.getConnection();
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value ?? '']);
    res.json({ success: true, message: 'Setting saved' });
  } catch (error) {
    console.error('Settings save error:', error);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

// Generic settings save (upsert multiple keys)
router.post('/save', async (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'payload required' });
  try {
    const db = await dbManager.getConnection();
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    const entries = Object.entries(payload);
    for (const [k, v] of entries) {
      await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [k, v ?? '']);
    }

    const keys = Object.keys(payload);

    // If telegram settings changed, trigger hot-reload of Telegram bot service
    const hasTelegramKey = keys.some(k => k === 'telegram_enabled' || k === 'telegram_token' || k === 'telegram_chat_id');
    if (hasTelegramKey) {
      telegramBotService.initializeOrReloadBot().catch(err => {
        console.error('[Telegram] Failed to reload bot after settings update:', err);
      });
    }

    // If WhatsApp settings changed, hot-reload WhatsApp connection state
    const hasWhatsappKey = keys.some(k => k === 'whatsapp_enabled' || k === 'whatsapp_preferred_system' || k === 'wa_business_enabled');
    if (hasWhatsappKey) {
      (async () => {
        try {
          const { initClient, destroyClient, shouldRouteToBusiness } = await import('../whatsappClient.js');
          const enabled = payload['whatsapp_enabled'] === 'true';
          const useBusiness = await shouldRouteToBusiness();

          if (useBusiness || !enabled) {
            console.log('[Settings] WhatsApp Business API preferred or WhatsApp Web disabled. Shutting down automated client...');
            await destroyClient();
          } else {
            console.log('[Settings] Automated WhatsApp Web enabled. Re-initializing client...');
            await initClient().catch(err => console.error('[Settings] WhatsApp Web initialization failed:', err));
          }
        } catch (err) {
          console.error('[Settings] Failed to hot-reload WhatsApp config:', err);
        }
      })();
    }

    res.json({ success: true, message: 'Settings saved' });
  } catch (error) {
    console.error('Bulk settings save error:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Upload custom stamp (base64 transparent PNG)
router.post('/upload-stamp', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Image data required' });

    // Clean base64 header
    const base64Data = image.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');

    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const stampPath = path.join(UPLOADS_DIR, 'custom_stamp.png');
    fs.writeFileSync(stampPath, buffer);

    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('use_custom_stamp', 'true')");

    res.json({ success: true, message: 'Custom stamp uploaded and enabled' });
  } catch (err: any) {
    console.error('Upload stamp error:', err);
    res.status(500).json({ error: 'Failed to upload stamp' });
  }
});

// Upload custom signature (base64 transparent PNG)
router.post('/upload-signature', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Image data required' });

    // Clean base64 header
    const base64Data = image.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');

    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const sigPath = path.join(UPLOADS_DIR, 'custom_signature.png');
    fs.writeFileSync(sigPath, buffer);

    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('use_custom_signature', 'true')");

    res.json({ success: true, message: 'Custom signature uploaded and enabled' });
  } catch (err: any) {
    console.error('Upload signature error:', err);
    res.status(500).json({ error: 'Failed to upload signature' });
  }
});

// Create a new distributor
router.post('/distributors', async (req, res) => {
  const { name, phone, email, address, state_code } = req.body;
  if (!name) return res.status(400).json({ error: 'Distributor name is required' });
  try {
    const db = await dbManager.getConnection();
    const result = await db.run(
      `INSERT INTO distributors (name, phone, email, address, state_code) VALUES (?, ?, ?, ?, ?)`,
      [name, phone || '', email || '', address || '', state_code || '']
    );
    const id = result.lastID;
    const saved = await db.get('SELECT * FROM distributors WHERE id = ?', [id]);
    res.json({ success: true, data: saved });
  } catch (error: any) {
    console.error('Failed to create distributor:', error);
    if (error && error.message && error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'A distributor with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to create distributor: ' + error.message });
  }
});
// Update a distributor
router.put('/distributors/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, address, state_code } = req.body;
  if (!name) return res.status(400).json({ error: 'Distributor name is required' });
  try {
    const db = await dbManager.getConnection();
    await db.run(
      `UPDATE distributors SET name = ?, phone = ?, email = ?, address = ?, state_code = ? WHERE id = ?`,
      [name, phone || '', email || '', address || '', state_code || '', id]
    );
    const updated = await db.get('SELECT * FROM distributors WHERE id = ?', [id]);
    if (!updated) return res.status(404).json({ error: 'Distributor not found' });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Failed to update distributor:', error);
    res.status(500).json({ error: 'Failed to update distributor' });
  }
});
export default router;
