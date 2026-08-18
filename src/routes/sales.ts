import express from 'express';
import { INVENTORY_ACTIVE_WHERE } from '../utils/inventoryActive.js';
import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { productNameFilterService } from '../services/productNameFilterService.js';
import { applyStockDelta, recordStockLedger } from '../utils/stockRebuild.js';
import { inventoryCache } from '../services/inventoryCache.js';
import { verificationService } from '../services/verificationService.js';
import { activityLogger } from '../services/activityLogger.js';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';
import PDFDocument from 'pdfkit';
import { generateInvoiceBarcodeData } from '../services/barcodeService.js';
import { getAppDataDir } from '../config/index.js';

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
  // ORDER BY invoice_no DESC sorts as TEXT, not numerically — 'S-2026-9999' sorts after
  // 'S-2026-10000' lexicographically ('9' > '1'), so once a year passes 9,999 invoices
  // every subsequent call recomputes an already-taken number and hits a UNIQUE collision
  // forever. Extract the numeric suffix and take a true MAX instead.
  const row = await db.get(
    `SELECT MAX(CAST(SUBSTR(invoice_no, ?) AS INTEGER)) as maxNum FROM sales_invoices WHERE invoice_no LIKE ?`,
    [prefix.length + 1, `${prefix}%`]
  );
  const nextNum = (row && row.maxNum ? row.maxNum : 0) + 1;
  const padded = String(nextNum).padStart(4, '0');
  return `${prefix}${padded}`;
};

interface GstItemBreakdown {
  item: any;
  cgst_value: number;
  sgst_value: number;
}

