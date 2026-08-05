import { dbManager } from '../database/connection.js';

export interface PurchaseSummaryCache {
  totalAmount: number;
  totalInvoices: number;
  totalGst: number;
}

export interface LearningStatsCache {
  activeOcrCorrections: number;
  learnedRxCombos: number;
  lastRetrainedAt: string | null;
}

export interface RefillAlertsCache {
  pendingRefillsCount: number;
  dueTodayCount: number;
}

/**
 * Reads a JSON payload from the persistent SQLite summary_cache table.
 */
export async function getSummaryCache<T>(key: string): Promise<T | null> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get<{ cache_value: string }>('SELECT cache_value FROM summary_cache WHERE cache_key = ?', [key]);
    if (!row || !row.cache_value) return null;
    return JSON.parse(row.cache_value) as T;
  } catch (err) {
    console.error(`[SummaryCacheService] Failed to read cache key "${key}":`, err);
    return null;
  }
}

/**
 * Upserts a JSON payload into the persistent SQLite summary_cache table.
 */
export async function setSummaryCache<T>(key: string, value: T): Promise<void> {
  try {
    const db = await dbManager.getConnection();
    await db.run(
      `INSERT INTO summary_cache (cache_key, cache_value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(cache_key) DO UPDATE SET
         cache_value = excluded.cache_value,
         updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(value)]
    );
  } catch (err) {
    console.error(`[SummaryCacheService] Failed to set cache key "${key}":`, err);
  }
}

/**
 * Re-computes and caches top KPI summary metrics for Purchase History.
 */
export async function rebuildPurchaseSummaryCache(): Promise<PurchaseSummaryCache> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get<{ total_amount: number; total_invoices: number }>(
      'SELECT COALESCE(SUM(total_amount), 0) AS total_amount, COUNT(*) AS total_invoices FROM purchases'
    );
    
    // Estimate total GST from purchase items
    const taxRow = await db.get<{ total_gst: number }>(
      'SELECT COALESCE(SUM((cgst_per + sgst_per + igst_per) * (COALESCE(cost_price, 0) * quantity) / 100), 0) AS total_gst FROM purchase_items'
    );

    const summary: PurchaseSummaryCache = {
      totalAmount: Math.round(row?.total_amount || 0),
      totalInvoices: row?.total_invoices || 0,
      totalGst: Math.round(taxRow?.total_gst || 0)
    };

    await setSummaryCache('purchase_summary', summary);
    return summary;
  } catch (err) {
    console.error('[SummaryCacheService] Failed to rebuild purchase summary cache:', err);
    return { totalAmount: 0, totalInvoices: 0, totalGst: 0 };
  }
}

/**
 * Re-computes and caches statistics for AI Learning page.
 */
export async function rebuildLearningStatsCache(): Promise<LearningStatsCache> {
  try {
    const db = await dbManager.getConnection();
    
    const ocrRow = await db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM ocr_corrections');
    const aliasRow = await db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM medicine_aliases');
    
    const stats: LearningStatsCache = {
      activeOcrCorrections: ocrRow?.cnt || 0,
      learnedRxCombos: aliasRow?.cnt || 0,
      lastRetrainedAt: new Date().toISOString()
    };

    await setSummaryCache('learning_stats', stats);
    return stats;
  } catch (err) {
    console.error('[SummaryCacheService] Failed to rebuild learning stats cache:', err);
    return { activeOcrCorrections: 0, learnedRxCombos: 0, lastRetrainedAt: null };
  }
}

/**
 * Trigger an asynchronous background rebuild for all summary caches.
 */
export function triggerBackgroundSummaryRebuild(): void {
  queueMicrotask(() => {
    Promise.all([
      rebuildPurchaseSummaryCache(),
      rebuildLearningStatsCache()
    ]).catch(err => console.error('[SummaryCacheService] Background rebuild failed:', err));
  });
}
