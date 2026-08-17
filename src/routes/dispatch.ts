// Dispatch & Support API
import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { notificationService } from '../services/notificationService.js';
import { syncTodayActiveDistributors } from '../services/distributorDispatchReminderWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// ─── DISPATCH ORDERS ────────────────────────────────────────────────────────

// GET all dispatch orders (with delivery boy name joined)
router.get('/orders', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const orders = await db.all(`
      SELECT d.*, db.name as delivery_boy_name, db.whatsapp_number as delivery_boy_phone
      FROM dispatch_orders d
      LEFT JOIN delivery_boys db ON d.delivery_boy_id = db.id
      ORDER BY d.created_at DESC
      LIMIT 1000
    `);
        res.json(orders);
  } catch (err) {
    console.error('Dispatch orders fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch dispatch orders' });
  }
});

// POST create dispatch order
router.post('/orders', async (req, res) => {
  const { patient_name, patient_phone, address, items, notes, delivery_boy_id, invoice_no } = req.body;
  if (!patient_name) return res.status(400).json({ error: 'patient_name is required' });
  try {
    const db = await dbManager.getConnection();
    const result = await db.run(
      `INSERT INTO dispatch_orders (patient_name, patient_phone, address, items, notes, delivery_boy_id, invoice_no)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [patient_name, patient_phone || '', address || '', items || '', notes || '', delivery_boy_id || null, invoice_no || '']
    );
    const newOrder = await db.get(`
      SELECT d.*, db.name as delivery_boy_name FROM dispatch_orders d
      LEFT JOIN delivery_boys db ON d.delivery_boy_id = db.id WHERE d.id = ?`, result.lastID);

    if (invoice_no) {
      notificationService.notifyDistributorAboutDeliveryBoy(invoice_no).catch(err => {
        console.error('Failed to notify distributor in background (create order):', err);
      });
    }

    res.status(201).json(newOrder);
  } catch (err) {
    console.error('Create dispatch order error:', err);
    res.status(500).json({ error: 'Failed to create dispatch order' });
  }
});

// PUT update dispatch order status / fields
router.put('/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { status, delivery_boy_id, notes, address, patient_phone } = req.body;
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM dispatch_orders WHERE id = ?', id);
    if (!existing) {  return res.status(404).json({ error: 'Order not found' }); }

    const newStatus = status ?? existing.status;
    const newBoy = delivery_boy_id ?? existing.delivery_boy_id;
    const deliveredAt = newStatus === 'Delivered' && existing.status !== 'Delivered'
      ? new Date().toISOString() : existing.delivered_at;

    await db.run(
      `UPDATE dispatch_orders SET status=?, delivery_boy_id=?, notes=?, address=?, patient_phone=?, delivered_at=? WHERE id=?`,
      [newStatus, newBoy, notes ?? existing.notes, address ?? existing.address,
       patient_phone ?? existing.patient_phone, deliveredAt, id]
    );
    const updated = await db.get(`
      SELECT d.*, db.name as delivery_boy_name FROM dispatch_orders d
      LEFT JOIN delivery_boys db ON d.delivery_boy_id = db.id WHERE d.id = ?`, id);

    if (existing && existing.invoice_no) {
      notificationService.notifyDistributorAboutDeliveryBoy(existing.invoice_no).catch(err => {
        console.error('Failed to notify distributor in background (update order):', err);
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update dispatch order error:', err);
    res.status(500).json({ error: 'Failed to update dispatch order' });
  }
});

// DELETE dispatch order
router.delete('/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const result = await db.run('DELETE FROM dispatch_orders WHERE id = ?', id);
        if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete dispatch order error:', err);
    res.status(500).json({ error: 'Failed to delete dispatch order' });
  }
});

// ─── DELIVERY BOYS ────────────────────────────────────────────────────────────

const ensureDeliveryBoysTable = async (db: any) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS delivery_boys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      whatsapp_number TEXT,
      telegram_chat_id TEXT,
      is_active INTEGER DEFAULT 1
    )
  `);
};

// GET /api/dispatch/delivery-boys
router.get('/delivery-boys', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await ensureDeliveryBoysTable(db);
    const boys = await db.all('SELECT * FROM delivery_boys ORDER BY name');
    res.json(boys || []);
  } catch (error) {
    console.error('Fetch delivery boys error:', error);
    res.status(500).json({ error: 'Failed to fetch delivery boys' });
  }
});

