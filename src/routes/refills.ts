import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkAllRefills } from '../services/refillService.js';
import { sendMessage } from '../whatsappClient.js';

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

    await db.run(
      `INSERT INTO patient_refills (patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [patient_name, patient_phone, medicine_id, intervalDays, nextRefillStr]
    );

    // Run a check immediately in case the medicine is already in stock!
    await checkAllRefills(db);

        res.json({ success: true, message: 'Refill registered successfully', interval_days: intervalDays });
  } catch (err) {
    console.error('Failed to register refill:', err);
    res.status(500).json({ error: 'Internal server error' });
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
       ORDER BY pr.next_refill_date ASC`
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
    const updatedStatus = status !== undefined ? status : refill.status;
    const updatedHold = hold_for_stock !== undefined ? parseInt(hold_for_stock, 10) : refill.hold_for_stock;
    const updatedIsActive = is_active !== undefined ? (is_active ? 1 : 0) : (refill.is_active !== undefined ? refill.is_active : 1);
    const updatedIsReady = req.body.is_ready !== undefined ? (req.body.is_ready ? 1 : 0) : refill.is_ready;

    await db.run(
      `UPDATE patient_refills 
       SET patient_name = ?, patient_phone = ?, medicine_id = ?, refill_interval_days = ?, next_refill_date = ?, status = ?, hold_for_stock = ?, is_active = ?, is_ready = ?
       WHERE id = ?`,
      [updatedName, updatedPhone, updatedMedicineId, updatedInterval, updatedNextDate, updatedStatus, updatedHold, updatedIsActive, updatedIsReady, id]
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

// Send refill reminder immediately via WhatsApp
router.post('/:id/send', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const refill = await db.get(
      `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.id = ?`,
      [id]
    );

    if (!refill) {
      return res.status(404).json({ error: 'Refill schedule not found' });
    }

    const message = `Hello ${refill.patient_name}, your prescription refill for ${refill.medicine_name} is now ready and in stock! Please visit the pharmacy to collect it.`;

    try {
      await sendMessage(refill.patient_phone, undefined, message);

      // Update refill status to notified, reset is_ready
      await db.run(
        "UPDATE patient_refills SET status = 'notified', is_ready = 0, hold_for_stock = 0 WHERE id = ?",
        [id]
      );

      // Log notification as sent
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['refill_reminder', refill.patient_name, refill.patient_phone, message, 'sent', String(id)]
      );

      res.json({ success: true, message: 'Refill reminder sent successfully' });
    } catch (sendErr: any) {
      const errMsg = sendErr.message || 'Unknown WhatsApp send error';
      // Log notification as failed
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['refill_reminder', refill.patient_name, refill.patient_phone, message, 'failed', errMsg, String(id)]
      );
      res.status(500).json({ error: 'Failed to send WhatsApp message: ' + errMsg });
    }
  } catch (err: any) {
    console.error('Failed to trigger immediate refill send:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
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
       SET next_refill_date = ?, acknowledged = 0, ordering_triggered = 0, is_ready = 0, hold_for_stock = 0, stock_verified_override = 0
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

    const rows = await db.all(
      `SELECT pr.*, m.name as medicine_name, 
              (SELECT SUM(quantity) FROM inventory_master WHERE medicine_id = pr.medicine_id) as in_stock_qty 
       FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.is_active = 1 AND (date(pr.next_refill_date) <= date('now', '+' || ? || ' days') OR pr.is_ready = 1 OR pr.hold_for_stock = 1)
       ORDER BY pr.next_refill_date ASC`,
      [noticeDays]
    );

    const patientGroups: Record<string, any> = {};
    for (const row of rows) {
      const phone = row.patient_phone;
      if (!patientGroups[phone]) {
        patientGroups[phone] = {
          patient_name: row.patient_name,
          patient_phone: row.patient_phone,
          next_refill_date: row.next_refill_date,
          medicines: []
        };
      }
      // If a row has an earlier due date, use that as the group's next refill date
      if (new Date(row.next_refill_date) < new Date(patientGroups[phone].next_refill_date)) {
        patientGroups[phone].next_refill_date = row.next_refill_date;
      }
      patientGroups[phone].medicines.push({
        id: row.id,
        medicine_id: row.medicine_id,
        medicine_name: row.medicine_name,
        quantity_needed: 10, // default refill quantity
        in_stock_qty: row.in_stock_qty || 0,
        stock_verified_override: row.stock_verified_override || 0,
        acknowledged: row.acknowledged || 0,
        hold_for_stock: row.hold_for_stock || 0,
        is_ready: row.is_ready || 0,
        status: row.status,
        quick_bill_id: row.quick_bill_id
      });
    }

    res.json(Object.values(patientGroups));
  } catch (err: any) {
    console.error('Failed to fetch refill panel:', err);
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
           status = 'pending'
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

// Send WhatsApp reminder for refills due tomorrow
router.post('/send-tomorrow-reminder', async (req, res) => {
  const { patient_phone } = req.body;
  if (!patient_phone) {
    return res.status(400).json({ error: 'patient_phone is required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();

    // Query ready/override-verified refills due tomorrow
    const rows = await db.all(
      `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.patient_phone = ? AND pr.status = 'pending' AND pr.is_active = 1 
         AND (pr.is_ready = 1 OR pr.stock_verified_override = 1)`,
      [patient_phone]
    );

    // Filter to only include those due tomorrow (in case SQL date checks are timezone-sensitive)
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

    const patientName = tomorrowRefills[0].patient_name;
    const medicineNames = tomorrowRefills.map(r => r.medicine_name).join(', ');

    let medicalName = 'XYZ MEDICAL';
    const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'medical_name'");
    if (nameRow && nameRow.value) {
      medicalName = nameRow.value;
    }

    const msg = `Hello ${patientName}, this is a friendly reminder that your refill for ${medicineNames} is due tomorrow. We have checked our stock and prepared it for you. Please collect it from ${medicalName} at your convenience.`;

    // Queue WhatsApp message
    const { messagingQueue } = await import('../services/messagingQueue.js');
    await messagingQueue.queueMessage(
      'refill_reminder',
      patientName,
      patient_phone,
      msg,
      String(tomorrowRefills[0].id)
    );

    // Update status to notified, reset is_ready
    const ids = tomorrowRefills.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    await db.run(
      `UPDATE patient_refills SET status = 'notified', is_ready = 0 WHERE id IN (${placeholders})`,
      ids
    );

    res.json({ success: true, message: 'Tomorrow reminder queued successfully' });
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

  let db;
  try {
    db = await dbManager.getConnection();

    const rows = await db.all(
      `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.patient_phone = ? AND pr.is_active = 1 AND pr.status != 'notified'
       ORDER BY pr.next_refill_date ASC`,
      [patient_phone]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No active refills found for this patient' });
    }

    const patientName = rows[0].patient_name;
    const medicineNames = rows.map((r: any) => r.medicine_name).join(', ');
    const refillDate = rows[0].next_refill_date
      ? new Date(rows[0].next_refill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : 'soon';

    let medicalName = 'XYZ MEDICAL';
    const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'medical_name'");
    if (nameRow?.value) medicalName = nameRow.value;

    const msg = `Hello ${patientName}, a friendly reminder that your prescription refill for ${medicineNames} is due on ${refillDate}. Please visit us at ${medicalName} to collect your medicines. Thank you! 🙏`;

    const { messagingQueue } = await import('../services/messagingQueue.js');
    await messagingQueue.queueMessage(
      'refill_reminder',
      patientName,
      patient_phone,
      msg,
      String(rows[0].id)
    );

    res.json({ success: true, message: 'Refill reminder queued via WhatsApp' });
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