const calculateSalesGstAndTotals = async (
  db: Database,
  items: any[],
  discount: number
) => {
  let subtotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  const itemTaxBreakdowns: GstItemBreakdown[] = [];

  const missingInventoryIds = items
    .filter(item => {
      const c = Number(item.cgst_per !== undefined ? item.cgst_per : (item.cgst !== undefined ? item.cgst : NaN));
      const s = Number(item.sgst_per !== undefined ? item.sgst_per : (item.sgst !== undefined ? item.sgst : NaN));
      return (isNaN(c) || isNaN(s) || (c === 0 && s === 0)) && item.inventory_id;
    })
    .map(item => item.inventory_id);

  const medTaxMap = new Map<number, { cgst_per: number; sgst_per: number }>();
  if (missingInventoryIds.length > 0) {
    const placeholders = missingInventoryIds.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT im.id as inventory_id, m.cgst_per, m.sgst_per FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id IN (${placeholders})`,
      missingInventoryIds
    );
    for (const r of rows) {
      medTaxMap.set(r.inventory_id, { cgst_per: r.cgst_per, sgst_per: r.sgst_per });
    }
  }

  for (const item of items) {
    const { quantity = 0, unit_price = 0, loose_qty = 0, pack_size = 1, discount_per = 0, inventory_id } = item;
    const q = Number(quantity);
    const l = Number(loose_qty);
    const pSize = Math.max(1, Number(pack_size || 1));
    const d = Number(discount_per || item.discountPer || 0);
    const uPrice = Number(unit_price);
    const dPrice = uPrice * (1 - d / 100);
    const lineGross = (q * dPrice) + (l * (dPrice / pSize));
    subtotal += lineGross;

    let cgstPer = Number(item.cgst_per !== undefined ? item.cgst_per : (item.cgst !== undefined ? item.cgst : NaN));
    let sgstPer = Number(item.sgst_per !== undefined ? item.sgst_per : (item.sgst !== undefined ? item.sgst : NaN));

    if ((isNaN(cgstPer) || isNaN(sgstPer) || (cgstPer === 0 && sgstPer === 0)) && inventory_id) {
      const medTax = medTaxMap.get(inventory_id);
      if (medTax) {
        if (isNaN(cgstPer) || cgstPer === 0) cgstPer = Number(medTax.cgst_per) || 0;
        if (isNaN(sgstPer) || sgstPer === 0) sgstPer = Number(medTax.sgst_per) || 0;
      }
    }

    if (isNaN(cgstPer) || cgstPer === 0) cgstPer = 2.5;
    if (isNaN(sgstPer) || sgstPer === 0) sgstPer = 2.5;

    const gstRate = cgstPer + sgstPer;
    const taxable = gstRate > 0 ? (lineGross / (1 + (gstRate / 100))) : lineGross;
    const lineTax = lineGross - taxable;
    const cgst_value = Number(((lineTax * cgstPer) / (gstRate || 1)).toFixed(2));
    const sgst_value = Number(((lineTax * sgstPer) / (gstRate || 1)).toFixed(2));

    totalCgst += cgst_value;
    totalSgst += sgst_value;

    itemTaxBreakdowns.push({
      item,
      cgst_value,
      sgst_value
    });
  }

  const roundedCgst = Number(totalCgst.toFixed(2));
  const roundedSgst = Number(totalSgst.toFixed(2));
  const total = Math.round(subtotal - Number(discount));
  const tax = Number((roundedCgst + roundedSgst).toFixed(2));
  const roff = Number((total - (subtotal - Number(discount))).toFixed(2));

  return {
    subtotal,
    total,
    tax,
    roff,
    totalCgst: roundedCgst,
    totalSgst: roundedSgst,
    itemTaxBreakdowns
  };
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
    // Non-destructively invoke the global Verification Layer pre-save checks
    const verification = await verificationService.verifyPOSBill(req.body);
    if (!verification.success) {
      return res.status(400).json({ error: verification.message, layer: verification.layer });
    }

    const { items = [], patient_id, doctor_id, doctor_name, discount = 0, patient_name, patient_phone, patient_address, paymentMedium = 'CASH', paymentStatus = 'PAID', sendWhatsApp = false, sale_date, refillEnabled = false, refillDays = 30, refillId } = req.body;

    // Strict validation: check items parameters to prevent null values
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart items required' });
    }

    for (const item of items) {
      const { inventory_id, quantity = 0, unit_price = 0, loose_qty = 0, medicine_name } = item;
      const q = Number(quantity);
      const l = Number(loose_qty);
      const uPrice = Number(unit_price);
      if ((q <= 0 && l <= 0) || uPrice <= 0 || isNaN(q) || isNaN(l) || isNaN(uPrice)) {
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
    const conn: Database = db;

    // Start transaction to enforce atomicity
    await conn.run('BEGIN IMMEDIATE TRANSACTION');

    // Resolve or auto-create customer/patient
    let customerId = patient_id || null;
    if (customerId) {
      const exists = await db.get('SELECT id FROM customers WHERE id = ?', [customerId]);
      if (!exists) customerId = null;
    }

    if (!customerId && (patient_phone || patient_name)) {
      const cleanPhone = (patient_phone || '').trim();
      const digitsOnly = cleanPhone.replace(/\D/g, '').slice(-10);
      const cleanName = (patient_name || 'Customer').trim();

      let existing = null;

      // 1. Match by last 10 digits of phone if available
      if (digitsOnly.length === 10) {
        existing = await db.get(
          `SELECT id, name, phone FROM customers 
           WHERE phone = ? OR REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ? LIMIT 1`,
          [cleanPhone, `%${digitsOnly}`]
        );
      }

      // 2. Match by case-insensitive name if no phone match
      if (!existing && cleanName && cleanName.toLowerCase() !== 'walk-in customer' && cleanName.toLowerCase() !== 'customer') {
        existing = await db.get(
          `SELECT id, name, phone FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
          [cleanName]
        );
      }

      if (existing) {
        customerId = existing.id;
        if (cleanPhone && (!existing.phone || existing.phone.trim() === '')) {
          await db.run('UPDATE customers SET phone = ? WHERE id = ?', [cleanPhone, customerId]);
        }
      } else {
        const custResult = await db.run(
          'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)',
          [cleanName, cleanPhone, patient_address || '']
        );
        customerId = custResult.lastID;
      }
    }

    // Compute subtotal, CGST, SGST, tax, roff, and total using accurate item GST rates
    const gstCalc = await calculateSalesGstAndTotals(db, items, Number(discount));
    const { subtotal, total, tax, roff, totalCgst, totalSgst, itemTaxBreakdowns } = gstCalc;

    if (isNaN(subtotal) || isNaN(tax) || isNaN(total)) {
      throw new Error('Calculated totals resulted in NaN value.');
    }

    // Generate invoice number
    const invoice_no = await generateInvoiceNo(db);

    // Insert invoice
    const invoiceDateValue = sale_date ? new Date(sale_date).toISOString() : new Date().toISOString();
    let resolvedDoctorId = doctor_id || null;
    if (doctor_name && typeof doctor_name === 'string' && doctor_name.trim().length > 0) {
      const cleanDocName = doctor_name.trim();
      const docRow = await db.get('SELECT id FROM doctors WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1', [cleanDocName]);
      if (docRow) {
        resolvedDoctorId = docRow.id;
      } else {
        const newDoc = await db.run('INSERT INTO doctors (name) VALUES (?)', [cleanDocName]);
        resolvedDoctorId = newDoc.lastID;
      }
    }

    const result = await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, tax_amount, cgst_value, sgst_value, igst_value, payment_medium, payment_status, date, discount, subtotal, doctor_id, roff) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [invoice_no, customerId, total, tax, totalCgst, totalSgst, 0, paymentMedium, paymentStatus, invoiceDateValue, Number(discount), subtotal, resolvedDoctorId, roff]
    );
    const invoiceId = result.lastID;
    if (!invoiceId) {
      throw new Error('Failed to retrieve inserted invoice ID.');
    }

    // Update customer credit balance automatically if payment medium is CREDIT or status is PENDING/UNPAID
    if (customerId && (paymentMedium?.toUpperCase() === 'CREDIT' || paymentStatus?.toUpperCase() === 'PENDING' || paymentStatus?.toUpperCase() === 'UNPAID')) {
      await db.run(
        'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) + ?, credit_enabled = 1 WHERE id = ?',
        [total, customerId]
      );
    }

    // Batch-fetch stock for all items that already carry an inventory_id, in one query.
    // Items without an inventory_id resolve dynamically below and get added to the same
    // map on first lookup, so every item (regardless of path) shares one consistent,
    // sequentially-updated view of stock — required so two cart lines referencing the
    // same batch see each other's deduction before their own insufficient-stock check.
    const stockMap = new Map<number, any>();
    const knownInventoryIds = items.map((it: any) => it.inventory_id).filter(Boolean);
    if (knownInventoryIds.length > 0) {
      const placeholders = knownInventoryIds.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT im.id as inventory_id, im.medicine_id, im.batch_no, im.quantity, im.loose_quantity, im.expiry_date, COALESCE(m.pack_size, 1) as pack_size, m.name as db_medicine_name
         FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id IN (${placeholders})`,
        knownInventoryIds
      );
      for (const r of rows) stockMap.set(r.inventory_id, r);
    }
    const getStock = async (id: number) => {
      if (stockMap.has(id)) return stockMap.get(id);
      const row = await conn.get(
        `SELECT im.id as inventory_id, im.medicine_id, im.batch_no, im.quantity, im.loose_quantity, im.expiry_date, COALESCE(m.pack_size, 1) as pack_size, m.name as db_medicine_name
         FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id = ?`,
        [id]
      );
      if (row) stockMap.set(id, row);
      return row;
    };

    // Insert line items and update inventory
    for (const item of items) {
      let { inventory_id, quantity, unit_price, loose_qty = 0, medicine_name, batch_no, expiry_date, mrp } = item;

      if (!inventory_id) {
        // Strict inventory-only sales: never auto-create medicines or fabricate stock.
        // Resolve the item to an existing inventory row or reject the whole sale.
        const cleanName = (medicine_name || 'Custom Medicine').trim();
        const { normalizeMedicineName } = await import('../utils/nameNormalizer.js');
        const adjustedName = normalizeMedicineName(cleanName);
        const dbMed = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [adjustedName]);
        if (!dbMed) {
          throw new Error(`Cannot sell "${cleanName}": this medicine is not in your inventory. Add it via Purchases/Inventory before selling.`);
        }

        const bNo = (batch_no || '').trim();
        let invRow = bNo
          ? await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [dbMed.id, bNo])
          : null;
        if (!invRow) {
          // Fall back to the earliest-expiry batch that still has stock
          invRow = await db.get(
            `SELECT id FROM inventory_master
             WHERE medicine_id = ? AND (quantity > 0 OR loose_quantity > 0)
             ORDER BY expiry_date ASC LIMIT 1`,
            [dbMed.id]
          );
        }
        if (!invRow) {
          throw new Error(`Cannot sell "${cleanName}": no stock available in inventory.`);
        }
        inventory_id = invRow.id;
      }

      // Stock Level Verification before processing decrement (strips + loose counted as one pool)
      const currentStock = await getStock(inventory_id);
      if (!currentStock) {
        throw new Error(`Inventory item ID ${inventory_id} does not exist.`);
      }
      const { isExpiredForSale, refreshInventoryActiveStatus } = await import('../utils/inventoryActive.js');
      if (isExpiredForSale(currentStock.expiry_date)) {
        await refreshInventoryActiveStatus(db, inventory_id);
        throw new Error(`Cannot sell expired batch for "${currentStock.db_medicine_name || medicine_name || 'Medicine'}". Remove or return this stock first.`);
      }
      const packSize = currentStock.pack_size;
      const soldQty = Number(quantity);
      const soldLoose = Number(loose_qty);
      const currentTotalUnits = currentStock.quantity * packSize + currentStock.loose_quantity;
      const soldTotalUnits = soldQty * packSize + soldLoose;
      if (currentTotalUnits < soldTotalUnits) {
        throw new Error(`Insufficient stock for "${currentStock.db_medicine_name || medicine_name || 'Medicine'}". Available: ${currentStock.quantity} strips & ${currentStock.loose_quantity} loose. Requested: ${soldQty} strips & ${soldLoose} loose.`);
      }

      const taxBreakdown = itemTaxBreakdowns.find(tb => tb.item === item);
      const itemCgst = taxBreakdown ? taxBreakdown.cgst_value : 0;
      const itemSgst = taxBreakdown ? taxBreakdown.sgst_value : 0;

      await db.run(
        'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per, cgst_value, sgst_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [invoiceId, inventory_id, Number(quantity), Number(unit_price), Number(loose_qty), Number(item.discount_per || item.discountPer || 0), itemCgst, itemSgst]
      );

      // Decrement stock in inventory_master, auto-converting a strip to loose if the loose sale exceeds current loose stock.
      const newStock = applyStockDelta(
        { quantity: currentStock.quantity, loose_quantity: currentStock.loose_quantity },
        -soldQty,
        -soldLoose,
        packSize
      );
      const decrementResult = await db.run(
        'UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?',
        [newStock.quantity, newStock.loose_quantity, inventory_id]
      );
      if (decrementResult.changes === 0) {
        throw new Error(`Failed to decrement stock for inventory ID ${inventory_id}`);
      }
      // Keep the shared stock map in sync so a later item referencing the same
      // inventory_id sees this decrement instead of stale pre-batch quantities.
      stockMap.set(inventory_id, { ...currentStock, quantity: newStock.quantity, loose_quantity: newStock.loose_quantity });
      await refreshInventoryActiveStatus(db, inventory_id);
      await recordStockLedger(db, {
        medicine_id: currentStock.medicine_id, batch_no: currentStock.batch_no,
        quantity: -soldQty, loose_quantity: -soldLoose,
        transaction_type: 'sale', transaction_id: invoiceId
      });

      // Handle refill logic if enabled
      if (refillEnabled && inventory_id) {
        const invRecord = currentStock;
        if (invRecord && invRecord.medicine_id) {
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + Number(refillDays));
          
          await db.run(
            'INSERT INTO patient_refills (customer_id, patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [customerId, patient_name || 'Walk-in Customer', patient_phone || '', invRecord.medicine_id, refillDays, nextDate.toISOString(), 'pending']
          );
        }
      }
    }

    // Resolve refill cycle if this sale completes a pending refill or matches customer phone number
    const cleanPhone = (patient_phone || '').replace(/\D/g, '');
    const phoneQuery = cleanPhone.length >= 10 ? `%${cleanPhone.slice(-10)}%` : 'NON_EXISTENT';
    const matchingRefills = await db.all(
      `SELECT * FROM patient_refills WHERE (id = ?) OR (patient_phone IS NOT NULL AND length(patient_phone) >= 10 AND replace(patient_phone, ' ', '') LIKE ?)`,
      [refillId || -1, phoneQuery]
    );

    if (Array.isArray(matchingRefills) && matchingRefills.length > 0) {
      for (const refill of matchingRefills) {
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
               quick_bill_id = NULL,
               stock_verified_override = 0,
               status = 'pending',
               reminder_status = 'NOT_SENT',
               reminder_sent_at = NULL,
               reminder_job_id = NULL,
               reminder_occurrence_date = NULL
           WHERE id = ?`,
          [nextDateStr, refill.id]
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
          [String(refill.id)]
        );
      }
    }
    // Commit transaction
    await db.run('COMMIT');
    inventoryCache.invalidate();

    // Log Activity Alert
    activityLogger.logSale(invoice_no, Number(total || 0), patient_name || 'Walk-in', paymentStatus || 'paid');

    // Bill-to-learning feedback loop: confirm OCR scanned items in ocr_corrections
    (async () => {
      try {
        for (const item of items) {
          const rawOcr = item.rawOcrText || item.raw_ocr_text;
          const medName = item.medicine_name || item.name;
          if (rawOcr && typeof rawOcr === 'string' && rawOcr.trim() && medName) {
            const cleanOcr = rawOcr.toLowerCase().trim();
            await db.run(
              `INSERT INTO ocr_corrections (raw_ocr_text, correct_medicine_name, success_count)
               VALUES (?, ?, 1)
               ON CONFLICT(raw_ocr_text) DO UPDATE SET
                 correct_medicine_name = excluded.correct_medicine_name,
                 success_count = success_count + 1,
                 updated_at = CURRENT_TIMESTAMP`,
              [cleanOcr, medName.trim()]
            ).catch(() => {});
          }
        }
      } catch (learnErr) {
        console.warn('[Sales Learning] Failed to record bill learning feedback:', learnErr);
      }
    })();

    // Trigger WhatsApp notification — same mechanism as CRM page (dynamic import + direct sendMessage)
    if (sendWhatsApp || paymentMedium?.toUpperCase() === 'CREDIT' || paymentStatus?.toUpperCase() === 'UNPAID') {
      const rawDigits = (patient_phone || '').replace(/\D/g, '');
      const phoneForWA = rawDigits.length === 12 && rawDigits.startsWith('91')
        ? rawDigits.slice(2)
        : (rawDigits.length > 10 ? rawDigits.slice(-10) : rawDigits);
      const nameForWA = (patient_name || 'Customer').trim();

      if (phoneForWA && phoneForWA.length === 10) {
        // Fire-and-forget: does NOT block the API response
        (async () => {
          try {
            const { sendMessage } = await import('../whatsappClient.js');

            const formatDate = (dStr?: string) => {
              if (!dStr) return '';
              try {
                const d = new Date(dStr);
                return isNaN(d.getTime()) ? dStr : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
              } catch {
                return dStr || '';
              }
            };

            // Build Item Breakdown List
            let itemLines = '';
            if (items && Array.isArray(items) && items.length > 0) {
              itemLines += `📦 *Items Purchased:*\n`;
              items.forEach((it: any, idx: number) => {
                const med = it.medicine_name || it.name || 'Medicine';
                const q = Number(it.quantity || it.qty || 1);
                const m = Number(it.mrp || 0);
                const itemTot = Number(it.total || (m * q));
                itemLines += `${idx + 1}. *${med}* x ${q} strip(s) = ₹${itemTot.toFixed(2)}\n`;
              });
              itemLines += `\n`;
            }

            const isCredit = paymentMedium?.toUpperCase() === 'CREDIT' || paymentStatus?.toUpperCase() === 'UNPAID';
            let waMsg = `Dear ${nameForWA},\n\n`;

            if (isCredit) {
              const custRow = customerId ? await db.get('SELECT credit_balance FROM customers WHERE id = ?', [customerId]) : null;
              let finalOutstanding = 0;
              if (custRow?.credit_balance !== undefined && custRow?.credit_balance !== null) {
                finalOutstanding = Number(custRow.credit_balance);
              } else {
                const oldInvoices = customerId
                  ? await db.all(
                      `SELECT total_amount FROM sales_invoices
                       WHERE customer_id = ? AND id != ? AND (payment_medium = 'CREDIT' OR payment_status = 'UNPAID' OR payment_status = 'PENDING') AND payment_status != 'PAID'`,
                      [customerId, invoiceId]
                    )
                  : [];
                const oldDuesSum = oldInvoices.reduce((sum: number, inv: any) => sum + Number(inv.total_amount || 0), 0);
                finalOutstanding = oldDuesSum + Number(total);
              }

              const todayStr = formatDate(invoiceDateValue);

              waMsg += `📌 *Credit Purchase Bill & Account Summary*\n\n`;
              waMsg += `🧾 *Current Bill (#${invoice_no})*\n`;
              waMsg += `• Date: *${todayStr}*\n`;
              waMsg += `💰 *Total Outstanding Balance: ₹${finalOutstanding.toFixed(2)}*\n\n`;
              waMsg += `This bill has been posted to your credit ledger account.\n`;
            } else {
              waMsg += `🧾 *Sale Invoice: #${invoice_no}*\n`;
              waMsg += itemLines;
              waMsg += `Bill Amount Paid: *₹${total.toFixed(2)}*\n\n`;
              waMsg += `Thank you for your purchase!\n\n`;
            }
            waMsg += `— AI Pharmacy OS`;

            const { whatsappQueueWorker } = await import('../services/whatsappQueueWorker.js');
            const queueId = await whatsappQueueWorker.enqueue(
              phoneForWA,
              waMsg,
              isCredit ? 'pos_credit_invoice' : 'pos_sale_invoice',
              nameForWA
            );
            console.log(`[POS WhatsApp] Enqueued bill notification for ${invoice_no} to ${phoneForWA} (queue ID: #${queueId})`);

            await db.run(
              `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
              ['pos_credit_invoice', nameForWA, phoneForWA, waMsg, 'sent', `invoice_${invoiceId}`]
            );
          } catch (waErr: any) {
            console.error(`[POS WhatsApp] Failed to enqueue notification for ${invoice_no}:`, waErr);
            try {
              await db.run(
                `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['pos_invoice_failed', nameForWA, phoneForWA, `Failed to enqueue WhatsApp: ${waErr?.message || String(waErr)}`, 'failed', `invoice_${invoiceId}`]
              );
            } catch (logErr) {
              console.error('[POS WhatsApp] Failed to log failure:', logErr);
            }
          }
        })();
      } else {
        console.warn(`[POS WhatsApp] Invalid/missing 10-digit phone number for invoice ${invoice_no} — skipping WhatsApp dispatch.`);
      }
    }

    // Match special orders for each item in the saved POS bill.
    // One batched SELECT for all distinct medicine names, then a per-item lookup
    // against an in-memory index. consumedIds tracks orders already fulfilled
    // earlier in this same request, replicating the old fresh-per-item-query
    // behavior where a fulfilled order dropped out of subsequent items' matches.
    const matchedSpecialOrders: any[] = [];
    try {
      const distinctMedNames = Array.from(new Set(
        items.map((it: any) => (it.medicine_name || '').trim()).filter(Boolean)
      ));
      const specialOrdersByName = new Map<string, any[]>();
      if (distinctMedNames.length > 0) {
        const lowerNames = distinctMedNames.map(n => n.toLowerCase());
        const placeholders = lowerNames.map(() => '?').join(',');
        const allMatching = await db.all(
          `SELECT id as order_id, product as medicine, qty as qty_ordered, requester, phone as customer_phone, status as order_status,
                  LOWER(TRIM(product)) as product_key, LOWER(TRIM(medicine_name)) as medicine_name_key
           FROM special_orders
           WHERE (LOWER(TRIM(product)) IN (${placeholders}) OR LOWER(TRIM(medicine_name)) IN (${placeholders}))
             AND status IN ('CREATED', 'PENDING', 'IN_TRANSIT', 'OVERLAP_DETECTED', 'POTENTIAL_ARRIVAL', 'Pending', 'Ordered')`,
          [...lowerNames, ...lowerNames]
        );
        for (const row of allMatching) {
          for (const key of new Set([row.product_key, row.medicine_name_key].filter(Boolean))) {
            if (!specialOrdersByName.has(key)) specialOrdersByName.set(key, []);
            specialOrdersByName.get(key)!.push(row);
          }
        }
      }
      const consumedOrderIds = new Set<number>();

      for (const item of items) {
        const medName = (item.medicine_name || '').trim();
        if (medName) {
          const matching = (specialOrdersByName.get(medName.toLowerCase()) || [])
            .filter(m => !consumedOrderIds.has(m.order_id));
          if (matching && matching.length > 0) {
            for (const m of matching) {
              consumedOrderIds.add(m.order_id);
              const specMsg = `Hi ${m.requester || 'Customer'}, your special order for *${m.medicine}* (Qty: ${item.quantity || 1}) has been billed & fulfilled. Thank you!`;
              matchedSpecialOrders.push({
                ...m,
                qty_sold: Number(item.quantity) || 1,
                whatsapp_template: specMsg
              });
              if (m.customer_phone) {
                try {
                  const { whatsappQueueWorker } = await import('../services/whatsappQueueWorker.js');
                  const specPhone = m.customer_phone.replace(/\D/g, '').slice(-10);
                  if (specPhone.length === 10) {
                    await whatsappQueueWorker.enqueue(
                      specPhone,
                      specMsg,
                      'special_order_fulfilled',
                      m.requester || 'Customer'
                    );
                    await db.run(
                      `UPDATE special_orders SET status = 'Fulfilled' WHERE id = ?`,
                      [m.order_id]
                    );
                    console.log(`[Special Order WA] Enqueued fulfillment alert for order #${m.order_id} to ${specPhone}`);
                  }
                } catch (specWaErr) {
                  console.warn(`[Special Order WA] Failed enqueue for order #${m.order_id}:`, specWaErr);
                }
              }
            }
          }
        }
      }
    } catch (mErr) {
      console.warn('[POS Sale] Failed to lookup matched special orders:', mErr);
    }

    res.json({ success: true, invoice_no, total, tax, matched_special_orders: matchedSpecialOrders });
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
    let parsedItems: any[];
    try {
      parsedItems = typeof finalCartData === 'string' ? JSON.parse(finalCartData) : finalCartData;
      if (!Array.isArray(parsedItems)) {
        parsedItems = [];
      }
    } catch (e) {
      return res.status(400).json({ error: 'Invalid cart payload JSON' });
    }
    
    // Create serialized data blob for compatibility with legacy HTML restoration
    const serializedData = data || JSON.stringify({
      items: finalCartData,
      patient: patient || { name: finalPatientName, phone: finalPatientPhone },
      doctor: finalDoctor,
      discount: finalDiscount,
      date: new Date().toLocaleString(),
      remarks: remarks || ''
    });

    await db.run('BEGIN IMMEDIATE TRANSACTION');
    const holdInvoiceNo = await generateInvoiceNo(db);

    for (const item of parsedItems) {
      if (item.id && typeof item.id === 'number' && item.id < 1000000) {
        const inventory_id = item.id;
        const qty = Number(item.qty || 0);
        const loose = Number(item.looseQty || 0);
        if (qty > 0 || loose > 0) {
          const currentStock = await db.get(
            `SELECT im.quantity, im.loose_quantity, COALESCE(m.pack_size, 1) as pack_size
             FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id = ?`,
            [inventory_id]
          );
          const pSize = currentStock ? (currentStock.pack_size || 1) : 1;
          const requestedTotalUnits = qty * pSize + loose;
          const availableTotalUnits = currentStock ? (currentStock.quantity * pSize + currentStock.loose_quantity) : 0;
          if (!currentStock || availableTotalUnits < requestedTotalUnits) {
            throw new Error(`Insufficient stock for hold bill item ID ${inventory_id}.`);
          }
          const newStock = applyStockDelta(
            { quantity: currentStock.quantity, loose_quantity: currentStock.loose_quantity },
            -qty, -loose, pSize
          );
          await db.run('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?', [newStock.quantity, newStock.loose_quantity, inventory_id]);
        }
      }
    }
    
    // Resolve or auto-create customer for held bill
    let customerId = null;
    if (finalPatientPhone || finalPatientName) {
      const cleanPhone = (finalPatientPhone || '').trim();
      const digitsOnly = cleanPhone.replace(/\D/g, '').slice(-10);
      const cleanName = (finalPatientName || 'Customer').trim();
      let existing = null;
      if (digitsOnly.length === 10) {
        existing = await db.get(
          `SELECT id FROM customers WHERE phone = ? OR REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ? LIMIT 1`,
          [cleanPhone, `%${digitsOnly}`]
        );
      }
      if (!existing && cleanName && cleanName.toLowerCase() !== 'walk-in customer' && cleanName.toLowerCase() !== 'customer') {
        existing = await db.get(`SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`, [cleanName]);
      }
      if (existing) {
        customerId = existing.id;
      } else if (cleanPhone || (cleanName && cleanName.toLowerCase() !== 'walk-in customer')) {
        const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [cleanName, cleanPhone]);
        customerId = custRes.lastID;
      }
    }

    await db.run(
      `INSERT INTO held_bills (
        customer_id, invoice_no, temp_label, patient_name, patient_phone, doctor_name, 
        discount, remarks, cart_data, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerId,
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

    // For any name that didn't have an exact match, try a quick LIKE query (prefix first, then middle-word fallback)
    const exactMatchedNames = new Set(meds.map(m => m.name.toLowerCase()));
    let fallbackCount = 0;
    const MAX_FALLBACKS = 5;
    const MAX_INFIX_FALLBACKS = 2;
    let infixFallbackCount = 0;

    for (const name of medicineNames) {
      if (!exactMatchedNames.has(name.toLowerCase())) {
        if (fallbackCount >= MAX_FALLBACKS) {
          results[name] = { recommendedQty: 1, type: 'strip', message: 'Default: 1 strip recommended' };
          continue;
        }
        fallbackCount++;

        // Try prefix search first (uses index)
        let partialMed = await db.get(
          'SELECT id, name FROM medicines WHERE name LIKE ? LIMIT 1',
          `${name}%`
        );
        
        // Fallback to middle-word search if prefix returns nothing and name is long enough
        if (!partialMed && name.length >= 3 && infixFallbackCount < MAX_INFIX_FALLBACKS) {
          infixFallbackCount++;
          partialMed = await db.get(
            'SELECT id, name FROM medicines WHERE name LIKE ? LIMIT 1',
            `%${name}%`
          );
        }
        
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
    const min_amount = parseFloat((req.query.min_amount as string) || '');
    const max_amount = parseFloat((req.query.max_amount as string) || '');
    const payment_medium = (req.query.payment_medium as string) || '';

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

    const isStrictDate = req.query.strict_date === 'true';

    if (search) {
      whereClauses.push('(si.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR d.name LIKE ? OR EXISTS (SELECT 1 FROM sale_items sale_it JOIN inventory_master inv_m ON sale_it.inventory_id = inv_m.id JOIN medicines m_search ON inv_m.medicine_id = m_search.id WHERE sale_it.invoice_id = si.id AND (inv_m.batch_no LIKE ? OR m_search.name LIKE ?)))');
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s);
    }
    // Constrain by date: if search is active, bypass date_from/date_to unless strict_date=true is explicitly requested
    if (date_from && (!search || isStrictDate)) {
      whereClauses.push("DATE(si.date, 'localtime') >= DATE(?)");
      params.push(date_from);
    }
    if (date_to && (!search || isStrictDate)) {
      whereClauses.push("DATE(si.date, 'localtime') <= DATE(?)");
      params.push(date_to);
    }
    if (batch && !search) {
      whereClauses.push('EXISTS (SELECT 1 FROM sale_items sale_it JOIN inventory_master inv_m ON sale_it.inventory_id = inv_m.id WHERE sale_it.invoice_id = si.id AND inv_m.batch_no LIKE ?)');
      params.push(`%${batch}%`);
    }
    if (!isNaN(min_amount)) {
      whereClauses.push('si.subtotal >= ?');
      params.push(min_amount);
    }
    if (!isNaN(max_amount)) {
      whereClauses.push('si.subtotal <= ?');
      params.push(max_amount);
    }
    if (payment_medium) {
      whereClauses.push('si.payment_medium = ?');
      params.push(payment_medium);
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
               m.mrp, m.id as medicine_id, COALESCE(m.pack_size, 1) as pack_size
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
    const countSql = `SELECT COUNT(*) as total FROM sales_invoices si LEFT JOIN customers c ON si.customer_id = c.id LEFT JOIN doctors d ON si.doctor_id = d.id ${where}`;
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

// Helper for Levenshtein distance fuzzy matching
function computeLevenshteinSim(s1: string, s2: string): number {
  const a = s1.toLowerCase().replace(/[\s\-_.\/]/g, '');
  const b = s2.toLowerCase().replace(/[\s\-_.\/]/g, '');
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.85;

  const maxLen = Math.max(a.length, b.length);
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  const distance = matrix[a.length][b.length];
  return 1 - distance / maxLen;
}

// Search medicine in inventory by Name, Batch, or MRP (with space-insensitivity, word number conversion, and fuzzy matching)
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
      
      if (cleanQuery.length >= 3) {
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
            im.expiry_date AS expiry_date, 
            im.quantity AS quantity, 
            im.loose_quantity AS loose_quantity,
            COALESCE(im.mrp, m.mrp, 0) AS mrp, 
            m.sell_price,
            im.unit_price, 
            COALESCE(im.cost_price, 0) AS cost_price,
            m.cgst_per, 
            m.sgst_per, 
            m.igst_per, 
            m.hsn_code,
            0 AS is_out_of_stock
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE (m.item_code = ? 
             OR m.name LIKE ? 
             OR im.mrp = ?
             OR im.batch_no LIKE ?)
            AND ${INVENTORY_ACTIVE_WHERE}
            AND (im.expiry_date IS NULL OR im.expiry_date = '' OR 
              CASE 
                WHEN length(im.expiry_date) = 5 AND im.expiry_date LIKE '%/%' THEN ('20' || substr(im.expiry_date, 4, 2) || '-' || substr(im.expiry_date, 1, 2))
                WHEN length(im.expiry_date) = 7 AND im.expiry_date LIKE '%/%' THEN (substr(im.expiry_date, 4, 4) || '-' || substr(im.expiry_date, 1, 2))
                WHEN length(im.expiry_date) = 10 AND im.expiry_date LIKE '__/__/____' THEN (substr(im.expiry_date, 7, 4) || '-' || substr(im.expiry_date, 4, 2))
                WHEN length(im.expiry_date) = 10 AND im.expiry_date LIKE '__-__-____' THEN (substr(im.expiry_date, 7, 4) || '-' || substr(im.expiry_date, 4, 2))
                WHEN im.expiry_date LIKE '____-__%' THEN substr(im.expiry_date, 1, 7)
                ELSE im.expiry_date
              END >= strftime('%Y-%m', 'now')
            )
          ORDER BY m.name ASC, im.expiry_date ASC
          LIMIT 30
        `;
        const mrpVal = parseFloat(normalizedQuery);
        rows = await db.all(sql, [exactQuery, likeQuery, isNaN(mrpVal) ? 0 : mrpVal, likeQuery]);
      } else {
        const prefixQuery = `${cleanQuery}%`;
        const sql = `
          SELECT 
            m.id AS medicine_id, 
            m.name AS medicine_name, 
            m.api_reference,
            m.item_code AS item_code,
            m.manufacturer AS manufacturer,
            im.id AS inventory_id, 
            im.batch_no, 
            im.expiry_date AS expiry_date, 
            im.quantity AS quantity, 
            im.loose_quantity AS loose_quantity,
            COALESCE(im.mrp, m.mrp, 0) AS mrp, 
            m.sell_price,
            im.unit_price, 
            COALESCE(im.cost_price, 0) AS cost_price,
            m.cgst_per, 
            m.sgst_per, 
            m.igst_per, 
            m.hsn_code,
            0 AS is_out_of_stock
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE (m.item_code = ? 
             OR m.name LIKE ?
             OR im.batch_no LIKE ?)
            AND ${INVENTORY_ACTIVE_WHERE}
            AND (im.expiry_date IS NULL OR im.expiry_date = '' OR 
              CASE 
                WHEN length(im.expiry_date) = 5 AND im.expiry_date LIKE '%/%' THEN ('20' || substr(im.expiry_date, 4, 2) || '-' || substr(im.expiry_date, 1, 2))
                WHEN length(im.expiry_date) = 7 AND im.expiry_date LIKE '%/%' THEN (substr(im.expiry_date, 4, 4) || '-' || substr(im.expiry_date, 1, 2))
                WHEN length(im.expiry_date) = 10 AND im.expiry_date LIKE '__/__/____' THEN (substr(im.expiry_date, 7, 4) || '-' || substr(im.expiry_date, 4, 2))
                WHEN length(im.expiry_date) = 10 AND im.expiry_date LIKE '__-__-____' THEN (substr(im.expiry_date, 7, 4) || '-' || substr(im.expiry_date, 4, 2))
                WHEN im.expiry_date LIKE '____-__%' THEN substr(im.expiry_date, 1, 7)
                ELSE im.expiry_date
              END >= strftime('%Y-%m', 'now')
            )
          ORDER BY m.name ASC, im.expiry_date ASC
          LIMIT 30
        `;
        rows = await db.all(sql, [exactQuery, prefixQuery, prefixQuery]);
      }
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
          im.expiry_date AS expiry_date, 
          im.quantity AS quantity, 
          im.loose_quantity AS loose_quantity,
          COALESCE(im.mrp, m.mrp, 0) AS mrp, 
          m.sell_price,
          im.unit_price, 
          COALESCE(im.cost_price, 0) AS cost_price,
          m.cgst_per, 
          m.sgst_per, 
          m.igst_per, 
          m.hsn_code,
          0 AS is_out_of_stock
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        WHERE m.name LIKE ?
          AND ${INVENTORY_ACTIVE_WHERE}
          AND (im.expiry_date IS NULL OR im.expiry_date = '' OR 
            CASE 
              WHEN length(im.expiry_date) = 5 AND im.expiry_date LIKE '%/%' THEN ('20' || substr(im.expiry_date, 4, 2) || '-' || substr(im.expiry_date, 1, 2))
              WHEN length(im.expiry_date) = 7 AND im.expiry_date LIKE '%/%' THEN (substr(im.expiry_date, 4, 4) || '-' || substr(im.expiry_date, 1, 2))
              WHEN length(im.expiry_date) = 10 AND im.expiry_date LIKE '__/__/____' THEN (substr(im.expiry_date, 7, 4) || '-' || substr(im.expiry_date, 4, 2))
              WHEN length(im.expiry_date) = 10 AND im.expiry_date LIKE '__-__-____' THEN (substr(im.expiry_date, 7, 4) || '-' || substr(im.expiry_date, 4, 2))
              WHEN im.expiry_date LIKE '____-__%' THEN substr(im.expiry_date, 1, 7)
              ELSE im.expiry_date
            END >= strftime('%Y-%m', 'now')
          )
        ORDER BY m.name ASC, im.expiry_date ASC
        LIMIT 30
      `;
      rows = await db.all(prefixSql, [prefixQuery]);
 
      // Fall back to general name/item_code infix search if we got fewer than 15 rows and term is >= 3 chars
      if (rows.length < 15 && cleanQuery.length >= 3) {
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
            im.expiry_date AS expiry_date, 
            im.quantity AS quantity, 
            im.loose_quantity AS loose_quantity,
            COALESCE(im.mrp, m.mrp, 0) AS mrp, 
            m.sell_price,
            im.unit_price, 
            COALESCE(im.cost_price, 0) AS cost_price,
            m.cgst_per, 
            m.sgst_per, 
            m.igst_per, 
            m.hsn_code,
            0 AS is_out_of_stock
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE (m.name LIKE ? OR m.item_code LIKE ?)
            AND ${INVENTORY_ACTIVE_WHERE}
            AND (im.expiry_date IS NULL OR im.expiry_date = '' OR 
              CASE 
                WHEN length(im.expiry_date) = 5 AND im.expiry_date LIKE '%/%' THEN ('20' || substr(im.expiry_date, 4, 2) || '-' || substr(im.expiry_date, 1, 2))
                WHEN length(im.expiry_date) = 7 AND im.expiry_date LIKE '%/%' THEN (substr(im.expiry_date, 4, 4) || '-' || substr(im.expiry_date, 1, 2))
                WHEN length(im.expiry_date) = 10 AND im.expiry_date LIKE '__/__/____' THEN (substr(im.expiry_date, 7, 4) || '-' || substr(im.expiry_date, 4, 2))
                WHEN length(im.expiry_date) = 10 AND im.expiry_date LIKE '__-__-____' THEN (substr(im.expiry_date, 7, 4) || '-' || substr(im.expiry_date, 4, 2))
                WHEN im.expiry_date LIKE '____-__%' THEN substr(im.expiry_date, 1, 7)
                ELSE im.expiry_date
              END >= strftime('%Y-%m', 'now')
            )
          ORDER BY m.name ASC, im.expiry_date ASC
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

      // Space & Punctuation Insensitive Fallback + Word Number Translation (e.g. "Dolosixfifty" / "Dolo six fifty" -> "Dolo 650")
      if (rows.length < 5 && cleanQuery.length >= 3) {
        let normSearchTerm = cleanQuery.toLowerCase()
          .replace(/\bsix[\s-]*fifty\b/g, '650')
          .replace(/\bfive[\s-]*hundred\b/g, '500')
          .replace(/\btwo[\s-]*hundred\b/g, '200')
          .replace(/\bone[\s-]*hundred\b/g, '100')
          .replace(/\bseven[\s-]*fifty\b/g, '750')
          .replace(/[\s\-_.\/]/g, '');

        const strippedLikeQuery = `%${normSearchTerm}%`;
        const strippedSql = `
          SELECT 
            m.id AS medicine_id, 
            m.name AS medicine_name, 
            m.api_reference,
            m.item_code AS item_code,
            m.manufacturer AS manufacturer,
            im.id AS inventory_id, 
            im.batch_no, 
            im.expiry_date AS expiry_date, 
            im.quantity AS quantity, 
            im.loose_quantity AS loose_quantity,
            COALESCE(im.mrp, m.mrp, 0) AS mrp, 
            m.sell_price,
            im.unit_price, 
            COALESCE(im.cost_price, 0) AS cost_price,
            m.cgst_per, 
            m.sgst_per, 
            m.igst_per, 
            m.hsn_code,
            0 AS is_out_of_stock
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE REPLACE(REPLACE(REPLACE(REPLACE(LOWER(m.name), ' ', ''), '-', ''), '.', ''), '/', '') LIKE ?
            AND im.quantity > 0
          ORDER BY m.name ASC, im.expiry_date ASC
          LIMIT 30
        `;
        const strippedRows = await db.all(strippedSql, [strippedLikeQuery]);
        const seenIds = new Set(rows.map(r => r.inventory_id));
        for (const row of strippedRows) {
          if (!seenIds.has(row.inventory_id)) {
            rows.push(row);
            if (rows.length >= 30) break;
          }
        }
      }

      // Fuzzy Levenshtein Fallback (Typo Tolerance)
      if (rows.length === 0 && cleanQuery.length >= 3) {
        const normQuery = cleanQuery.toLowerCase()
          .replace(/\bsix[\s-]*fifty\b/g, '650')
          .replace(/\bfive[\s-]*hundred\b/g, '500')
          .replace(/[\s\-_.\/]/g, '');

        const allAvailableMeds = await db.all(`
          SELECT 
            m.id AS medicine_id, 
            m.name AS medicine_name, 
            m.api_reference,
            m.item_code AS item_code,
            m.manufacturer AS manufacturer,
            im.id AS inventory_id, 
            im.batch_no, 
            im.expiry_date AS expiry_date, 
            im.quantity AS quantity, 
            im.loose_quantity AS loose_quantity,
            COALESCE(im.mrp, m.mrp, 0) AS mrp, 
            m.sell_price,
            im.unit_price, 
            COALESCE(im.cost_price, 0) AS cost_price,
            m.cgst_per, 
            m.sgst_per, 
            m.igst_per, 
            m.hsn_code,
            0 AS is_out_of_stock
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE im.quantity > 0
          LIMIT 300
        `);

        const fuzzyMatches = allAvailableMeds.map(item => {
          const sim = computeLevenshteinSim(normQuery, item.medicine_name);
          return { ...item, sim };
        }).filter(item => item.sim >= 0.50).sort((a, b) => b.sim - a.sim);

        for (const match of fuzzyMatches) {
          if (rows.length >= 20) break;
          const { sim, ...cleanMatch } = match;
          rows.push(cleanMatch);
        }
      }
    }

    // Parenthetical stripping fallback (e.g. "TELMA 40 (15 TAB)" -> "TELMA 40")
    if (rows.length === 0) {
      const strippedQuery = cleanQuery.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
      if (strippedQuery.length >= 2 && strippedQuery.toLowerCase() !== cleanQuery.toLowerCase()) {
        const prefixQuery = `${strippedQuery}%`;
        const likeQuery = `%${strippedQuery}%`;
        const fallbackSql = `
          SELECT 
            m.id AS medicine_id, 
            m.name AS medicine_name, 
            m.api_reference,
            m.item_code AS item_code,
            m.manufacturer AS manufacturer,
            im.id AS inventory_id, 
            im.batch_no, 
            im.expiry_date AS expiry_date, 
            im.quantity AS quantity, 
            im.loose_quantity AS loose_quantity,
            COALESCE(im.mrp, m.mrp, 0) AS mrp, 
            im.unit_price, 
            COALESCE(im.cost_price, 0) AS cost_price,
            m.cgst_per, 
            m.sgst_per, 
            m.igst_per, 
            m.hsn_code,
            0 AS is_out_of_stock
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE (m.name LIKE ? OR m.name LIKE ?)
            AND im.quantity > 0
          ORDER BY m.name ASC, im.expiry_date ASC
          LIMIT 30
        `;
        rows = await db.all(fallbackSql, [prefixQuery, likeQuery]);
      }
    }
    
    // Map SQLite numeric values back to boolean for is_out_of_stock compatibility
    for (const row of rows) {
      row.is_out_of_stock = row.is_out_of_stock === 1;
    }
    
    // Fetch alternatives via precomputed substitutes table
    const medicineIds = rows.map(r => r.medicine_id);
    
    if (medicineIds.length > 0) {
      const placeholders = medicineIds.map(() => '?').join(',');
      const subsSql = `
        SELECT s.source_medicine_id, s.substitute_medicine_id, s.confidence, s.match_type
        FROM substitutes s
        WHERE s.source_medicine_id IN (${placeholders}) AND s.is_active = 1
        ORDER BY s.confidence DESC
      `;
      const subs = await db.all(subsSql, medicineIds);
      
      const subsMap: Record<number, number[]> = {};
      const allSubMedIds = new Set<number>();
      for (const sub of subs) {
        if (!subsMap[sub.source_medicine_id]) subsMap[sub.source_medicine_id] = [];
        if (subsMap[sub.source_medicine_id].length < 5) {
          subsMap[sub.source_medicine_id].push(sub.substitute_medicine_id);
          allSubMedIds.add(sub.substitute_medicine_id);
        }
      }
      
      let altInventory: any[] = [];
      const uniqueSubMedIds = [...allSubMedIds];
      if (uniqueSubMedIds.length > 0) {
        const subPlaceholders = uniqueSubMedIds.map(() => '?').join(',');
        const altSql = `
          SELECT im.id as inventory_id, im.medicine_id, m.name as medicine_name, m.api_reference,
                 im.batch_no, MIN(im.expiry_date) AS expiry_date, SUM(im.quantity) AS quantity, COALESCE(im.mrp, m.mrp, 0) AS mrp, im.unit_price, COALESCE(im.cost_price, 0) AS cost_price,
                 m.cgst_per, m.sgst_per, m.igst_per, m.hsn_code
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE im.medicine_id IN (${subPlaceholders})
            AND im.quantity > 0
          GROUP BY im.medicine_id, COALESCE(im.mrp, m.mrp, 0)
        `;
        altInventory = await db.all(altSql, uniqueSubMedIds);
      }
      
      for (const row of rows) {
        const targetMedIds = subsMap[row.medicine_id] || [];
        row.alternatives = altInventory
          .filter(inv => targetMedIds.includes(inv.medicine_id))
          .slice(0, 5);
      }
    } else {
      for (const row of rows) {
        row.alternatives = [];
      }
    }

    // Dynamic composition fallback for any row that has empty alternatives
    const fallbackMeds = rows.filter(r => (!r.alternatives || r.alternatives.length === 0) && r.api_reference && r.api_reference.trim() !== '');
    if (fallbackMeds.length > 0) {
      const fallbackApiRefs = [...new Set(fallbackMeds.map(r => r.api_reference))];
      const placeholders = fallbackApiRefs.map(() => '?').join(',');
      const altSql = `
        SELECT im.id as inventory_id, im.medicine_id, m.name as medicine_name, m.api_reference,
               im.batch_no, MIN(im.expiry_date) AS expiry_date, SUM(im.quantity) AS quantity, COALESCE(im.mrp, m.mrp, 0) AS mrp, im.unit_price, COALESCE(im.cost_price, 0) AS cost_price,
               m.cgst_per, m.sgst_per, m.igst_per, m.hsn_code
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        WHERE m.api_reference IN (${placeholders})
          AND im.quantity > 0
        GROUP BY im.medicine_id, COALESCE(im.mrp, m.mrp, 0)
        LIMIT 100
      `;
      const fallbackAlts = await db.all(altSql, fallbackApiRefs);
      
      const fallbackMap: Record<string, any[]> = {};
      for (const alt of fallbackAlts) {
        if (!fallbackMap[alt.api_reference]) fallbackMap[alt.api_reference] = [];
        fallbackMap[alt.api_reference].push(alt);
      }
      
      for (const row of rows) {
        if (!row.alternatives || row.alternatives.length === 0) {
          const alts = fallbackMap[row.api_reference] || [];
          row.alternatives = alts.filter(a => a.medicine_id !== row.medicine_id).slice(0, 5);
        }
      }
    }

    res.json(rows);
  } catch (error) {
    console.error('Failed to search medicine:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get fuzzy medicine suggestions when search results are thin
router.get('/suggest-medicine', async (req, res) => {
  const query = req.query.q as string;
  if (!query || query.trim().length < 2) {
    return res.json([]);
  }
  let db;
  try {
    db = await dbManager.getConnection();
    const filterResult = await productNameFilterService.filterProductNames(query.trim(), { minConfidenceThreshold: 0.6 });
    let matchedNames = filterResult.matches.slice(0, 4);
    if (matchedNames.length === 0) {
      const { findSimilarNames } = await import('../services/similarityService.js');
      const allMeds = await db.all('SELECT id AS medicine_id, name, api_reference FROM medicines LIMIT 500');
      const medNames = allMeds.map((m: any) => m.name);
      const similar = findSimilarNames(query.trim(), medNames, 4, 0.25);
      const matched = allMeds.filter((m: any) => similar.includes(m.name));
      await dbManager.close();
      return res.json(matched);
    }
    
    const placeholders = matchedNames.map(() => '?').join(',');
    const sql = `SELECT id AS medicine_id, name, api_reference FROM medicines WHERE name IN (${placeholders})`;
    const rows = await db.all(sql, matchedNames);
    await dbManager.close();
    
    // Sort according to matchedNames order
    const sorted = matchedNames
      .map((name: string) => rows.find((r: any) => r.name.toLowerCase() === name.toLowerCase()))
      .filter(Boolean);
      
    res.json(sorted);
  } catch (error) {
    if (db) await dbManager.close();
    console.error('Failed to get suggestions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a medicine to the composition queue from POS
router.post('/queue-from-pos', async (req, res) => {
  const { medicine_id } = req.body;
  if (!medicine_id) {
    return res.status(400).json({ error: 'medicine_id is required' });
  }
  let db;
  try {
    db = await dbManager.getConnection();
    const med = await db.get('SELECT enrichment_status FROM medicines WHERE id = ?', medicine_id);
    if (!med) {
      await dbManager.close();
      return res.status(404).json({ error: 'Medicine not found' });
    }
    if (med.enrichment_status !== 'manual') {
      await db.run("UPDATE medicines SET enrichment_status = 'needs_review' WHERE id = ?", medicine_id);
    }
    await dbManager.close();
    res.json({ success: true, id: medicine_id });
  } catch (error) {
    if (db) await dbManager.close();
    console.error('Failed to queue medicine from POS:', error);
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

// Create a new staged sale (Phone Sale)
router.post('/staged', async (req, res) => {
  try {
    const { patient_name, patient_phone, discount = 0, items } = req.body;
    if (!patient_name || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Patient name and non-empty items array are required' });
    }

    const db = await dbManager.getConnection();
    const resolvedItems = [];

    for (const item of items) {
      const name = item.name || item.medicine_name;
      const quantity = Number(item.quantity || 1);
      const unit = item.unit || '';

      // Try to resolve locally
      const local = await db.get(`
        SELECT im.id as inventory_id, im.mrp, COALESCE(m.pack_size, 1) as pack_size
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        WHERE m.name LIKE ? OR m.name LIKE ?
        LIMIT 1
      `, [name, `%${name}%`]);

      resolvedItems.push({
        inventory_id: local ? local.inventory_id : null,
        name: name,
        quantity: quantity,
        unit_price: local ? local.mrp : 0,
        loose_qty: 0,
        pack_size: local ? (local.pack_size || 1) : 1,
        discount_per: 0
      });
    }

    const result = await db.run(
      `INSERT INTO staged_sales (patient_name, patient_phone, discount, sale_date, items_json) VALUES (?, ?, ?, ?, ?)`,
      [patient_name, patient_phone || '', Number(discount), new Date().toISOString(), JSON.stringify(resolvedItems)]
    );

    // Broadcast SSE update
    try {
      const { eventService } = await import('../services/eventService.js');
      eventService.broadcast('sales_sync', { success: true, count: 1 });
    } catch (sseErr) {
      console.warn('Could not broadcast sales_sync update:', sseErr);
    }

    res.json({ success: true, id: result.lastID });
  } catch (err: any) {
    console.error('Failed to create staged sale:', err);
    res.status(500).json({ error: err.message || 'Failed to create staged sale' });
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

// Generate scannable invoice barcode (Code128 + QR) and printable PDF
const handleInvoiceBarcode = async (req: express.Request, res: express.Response) => {
  const invoiceNo = (req.params.invoiceNo || req.query.invoiceNo || req.query.invoice_no || '').toString();
  if (!invoiceNo) {
    return res.status(400).json({ error: 'Invoice number is required' });
  }

  try {
    const db = await dbManager.getConnection();
    const invoice = await db.get(
      `SELECT si.invoice_no, si.date, si.total_amount, c.name as customer_name, c.phone as customer_phone
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       WHERE si.invoice_no = ? OR si.id = ?`,
      [invoiceNo, invoiceNo]
    );

    const actualInvoiceNo = invoice ? invoice.invoice_no : invoiceNo;
    const invoiceDate = invoice ? invoice.date : undefined;
    const barcodeData = await generateInvoiceBarcodeData(actualInvoiceNo, invoiceDate);

    // Fetch shop details from app_settings
    const settingsRows = await db.all('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const shopName = settings.shop_name || 'AI PHARMACY OS';
    const shopPhone = settings.shop_phone || '';

    // Build printable PDF label
    const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const doc = new PDFDocument({ size: [350, 220], margin: 15 });
    const sanitizeNo = actualInvoiceNo.replace(/[^a-zA-Z0-9_-]/g, '_');
    const pdfPath = path.join(uploadsDir, `barcode_invoice_${sanitizeNo}_${Date.now()}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Header
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0284c7').text(shopName, { align: 'center' });
    if (shopPhone) {
      doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`Ph: ${shopPhone}`, { align: 'center' });
    }
    doc.moveDown(0.5);

    // Metadata
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(`Invoice: ${actualInvoiceNo}`, { align: 'center' });
    if (invoice) {
      const formattedDate = new Date(invoice.date).toLocaleDateString();
      const custText = invoice.customer_name ? `Customer: ${invoice.customer_name}` : 'Walk-in Customer';
      doc.font('Helvetica').fontSize(8).fillColor('#475569').text(`Date: ${formattedDate} | ${custText} | Total: ₹${Number(invoice.total_amount || 0).toFixed(2)}`, { align: 'center' });
    }

    doc.moveDown(0.5);

    // Render Barcodes
    const startY = doc.y;
    doc.image(barcodeData.qrBuffer, 25, startY, { width: 85, height: 85 });
    doc.image(barcodeData.code128Buffer, 125, startY + 10, { width: 200, height: 60 });
    doc.fontSize(7).fillColor('#94a3b8').text(`Scan Code128 or QR for return lookup (${barcodeData.barcodeText})`, 15, 195, { align: 'center' });
    doc.end();

    stream.on('finish', () => {
      res.json({
        success: true,
        invoiceNo: actualInvoiceNo,
        barcodeText: barcodeData.barcodeText,
        qrDataUrl: barcodeData.qrDataUrl,
        code128DataUrl: barcodeData.code128DataUrl,
        pdfUrl: `/uploads/${path.basename(pdfPath)}`
      });
    });
  } catch (error: any) {
    console.error('Sale invoice barcode generation error:', error);
    res.status(500).json({ error: 'Failed to generate sale invoice barcode: ' + error.message });
  }
};

