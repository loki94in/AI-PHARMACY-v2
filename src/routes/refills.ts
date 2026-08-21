import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkAllRefills, cleanupStagedRefillNotifications } from '../services/refillService.js';
import { sendMessage, normalizeWhatsAppPhone } from '../whatsappClient.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { getMessage } from '../i18n/getMessage.js';
import { getConfiguredPharmacyName } from '../services/storeSettingsService.js';
import { eventService } from '../services/eventService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

let refillsTableInitialized = false;

export async function initRefillsTable(db: any) {
  if (refillsTableInitialized) return;
  refillsTableInitialized = true;
}

router.use(async (_req, _res, next) => {
  try {
    const db = await dbManager.getConnection();
    await initRefillsTable(db);
  } catch (_) {}
  next();
});

// P1 push event (API_OPTIMIZATION plan): any successful non-GET refill mutation
// broadcasts `refill_updated` so the UI invalidates caches instead of polling.
// Covers all current AND future endpoints on this router.
router.use((req, res, next) => {
  if (req.method !== 'GET') {
    const origJson = res.json.bind(res);
    (res as any).json = (body: any) => {
      try {
        if (res.statusCode < 400 && body && typeof body === 'object' && body.success) {
          eventService.broadcast('refill_updated', { at: Date.now(), method: req.method });
        }
      } catch (_) {}
      return origJson(body);
    };
  }
  next();
});

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

// Multilingual refill reminder message builder
export function buildRefillReminderMessage(
  patientName: string,
  items: Array<{ medicine_name?: string; quantity_needed?: number }>,
  pharmacyName: string,
  lang: string = 'en',
  dueDateStr?: string
): string {
  const pName = (patientName || 'Customer').trim();
  const cleanLang = (lang || 'en').toLowerCase();

  if (cleanLang === 'hi') {
    const medList = items
      .map(m => `â€¢ ${m.medicine_name || 'à¤¦à¤µà¤¾à¤ˆ'} (à¤®à¤¾à¤¤à¥à¤°à¤¾: ${m.quantity_needed || 1})`)
      .join('\n');
    const dueSuffix = dueDateStr ? `\n\nà¤¤à¤¾à¤°à¥€à¤–: ${dueDateStr}` : '';
    return `ðŸ”” *à¤¦à¤µà¤¾à¤ˆ à¤°à¤¿à¤«à¤¿à¤² à¤°à¤¿à¤®à¤¾à¤‡à¤‚à¤¡à¤° â€” ${pharmacyName}*\n\nà¤¨à¤®à¤¸à¥à¤¤à¥‡ ${pName},\nà¤†à¤ªà¤•à¥€ à¤¨à¤¿à¤¯à¤®à¤¿à¤¤ à¤¦à¤µà¤¾à¤ˆ à¤•à¤¾ à¤°à¤¿à¤«à¤¿à¤² à¤¸à¤®à¤¯ à¤† à¤—à¤¯à¤¾ à¤¹à¥ˆ:\n\n${medList}${dueSuffix}\n\n*à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¡à¤¿à¤²à¥€à¤µà¤°à¥€ à¤¯à¤¾ à¤ªà¤¿à¤•à¤…à¤ª à¤•à¥€ à¤ªà¥à¤·à¥à¤Ÿà¤¿ à¤•à¥‡ à¤²à¤¿à¤ à¤‰à¤¤à¥à¤¤à¤° à¤¦à¥‡à¤‚à¥¤*`;
  } else if (cleanLang === 'mr') {
    const medList = items
      .map(m => `â€¢ ${m.medicine_name || 'à¤”à¤·à¤§'} (à¤ªà¥à¤°à¤®à¤¾à¤£: ${m.quantity_needed || 1})`)
      .join('\n');
    const dueSuffix = dueDateStr ? `\n\nà¤¦à¤¿à¤¨à¤¾à¤‚à¤•: ${dueDateStr}` : '';
    return `ðŸ”” *à¤”à¤·à¤§ à¤°à¤¿à¤«à¤¿à¤² à¤¸à¥à¤®à¤°à¤£à¤ªà¤¤à¥à¤° â€” ${pharmacyName}*\n\nà¤¨à¤®à¤¸à¥à¤•à¤¾à¤° ${pName},\nà¤†à¤ªà¤²à¥à¤¯à¤¾ à¤¨à¤¿à¤¯à¤®à¤¿à¤¤ à¤”à¤·à¤§à¤¾à¤‚à¤šà¥€ à¤°à¤¿à¤«à¤¿à¤² à¤•à¤°à¤£à¥à¤¯à¤¾à¤šà¥€ à¤µà¥‡à¤³ à¤à¤¾à¤²à¥€ à¤†à¤¹à¥‡:\n\n${medList}${dueSuffix}\n\n*à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¡à¤¿à¤²à¤¿à¤µà¥à¤¹à¤°à¥€ à¤•à¤¿à¤‚à¤µà¤¾ à¤ªà¤¿à¤•à¤…à¤ª à¤¨à¤¿à¤¶à¥à¤šà¤¿à¤¤ à¤•à¤°à¤£à¥à¤¯à¤¾à¤¸à¤¾à¤ à¥€ à¤‰à¤¤à¥à¤¤à¤° à¤¦à¥à¤¯à¤¾.*`;
  } else {
    const medList = items
      .map(m => `â€¢ ${m.medicine_name || 'Medicine'} (Qty: ${m.quantity_needed || 1})`)
      .join('\n');
    const dueSuffix = dueDateStr ? `\n\nDue Date: ${dueDateStr}` : '';
    return `ðŸ”” *MEDICINE REFILL REMINDER â€” ${pharmacyName}*\n\nDear ${pName},\nYour regular prescription is due for refill:\n\n${medList}${dueSuffix}\n\n*Please reply to confirm delivery or pickup.*`;
  }
}

