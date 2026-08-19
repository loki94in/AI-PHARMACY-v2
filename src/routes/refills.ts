import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkAllRefills } from '../services/refillService.js';
import { sendMessage, normalizeWhatsAppPhone } from '../whatsappClient.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { getMessage } from '../i18n/getMessage.js';
import { getConfiguredPharmacyName } from '../services/storeSettingsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Helper to parse dynamic or text-based interval descriptions into numbers
function parseIntervalDays(val: any): number {
  if (typeof val === 'string') {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleaned === 'weekly' || cleaned === '7days') return 7;
    if (cleaned === '15days') return 15;
    if (cleaned === 'monthly' || cleaned === '30days') return 30;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 30 : parsed;
  }
  if (typeof val === 'number') return val;
  return 30;
}

// Register a manual patient refill request
router.post('/', async (req, res) => {
  const { patient_name, patient_phone, medicine_id, refill_interval_days = 30 } = req.body;
  if (!patient_name || !patient_phone || !medicine_id) {
    return res.status(400).json({ error: 'patient_name, patient_phone, and medicine_id are required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    
    // Calculate next refill date
    const intervalDays = parseIntervalDays(refill_interval_days);
    const nextRefillDate = new Date();
    nextRefillDate.setDate(nextRefillDate.getDate() + intervalDays);
    const nextRefillStr = nextRefillDate.toISOString().slice(0, 19).replace('T', ' ');

    // Resolve or auto-create customer profile in customers table
    const cleanPhone = (patient_phone || '').trim();
    const cleanName = (patient_name || 'Customer').trim();
    let customerId = req.body.customer_id || null;
    if (!customerId && (cleanPhone || cleanName)) {
      let cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (!cust && cleanName && cleanName.toLowerCase() !== 'customer') {
        cust = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [cleanName]);
      }
      if (cust) {
        customerId = cust.id;
      } else if (cleanPhone || cleanName) {
        const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [cleanName, cleanPhone]);
        customerId = custRes.lastID;
      }
    }

    const quantityNeeded = parseInt(req.body.quantity_needed || req.body.quantity, 10) || 3;

    await db.run(
      `INSERT INTO patient_refills (customer_id, patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status, quantity_needed)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [customerId, patient_name, patient_phone, medicine_id, intervalDays, nextRefillStr, quantityNeeded]
    );

    // Run a check immediately in case the medicine is already in stock!
    await checkAllRefills(db);

    res.json({ success: true, message: 'Refill registered successfully', interval_days: intervalDays });
  } catch (err) {
    console.error('Failed to register refill:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update an existing patient's refill prescription & medicines
router.put('/patient-medicines', async (req, res) => {
  const { original_phone, patient_name, patient_phone, refill_interval_days = 30, medicines } = req.body;
  if (!patient_name || !patient_phone || !Array.isArray(medicines) || medicines.length === 0) {
    return res.status(400).json({ error: 'patient_name, patient_phone, and valid medicines array are required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();

    const intervalDays = parseIntervalDays(refill_interval_days);
    const cleanPhone = (patient_phone || '').trim();
    const origPhone = (original_phone || cleanPhone).trim();
    const cleanName = (patient_name || 'Customer').trim();

    // Resolve or auto-create customer profile in customers table
    let customerId = req.body.customer_id || null;
    if (!customerId && (cleanPhone || cleanName)) {
      let cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (!cust && cleanName && cleanName.toLowerCase() !== 'customer') {
        cust = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [cleanName]);
      }
      if (cust) {
        customerId = cust.id;
      } else if (cleanPhone || cleanName) {
        const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [cleanName, cleanPhone]);
        customerId = custRes.lastID;
      }
    }

    // Check if there was an existing next_refill_date for this patient
    const existingRefill = await db.get(
      'SELECT next_refill_date, last_refill_date FROM patient_refills WHERE patient_phone = ? OR patient_phone = ? ORDER BY next_refill_date ASC LIMIT 1',
      [origPhone, cleanPhone]
    );

    let nextRefillStr: string;
    if (existingRefill && existingRefill.next_refill_date && new Date(existingRefill.next_refill_date) > new Date()) {
      nextRefillStr = existingRefill.next_refill_date;
    } else {
      const nextRefillDate = new Date();
      nextRefillDate.setDate(nextRefillDate.getDate() + intervalDays);
      nextRefillStr = nextRefillDate.toISOString().slice(0, 19).replace('T', ' ');
    }

    // Delete previous refill records for this patient
    await db.run('DELETE FROM patient_refills WHERE patient_phone = ? OR patient_phone = ?', [origPhone, cleanPhone]);

    // Insert updated medicines
    for (const med of medicines) {
      const medId = med.medicine_id || med.medicineId;
      if (!medId) continue;
      const qtyNeeded = parseInt(med.quantity_needed || med.quantity, 10) || 3;
      await db.run(
        `INSERT INTO patient_refills (customer_id, patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status, quantity_needed, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 1)`,
        [customerId, cleanName, cleanPhone, medId, intervalDays, nextRefillStr, qtyNeeded]
      );
    }

    // Re-check inventory stock and trigger necessary alerts/schedules
    await checkAllRefills(db);

    res.json({ success: true, message: 'Patient refill schedule updated successfully', interval_days: intervalDays });
  } catch (err: any) {
    console.error('Failed to update patient refills:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// List all refill schedules
router.get('/', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const refills = await db.all(
      `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       ORDER BY pr.next_refill_date ASC LIMIT 1000`
    );
        res.json(refills);
  } catch (err) {
    console.error('Failed to fetch refills:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Trigger a manual run of checkAllRefills
router.post('/check', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    await checkAllRefills(db);
        res.json({ success: true, message: 'Refill check complete' });
  } catch (err) {
    console.error('Failed to check refills:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a refill schedule manually
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status, hold_for_stock, is_active } = req.body;

  let db;
  try {
    db = await dbManager.getConnection();
    
    // Check if refill exists
    const refill = await db.get('SELECT * FROM patient_refills WHERE id = ?', [id]);
    if (!refill) {
      return res.status(404).json({ error: 'Refill not found' });
    }

    const updatedName = patient_name !== undefined ? patient_name : refill.patient_name;
    const updatedPhone = patient_phone !== undefined ? patient_phone : refill.patient_phone;
    const updatedMedicineId = medicine_id !== undefined ? medicine_id : refill.medicine_id;
    const updatedInterval = refill_interval_days !== undefined ? parseIntervalDays(refill_interval_days) : refill.refill_interval_days;
    const updatedNextDate = next_refill_date !== undefined ? next_refill_date : refill.next_refill_date;
    const updatedStatus = (status !== undefined && (status === 'pending' || status === 'notified')) ? status : refill.status;
    const updatedHold = hold_for_stock !== undefined ? parseInt(hold_for_stock, 10) : refill.hold_for_stock;
    const updatedIsActive = is_active !== undefined ? (is_active ? 1 : 0) : (refill.is_active !== undefined ? refill.is_active : 1);
    const updatedIsReady = req.body.is_ready !== undefined ? (req.body.is_ready ? 1 : 0) : refill.is_ready;
    const updatedQty = req.body.quantity_needed !== undefined ? parseInt(req.body.quantity_needed, 10) : (refill.quantity_needed || 3);

    await db.run(
      `UPDATE patient_refills 
       SET patient_name = ?, patient_phone = ?, medicine_id = ?, refill_interval_days = ?, next_refill_date = ?, status = ?, hold_for_stock = ?, is_active = ?, is_ready = ?, quantity_needed = ?
       WHERE id = ?`,
      [updatedName, updatedPhone, updatedMedicineId, updatedInterval, updatedNextDate, updatedStatus, updatedHold, updatedIsActive, updatedIsReady, updatedQty, id]
    );

    // If marked back to pending or values changed, re-run refilling triggers
    if (updatedStatus === 'pending') {
      await checkAllRefills(db);
    }

    res.json({ success: true, message: 'Refill updated successfully', interval_days: updatedInterval });
  } catch (err) {
    console.error('Failed to update refill:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Acknowledge a refill's stock alert (stop blinking)
router.post('/:id/acknowledge', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    await db.run('UPDATE patient_refills SET acknowledged = 1 WHERE id = ?', [id]);
    res.json({ success: true, message: 'Refill stock alert acknowledged' });
  } catch (err: any) {
    console.error('Failed to acknowledge refill:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Skip refill for today (advances by 1 day)
router.post('/:id/skip', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const refill = await db.get('SELECT * FROM patient_refills WHERE id = ?', [id]);
    if (!refill) {
      return res.status(404).json({ error: 'Refill not found' });
    }
    
    const nextDate = new Date(refill.next_refill_date || refill.last_refill_date || new Date());
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');

    await db.run(
      `UPDATE patient_refills 
       SET next_refill_date = ?, acknowledged = 0, ordering_triggered = 0, is_ready = 0, hold_for_stock = 0, stock_verified_override = 0,
           reminder_status = 'NOT_SENT', reminder_sent_at = NULL, reminder_job_id = NULL, reminder_occurrence_date = NULL
       WHERE id = ?`,
      [nextDateStr, id]
    );

    // Update staged notification to skipped
    await db.run(
      `UPDATE automation_notifications 
       SET lifecycle_status = 'skipped' 
       WHERE type = 'refill_collection' AND reference_id = ? AND lifecycle_status = 'staged'`,
      [String(id)]
    );

    res.json({ success: true, message: 'Refill skipped successfully for today' });
  } catch (err: any) {
    console.error('Failed to skip refill:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Grouped refill panel list with stock pre-check
router.get('/panel', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    
    // Fetch refill notice days setting
    let noticeDays = 3;
    const setting = await db.get("SELECT value FROM app_settings WHERE key = 'refill_notice_days'");
    if (setting && setting.value) {
      noticeDays = parseInt(setting.value, 10) || 3;
    }

    // Optional upcoming_days query parameter (if omitted, returns all patient refills for CRM management)
    const upcomingDays = req.query.upcoming_days ? parseInt(req.query.upcoming_days as string, 10) : null;
    let query = `SELECT pr.*, m.name as medicine_name, COALESCE(inv.in_stock_qty, 0) as in_stock_qty 
       FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       LEFT JOIN (
         SELECT medicine_id, (SUM(quantity) + COALESCE(SUM(loose_quantity), 0)) as in_stock_qty 
         FROM inventory_master 
         GROUP BY medicine_id
       ) inv ON inv.medicine_id = pr.medicine_id`;
    const params: any[] = [];
    if (upcomingDays && !isNaN(upcomingDays) && upcomingDays > 0) {
      query += ` WHERE pr.next_refill_date <= date('now', '+' || ? || ' days')`;
      params.push(upcomingDays);
    }
    query += ` ORDER BY pr.next_refill_date ASC LIMIT 1000`;

    const rows = await db.all(query, params);

    const patientGroups: Record<string, any> = {};
    for (const row of rows) {
      const phone = row.patient_phone;
      if (!patientGroups[phone]) {
        patientGroups[phone] = {
          patient_name: row.patient_name,
          patient_phone: row.patient_phone,
          next_refill_date: row.next_refill_date,
          reminder_status: 'NOT_SENT',
          reminder_sent_at: null,
          medicines: []
        };
      }
      // If a row has an earlier due date, use that as the group's next refill date
      if (new Date(row.next_refill_date) < new Date(patientGroups[phone].next_refill_date)) {
        patientGroups[phone].next_refill_date = row.next_refill_date;
      }
      const medReminderStatus = row.reminder_status || (row.status === 'notified' ? 'SENT' : 'NOT_SENT');
      patientGroups[phone].medicines.push({
        id: row.id,
        medicine_id: row.medicine_id,
        medicine_name: row.medicine_name,
        quantity_needed: (row.quantity_needed !== undefined && row.quantity_needed !== null) ? row.quantity_needed : 3, // default refill quantity: 3
        refill_interval_days: row.refill_interval_days || 30,
        in_stock_qty: row.in_stock_qty || 0,
        stock_verified_override: row.stock_verified_override || 0,
        acknowledged: row.acknowledged || 0,
        hold_for_stock: row.hold_for_stock || 0,
        is_ready: row.is_ready || 0,
        is_active: row.is_active !== undefined ? row.is_active : 1,
        status: row.is_active === 0 ? 'paused' : (row.status || 'pending'),
        quick_bill_id: row.quick_bill_id,
        reminder_status: medReminderStatus,
        reminder_sent_at: row.reminder_sent_at || null,
        reminder_job_id: row.reminder_job_id || null,
        reminder_occurrence_date: row.reminder_occurrence_date || null
      });
    }

    // Aggregate group-level reminder status and latest sent timestamp
    for (const group of Object.values(patientGroups)) {
      const activeMeds = group.medicines.filter((m: any) => m.is_active !== 0);
      if (activeMeds.length > 0) {
        if (activeMeds.every((m: any) => m.reminder_status === 'SENT')) {
          group.reminder_status = 'SENT';
          const sentDates = activeMeds.map((m: any) => m.reminder_sent_at).filter(Boolean);
          group.reminder_sent_at = sentDates.length > 0 ? sentDates.sort().reverse()[0] : null;
        } else if (activeMeds.some((m: any) => m.reminder_status === 'SENDING')) {
          group.reminder_status = 'SENDING';
        } else if (activeMeds.some((m: any) => m.reminder_status === 'QUEUED')) {
          group.reminder_status = 'QUEUED';
        } else if (activeMeds.some((m: any) => m.reminder_status === 'FAILED')) {
          group.reminder_status = 'FAILED';
        } else {
          group.reminder_status = 'NOT_SENT';
        }
      }
    }

    res.json(Object.values(patientGroups));
  } catch (err: any) {
    console.error('Failed to fetch refill panel:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Toggle pause/resume on a refill record
router.post('/:id/toggle-pause', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const refill = await db.get('SELECT * FROM patient_refills WHERE id = ?', [id]);
    if (!refill) {
      return res.status(404).json({ error: 'Refill record not found' });
    }

    const newIsActive = (refill.is_active === 0) ? 1 : 0;

    if (newIsActive === 0) {
      await db.run(
        `UPDATE patient_refills SET is_active = 0, is_ready = 0, hold_for_stock = 0 WHERE id = ?`,
        [id]
      );
      await db.run(
        `UPDATE automation_notifications SET lifecycle_status = 'skipped' 
         WHERE type = 'refill_collection' AND reference_id = ? AND lifecycle_status = 'staged'`,
        [String(id)]
      );
    } else {
      await db.run(
        'UPDATE patient_refills SET is_active = 1 WHERE id = ?',
        [id]
      );
    }

    // Re-run check to recalculate ready state or staged notifications
    await checkAllRefills(db);

    res.json({
      success: true,
      is_active: newIsActive,
      message: `Refill schedule ${newIsActive === 0 ? 'paused' : 'resumed'} successfully`
    });
  } catch (err: any) {
    console.error('Failed to toggle refill pause:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Soft-cancel a refill record
router.post('/:id/cancel', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    await db.run(
      'UPDATE patient_refills SET is_active = 0, is_ready = 0, hold_for_stock = 0 WHERE id = ?',
      [id]
    );
    await db.run(
      `UPDATE automation_notifications SET lifecycle_status = 'skipped' 
       WHERE type = 'refill_collection' AND reference_id = ? AND lifecycle_status = 'staged'`,
      [String(id)]
    );
    await checkAllRefills(db);
    res.json({ success: true, message: 'Refill schedule canceled successfully' });
  } catch (err: any) {
    console.error('Failed to cancel refill:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Update refill frequency / interval days & recalculate next due date
router.put('/:id/frequency', async (req, res) => {
  const { id } = req.params;
  const { refill_interval_days } = req.body;
  const interval = parseInt(refill_interval_days, 10);
  if (!interval || interval <= 0) {
    return res.status(400).json({ error: 'Valid refill interval days required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    const refill = await db.get('SELECT * FROM patient_refills WHERE id = ?', [id]);
    if (!refill) {
      return res.status(404).json({ error: 'Refill record not found' });
    }

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);
    const nextDateStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');

    await db.run(
      'UPDATE patient_refills SET refill_interval_days = ?, next_refill_date = ? WHERE id = ?',
      [interval, nextDateStr, id]
    );

    await checkAllRefills(db);

    res.json({ success: true, message: `Refill frequency updated to ${interval} days (due on ${nextDateStr.substring(0, 10)})`, next_refill_date: nextDateStr });
  } catch (err: any) {
    console.error('Failed to update refill frequency:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Toggle the physical stock verified override
router.post('/:id/toggle-override', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const refill = await db.get('SELECT stock_verified_override FROM patient_refills WHERE id = ?', [id]);
    if (!refill) {
      return res.status(404).json({ error: 'Refill not found' });
    }

    const nextVal = refill.stock_verified_override === 1 ? 0 : 1;
    await db.run('UPDATE patient_refills SET stock_verified_override = ? WHERE id = ?', [nextVal, id]);
    
    // Re-run checking engine to update quick-bills or special orders
    await checkAllRefills(db);

    res.json({ success: true, stock_verified_override: nextVal });
  } catch (err: any) {
    console.error('Failed to toggle stock override:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Fulfill a refill manually (advances next cycle)
router.post('/:id/fulfill', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const refill = await db.get('SELECT * FROM patient_refills WHERE id = ?', [id]);
    if (!refill) {
      return res.status(404).json({ error: 'Refill not found' });
    }

    const interval = refill.refill_interval_days || 30;
    const nextDate = new Date(refill.next_refill_date || new Date());
    nextDate.setDate(nextDate.getDate() + interval);
    const nextDateStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');

    await db.run(
      `UPDATE patient_refills 
       SET last_refill_date = datetime('now'),
           next_refill_date = ?,
           stock_verified_override = 0,
           ordering_triggered = 0,
           is_ready = 0,
           hold_for_stock = 0,
           quick_bill_id = NULL,
           status = 'pending',
           reminder_status = 'NOT_SENT',
           reminder_sent_at = NULL,
           reminder_job_id = NULL,
           reminder_occurrence_date = NULL
       WHERE id = ?`,
      [nextDateStr, id]
    );

    // Update staged notification to completed
    await db.run(
      `UPDATE automation_notifications 
       SET lifecycle_status = 'sent' 
       WHERE type = 'refill_collection' AND reference_id = ? AND lifecycle_status = 'staged'`,
      [String(id)]
    );

    // Re-run checking engine to process the next cycle or sibling refills
    await checkAllRefills(db);

    res.json({ success: true, message: 'Refill marked as fulfilled and advanced to next cycle.' });
  } catch (err: any) {
    console.error('Failed to fulfill refill:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Update refill status specifically (supports POST /:id/status and PUT /:id/status)
const handleRefillStatusUpdate = async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status || typeof status !== 'string') {
    return res.status(400).json({ error: 'Valid status is required' });
  }

  const normalizedStatus = status.toLowerCase().trim();
  let db;
  try {
    db = await dbManager.getConnection();
    const refill = await db.get('SELECT * FROM patient_refills WHERE id = ?', [id]);
    if (!refill) {
      return res.status(404).json({ error: 'Refill not found' });
    }

    if (normalizedStatus === 'completed' || normalizedStatus === 'fulfilled') {
      const interval = refill.refill_interval_days || 30;
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + interval);
      const nextDateStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');

      await db.run(
        `UPDATE patient_refills 
         SET last_refill_date = datetime('now'),
             next_refill_date = ?,
             stock_verified_override = 0,
             ordering_triggered = 0,
             is_ready = 0,
             hold_for_stock = 0,
             quick_bill_id = NULL,
             status = 'pending',
             reminder_status = 'NOT_SENT',
             reminder_sent_at = NULL,
             reminder_job_id = NULL,
             reminder_occurrence_date = NULL
         WHERE id = ?`,
        [nextDateStr, id]
      );

      // Clean up staged notification for this refill
      await db.run(
        `UPDATE automation_notifications 
         SET status = 'sent_manually', lifecycle_status = 'sent' 
         WHERE type = 'refill_collection' AND (reference_id = ? OR reference_id LIKE ? OR reference_id LIKE ?) AND status = 'staged'`,
        [String(id), `${id},%`, `%,${id}%`]
      );

      await checkAllRefills(db);
      return res.json({ success: true, message: 'Refill completed and advanced to next cycle' });
    } else if (normalizedStatus === 'notified' || normalizedStatus === 'dismissed') {
      await db.run(
        `UPDATE patient_refills 
         SET status = 'notified', reminder_status = 'SENT', reminder_sent_at = datetime('now')
         WHERE id = ?`,
        [id]
      );
      await db.run(
        `UPDATE automation_notifications 
         SET status = 'cancelled', lifecycle_status = 'cancelled' 
         WHERE type = 'refill_collection' AND (reference_id = ? OR reference_id LIKE ? OR reference_id LIKE ?) AND status = 'staged'`,
        [String(id), `${id},%`, `%,${id}%`]
      );
      return res.json({ success: true, message: 'Refill status updated to notified' });
    } else if (normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
      await db.run(
        `UPDATE patient_refills 
         SET status = 'canceled', is_active = 0, is_ready = 0, hold_for_stock = 0
         WHERE id = ?`,
        [id]
      );
      await db.run(
        `UPDATE automation_notifications 
         SET status = 'cancelled', lifecycle_status = 'cancelled' 
         WHERE type = 'refill_collection' AND (reference_id = ? OR reference_id LIKE ? OR reference_id LIKE ?) AND status = 'staged'`,
        [String(id), `${id},%`, `%,${id}%`]
      );
      return res.json({ success: true, message: 'Refill cancelled' });
    } else {
      await db.run(
        `UPDATE patient_refills SET status = ? WHERE id = ?`,
        [status, id]
      );
      return res.json({ success: true, message: `Refill status updated to ${status}` });
    }
  } catch (err: any) {
    console.error('Failed to update refill status:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
};

router.post('/:id/status', handleRefillStatusUpdate);
router.put('/:id/status', handleRefillStatusUpdate);

// Send WhatsApp reminder for a single refill item
router.post('/:id/send', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const refill = await db.get(
      `SELECT pr.*, m.name as medicine_name 
       FROM patient_refills pr 
       LEFT JOIN medicines m ON pr.medicine_id = m.id 
       WHERE pr.id = ?`,
      [id]
    );

    if (!refill) {
      return res.status(404).json({ error: 'Refill record not found' });
    }

    // Strict duplicate protection: check if already sent or queued for this occurrence
    if (refill.reminder_status === 'SENT') {
      return res.status(400).json({
        error: 'Reminder already sent',
        already_sent: true,
        reminder_status: 'SENT',
        reminder_sent_at: refill.reminder_sent_at
      });
    }
    if (refill.reminder_status === 'QUEUED' || refill.reminder_status === 'SENDING') {
      return res.status(400).json({
        error: 'Reminder is already queued or sending',
        already_queued: true,
        reminder_status: refill.reminder_status
      });
    }

    const cleanPhone = normalizeWhatsAppPhone(refill.patient_phone);
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Patient phone number is invalid or missing' });
    }

    const medicalName = await getConfiguredPharmacyName(db);
    if (!medicalName) {
      return res.status(400).json({
        error: 'Pharmacy name required in Settings. Please set your Pharmacy Name in Settings before sending refill reminders.'
      });
    }
    const patientName = refill.patient_name || 'Customer';
    const medName = refill.medicine_name || 'Prescribed Medicine';
    const qtyNeeded = refill.quantity_needed || 1;

    const msg = `🔔 *MEDICINE REFILL REMINDER — ${medicalName}*\n\nDear ${patientName},\nYour regular prescription is due for refill:\n\n• ${medName} (Qty: ${qtyNeeded})\n\n*Please reply to confirm delivery or pickup.*`;

    const queueId = await whatsappQueueWorker.enqueue(
      cleanPhone,
      msg,
      'refill_reminder',
      patientName
    );

    await db.run(
      `UPDATE patient_refills 
       SET status = 'notified', 
           reminder_status = 'QUEUED', 
           reminder_job_id = ?, 
           reminder_occurrence_date = ? 
       WHERE id = ?`,
      [queueId, refill.next_refill_date, id]
    );

    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ['refill_reminder', patientName, cleanPhone, msg, 'queued', String(id)]
    );

    whatsappQueueWorker.triggerProcessing();

    res.json({
      success: true,
      queueId,
      reminder_status: 'QUEUED',
      message: `Refill reminder queued for ${patientName} (${cleanPhone})`
    });
  } catch (err: any) {
    console.error('Failed to send single refill reminder:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Send consolidated WhatsApp reminder for multiple medicines of a patient
router.post('/send-grouped', async (req, res) => {
  const { patient_phone, patient_name, refill_ids, medicines } = req.body || {};
  const cleanPhone = normalizeWhatsAppPhone(patient_phone);
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Valid 10+ digit patient_phone is required' });
  }

  try {
    const db = await dbManager.getConnection();
    const medicalName = await getConfiguredPharmacyName(db);
    if (!medicalName) {
      return res.status(400).json({
        error: 'Pharmacy name required in Settings. Please set your Pharmacy Name in Settings before sending refill reminders.'
      });
    }
    const patientName = patient_name || 'Customer';

    let medListStr = '';
    const rawIds: number[] = Array.isArray(refill_ids) ? refill_ids : [];
    if (Array.isArray(medicines) && medicines.length > 0) {
      medicines.forEach((m: any) => {
        if (m.id && !rawIds.includes(m.id)) rawIds.push(m.id);
      });
    }

    // Fetch target refill rows
    let rows: any[] = [];
    if (rawIds.length > 0) {
      const placeholders = rawIds.map(() => '?').join(',');
      rows = await db.all(
        `SELECT pr.*, m.name as medicine_name 
         FROM patient_refills pr 
         LEFT JOIN medicines m ON pr.medicine_id = m.id 
         WHERE pr.id IN (${placeholders})`,
        rawIds
      );
    } else {
      rows = await db.all(
        `SELECT pr.*, m.name as medicine_name 
         FROM patient_refills pr 
         LEFT JOIN medicines m ON pr.medicine_id = m.id 
         WHERE pr.patient_phone = ? AND pr.is_active = 1`,
        [patient_phone]
      );
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No active refills found for this patient' });
    }

    // Check duplicate status across candidate items
    const unsentRows = rows.filter(r => r.reminder_status !== 'SENT' && r.reminder_status !== 'QUEUED' && r.reminder_status !== 'SENDING');
    
    if (unsentRows.length === 0) {
      const allSent = rows.every(r => r.reminder_status === 'SENT');
      if (allSent) {
        return res.status(400).json({
          error: 'Reminder already sent',
          already_sent: true,
          reminder_status: 'SENT',
          reminder_sent_at: rows[0].reminder_sent_at
        });
      }
      return res.status(400).json({
        error: 'Reminder is already queued or sending',
        already_queued: true
      });
    }

    const idsToUpdate = unsentRows.map(r => r.id);
    medListStr = unsentRows.map((r: any) => `• ${r.medicine_name || 'Medicine'} (Qty: ${r.quantity_needed || 1})`).join('\n');

    const msg = `🔔 *MEDICINE REFILL REMINDER — ${medicalName}*\n\nDear ${patientName},\nYour regular prescription is due for refill:\n\n${medListStr}\n\n*Please reply to confirm delivery or pickup.*`;

    const queueId = await whatsappQueueWorker.enqueue(
      cleanPhone,
      msg,
      'refill_reminder',
      patientName
    );

    const placeholders = idsToUpdate.map(() => '?').join(',');
    await db.run(
      `UPDATE patient_refills 
       SET status = 'notified', 
           reminder_status = 'QUEUED', 
           reminder_job_id = ?, 
           reminder_occurrence_date = next_refill_date 
       WHERE id IN (${placeholders})`,
      [queueId, ...idsToUpdate]
    );

    for (const rId of idsToUpdate) {
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['refill_reminder', patientName, cleanPhone, msg, 'queued', String(rId)]
      );
    }

    whatsappQueueWorker.triggerProcessing();

    res.json({
      success: true,
      queueId,
      reminder_status: 'QUEUED',
      updatedRefillCount: idsToUpdate.length,
      message: `Consolidated refill reminder queued for ${patientName} (${cleanPhone})`
    });
  } catch (err: any) {
    console.error('Failed to send grouped refill reminder:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Send WhatsApp reminder for refills due tomorrow
router.post('/send-tomorrow-reminder', async (req, res) => {
  const { patient_phone } = req.body;
  if (!patient_phone) {
    return res.status(400).json({ error: 'patient_phone is required' });
  }

  const cleanPhone = normalizeWhatsAppPhone(patient_phone);
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Valid 10+ digit patient_phone is required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    const medicalName = await getConfiguredPharmacyName(db);
    if (!medicalName) {
      return res.status(400).json({
        error: 'Pharmacy name required in Settings. Please set your Pharmacy Name in Settings before sending refill reminders.'
      });
    }

    // Query ready/override-verified refills due tomorrow
    const rows = await db.all(
      `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.patient_phone = ? AND pr.is_active = 1 
         AND (pr.is_ready = 1 OR pr.stock_verified_override = 1)`,
      [patient_phone]
    );

    // Filter to only include those due tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateStr = tomorrow.toISOString().split('T')[0];

    const tomorrowRefills = rows.filter(r => {
      const d = new Date(r.next_refill_date);
      return d.toISOString().split('T')[0] === tomorrowDateStr;
    });

    if (tomorrowRefills.length === 0) {
      return res.status(400).json({ error: 'No ready refills due tomorrow found for this patient' });
    }

    // Check duplicate status
    const unsent = tomorrowRefills.filter(r => r.reminder_status !== 'SENT' && r.reminder_status !== 'QUEUED' && r.reminder_status !== 'SENDING');
    if (unsent.length === 0) {
      const allSent = tomorrowRefills.every(r => r.reminder_status === 'SENT');
      if (allSent) {
        return res.status(400).json({ error: 'Reminder already sent', already_sent: true, reminder_status: 'SENT', reminder_sent_at: tomorrowRefills[0].reminder_sent_at });
      }
      return res.status(400).json({ error: 'Reminder is already queued or sending', already_queued: true });
    }

    const patientName = unsent[0].patient_name || 'Customer';
    const medicineNames = unsent.map(r => r.medicine_name).join(', ');

    const msg = `Hello ${patientName}, this is a friendly reminder that your refill for ${medicineNames} is due tomorrow. We have checked our stock and prepared it for you. Please collect it from ${medicalName} at your convenience.`;

    const queueId = await whatsappQueueWorker.enqueue(
      cleanPhone,
      msg,
      'refill_reminder',
      patientName
    );

    // Update status to notified and reminder_status to QUEUED
    const ids = unsent.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    await db.run(
      `UPDATE patient_refills 
       SET status = 'notified', 
           is_ready = 0, 
           reminder_status = 'QUEUED', 
           reminder_job_id = ?, 
           reminder_occurrence_date = next_refill_date 
       WHERE id IN (${placeholders})`,
      [queueId, ...ids]
    );

    for (const r of unsent) {
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['refill_reminder', patientName, cleanPhone, msg, 'queued', String(r.id)]
      );
    }

    whatsappQueueWorker.triggerProcessing();

    res.json({ success: true, queueId, reminder_status: 'QUEUED', message: 'Tomorrow reminder queued successfully via WhatsApp Queue' });
  } catch (err: any) {
    console.error('Failed to send tomorrow reminder:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Send WhatsApp reminder immediately regardless of stock status
router.post('/send-reminder-now', async (req, res) => {
  const { patient_phone } = req.body;
  if (!patient_phone) {
    return res.status(400).json({ error: 'patient_phone is required' });
  }

  const cleanPhone = normalizeWhatsAppPhone(patient_phone);
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Valid 10+ digit patient_phone is required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    const medicalName = await getConfiguredPharmacyName(db);
    if (!medicalName) {
      return res.status(400).json({
        error: 'Pharmacy name required in Settings. Please set your Pharmacy Name in Settings before sending refill reminders.'
      });
    }

    const rows = await db.all(
      `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.patient_phone = ? AND pr.is_active = 1
       ORDER BY pr.next_refill_date ASC`,
      [patient_phone]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No active refills found for this patient' });
    }

    // Filter out already sent/queued items
    const unsentRows = rows.filter(r => r.reminder_status !== 'SENT' && r.reminder_status !== 'QUEUED' && r.reminder_status !== 'SENDING');
    if (unsentRows.length === 0) {
      const allSent = rows.every(r => r.reminder_status === 'SENT');
      if (allSent) {
        return res.status(400).json({ error: 'Reminder already sent', already_sent: true, reminder_status: 'SENT', reminder_sent_at: rows[0].reminder_sent_at });
      }
      return res.status(400).json({ error: 'Reminder is already queued or sending', already_queued: true });
    }

    const patientName = unsentRows[0].patient_name || 'Customer';
    const medicineNames = unsentRows.map((r: any) => r.medicine_name).join(', ');
    const refillDate = unsentRows[0].next_refill_date
      ? new Date(unsentRows[0].next_refill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : 'soon';

    const msg = `Hello ${patientName}, a friendly reminder that your prescription refill for ${medicineNames} is due on ${refillDate}. Please visit us at ${medicalName} to collect your medicines. Thank you! 🙏`;

    const queueId = await whatsappQueueWorker.enqueue(
      cleanPhone,
      msg,
      'refill_reminder',
      patientName
    );

    const ids = unsentRows.map((r: any) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    await db.run(
      `UPDATE patient_refills 
       SET status = 'notified', 
           reminder_status = 'QUEUED', 
           reminder_job_id = ?, 
           reminder_occurrence_date = next_refill_date 
       WHERE id IN (${placeholders})`,
      [queueId, ...ids]
    );

    for (const r of unsentRows) {
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['refill_reminder', patientName, cleanPhone, msg, 'queued', String(r.id)]
      );
    }

    whatsappQueueWorker.triggerProcessing();

    res.json({ success: true, queueId, reminder_status: 'QUEUED', message: 'Refill reminder queued via WhatsApp' });
  } catch (err: any) {
    console.error('Failed to send immediate reminder:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Delete/Cancel a refill schedule
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    
    const result = await db.run('DELETE FROM patient_refills WHERE id = ?', [id]);
        
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Refill not found' });
    }
    
    res.json({ success: true, message: 'Refill cancelled successfully' });
  } catch (err) {
    console.error('Failed to delete refill:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