router.get('/invoice-barcode', handleInvoiceBarcode);
router.get('/invoice-barcode/:invoiceNo', handleInvoiceBarcode);

// Get single sale invoice with items
router.get('/:id', async (req, res, next) => {
  const rawId = req.params.id;
  if (!/^\d+$/.test(rawId)) {
    return next();
  }
  let db;
  try {
    db = await dbManager.getConnection();
    const id = parseInt(rawId, 10);

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
      `SELECT si.*, 
              COALESCE(im.batch_no, si.batch_no, '') as batch_number, 
              COALESCE(im.batch_no, si.batch_no, '') as batch_no, 
              im.expiry_date, 
              COALESCE(im.mrp, si.mrp, m.mrp, si.unit_price, 0) as item_mrp, 
              COALESCE(m.pack_size, 1) as pack_size,
              COALESCE(m.name, 'Medicine') as medicine_name, 
              COALESCE(m.mrp, si.mrp, im.mrp, si.unit_price, 0) as medicine_mrp, 
              COALESCE(m.id, im.medicine_id) as medicine_id,
              COALESCE(im.quantity, 0) as stock_qty,
              COALESCE(im.loose_quantity, 0) as loose_quantity
       FROM sale_items si
       LEFT JOIN inventory_master im ON si.inventory_id = im.id
       LEFT JOIN medicines m ON (im.medicine_id = m.id OR (im.id IS NULL AND si.inventory_id = m.id))
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
    const { items, patient_name, patient_phone, discount = 0, paymentMedium, paymentStatus, doctor_id, doctor_name } = req.body;

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

    // Resolve doctor
    let resolvedDoctorId = doctor_id !== undefined ? (doctor_id || null) : (existing.doctor_id || null);
    if (doctor_name !== undefined) {
      if (doctor_name && typeof doctor_name === 'string' && doctor_name.trim().length > 0) {
        const cleanDocName = doctor_name.trim();
        const docRow = await db.get('SELECT id FROM doctors WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1', [cleanDocName]);
        if (docRow) {
          resolvedDoctorId = docRow.id;
        } else {
          const newDoc = await db.run('INSERT INTO doctors (name) VALUES (?)', [cleanDocName]);
          resolvedDoctorId = newDoc.lastID;
        }
      } else {
        resolvedDoctorId = null;
      }
    }

    // If items changed, reverse old stock and replace
    if (Array.isArray(items)) {
      // Reverse old stock (strips + loose as one pool, same as the original sale deduction).
      // Batch-fetch once, restore through an in-memory map so multiple old lines on the
      // same inventory_id accumulate correctly instead of racing on stale reads.
      const oldItems = await db.all('SELECT inventory_id, quantity, loose_qty FROM sale_items WHERE invoice_id = ?', [id]);
      const oldInventoryIds = oldItems.map((oi: any) => oi.inventory_id).filter(Boolean);
      const oldStockMap = new Map<number, any>();
      if (oldInventoryIds.length > 0) {
        const placeholders = oldInventoryIds.map(() => '?').join(',');
        const rows = await db.all(
          `SELECT im.id as inventory_id, im.medicine_id, im.batch_no, im.quantity, im.loose_quantity, COALESCE(m.pack_size, 1) as pack_size
           FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id IN (${placeholders})`,
          oldInventoryIds
        );
        for (const r of rows) oldStockMap.set(r.inventory_id, r);
      }
      for (const oi of oldItems) {
        const oldStock = oldStockMap.get(oi.inventory_id);
        if (!oldStock) continue;
        const restored = applyStockDelta(
          { quantity: oldStock.quantity, loose_quantity: oldStock.loose_quantity },
          Number(oi.quantity), Number(oi.loose_qty || 0), oldStock.pack_size || 1
        );
        await db.run('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?', [restored.quantity, restored.loose_quantity, oi.inventory_id]);
        await recordStockLedger(db, {
          medicine_id: oldStock.medicine_id, batch_no: oldStock.batch_no,
          quantity: Number(oi.quantity), loose_quantity: Number(oi.loose_qty || 0),
          transaction_type: 'sale_edit_restore', transaction_id: id
        });
        oldStockMap.set(oi.inventory_id, { ...oldStock, quantity: restored.quantity, loose_quantity: restored.loose_quantity });
      }

      // Delete old items
      await db.run('DELETE FROM sale_items WHERE invoice_id = ?', [id]);

      // Compute new totals and GST breakdown
      const gstCalc = await calculateSalesGstAndTotals(db, items, Number(discount || 0));
      const { subtotal, total, tax, roff, totalCgst, totalSgst, itemTaxBreakdowns } = gstCalc;

      // Batch-fetch stock for the new item set the same way the checkout endpoint does —
      // one query, then an in-memory map kept in sync after each decrement so two new
      // lines sharing an inventory_id still see each other's deduction.
      const newInventoryIds = items.map((it: any) => it.inventory_id).filter(Boolean);
      const editStockMap = new Map<number, any>();
      if (newInventoryIds.length > 0) {
        const placeholders = newInventoryIds.map(() => '?').join(',');
        const rows = await db.all(
          `SELECT im.id as inventory_id, im.medicine_id, im.batch_no, im.quantity, im.loose_quantity, im.expiry_date, COALESCE(m.pack_size, 1) as pack_size
           FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id IN (${placeholders})`,
          newInventoryIds
        );
        for (const r of rows) editStockMap.set(r.inventory_id, r);
      }

      for (const item of items) {
        const { inventory_id, quantity = 0, unit_price = 0, loose_qty = 0, discount_per = 0 } = item;

        // Stock Level & Expiry Verification (strips + loose counted as one pool)
        const currentStock = editStockMap.get(inventory_id);
        const pSize = currentStock ? (currentStock.pack_size || 1) : 1;
        const soldTotalUnits = Number(quantity) * pSize + Number(loose_qty);
        const availableTotalUnits = currentStock ? (currentStock.quantity * pSize + currentStock.loose_quantity) : 0;
        if (!currentStock || availableTotalUnits < soldTotalUnits) {
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

        const taxBreakdown = itemTaxBreakdowns.find(tb => tb.item === item);
        const itemCgst = taxBreakdown ? taxBreakdown.cgst_value : 0;
        const itemSgst = taxBreakdown ? taxBreakdown.sgst_value : 0;

        await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per, cgst_value, sgst_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, inventory_id, quantity, unit_price, loose_qty, discount_per, itemCgst, itemSgst]);
        const newStock = applyStockDelta(
          { quantity: currentStock.quantity, loose_quantity: currentStock.loose_quantity },
          -Number(quantity), -Number(loose_qty), pSize
        );
        await db.run('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?', [newStock.quantity, newStock.loose_quantity, inventory_id]);
        await recordStockLedger(db, {
          medicine_id: currentStock.medicine_id, batch_no: currentStock.batch_no,
          quantity: -Number(quantity), loose_quantity: -Number(loose_qty),
          transaction_type: 'sale_edit', transaction_id: id
        });
        editStockMap.set(inventory_id, { ...currentStock, quantity: newStock.quantity, loose_quantity: newStock.loose_quantity });
      }

      await db.run(
        'UPDATE sales_invoices SET customer_id = ?, total_amount = ?, tax_amount = ?, cgst_value = ?, sgst_value = ?, payment_medium = COALESCE(?, payment_medium), payment_status = COALESCE(?, payment_status), discount = ?, subtotal = ?, doctor_id = ?, roff = ? WHERE id = ?',
        [customerId, total, tax, totalCgst, totalSgst, paymentMedium || null, paymentStatus || null, Number(discount || 0), subtotal, resolvedDoctorId, roff, id]
      );
    } else {
      // Just update customer/discount/doctor
      await db.run('UPDATE sales_invoices SET customer_id = ?, doctor_id = ? WHERE id = ?', [customerId, resolvedDoctorId, id]);
    }

    // Recalculate customer credit balance for affected customers
    const custIdsToRecalc = new Set<number>();
    if (customerId) custIdsToRecalc.add(customerId);
    if (existing.customer_id) custIdsToRecalc.add(existing.customer_id);

    for (const cId of custIdsToRecalc) {
      const unpaidRow = await db.get(
        `SELECT COALESCE(SUM(total_amount), 0) as total 
         FROM sales_invoices 
         WHERE customer_id = ? AND (payment_medium = 'CREDIT' OR payment_status = 'UNPAID' OR payment_status = 'PENDING')`,
        [cId]
      );
      const newBalance = Math.max(0, Number(unpaidRow?.total || 0));
      await db.run(
        'UPDATE customers SET credit_balance = ? WHERE id = ?',
        [newBalance, cId]
      );
    }

    await db.run('COMMIT');
    inventoryCache.invalidate();

    try {
      const { eventService } = await import('../services/eventService.js');
      eventService.broadcast('sales_sync', { success: true, action: 'update', id: Number(id) });
      eventService.broadcast('inventory_sync', { success: true });
    } catch (sseErr) {
      console.warn('Could not broadcast sale update:', sseErr);
    }

    res.json({ success: true, message: 'Invoice updated', invoice_no: existing.invoice_no, id: Number(id) });
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
  try {
    const { id } = req.params;
    let notFound = false;

    await dbManager.transaction(async (db) => {
      const existing = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [id]);
      if (!existing) {
        notFound = true;
        return;
      }

      // Reverse stock (strips + loose as one pool)
      const items = await db.all('SELECT inventory_id, quantity, loose_qty FROM sale_items WHERE invoice_id = ?', [id]);
      const inventoryIds = items.map((i: any) => i.inventory_id).filter(Boolean);
      const stockMap = new Map<number, any>();

      if (inventoryIds.length > 0) {
        const placeholders = inventoryIds.map(() => '?').join(',');
        const stocks = await db.all(
          `SELECT im.id as inventory_id, im.medicine_id, im.batch_no, im.quantity, im.loose_quantity, COALESCE(m.pack_size, 1) as pack_size
           FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id IN (${placeholders})`,
          inventoryIds
        );
        for (const s of stocks) stockMap.set(s.inventory_id, s);
      }

      for (const item of items) {
        const stock = stockMap.get(item.inventory_id);
        if (!stock) continue;
        const restored = applyStockDelta(
          { quantity: stock.quantity, loose_quantity: stock.loose_quantity },
          Number(item.quantity), Number(item.loose_qty || 0), stock.pack_size || 1
        );
        await db.run('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?', [restored.quantity, restored.loose_quantity, item.inventory_id]);
        await recordStockLedger(db, {
          medicine_id: stock.medicine_id, batch_no: stock.batch_no,
          quantity: Number(item.quantity), loose_quantity: Number(item.loose_qty || 0),
          transaction_type: 'sale_delete_restore', transaction_id: id
        });
      }

      // Delete items then invoice
      await db.run('DELETE FROM sale_items WHERE invoice_id = ?', [id]);
      await db.run('DELETE FROM sales_invoices WHERE id = ?', [id]);

      // Recalculate customer credit balance if invoice was associated with a customer
      if (existing.customer_id) {
        const unpaidRow = await db.get(
          `SELECT COALESCE(SUM(total_amount), 0) as total 
           FROM sales_invoices 
           WHERE customer_id = ? AND (payment_medium = 'CREDIT' OR payment_status = 'UNPAID' OR payment_status = 'PENDING')`,
          [existing.customer_id]
        );
        const newBalance = Math.max(0, Number(unpaidRow?.total || 0));
        await db.run(
          'UPDATE customers SET credit_balance = ? WHERE id = ?',
          [newBalance, existing.customer_id]
        );
      }
    });

    if (notFound) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    inventoryCache.invalidate();

    try {
      const { eventService } = await import('../services/eventService.js');
      eventService.broadcast('sales_sync', { success: true, action: 'delete', id: Number(id) });
    } catch (sseErr) {
      console.warn('Could not broadcast sale delete update:', sseErr);
    }

    res.json({ success: true, message: 'Invoice deleted, stock restored, credit balance updated' });
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
        const restoreIds = items.filter((it: any) => it.id && typeof it.id === 'number' && it.id < 1000000).map((it: any) => it.id);
        const heldStockMap = new Map<number, any>();
        if (restoreIds.length > 0) {
          const placeholders = restoreIds.map(() => '?').join(',');
          const rows = await db.all(
            `SELECT im.id as inventory_id, im.quantity, im.loose_quantity, COALESCE(m.pack_size, 1) as pack_size
             FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id IN (${placeholders})`,
            restoreIds
          );
          for (const r of rows) heldStockMap.set(r.inventory_id, r);
        }
        for (const item of items) {
          if (item.id && typeof item.id === 'number' && item.id < 1000000) {
            const stock = heldStockMap.get(item.id);
            if (!stock) continue;
            const restored = applyStockDelta(
              { quantity: stock.quantity, loose_quantity: stock.loose_quantity },
              Number(item.qty || 0), Number(item.looseQty || 0), stock.pack_size || 1
            );
            await db.run('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?', [restored.quantity, restored.loose_quantity, item.id]);
            heldStockMap.set(item.id, { ...stock, quantity: restored.quantity, loose_quantity: restored.loose_quantity });
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
          const { quantity = 0, unit_price = 0, loose_qty = 0, pack_size = 1, discount_per = 0 } = item;
          const q = Number(quantity);
          const l = Number(loose_qty);
          const pSize = Number(pack_size || 1);
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

        const syncInventoryIds = items.map((it: any) => it.inventory_id).filter(Boolean);
        const syncStockMap = new Map<number, any>();
        if (syncInventoryIds.length > 0) {
          const placeholders = syncInventoryIds.map(() => '?').join(',');
          const rows = await db.all(
            `SELECT im.id as inventory_id, im.quantity, im.loose_quantity, COALESCE(m.pack_size, 1) as pack_size, m.name as db_medicine_name
             FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id IN (${placeholders})`,
            syncInventoryIds
          );
          for (const r of rows) syncStockMap.set(r.inventory_id, r);
        }

        for (const item of items) {
          const { inventory_id, quantity, unit_price, loose_qty = 0, discount_per = 0 } = item;
          const currentStock = syncStockMap.get(inventory_id);
          if (!currentStock) {
            throw new Error(`Inventory item ID ${inventory_id} does not exist during direct sync.`);
          }
          const pSize = currentStock.pack_size;
          const soldTotalUnits = Number(quantity) * pSize + Number(loose_qty);
          const availableTotalUnits = currentStock.quantity * pSize + currentStock.loose_quantity;
          if (availableTotalUnits < soldTotalUnits) {
            throw new Error(`Insufficient stock for "${currentStock.db_medicine_name || 'Medicine'}" during device sync. Available: ${currentStock.quantity} strips & ${currentStock.loose_quantity} loose. Requested: ${Number(quantity)} strips & ${Number(loose_qty)} loose.`);
          }

          await db.run(
            'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per) VALUES (?, ?, ?, ?, ?, ?)',
            [invoiceId, inventory_id, Number(quantity), Number(unit_price), Number(loose_qty), Number(discount_per)]
          );
          const newStock = applyStockDelta(
            { quantity: currentStock.quantity, loose_quantity: currentStock.loose_quantity },
            -Number(quantity), -Number(loose_qty), pSize
          );
          await db.run('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?', [newStock.quantity, newStock.loose_quantity, inventory_id]);
          syncStockMap.set(inventory_id, { ...currentStock, quantity: newStock.quantity, loose_quantity: newStock.loose_quantity });
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
    inventoryCache.invalidate();

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
      const { quantity = 0, unit_price = 0, loose_qty = 0, pack_size = 1, discount_per = 0 } = item;
      const q = Number(quantity);
      const l = Number(loose_qty);
      const pSize = Number(pack_size || 1);
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
      const { inventory_id, quantity, unit_price, loose_qty = 0, discount_per = 0, pack_size = 1 } = item;
      const currentStock = await db.get(
        `SELECT im.quantity, im.loose_quantity, COALESCE(m.pack_size, 1) as pack_size
         FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id = ?`,
        [inventory_id]
      );
      if (currentStock) {
        const newStock = applyStockDelta(
          { quantity: currentStock.quantity, loose_quantity: currentStock.loose_quantity },
          -Number(quantity), -Number(loose_qty), currentStock.pack_size || 1
        );
        await db.run('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?', [newStock.quantity, newStock.loose_quantity, inventory_id]);
      }
      await db.run(
        'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per) VALUES (?, ?, ?, ?, ?, ?)',
        [invoiceId, inventory_id, Number(quantity), Number(unit_price), Number(loose_qty), Number(discount_per)]
      );
    }

    // Mark staged as approved
    await db.run(`UPDATE staged_sales SET status = 'approved' WHERE id = ?`, [id]);

    await db.run('COMMIT');
    inventoryCache.invalidate();

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

// Get Purchase-Weighted (70% Purchase / 30% Sales) & Low-Stock Safety Reorder Suggestions
router.get('/reorder-suggestions', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    
    // Ensure snooze table exists
    await db.run(`
      CREATE TABLE IF NOT EXISTS inventory_reorder_snooze (
        medicine_id INTEGER PRIMARY KEY,
        snooze_until TEXT NOT NULL,
        snooze_type TEXT NOT NULL DEFAULT '7_days',
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        FOREIGN KEY (medicine_id) REFERENCES medicines(id)
      )
    `);

    // Fetch active snoozed medicine IDs
    const snoozedRows = await db.all(`
      SELECT medicine_id FROM inventory_reorder_snooze
      WHERE snooze_until > DATETIME('now')
    `);
    const snoozedSet = new Set<number>(snoozedRows.map((r: any) => Number(r.medicine_id)));

    // Query 2-Day sales per medicine
    const twoDaySalesMap: Record<number, any> = {};
    try {
      const twoDaySales = await db.all(`
        SELECT 
          m.id as medicine_id,
          m.name as medicine_name,
          m.manufacturer as company,
          m.packaging,
          m.mrp,
          SUM(si.quantity) as two_day_qty
        FROM sale_items si
        JOIN sales_invoices inv ON si.invoice_id = inv.id
        JOIN inventory_master im ON si.inventory_id = im.id
        JOIN medicines m ON im.medicine_id = m.id
        WHERE inv.date >= DATETIME('now', '-2 days')
        GROUP BY m.id
      `);
      for (const row of twoDaySales) {
        twoDaySalesMap[row.medicine_id] = row;
      }
    } catch (_) {}

    // Query 6-Month (180 days) sales per medicine
    const sixMonthSalesMap: Record<number, number> = {};
    try {
      const sixMonthRows = await db.all(`
        SELECT 
          im.medicine_id,
          SUM(si.quantity) as total_qty
        FROM sale_items si
        JOIN sales_invoices inv ON si.invoice_id = inv.id
        JOIN inventory_master im ON si.inventory_id = im.id
        WHERE inv.date >= DATETIME('now', '-180 days')
        GROUP BY im.medicine_id
      `);
      for (const row of sixMonthRows) {
        sixMonthSalesMap[row.medicine_id] = Number(row.total_qty || 0);
      }
    } catch (_) {}

    // Query 6-Month purchases per medicine
    const sixMonthPurchasesMap: Record<number, number> = {};
    try {
      const purchaseRows = await db.all(`
        SELECT 
          pi.medicine_id,
          SUM(pi.quantity) as total_qty
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        WHERE p.date >= DATETIME('now', '-180 days')
        GROUP BY pi.medicine_id
      `);
      for (const row of purchaseRows) {
        sixMonthPurchasesMap[row.medicine_id] = Number(row.total_qty || 0);
      }
    } catch (_) {}

    // Query Current Stock & Medicine details for candidates
    const candidateMeds = await db.all(`
      SELECT 
        m.id as medicine_id,
        m.name as medicine_name,
        m.manufacturer as company,
        m.packaging,
        COALESCE(MAX(im.cost_price), 0) as ptr,
        m.mrp,
        COALESCE(SUM(im.quantity), 0) as current_stock
      FROM medicines m
      LEFT JOIN inventory_master im ON im.medicine_id = m.id
      GROUP BY m.id
    `);

    const items: any[] = [];

    for (const row of candidateMeds) {
      const medId = Number(row.medicine_id);
      if (snoozedSet.has(medId)) continue; // Skip snoozed items

      const sold2Days = Number(twoDaySalesMap[medId]?.two_day_qty || 0);
      const sold6Months = Number(sixMonthSalesMap[medId] || 0);
      const purchased6Months = Number(sixMonthPurchasesMap[medId] || 0);
      const stock = Math.max(0, Number(row.current_stock || 0));

      // Purchase-weighted True Monthly Consumption (70% Purchase + 30% Sales)
      const monthlyWeightedConsumption = Math.round((0.70 * purchased6Months + 0.30 * sold6Months) / 6);
      const dailyAvgSales = Math.round((sold6Months / 180) * 100) / 100;
      const dailyAvgPurchases = Math.round((purchased6Months / 180) * 100) / 100;

      const isHotMover = monthlyWeightedConsumption >= 10 || sold2Days >= 5;
      const isLowStockSafety = stock <= 2 && (purchased6Months >= 6 || sold6Months >= 6);

      // Include if: 2-day sales > 0 OR Low stock safety OR Hot mover below stock threshold
      if (sold2Days > 0 || isLowStockSafety || (monthlyWeightedConsumption > 0 && stock <= monthlyWeightedConsumption)) {
        let suggestedQty = 1;
        if (monthlyWeightedConsumption > 0) {
          suggestedQty = Math.max(1, Math.ceil(monthlyWeightedConsumption - stock));
        } else if (sold2Days > 0) {
          suggestedQty = Math.max(1, sold2Days * 2);
        } else if (isLowStockSafety) {
          suggestedQty = Math.max(1, 10 - stock); // Standard strip/box top-up
        }

        items.push({
          medicineId: medId,
          medicineName: row.medicine_name,
          company: row.company || '',
          packaging: row.packaging || '',
          ptr: Number(row.ptr || 0),
          mrp: Number(row.mrp || 0),
          twoDaySales: sold2Days,
          sixMonthTotalSales: sold6Months,
          sixMonthAvgDailySales: dailyAvgSales,
          sixMonthTotalPurchases: purchased6Months,
          sixMonthAvgDailyPurchases: dailyAvgPurchases,
          monthlyWeightedConsumption,
          currentStock: stock,
          suggestedQty,
          isHotMover,
          isLowStockSafety
        });
      }
    }

    // Sort: Low Stock Safety & Hot Movers first, then higher suggestedQty
    items.sort((a, b) => {
      if (a.isLowStockSafety !== b.isLowStockSafety) return a.isLowStockSafety ? -1 : 1;
      if (a.isHotMover !== b.isHotMover) return a.isHotMover ? -1 : 1;
      return b.suggestedQty - a.suggestedQty;
    });

    res.json({ success: true, count: items.length, items });
  } catch (err: any) {
    console.error('Reorder suggestions error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch reorder suggestions' });
  }
});

// Snooze a medicine suggestion (7 days, 30 days, 180 days / 6 months, permanent)
router.post('/reorder-suggestions/snooze', async (req, res) => {
  try {
    const { medicineId, snoozeDays = 7, snoozeType = '7_days', reason = '' } = req.body;
    if (!medicineId) {
      return res.status(400).json({ error: 'medicineId is required' });
    }

    let daysToSnooze = Number(snoozeDays);
    if (snoozeType === '30_days') daysToSnooze = 30;
    else if (snoozeType === '6_months' || snoozeType === '180_days') daysToSnooze = 180;
    else if (snoozeType === 'permanent') daysToSnooze = 3650;

    const db = await dbManager.getConnection();
    await db.run(`
      CREATE TABLE IF NOT EXISTS inventory_reorder_snooze (
        medicine_id INTEGER PRIMARY KEY,
        snooze_until TEXT NOT NULL,
        snooze_type TEXT NOT NULL DEFAULT '7_days',
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        FOREIGN KEY (medicine_id) REFERENCES medicines(id)
      )
    `);

    await db.run(
      `INSERT OR REPLACE INTO inventory_reorder_snooze 
       (medicine_id, snooze_until, snooze_type, reason, created_at, updated_at) 
       VALUES (?, DATETIME('now', ?), ?, ?, COALESCE((SELECT created_at FROM inventory_reorder_snooze WHERE medicine_id = ?), DATETIME('now')), DATETIME('now'))`,
      [medicineId, `+${daysToSnooze} days`, snoozeType, reason, medicineId]
    );

    res.json({ success: true, message: `Medicine ${medicineId} snoozed for ${daysToSnooze} days (${snoozeType})` });
  } catch (err: any) {
    console.error('Failed to snooze reorder suggestion:', err);
    res.status(500).json({ error: err.message || 'Failed to snooze reorder suggestion' });
  }
});

// Remove snooze for a medicine (restore to pending reorder list)
router.post('/reorder-suggestions/unsnooze', async (req, res) => {
  try {
    const { medicineId } = req.body;
    if (!medicineId) {
      return res.status(400).json({ error: 'medicineId is required' });
    }

    const db = await dbManager.getConnection();
    await db.run(`DELETE FROM inventory_reorder_snooze WHERE medicine_id = ?`, [medicineId]);

    res.json({ success: true, message: `Medicine ${medicineId} restored to reorder list` });
  } catch (err: any) {
    console.error('Failed to unsnooze reorder suggestion:', err);
    res.status(500).json({ error: err.message || 'Failed to unsnooze reorder suggestion' });
  }
});

// Get all active snoozed medicines (for Learning Hub / Settings audit view)
router.get('/reorder-suggestions/snoozed', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();

    await db.run(`
      CREATE TABLE IF NOT EXISTS inventory_reorder_snooze (
        medicine_id INTEGER PRIMARY KEY,
        snooze_until TEXT NOT NULL,
        snooze_type TEXT NOT NULL DEFAULT '7_days',
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        FOREIGN KEY (medicine_id) REFERENCES medicines(id)
      )
    `);

    const rows = await db.all(`
      SELECT 
        s.medicine_id,
        s.snooze_until,
        s.snooze_type,
        s.reason,
        s.created_at,
        m.name as medicine_name,
        m.manufacturer as company,
        m.packaging,
        COALESCE((SELECT cost_price FROM inventory_master WHERE medicine_id = m.id AND cost_price > 0 LIMIT 1), 0) as ptr,
        m.mrp,
        COALESCE((SELECT SUM(quantity) FROM inventory_master WHERE medicine_id = m.id), 0) as current_stock,
        COALESCE((
          SELECT SUM(si.quantity) 
          FROM sale_items si 
          JOIN sales_invoices inv ON si.invoice_id = inv.id 
          JOIN inventory_master im ON si.inventory_id = im.id 
          WHERE im.medicine_id = m.id AND inv.date >= DATETIME('now', '-180 days')
        ), 0) as six_month_sales,
        COALESCE((
          SELECT SUM(pi.quantity) 
          FROM purchase_items pi 
          JOIN purchases p ON pi.purchase_id = p.id 
          WHERE pi.medicine_id = m.id AND p.date >= DATETIME('now', '-180 days')
        ), 0) as six_month_purchases
      FROM inventory_reorder_snooze s
      JOIN medicines m ON s.medicine_id = m.id
      WHERE s.snooze_until > DATETIME('now')
      ORDER BY s.snooze_until ASC
    `);

    const items = rows.map((r: any) => ({
      medicineId: r.medicine_id,
      medicineName: r.medicine_name,
      company: r.company || '',
      packaging: r.packaging || '',
      ptr: Number(r.ptr || 0),
      mrp: Number(r.mrp || 0),
      currentStock: Number(r.current_stock || 0),
      sixMonthSales: Number(r.six_month_sales || 0),
      sixMonthPurchases: Number(r.six_month_purchases || 0),
      snoozeUntil: r.snooze_until,
      snoozeType: r.snooze_type,
      reason: r.reason || '',
      createdAt: r.created_at
    }));

    res.json({ success: true, count: items.length, items });
  } catch (err: any) {
    console.error('Failed to fetch snoozed reorders:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch snoozed reorders' });
  }
});

// Get medicine refill & last sale details for prefilling POS
router.get('/medicine-refill-info/:medicineId', async (req, res) => {
  const { medicineId } = req.params;
  const medId = parseInt(medicineId, 10);
  if (isNaN(medId) || medId <= 0) {
    return res.status(400).json({ error: 'Valid medicine ID required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();

    // 1. Fetch medicine record
    const medicine = await db.get(
      `SELECT id, name, generic_name, mrp, sell_price, pack_size, packaging, manufacturer, schedule_type, category, allow_loose_sale
       FROM medicines WHERE id = ?`,
      [medId]
    );
    if (!medicine) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    // 2. Fetch best in-stock inventory batch (earliest expiry with positive stock)
    const inStockBatch = await db.get(
      `SELECT id as inventory_id, batch_no, expiry_date, quantity, loose_quantity, unit_price, mrp, rack_location
       FROM inventory_master
       WHERE medicine_id = ? AND (quantity > 0 OR loose_quantity > 0)
       ORDER BY (CASE WHEN expiry_date IS NOT NULL AND expiry_date != '' THEN expiry_date ELSE '9999-12-31' END) ASC
       LIMIT 1`,
      [medId]
    );

    // If no positive stock batch found, fetch latest batch record if exists
    const anyBatch = inStockBatch || await db.get(
      `SELECT id as inventory_id, batch_no, expiry_date, quantity, loose_quantity, unit_price, mrp, rack_location
       FROM inventory_master
       WHERE medicine_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [medId]
    );

    // 3. Query the latest sales invoice containing this medicine to identify customer, quantity, and doctor
    const lastSaleItem = await db.get(
      `SELECT si.id as sale_item_id, si.invoice_id, si.quantity as sold_quantity, si.loose_qty as sold_loose_qty,
              si.unit_price as sold_unit_price, si.discount_per as sold_discount,
              inv.invoice_no, inv.date as sale_date, inv.doctor_id,
              c.id as customer_id, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
              d.name as doctor_name
       FROM sale_items si
       JOIN sales_invoices inv ON si.invoice_id = inv.id
       JOIN inventory_master im ON si.inventory_id = im.id
       LEFT JOIN customers c ON inv.customer_id = c.id
       LEFT JOIN doctors d ON inv.doctor_id = d.id
       WHERE im.medicine_id = ?
       ORDER BY inv.date DESC, inv.id DESC
       LIMIT 1`,
      [medId]
    );

    // 4. If a previous sale exists, fetch other medicines from that same invoice for full prescription context
    let siblingItems: any[] = [];
    if (lastSaleItem && lastSaleItem.invoice_id) {
      siblingItems = await db.all(
        `SELECT si.id as sale_item_id, si.quantity as sold_quantity, si.loose_qty as sold_loose_qty,
                si.unit_price as sold_unit_price, si.discount_per as sold_discount,
                m.id as medicine_id, m.name as medicine_name, m.mrp, m.sell_price, m.packaging,
                COALESCE(m.pack_size, 1) as pack_size,
                im.id as inventory_id, im.batch_no, im.expiry_date, im.quantity as in_stock_qty, im.loose_quantity as in_stock_loose_qty
         FROM sale_items si
         JOIN inventory_master im ON si.inventory_id = im.id
         JOIN medicines m ON im.medicine_id = m.id
         WHERE si.invoice_id = ? AND m.id != ?`,
        [lastSaleItem.invoice_id, medId]
      );
    }

    res.json({
      success: true,
      medicine,
      best_inventory: anyBatch || null,
      last_sale: lastSaleItem ? {
        invoice_id: lastSaleItem.invoice_id,
        invoice_no: lastSaleItem.invoice_no,
        sale_date: lastSaleItem.sale_date,
        quantity: lastSaleItem.sold_quantity || 1,
        loose_qty: lastSaleItem.sold_loose_qty || 0,
        unit_price: lastSaleItem.sold_unit_price || medicine.sell_price || medicine.mrp || 0,
        discount: lastSaleItem.sold_discount || 0,
        customer_id: lastSaleItem.customer_id || null,
        customer_name: lastSaleItem.customer_name || '',
        customer_phone: lastSaleItem.customer_phone || '',
        customer_address: lastSaleItem.customer_address || '',
        doctor_id: lastSaleItem.doctor_id || null,
        doctor_name: lastSaleItem.doctor_name || ''
      } : null,
      sibling_items: siblingItems
    });
  } catch (err: any) {
    console.error('Failed to get medicine refill info:', err);
    res.status(500).json({ error: err.message || 'Failed to get medicine refill info' });
  }
});

