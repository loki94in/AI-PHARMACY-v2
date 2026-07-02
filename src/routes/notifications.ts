import express from 'express';
import { eventService } from '../services/eventService.js';
import { dbManager } from '../database/connection.js';
import QRCode from 'qrcode';
import os from 'os';

const router = express.Router();

// Get server connection info (IPs, Port, pre-generated QR code) for mobile app setup
router.get('/notifications/connection-info', async (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];
    for (const interfaceName of Object.keys(interfaces)) {
      const addresses = interfaces[interfaceName];
      if (addresses) {
        for (const addr of addresses) {
          if (addr.family === 'IPv4' && !addr.internal) {
            ips.push(addr.address);
          }
        }
      }
    }

    const port = process.env.PORT || 3000;
    const serverUrls = ips.map(ip => `http://${ip}:${port}`);

    // If no external IPs found, fall back to localhost
    if (serverUrls.length === 0) {
      serverUrls.push(`http://localhost:${port}`);
    }

    const qrData = JSON.stringify({ serverUrls });
    // Generate QR code data URL (base64 image)
    const qrCodeUrl = await QRCode.toDataURL(qrData, { width: 250, margin: 1 });

    res.json({
      success: true,
      ips,
      port,
      serverUrls,
      qrCodeUrl
    });
  } catch (err: any) {
    console.error('Failed to generate connection info:', err);
    res.status(500).json({ error: 'Failed to generate connection info: ' + err.message });
  }
});

// Real-time notifications SSE Stream
router.get('/notifications/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const listener = (eventData: any) => {
    res.write(`data: ${JSON.stringify(eventData)}\n\n`);
  };

  eventService.on('server_event', listener);

  req.on('close', () => {
    eventService.removeListener('server_event', listener);
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to notifications stream' })}\n\n`);
});

// Memory cache of online/offline status of devices to detect status changes
const deviceOnlineStateCache = new Map<string, number>();

// Register push notification token from mobile device
router.post('/notifications/register-token', async (req, res) => {
  const { token, deviceName, os } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    const db = await dbManager.getConnection();
    const devName = deviceName || 'Unknown';
    const devOs = os || 'Unknown';

    // Check if token was previously offline in cache (or not cached yet)
    const isNewOrOffline = !deviceOnlineStateCache.has(token) || deviceOnlineStateCache.get(token) === 0;

    await db.run(
      'INSERT OR REPLACE INTO push_tokens (token, device_name, os, last_seen) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [token, devName, devOs]
    );

    if (isNewOrOffline) {
      deviceOnlineStateCache.set(token, 1);
      // Log to database
      await db.run(
        'INSERT INTO device_connection_logs (token, device_name, os, status) VALUES (?, ?, ?, ?)',
        [token, devName, devOs, 'connected']
      );
      // Log connection to action_logs
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['DEVICE_CONNECT', `Mobile device "${devName}" (${devOs}) connected successfully`]
      );
      // Emit real-time SSE stream events
      eventService.emit('server_event', {
        type: 'notification',
        message: `Mobile device "${devName}" connected successfully!`,
        payload: {
          type: 'success',
          message: `Mobile device "${devName}" connected successfully!`,
          link: '/settings'
        }
      });
      eventService.emit('server_event', {
        type: 'device_status_change',
        payload: { token, device_name: devName, os: devOs, status: 'connected', timestamp: new Date().toISOString() }
      });
    } else {
      // Just update cache/last seen
      deviceOnlineStateCache.set(token, 1);
    }

    res.json({ success: true, message: 'Push token registered successfully' });
  } catch (err: any) {
    console.error('Failed to register push token:', err);
    res.status(500).json({ error: 'Failed to register token: ' + err.message });
  }
});

// Get all registered devices and check if they are currently online
router.get('/notifications/devices', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    // Deduplicate: for each (device_name, os) pair keep only the most-recently-seen row
    // A device offline = no last_seen update in 40 seconds (mobile pings every 15s)
    const rows = await db.all(`
      SELECT 
        token, 
        device_name, 
        os, 
        created_at,
        last_seen,
        CASE 
          WHEN last_seen IS NOT NULL AND (strftime('%s', 'now') - strftime('%s', last_seen) < 40) THEN 1 
          ELSE 0 
        END as is_online,
        CASE
          WHEN last_seen IS NULL THEN 999999
          ELSE (strftime('%s', 'now') - strftime('%s', last_seen))
        END as offline_seconds
      FROM push_tokens
      WHERE rowid IN (
        SELECT rowid FROM push_tokens p2
        WHERE p2.device_name = push_tokens.device_name AND p2.os = push_tokens.os
        ORDER BY last_seen DESC NULLS LAST
        LIMIT 1
      )
      ORDER BY last_seen DESC
    `);
    res.json({ success: true, devices: rows });
  } catch (err: any) {
    console.error('Failed to get registered devices:', err);
    res.status(500).json({ error: 'Failed to get devices: ' + err.message });
  }
});

