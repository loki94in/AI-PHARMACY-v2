// Settings API (Agent 2)
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbManager } from '../database/connection.js';
import { telegramBotService } from '../telegramBot.js';
import { extractCleanEmail } from '../utils/emailSanitizer.js';

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

    // Inject App-Owned credentials if not present in database settings
    if (!settingsObj['google_client_id'] && process.env.GOOGLE_CLIENT_ID) {
      settingsObj['google_client_id'] = process.env.GOOGLE_CLIENT_ID;
    }
    if (!settingsObj['google_client_secret'] && process.env.GOOGLE_CLIENT_SECRET) {
      settingsObj['google_client_secret'] = process.env.GOOGLE_CLIENT_SECRET;
    }

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
    const row = await db.get('SELECT value FROM app_settings WHERE key = ?', key);
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
    const saveValue = key === 'pharmarack_mode' ? 'Live' : (value ?? '');
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, saveValue]);
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
    const protectedKeys = ['pharmarack_session_token', 'pharmarack_username', 'pharmarack_password', 'wa_business_access_token'];

    for (const [k, v] of entries) {
      if (k === 'pharmarack_mode') {
        await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', ['pharmarack_mode', 'Live']);
        continue;
      }
      const valStr = v !== undefined && v !== null ? String(v).trim() : '';
      if (protectedKeys.includes(k) && valStr === '') {
        const existing = await db.get("SELECT value FROM app_settings WHERE key = ? AND value IS NOT NULL AND value != ''", [k]);
        if (existing) continue;
      }
      await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [k, v ?? '']);
    }

    if (payload['email_retention_limit'] !== undefined) {
      try {
        const { emailService } = await import('../services/emailService.js');
        emailService.pruneOldEmails(db).catch(err => console.error('Pruning after settings update failed:', err));
      } catch (err) {}
    }

    const keys = Object.keys(payload);


    // Sync delivery boys to single DB source location (delivery_boys table)
    const boy1Name = payload['delivery_boy_name'] || payload['delivery_boy_1_name'];
    const boy1Phone = payload['delivery_boy_whatsapp'] || payload['delivery_boy_phone'];
    if (boy1Phone !== undefined) {
      const nameToUse = String(boy1Name || '').trim() || 'Delivery Staff 1';
      const phoneStr = String(boy1Phone || '').trim();

      // Find first existing Delivery Staff 1 record
      const existing1 = await db.get(
        "SELECT id FROM delivery_boys WHERE name = ? OR name LIKE 'Delivery Staff 1%' OR id = 1 ORDER BY id ASC LIMIT 1",
        [nameToUse]
      );

      if (phoneStr && phoneStr.replace(/\D/g, '').length >= 10) {
        if (existing1) {
          await db.run(
            'UPDATE delivery_boys SET name = ?, whatsapp_number = ?, is_active = 1 WHERE id = ?',
            [nameToUse, phoneStr, existing1.id]
          );
        } else {
          await db.run(
            'INSERT INTO delivery_boys (name, whatsapp_number, is_active) VALUES (?, ?, 1)',
            [nameToUse, phoneStr]
          );
        }
      } else if (existing1) {
        await db.run('UPDATE delivery_boys SET is_active = 0 WHERE id = ?', [existing1.id]);
      }
    }

    const boy2Name = payload['delivery_boy_name_2'] || payload['delivery_boy_2_name'];
    const boy2Phone = payload['delivery_boy_whatsapp_2'];
    if (boy2Phone !== undefined) {
      const nameToUse = String(boy2Name || '').trim() || 'Delivery Staff 2';
      const phoneStr = String(boy2Phone || '').trim();

      // Find first existing Delivery Staff 2 record
      const existing2 = await db.get(
        "SELECT id FROM delivery_boys WHERE name = ? OR name LIKE 'Delivery Staff 2%' OR id = 2 ORDER BY id ASC LIMIT 1",
        [nameToUse]
      );

      if (phoneStr && phoneStr.replace(/\D/g, '').length >= 10) {
        if (existing2) {
          await db.run(
            'UPDATE delivery_boys SET name = ?, whatsapp_number = ?, is_active = 1 WHERE id = ?',
            [nameToUse, phoneStr, existing2.id]
          );
        } else {
          await db.run(
            'INSERT INTO delivery_boys (name, whatsapp_number, is_active) VALUES (?, ?, 1)',
            [nameToUse, phoneStr]
          );
        }
      } else if (existing2) {
        await db.run('UPDATE delivery_boys SET is_active = 0 WHERE id = ?', [existing2.id]);
      }
    }



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