// POST /api/dispatch/delivery-boys
router.post('/delivery-boys', async (req, res) => {
  const { name, whatsapp_number, telegram_chat_id, is_active } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Delivery boy name is required' });
  const rawDigits = whatsapp_number ? String(whatsapp_number).replace(/\D/g, '') : '';
  const cleanPhone = rawDigits ? rawDigits : null;
  const cleanName = String(name).trim();

  try {
    const db = await dbManager.getConnection();
    await ensureDeliveryBoysTable(db);
    
    // Upsert: check if record already exists by name or phone
    const existing = await db.get(
      'SELECT id FROM delivery_boys WHERE LOWER(name) = LOWER(?) OR (whatsapp_number IS NOT NULL AND whatsapp_number != "" AND whatsapp_number = ?)',
      [cleanName, cleanPhone]
    );

    let targetId: number;
    if (existing) {
      targetId = existing.id;
      await db.run(
        'UPDATE delivery_boys SET name = ?, whatsapp_number = ?, is_active = 1 WHERE id = ?',
        [cleanName, cleanPhone, existing.id]
      );
    } else {
      const result = await db.run(
        'INSERT INTO delivery_boys (name, whatsapp_number, telegram_chat_id, is_active) VALUES (?, ?, ?, ?)',
        [cleanName, cleanPhone, telegram_chat_id || null, is_active !== undefined ? is_active : 1]
      );
      targetId = result.lastID || 0;
    }

    const savedBoy = await db.get('SELECT * FROM delivery_boys WHERE id = ?', targetId);

    if (cleanPhone) {
      try {
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('delivery_boy_phone', ?)", [cleanPhone]);
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('delivery_boy_whatsapp', ?)", [cleanPhone]);
      } catch (_) {}
    }

    res.status(201).json(savedBoy);
  } catch (error: any) {
    console.error('Add delivery boy error:', error);
    res.status(500).json({ error: error?.message || 'Failed to add delivery boy' });
  }
});

// PUT /api/dispatch/delivery-boys/:id
router.put('/delivery-boys/:id', async (req, res) => {
  const { id } = req.params;
  const { name, whatsapp_number, telegram_chat_id, is_active } = req.body;
  try {
    const db = await dbManager.getConnection();
    await ensureDeliveryBoysTable(db);
    const existing = await db.get('SELECT * FROM delivery_boys WHERE id = ?', id);
    if (!existing) { return res.status(404).json({ error: 'Delivery boy not found' }); }
    const rawDigits = whatsapp_number !== undefined ? (whatsapp_number ? String(whatsapp_number).replace(/\D/g, '') : '') : null;
    const cleanPhone = whatsapp_number !== undefined ? (rawDigits ? rawDigits : null) : existing.whatsapp_number;
    await db.run(
      `UPDATE delivery_boys SET name=?, whatsapp_number=?, telegram_chat_id=?, is_active=? WHERE id=?`,
      [
        name !== undefined && name !== null ? String(name).trim() : existing.name,
        cleanPhone,
        telegram_chat_id !== undefined ? telegram_chat_id : existing.telegram_chat_id,
        is_active !== undefined ? is_active : existing.is_active,
        id
      ]
    );
    const updated = await db.get('SELECT * FROM delivery_boys WHERE id = ?', id);

    if (cleanPhone) {
      try {
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('delivery_boy_phone', ?)", [cleanPhone]);
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('delivery_boy_whatsapp', ?)", [cleanPhone]);
      } catch (_) {}
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Update delivery boy error:', error);
    res.status(500).json({ error: error?.message || 'Failed to update delivery boy' });
  }
});

// DELETE /api/dispatch/delivery-boys/:id
router.delete('/delivery-boys/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const result = await db.run('DELETE FROM delivery_boys WHERE id = ?', id);
    if (result.changes === 0) return res.status(404).json({ error: 'Delivery boy not found' });
    res.json({ success: true, message: 'Delivery boy deleted' });
  } catch (error: any) {
    console.error('Delete delivery boy error:', error);
    res.status(500).json({ error: error?.message || 'Failed to delete delivery boy' });
  }
});

