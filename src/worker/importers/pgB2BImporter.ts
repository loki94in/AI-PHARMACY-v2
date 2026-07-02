/**
 * PostgreSQL → SQLite Importer for B2B sales data:
 *   - b2b_sales → b2b_invoices
 *   - b2b_sales_item → b2b_invoice_items
 */

import { Database } from 'sqlite';
import { medicineMap, customerMap } from './pgMasterImporter.js';
import { legacyBatchIdToNoMap } from './pgPurchaseImporter.js';

// Maps for cross-referencing
export const b2bInvoiceMap = new Map<string, number>(); // legacy b2b_order_id → new id

export function clearB2BMap() {
  b2bInvoiceMap.clear();
}

// ─── B2B Sales → b2b_invoices ───────────────────────────────
let b2bBatch: any[] = [];

export async function importB2BSale(row: Record<string, string | null>, db: Database) {
  const legacyId = row['b2b_sales_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  // Resolve B2B customer
  const legacyCustomerId = row['customer_id'];
  const customerId = legacyCustomerId ? customerMap.get(legacyCustomerId) : null;

  b2bBatch.push({
    invoice_no: row['invoice'] || legacyId,
    customer_id: customerId || null,
    date: row['invoice_date'] || row['created_time'] || null,
    total_amount: parseFloat(row['amount'] || '0') || 0,
    cgst_value: parseFloat(row['cgst_value'] || '0') || 0,
    sgst_value: parseFloat(row['sgst_value'] || '0') || 0,
    igst_value: parseFloat(row['igst_value'] || '0') || 0,
    roff: parseFloat(row['roff'] || '0') || 0,
    discount: 0,
    payment_medium: row['order_type'] || null,
    legacy_id: legacyId,
    business_date: row['invoice_date'] || row['created_time'] || null,
  });

  if (b2bBatch.length >= 500) {
    await flushB2BInvoices(db);
  }
}

export async function flushB2BInvoices(db: Database) {
  if (b2bBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const b of b2bBatch) {
      try {
        const result = await db.run(
          `INSERT INTO b2b_invoices (invoice_no, customer_id, date, total_amount, cgst_value, sgst_value, igst_value, roff, discount, payment_medium, legacy_id, business_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [b.invoice_no, b.customer_id, b.date, b.total_amount, b.cgst_value, b.sgst_value, b.igst_value, b.roff, b.discount, b.payment_medium, b.legacy_id, b.business_date]
        );
        b2bInvoiceMap.set(b.legacy_id, result.lastID!);
      } catch (err: any) {
        console.warn(`[Migration] Skipped B2B invoice ${b.invoice_no}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    b2bBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── B2B Sales Item → b2b_invoice_items ─────────────────────
let b2bItemBatch: any[] = [];

export async function importB2BSaleItem(row: Record<string, string | null>, db: Database) {
  const legacyId = row['b2b_sales_item_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  // Resolve parent B2B invoice
  const legacyOrderId = row['b2b_sales_id'];
  const invoiceId = legacyOrderId ? b2bInvoiceMap.get(legacyOrderId) : null;
  if (!invoiceId) return; // Parent not imported

  const legacyMedId = row['medicine_id'];
  const medicineId = legacyMedId ? medicineMap.get(legacyMedId) : null;

  const legacyBatchId = row['batch_id'];
  const batchNo = legacyBatchId ? (legacyBatchIdToNoMap.get(legacyBatchId) || legacyBatchId) : null;

  b2bItemBatch.push({
    invoice_id: invoiceId,
    medicine_id: medicineId || null,
    batch_no: batchNo,
    quantity: parseInt(row['quantity'] || '0') || 0,
    mrp: parseFloat(row['per_sku'] || '0') || 0,
    cost_price: parseFloat(row['total_price'] || '0') || 0,
    cgst_value: parseFloat(row['cgst_value'] || '0') || 0,
    sgst_value: parseFloat(row['sgst_value'] || '0') || 0,
    discount_per: parseFloat(row['disc_per'] || '0') || 0,
    legacy_id: legacyId,
  });

  if (b2bItemBatch.length >= 2000) {
    await flushB2BItems(db);
  }
}

export async function flushB2BItems(db: Database) {
  if (b2bItemBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const bi of b2bItemBatch) {
      try {
        await db.run(
          `INSERT INTO b2b_invoice_items (invoice_id, medicine_id, batch_no, quantity, mrp, cost_price, cgst_value, sgst_value, discount_per, legacy_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [bi.invoice_id, bi.medicine_id, bi.batch_no, bi.quantity, bi.mrp, bi.cost_price, bi.cgst_value, bi.sgst_value, bi.discount_per, bi.legacy_id]
        );
      } catch (err: any) {
        console.warn(`[Migration] Skipped B2B item ${bi.legacy_id}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    b2bItemBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}