// Register or add a medicine to patient refill schedule (Idempotent / Granular)
router.post('/', async (req, res) => {
  const { patient_name, patient_phone, medicine_id, refill_interval_days = 30, language = 'en' } = req.body;
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
    const cleanLang = (language || 'en').trim();
    let customerId = req.body.customer_id || null;
    if (!customerId && (cleanPhone || cleanName)) {
      let cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (!cust && cleanName && cleanName.toLowerCase() !== 'customer') {
        cust = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [cleanName]);
      }
      if (cust) {
        customerId = cust.id;
        await db.run('UPDATE customers SET language = ? WHERE id = ?', [cleanLang, customerId]);
      } else if (cleanPhone || cleanName) {
        const custRes = await db.run('INSERT INTO customers (name, phone, language) VALUES (?, ?, ?)', [cleanName, cleanPhone, cleanLang]);
        customerId = custRes.lastID;
      }
    } else if (customerId) {
      await db.run('UPDATE customers SET language = ? WHERE id = ?', [cleanLang, customerId]);
    }

    const quantityNeeded = parseInt(req.body.quantity_needed || req.body.quantity, 10) || 3;

    // Check if an existing schedule already exists for this patient and medicine
    const existing = await db.get(
      `SELECT id, is_active FROM patient_refills 
       WHERE medicine_id = ? AND (patient_phone = ? OR (customer_id IS NOT NULL AND customer_id = ?)) 
       ORDER BY id DESC LIMIT 1`,
      [medicine_id, cleanPhone, customerId]
    );

    let refillId: number = 0;
    if (existing) {
      refillId = existing.id;
      await db.run(
        `UPDATE patient_refills 
         SET customer_id = ?, patient_name = ?, patient_phone = ?, refill_interval_days = ?, 
             quantity_needed = ?, language = ?, is_active = 1, status = 'pending'
         WHERE id = ?`,
        [customerId, cleanName, cleanPhone, intervalDays, quantityNeeded, cleanLang, refillId]
      );
    } else {
      const result = await db.run(
        `INSERT INTO patient_refills (customer_id, patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status, quantity_needed, language, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1)`,
        [customerId, cleanName, cleanPhone, medicine_id, intervalDays, nextRefillStr, quantityNeeded, cleanLang]
      );
      refillId = Number(result.lastID || 0);
    }

    // Run a check immediately in case the medicine is already in stock!
    await checkAllRefills(db);

    res.json({ success: true, message: 'Refill registered successfully', refillId, interval_days: intervalDays, next_refill_date: nextRefillStr });
  } catch (err) {
    console.error('Failed to register refill:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update an existing patient's master profile / contact details (In-Place Cascade)
router.put('/patient-profile', async (req, res) => {
  const { customer_id, original_phone, patient_name, patient_phone, language = 'en', next_refill_date } = req.body;
  if (!patient_name || !patient_phone) {
    return res.status(400).json({ error: 'Patient name and phone number are required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    const cleanPhone = String(patient_phone).trim();
    const origPhone = String(original_phone || cleanPhone).trim();
    const cleanName = String(patient_name).trim();
    const cleanLang = String(language || 'en').trim();

    // 1. Resolve or update customer master in customers table
    let customerId = customer_id ? parseInt(String(customer_id), 10) : null;
    if (!customerId) {
      let cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (!cust && origPhone && origPhone !== cleanPhone) {
        cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [origPhone]);
      }
      if (!cust && cleanName && cleanName.toLowerCase() !== 'customer') {
        cust = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [cleanName]);
      }
      if (cust) {
        customerId = cust.id;
      }
    }

    if (customerId) {
      await db.run(
        'UPDATE customers SET name = ?, phone = ?, language = ? WHERE id = ?',
        [cleanName, cleanPhone, cleanLang, customerId]
      );
      await db.run('UPDATE special_orders SET requester = ?, phone = ? WHERE customer_id = ?', [cleanName, cleanPhone, customerId]);
    } else {
      const custRes = await db.run(
        'INSERT INTO customers (name, phone, language) VALUES (?, ?, ?)',
        [cleanName, cleanPhone, cleanLang]
      );
      customerId = custRes.lastID ? Number(custRes.lastID) : null;
    }

    // 2. Cascade update all patient_refills records belonging to this patient
    const updateParams: any[] = [customerId, cleanName, cleanPhone, cleanLang];
    let updateSql = `UPDATE patient_refills SET customer_id = ?, patient_name = ?, patient_phone = ?, language = ?`;
    if (next_refill_date) {
      updateSql += `, next_refill_date = ?`;
      updateParams.push(next_refill_date);
    }
    updateSql += ` WHERE patient_phone = ? OR patient_phone = ? OR (customer_id IS NOT NULL AND customer_id = ?)`;
    updateParams.push(origPhone, cleanPhone, customerId);

    await db.run(updateSql, updateParams);

    // 3. Re-run check engine
    await checkAllRefills(db);

    res.json({
      success: true,
      message: `Patient details updated successfully for ${cleanName}`,
      customer_id: customerId,
      patient_name: cleanName,
      patient_phone: cleanPhone,
      language: cleanLang,
      next_refill_date: next_refill_date || undefined
    });
  } catch (err: any) {
    console.error('Failed to update patient profile:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Update an existing patient's refill prescription & medicines (Granular In-Place Sync)
router.put('/patient-medicines', async (req, res) => {
  const { original_phone, patient_name, patient_phone, refill_interval_days = 30, medicines, language = 'en', next_refill_date } = req.body;
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
    const cleanLang = (language || 'en').trim();

    // Resolve or auto-create/update customer profile in customers table
    let customerId = req.body.customer_id || null;
    if (!customerId && (cleanPhone || cleanName || origPhone)) {
      let cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (!cust && origPhone && origPhone !== cleanPhone) {
        cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [origPhone]);
      }
      if (!cust && cleanName && cleanName.toLowerCase() !== 'customer') {
        cust = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [cleanName]);
      }
      if (cust) {
        customerId = cust.id;
        await db.run('UPDATE customers SET name = ?, phone = ?, language = ? WHERE id = ?', [cleanName, cleanPhone, cleanLang, customerId]);
      } else if (cleanPhone || cleanName) {
        const custRes = await db.run('INSERT INTO customers (name, phone, language) VALUES (?, ?, ?)', [cleanName, cleanPhone, cleanLang]);
        customerId = custRes.lastID;
      }
    } else if (customerId) {
      await db.run('UPDATE customers SET name = ?, phone = ?, language = ? WHERE id = ?', [cleanName, cleanPhone, cleanLang, customerId]);
    }

    // Fetch existing refill records for this patient
    const existingRows = await db.all(
      `SELECT * FROM patient_refills 
       WHERE patient_phone = ? OR patient_phone = ? OR (customer_id IS NOT NULL AND customer_id = ?)`,
      [origPhone, cleanPhone, customerId]
    );

    const existingMap = new Map<number, any>();
    for (const r of existingRows) {
      existingMap.set(r.medicine_id, r);
    }

    const processedMedicineIds = new Set<number>();

    // Calculate default next refill date
    let defaultNextRefillStr: string;
    if (next_refill_date) {
      defaultNextRefillStr = next_refill_date;
    } else {
      const nextRefillDate = new Date();
      nextRefillDate.setDate(nextRefillDate.getDate() + intervalDays);
      defaultNextRefillStr = nextRefillDate.toISOString().slice(0, 19).replace('T', ' ');
    }

    // Granular sync: Update existing records or insert genuinely new ones
    for (const med of medicines) {
      const medId = Number(med.medicine_id || med.medicineId);
      if (!medId || isNaN(medId)) continue;
      processedMedicineIds.add(medId);

      const qtyNeeded = parseInt(med.quantity_needed || med.quantity, 10) || 3;
      const existing = existingMap.get(medId);

      if (existing) {
        // In-place update preserving ID and history
        let targetNextDate = next_refill_date;
        if (!targetNextDate) {
          if (existing.refill_interval_days === intervalDays && existing.next_refill_date && new Date(existing.next_refill_date) > new Date()) {
            targetNextDate = existing.next_refill_date;
          } else {
            targetNextDate = defaultNextRefillStr;
          }
        }
        await db.run(
          `UPDATE patient_refills 
           SET customer_id = ?, patient_name = ?, patient_phone = ?, refill_interval_days = ?, 
               next_refill_date = ?, quantity_needed = ?, is_active = 1, language = ?
           WHERE id = ?`,
          [customerId, cleanName, cleanPhone, intervalDays, targetNextDate, qtyNeeded, cleanLang, existing.id]
        );
      } else {
        // Insert only new medicine
        await db.run(
          `INSERT INTO patient_refills (customer_id, patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status, quantity_needed, is_active, language)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?)`,
          [customerId, cleanName, cleanPhone, medId, intervalDays, defaultNextRefillStr, qtyNeeded, cleanLang]
        );
      }
    }

    // Delete or deactivate only medicines explicitly removed from the prescription
    for (const [medId, r] of existingMap.entries()) {
      if (!processedMedicineIds.has(medId)) {
        await db.run('DELETE FROM patient_refills WHERE id = ?', [r.id]);
        await db.run(
          `DELETE FROM automation_notifications WHERE type = 'refill_collection' AND (reference_id = ? OR reference_id LIKE ? OR reference_id LIKE ?)`,
          [String(r.id), `${r.id},%`, `%,${r.id}%`]
        ).catch(() => {});
      }
    }

    // Re-check inventory stock and trigger necessary alerts/schedules
    await checkAllRefills(db);

    res.json({ success: true, message: 'Patient refill schedule synchronized successfully', interval_days: intervalDays, next_refill_date: defaultNextRefillStr });
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
    let updatedNextDate = next_refill_date !== undefined ? next_refill_date : refill.next_refill_date;
    
    // If interval changed and next_refill_date wasn't explicitly provided, recalculate next_refill_date
    if (refill_interval_days !== undefined && next_refill_date === undefined) {
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + updatedInterval);
      updatedNextDate = nextDate.toISOString().slice(0, 19).replace('T', ' ');
    }

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

    res.json({ success: true, message: 'Refill updated successfully', interval_days: updatedInterval, next_refill_date: updatedNextDate });
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
    let query = `SELECT pr.*, m.name as medicine_name, m.packaging, m.pack_size, m.sell_price, 
               COALESCE(pr.language, c.language, 'en') as language, 
               COALESCE(inv.in_stock_qty, 0) as in_stock_qty,
               best_inv.inventory_id, best_inv.batch_no, best_inv.expiry_date,
               COALESCE(best_inv.mrp, m.mrp, 0) as mrp,
               COALESCE(best_inv.unit_price, m.sell_price, m.mrp, 0) as unit_price,
               best_inv.batch_quantity, best_inv.batch_loose_quantity
       FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       LEFT JOIN (
         SELECT id, phone, language, name 
         FROM customers 
         WHERE phone IS NOT NULL AND phone != '' 
         GROUP BY phone
       ) c ON (pr.customer_id IS NOT NULL AND pr.customer_id = c.id) OR (pr.customer_id IS NULL AND pr.patient_phone = c.phone)
       LEFT JOIN (
         SELECT medicine_id, (SUM(quantity) + COALESCE(SUM(loose_quantity), 0)) as in_stock_qty 
         FROM inventory_master 
         WHERE (COALESCE(is_active, 1) = 1 AND (quantity > 0 OR COALESCE(loose_quantity, 0) > 0))
         GROUP BY medicine_id
       ) inv ON inv.medicine_id = pr.medicine_id
       LEFT JOIN (
         SELECT im.medicine_id, im.id as inventory_id, im.batch_no, im.expiry_date, im.mrp, im.unit_price,
                im.quantity as batch_quantity, im.loose_quantity as batch_loose_quantity,
                ROW_NUMBER() OVER (
                  PARTITION BY im.medicine_id 
                  ORDER BY (CASE WHEN im.expiry_date IS NOT NULL AND im.expiry_date != '' THEN im.expiry_date ELSE '9999-12-31' END) ASC, im.id ASC
                ) as rn
         FROM inventory_master im
         WHERE (COALESCE(im.is_active, 1) = 1 AND (im.quantity > 0 OR COALESCE(im.loose_quantity, 0) > 0))
       ) best_inv ON best_inv.medicine_id = pr.medicine_id AND best_inv.rn = 1`;
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
          customer_id: row.customer_id,
          patient_name: row.patient_name,
          patient_phone: row.patient_phone,
          language: row.language || 'en',
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
      
      // Deduplicate medicine rows within group to prevent duplicate cards
      if (!patientGroups[phone].medicines.some((m: any) => m.id === row.id)) {
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
          reminder_occurrence_date: row.reminder_occurrence_date || null,
          inventory_id: row.inventory_id || null,
          batch_no: row.batch_no || null,
          expiry_date: row.expiry_date || null,
          mrp: row.mrp || 0,
          sell_price: row.sell_price || null,
          unit_price: row.unit_price || 0,
          packaging: row.packaging || null,
          pack_size: row.pack_size || 1,
          batch_quantity: row.batch_quantity || 0,
          batch_loose_quantity: row.batch_loose_quantity || 0
        });
      }
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

// Permanently delete an entire patient refill schedule
const deletePatientRefillsHandler = async (req: any, res: any) => {
  const phone = (req.params.phone || req.body.patient_phone || req.query.phone || req.query.patient_phone || '').trim();
  const customerId = req.body.customer_id ? parseInt(req.body.customer_id, 10) : (req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : null);
  const ids: number[] = Array.isArray(req.body.ids) ? req.body.ids.map((i: any) => parseInt(i, 10)).filter((n: number) => !isNaN(n) && n > 0) : [];
  const patientName = (req.body.patient_name || req.query.patient_name || '').trim();

  if (ids.length === 0 && !phone && !customerId && !patientName) {
    return res.status(400).json({ error: 'Patient identifiers or refill IDs are required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();

    // Collect all matching refill records first
    let query = 'SELECT id FROM patient_refills WHERE 0 = 1';
    const params: any[] = [];

    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      query += ` OR id IN (${placeholders})`;
      params.push(...ids);
    }

    if (customerId) {
      query += ' OR customer_id = ?';
      params.push(customerId);
    }

    if (phone) {
      const digits = phone.replace(/\D/g, '').slice(-10);
      if (digits) {
        query += ' OR patient_phone = ? OR patient_phone LIKE ?';
        params.push(phone, `%${digits}%`);
      } else {
        query += ' OR patient_phone = ?';
        params.push(phone);
      }
    }

    if (patientName && patientName.toLowerCase() !== 'customer') {
      query += ' OR LOWER(TRIM(patient_name)) = LOWER(TRIM(?))';
      params.push(patientName);
    }

    const matchingRefills = await db.all(query, params);
    const refillIds = Array.from(new Set(matchingRefills.map((r: any) => String(r.id))));

    if (refillIds.length > 0) {
      const placeholders = refillIds.map(() => '?').join(',');
      // 1. Remove staged notifications
      await db.run(
        `DELETE FROM automation_notifications WHERE type = 'refill_collection' AND reference_id IN (${placeholders})`,
        refillIds
      );
      // 2. Delete patient refills
      const result = await db.run(
        `DELETE FROM patient_refills WHERE id IN (${placeholders})`,
        refillIds
      );

      await checkAllRefills(db);

      return res.json({
        success: true,
        deletedCount: result.changes || refillIds.length,
        message: 'Patient refill schedule deleted successfully'
      });
    } else {
      // Direct deletion fallback if query had no pre-match
      let deleted = 0;
      if (phone) {
        const delRes = await db.run('DELETE FROM patient_refills WHERE patient_phone = ? OR patient_phone LIKE ?', [phone, `%${phone.replace(/\D/g, '').slice(-10)}%`]);
        deleted = delRes.changes || 0;
      }
      await checkAllRefills(db);
      return res.json({
        success: true,
        deletedCount: deleted,
        message: 'Patient refill schedule deleted successfully'
      });
    }
  } catch (err: any) {
    console.error('Failed to delete patient refill schedule:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
};

router.post('/delete-patient', deletePatientRefillsHandler);
router.delete('/patient/:phone', deletePatientRefillsHandler);
router.delete('/patient', deletePatientRefillsHandler);

// Permanently delete a single refill item by id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const numId = parseInt(id, 10);
  if (!numId || isNaN(numId)) {
    return res.status(400).json({ error: 'Valid refill ID required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    const refill = await db.get('SELECT * FROM patient_refills WHERE id = ?', [numId]);
    if (!refill) {
      return res.status(404).json({ error: 'Refill not found' });
    }

    // Clean up staged notification for this refill
    await db.run(
      `DELETE FROM automation_notifications 
       WHERE type = 'refill_collection' AND (reference_id = ? OR reference_id LIKE ? OR reference_id LIKE ?)`,
      [String(numId), `${numId},%`, `%,${numId}%`]
    );

    await db.run('DELETE FROM patient_refills WHERE id = ?', [numId]);

    await checkAllRefills(db);

    res.json({ success: true, message: 'Refill item deleted successfully' });
  } catch (err: any) {
    console.error('Failed to delete refill item:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Update refill frequency / interval days & recalculate next due date
router.put('/:id/frequency', async (req, res) => {
  const { id } = req.params;
  const { refill_interval_days, update_all = true } = req.body;
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

    if (update_all && refill.patient_phone) {
      await db.run(
        'UPDATE patient_refills SET refill_interval_days = ?, next_refill_date = ? WHERE patient_phone = ? AND is_active = 1',
        [interval, nextDateStr, refill.patient_phone]
      );
    } else {
      await db.run(
        'UPDATE patient_refills SET refill_interval_days = ?, next_refill_date = ? WHERE id = ?',
        [interval, nextDateStr, id]
      );
    }

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

// Fulfill a refill manually (advances next cycle & records fulfillment occurrence)
router.post('/:id/fulfill', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const refill = await db.get(
      `SELECT pr.*, m.name as medicine_name 
       FROM patient_refills pr 
       LEFT JOIN medicines m ON pr.medicine_id = m.id 
       WHERE pr.id = ?`,
      [id]
    );
    if (!refill) {
      return res.status(404).json({ error: 'Refill not found' });
    }

    const interval = refill.refill_interval_days || 30;
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);
    const nextDateStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');
    const cycleDueDate = refill.next_refill_date || new Date().toISOString().slice(0, 10);
    const fulfilledQty = Number(refill.quantity_needed || 3);

    // 1. Record persistent fulfillment occurrence in refill_fulfillments table
    await db.run(
      `INSERT INTO refill_fulfillments (
        refill_id, customer_id, patient_name, patient_phone, medicine_id, medicine_name, 
        quantity_fulfilled, fulfilled_at, cycle_due_date, next_due_date, fulfilled_via
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, 'crm_complete')`,
      [
        refill.id,
        refill.customer_id,
        refill.patient_name,
        refill.patient_phone,
        refill.medicine_id,
        refill.medicine_name || 'Prescribed Medicine',
        fulfilledQty,
        cycleDueDate,
        nextDateStr
      ]
    );

    // 2. Advance the same persistent schedule in-place
    await db.run(
      `UPDATE patient_refills 
       SET last_refill_date = datetime('now'),
           next_refill_date = ?,
           stock_verified_override = 0,
           ordering_triggered = 0,
           is_ready = 0,
           hold_for_stock = 0,
           acknowledged = 0,
           quick_bill_id = NULL,
           status = 'pending',
           reminder_status = 'NOT_SENT',
           reminder_sent_at = NULL,
           reminder_job_id = NULL,
           reminder_occurrence_date = NULL
       WHERE id = ?`,
      [nextDateStr, id]
    );

    // 3. Update staged notification to completed precisely
    await cleanupStagedRefillNotifications(db, [Number(id)], 'sent_manually');

    // Re-run checking engine to process the next cycle or sibling refills
    await checkAllRefills(db);

    res.json({
      success: true,
      message: `Refill for ${refill.medicine_name || 'Medicine'} marked as fulfilled and advanced to ${nextDateStr.slice(0, 10)}.`,
      next_refill_date: nextDateStr
    });
  } catch (err: any) {
    console.error('Failed to fulfill refill:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Fulfill all due medicines for an entire patient schedule (e.g. from Quick Assist or CRM)
router.post('/patient/:phone/fulfill-all', async (req, res) => {
  const phone = (req.params.phone || req.body.patient_phone || '').trim();
  const customerId = req.body.customer_id ? parseInt(req.body.customer_id, 10) : null;
  const requestedRefillIds: number[] = Array.isArray(req.body.refill_ids)
    ? req.body.refill_ids.map(Number).filter((n: number) => !isNaN(n))
    : [];
  const fulfilledVia = req.body.fulfilled_via || 'crm_complete';

  if (!phone && !customerId && requestedRefillIds.length === 0) {
    return res.status(400).json({ error: 'Patient phone, customer ID, or refill IDs required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    let activeRefills: any[];
    if (requestedRefillIds.length > 0) {
      const placeholders = requestedRefillIds.map(() => '?').join(',');
      activeRefills = await db.all(
        `SELECT pr.*, m.name as medicine_name 
         FROM patient_refills pr 
         LEFT JOIN medicines m ON pr.medicine_id = m.id 
         WHERE pr.id IN (${placeholders}) AND pr.is_active = 1`,
        requestedRefillIds
      );
    } else {
      activeRefills = await db.all(
        `SELECT pr.*, m.name as medicine_name 
         FROM patient_refills pr 
         LEFT JOIN medicines m ON pr.medicine_id = m.id 
         WHERE (pr.patient_phone = ? OR (pr.customer_id IS NOT NULL AND pr.customer_id = ?)) 
           AND pr.is_active = 1`,
        [phone, customerId]
      );
    }

    if (!activeRefills || activeRefills.length === 0) {
      return res.status(404).json({ error: 'No active refills found for this patient' });
    }

    let fulfilledCount = 0;
    const fulfilledIds: number[] = [];
    for (const refill of activeRefills) {
      const interval = refill.refill_interval_days || 30;
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + interval);
      const nextDateStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');
      const cycleDueDate = refill.next_refill_date || new Date().toISOString().slice(0, 10);
      const fulfilledQty = Number(refill.quantity_needed || 3);

      await db.run(
        `INSERT INTO refill_fulfillments (
          refill_id, customer_id, patient_name, patient_phone, medicine_id, medicine_name, 
          quantity_fulfilled, fulfilled_at, cycle_due_date, next_due_date, fulfilled_via
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)`,
        [
          refill.id,
          refill.customer_id,
          refill.patient_name,
          refill.patient_phone,
          refill.medicine_id,
          refill.medicine_name || 'Prescribed Medicine',
          fulfilledQty,
          cycleDueDate,
          nextDateStr,
          fulfilledVia
        ]
      );

      await db.run(
        `UPDATE patient_refills 
         SET last_refill_date = datetime('now'),
             next_refill_date = ?,
             stock_verified_override = 0,
             ordering_triggered = 0,
             is_ready = 0,
             hold_for_stock = 0,
             acknowledged = 0,
             quick_bill_id = NULL,
             status = 'pending',
             reminder_status = 'NOT_SENT',
             reminder_sent_at = NULL,
             reminder_job_id = NULL,
             reminder_occurrence_date = NULL
         WHERE id = ?`,
        [nextDateStr, refill.id]
      );

      fulfilledCount++;
      fulfilledIds.push(refill.id);
    }

    // Clean up staged notifications precisely
    await cleanupStagedRefillNotifications(db, fulfilledIds, 'sent_manually');

    await checkAllRefills(db);

    res.json({
      success: true,
      fulfilledCount,
      message: `Successfully fulfilled ${fulfilledCount} medicine schedule(s) for this patient and advanced to next cycle.`
    });
  } catch (err: any) {
    console.error('Failed to fulfill patient refills:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Fetch complete refill occurrence history for a patient
router.get('/patient/:identifier/history', async (req, res) => {
  const identifier = req.params.identifier;
  let db;
  try {
    db = await dbManager.getConnection();
    const numId = parseInt(identifier, 10);
    const cleanPhone = (identifier || '').trim();

    let query = `
      SELECT rf.*, COALESCE(m.name, rf.medicine_name, 'Prescribed Medicine') as medicine_name,
             si.invoice_no as linked_invoice_no, si.total_amount as invoice_amount
      FROM refill_fulfillments rf
      LEFT JOIN medicines m ON rf.medicine_id = m.id
      LEFT JOIN sales_invoices si ON rf.invoice_id = si.id
      WHERE 0 = 1
    `;
    const params: any[] = [];

    if (!isNaN(numId) && numId > 0) {
      query += ` OR rf.customer_id = ? OR rf.refill_id = ?`;
      params.push(numId, numId);
    }
    if (cleanPhone) {
      query += ` OR rf.patient_phone = ? OR rf.patient_phone LIKE ?`;
      params.push(cleanPhone, `%${cleanPhone.replace(/\D/g, '').slice(-10)}%`);
    }

    query += ` ORDER BY rf.fulfilled_at DESC LIMIT 100`;

    const history = await db.all(query, params);
    res.json(history);
  } catch (err: any) {
    console.error('Failed to fetch refill history:', err);
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
      const cycleDueDate = refill.next_refill_date || new Date().toISOString().slice(0, 10);
      const fulfilledQty = Number(refill.quantity_needed || 3);

      const medRow = await db.get('SELECT name FROM medicines WHERE id = ?', [refill.medicine_id]);
      const medName = medRow?.name || 'Prescribed Medicine';

      await db.run(
        `INSERT INTO refill_fulfillments (
          refill_id, customer_id, patient_name, patient_phone, medicine_id, medicine_name, 
          quantity_fulfilled, fulfilled_at, cycle_due_date, next_due_date, fulfilled_via
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, 'status_update')`,
        [
          refill.id,
          refill.customer_id,
          refill.patient_name,
          refill.patient_phone,
          refill.medicine_id,
          medName,
          fulfilledQty,
          cycleDueDate,
          nextDateStr
        ]
      );

      await db.run(
        `UPDATE patient_refills 
         SET last_refill_date = datetime('now'),
             next_refill_date = ?,
             stock_verified_override = 0,
             ordering_triggered = 0,
             is_ready = 0,
             hold_for_stock = 0,
             acknowledged = 0,
             quick_bill_id = NULL,
             status = 'pending',
             reminder_status = 'NOT_SENT',
             reminder_sent_at = NULL,
             reminder_job_id = NULL,
             reminder_occurrence_date = NULL
         WHERE id = ?`,
        [nextDateStr, id]
      );

      // Clean up staged notification for this refill precisely
      await cleanupStagedRefillNotifications(db, [Number(id)], 'sent_manually');

      await checkAllRefills(db);
      return res.json({ success: true, message: 'Refill completed and advanced to next cycle', next_refill_date: nextDateStr });
    } else if (normalizedStatus === 'notified' || normalizedStatus === 'dismissed') {
      await db.run(
        `UPDATE patient_refills 
         SET status = 'notified', reminder_status = 'SENT', reminder_sent_at = datetime('now')
         WHERE id = ?`,
        [id]
      );
      await cleanupStagedRefillNotifications(db, [Number(id)], 'cancelled');
      return res.json({ success: true, message: 'Refill status updated to notified' });
    } else if (normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
      await db.run(
        `UPDATE patient_refills 
         SET status = 'canceled', is_active = 0, is_ready = 0, hold_for_stock = 0
         WHERE id = ?`,
        [id]
      );
      await cleanupStagedRefillNotifications(db, [Number(id)], 'cancelled');
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
    const cleanDigits = cleanPhone.replace(/^91/, '');
    const custRow = await db.get('SELECT language FROM customers WHERE phone = ? OR phone = ? OR id = ? LIMIT 1', [cleanPhone, cleanDigits, refill.customer_id]);
    const lang = req.body?.language || refill.language || custRow?.language || 'en';

    const msg = buildRefillReminderMessage(
      patientName,
      [{ medicine_name: refill.medicine_name || 'Prescribed Medicine', quantity_needed: refill.quantity_needed || 1 }],
      medicalName,
      lang
    );

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

    await whatsappQueueWorker.forceNext().catch(() => {});

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
    const cleanDigits = cleanPhone.replace(/^91/, '');
    const custRow = await db.get('SELECT language FROM customers WHERE phone = ? OR phone = ? LIMIT 1', [cleanPhone, cleanDigits]);
    const lang = req.body?.language || rows[0]?.language || custRow?.language || 'en';

    const msg = buildRefillReminderMessage(
      patientName,
      unsentRows.map((r: any) => ({ medicine_name: r.medicine_name, quantity_needed: r.quantity_needed })),
      medicalName,
      lang
    );

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

    await whatsappQueueWorker.forceNext().catch(() => {});

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
    const cleanDigits = cleanPhone.replace(/^91/, '');
    const custRow = await db.get('SELECT language FROM customers WHERE phone = ? OR phone = ? LIMIT 1', [cleanPhone, cleanDigits]);
    const lang = req.body?.language || tomorrowRefills[0]?.language || custRow?.language || 'en';

    const msg = buildRefillReminderMessage(
      patientName,
      unsent.map(r => ({ medicine_name: r.medicine_name, quantity_needed: r.quantity_needed })),
      medicalName,
      lang,
      tomorrowDateStr
    );

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

    await whatsappQueueWorker.forceNext().catch(() => {});

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
    const cleanDigits = cleanPhone.replace(/^91/, '');
    const custRow = await db.get('SELECT language FROM customers WHERE phone = ? OR phone = ? LIMIT 1', [cleanPhone, cleanDigits]);
    const lang = req.body?.language || rows[0]?.language || custRow?.language || 'en';

    const refillDate = unsentRows[0].next_refill_date
      ? new Date(unsentRows[0].next_refill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : undefined;

    const msg = buildRefillReminderMessage(
      patientName,
      unsentRows.map((r: any) => ({ medicine_name: r.medicine_name, quantity_needed: r.quantity_needed })),
      medicalName,
      lang,
      refillDate
    );

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

    await whatsappQueueWorker.forceNext().catch(() => {});

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