// GET /api/dispatch/messages/dates - Available dates with delivery boy messages
router.get('/messages/dates', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(`
      SELECT DISTINCT date(created_at) as date_str
      FROM automation_notifications
      WHERE type IN (
        'delivery_boy_dispatch', 'delivery_boy_notification', 'delivery_assignment',
        'admin_shortage_reminder', 'dispatch', 'delivery_boy_cart_order',
        'delivery_boy_summary', 'distributor_cart_order'
      )
      ORDER BY date_str DESC
      LIMIT 30
    `);
    const dates = rows.map((r: any) => r.date_str).filter(Boolean);
    res.json({ success: true, dates });
  } catch (error: any) {
    console.error('Fetch delivery message dates error:', error);
    res.status(500).json({ error: 'Failed to fetch message dates' });
  }
});

// GET /api/dispatch/messages - Fetch sent messages for a specific date
router.get('/messages', async (req, res) => {
  const targetDate = req.query.date ? String(req.query.date) : new Date().toISOString().split('T')[0];
  try {
    const db = await dbManager.getConnection();
    const messages = await db.all(`
      SELECT id, type, recipient_name, recipient_phone, message, status, error_message, created_at
      FROM automation_notifications
      WHERE date(created_at) = ?
        AND type IN (
          'delivery_boy_dispatch', 'delivery_boy_notification', 'delivery_assignment',
          'admin_shortage_reminder', 'dispatch', 'delivery_boy_cart_order',
          'delivery_boy_summary', 'distributor_cart_order'
        )
      ORDER BY created_at DESC
    `, [targetDate]);

    res.json({ success: true, date: targetDate, messages });
  } catch (error: any) {
    console.error('Fetch delivery messages error:', error);
    res.status(500).json({ error: 'Failed to fetch delivery messages' });
  }
});

// ─── DISTRIBUTOR DISPATCH REMINDERS ──────────────────────────────────────────

// GET today's distributor reminders (strictly today's orders & emails only)
router.get('/distributor-reminders/today', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const [startSetting, endSetting, afternoonEnabledSetting, afternoonTimeSetting] = await Promise.all([
      db.get("SELECT value FROM app_settings WHERE key = 'trigger_dispatch_reminder_time_start'"),
      db.get("SELECT value FROM app_settings WHERE key = 'trigger_dispatch_reminder_time_end'"),
      db.get("SELECT value FROM app_settings WHERE key = 'trigger_afternoon_dispatch_reminder_enabled'"),
      db.get("SELECT value FROM app_settings WHERE key = 'trigger_afternoon_dispatch_reminder_time'")
    ]);

    const reminders = await syncTodayActiveDistributors();
    res.json({
      success: true,
      window_start: startSetting?.value || '12:30',
      window_end: endSetting?.value || '13:00',
      afternoon_enabled: afternoonEnabledSetting?.value !== 'false',
      afternoon_time: afternoonTimeSetting?.value || '14:00',
      is_recent_fallback: false,
      recent_date: null,
      reminders: reminders || []
    });
  } catch (error: any) {
    console.error('Fetch distributor reminders error:', error);
    res.status(500).json({ error: 'Failed to fetch distributor reminders' });
  }
});

// POST send afternoon consolidated Delivery Boy dispatch summary
router.post('/distributor-reminders/afternoon-delivery-boy-dispatch', async (_req, res) => {
  try {
    const reminders = await syncTodayActiveDistributors();
    const result = await notificationService.sendConsolidatedDeliveryBoyDispatch(reminders);
    if (result.ok) {
      res.json({ success: true, message: result.message || 'Afternoon dispatch summary sent to Delivery Boy!' });
    } else {
      res.status(500).json({ error: result.message || 'Failed to send afternoon dispatch to Delivery Boy.' });
    }
  } catch (error: any) {
    console.error('Send afternoon delivery boy dispatch error:', error);
    res.status(500).json({ error: error?.message || 'Failed to send afternoon delivery boy dispatch' });
  }
});

// POST toggle auto-remind status for a distributor reminder
router.post('/distributor-reminders/toggle-auto', async (req, res) => {
  const { id, auto_remind } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const db = await dbManager.getConnection();
    const val = auto_remind ? 1 : 0;
    await db.run('UPDATE distributor_dispatch_reminders SET auto_remind = ? WHERE id = ?', [val, id]);
    const updated = await db.get('SELECT * FROM distributor_dispatch_reminders WHERE id = ?', [id]);
    res.json({ success: true, reminder: updated });
  } catch (error: any) {
    console.error('Toggle auto-remind error:', error);
    res.status(500).json({ error: 'Failed to toggle auto-remind' });
  }
});