// Create or update a distributor
// Get all saved distributors with contact details
router.get('/distributors', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const list = await db.all(`
      SELECT 
        d.*,
        p.distributor_id as profile_id,
        p.last_updated as profile_last_updated
      FROM distributors d
      LEFT JOIN distributor_learning_profiles p ON d.id = p.distributor_id
      ORDER BY d.name ASC
    `);
    res.json({ success: true, data: list });
  } catch (error: any) {
    console.error('Failed to fetch settings distributors:', error);
    res.status(500).json({ error: 'Failed to fetch distributors' });
  }
});

router.post('/distributors', async (req, res) => {
  const { name, phone, email, address, state_code } = req.body;
  if (!name) return res.status(400).json({ error: 'Distributor name is required' });
  try {
    const db = await dbManager.getConnection();
    const cleanName = name.trim();
    const cleanEmail = extractCleanEmail(email);
    const normName = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');

    let targetId: number;

    const existing = await db.all(
      `SELECT id FROM distributors WHERE LOWER(name) = LOWER(?) OR (LENGTH(?) > 3 AND LOWER(REPLACE(name, ' ', '')) LIKE ?)`,
      [cleanName, normName, `%${normName}%`]
    );

    if (existing && existing.length > 0) {
      const ids = existing.map(e => e.id);
      targetId = ids[0];
      const placeholders = ids.map(() => '?').join(',');
      const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
      await db.run(
        `UPDATE distributors SET 
          phone = CASE WHEN ? != '' THEN ? ELSE phone END,
          contact = CASE WHEN ? != '' THEN ? ELSE contact END,
          email = CASE WHEN ? != '' THEN ? ELSE email END,
          address = CASE WHEN ? != '' THEN ? ELSE address END,
          state_code = CASE WHEN ? != '' THEN ? ELSE state_code END
         WHERE id IN (${placeholders})`,
        [cleanPhone, cleanPhone, cleanPhone, cleanPhone, cleanEmail, cleanEmail, address || '', address || '', state_code || '', state_code || '', ...ids]
      );
    } else {
      const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
      const result = await db.run(
        `INSERT INTO distributors (name, phone, contact, email, address, state_code) VALUES (?, ?, ?, ?, ?, ?)`,
        [cleanName, cleanPhone, cleanPhone, cleanEmail, address || '', state_code || '']
      );
      targetId = result.lastID || 0;
    }

    // Automatically register learning profile for local AI learning integration
    try {
      await db.run(
        'INSERT OR IGNORE INTO distributor_learning_profiles (distributor_id) VALUES (?)',
        [targetId]
      );
    } catch (_) {}

    const saved = await db.get('SELECT * FROM distributors WHERE id = ?', [targetId]);
    res.json({ success: true, data: saved });
  } catch (error: any) {
    console.error('Failed to save distributor:', error);
    res.status(500).json({ error: 'Failed to save distributor: ' + error.message });
  }
});

// Update a distributor
router.put('/distributors/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, address, state_code } = req.body;
  if (!name) return res.status(400).json({ error: 'Distributor name is required' });
  const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
  const cleanEmail = extractCleanEmail(email);
  try {
    const db = await dbManager.getConnection();
    await db.run(
      `UPDATE distributors SET 
        name = ?, 
        phone = ?, 
        contact = ?,
        email = CASE WHEN ? != '' THEN ? ELSE email END, 
        address = CASE WHEN ? != '' THEN ? ELSE address END, 
        state_code = CASE WHEN ? != '' THEN ? ELSE state_code END 
       WHERE id = ?`,
      [name, cleanPhone, cleanPhone, cleanEmail, cleanEmail, address || '', address || '', state_code || '', state_code || '', id]
    );

    // Auto link learning profile
    try {
      await db.run(
        'INSERT OR IGNORE INTO distributor_learning_profiles (distributor_id) VALUES (?)',
        [id]
      );
    } catch (_) {}

    const updated = await db.get('SELECT * FROM distributors WHERE id = ?', [id]);
    if (!updated) return res.status(404).json({ error: 'Distributor not found' });

    // Also sync pharmarack_distributors table if present
    try {
      await db.run(
        "UPDATE pharmarack_distributors SET phone = ? WHERE LOWER(store_name) LIKE ?",
        [cleanPhone, `%${name.toLowerCase().trim()}%`]
      );
    } catch (_) {}

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Failed to update distributor:', error);
    res.status(500).json({ error: 'Failed to update distributor' });
  }
});