// Rename a registered device
router.patch('/notifications/devices/:token/rename', async (req, res) => {
  const { token } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const db = await dbManager.getConnection();
    await db.run('UPDATE push_tokens SET device_name = ? WHERE token = ?', [name.trim(), token]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to rename device:', err);
    res.status(500).json({ error: 'Failed to rename device: ' + err.message });
  }
});

// Manual refill reminder endpoint
router.post('/patients/send-refill', async (req, res) => {
  const { whatsapp_number, name } = req.body;
  if (!whatsapp_number) {
    return res.status(400).json({ error: 'WhatsApp number required' });
  }
  try {
    // Simple reminder text – can be templated later
    const message = `Hello ${name || ''}, your medication refill is due soon. Please visit the pharmacy.`;
    // This would use a notification/WhatsApp service
    res.json({ success: true, message: 'Reminder sent (placeholder)' });
  } catch (err) {
    console.error('WhatsApp send error:', err);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});

// Get device activity logs
router.get('/notifications/devices/logs', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT * FROM device_connection_logs ORDER BY timestamp DESC LIMIT 150');
    res.json({ success: true, logs: rows });
  } catch (err: any) {
    console.error('Failed to fetch device logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs: ' + err.message });
  }
});

// Clear device activity logs
router.post('/notifications/devices/logs/clear', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM device_connection_logs');
    res.json({ success: true, message: 'Logs cleared successfully' });
  } catch (err: any) {
    console.error('Failed to clear device logs:', err);
    res.status(500).json({ error: 'Failed to clear logs: ' + err.message });
  }
});

// Get general app action logs
router.get('/notifications/action-logs', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT * FROM action_logs ORDER BY created_at DESC LIMIT 250');
    res.json({ success: true, logs: rows });
  } catch (err: any) {
    console.error('Failed to fetch action logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs: ' + err.message });
  }
});

// Clear general app action logs
router.post('/notifications/action-logs/clear', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM action_logs');
    res.json({ success: true, message: 'Action logs cleared successfully' });
  } catch (err: any) {
    console.error('Failed to clear action logs:', err);
    res.status(500).json({ error: 'Failed to clear logs: ' + err.message });
  }
});

// Save assistant chat log
router.post('/notifications/chat-logs', async (req, res) => {
  const { sessionId, deviceName, sender, messageText, metadata } = req.body;
  if (!sessionId || !sender || !messageText) {
    return res.status(400).json({ error: 'sessionId, sender and messageText are required' });
  }

  try {
    const db = await dbManager.getConnection();
    const metaStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;
    await db.run(
      'INSERT INTO assistant_chat_logs (session_id, device_name, sender, message_text, metadata) VALUES (?, ?, ?, ?, ?)',
      [sessionId, deviceName || 'Unknown Device', sender, messageText, metaStr]
    );

    // Write queries and result listings to system action_logs
    if (sender === 'user') {
      const cleanText = messageText.toLowerCase().trim();
      const hasSearchKeywords = cleanText.startsWith('find ') || 
                               cleanText.startsWith('search ') || 
                               cleanText.includes('dolo') || 
                               cleanText.includes('clavam') || 
                               cleanText.includes('crocin') || 
                               cleanText.includes('ondem') || 
                               cleanText.includes('pan');
      if (hasSearchKeywords) {
        const query = messageText.replace(/^(find|search)\s+/i, '').trim();
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['ASSISTANT_REQ', `User on "${deviceName || 'Mobile'}" asked to find product "${query}"`]
        );
      }
    } else if (sender === 'assistant' && metadata) {
      let products: any[] = [];
      try {
        products = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      } catch (e) {}

      if (Array.isArray(products) && products.length > 0) {
        const resultsStr = products.map((p: any) => 
          `${p.medicine_name || p.name || 'Unknown'} (Stock: ${p.quantity ?? 0}, Batch: ${p.batch_no || 'N/A'}, Exp: ${p.expiry_date || 'N/A'}, MRP: ₹${p.mrp || 0})`
        ).join(', ');
        
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['ASSISTANT_RES', `Assistant found ${products.length} matches: ${resultsStr}`]
        );
      } else {
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['ASSISTANT_RES', `Assistant searched but found no matches.`]
        );
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to save assistant chat log:', err);
    res.status(500).json({ error: 'Failed to save assistant chat log: ' + err.message });
  }
});

