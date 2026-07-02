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
       SET next_refill_date = ?, acknowledged = 0, ordering_triggered = 0, is_ready = 0, hold_for_stock = 0 
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
