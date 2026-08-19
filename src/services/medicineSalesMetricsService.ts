import cron from 'node-cron';
import { dbManager } from '../database/connection.js';

let schemaEnsured = false;

export async function ensureMedicineSalesMetricsSchema(db: any): Promise<void> {
  if (schemaEnsured) return;
  await db.run(`
    CREATE TABLE IF NOT EXISTS medicine_sales_metrics (
      medicine_id INTEGER PRIMARY KEY,
      sales_2d_qty REAL NOT NULL DEFAULT 0,
      sales_window_qty REAL NOT NULL DEFAULT 0,
      purchases_window_qty REAL NOT NULL DEFAULT 0,
      last_sold_date TEXT,
      last_purchase_date TEXT,
      last_purchase_ptr REAL DEFAULT 0,
      last_distributor_id INTEGER,
      last_distributor_name TEXT,
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      FOREIGN KEY (medicine_id) REFERENCES medicines(id)
    )
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_msm_activity
    ON medicine_sales_metrics(sales_window_qty, purchases_window_qty, sales_2d_qty)
  `);
  schemaEnsured = true;
}

/**
 * Same-day freshness hook: call once per sold line item, in the same transaction
 * as the existing inventory_master decrement. Does NOT touch current_stock.
 */
export async function applySaleDelta(db: any, medicineId: number, soldQty: number): Promise<void> {
  if (!medicineId || !soldQty) return;
  await ensureMedicineSalesMetricsSchema(db);
  await db.run(
    `INSERT INTO medicine_sales_metrics (medicine_id, sales_2d_qty, sales_window_qty, last_sold_date, updated_at)
     VALUES (?, ?, ?, DATETIME('now'), DATETIME('now'))
     ON CONFLICT(medicine_id) DO UPDATE SET
       sales_2d_qty = sales_2d_qty + excluded.sales_2d_qty,
       sales_window_qty = sales_window_qty + excluded.sales_window_qty,
       last_sold_date = excluded.last_sold_date,
       updated_at = excluded.updated_at`,
    [medicineId, soldQty, soldQty]
  );
}

export async function getReorderWindowMonths(dbInstance?: any): Promise<number> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_reorder_window_months'");
    const val = row && row.value ? parseInt(row.value, 10) : NaN;
    if ([2, 4, 6, 8].includes(val)) return val;
  } catch (err) {
    console.warn('[MedicineSalesMetrics] Error resolving reorder window months:', err);
  }
  return 2;
}

/** Pure function — no DB access. Mirrors the existing live-scan formula exactly, parameterized by windowMonths. */
export function computeReorderSuggestion(
  metrics: { sales2dQty: number; salesWindowQty: number; purchasesWindowQty: number; currentStock: number },
  windowMonths: number
): { monthlyWeightedConsumption: number; isHotMover: boolean; isLowStockSafety: boolean; included: boolean; suggestedQty: number } {
  const { sales2dQty, salesWindowQty, purchasesWindowQty, currentStock } = metrics;
  const monthlyWeightedConsumption = Math.round((0.70 * purchasesWindowQty + 0.30 * salesWindowQty) / windowMonths);
  const isHotMover = monthlyWeightedConsumption >= 10 || sales2dQty >= 5;
  const isLowStockSafety = currentStock <= 2 && (purchasesWindowQty >= 6 || salesWindowQty >= 6);
  const included = sales2dQty > 0 || isLowStockSafety || (monthlyWeightedConsumption > 0 && currentStock <= monthlyWeightedConsumption);

  let suggestedQty = 1;
  if (monthlyWeightedConsumption > 0) {
    suggestedQty = Math.max(1, Math.ceil(monthlyWeightedConsumption - currentStock));
  } else if (sales2dQty > 0) {
    suggestedQty = Math.max(1, sales2dQty * 2);
  } else if (isLowStockSafety) {
    suggestedQty = Math.max(1, 10 - currentStock);
  }

  return { monthlyWeightedConsumption, isHotMover, isLowStockSafety, included, suggestedQty };
}

/**
 * Correctness backstop: fully re-derives sales_window_qty, purchases_window_qty, sales_2d_qty,
 * and last_purchase_* for every medicine with any activity in the window, directly from
 * sale_items/purchase_items. Fixes drift from edits/deletes/returns that weren't individually hooked.
 */