// Get assistant chat logs
router.get('/notifications/chat-logs', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT * FROM assistant_chat_logs ORDER BY created_at ASC LIMIT 1000');
    res.json({ success: true, logs: rows });
  } catch (err: any) {
    console.error('Failed to get assistant chat logs:', err);
    res.status(500).json({ error: 'Failed to get assistant chat logs: ' + err.message });
  }
});

// Clear assistant chat logs
router.post('/notifications/chat-logs/clear', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM assistant_chat_logs');
    res.json({ success: true, message: 'Assistant chat logs cleared successfully' });
  } catch (err: any) {
    console.error('Failed to clear assistant chat logs:', err);
    res.status(500).json({ error: 'Failed to clear assistant chat logs: ' + err.message });
  }
});

// Background connection state checking
async function checkDeviceConnections() {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(`
      SELECT 
        token, 
        device_name, 
        os, 
        CASE 
          WHEN last_seen IS NOT NULL AND (strftime('%s', 'now') - strftime('%s', last_seen) < 40) THEN 1 
          ELSE 0 
        END as is_online
      FROM push_tokens
      WHERE rowid IN (
        SELECT rowid FROM push_tokens p2
        WHERE p2.device_name = push_tokens.device_name AND p2.os = push_tokens.os
        ORDER BY last_seen DESC NULLS LAST
        LIMIT 1
      )
    `);

    for (const row of rows) {
      const { token, device_name, os, is_online } = row;
      const cached = deviceOnlineStateCache.get(token);

      if (cached !== undefined) {
        if (cached === 0 && is_online === 1) {
          deviceOnlineStateCache.set(token, 1);
          await db.run(
            'INSERT INTO device_connection_logs (token, device_name, os, status) VALUES (?, ?, ?, ?)',
            [token, device_name, os, 'connected']
          );
          await db.run(
            'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
            ['DEVICE_CONNECT', `Mobile device "${device_name}" (${os}) connected successfully`]
          );
          eventService.emit('server_event', {
            type: 'notification',
            message: `Mobile device "${device_name}" connected successfully!`,
            payload: {
              type: 'success',
              message: `Mobile device "${device_name}" connected successfully!`,
              link: '/settings'
            }
          });
          eventService.emit('server_event', {
            type: 'device_status_change',
            payload: { token, device_name, os, status: 'connected', timestamp: new Date().toISOString() }
          });
        } else if (cached === 1 && is_online === 0) {
          deviceOnlineStateCache.set(token, 0);
          await db.run(
            'INSERT INTO device_connection_logs (token, device_name, os, status) VALUES (?, ?, ?, ?)',
            [token, device_name, os, 'disconnected']
          );
          await db.run(
            'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
            ['DEVICE_DISCONNECT', `Mobile device "${device_name}" (${os}) disconnected`]
          );
          eventService.emit('server_event', {
            type: 'notification',
            message: `Mobile device "${device_name}" disconnected.`,
            payload: {
              type: 'error',
              message: `Mobile device "${device_name}" disconnected.`,
              link: '/settings'
            }
          });
          eventService.emit('server_event', {
            type: 'device_status_change',
            payload: { token, device_name, os, status: 'disconnected', timestamp: new Date().toISOString() }
          });
        }
      } else {
        deviceOnlineStateCache.set(token, is_online);
        // Ensure initial connection log exists to populate charts and logs immediately
        const status = is_online === 1 ? 'connected' : 'disconnected';
        const lastLog = await db.get(
          'SELECT status FROM device_connection_logs WHERE token = ? ORDER BY timestamp DESC LIMIT 1',
          [token]
        );
        if (!lastLog || lastLog.status !== status) {
          await db.run(
            'INSERT INTO device_connection_logs (token, device_name, os, status) VALUES (?, ?, ?, ?)',
            [token, device_name, os, status]
          );
          await db.run(
            'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
            [is_online === 1 ? 'DEVICE_CONNECT' : 'DEVICE_DISCONNECT', `Mobile device "${device_name}" (${os}) is initial ${status}`]
          );
        }
      }
    }
  } catch (err) {
    console.error('Error during periodic device monitoring:', err);
  }
}

// Check connections status every 10 seconds
setInterval(checkDeviceConnections, 10000);

export default router;
