// Security utility routes - placeholders
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbManager } from '../database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Placeholder for encryption key rotation
router.post('/rotate-key', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', ['ROTATE_KEY', 'Encryption key rotated via security endpoint']);
    res.json({ success: true, message: 'Encryption key rotated (simulated)' });
  } catch (e) {
    console.error('Security rotate-key error:', e);
    res.status(500).json({ error: 'Failed to rotate key' });
  }
});

// Admin Remote Operations Login
router.post('/admin/login', async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: 'Missing request body.' });
  }
  const { username, password, uniqueKey, deviceId, deviceName = 'Unknown Device', os = 'Unknown OS' } = req.body;

  if (!username || !password || !uniqueKey || !deviceId) {
    return res.status(400).json({ error: 'Missing required credentials or device identifier.' });
  }

  try {
    const db = await dbManager.getConnection();
    
    // Check if remote mode is enabled
    const modeRow = await db.get("SELECT value FROM app_settings WHERE key = 'admin_remote_mode'");
    if (!modeRow || modeRow.value !== 'true') {
      return res.status(403).json({ error: 'Admin Remote Operations Mode is disabled on this server.' });
    }

    // Get expected credentials
    const userRow = await db.get("SELECT value FROM app_settings WHERE key = 'admin_username'");
    const passRow = await db.get("SELECT value FROM app_settings WHERE key = 'admin_password'");
    const keyRow = await db.get("SELECT value FROM app_settings WHERE key = 'admin_unique_key'");

    const dbUsername = userRow?.value || 'admin';
    const dbPassword = passRow?.value || 'admin123';
    const dbUniqueKey = keyRow?.value || 'KEY-ADM-837261';

    if (username !== dbUsername || password !== dbPassword || uniqueKey !== dbUniqueKey) {
      return res.status(401).json({ error: 'Invalid admin credentials or unique key.' });
    }

    // Check device authorization
    const devIdRow = await db.get("SELECT value FROM app_settings WHERE key = 'admin_authorized_device_id'");
    const registeredDevId = devIdRow?.value || '';

    if (registeredDevId !== '' && registeredDevId !== deviceId) {
      return res.status(403).json({ 
        error: 'This server is already registered to another mobile device. Please reset device authorization on the PC Settings Console.' 
      });
    }

    // If no device registered, register this device
    if (registeredDevId === '') {
      await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('admin_authorized_device_id', ?)", [deviceId]);
      await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('admin_authorized_device_name', ?)", [`${deviceName} (${os})`]);
    }

    // Fetch session token for API requests
    const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'license_session_token'");
    const sessionToken = tokenRow?.value || 'mock-dev-session-token'; // Fallback for local development

    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)', 
      ['ADMIN_REMOTE_LOGIN', `Admin logged in remotely from ${deviceName} (${os})`]
    );

    res.json({ success: true, sessionToken, message: 'Authentication successful. Device registered.' });
  } catch (error: any) {
    console.error('Remote admin login error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Reset Remote Device Authorization (Accessible from local PC)
router.post('/admin/reset-device', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('admin_authorized_device_id', '')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('admin_authorized_device_name', '')");

    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['ADMIN_DEVICE_RESET', 'Admin authorized device registration reset via PC console']
    );

    res.json({ success: true, message: 'Admin device authorization reset successfully.' });
  } catch (error: any) {
    console.error('Failed to reset admin device:', error);
    res.status(500).json({ error: 'Failed to reset device: ' + error.message });
  }
});

export default router;
