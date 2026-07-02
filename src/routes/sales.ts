import express from 'express';
import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Helper to normalize numeric search terms (e.g., stripping trailing decimal zeros like "31.00" -> "31")
// to align with SQLite CAST(value AS TEXT) representations.
const normalizeNumericSearch = (val: string): string => {
  const cleaned = val.trim();
  if (!cleaned) return '';
  // If it's a decimal number, parse it to strip trailing zeros (e.g., 31.00 -> 31, 31.50 -> 31.5)
  if (/^\d+\.\d+$/.test(cleaned)) {
    return String(parseFloat(cleaned));
  }
  // If it ends with a dot, strip it (e.g., 31. -> 31)
  if (/^\d+\.$/.test(cleaned)) {
    return cleaned.slice(0, -1);
  }
  return cleaned;
};

// Configuration: tune these values for your environment
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;           // hard cap to avoid huge payloads
const MAX_ITEMS_IN_BATCH = 200;  // max invoices to fetch items for in a single response
const SQLITE_BUSY_RETRIES = 5;
const SQLITE_BUSY_BASE_DELAY_MS = 100; // exponential backoff base

// Helper sleep
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Wrap DB queries to retry on SQLITE_BUSY and set busy_timeout
async function queryAllWithRetry(db: Database, sql: string, params: any[] = []) {
  // Ensure busy timeout is set (ms). Safe to call repeatedly.
  try {
    await db.run('PRAGMA busy_timeout = 5000'); // 5 seconds
  } catch (e) {
    // ignore if not supported
  }

  let attempt = 0;
  while (true) {
    try {
      return await db.all(sql, params);
    } catch (err: any) {
      const code = err && (err.code || err.errno || err.message);
      const isBusy = typeof code === 'string' ? code.includes('BUSY') : (err && err.message && err.message.includes('BUSY'));
      if (isBusy && attempt < SQLITE_BUSY_RETRIES) {
        const backoff = SQLITE_BUSY_BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(backoff);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

const generateInvoiceNo = async (db: Database) => {
  const year = new Date().getFullYear();
  const prefix = `S-${year}-`;
  const row = await db.get('SELECT invoice_no FROM sales_invoices WHERE invoice_no LIKE ? ORDER BY invoice_no DESC LIMIT 1', `${prefix}%`);
  let nextNum = 1;
  if (row && row.invoice_no) {
    const parts = row.invoice_no.split('-');
    const numPart = parts[2];
    nextNum = parseInt(numPart, 10) + 1;
  }
  const padded = String(nextNum).padStart(4, '0');
  return `${prefix}${padded}`;
};

// Get next sequential invoice number
router.get('/next-invoice', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const invoice_no = await generateInvoiceNo(db);
        res.json({ invoice_no });
  } catch (error) {
    const err = error as Error;
    console.error(JSON.stringify({
      message: 'Failed to get next invoice',
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new sale
router.post('/', async (req, res) => {
  let db;
  try {
    const { items = [], patient_id, doctor_id, doctor_name, discount = 0, patient_name, patient_phone, patient_address, paymentMedium = 'CASH', paymentStatus = 'PAID', sendWhatsApp = false, sale_date, refillEnabled = false, refillDays = 30, refillId } = req.body;

    // Strict validation: check items parameters to prevent null values
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart items required' });
    }

    for (const item of items) {
      const { inventory_id, quantity = 0, unit_price = 0, medicine_name } = item;
      if (Number(quantity) <= 0 || Number(unit_price) <= 0 || isNaN(Number(quantity)) || isNaN(Number(unit_price))) {
        return res.status(400).json({ error: 'Invalid items data. Quantity and unit price must be valid positive numbers.' });
      }
      if (!inventory_id && !medicine_name) {
        return res.status(400).json({ error: 'Invalid items data. Each item must have either an inventory_id or a medicine_name.' });
      }
    }

    if (isNaN(Number(discount)) || Number(discount) < 0) {
      return res.status(400).json({ error: 'Discount must be a valid non-negative number.' });
    }

    db = await dbManager.getConnection();
    
    // Start transaction to enforce atomicity
    await db.run('BEGIN TRANSACTION');

    // Resolve or auto-create customer/patient
    let customerId = patient_id || null;
    if (patient_name) {
      const cleanPhone = patient_phone || '';
      const existing = await db.get('SELECT id FROM customers WHERE name = ? AND phone = ?', [patient_name, cleanPhone]);
      if (existing) {
        customerId = existing.id;
      } else {
        const custResult = await db.run(
          'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)',
          [patient_name, cleanPhone, patient_address || '']
        );
        customerId = custResult.lastID;
      }
    }

    // Compute subtotal, tax, and total strictly checking values to prevent null/NaN
    let subtotal = 0;
    for (const item of items) {
      const { quantity = 0, unit_price = 0, loose_qty = 0, pack_size = 10, discount_per = 0 } = item;
      const q = Number(quantity);
      const l = Number(loose_qty);
      const pSize = Number(pack_size || 10);
      const d = Number(discount_per);
      const uPrice = Number(unit_price);
      const dPrice = uPrice * (1 - d / 100);
      subtotal += (q * dPrice) + (l * (dPrice / pSize));
    }

    const taxRate = 0.05; // 5% tax
    const total = Math.round(subtotal - Number(discount));
    const tax = Number((total * taxRate / (1 + taxRate)).toFixed(2));

    if (isNaN(subtotal) || isNaN(tax) || isNaN(total)) {
      throw new Error('Calculated totals resulted in NaN value.');
    }

    // Generate invoice number
    const invoice_no = await generateInvoiceNo(db);

    // Insert invoice
    const invoiceDateValue = sale_date ? new Date(sale_date).toISOString() : new Date().toISOString();
    const result = await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, tax_amount, payment_medium, payment_status, date, discount, subtotal, doctor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [invoice_no, customerId, total, tax, paymentMedium, paymentStatus, invoiceDateValue, Number(discount), subtotal, doctor_id || null]
    );
    const invoiceId = result.lastID;
    if (!invoiceId) {
      throw new Error('Failed to retrieve inserted invoice ID.');
    }

    // Insert line items and update inventory
    for (const item of items) {
      let { inventory_id, quantity, unit_price, loose_qty = 0, medicine_name, batch_no, expiry_date, mrp } = item;
      
      if (!inventory_id) {
        const cleanName = (medicine_name || 'Custom Medicine').trim();
        const { normalizeMedicineName } = await import('../utils/nameNormalizer.js');
        const adjustedName = normalizeMedicineName(cleanName);
        let dbMed = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [adjustedName]);
        let medicineId;
        if (dbMed) {
          medicineId = dbMed.id;
        } else {
          const medResult = await db.run('INSERT INTO medicines (name, mrp) VALUES (?, ?)', [adjustedName, mrp || unit_price]);
          medicineId = medResult.lastID;
        }

        const bNo = (batch_no || 'MANUAL').trim();
        const expDate = expiry_date || '12/28';
        let invRow = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medicineId, bNo]);
        if (invRow) {
          inventory_id = invRow.id;
        } else {
          const insertRes = await db.run(
            `INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, cost_price, mrp, loose_quantity)
             VALUES (?, ?, ?, ?, ?, ?, 0)`,
            [medicineId, Math.max(100, Number(quantity)), bNo, expDate, unit_price * 0.7, mrp || unit_price]
          );
          inventory_id = insertRes.lastID;
        }
      }

      // Stock Level Verification before processing decrement
      const currentStock = await db.get('SELECT quantity, expiry_date FROM inventory_master WHERE id = ?', [inventory_id]);
      if (!currentStock || currentStock.quantity < Number(quantity)) {
        const needed = Number(quantity) - (currentStock ? currentStock.quantity : 0);
        if (currentStock) {
          await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [needed, inventory_id]);
        } else {
          throw new Error(`Inventory item ID ${inventory_id} does not exist.`);
        }
      }

      await db.run(
        'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per) VALUES (?, ?, ?, ?, ?, ?)',
        [invoiceId, inventory_id, Number(quantity), Number(unit_price), Number(loose_qty), Number(item.discount_per || item.discountPer || 0)]
      );
      
      // Decrement stock in inventory_master.
      const decrementResult = await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [Number(quantity), inventory_id]);
      if (decrementResult.changes === 0) {
        throw new Error(`Failed to decrement stock for inventory ID ${inventory_id}`);
      }

      // Handle refill logic if enabled
      if (refillEnabled && inventory_id) {
        const invRecord = await db.get('SELECT medicine_id FROM inventory_master WHERE id = ?', [inventory_id]);
        if (invRecord && invRecord.medicine_id) {
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + Number(refillDays));
          
          await db.run(
            'INSERT INTO patient_refills (patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status) VALUES (?, ?, ?, ?, ?, ?)',
            [patient_name || 'Walk-in Customer', patient_phone || '', invRecord.medicine_id, refillDays, nextDate.toISOString(), 'pending']
          );
        }
      }
    }

    // Resolve refill cycle if this sale completes a pending refill
    if (refillId) {
      const refill = await db.get('SELECT * FROM patient_refills WHERE id = ?', [refillId]);
      if (refill) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + Number(refill.refill_interval_days || 30));
        const nextDateStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');

        await db.run(
          `UPDATE patient_refills 
           SET last_refill_date = datetime('now'), 
               next_refill_date = ?, 
               acknowledged = 0, 
               ordering_triggered = 0, 
               is_ready = 0, 
               hold_for_stock = 0, 
               quick_bill_id = NULL 
           WHERE id = ?`,
          [nextDateStr, refillId]
        );

        if (refill.quick_bill_id) {
          // Delete held bill session (no stock restore since it's checked out)
          await db.run('DELETE FROM held_bills WHERE id = ?', [refill.quick_bill_id]);
        }

        // Mark staged message as sent
        await db.run(
          `UPDATE automation_notifications 
           SET lifecycle_status = 'sent' 
           WHERE type = 'refill_collection' AND reference_id = ? AND lifecycle_status = 'staged'`,
          [String(refillId)]
        );
      }
    }

    // Commit transaction
    await db.run('COMMIT');
    
    // Trigger WhatsApp invoice sending if requested
    if (sendWhatsApp) {
      import('../services/whatsappInvoiceService.js')
        .then(({ whatsappInvoiceService }) => {
          whatsappInvoiceService.sendInvoiceViaWhatsApp(invoiceId).catch(err => {
            console.error(`Error in async WhatsApp dispatch for invoice ${invoice_no}:`, err);
          });
        })
        .catch(err => console.error('Failed to load whatsappInvoiceService:', err));
    }

    res.json({ success: true, invoice_no, total, tax });
  } catch (error) {
    if (db) {
      try {
        await db.run('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr);
      }
          }
    const err = error as Error;
    console.error(JSON.stringify({
      message: 'Failed to create sale (rolled back)',
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Hold a bill (Unified endpoint supporting both HTML and React POS formats)
router.post('/hold', async (req, res) => {
  let db;
  try {
    if (!req.body) {
      return res.status(400).json({ error: 'Request body required' });
    }
    db = await dbManager.getConnection();
    
    // Extract fields from body
    const { 
      temp_label, 
      patient_name, 
      patient_phone, 
      doctor_name, 
      discount = 0, 
      remarks, 
      cart_data,
      data,
      items,
      patient,
      doctor
    } = req.body;

    // Standardize variables
    const finalPatientName = patient_name || (patient && typeof patient === 'object' ? patient.name : patient) || '';
    const finalPatientPhone = patient_phone || (patient && typeof patient === 'object' ? patient.phone : '') || '';
    const finalDoctor = doctor_name || doctor || '';
    const finalDiscount = discount || 0;
    const finalCartData = cart_data || items || [];
    
    // Create serialized data blob for compatibility with legacy HTML restoration
    const serializedData = data || JSON.stringify({
      items: finalCartData,
      patient: patient || { name: finalPatientName, phone: finalPatientPhone },
      doctor: finalDoctor,
      discount: finalDiscount,
      date: new Date().toLocaleString(),
      remarks: remarks || ''
    });

    const holdInvoiceNo = await generateInvoiceNo(db);
    
    await db.run('BEGIN TRANSACTION');

    const parsedItems = typeof finalCartData === 'string' ? JSON.parse(finalCartData) : finalCartData;
    for (const item of parsedItems) {
      if (item.id && typeof item.id === 'number' && item.id < 1000000) {
        const inventory_id = item.id;
        const qty = Number(item.qty || 0);
        if (qty > 0) {
          const currentStock = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [inventory_id]);
          if (!currentStock || currentStock.quantity < qty) {
            throw new Error(`Insufficient stock for hold bill item ID ${inventory_id}.`);
          }
          await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [qty, inventory_id]);
        }
      }
    }
    
    await db.run(
      `INSERT INTO held_bills (
        invoice_no, temp_label, patient_name, patient_phone, doctor_name, 
        discount, remarks, cart_data, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        holdInvoiceNo,
        temp_label || finalPatientName || 'Held Bill',
        finalPatientName,
        finalPatientPhone,
        finalDoctor,
        finalDiscount,
        remarks || '',
        typeof finalCartData === 'string' ? finalCartData : JSON.stringify(finalCartData),
        serializedData
      ]
    );

    await db.run('COMMIT');
        res.json({ success: true, message: 'Bill held successfully', invoice_no: holdInvoiceNo });
  } catch (error) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch(e){}
          }
    const err = error as Error;
    console.error('Failed to hold bill:', err);
    res.status(500).json({ error: 'Failed to hold bill' });
  }
});

// Get recommended quantity for a medicine based on sales history mode
router.get('/recommend-quantity', async (req, res) => {
  const medicineName = req.query.medicineName as string;
  if (!medicineName) {
    return res.status(400).json({ error: 'medicineName query parameter required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    // Look up matching medicine first
    const med = await db.get(
      'SELECT id, name FROM medicines WHERE name LIKE ? LIMIT 1',
      `%${medicineName}%`
    );

    if (!med) {
            return res.json({ recommendedQty: 1, type: 'strip', message: 'No matching history found' });
    }

    // Query historical sales quantities for this medicine
    const history = await db.all(
      `SELECT si.quantity, COUNT(*) as count 
       FROM sale_items si
       JOIN inventory_master im ON si.inventory_id = im.id
       WHERE im.medicine_id = ?
       GROUP BY si.quantity
       ORDER BY count DESC
       LIMIT 3`,
      med.id
    );

    
    if (history.length > 0) {
      const mostFrequent = history[0];
      const qty = mostFrequent.quantity;
      let recommendedType = 'strip';
      let displayQty = qty;

      if (qty < 10) {
        recommendedType = 'loose';
        displayQty = qty;
      } else if (qty % 10 === 0) {
        recommendedType = 'strip';
        displayQty = qty / 10;
      } else {
        recommendedType = 'loose';
        displayQty = qty;
      }

      return res.json({
        recommendedQty: displayQty,
        type: recommendedType,
        actualUnits: qty,
        message: `Recommended: ${displayQty} ${recommendedType === 'strip' ? 'strip(s)' : 'loose unit(s)'} (based on ${mostFrequent.count} past order(s))`
      });
    }

    res.json({ recommendedQty: 1, type: 'strip', message: 'Default: 1 strip recommended' });
  } catch (error) {
    console.error('Failed to get recommendation:', error);
    res.status(500).json({ error: 'Failed to analyze previous sales data' });
  }
});

// Get batch recommendations for a list of medicine names in a single query
router.get('/recommend-quantity/batch', async (req, res) => {
  const namesParam = req.query.medicineNames as string;
  if (!namesParam) {
    return res.status(400).json({ error: 'medicineNames query parameter required' });
  }

  const medicineNames = namesParam.split(',').map(n => n.trim()).filter(Boolean);
  if (medicineNames.length === 0) {
    return res.json({});
  }

  let db;
  try {
    db = await dbManager.getConnection();
    const results: Record<string, { recommendedQty: number, type: string, message: string }> = {};

    // 1. Fetch matching medicine IDs using exact IN query
    const placeholders = medicineNames.map(() => '?').join(',');
    const meds = await db.all(
      `SELECT id, name FROM medicines WHERE name IN (${placeholders})`,
      medicineNames
    );

    const medIdToName: Record<number, string> = {};
    const medIds: number[] = [];
    
    meds.forEach(m => {
      medIdToName[m.id] = m.name;
      medIds.push(m.id);
    });

    // For any name that didn't have an exact match, try a quick LIKE query
    const exactMatchedNames = new Set(meds.map(m => m.name.toLowerCase()));
    for (const name of medicineNames) {
      if (!exactMatchedNames.has(name.toLowerCase())) {
        const partialMed = await db.get(
          'SELECT id, name FROM medicines WHERE name LIKE ? LIMIT 1',
          `%${name}%`
        );
        if (partialMed) {
          medIds.push(partialMed.id);
          medIdToName[partialMed.id] = name;
        } else {
          results[name] = { recommendedQty: 1, type: 'strip', message: 'Default: 1 strip recommended' };
        }
      }
    }

    if (medIds.length > 0) {
      const idPlaceholders = medIds.map(() => '?').join(',');
      // Query historical sales quantities for all these medicines in a single query
      const historyRows = await db.all(
        `SELECT im.medicine_id, si.quantity, COUNT(*) as count 
         FROM sale_items si
         JOIN inventory_master im ON si.inventory_id = im.id
         WHERE im.medicine_id IN (${idPlaceholders})
         GROUP BY im.medicine_id, si.quantity
         ORDER BY count DESC`,
        medIds
      );

      // Group by medicine_id to find the most frequent quantity
      const bestMedsQty: Record<number, { quantity: number; count: number }> = {};
      for (const row of historyRows) {
        if (!bestMedsQty[row.medicine_id]) {
          bestMedsQty[row.medicine_id] = { quantity: row.quantity, count: row.count };
        }
      }

      // Map recommendations back to names
      for (const medId of medIds) {
        const name = medIdToName[medId];
        const rec = bestMedsQty[medId];
        if (rec) {
          const qty = rec.quantity;
          let recommendedType = 'strip';
          let displayQty = qty;

          if (qty < 10) {
            recommendedType = 'loose';
            displayQty = qty;
          } else if (qty % 10 === 0) {
            recommendedType = 'strip';
            displayQty = qty / 10;
          } else {
            recommendedType = 'loose';
            displayQty = qty;
          }

          results[name] = {
            recommendedQty: displayQty,
            type: recommendedType,
            message: `Recommended: ${displayQty} ${recommendedType === 'strip' ? 'strip(s)' : 'loose unit(s)'} (based on ${rec.count} past order(s))`
          };
        } else {
          results[name] = { recommendedQty: 1, type: 'strip', message: 'Default: 1 strip recommended' };
        }
      }
    }

    // Fill in default for any remaining queried names
    for (const name of medicineNames) {
      if (!results[name]) {
        results[name] = { recommendedQty: 1, type: 'strip', message: 'Default: 1 strip recommended' };
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Failed to get batch recommendation:', error);
    res.status(500).json({ error: 'Failed to analyze previous sales data' });
  }
});



// List all sales invoices with customer info and items
router.get('/list', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    
    // Parse filters
    const search = (req.query.search as string) || '';
    const date_from = (req.query.date_from as string) || '';
    const date_to = (req.query.date_to as string) || '';
    const batch = (req.query.batch as string) || '';

    // Pagination params
    const clientLimitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : NaN;
    const page = req.query.page ? Math.max(0, parseInt(req.query.page as string, 10)) : 0;
    // Decide final limit: if client explicitly provided limit, respect it but cap to MAX_LIMIT.
    const limit = Number.isFinite(clientLimitRaw) ? Math.min(Math.max(1, clientLimitRaw), MAX_LIMIT) : DEFAULT_LIMIT;
    const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset as string, 10)) : page * limit;

    // include_items must be explicitly requested (default false)
    const includeItems = (req.query.include_items === '1' || req.query.include_items === 'true');

    // Build WHERE clause safely
    const whereClauses: string[] = [];
    const params: any[] = [];

    if (search) {
      whereClauses.push('(si.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR EXISTS (SELECT 1 FROM sale_items sale_it JOIN inventory_master inv_m ON sale_it.inventory_id = inv_m.id WHERE sale_it.invoice_id = si.id AND inv_m.batch_no LIKE ?))');
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (date_from) {
      whereClauses.push('DATE(si.date) >= DATE(?)');
      params.push(date_from);
    }
    if (date_to) {
      whereClauses.push('DATE(si.date) <= DATE(?)');
      params.push(date_to);
    }
    if (batch) {
      whereClauses.push('EXISTS (SELECT 1 FROM sale_items sale_it JOIN inventory_master inv_m ON sale_it.inventory_id = inv_m.id WHERE sale_it.invoice_id = si.id AND inv_m.batch_no LIKE ?)');
      params.push(`%${batch}%`);
    }

    const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : 'WHERE 1=1';

    // Query invoices (only invoice-level fields; avoid heavy joins here)
    const invoicesSql = `
      SELECT 
        si.id, si.invoice_no, si.date, si.total_amount, si.tax_amount,
        si.payment_medium, si.payment_status, si.roff, si.discount, si.subtotal,
        si.cgst_value, si.sgst_value, si.igst_value,
        c.name as customer_name, c.phone as customer_phone,
        d.name as doctor_name
      FROM sales_invoices si
      LEFT JOIN customers c ON si.customer_id = c.id
      LEFT JOIN doctors d ON si.doctor_id = d.id
      ${where}
      ORDER BY si.date DESC, si.id DESC
      LIMIT ? OFFSET ?
    `;
    const invoicesParams = params.concat([limit, offset]);

    const invoices = await queryAllWithRetry(db, invoicesSql, invoicesParams);

    // If client asked for items, fetch them in a single batched query (avoid N+1).
    if (includeItems && invoices.length > 0) {
      const invoiceIds = invoices.map((i: any) => i.id);

      // Guard: protect server and client from extremely large IN(...) queries and huge payloads.
      if (invoiceIds.length > MAX_ITEMS_IN_BATCH) {
        // Do not automatically include items for huge pages; instruct client to fetch per-invoice or reduce page size.
        return res.status(400).json({
          ok: false,
          message: `Too many invoices (${invoiceIds.length}) to include line items. Reduce page size or request items per-invoice.`,
          invoices,
          hint: 'Request /api/sales/:id for specific invoice items or set include_items only when limit <= ' + MAX_ITEMS_IN_BATCH
        });
      }

      // Prepare placeholders for IN clause
      const placeholders = invoiceIds.map(() => '?').join(',');
      const itemsSql = `
        SELECT si.*, im.batch_no as batch_number, im.expiry_date, m.name as medicine_name,
               m.mrp, m.id as medicine_id, 10 as pack_size
        FROM sale_items si
        JOIN inventory_master im ON si.inventory_id = im.id
        JOIN medicines m ON im.medicine_id = m.id
        WHERE si.invoice_id IN (${placeholders})
        ORDER BY si.invoice_id, si.id
      `;
      const allItems = await queryAllWithRetry(db, itemsSql, invoiceIds);

      // Map items back to invoices
      const itemsMap: Record<number, any[]> = {};
      for (const it of allItems) {
        const invId = it.invoice_id;
        if (!itemsMap[invId]) itemsMap[invId] = [];
        itemsMap[invId].push(it);
      }
      for (const inv of invoices) {
        inv.items = itemsMap[inv.id] || [];
      }
    } else {
      // Don't include items; but include a small preview count to help the UI (cheap aggregate query)
      if (invoices.length > 0) {
        const invoiceIds = invoices.map((i: any) => i.id);
        const placeholders = invoiceIds.map(() => '?').join(',');
        const countsSql = `SELECT invoice_id, COUNT(*) as item_count FROM sale_items WHERE invoice_id IN (${placeholders}) GROUP BY invoice_id`;
        const counts = await queryAllWithRetry(db, countsSql, invoiceIds);
        const countMap: Record<number, number> = {};
        for (const c of counts) countMap[c.invoice_id] = c.item_count;
        for (const inv of invoices) {
          inv.item_count = countMap[inv.id] || 0;
          inv.items = []; // Ensure items is defined
        }
      }
    }

    // Optional: total count for pagination (lightweight count query with same filters)
    const countSql = `SELECT COUNT(*) as total FROM sales_invoices si LEFT JOIN customers c ON si.customer_id = c.id ${where}`;
    const countResult = await queryAllWithRetry(db, countSql, params);
    const total = (countResult && countResult[0] && countResult[0].total) ? countResult[0].total : 0;

    // Return format: if paginated, include_items or page was specified, return the new paginated object.
    // Otherwise return array directly for full backwards-compatibility.
    if (req.query.paginated === 'true' || req.query.page !== undefined || req.query.limit !== undefined) {
      return res.json({
        ok: true,
        meta: { total, limit, offset },
        invoices
      });
    } else {
      return res.json(invoices);
    }
  } catch (err: any) {
    console.error('sales/list error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Search medicine in inventory by Name, Batch, or MRP
router.get('/search-medicine', async (req, res) => {
  const query = req.query.q as string;
  if (!query || query.trim().length < 2) {
    return res.json([]);
  }
  let db;
  try {
    db = await dbManager.getConnection();
    const cleanQuery = query.trim();
    const isNumeric = /^\d+(\.\d+)?$/.test(cleanQuery);
    
    let rows = [];
    if (isNumeric) {
      // Numeric query: search by item_code, MRP text cast, batch, or name prefix/infix
      const exactQuery = cleanQuery;
      const normalizedQuery = normalizeNumericSearch(cleanQuery);
      const likeQuery = `%${normalizedQuery}%`;
      const sql = `
        SELECT 
          m.id AS medicine_id, 
          m.name AS medicine_name, 
          m.api_reference,
          m.item_code AS item_code,
          m.manufacturer AS manufacturer,
          im.id AS inventory_id, 
          im.batch_no, 
          MIN(im.expiry_date) AS expiry_date, 
          SUM(im.quantity) AS quantity, 
          COALESCE(im.mrp, m.mrp, 0) AS mrp, 
          im.unit_price, 
          COALESCE(im.cost_price, 0) AS cost_price,
          m.cgst, 
          m.sgst, 
          m.igst, 
          m.hsn_code,
          0 AS is_out_of_stock
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        WHERE (m.item_code = ? 
           OR m.name LIKE ? 
           OR CAST(COALESCE(im.mrp, 0) AS TEXT) LIKE ?
           OR im.batch_no LIKE ?)
          AND im.quantity > 0
          AND date(im.expiry_date) >= date('now')
        GROUP BY m.id, COALESCE(im.mrp, m.mrp, 0)
        ORDER BY m.name ASC
        LIMIT 30
      `;
      rows = await db.all(sql, [exactQuery, likeQuery, likeQuery, likeQuery]);
    } else {
      // Alphabetical query: try fast index prefix search on m.name first
      const prefixQuery = `${cleanQuery}%`;
      const prefixSql = `
        SELECT 
          m.id AS medicine_id, 
          m.name AS medicine_name, 
          m.api_reference,
          m.item_code AS item_code,
          m.manufacturer AS manufacturer,
          im.id AS inventory_id, 
          im.batch_no, 
          MIN(im.expiry_date) AS expiry_date, 
          SUM(im.quantity) AS quantity, 
          COALESCE(im.mrp, m.mrp, 0) AS mrp, 
          im.unit_price, 
          COALESCE(im.cost_price, 0) AS cost_price,
          m.cgst, 
          m.sgst, 
          m.igst, 
          m.hsn_code,
          0 AS is_out_of_stock
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        WHERE m.name LIKE ?
          AND im.quantity > 0
          AND date(im.expiry_date) >= date('now')
        GROUP BY m.id, COALESCE(im.mrp, m.mrp, 0)
        ORDER BY m.name ASC
        LIMIT 30
      `;
      rows = await db.all(prefixSql, [prefixQuery]);

      // Fall back to general name/item_code infix search only if we got fewer than 15 rows
      if (rows.length < 15) {
        const likeQuery = `%${cleanQuery}%`;
        const fallbackSql = `
          SELECT 
            m.id AS medicine_id, 
            m.name AS medicine_name, 
            m.api_reference,
            m.item_code AS item_code,
            m.manufacturer AS manufacturer,
            im.id AS inventory_id, 
            im.batch_no, 
            MIN(im.expiry_date) AS expiry_date, 
            SUM(im.quantity) AS quantity, 
            COALESCE(im.mrp, m.mrp, 0) AS mrp, 
            im.unit_price, 
            COALESCE(im.cost_price, 0) AS cost_price,
            m.cgst, 
            m.sgst, 
            m.igst, 
            m.hsn_code,
            0 AS is_out_of_stock
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE (m.name LIKE ? OR m.item_code LIKE ?)
            AND im.quantity > 0
            AND date(im.expiry_date) >= date('now')
          GROUP BY m.id, COALESCE(im.mrp, m.mrp, 0)
          ORDER BY m.name ASC
          LIMIT 30
        `;
        const fallbackRows = await db.all(fallbackSql, [likeQuery, likeQuery]);
        
        // Merge without duplicates
        const seenIds = new Set(rows.map(r => r.inventory_id));
        for (const row of fallbackRows) {
          if (!seenIds.has(row.inventory_id)) {
            rows.push(row);
            if (rows.length >= 30) break;
          }
        }
      }
    }
    
    // Map SQLite numeric values back to boolean for is_out_of_stock compatibility
    for (const row of rows) {
      row.is_out_of_stock = row.is_out_of_stock === 1;
    }
    
    // Fetch alternatives in a single batched query
    const apiRefs = [...new Set(rows.map(r => r.api_reference).filter(a => a && a.trim() !== ''))];
    let alternativesMap: Record<string, any[]> = {};
    
    if (apiRefs.length > 0) {
      const placeholders = apiRefs.map(() => '?').join(',');
      const altSql = `
        SELECT im.id as inventory_id, im.medicine_id, m.name as medicine_name, m.api_reference,
               im.batch_no, im.expiry_date, im.quantity, im.mrp, im.unit_price, im.cost_price,
               m.cgst, m.sgst, m.igst, m.hsn_code
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        WHERE m.api_reference IN (${placeholders})
          AND im.quantity > 0
        LIMIT 100
      `;
      const allAlts = await db.all(altSql, apiRefs);
      for (const alt of allAlts) {
        if (!alternativesMap[alt.api_reference]) alternativesMap[alt.api_reference] = [];
        alternativesMap[alt.api_reference].push(alt);
      }
    }

    // Attach alternatives
    for (const row of rows) {
      const alts = alternativesMap[row.api_reference] || [];
      // Filter out self alternatives
      row.alternatives = alts.filter(a => a.medicine_id !== row.medicine_id).slice(0, 5);
    }

    res.json(rows);
  } catch (error) {
    console.error('Failed to search medicine:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Universal search for medicine and substitutes (same composition)
router.get('/universal-search', async (req, res) => {
  const query = req.query.q as string;
  if (!query) {
    return res.json([]);
  }
  let db;
  try {
    db = await dbManager.getConnection();
    const likeQuery = `%${query}%`;
    
    // Find medicines matching name or composition
    const matchedMeds = await db.all(`
      SELECT m.id, m.name, m.api_reference, m.mrp,
             COALESCE((SELECT SUM(quantity) FROM inventory_master WHERE medicine_id = m.id), 0) as stock_qty
      FROM medicines m
      WHERE m.name LIKE ? OR m.api_reference LIKE ?
      LIMIT 30
    `, [likeQuery, likeQuery]);
    
        res.json(matchedMeds);
  } catch (error) {
    console.error('Universal search failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List all held bills
router.get('/hold', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const rows = await db.all('SELECT * FROM held_bills ORDER BY date DESC');
        res.json(rows);
  } catch (error) {
    console.error('Failed to retrieve held bills:', error);
    res.status(500).json({ error: 'Failed to retrieve held bills' });
  }
});

// Retrieve pending or all staged sales
router.get('/staged', async (req, res) => {
  const { all } = req.query;
  let db;
  try {
    db = await dbManager.getConnection();
    const query = all === 'true'
      ? `SELECT * FROM staged_sales ORDER BY sale_date DESC`
      : `SELECT * FROM staged_sales WHERE status = 'pending' ORDER BY sale_date DESC`;
    const rows = await db.all(query);
    const parsed = rows.map(r => ({
      ...r,
      items: JSON.parse(r.items_json)
    }));
    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to retrieve staged sales' });
  }
});

// Get single sale invoice with items
router.get('/:id', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const id = parseInt(req.params.id, 10);

    const invoices = await queryAllWithRetry(
      db,
      `SELECT si.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address, d.name as doctor_name
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       LEFT JOIN doctors d ON si.doctor_id = d.id
       WHERE si.id = ?`,
      [id]
    );

    if (!invoices || invoices.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const invoice = invoices[0];

    invoice.items = await queryAllWithRetry(
      db,
      `SELECT si.*, im.batch_no as batch_number, im.expiry_date, im.mrp as item_mrp, 10 as pack_size,
              m.name as medicine_name, m.mrp as medicine_mrp, m.id as medicine_id
       FROM sale_items si
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE si.invoice_id = ?`,
      [id]
    );

    res.json(invoice);
  } catch (error: any) {
    console.error('sales/:id error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Update a sale invoice (items, customer, discount, etc.)
router.put('/:id', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const { id } = req.params;
    const { items, patient_name, patient_phone, discount = 0, paymentMedium, paymentStatus, doctor_id } = req.body;

    await db.run('BEGIN TRANSACTION');

    // Check invoice exists
    const existing = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [id]);
    if (!existing) {
      await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Invoice not found' });
    }

    // Resolve customer
    let customerId = existing.customer_id;
    if (patient_name) {
      const existingCust = await db.get('SELECT id FROM customers WHERE name = ? AND phone = ?', [patient_name, patient_phone || '']);
      if (existingCust) {
        customerId = existingCust.id;
      } else {
        const custResult = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [patient_name, patient_phone || '']);
        customerId = custResult.lastID;
      }
    }

    // If items changed, reverse old stock and replace
    if (Array.isArray(items)) {
      // Reverse old stock
      const oldItems = await db.all('SELECT inventory_id, quantity FROM sale_items WHERE invoice_id = ?', [id]);
      for (const oi of oldItems) {
        await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [oi.quantity, oi.inventory_id]);
      }

      // Delete old items
      await db.run('DELETE FROM sale_items WHERE invoice_id = ?', [id]);

      // Compute new totals
      let subtotal = 0;
      for (const item of items) {
        const { inventory_id, quantity = 0, unit_price = 0, loose_qty = 0, pack_size = 10, discount_per = 0 } = item;
        
        // Stock Level & Expiry Verification
        const currentStock = await db.get('SELECT quantity, expiry_date FROM inventory_master WHERE id = ?', [inventory_id]);
        if (!currentStock || currentStock.quantity < Number(quantity)) {
          throw new Error(`Insufficient stock for inventory item ID ${inventory_id}. Available: ${currentStock ? currentStock.quantity : 0}, Requested: ${quantity}`);
        }

        if (currentStock.expiry_date) {
          let expDate;
          if (currentStock.expiry_date.includes('/')) {
            const parts = currentStock.expiry_date.split('/');
            let year = parseInt(parts[1], 10);
            const month = parseInt(parts[0], 10) - 1;
            if (year < 100) year += 2000;
            expDate = new Date(year, month + 1, 0);
          } else {
            expDate = new Date(currentStock.expiry_date);
          }
          if (expDate < new Date()) {
            throw new Error(`Cannot sell expired product. Inventory ID ${inventory_id} expired on ${currentStock.expiry_date}.`);
          }
        }

        await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per) VALUES (?, ?, ?, ?, ?, ?)', [id, inventory_id, quantity, unit_price, loose_qty, discount_per]);
        await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [quantity, inventory_id]);
        
        const q = Number(quantity);
        const l = Number(loose_qty);
        const pSize = Number(pack_size || 10);
        const d = Number(discount_per);
        const uPrice = Number(unit_price);
        const dPrice = uPrice * (1 - d / 100);
        subtotal += (q * dPrice) + (l * (dPrice / pSize));
      }

      const taxRate = 0.05;
      const total = Math.round(subtotal - discount);
      const tax = Number((total * taxRate / (1 + taxRate)).toFixed(2));

      await db.run(
        'UPDATE sales_invoices SET customer_id = ?, total_amount = ?, tax_amount = ?, payment_medium = COALESCE(?, payment_medium), payment_status = COALESCE(?, payment_status), discount = ?, subtotal = ?, doctor_id = ? WHERE id = ?',
        [customerId, total, tax, paymentMedium || null, paymentStatus || null, Number(discount), subtotal, doctor_id || null, id]
      );
    } else {
      // Just update customer/discount
      await db.run('UPDATE sales_invoices SET customer_id = ? WHERE id = ?', [customerId, id]);
    }

    await db.run('COMMIT');
        res.json({ success: true, message: 'Invoice updated' });
  } catch (error) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch(e){}
          }
    const err = error as Error;
    console.error(JSON.stringify({ message: 'Failed to update sale', error: err.message, timestamp: new Date().toISOString() }));
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Delete a sale invoice (reverses stock)
router.delete('/:id', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const { id } = req.params;

    const existing = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [id]);
    if (!existing) {
            return res.status(404).json({ error: 'Invoice not found' });
    }

    // Reverse stock
    const items = await db.all('SELECT inventory_id, quantity FROM sale_items WHERE invoice_id = ?', [id]);
    for (const item of items) {
      await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.inventory_id]);
    }

    // Delete items then invoice
    await db.run('DELETE FROM sale_items WHERE invoice_id = ?', [id]);
    await db.run('DELETE FROM sales_invoices WHERE id = ?', [id]);

        res.json({ success: true, message: 'Invoice deleted, stock restored' });
  } catch (error) {
    const err = error as Error;
    console.error(JSON.stringify({ message: 'Failed to delete sale', error: err.message, timestamp: new Date().toISOString() }));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a held bill session (e.g. upon retrieve or checkout completion)
router.delete('/hold/:id', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');
    
    // Restore stock
    const heldBill = await db.get('SELECT cart_data FROM held_bills WHERE id = ?', [id]);
    if (heldBill && heldBill.cart_data) {
      try {
        const items = JSON.parse(heldBill.cart_data);
        for (const item of items) {
          if (item.id && typeof item.id === 'number' && item.id < 1000000) {
            await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [Number(item.qty || 0), item.id]);
          }
        }
      } catch (e) { console.error('Failed to parse held bill cart_data:', e); }
    }

    await db.run('DELETE FROM held_bills WHERE id = ?', id);
    await db.run('COMMIT');
        res.json({ success: true, message: 'Held bill removed' });
  } catch (error) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch(e){}
          }
    console.error('Failed to delete held bill:', error);
    res.status(500).json({ error: 'Failed to delete held bill' });
  }
});

// Synchronize offline sales from mobile
router.post('/sync', async (req, res) => {
  let db;
  try {
    const { sales = [], adminMode = false } = req.body;
    if (!Array.isArray(sales)) {
      return res.status(400).json({ error: 'Sales array required for synchronization' });
    }

    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    let stagedCount = 0;
    for (const sale of sales) {
      const { items = [], patient_name = '', patient_phone = '', discount = 0, sale_date = new Date().toISOString() } = sale;
      if (!Array.isArray(items) || items.length === 0) continue;

      if (adminMode) {
        // Direct commit for Admin Remote Operations
        let customerId = null;
        if (patient_name) {
          const cleanPhone = patient_phone || '';
          const existing = await db.get('SELECT id FROM customers WHERE name = ? AND phone = ?', [patient_name, cleanPhone]);
          if (existing) {
            customerId = existing.id;
          } else {
            const custResult = await db.run(
              'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)',
              [patient_name, cleanPhone, '']
            );
            customerId = custResult.lastID;
          }
        }

        let subtotal = 0;
        for (const item of items) {
          const { quantity = 0, unit_price = 0, loose_qty = 0, pack_size = 10, discount_per = 0 } = item;
          const q = Number(quantity);
          const l = Number(loose_qty);
          const pSize = Number(pack_size || 10);
          const d = Number(discount_per);
          const uPrice = Number(unit_price);
          const dPrice = uPrice * (1 - d / 100);
          subtotal += (q * dPrice) + (l * (dPrice / pSize));
        }

        const taxRate = 0.05;
        const total = Math.round(subtotal - Number(discount));
        const tax = Number((total * taxRate / (1 + taxRate)).toFixed(2));
        const invoice_no = await generateInvoiceNo(db);
        const invoiceDateValue = sale_date ? new Date(sale_date).toISOString() : new Date().toISOString();

        const result = await db.run(
          'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, tax_amount, payment_medium, payment_status, date, discount, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [invoice_no, customerId, total, tax, 'CASH', 'PAID', invoiceDateValue, Number(discount), subtotal]
        );
        const invoiceId = result.lastID;

        for (const item of items) {
          const { inventory_id, quantity, unit_price, loose_qty = 0, discount_per = 0 } = item;
          const currentStock = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [inventory_id]);
          if (!currentStock || currentStock.quantity < Number(quantity)) {
            const needed = Number(quantity) - (currentStock ? currentStock.quantity : 0);
            if (currentStock) {
              await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [needed, inventory_id]);
            } else {
              throw new Error(`Inventory item ID ${inventory_id} does not exist during direct sync.`);
            }
          }

          await db.run(
            'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per) VALUES (?, ?, ?, ?, ?, ?)',
            [invoiceId, inventory_id, Number(quantity), Number(unit_price), Number(loose_qty), Number(discount_per)]
          );
          await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [Number(quantity), inventory_id]);
        }
        stagedCount++;
      } else {
        // Normal staged sync for non-admin staff
        await db.run(
          `INSERT INTO staged_sales (patient_name, patient_phone, discount, sale_date, items_json) VALUES (?, ?, ?, ?, ?)`,
          [patient_name, patient_phone, Number(discount), sale_date, JSON.stringify(items)]
        );
        stagedCount++;
      }
    }
    await db.run('COMMIT');

    // Broadcast update notification to dashboard via SSE
    try {
      const { eventService } = await import('../services/eventService.js');
      eventService.broadcast('sales_sync', { success: true, count: stagedCount });
    } catch (sseErr) {
      console.warn('Could not broadcast sync update:', sseErr);
    }

    res.json({ success: true, count: stagedCount });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Failed to sync offline sales:', error);
    res.status(500).json({ error: error.message || 'Failed to sync offline sales' });
  }
});



// Approve a staged sale
router.post('/staged/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { items, patient_name, patient_phone, discount = 0 } = req.body;
  let db;
  try {
    db = await dbManager.getConnection();

    const staged = await db.get(`SELECT * FROM staged_sales WHERE id = ? AND status = 'pending'`, [id]);
    if (!staged) {
      return res.status(404).json({ error: 'Staged sale not found' });
    }

    const itemsToProcess = items || JSON.parse(staged.items_json);
    const finalPatientName = patient_name !== undefined ? patient_name : staged.patient_name;
    const finalPatientPhone = patient_phone !== undefined ? patient_phone : staged.patient_phone;
    const finalDiscount = discount !== undefined ? discount : staged.discount;

    await db.run('BEGIN TRANSACTION');

    // Resolve customer
    let customerId = null;
    if (finalPatientName) {
      const cleanPhone = finalPatientPhone || '';
      const existing = await db.get('SELECT id FROM customers WHERE name = ? AND phone = ?', [finalPatientName, cleanPhone]);
      if (existing) {
        customerId = existing.id;
      } else {
        const custResult = await db.run(
          'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)',
          [finalPatientName, cleanPhone, '']
        );
        customerId = custResult.lastID;
      }
    }

    // Compute totals
    let subtotal = 0;
    for (const item of itemsToProcess) {
      const { quantity = 0, unit_price = 0, loose_qty = 0, pack_size = 10, discount_per = 0 } = item;
      const q = Number(quantity);
      const l = Number(loose_qty);
      const pSize = Number(pack_size || 10);
      const d = Number(discount_per);
      const uPrice = Number(unit_price);
      const dPrice = uPrice * (1 - d / 100);
      subtotal += (q * dPrice) + (l * (dPrice / pSize));
    }
    const taxRate = 0.05;
    const total = Math.round(subtotal - Number(finalDiscount));
    const tax = Number((total * taxRate / (1 + taxRate)).toFixed(2));

    // Generate invoice number
    const invoice_no = await generateInvoiceNo(db);

    // Save invoice
    const result = await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, tax_amount, payment_medium, payment_status, date, discount, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [invoice_no, customerId, total, tax, 'CASH', 'PAID', staged.sale_date, Number(finalDiscount), subtotal]
    );
    const invoiceId = result.lastID;

    // Save items & update stock
    for (const item of itemsToProcess) {
      const { inventory_id, quantity, unit_price, loose_qty = 0, discount_per = 0 } = item;
      await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [Number(quantity), inventory_id]);
      await db.run(
        'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per) VALUES (?, ?, ?, ?, ?, ?)',
        [invoiceId, inventory_id, Number(quantity), Number(unit_price), Number(loose_qty), Number(discount_per)]
      );
    }

    // Mark staged as approved
    await db.run(`UPDATE staged_sales SET status = 'approved' WHERE id = ?`, [id]);

    await db.run('COMMIT');

    // Automatically send WhatsApp Invoice PDF
    if (invoiceId) {
      try {
        const { whatsappInvoiceService } = await import('../services/whatsappInvoiceService.js');
        // Run in background to prevent blocking response
        whatsappInvoiceService.sendInvoiceViaWhatsApp(invoiceId).catch(waErr => {
          console.error('[WhatsApp] Failed to send invoice PDF for approved staged sale:', waErr);
        });
      } catch (importErr) {
        console.error('[WhatsApp] Failed to import whatsappInvoiceService:', importErr);
      }
    }

    res.json({ success: true, invoice_no, total });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Approve staged sale error:', error);
    res.status(500).json({ error: error.message || 'Failed to approve staged sale' });
  }
});

// Reject a staged sale
router.post('/staged/:id/reject', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const result = await db.run(`UPDATE staged_sales SET status = 'rejected' WHERE id = ? AND status = 'pending'`, [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Staged sale not found or already processed' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to reject staged sale' });
  }
});

export default router;
