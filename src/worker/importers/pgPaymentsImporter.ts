/**
 * PostgreSQL → SQLite Importer for payment & credit data:
 *   - payments → distributor_payments
 *   - payment_details → distributor_payment_details
 *   - order_credit → order_credits
 *   - cr_note_resolution → updates purchases.cn_number / cn_amount
 */

import { Database } from 'sqlite';
import { distributorMap } from './pgMasterImporter.js';
import { purchaseMap } from './pgPurchaseImporter.js';
import { salesInvoiceMap } from './pgSalesImporter.js';

// Maps for cross-referencing
export const paymentMap = new Map<string, number>(); // legacy payment_id → new id

export function clearPaymentsMap() {
  paymentMap.clear();
}

// ─── Payments → distributor_payments ────────────────────────
let paymentBatch: any[] = [];

export async function importPayment(row: Record<string, string | null>, db: Database) {
  const legacyId = row['payment_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  const legacyDistId = row['distributor_id'];
  const distributorId = legacyDistId ? distributorMap.get(legacyDistId) : null;
  if (!distributorId) return; // Distributor not imported

  paymentBatch.push({
    distributor_id: distributorId,
    amount: parseFloat(row['amount'] || '0') || 0,
    payment_type: row['payment_type'] || null,
    date: row['created_time'] || null,
    cheque_no: row['ch_no'] || null,
    cheque_bank: row['ch_bank'] || null,
    cheque_date: row['ch_date'] || null,
    upi_id: row['upi_id'] || null,
    legacy_id: legacyId,
    business_date: row['business_date'] || row['created_time'] || null,
  });

  if (paymentBatch.length >= 500) {
    await flushPayments(db);
  }
}

export async function flushPayments(db: Database) {
  if (paymentBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const p of paymentBatch) {
      try {
        const result = await db.run(
          `INSERT INTO distributor_payments (distributor_id, amount, payment_type, date, cheque_no, cheque_bank, cheque_date, upi_id, legacy_id, business_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.distributor_id, p.amount, p.payment_type, p.date, p.cheque_no, p.cheque_bank, p.cheque_date, p.upi_id, p.legacy_id, p.business_date]
        );
        paymentMap.set(p.legacy_id, result.lastID!);
      } catch (err: any) {
        console.warn(`[Migration] Skipped payment ${p.legacy_id}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    paymentBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Payment Details → distributor_payment_details ──────────
let paymentDetailBatch: any[] = [];

export async function importPaymentDetail(row: Record<string, string | null>, db: Database) {
  const legacyId = row['payment_detail_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  const legacyPaymentId = row['payment_id'];
  const paymentId = legacyPaymentId ? paymentMap.get(legacyPaymentId) : null;
  if (!paymentId) return; // Parent payment not imported

  const legacyInvId = row['inventory_id'];
  const purchaseId = legacyInvId ? purchaseMap.get(legacyInvId) : null;

  paymentDetailBatch.push({
    payment_id: paymentId,
    purchase_id: purchaseId || null,
    amount: parseFloat(row['amount'] || '0') || 0,
    discount: parseFloat(row['discount'] || '0') || 0,
    legacy_id: legacyId,
    business_date: row['business_date'] || null,
  });

  if (paymentDetailBatch.length >= 1000) {
    await flushPaymentDetails(db);
  }
}

export async function flushPaymentDetails(db: Database) {
  if (paymentDetailBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const pd of paymentDetailBatch) {
      try {
        await db.run(
          `INSERT INTO distributor_payment_details (payment_id, purchase_id, amount, discount, legacy_id, business_date)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [pd.payment_id, pd.purchase_id, pd.amount, pd.discount, pd.legacy_id, pd.business_date]
        );
      } catch (err: any) {
        console.warn(`[Migration] Skipped payment detail ${pd.legacy_id}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    paymentDetailBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Order Credit → order_credits ───────────────────────────
let orderCreditBatch: any[] = [];

export async function importOrderCredit(row: Record<string, string | null>, db: Database) {
  const legacyId = row['order_credit_id'];
  const deleted = row['deleted'];
  if (!legacyId || deleted === 't') return;

  const legacyOrderId = row['order_id'];
  const salesInvoiceId = legacyOrderId ? salesInvoiceMap.get(legacyOrderId) : null;
  if (!salesInvoiceId) return; // Parent invoice not imported

  const isPaid = row['paid'] === 't' || row['paid'] === 'true';

  orderCreditBatch.push({
    sales_invoice_id: salesInvoiceId,
    amount_paid: isPaid ? 1 : 0, // paid flag — actual amount is on the invoice
    legacy_id: legacyId,
  });

  // Mark the invoice as CREDIT if unpaid
  if (!isPaid) {
    try {
      await db.run(
        `UPDATE sales_invoices SET payment_status = 'CREDIT' WHERE id = ? AND payment_status = 'PAID'`,
        [salesInvoiceId]
      );
    } catch (_) { /* non-critical */ }
  }

  if (orderCreditBatch.length >= 1000) {
    await flushOrderCredits(db);
  }
}

export async function flushOrderCredits(db: Database) {
  if (orderCreditBatch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const oc of orderCreditBatch) {
      try {
        await db.run(
          `INSERT INTO order_credits (sales_invoice_id, amount_paid, legacy_id)
           VALUES (?, ?, ?)`,
          [oc.sales_invoice_id, oc.amount_paid, oc.legacy_id]
        );
      } catch (err: any) {
        console.warn(`[Migration] Skipped order credit ${oc.legacy_id}: ${err.message}`);
      }
    }
    await db.run('COMMIT');
    orderCreditBatch = [];
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// ─── Credit Note Resolution → purchase CN fields ───────────
export async function importCrNoteResolution(row: Record<string, string | null>, db: Database) {
  const deleted = row['deleted'];
  if (deleted === 't') return;

  const legacyInvId = row['inventory_id'];
  const purchaseId = legacyInvId ? purchaseMap.get(legacyInvId) : null;
  if (!purchaseId) return;

  const cnNumber = row['credit_note_number'] || null;
  const cnAmount = parseFloat(row['amount'] || '0') || 0;
  if (!cnNumber && !cnAmount) return;

  try {
    await db.run(
      `UPDATE purchases SET cn_number = COALESCE(cn_number, ?), cn_amount = COALESCE(cn_amount, 0) + ? WHERE id = ?`,
      [cnNumber, cnAmount, purchaseId]
    );
  } catch (err: any) {
    console.warn(`[Migration] Skipped cr_note_resolution for purchase ${purchaseId}: ${err.message}`);
  }
}