export async function reconcileAllMedicineSalesMetrics(db: any, windowMonths: number): Promise<void> {
  await ensureMedicineSalesMetricsSchema(db);
  const windowDays = windowMonths * 30;

  const salesRows = await db.all(
    `SELECT im.medicine_id, SUM(si.quantity) as window_qty, MAX(inv.date) as last_sold_date
     FROM sale_items si
     JOIN sales_invoices inv ON si.invoice_id = inv.id
     JOIN inventory_master im ON si.inventory_id = im.id
     WHERE inv.date >= DATETIME('now', ?)
     GROUP BY im.medicine_id`,
    [`-${windowDays} days`]
  );
  const twoDayRows = await db.all(
    `SELECT im.medicine_id, SUM(si.quantity) as two_day_qty
     FROM sale_items si
     JOIN sales_invoices inv ON si.invoice_id = inv.id
     JOIN inventory_master im ON si.inventory_id = im.id
     WHERE inv.date >= DATETIME('now', '-2 days')
     GROUP BY im.medicine_id`
  );
  const purchaseRows = await db.all(
    `SELECT pi.medicine_id, SUM(pi.quantity) as window_qty, MAX(p.date) as last_purchase_date
     FROM purchase_items pi
     JOIN purchases p ON pi.purchase_id = p.id
     WHERE p.date >= DATETIME('now', ?)
     GROUP BY pi.medicine_id`,
    [`-${windowDays} days`]
  );
  const lastPurchaseDetailRows = await db.all(
    `SELECT pi.medicine_id, pi.cost_price as ptr, p.distributor_id, d.name as distributor_name, p.date
     FROM purchase_items pi
     JOIN purchases p ON pi.purchase_id = p.id
     LEFT JOIN distributors d ON d.id = p.distributor_id
     WHERE p.date >= DATETIME('now', ?)
     ORDER BY p.date DESC`,
    [`-${windowDays} days`]
  );
  const lastPurchaseDetailByMed: Record<number, any> = {};
  for (const row of lastPurchaseDetailRows) {
    if (!lastPurchaseDetailByMed[row.medicine_id]) lastPurchaseDetailByMed[row.medicine_id] = row;
  }

  const medicineIds = new Set<number>();
  for (const r of salesRows) medicineIds.add(r.medicine_id);
  for (const r of twoDayRows) medicineIds.add(r.medicine_id);
  for (const r of purchaseRows) medicineIds.add(r.medicine_id);

  const salesByMed = Object.fromEntries(salesRows.map((r: any) => [r.medicine_id, r]));
  const twoDayByMed = Object.fromEntries(twoDayRows.map((r: any) => [r.medicine_id, r]));
  const purchaseByMed = Object.fromEntries(purchaseRows.map((r: any) => [r.medicine_id, r]));

  await db.run('BEGIN IMMEDIATE TRANSACTION');
  try {
    await db.run('DELETE FROM medicine_sales_metrics');
    for (const medId of medicineIds) {
      const sales = salesByMed[medId];
      const twoDay = twoDayByMed[medId];
      const purchase = purchaseByMed[medId];
      const lastPurchase = lastPurchaseDetailByMed[medId];
      await db.run(
        `INSERT INTO medicine_sales_metrics
           (medicine_id, sales_2d_qty, sales_window_qty, purchases_window_qty,
            last_sold_date, last_purchase_date, last_purchase_ptr, last_distributor_id, last_distributor_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now'))`,
        [
          medId,
          Number(twoDay?.two_day_qty || 0),
          Number(sales?.window_qty || 0),
          Number(purchase?.window_qty || 0),
          sales?.last_sold_date || null,
          lastPurchase?.date || null,
          Number(lastPurchase?.ptr || 0),
          lastPurchase?.distributor_id || null,
          lastPurchase?.distributor_name || null
        ]
      );
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    throw err;
  }
}

// Register the nightly reconcile at module load — imageArchiveService's initJobs()
// pattern was found to never actually be called anywhere in this codebase, so this
// registers directly instead of depending on an external init call that might not happen.
const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
if (!isTest) {
  cron.schedule('0 3 * * *', async () => {
    try {
      const db = await dbManager.getConnection();
      const windowMonths = await getReorderWindowMonths(db);
      await reconcileAllMedicineSalesMetrics(db, windowMonths);
      console.log('[MedicineSalesMetrics] Nightly reconcile complete.');
    } catch (err) {
      console.error('[MedicineSalesMetrics] Nightly reconcile failed:', err);
    }
  });

  // Startup backfill: populate immediately on first run instead of waiting for 3am.
  (async () => {
    try {
      const db = await dbManager.getConnection();
      await ensureMedicineSalesMetricsSchema(db);
      const row = await db.get('SELECT COUNT(*) as c FROM medicine_sales_metrics');
      if (!row || Number(row.c) === 0) {
        const windowMonths = await getReorderWindowMonths(db);
        await reconcileAllMedicineSalesMetrics(db, windowMonths);
        console.log('[MedicineSalesMetrics] Initial backfill complete.');
      }
    } catch (err) {
      console.error('[MedicineSalesMetrics] Initial backfill failed:', err);
    }
  })();
}
