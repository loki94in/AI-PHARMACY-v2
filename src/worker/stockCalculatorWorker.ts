import { dbManager } from '../database/connection.js';

const SAFETY_FACTOR = 1.5;
const DEFAULT_LEAD_TIME = 7;
const DEFAULT_MIN_STOCK = 10;

export async function recalculateStockLimits(): Promise<void> {
  const db = await dbManager.getConnection();
  try {
    const medicines = await db.all(
      `SELECT id, name FROM medicines WHERE id IN (
         SELECT DISTINCT medicine_id FROM inventory_master
       )`
    );

    console.log(`[StockCalculatorWorker] Recalculating stock limits for ${medicines.length} medicines`);

    for (const med of medicines) {
      const salesResult = await db.get(
        `SELECT
           COALESCE(AVG(daily_qty), 0) as avg_daily_sales
         FROM (
           SELECT
             DATE(si.date) as sale_date,
             SUM(sit.quantity) as daily_qty
           FROM sale_items sit
           JOIN sales_invoices si ON si.id = sit.invoice_id
           JOIN inventory_master im ON im.id = sit.inventory_id
           WHERE im.medicine_id = ?
           AND si.date >= datetime('now', '-90 days')
           GROUP BY DATE(si.date)
         )`,
        [med.id]
      );

      const avgDailySales = salesResult?.avg_daily_sales || 0;
      const leadTime = DEFAULT_LEAD_TIME;
      const minStock = Math.max(
        DEFAULT_MIN_STOCK,
        Math.ceil(avgDailySales * leadTime * SAFETY_FACTOR)
      );
      const reorderLevel = Math.ceil(minStock * 1.2);
      const maxStock = Math.ceil(minStock * 3);

      await db.run(
        `INSERT OR REPLACE INTO stock_config
         (medicine_id, avg_daily_sales, lead_time_days, safety_factor,
          min_stock_level, max_stock_level, reorder_level, last_calculated)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [med.id, avgDailySales, leadTime, SAFETY_FACTOR, minStock, maxStock, reorderLevel]
      );
    }

    console.log('[StockCalculatorWorker] Stock limits recalculated successfully');
  } finally {
    await dbManager.close();
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startStockCalculatorWorker(intervalMs: number = 86400000): void {
  if (intervalId) return;

  console.log(`[StockCalculatorWorker] Starting with interval ${intervalMs}ms`);
  recalculateStockLimits().catch(err =>
    console.error('[StockCalculatorWorker] Initial calculation failed:', err)
  );

  intervalId = setInterval(() => {
    recalculateStockLimits().catch(err =>
      console.error('[StockCalculatorWorker] Periodic calculation failed:', err)
    );
  }, intervalMs);
}

export function stopStockCalculatorWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[StockCalculatorWorker] Stopped');
  }
}