// PUT update reminder status (Pending, Dispatched, Collected) & delivery_boy_id
router.put('/distributor-reminders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, delivery_boy_id, distributor_name, distributor_phone } = req.body;

  try {
    const db = await dbManager.getConnection();
    let existing = await db.get('SELECT * FROM distributor_dispatch_reminders WHERE id = ?', [id]);

    if (!existing && distributor_name) {
      const todayStr = new Date().toISOString().split('T')[0];
      existing = await db.get(
        'SELECT * FROM distributor_dispatch_reminders WHERE date = ? AND LOWER(TRIM(distributor_name)) = LOWER(TRIM(?))',
        [todayStr, distributor_name]
      );

      if (!existing) {
        const ins = await db.run(
          `INSERT INTO distributor_dispatch_reminders (distributor_name, distributor_phone, date, status, auto_remind, delivery_boy_id, order_source)
           VALUES (?, ?, ?, ?, 1, ?, 'manual')`,
          [distributor_name, distributor_phone || '', todayStr, status || 'Pending', delivery_boy_id || null]
        );
        existing = await db.get('SELECT * FROM distributor_dispatch_reminders WHERE id = ?', [ins.lastID]);
      }
    }

    if (!existing) return res.status(404).json({ error: 'Reminder not found' });

    const newStatus = status || existing.status;
    const newBoy = delivery_boy_id !== undefined ? delivery_boy_id : existing.delivery_boy_id;

    await db.run(
      'UPDATE distributor_dispatch_reminders SET status = ?, delivery_boy_id = ? WHERE id = ?',
      [newStatus, newBoy, existing.id]
    );

    const updated = await db.get(
      `SELECT r.*, db.name as delivery_boy_name, db.whatsapp_number as delivery_boy_phone
       FROM distributor_dispatch_reminders r
       LEFT JOIN delivery_boys db ON r.delivery_boy_id = db.id
       WHERE r.id = ?`,
      [existing.id]
    );

    res.json({ success: true, reminder: updated });
  } catch (error: any) {
    console.error('Update reminder status error:', error);
    res.status(500).json({ error: 'Failed to update reminder status' });
  }
});

// GET global reminder message template
router.get('/distributor-reminders/template', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'distributor_reminder_template'");
    res.json({
      success: true,
      template: row?.value || "📦 Has today's order been dispatched or collected by {delivery_boy} ({phone})? - {store_name}"
    });
  } catch (error: any) {
    console.error('Fetch reminder template error:', error);
    res.status(500).json({ error: 'Failed to fetch reminder template' });
  }
});

// POST save global reminder message template
router.post('/distributor-reminders/template', async (req, res) => {
  const { template } = req.body;
  try {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('distributor_reminder_template', ?)", [template || '']);
    res.json({ success: true, message: 'Reminder template saved', template });
  } catch (error: any) {
    console.error('Save reminder template error:', error);
    res.status(500).json({ error: 'Failed to save reminder template' });
  }
});

// POST send WhatsApp reminder now (supports custom message)
router.post('/distributor-reminders/:id/send-now', async (req, res) => {
  const { id } = req.params;
  const { custom_message } = req.body || {};
  try {
    const ok = await notificationService.sendDistributorDispatchReminder(Number(id), custom_message);
    if (ok) {
      res.json({ success: true, message: 'WhatsApp reminder sent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to send WhatsApp reminder. Check logs or distributor phone number.' });
    }
  } catch (error: any) {
    console.error('Send now distributor reminder error:', error);
    res.status(500).json({ error: error.message || 'Failed to send reminder' });
  }
});

