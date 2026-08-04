import { dbManager } from '../database/connection.js';

const SAFETY_FACTOR = 1.5;
const DEFAULT_LEAD_TIME = 7;
const DEFAULT_MIN_STOCK = 10;

export async function recalculateStockLimits(): Promise<void> {
  const db = await dbManager.getConnection();
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS stock_config (
        medicine_id INTEGER PRIMARY KEY,
        avg_daily_sales REAL DEFAULT 0,
        lead_time_days INTEGER DEFAULT 7,
        safety_factor REAL DEFAULT 1.5,
        min_stock_level INTEGER DEFAULT 10,
        max_stock_level INTEGER DEFAULT 30,
        reorder_level INTEGER DEFAULT 12,
        last_calculated DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
  } catch (err) {
    console.error('[StockCalculatorWorker] Recalculation error:', err);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startStockCalculatorWorker(intervalMs: number = 86400000): void {
  if (process.env.DISABLE_BACKGROUND_WORKERS !== 'false') {
    console.log('[StockCalculatorWorker] StockCalculatorWorker is STOPPED and DISABLED.');
    stopStockCalculatorWorker();
    return;
  }
  if (intervalId) return;

  console.log(`[StockCalculatorWorker] Starting with interval ${intervalMs}ms`);

  (async () => {
    try {
      const db = await dbManager.getConnection();
      await db.run(`
        CREATE TABLE IF NOT EXISTS stock_config (
          medicine_id INTEGER PRIMARY KEY,
          avg_daily_sales REAL DEFAULT 0,
          lead_time_days INTEGER DEFAULT 7,
          safety_factor REAL DEFAULT 1.5,
          min_stock_level INTEGER DEFAULT 10,
          max_stock_level INTEGER DEFAULT 30,
          reorder_level INTEGER DEFAULT 12,
          last_calculated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      const row = await db.get<{ last_calc: string | null }>(
        `SELECT MAX(last_calculated) as last_calc FROM stock_config`
      );

      if (row && row.last_calc) {
        const lastTime = new Date(row.last_calc).getTime();
        const now = Date.now();
        const diffMs = now - lastTime;
        if (diffMs < intervalMs) {
          console.log(`[StockCalculatorWorker] Stock limits were calculated ${(diffMs / 3600000).toFixed(1)}h ago. Skipping boot recalculation.`);
          return;
        }
      }

      await recalculateStockLimits();
    } catch (err) {
      console.error('[StockCalculatorWorker] Initial calculation check failed:', err);
    }
  })();

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
