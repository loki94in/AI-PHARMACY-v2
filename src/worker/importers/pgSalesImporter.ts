/**
 * PostgreSQL → SQLite Importer for sales data:
 *   - orders → sales_invoices
 *   - order_item → sale_items
 */

import { Database } from 'sqlite';
import { medicineMap, doctorMap, patientMap } from './pgMasterImporter.js';
import { batchMap, legacyBatchIdToNoMap } from './pgPurchaseImporter.js';
import { normalizeDateOrRaw } from '../../utils/migrationUtils.js';
import { recordAuditEntry } from '../../utils/migrationAudit.js';

// Maps for cross-referencing
export const salesInvoiceMap = new Map<string, number>(); // legacy order_id → new sales_invoices.id

// In-memory set to ensure unique invoice_no across the import session
const seenInvoiceNos = new Set<string>();
let existingInvoicesLoaded = false;

async function ensureInvoiceNoUnique(invoiceNo: string, legacyId: string, db: Database): Promise<string> {
  if (!existingInvoicesLoaded) {
    // Load existing invoice numbers from database to prevent conflicts with pre-existing data
    const rows = await db.all('SELECT invoice_no FROM sales_invoices WHERE invoice_no IS NOT NULL');
    for (const r of rows) {
      seenInvoiceNos.add(r.invoice_no);
    }
    existingInvoicesLoaded = true;
  }

  let uniqueInvoice = invoiceNo;
  let counter = 1;
  while (seenInvoiceNos.has(uniqueInvoice)) {
    uniqueInvoice = `${invoiceNo}-${legacyId}`;
    if (seenInvoiceNos.has(uniqueInvoice)) {
      uniqueInvoice = `${invoiceNo}-${legacyId}-${counter++}`;
    }
  }
  seenInvoiceNos.add(uniqueInvoice);
  return uniqueInvoice;
}

// Clear state between migration runs
export function clearSalesMap() {
  salesInvoiceMap.clear();
  seenInvoiceNos.clear();
  existingInvoicesLoaded = false;
}

// ─── Orders → sales_invoices ────────────────────────────────
let salesBatch: any[] = [];

const COMPLETED_STATUSES = new Set([
  'BILL', 'DELIVERED', 'COMPLETED', 'BILLED', 'CLOSED', 'PAID', 'SETTLED',
  'FULFILLED', 'DISPATCHED', 'SUCCESS', 'FINALIZE', 'FINALIZED', 'FINAL', 'DONE', 'OK'
]);

export async function importOrder(row: Record<string, string | null>, db: Database) {
  const legacyId = row['order_id'];
  const deleted = (row['deleted'] || '').trim().toLowerCase();
  if (!legacyId || deleted === 't' || deleted === 'true' || deleted === '1') return;

  // Only import completed/valid bills (allow missing status or any valid completed order status)
  const status = (row['order_status'] || '').trim().toUpperCase();
  if (status && !COMPLETED_STATUSES.has(status)) return;

  const rawInvoice = row['invoice'] || legacyId;
  const uniqueInvoice = await ensureInvoiceNoUnique(rawInvoice, legacyId, db);

  // Resolve patient → customer (strictly preserve as NULL if unresolved, never fallback to arbitrary numeric ID)
  const legacyPatientId = row['patient_id'];
  const customerId = (legacyPatientId && patientMap.has(legacyPatientId)) ? (patientMap.get(legacyPatientId) ?? null) : null;
  if (legacyPatientId && customerId === null) {
    await recordAuditEntry({
      table: 'sales_invoices',
      recordIdentifier: uniqueInvoice,
      entityType: 'customer',
      action: 'preserved_null',
      reason: `Legacy patient_id "${legacyPatientId}" was not found in patient master — relationship preserved as NULL`,
      rawId: legacyPatientId,
    }, db);
  }

  // Resolve doctor (strictly preserve as NULL if unresolved, never fallback to arbitrary numeric ID)
  const legacyDoctorId = row['doctor_id'];
  const doctorId = (legacyDoctorId && doctorMap.has(legacyDoctorId)) ? (doctorMap.get(legacyDoctorId) ?? null) : null;
  if (legacyDoctorId && doctorId === null) {
    await recordAuditEntry({
      table: 'sales_invoices',
      recordIdentifier: uniqueInvoice,
      entityType: 'doctor',
      action: 'preserved_null',
      reason: `Legacy doctor_id "${legacyDoctorId}" was not found in doctor master — relationship preserved as NULL`,
      rawId: legacyDoctorId,
    }, db);
  }

  const total_amount = parseFloat(row['amount'] || '0') || 0;
  const discount = parseFloat(row['discount'] || '0') || 0;

  salesBatch.push({
    invoice_no: uniqueInvoice,
    customer_id: customerId,
    date: normalizeDateOrRaw(row['created_time']),
    total_amount,
    tax_amount: parseFloat(row['net_gst_value'] || '0') || 0,
    doctor_id: doctorId,
    payment_medium: row['payment_medium'] || null,
    roff: parseFloat(row['roff'] || '0') || 0,
    cgst_value: parseFloat(row['cgst_value'] || '0') || 0,
    sgst_value: parseFloat(row['sgst_value'] || '0') || 0,
    igst_value: parseFloat(row['igst_value'] || '0') || 0,
    legacy_id: legacyId,
    business_date: normalizeDateOrRaw(row['business_date'] || row['created_time']),
    discount,
    subtotal: total_amount + discount,
  });

  if (salesBatch.length >= 2000) {
    await flushSalesInvoices(db);
  }
}