// Delete a distributor contact & profile
router.delete('/distributors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM distributor_learning_profiles WHERE distributor_id = ?', [id]);
    await db.run('DELETE FROM distributors WHERE id = ?', [id]);
    res.json({ success: true, message: 'Distributor deleted successfully' });
  } catch (error: any) {
    console.error('Failed to delete distributor:', error);
    res.status(500).json({ error: 'Failed to delete distributor: ' + error.message });
  }
});
// Disconnect Google account settings
router.post('/google/disconnect', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run(
      `DELETE FROM app_settings WHERE key IN (
        'gmail_oauth_refresh_token',
        'gmail_oauth_access_token',
        'gmail_oauth_token_expiry',
        'gmail_user',
        'gmail_pass',
        'gmail_auth_status',
        'gmail_auth_error'
      )`
    );
    await db.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_auth_method', 'password')"
    );
    res.json({ success: true, message: 'Gmail connection cleared successfully' });
  } catch (error: any) {
    console.error('Failed to disconnect Google account:', error);
    res.status(500).json({ error: 'Failed to disconnect Google account' });
  }
});

// Storage Locations Management
router.get('/storage-locations', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const locations = await db.all('SELECT * FROM storage_locations ORDER BY is_default DESC, name ASC');
    res.json(locations);
  } catch (error) {
    console.error('Failed to fetch storage locations:', error);
    res.status(500).json({ error: 'Failed to fetch storage locations' });
  }
});

router.post('/storage-locations', async (req, res) => {
  const { name, code, type, description, is_default, is_active } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Storage location name is required' });
  }
  try {
    const db = await dbManager.getConnection();
    const cleanName = name.trim();
    const cleanCode = (code || cleanName.substring(0, 4).toUpperCase()).trim();

    if (is_default) {
      await db.run('UPDATE storage_locations SET is_default = 0');
    }

    const result = await db.run(
      `INSERT INTO storage_locations (name, code, type, description, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cleanName, cleanCode, type || 'rack', description || '', is_default ? 1 : 0, is_active !== undefined ? (is_active ? 1 : 0) : 1]
    );

    const saved = await db.get('SELECT * FROM storage_locations WHERE id = ?', [result.lastID]);
    res.json({ success: true, data: saved });
  } catch (error: any) {
    console.error('Failed to create storage location:', error);
    res.status(500).json({ error: error.message || 'Failed to create storage location' });
  }
});

router.put('/storage-locations/:id', async (req, res) => {
  const { id } = req.params;
  const { name, code, type, description, is_default, is_active } = req.body;
  try {
    const db = await dbManager.getConnection();
    if (is_default) {
      await db.run('UPDATE storage_locations SET is_default = 0');
    }
    await db.run(
      `UPDATE storage_locations
       SET name = COALESCE(?, name),
           code = COALESCE(?, code),
           type = COALESCE(?, type),
           description = COALESCE(?, description),
           is_default = CASE WHEN ? IS NOT NULL THEN ? ELSE is_default END,
           is_active = CASE WHEN ? IS NOT NULL THEN ? ELSE is_active END
       WHERE id = ?`,
      [
        name ? name.trim() : null,
        code ? code.trim() : null,
        type || null,
        description !== undefined ? description : null,
        is_default !== undefined ? 1 : null,
        is_default ? 1 : 0,
        is_active !== undefined ? 1 : null,
        is_active ? 1 : 0,
        id
      ]
    );
    const updated = await db.get('SELECT * FROM storage_locations WHERE id = ?', [id]);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Failed to update storage location:', error);
    res.status(500).json({ error: error.message || 'Failed to update storage location' });
  }
});

router.delete('/storage-locations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const loc = await db.get('SELECT * FROM storage_locations WHERE id = ?', [id]);
    if (!loc) return res.status(404).json({ error: 'Storage location not found' });
    if (loc.is_default) return res.status(400).json({ error: 'Cannot delete default storage location' });

    await db.run('DELETE FROM storage_locations WHERE id = ?', [id]);
    res.json({ success: true, message: 'Storage location deleted' });
  } catch (error) {
    console.error('Failed to delete storage location:', error);
    res.status(500).json({ error: 'Failed to delete storage location' });
  }
});

export default router;
