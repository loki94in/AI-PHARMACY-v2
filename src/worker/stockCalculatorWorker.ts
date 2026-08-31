import { dbManager } from '../database/connection.js';
import { eventService } from '../services/eventService.js';
import { activityTracker } from '../utils/activityTracker.js';
import { runHeavyJob } from '../utils/backgroundJobLane.js';

const SAFETY_FACTOR = 1.5;
const DEFAULT_LEAD_TIME = 7;
const DEFAULT_MIN_STOCK = 10;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMedicineIds = new Set<number>();
let fullStockRebuildRequested = false;
let activeStockRecalcPromise: Promise<void> | null = null;
let activeStockLimitsPromise: Promise<void> | null = null;

export function triggerPreCalculatedStockRebuildDebounced(medicineIds?: number[], delayMs: number = 500): void {
  if (medicineIds && medicineIds.length > 0) {
    for (const id of medicineIds) {
      if (typeof id === 'number' && id > 0) {
        pendingMedicineIds.add(id);
      }
    }
  } else {
    fullStockRebuildRequested = true;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const idsToProcess = Array.from(pendingMedicineIds);
    const needFull = fullStockRebuildRequested;
    pendingMedicineIds.clear();
    fullStockRebuildRequested = false;
    debounceTimer = null;

    if (!needFull && idsToProcess.length > 0) {
      recalculateTargetedStockMetrics(idsToProcess).catch(err => {
        console.error('[StockCalculatorWorker] Targeted rebuild error:', err);
      });
    } else if (needFull) {
      recalculateTargetedStockMetrics().catch(err => {
        console.error('[StockCalculatorWorker] Full rebuild error:', err);
      });
    }
  }, delayMs);
}

