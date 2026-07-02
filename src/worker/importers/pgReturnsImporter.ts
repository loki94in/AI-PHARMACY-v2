/**
 * PostgreSQL → SQLite Importer for returns & stock data:
 *   - return_orders → returns
 *   - return_order_item → return_items
 *   - stock_effects → stock_ledger
 */

import { Database } from 'sqlite';
import { medicineMap, distributorMap, patientMap, customerMap } from './pgMasterImporter.js';
import { purchaseMap, legacyBatchIdToNoMap } from './pgPurchaseImporter.js';
import { salesInvoiceMap } from './pgSalesImporter.js';

// Maps for cross-referencing
export const returnMap = new Map<string, number>(); // legacy return_order_id → new returns.id

export function clearReturnsMap() {
  returnMap.clear();
}

// ─── Return Orders → returns ────────────────────────────────
let returnBatch: any[] = [];

export async function importReturnOrder(row: Record<string, string | null>, db: Database) {
  const legacyId = row['return_order_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  // Determine return type
  const returnOrderType = (row['return_order_type'] || '').toUpperCase();
  const returnType = returnOrderType === 'PURCHASE' ? 'purchase' : 'sale';

  // Resolve distributor for purchase returns
  const legacyDistId = row['distributor_id'];
  const distributorId = legacyDistId ? distributorMap.get(legacyDistId) : null;

  // Generate return_no
  const returnNo = row['invoice_id'] || `RET-${legacyId}`;

  // Resolve original invoice for sale returns
  let originalInvoiceId: number | null = null;
  if (returnType === 'sale' && row['invoice_id']) {
    originalInvoiceId = salesInvoiceMap.get(row['invoice_id']) || null;
  }

  // Resolve customer: try patient first (retail), then B2B customer
  const legacyPatientId = row['patient_id'];
  const legacyCustomerId = row['customer_id'];
  let customerId: number | null = null;
  if (legacyPatientId) customerId = patientMap.get(legacyPatientId) || null;
  if (!customerId && legacyCustomerId) customerId = customerMap.get(legacyCustomerId) || null;

  const rawReturnType = row['return_type'] || null;
  let subType = 'good';
  if (rawReturnType && rawReturnType.toLowerCase().includes('expiry')) {
    subType = 'expiry';
  }

  returnBatch.push({
    return_no: returnNo,
    original_invoice_id: originalInvoiceId,
    type: returnType,
    date: row['created_time'] || null,
    total_amount: parseFloat(row['amount'] || '0') || 0,
    cgst_value: parseFloat(row['cgst_value'] || '0') || 0,
    sgst_value: parseFloat(row['sgst_value'] || '0') || 0,
    igst_value: parseFloat(row['igst_value'] || '0') || 0,
    distributor_id: distributorId || null,
    legacy_id: legacyId,
    return_sub_type: subType,
    raw_return_type: rawReturnType,
    return_date_time: row['created_time'] || null,
  });

  if (returnBatch.length >= 500) {
    await flushReturns(db);
  }
}

export async function flushReturns(db: Database) {
  if (returnBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const r of returnBatch) {
      try {
        const result = await db.run(
          `INSERT INTO returns (return_no, original_invoice_id, type, date, total_amount, cgst_value, sgst_value, igst_value, distributor_id, legacy_id, return_sub_type, raw_return_type, return_date_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.return_no, r.original_invoice_id, r.type, r.date, r.total_amount, r.cgst_value, r.sgst_value, r.igst_value, r.distributor_id, r.legacy_id, r.return_sub_type || null, r.raw_return_type || null, r.return_date_time || null]
        );
        returnMap.set(r.legacy_id, result.lastID!);
      } catch (err: any) {
        console.warn(`[Migration] Skipped return ${r.return_no}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    returnBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Return Order Item → return_items ───────────────────────
let returnItemBatch: any[] = [];

export async function importReturnOrderItem(row: Record<string, string | null>, db: Database) {
  const legacyId = row['return_order_item_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  // Resolve parent return
  const legacyReturnId = row['return_order_id'];
  const returnId = legacyReturnId ? returnMap.get(legacyReturnId) : null;
  if (!returnId) return; // Parent return was deleted or not imported

  // Resolve medicine
  const legacyMedId = row['medicine_id'];
  const medicineId = legacyMedId ? medicineMap.get(legacyMedId) : null;

  const legacyBatchId = row['batch_id'];
  const batchNo = legacyBatchId ? (legacyBatchIdToNoMap.get(legacyBatchId) || legacyBatchId) : null;

  returnItemBatch.push({
    return_id: returnId,
    medicine_id: medicineId || null,
    batch_no: batchNo,
    quantity: parseInt(row['quantity'] || '0') || 0,
    cost_price: parseFloat(row['cost_price'] || '0') || 0,
    mrp: parseFloat(row['mrp'] || '0') || 0,
    total_price: parseFloat(row['total_price'] || '0') || 0,
    cgst_value: parseFloat(row['cgst_value'] || '0') || 0,
    sgst_value: parseFloat(row['sgst_value'] || '0') || 0,
    igst_value: parseFloat(row['igst_value'] || '0') || 0,
    legacy_id: legacyId,
  });

  if (returnItemBatch.length >= 2000) {
    await flushReturnItems(db);
  }
}

export async function flushReturnItems(db: Database) {
  if (returnItemBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const ri of returnItemBatch) {
      try {
        await db.run(
          `INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, cost_price, mrp, total_price, cgst_value, sgst_value, igst_value, legacy_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ri.return_id, ri.medicine_id, ri.batch_no, ri.quantity, ri.cost_price, ri.mrp, ri.total_price, ri.cgst_value, ri.sgst_value, ri.igst_value, ri.legacy_id]
        );
      } catch (err: any) {
        console.warn(`[Migration] Skipped return item ${ri.legacy_id}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    returnItemBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Stock Effects → stock_ledger ───────────────────────────
let stockBatch: any[] = [];

export async function importStockEffect(row: Record<string, string | null>, db: Database) {
  const deleted = row['deleted'];
  if (deleted === 't') return;

  // Resolve medicine
  const legacyMedId = row['medicine_id'];
  const medicineId = legacyMedId ? medicineMap.get(legacyMedId) : null;
  if (!medicineId) return;

  const legacyBatchId = row['batch_id'];
  const batchNo = legacyBatchId ? (legacyBatchIdToNoMap.get(legacyBatchId) || legacyBatchId) : null;

  stockBatch.push({
    medicine_id: medicineId,
    batch_no: batchNo,
    quantity: parseInt(row['quantity'] || '0') || 0,
    transaction_type: row['transaction_type'] || null,
    transaction_id: row['transaction_id'] || null,
    business_date: row['business_date'] || null,
  });

  if (stockBatch.length >= 5000) {
    await flushStockLedger(db);
  }
}

export async function flushStockLedger(db: Database) {
  if (stockBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const s of stockBatch) {
      try {
        await db.run(
          `INSERT INTO stock_ledger (medicine_id, batch_no, quantity, transaction_type, transaction_id, business_date)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [s.medicine_id, s.batch_no, s.quantity, s.transaction_type, s.transaction_id, s.business_date]
        );
      } catch (err: any) {
        console.warn(`[Migration] Skipped stock ledger entry: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    stockBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}