// Get all previously purchased / prescribed refill medicines for a patient
router.get('/patient-refill-medicines', async (req, res) => {
  const { customerId, phone, name } = req.query;
  if (!customerId && !phone && !name) {
    return res.status(400).json({ error: 'customerId, phone, or name is required' });
  }

  let db;
  try {
    db = await dbManager.getConnection();

    let customer: any = null;
    const cleanPhone = phone ? String(phone).trim() : '';
    const digitsOnly = cleanPhone.replace(/\D/g, '').slice(-10);
    const cleanName = name ? String(name).trim() : '';

    if (customerId) {
      customer = await db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
    }
    if (!customer && digitsOnly.length === 10) {
      customer = await db.get(
        `SELECT * FROM customers 
         WHERE phone = ? OR REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ? LIMIT 1`,
        [cleanPhone, `%${digitsOnly}`]
      );
    }
    if (!customer && cleanName && cleanName.toLowerCase() !== 'walk-in' && cleanName.toLowerCase() !== 'customer') {
      customer = await db.get('SELECT * FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [cleanName]);
    }

    // Resolve all matching customer IDs
    let customerIds: number[] = customer ? [customer.id] : [];
    if (digitsOnly.length === 10 || (cleanName && cleanName.length > 2)) {
      const dupeRows = await db.all(
        `SELECT id FROM customers 
         WHERE (length(?) = 10 AND (phone = ? OR REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?))
            OR (length(?) > 2 AND LOWER(TRIM(name)) = LOWER(TRIM(?)))`,
        [digitsOnly, cleanPhone, `%${digitsOnly}`, cleanName, cleanName]
      );
      if (dupeRows && dupeRows.length > 0) {
        customerIds = Array.from(new Set([...customerIds, ...dupeRows.map(r => r.id)]));
      }
    }

    // 1. Check active records in patient_refills table
    let scheduledRefills: any[] = [];
    if (customerIds.length > 0 || digitsOnly.length === 10) {
      const phoneParam = digitsOnly.length === 10 ? `%${digitsOnly}%` : 'NON_EXISTENT';
      const cIdPlaceholders = customerIds.length > 0 ? customerIds.map(() => '?').join(',') : 'NULL';
      scheduledRefills = await db.all(
        `SELECT pr.id as refill_id, pr.medicine_id, pr.quantity_needed, pr.refill_interval_days, pr.next_refill_date,
                m.name as medicine_name, m.mrp, m.sell_price, m.packaging, COALESCE(m.pack_size, 1) as pack_size
         FROM patient_refills pr
         JOIN medicines m ON pr.medicine_id = m.id
         WHERE (pr.customer_id IN (${cIdPlaceholders}) OR pr.patient_phone LIKE ?) AND pr.is_active = 1`,
        [...customerIds, phoneParam]
      );
    }

    // 2. Query recent sales invoices & items for this customer (latest 5 invoices)
    let pastSaleMedicines: any[] = [];
    let lastDoctorName = '';
    if (customerIds.length > 0) {
      const placeholders = customerIds.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT m.id as medicine_id, m.name as medicine_name, m.mrp, m.sell_price, m.packaging,
                COALESCE(m.pack_size, 1) as pack_size,
                si.quantity as last_sold_qty, si.loose_qty as last_sold_loose_qty, si.unit_price as last_unit_price, si.discount_per as last_discount,
                inv.id as invoice_id, inv.invoice_no, inv.date as sale_date, d.name as doctor_name
         FROM sale_items si
         JOIN sales_invoices inv ON si.invoice_id = inv.id
         JOIN inventory_master im ON si.inventory_id = im.id
         JOIN medicines m ON im.medicine_id = m.id
         LEFT JOIN doctors d ON inv.doctor_id = d.id
         WHERE inv.customer_id IN (${placeholders})
         ORDER BY inv.date DESC, inv.id DESC
         LIMIT 20`,
        customerIds
      );

      // Deduplicate by medicine_id to get most recent purchase per medicine
      const seenMeds = new Set<number>();
      for (const row of rows) {
        if (row.doctor_name && !lastDoctorName) lastDoctorName = row.doctor_name;
        if (!seenMeds.has(row.medicine_id)) {
          seenMeds.add(row.medicine_id);
          pastSaleMedicines.push(row);
        }
      }
    }

    // 3. Combine medicines & enrich with live inventory availability
    const combinedMap = new Map<number, any>();

    // First add from scheduled refills
    for (const sr of scheduledRefills) {
      combinedMap.set(sr.medicine_id, {
        medicine_id: sr.medicine_id,
        medicine_name: sr.medicine_name,
        mrp: sr.mrp,
        sell_price: sr.sell_price,
        packaging: sr.packaging,
        pack_size: sr.pack_size,
        quantity: sr.quantity_needed || 1,
        loose_qty: 0,
        refill_id: sr.refill_id,
        refill_interval_days: sr.refill_interval_days,
        next_refill_date: sr.next_refill_date,
        source: 'scheduled_refill'
      });
    }

    // Then merge from past sales history (if not present or update with recent sale date)
    for (const ps of pastSaleMedicines) {
      if (!combinedMap.has(ps.medicine_id)) {
        combinedMap.set(ps.medicine_id, {
          medicine_id: ps.medicine_id,
          medicine_name: ps.medicine_name,
          mrp: ps.mrp,
          sell_price: ps.sell_price,
          packaging: ps.packaging,
          pack_size: ps.pack_size,
          quantity: ps.last_sold_qty || 1,
          loose_qty: ps.last_sold_loose_qty || 0,
          unit_price: ps.last_unit_price,
          discount: ps.last_discount,
          last_sale_date: ps.sale_date,
          last_invoice_no: ps.invoice_no,
          source: 'sales_history'
        });
      } else {
        const existing = combinedMap.get(ps.medicine_id);
        existing.last_sale_date = ps.sale_date;
        existing.last_invoice_no = ps.invoice_no;
        if (!existing.quantity || existing.quantity <= 1) {
          existing.quantity = ps.last_sold_qty || 1;
        }
        existing.loose_qty = ps.last_sold_loose_qty || 0;
      }
    }

    // Enrich with current in-stock inventory details
    const medicineList = Array.from(combinedMap.values());
    if (medicineList.length > 0) {
      const medIds = medicineList.map(m => m.medicine_id);
      const placeholders = medIds.map(() => '?').join(',');
      const invRows = await db.all(
        `SELECT im.id as inventory_id, im.medicine_id, im.batch_no, im.expiry_date,
                im.quantity as in_stock_qty, im.loose_quantity as in_stock_loose_qty,
                im.unit_price as current_unit_price, im.mrp as batch_mrp
         FROM inventory_master im
         WHERE im.medicine_id IN (${placeholders}) AND (im.quantity > 0 OR im.loose_quantity > 0)
         ORDER BY im.expiry_date ASC`,
        medIds
      );

      const invMap: Record<number, any> = {};
      for (const inv of invRows) {
        if (!invMap[inv.medicine_id]) {
          invMap[inv.medicine_id] = inv;
        }
      }

      for (const m of medicineList) {
        const inv = invMap[m.medicine_id];
        if (inv) {
          m.inventory_id = inv.inventory_id;
          m.batch_no = inv.batch_no;
          m.expiry_date = inv.expiry_date;
          m.in_stock_qty = inv.in_stock_qty;
          m.in_stock_loose_qty = inv.in_stock_loose_qty;
          m.has_stock = (inv.in_stock_qty > 0 || inv.in_stock_loose_qty > 0);
        } else {
          m.has_stock = false;
        }
      }
    }

    res.json({
      success: true,
      customer: customer ? {
        id: customer.id,
        name: customer.name,
        phone: customer.phone || '',
        address: customer.address || '',
        credit_balance: customer.credit_balance || 0
      } : null,
      doctor_name: lastDoctorName,
      medicines: medicineList
    });
  } catch (err: any) {
    console.error('Failed to get patient refill medicines:', err);
    res.status(500).json({ error: err.message || 'Failed to get patient refill medicines' });
  }
});

export default router;