export async function recalculateTargetedStockMetrics(affectedMedicineIds?: number[]): Promise<void> {
  if (activeStockRecalcPromise) {
    return activeStockRecalcPromise;
  }

  activeStockRecalcPromise = (async () => {
    const db = await dbManager.getConnection();
    try {
      let medicineIdsToUpdate: number[] = [];
      const isTargeted = affectedMedicineIds && affectedMedicineIds.length > 0 && affectedMedicineIds.length <= 100;

      if (affectedMedicineIds && affectedMedicineIds.length > 0) {
        medicineIdsToUpdate = Array.from(new Set(affectedMedicineIds));
      } else {
        const rows = (await db.all(`
          SELECT DISTINCT id FROM medicines WHERE id IN (
            SELECT DISTINCT medicine_id FROM inventory_master
            UNION
            SELECT DISTINCT im.medicine_id FROM sale_items sit JOIN inventory_master im ON im.id = sit.inventory_id
            UNION
            SELECT DISTINCT medicine_id FROM purchase_items
          )
        `)) as { id: number }[];
        medicineIdsToUpdate = rows.map(r => r.id);
      }

      if (medicineIdsToUpdate.length === 0) return;

      console.log(`[StockCalculatorWorker] Recalculating precalculated stock metrics for ${medicineIdsToUpdate.length} medicines`);

      if (isTargeted) {
        // Fast targeted path for a small set of affected medicines (<= 100)
        for (const medId of medicineIdsToUpdate) {
          const poolRow = await db.get<{ total_units: number; reorder_level: number | null }>(`
            SELECT 
              COALESCE(SUM(im.quantity * COALESCE(m.pack_size, 1) + COALESCE(im.loose_quantity, 0)), 0) as total_units,
              MAX(im.reorder_level) as reorder_level
            FROM inventory_master im
            LEFT JOIN medicines m ON m.id = im.medicine_id
            WHERE im.medicine_id = ?
          `, [medId]);

          const totalUnitsPool = poolRow?.total_units || 0;

          const configRow = await db.get<{ reorder_level: number }>(
            'SELECT reorder_level FROM stock_config WHERE medicine_id = ?',
            [medId]
          );
          const reorderLevel = poolRow?.reorder_level ?? configRow?.reorder_level ?? DEFAULT_MIN_STOCK;
          const lowStockFlag = totalUnitsPool <= reorderLevel ? 1 : 0;

          const salesRow = await db.get<{ total_qty: number; first_sale_date: string | null }>(`
            SELECT 
              COALESCE(SUM(sit.quantity), 0) as total_qty,
              MIN(si.date) as first_sale_date
            FROM sale_items sit
            JOIN sales_invoices si ON si.id = sit.invoice_id
            JOIN inventory_master im ON im.id = sit.inventory_id
            WHERE im.medicine_id = ?
            AND si.date >= datetime('now', '-180 days')
          `, [medId]);

          const totalQty180d = salesRow?.total_qty || 0;
          const firstSaleDateStr = salesRow?.first_sale_date;

          let dailySalesVelocity = 0;
          let burnRateRatio = 0;

          const nowTime = Date.now();
          const daysSinceFirstSale = firstSaleDateStr
            ? Math.max(1, Math.ceil((nowTime - new Date(firstSaleDateStr).getTime()) / (1000 * 60 * 60 * 24)))
            : 0;

          if (daysSinceFirstSale > 0 && daysSinceFirstSale < 30) {
            const microVelocity = totalQty180d / daysSinceFirstSale;
            dailySalesVelocity = microVelocity;
            burnRateRatio = totalUnitsPool > 0
              ? (microVelocity * DEFAULT_LEAD_TIME) / totalUnitsPool
              : (microVelocity > 0 ? 99 : 0);
          } else {
            dailySalesVelocity = totalQty180d / 180;
            burnRateRatio = totalUnitsPool > 0
              ? (dailySalesVelocity * DEFAULT_LEAD_TIME) / totalUnitsPool
              : (dailySalesVelocity > 0 ? 99 : 0);
          }

          const heavySellFlag = burnRateRatio >= 1.2 ? 1 : 0;
          const suggestedRefillQty = (lowStockFlag === 1 || heavySellFlag === 1)
            ? Math.max(0, reorderLevel * 2 - totalUnitsPool)
            : 0;

          const metricsJson = JSON.stringify({
            total_units_pool: totalUnitsPool,
            reorder_level: reorderLevel,
            low_stock_flag: lowStockFlag,
            daily_sales_velocity: Number(dailySalesVelocity.toFixed(3)),
            burn_rate_ratio: Number(burnRateRatio.toFixed(3)),
            heavy_sell_flag: heavySellFlag,
            suggested_refill_qty: suggestedRefillQty,
            days_since_first_sale: daysSinceFirstSale
          });

          await db.run(`
            INSERT INTO precalculated_stock_metrics
            (medicine_id, total_units_pool, low_stock_flag, daily_sales_velocity, burn_rate_ratio, heavy_sell_flag, suggested_refill_qty, metrics_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(medicine_id) DO UPDATE SET
              total_units_pool = excluded.total_units_pool,
              low_stock_flag = excluded.low_stock_flag,
              daily_sales_velocity = excluded.daily_sales_velocity,
              burn_rate_ratio = excluded.burn_rate_ratio,
              heavy_sell_flag = excluded.heavy_sell_flag,
              suggested_refill_qty = excluded.suggested_refill_qty,
              metrics_json = excluded.metrics_json,
              updated_at = CURRENT_TIMESTAMP
          `, [
            medId,
            totalUnitsPool,
            lowStockFlag,
            dailySalesVelocity,
            burnRateRatio,
            heavySellFlag,
            suggestedRefillQty,
            metricsJson
          ]);
        }
      } else {
        // High-performance set-based batch calculation for large/full medicine sets (10,000+ items)
        // 1. Fetch total units pool and reorder level for all medicines in one query
        const poolRows = await db.all<{ medicine_id: number; total_units: number; reorder_level: number | null }>(`
          SELECT 
            im.medicine_id,
            COALESCE(SUM(im.quantity * COALESCE(m.pack_size, 1) + COALESCE(im.loose_quantity, 0)), 0) as total_units,
            MAX(im.reorder_level) as reorder_level
          FROM inventory_master im
          LEFT JOIN medicines m ON m.id = im.medicine_id
          GROUP BY im.medicine_id
        `);
        const poolMap = new Map<number, { total_units: number; reorder_level: number | null }>();
        for (const r of poolRows) {
          poolMap.set(r.medicine_id, r);
        }

        // 2. Fetch stock_config for reorder_level in one query
        const configRows = await db.all<{ medicine_id: number; reorder_level: number }>(
          'SELECT medicine_id, reorder_level FROM stock_config'
        );
        const configMap = new Map<number, number>();
        for (const r of configRows) {
          configMap.set(r.medicine_id, r.reorder_level);
        }

        // 3. Fetch sales velocity over last 180 days in one query
        const salesRows = await db.all<{ medicine_id: number; total_qty: number; first_sale_date: string | null }>(`
          SELECT 
            im.medicine_id,
            COALESCE(SUM(sit.quantity), 0) as total_qty,
            MIN(si.date) as first_sale_date
          FROM sale_items sit
          JOIN sales_invoices si ON si.id = sit.invoice_id
          JOIN inventory_master im ON im.id = sit.inventory_id
          WHERE si.date >= datetime('now', '-180 days')
          GROUP BY im.medicine_id
        `);
        const salesMap = new Map<number, { total_qty: number; first_sale_date: string | null }>();
        for (const r of salesRows) {
          salesMap.set(r.medicine_id, r);
        }

        const nowTime = Date.now();
        const insertBatch: {
          medId: number;
          totalUnitsPool: number;
          lowStockFlag: number;
          dailySalesVelocity: number;
          burnRateRatio: number;
          heavySellFlag: number;
          suggestedRefillQty: number;
          metricsJson: string;
        }[] = [];

        for (const medId of medicineIdsToUpdate) {
          const pool = poolMap.get(medId);
          const totalUnitsPool = pool?.total_units || 0;
          const reorderLevel = pool?.reorder_level ?? configMap.get(medId) ?? DEFAULT_MIN_STOCK;
          const lowStockFlag = totalUnitsPool <= reorderLevel ? 1 : 0;

          const sales = salesMap.get(medId);
          const totalQty180d = sales?.total_qty || 0;
          const firstSaleDateStr = sales?.first_sale_date;

          let dailySalesVelocity = 0;
          let burnRateRatio = 0;

          const daysSinceFirstSale = firstSaleDateStr
            ? Math.max(1, Math.ceil((nowTime - new Date(firstSaleDateStr).getTime()) / (1000 * 60 * 60 * 24)))
            : 0;

          if (daysSinceFirstSale > 0 && daysSinceFirstSale < 30) {
            const microVelocity = totalQty180d / daysSinceFirstSale;
            dailySalesVelocity = microVelocity;
            burnRateRatio = totalUnitsPool > 0
              ? (microVelocity * DEFAULT_LEAD_TIME) / totalUnitsPool
              : (microVelocity > 0 ? 99 : 0);
          } else {
            dailySalesVelocity = totalQty180d / 180;
            burnRateRatio = totalUnitsPool > 0
              ? (dailySalesVelocity * DEFAULT_LEAD_TIME) / totalUnitsPool
              : (dailySalesVelocity > 0 ? 99 : 0);
          }

          const heavySellFlag = burnRateRatio >= 1.2 ? 1 : 0;
          const suggestedRefillQty = (lowStockFlag === 1 || heavySellFlag === 1)
            ? Math.max(0, reorderLevel * 2 - totalUnitsPool)
            : 0;

          const metricsJson = JSON.stringify({
            total_units_pool: totalUnitsPool,
            reorder_level: reorderLevel,
            low_stock_flag: lowStockFlag,
            daily_sales_velocity: Number(dailySalesVelocity.toFixed(3)),
            burn_rate_ratio: Number(burnRateRatio.toFixed(3)),
            heavy_sell_flag: heavySellFlag,
            suggested_refill_qty: suggestedRefillQty,
            days_since_first_sale: daysSinceFirstSale
          });

          insertBatch.push({
            medId,
            totalUnitsPool,
            lowStockFlag,
            dailySalesVelocity,
            burnRateRatio,
            heavySellFlag,
            suggestedRefillQty,
            metricsJson
          });
        }

        // Write in chunks of 200 to stay well within SQLite parameter limits
        const chunkSize = 200;
        for (let i = 0; i < insertBatch.length; i += chunkSize) {
          const chunk = insertBatch.slice(i, i + chunkSize);
          const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').join(', ');
          const flatParams: any[] = [];
          for (const item of chunk) {
            flatParams.push(
              item.medId,
              item.totalUnitsPool,
              item.lowStockFlag,
              item.dailySalesVelocity,
              item.burnRateRatio,
              item.heavySellFlag,
              item.suggestedRefillQty,
              item.metricsJson
            );
          }

          await db.run(`
            INSERT INTO precalculated_stock_metrics
            (medicine_id, total_units_pool, low_stock_flag, daily_sales_velocity, burn_rate_ratio, heavy_sell_flag, suggested_refill_qty, metrics_json, updated_at)
            VALUES ${placeholders}
            ON CONFLICT(medicine_id) DO UPDATE SET
              total_units_pool = excluded.total_units_pool,
              low_stock_flag = excluded.low_stock_flag,
              daily_sales_velocity = excluded.daily_sales_velocity,
              burn_rate_ratio = excluded.burn_rate_ratio,
              heavy_sell_flag = excluded.heavy_sell_flag,
              suggested_refill_qty = excluded.suggested_refill_qty,
              metrics_json = excluded.metrics_json,
              updated_at = CURRENT_TIMESTAMP
          `, flatParams);
        }
      }

      eventService.broadcast('stock_metrics_updated', {
        count: medicineIdsToUpdate.length,
        updated_at: new Date().toISOString()
      });

    } catch (err) {
      console.error('[StockCalculatorWorker] Targeted calculation error:', err);
    } finally {
      activeStockRecalcPromise = null;
    }
  })();

  return activeStockRecalcPromise;
}

