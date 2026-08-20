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

let refillsTableInitialized = false;

export async function initRefillsTable(db: any) {
  if (refillsTableInitialized) return;
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS patient_refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        patient_name TEXT NOT NULL,
        patient_phone TEXT NOT NULL,
        medicine_id INTEGER NOT NULL,
        refill_interval_days INTEGER DEFAULT 30,
        last_refill_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        next_refill_date DATETIME,
        status TEXT DEFAULT 'pending',
        hold_for_stock INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        is_ready INTEGER DEFAULT 0,
        acknowledged INTEGER DEFAULT 0,
        ordering_triggered INTEGER DEFAULT 0,
        quick_bill_id INTEGER DEFAULT NULL,
        stock_verified_override INTEGER DEFAULT 0,
        quantity_needed INTEGER DEFAULT 3,
        reminder_status TEXT DEFAULT 'NOT_SENT',
        reminder_sent_at DATETIME DEFAULT NULL,
        reminder_job_id INTEGER DEFAULT NULL,
        reminder_occurrence_date DATETIME DEFAULT NULL,
        FOREIGN KEY(medicine_id) REFERENCES medicines(id),
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      )
    `);

    const cols: Array<[string, string]> = [
      ['hold_for_stock', 'INTEGER DEFAULT 0'],
      ['is_active', 'INTEGER DEFAULT 1'],
      ['is_ready', 'INTEGER DEFAULT 0'],
      ['acknowledged', 'INTEGER DEFAULT 0'],
      ['ordering_triggered', 'INTEGER DEFAULT 0'],
      ['quick_bill_id', 'INTEGER DEFAULT NULL'],
      ['stock_verified_override', 'INTEGER DEFAULT 0'],
      ['customer_id', 'INTEGER DEFAULT NULL'],
      ['quantity_needed', 'INTEGER DEFAULT 3'],
      ['language', "TEXT DEFAULT 'en'"],
      ['reminder_status', "TEXT DEFAULT 'NOT_SENT'"],
      ['reminder_sent_at', 'DATETIME DEFAULT NULL'],
      ['reminder_job_id', 'INTEGER DEFAULT NULL'],
      ['reminder_occurrence_date', 'DATETIME DEFAULT NULL']
    ];

    const tableInfo = await db.all('PRAGMA table_info(patient_refills)');
    const existing = new Set(tableInfo.map((c: any) => c.name.toLowerCase()));
    for (const [colName, colDef] of cols) {
      if (!existing.has(colName.toLowerCase())) {
        await db.run(`ALTER TABLE patient_refills ADD COLUMN ${colName} ${colDef}`).catch(() => {});
      }
    }
    refillsTableInitialized = true;
  } catch (_e) {}
}

router.use(async (_req, _res, next) => {
  try {
    const db = await dbManager.getConnection();
    await initRefillsTable(db);
  } catch (_) {}
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
      .map(m => `• ${m.medicine_name || 'दवाई'} (मात्रा: ${m.quantity_needed || 1})`)
      .join('\n');
    const dueSuffix = dueDateStr ? `\n\nतारीख: ${dueDateStr}` : '';
    return `🔔 *दवाई रिफिल रिमाइंडर — ${pharmacyName}*\n\nनमस्ते ${pName},\nआपकी नियमित दवाई का रिफिल समय आ गया है:\n\n${medList}${dueSuffix}\n\n*कृपया डिलीवरी या पिकअप की पुष्टि के लिए उत्तर दें।*`;
  } else if (cleanLang === 'mr') {
    const medList = items
      .map(m => `• ${m.medicine_name || 'औषध'} (प्रमाण: ${m.quantity_needed || 1})`)
      .join('\n');
    const dueSuffix = dueDateStr ? `\n\nदिनांक: ${dueDateStr}` : '';
    return `🔔 *औषध रिफिल स्मरणपत्र — ${pharmacyName}*\n\nनमस्कार ${pName},\nआपल्या नियमित औषधांची रिफिल करण्याची वेळ झाली आहे:\n\n${medList}${dueSuffix}\n\n*कृपया डिलिव्हरी किंवा पिकअप निश्चित करण्यासाठी उत्तर द्या.*`;
  } else {
    const medList = items
      .map(m => `• ${m.medicine_name || 'Medicine'} (Qty: ${m.quantity_needed || 1})`)
      .join('\n');
    const dueSuffix = dueDateStr ? `\n\nDue Date: ${dueDateStr}` : '';
    return `🔔 *MEDICINE REFILL REMINDER — ${pharmacyName}*\n\nDear ${pName},\nYour regular prescription is due for refill:\n\n${medList}${dueSuffix}\n\n*Please reply to confirm delivery or pickup.*`;
  }
}

// Register a manual patient refill request
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

    await db.run(
      `INSERT INTO patient_refills (customer_id, patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status, quantity_needed, language)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [customerId, patient_name, patient_phone, medicine_id, intervalDays, nextRefillStr, quantityNeeded, cleanLang]
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

    // Check if there was an existing next_refill_date for this patient
    const existingRefill = await db.get(
      'SELECT next_refill_date, last_refill_date, refill_interval_days FROM patient_refills WHERE patient_phone = ? OR patient_phone = ? OR (customer_id IS NOT NULL AND customer_id = ?) ORDER BY next_refill_date ASC LIMIT 1',
      [origPhone, cleanPhone, customerId]
    );

    let nextRefillStr: string;
    if (next_refill_date) {
      nextRefillStr = next_refill_date;
    } else if (existingRefill && existingRefill.refill_interval_days === intervalDays && existingRefill.next_refill_date && new Date(existingRefill.next_refill_date) > new Date()) {
      // Keep existing next_refill_date ONLY if the interval days did NOT change and it's in the future
      nextRefillStr = existingRefill.next_refill_date;
    } else {
      // Recalculate next refill date based on the new interval
      const nextRefillDate = new Date();
      nextRefillDate.setDate(nextRefillDate.getDate() + intervalDays);
      nextRefillStr = nextRefillDate.toISOString().slice(0, 19).replace('T', ' ');
    }

    // Delete previous refill records for this patient
    if (customerId) {
      await db.run('DELETE FROM patient_refills WHERE patient_phone = ? OR patient_phone = ? OR customer_id = ?', [origPhone, cleanPhone, customerId]);
    } else {
      await db.run('DELETE FROM patient_refills WHERE patient_phone = ? OR patient_phone = ?', [origPhone, cleanPhone]);
    }

    // Insert updated medicines
    for (const med of medicines) {
      const medId = med.medicine_id || med.medicineId;
      if (!medId) continue;
      const qtyNeeded = parseInt(med.quantity_needed || med.quantity, 10) || 3;
      await db.run(
        `INSERT INTO patient_refills (customer_id, patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status, quantity_needed, is_active, language)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?)`,
        [customerId, cleanName, cleanPhone, medId, intervalDays, nextRefillStr, qtyNeeded, cleanLang]
      );
    }

    // Re-check inventory stock and trigger necessary alerts/schedules
    await checkAllRefills(db);

    res.json({ success: true, message: 'Patient refill schedule updated successfully', interval_days: intervalDays, next_refill_date: nextRefillStr });
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