export async function flushSalesInvoices(db: Database) {
  if (salesBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const s of salesBatch) {
      try {
        const result = await db.run(
          `INSERT INTO sales_invoices (invoice_no, customer_id, date, total_amount, tax_amount, doctor_id, payment_medium, roff, cgst_value, sgst_value, igst_value, legacy_id, business_date, discount, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [s.invoice_no, s.customer_id, s.date, s.total_amount, s.tax_amount, s.doctor_id, s.payment_medium, s.roff, s.cgst_value, s.sgst_value, s.igst_value, s.legacy_id, s.business_date, s.discount || 0, s.subtotal || s.total_amount]
        );
        salesInvoiceMap.set(s.legacy_id, result.lastID!);
      } catch (err: any) {
        console.warn(`[Migration] Skipped sales invoice ${s.invoice_no}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    salesBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Order Item → sale_items ────────────────────────────────
let saleItemBatch: any[] = [];

export async function importOrderItem(row: Record<string, string | null>, db: Database) {
  const legacyId = row['order_item_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  // Resolve parent order → sales_invoices
  const legacyOrderId = row['order_id'];
  const invoiceId = legacyOrderId ? salesInvoiceMap.get(legacyOrderId) : null;
  if (!invoiceId) return; // Parent order was deleted or not imported

  // Resolve medicine
  const legacyMedId = row['medicine_id'];
  const medicineId = legacyMedId ? medicineMap.get(legacyMedId) : null;

  // Resolve batch → inventory_master
  const legacyBatchId = row['batch_id'];
  const inventoryId = legacyBatchId ? batchMap.get(legacyBatchId) : null;
  const batchNo = legacyBatchId ? (legacyBatchIdToNoMap.get(legacyBatchId) || legacyBatchId) : null;

  saleItemBatch.push({
    invoice_id: invoiceId,
    inventory_id: inventoryId || null,
    quantity: parseInt(row['quantity'] || '0') || 0,
    // total_price is the line total (qty × rate) — use mrp as per-unit price
    unit_price: parseFloat(row['mrp'] || '0') || 0,
    mrp: parseFloat(row['mrp'] || '0') || 0,
    batch_no: batchNo,
    cgst_value: parseFloat(row['cgst_value'] || '0') || 0,
    sgst_value: parseFloat(row['sgst_value'] || '0') || 0,
    discount_per: parseFloat(row['disc_per'] || '0') || 0,
    loose_qty: parseInt(row['loose'] || '0') || 0,
    legacy_id: legacyId,
  });

  if (saleItemBatch.length >= 3000) {
    await flushSaleItems(db);
  }
}

export async function flushSaleItems(db: Database) {
  if (saleItemBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const si of saleItemBatch) {
      try {
        await db.run(
          `INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, mrp, batch_no, cgst_value, sgst_value, discount_per, loose_qty, legacy_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [si.invoice_id, si.inventory_id, si.quantity, si.unit_price, si.mrp, si.batch_no, si.cgst_value, si.sgst_value, si.discount_per, si.loose_qty || 0, si.legacy_id]
        );
      } catch (err: any) {
        console.warn(`[Migration] Skipped sale item ${si.legacy_id}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    saleItemBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}