// POST add manual phone call order reminder
router.post('/distributor-reminders/manual-order', async (req, res) => {
  const { distributor_name, distributor_phone, distributor_id, delivery_boy_id, date } = req.body;
  if (!distributor_name) return res.status(400).json({ error: 'distributor_name is required' });

  const targetDate = date || new Date().toISOString().split('T')[0];

  try {
    const db = await dbManager.getConnection();
    const cleanName = String(distributor_name).trim();

    // Check if entry already exists for targetDate and distributor_name
    const existing = await db.get(
      `SELECT id FROM distributor_dispatch_reminders WHERE date = ? AND LOWER(TRIM(distributor_name)) = LOWER(TRIM(?))`,
      [targetDate, cleanName]
    );

    let reminderId = existing?.id;

    if (existing) {
      await db.run(
        `UPDATE distributor_dispatch_reminders 
         SET distributor_id = COALESCE(?, distributor_id),
             distributor_phone = CASE WHEN ? != '' THEN ? ELSE distributor_phone END,
             delivery_boy_id = COALESCE(?, delivery_boy_id),
             order_source = 'phone_call'
         WHERE id = ?`,
        [distributor_id || null, distributor_phone || '', distributor_phone || '', delivery_boy_id || null, existing.id]
      );
    } else {
      const result = await db.run(
        `INSERT INTO distributor_dispatch_reminders
         (distributor_id, distributor_name, distributor_phone, delivery_boy_id, date, status, auto_remind, order_source)
         VALUES (?, ?, ?, ?, ?, 'Pending', 1, 'phone_call')`,
        [distributor_id || null, cleanName, distributor_phone || '', delivery_boy_id || null, targetDate]
      );
      reminderId = result.lastID;
    }

    const newReminder = await db.get(
      `SELECT r.*, db.name as delivery_boy_name, db.whatsapp_number as delivery_boy_phone
       FROM distributor_dispatch_reminders r
       LEFT JOIN delivery_boys db ON r.delivery_boy_id = db.id
       WHERE r.id = ?`,
      [reminderId]
    );

    res.status(201).json({ success: true, reminder: newReminder });
  } catch (error: any) {
    console.error('Manual order creation error:', error);
    res.status(500).json({ error: 'Failed to create manual phone call order reminder' });
  }
});

// POST 1-Click retry failed or skipped reminder (with optional updated phone)
router.post('/distributor-reminders/:id/retry', async (req, res) => {
  const { id } = req.params;
  const { updated_phone, custom_message } = req.body || {};

  try {
    const db = await dbManager.getConnection();
    const reminder = await db.get('SELECT * FROM distributor_dispatch_reminders WHERE id = ?', [id]);
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });

    if (updated_phone && String(updated_phone).trim()) {
      const cleanPhone = String(updated_phone).replace(/[^0-9]/g, '');
      await db.run('UPDATE distributor_dispatch_reminders SET distributor_phone = ? WHERE id = ?', [cleanPhone, id]);
      if (reminder.distributor_id) {
        await db.run('UPDATE distributors SET phone = ? WHERE id = ?', [cleanPhone, reminder.distributor_id]);
      }
    }

    // Reset status back to Pending for resend attempt
    await db.run("UPDATE distributor_dispatch_reminders SET status = 'Pending' WHERE id = ?", [id]);

    const ok = await notificationService.sendDistributorDispatchReminder(Number(id), custom_message);
    if (ok) {
      res.json({ success: true, message: 'WhatsApp reminder resent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to resend WhatsApp reminder. Check phone number or connection.' });
    }
  } catch (error: any) {
    console.error('Retry distributor reminder error:', error);
    res.status(500).json({ error: error?.message || 'Failed to retry reminder' });
  }
});

// GET central communication audit log (all reminder/whatsapp notifications)
router.get('/audit-logs', async (req, res) => {
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 500) : 100;
  const statusFilter = req.query.status ? String(req.query.status) : null;

  try {
    const db = await dbManager.getConnection();
    let query = `
      SELECT id, type, recipient_name, recipient_phone, message, status, error_message, reference_id, created_at
      FROM automation_notifications
    `;
    const params: any[] = [];

    if (statusFilter) {
      query += ` WHERE status = ?`;
      params.push(statusFilter);
    }

    query += ` ORDER BY id DESC LIMIT ?`;
    params.push(limit);

    const logs = await db.all(query, params);
    res.json({ success: true, count: logs.length, logs });
  } catch (error: any) {
    console.error('Fetch communication audit logs error:', error);
    res.status(500).json({ error: 'Failed to fetch communication audit logs' });
  }
});

// Legacy support route
router.post('/', async (req, res) => {
  const { type, description } = req.body;
  if (!type || !description) return res.status(400).json({ error: 'type and description required' });
  try {
    const db = await dbManager.getConnection();
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', ['DISPATCH', `${type}: ${description}`]);
    res.json({ success: true, message: 'Dispatch logged' });
  } catch (error) {
    console.error('Dispatch error:', error);
    res.status(500).json({ error: 'Failed to log dispatch' });
  }
});

export default router;

