/**
 * PostgreSQL → SQLite Importer for supplementary data:
 *   - purchase_order → purchase_orders
 *   - purchase_order_item → purchase_order_items
 *   - scheduled_orders → patient_refills
 *   - retailer → app_settings (shop profile)
 */

import { Database } from 'sqlite';
import { medicineMap, distributorMap, patientMap } from './pgMasterImporter.js';

// Maps for cross-referencing
export const purchaseOrderMap = new Map<string, number>(); // legacy PO id → new id

export function clearExtrasMap() {
  purchaseOrderMap.clear();
}

// ─── Purchase Order → purchase_orders ───────────────────────
let poBatch: any[] = [];

export async function importPurchaseOrder(row: Record<string, string | null>, db: Database) {
  const legacyId = row['purchase_order_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  const legacyDistId = row['distributor_id'];
  const distributorId = legacyDistId ? distributorMap.get(legacyDistId) : null;

  poBatch.push({
    distributor_id: distributorId || null,
    status: row['status'] || 'DRAFT',
    date: row['created_time'] || null,
    legacy_id: legacyId,
    business_date: row['business_date'] || row['created_time'] || null,
  });

  if (poBatch.length >= 500) {
    await flushPurchaseOrders(db);
  }
}

export async function flushPurchaseOrders(db: Database) {
  if (poBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const po of poBatch) {
      try {
        const result = await db.run(
          `INSERT INTO purchase_orders (distributor_id, status, date, legacy_id, business_date)
           VALUES (?, ?, ?, ?, ?)`,
          [po.distributor_id, po.status, po.date, po.legacy_id, po.business_date]
        );
        purchaseOrderMap.set(po.legacy_id, result.lastID!);
      } catch (err: any) {
        console.warn(`[Migration] Skipped purchase order ${po.legacy_id}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    poBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Purchase Order Item → purchase_order_items ─────────────
let poItemBatch: any[] = [];

export async function importPurchaseOrderItem(row: Record<string, string | null>, db: Database) {
  const legacyId = row['purchase_order_item_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  const legacyPOId = row['purchase_order_id'];
  const purchaseOrderId = legacyPOId ? purchaseOrderMap.get(legacyPOId) : null;
  if (!purchaseOrderId) return; // Parent PO not imported

  const legacyMedId = row['medicine_id'];
  const medicineId = legacyMedId ? medicineMap.get(legacyMedId) : null;

  poItemBatch.push({
    purchase_order_id: purchaseOrderId,
    medicine_id: medicineId || null,
    quantity: parseInt(row['quantity'] || '0') || 0,
    free_qty: parseInt(row['free'] || '0') || 0,
    cost_price: parseFloat(row['cost_price'] || '0') || 0,
    mrp: parseFloat(row['mrp'] || '0') || 0,
    legacy_id: legacyId,
  });

  if (poItemBatch.length >= 1000) {
    await flushPurchaseOrderItems(db);
  }
}

export async function flushPurchaseOrderItems(db: Database) {
  if (poItemBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const pi of poItemBatch) {
      try {
        await db.run(
          `INSERT INTO purchase_order_items (purchase_order_id, medicine_id, quantity, free_qty, cost_price, mrp, legacy_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [pi.purchase_order_id, pi.medicine_id, pi.quantity, pi.free_qty, pi.cost_price, pi.mrp, pi.legacy_id]
        );
      } catch (err: any) {
        console.warn(`[Migration] Skipped PO item ${pi.legacy_id}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    poItemBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Scheduled Orders → patient_refills ─────────────────────
let refillBatch: any[] = [];

export async function importScheduledOrder(row: Record<string, string | null>, db: Database) {
  const legacyId = row['scheduled_order_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  const status = row['status'];
  if (status === 'INACTIVE' || status === 'CANCELLED') return;

  const legacyPatientId = row['patient_id'];

  const intervalDays = parseInt(row['schedule_interval'] || '30') || 30;

  refillBatch.push({
    patient_id: legacyPatientId,
    doctor_id: row['doctor_id'] || null,
    start_date: row['start_date'] || null,
    end_date: row['end_date'] || null,
    interval_days: intervalDays,
    title: row['title'] || null,
    legacy_id: legacyId,
  });

  if (refillBatch.length >= 200) {
    await flushRefills(db);
  }
}

export async function flushRefills(db: Database) {
  if (refillBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const r of refillBatch) {
      try {
        // Resolve patient → customer to get name and phone
        const customerId = r.patient_id ? patientMap.get(r.patient_id) : null;
        if (!customerId) continue; // Can't create refill without patient

        const customer = await db.get('SELECT name, phone FROM customers WHERE id = ?', [customerId]);
        if (!customer) continue;

        // Try to find a medicine from the title or skip if no medicine link
        // ponytail: scheduled_item has the medicine; we handle it separately via importScheduledItem
        await db.run(
          `INSERT INTO patient_refills (patient_name, patient_phone, medicine_id, refill_interval_days, last_refill_date, next_refill_date, status, is_active)
           VALUES (?, ?, 0, ?, ?, ?, 'pending', ?)`,
          [
            customer.name,
            customer.phone || '',
            r.interval_days,
            r.start_date,
            r.end_date,
            r.end_date ? 0 : 1, // If end_date exists and passed, mark inactive
          ]
        );
      } catch (err: any) {
        console.warn(`[Migration] Skipped scheduled order ${r.legacy_id}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    refillBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Retailer → app_settings (populate empty settings) ──────
export async function importRetailer(row: Record<string, string | null>, db: Database) {
  const deleted = row['deleted'];
  if (deleted === 't') return;

  // Only populate settings that are currently empty/default
  const settingsMap: Record<string, string | null> = {
    'medical_name': row['retailer_name'] || row['retailer_bar_name'] || null,
    'shop_address': [row['city'], row['state']].filter(Boolean).join(', ') || null,
    'shop_gstin': row['gst_no'] || null,
    'shop_dl_no': row['vat_no'] || null, // DL number not in dump; vat_no as fallback
    'shop_phone': row['phone_number'] || row['contact'] || null,
    'shop_email': row['email'] || null,
    'shop_state': row['state'] || null,
    'shop_pincode': row['pincode'] || null,
    'shop_gst_state': row['gst_state'] || null,
  };

  for (const [key, value] of Object.entries(settingsMap)) {
    if (!value) continue;
    try {
      // Only insert if the setting doesn't exist yet — don't overwrite user's existing settings
      await db.run(
        `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`,
        [key, value]
      );
    } catch (_) { /* non-critical */ }
  }
}