export async function recalculateStockLimits(): Promise<void> {
  if (activeStockLimitsPromise) {
    return activeStockLimitsPromise;
  }

  activeStockLimitsPromise = (async () => {
    const db = await dbManager.getConnection();
    try {
      try {
        const { deactivateExpiredInventory } = await import('../utils/inventoryActive.js');
        const zeroed = await deactivateExpiredInventory(db);
        if (zeroed > 0) console.log(`[StockCalculatorWorker] Deactivated ${zeroed} expired inventory batch(es).`);
      } catch (err) {
        console.error('[StockCalculatorWorker] deactivateExpiredInventory error:', err);
      }

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

      const medicines = (await db.all(
        `SELECT id, name FROM medicines WHERE id IN (
           SELECT DISTINCT medicine_id FROM inventory_master
         )`
      )) as { id: number; name: string }[];

      console.log(`[StockCalculatorWorker] Recalculating stock limits for ${medicines.length} medicines`);

      // Grouped 90-day daily sales calculation in ONE set-based query
      const salesGroupRows = await db.all<{ medicine_id: number; avg_daily_sales: number }>(`
        SELECT
          im.medicine_id,
          COALESCE(AVG(daily_qty), 0) as avg_daily_sales
        FROM (
          SELECT
            im.medicine_id,
            DATE(si.date) as sale_date,
            SUM(sit.quantity) as daily_qty
          FROM sale_items sit
          JOIN sales_invoices si ON si.id = sit.invoice_id
          JOIN inventory_master im ON im.id = sit.inventory_id
          WHERE si.date >= datetime('now', '-90 days')
          GROUP BY im.medicine_id, DATE(si.date)
        )
        GROUP BY im.medicine_id
      `);

      const avgSalesMap = new Map<number, number>();
      for (const r of salesGroupRows) {
        avgSalesMap.set(r.medicine_id, r.avg_daily_sales);
      }

      const configItems: {
        id: number;
        avgDailySales: number;
        leadTime: number;
        safetyFactor: number;
        minStock: number;
        maxStock: number;
        reorderLevel: number;
      }[] = [];

      const leadTime = DEFAULT_LEAD_TIME;
      for (const med of medicines) {
        const avgDailySales = avgSalesMap.get(med.id) || 0;
        const minStock = Math.max(
          DEFAULT_MIN_STOCK,
          Math.ceil(avgDailySales * leadTime * SAFETY_FACTOR)
        );
        const reorderLevel = Math.ceil(minStock * 1.2);
        const maxStock = Math.ceil(minStock * 3);
        configItems.push({
          id: med.id,
          avgDailySales,
          leadTime,
          safetyFactor: SAFETY_FACTOR,
          minStock,
          maxStock,
          reorderLevel
        });
      }

      // Batch insert into stock_config in chunks of 200
      const chunkSize = 200;
      for (let i = 0; i < configItems.length; i += chunkSize) {
        const chunk = configItems.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').join(', ');
        const flatParams: any[] = [];
        for (const item of chunk) {
          flatParams.push(
            item.id,
            item.avgDailySales,
            item.leadTime,
            item.safetyFactor,
            item.minStock,
            item.maxStock,
            item.reorderLevel
          );
        }
        await db.run(`
          INSERT OR REPLACE INTO stock_config
          (medicine_id, avg_daily_sales, lead_time_days, safety_factor, min_stock_level, max_stock_level, reorder_level, last_calculated)
          VALUES ${placeholders}
        `, flatParams);
      }

      // Also execute targeted stock metrics recalculation across all medicines
      await recalculateTargetedStockMetrics();

      console.log('[StockCalculatorWorker] Stock limits recalculated successfully');
    } catch (err) {
      console.error('[StockCalculatorWorker] Recalculation error:', err);
    } finally {
      activeStockLimitsPromise = null;
    }
  })();

  return activeStockLimitsPromise;
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
    // P3 gated worker: skip ticks while the user is idle >30 min; recalculation
    // resumes automatically on the next tick after wake.
    if (activityTracker.isIdle()) return;
    runHeavyJob('stock_calculator', recalculateStockLimits).catch(err =>
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
