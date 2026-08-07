// Settings API (Agent 2)
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbManager } from '../database/connection.js';
import { telegramBotService } from '../telegramBot.js';
import { extractCleanEmail } from '../utils/emailSanitizer.js';
import { getAppDataDir } from '../config/index.js';
import { syncDistributorPhoneAcrossTables } from '../utils/distributorSyncHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const UPLOADS_DIR = path.resolve(getAppDataDir(), 'uploads');

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

// Telegram bot real connection status (polling active vs merely enabled)
router.get('/telegram-status', async (_req, res) => {
  res.json({ isReady: telegramBotService.isReady() });
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

    // Synchronize store name alias keys
    const nameKeys = ['shop_name', 'pharmacy_name', 'store_name', 'medical_name'];
    if (nameKeys.includes(key) && saveValue) {
      for (const nk of nameKeys) {
        await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [nk, saveValue]);
      }
    }

    // Synchronize store phone alias keys
    const phoneKeys = ['shop_phone', 'pharmacy_phone', 'store_phone', 'phone'];
    if (phoneKeys.includes(key) && saveValue) {
      for (const pk of phoneKeys) {
        await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [pk, saveValue]);
      }
    }

    res.json({ success: true, key, value: saveValue });
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
    await dbManager.transaction(async (db) => {
      await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
      const entries = Object.entries(payload);
      const protectedKeys = ['pharmarack_session_token', 'pharmarack_username', 'pharmarack_password', 'wa_business_access_token'];

      const upsertStmt = await db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
      const checkProtectedStmt = await db.prepare("SELECT value FROM app_settings WHERE key = ? AND value IS NOT NULL AND value != ''");

      try {
        for (const [k, v] of entries) {
          if (k === 'pharmarack_mode') {
            await upsertStmt.run(['pharmarack_mode', 'Live']);
            continue;
          }
          const valStr = v !== undefined && v !== null ? String(v).trim() : '';
          if (protectedKeys.includes(k) && valStr === '') {
            const existing = await checkProtectedStmt.get([k]);
            if (existing) continue;
          }
          await upsertStmt.run([k, v ?? '']);
        }

        // Synchronize store name aliases if any store name key was provided
        const pharmacyNameVal = payload['shop_name'] || payload['pharmacy_name'] || payload['store_name'] || payload['medical_name'];
        if (pharmacyNameVal) {
          const val = String(pharmacyNameVal).trim();
          if (val) {
            await upsertStmt.run(['shop_name', val]);
            await upsertStmt.run(['pharmacy_name', val]);
            await upsertStmt.run(['store_name', val]);
            await upsertStmt.run(['medical_name', val]);
          }
        }

        // Synchronize store phone aliases if any store phone key was provided
        const pharmacyPhoneVal = payload['shop_phone'] || payload['phone'] || payload['store_phone'] || payload['pharmacy_phone'];
        if (pharmacyPhoneVal) {
          const val = String(pharmacyPhoneVal).trim();
          if (val) {
            await upsertStmt.run(['shop_phone', val]);
            await upsertStmt.run(['pharmacy_phone', val]);
            await upsertStmt.run(['store_phone', val]);
            await upsertStmt.run(['phone', val]);
          }
        }
      } finally {
        await upsertStmt.finalize();
        await checkProtectedStmt.finalize();
      }

      // Sync delivery boys to single DB source location (delivery_boys table)
      const selectBoyStmt = await db.prepare(
        "SELECT id FROM delivery_boys WHERE name = ? OR name LIKE ? OR id = ? ORDER BY id ASC LIMIT 1"
      );
      const updateBoyStmt = await db.prepare(
        'UPDATE delivery_boys SET name = ?, whatsapp_number = ?, is_active = 1 WHERE id = ?'
      );
      const insertBoyStmt = await db.prepare(
        'INSERT INTO delivery_boys (name, whatsapp_number, is_active) VALUES (?, ?, 1)'
      );

      try {
        const boy1Name = payload['delivery_boy_name'] || payload['delivery_boy_1_name'];
        const boy1Phone = payload['delivery_boy_whatsapp'] || payload['delivery_boy_phone'];
        if (boy1Phone !== undefined && String(boy1Phone).trim() !== '') {
          const nameToUse = String(boy1Name || '').trim() || 'Delivery Staff 1';
          const phoneStr = String(boy1Phone || '').trim();

          const existing1 = await selectBoyStmt.get([nameToUse, 'Delivery Staff 1%', 1]);

          if (phoneStr && phoneStr.replace(/\D/g, '').length >= 10) {
            if (existing1) {
              await updateBoyStmt.run([nameToUse, phoneStr, existing1.id]);
            } else {
              await insertBoyStmt.run([nameToUse, phoneStr]);
            }
          }
        }

        const boy2Name = payload['delivery_boy_name_2'] || payload['delivery_boy_2_name'];
        const boy2Phone = payload['delivery_boy_whatsapp_2'];
        if (boy2Phone !== undefined && String(boy2Phone).trim() !== '') {
          const nameToUse = String(boy2Name || '').trim() || 'Delivery Staff 2';
          const phoneStr = String(boy2Phone || '').trim();

          const existing2 = await selectBoyStmt.get([nameToUse, 'Delivery Staff 2%', 2]);

          if (phoneStr && phoneStr.replace(/\D/g, '').length >= 10) {
            if (existing2) {
              await updateBoyStmt.run([nameToUse, phoneStr, existing2.id]);
            } else {
              await insertBoyStmt.run([nameToUse, phoneStr]);
            }
          }
        }
      } finally {
        await selectBoyStmt.finalize();
        await updateBoyStmt.finalize();
        await insertBoyStmt.finalize();
      }

      // A2: Upsert the owner contact atomically within the same transaction, mirroring the
      // upsert semantics of POST /api/contacts (src/routes/contacts.ts) for type='owner' —
      // dedupe by phone+type first, then name+type; only overwrite fields with non-empty values.
      // This replaces the frontend's separate api.saveContact(...) HTTP call.
      const ownerPhoneRaw = payload['owner_whatsapp_number'] || payload['phone'];
      if (ownerPhoneRaw !== undefined && String(ownerPhoneRaw).trim() !== '') {
        await db.run(`
          CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT DEFAULT 'general',
            phone TEXT,
            email TEXT,
            address TEXT,
            gstin TEXT,
            notes TEXT,
            alias_names TEXT,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        const ownerName = String(
          payload['pharmacy_name'] || payload['shop_name'] || payload['store_name'] || payload['medical_name'] || 'Pharmacy Owner'
        ).trim() || 'Pharmacy Owner';
        const ownerCleanPhone = String(ownerPhoneRaw).replace(/\D/g, '');
        const ownerEmail = payload['email'] ? String(payload['email']).trim() : '';
        const ownerAddress = payload['address'] ? String(payload['address']).trim() : '';
        const ownerGstin = payload['gstin'] ? String(payload['gstin']).trim() : '';

        let existingOwner = ownerCleanPhone
          ? await db.get('SELECT id FROM contacts WHERE phone = ? AND type = ?', [ownerCleanPhone, 'owner'])
          : undefined;
        if (!existingOwner) {
          existingOwner = await db.get('SELECT id FROM contacts WHERE LOWER(name) = LOWER(?) AND type = ?', [ownerName, 'owner']);
        }

        if (existingOwner) {
          await db.run(
            `UPDATE contacts
             SET name = ?,
                 phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                 email = CASE WHEN ? != '' THEN ? ELSE email END,
                 address = CASE WHEN ? != '' THEN ? ELSE address END,
                 gstin = CASE WHEN ? != '' THEN ? ELSE gstin END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
              ownerName,
              ownerCleanPhone, ownerCleanPhone,
              ownerEmail, ownerEmail,
              ownerAddress, ownerAddress,
              ownerGstin, ownerGstin,
              existingOwner.id
            ]
          );
        } else {
          await db.run(
            `INSERT INTO contacts (name, type, phone, email, address, gstin) VALUES (?, ?, ?, ?, ?, ?)`,
            [ownerName, 'owner', ownerCleanPhone, ownerEmail, ownerAddress, ownerGstin]
          );
        }
      }
    });



    if (payload['email_retention_limit'] !== undefined) {
      try {
        const db = await dbManager.getConnection();
        const { emailService } = await import('../services/emailService.js');
        emailService.pruneOldEmails(db).catch(err => console.error('Pruning after settings update failed:', err));
      } catch (err) { }
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
      LIMIT 1000
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
      const sanitizePhoneDigits = (raw: any): string => {
        const str = (raw && typeof raw === 'string' && !raw.includes('@') && !raw.includes('<')) ? raw.trim() : (typeof raw === 'number' ? String(raw) : '');
        let digits = str ? str.replace(/\D/g, '') : '';
        if (digits.length === 12 && digits.startsWith('91')) {
          digits = digits.slice(2);
        } else if (digits.length > 10 && digits.startsWith('91')) {
          digits = digits.slice(2, 12);
        } else if (digits.length > 10) {
          digits = digits.slice(-10);
        }
        return digits;
      };
      const cleanPhone = sanitizePhoneDigits(phone);
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
      const sanitizePhoneDigits = (raw: any): string => {
        const str = (raw && typeof raw === 'string' && !raw.includes('@') && !raw.includes('<')) ? raw.trim() : (typeof raw === 'number' ? String(raw) : '');
        let digits = str ? str.replace(/\D/g, '') : '';
        if (digits.length === 12 && digits.startsWith('91')) {
          digits = digits.slice(2);
        } else if (digits.length > 10 && digits.startsWith('91')) {
          digits = digits.slice(2, 12);
        } else if (digits.length > 10) {
          digits = digits.slice(-10);
        }
        return digits;
      };
      const cleanPhone = sanitizePhoneDigits(phone);
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
    } catch (_) { }

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

  try {
    const db = await dbManager.getConnection();
    const updated = await syncDistributorPhoneAcrossTables(db, {
      id: Number(id),
      name,
      phone,
      email,
      address,
      state_code
    });

    if (!updated) return res.status(404).json({ error: 'Distributor not found' });
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

// Merge duplicate distributors into a single master distributor
router.post('/distributors/merge', async (req, res) => {
  const { primaryId, secondaryIds } = req.body;
  if (!primaryId || !Array.isArray(secondaryIds) || secondaryIds.length === 0) {
    return res.status(400).json({ error: 'primaryId and secondaryIds array are required' });
  }
  try {
    const db = await dbManager.getConnection();
    const primary = await db.get('SELECT * FROM distributors WHERE id = ?', [primaryId]);
    if (!primary) return res.status(404).json({ error: 'Primary distributor not found' });

    const placeholders = secondaryIds.map(() => '?').join(',');
    const params = [primaryId, ...secondaryIds];

    // Re-link all related records to primaryId
    await db.run(`UPDATE purchases SET distributor_id = ? WHERE distributor_id IN (${placeholders})`, params);
    await db.run(`UPDATE purchase_orders SET distributor_id = ? WHERE distributor_id IN (${placeholders})`, params);
    await db.run(`UPDATE returns SET distributor_id = ? WHERE distributor_id IN (${placeholders})`, params);
    await db.run(`UPDATE distributor_payments SET distributor_id = ? WHERE distributor_id IN (${placeholders})`, params);
    await db.run(`UPDATE distributor_payment_details SET distributor_id = ? WHERE distributor_id IN (${placeholders})`, params);
    await db.run(`UPDATE distributor_historical_files SET distributor_id = ? WHERE distributor_id IN (${placeholders})`, params);

    // Remove secondary learning profiles and ensure primary profile exists
    await db.run(`DELETE FROM distributor_learning_profiles WHERE distributor_id IN (${placeholders})`, secondaryIds);
    await db.run(`INSERT OR IGNORE INTO distributor_learning_profiles (distributor_id) VALUES (?)`, [primaryId]);

    // Delete secondary duplicate distributor rows
    await db.run(`DELETE FROM distributors WHERE id IN (${placeholders})`, secondaryIds);

    // Sync phone number to pharmarack_distributors if present
    if (primary.phone && primary.name) {
      const cleanPhone = String(primary.phone).replace(/\D/g, '');
      try {
        await db.run("UPDATE pharmarack_distributors SET phone = ? WHERE LOWER(store_name) LIKE ?", [cleanPhone, `%${primary.name.toLowerCase().trim()}%`]);
      } catch (_) { }
    }

    res.json({ success: true, message: `Successfully merged ${secondaryIds.length} duplicate distributor(s) into '${primary.name}'`, primaryId });
  } catch (error: any) {
    console.error('Failed to merge distributors:', error);
    res.status(500).json({ error: 'Failed to merge distributors: ' + error.message });
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

// Registered Devices Management (for Mobile Pairing & Footer Bar)
router.get('/registered-devices', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        token TEXT PRIMARY KEY,
        device_name TEXT,
        os TEXT,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const rows = await db.all(`
      SELECT 
        push_tokens.token, 
        push_tokens.device_name, 
        push_tokens.os, 
        push_tokens.last_seen,
        CASE 
          WHEN (strftime('%s', 'now') - strftime('%s', push_tokens.last_seen)) <= 40 THEN 1 
          ELSE 0 
        END as is_online
      FROM push_tokens
      INNER JOIN (
        SELECT MAX(last_seen) as max_last_seen, device_name, os
        FROM push_tokens
        GROUP BY device_name, os
      ) p2 ON p2.max_last_seen = push_tokens.last_seen 
        AND p2.device_name = push_tokens.device_name 
        AND p2.os = push_tokens.os
      ORDER BY is_online DESC, push_tokens.last_seen DESC
    `);
    res.json({ success: true, devices: rows || [] });
  } catch (err: any) {
    console.error('Failed to fetch registered devices:', err);
    res.json({ success: true, devices: [] });
  }
});

router.put('/registered-devices/rename', async (req, res) => {
  const { token, device_name } = req.body;
  if (!token || !device_name) {
    return res.status(400).json({ error: 'Token and device_name are required' });
  }
  try {
    const db = await dbManager.getConnection();
    await db.run('UPDATE push_tokens SET device_name = ? WHERE token = ?', [device_name.trim(), token]);
    res.json({ success: true, message: 'Device renamed successfully' });
  } catch (err: any) {
    console.error('Failed to rename registered device:', err);
    res.status(500).json({ error: err.message || 'Failed to rename device' });
  }
});

// Storage Locations Management
router.get('/storage-locations', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run(`
      CREATE TABLE IF NOT EXISTS storage_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        code TEXT UNIQUE,
        type TEXT DEFAULT 'rack',
        description TEXT,
        is_default INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const locations = await db.all('SELECT * FROM storage_locations ORDER BY is_default DESC, name ASC');
    res.json(locations || []);
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
