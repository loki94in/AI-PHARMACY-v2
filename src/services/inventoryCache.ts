import { Database } from 'sqlite';
import { INVENTORY_ACTIVE_WHERE } from '../utils/inventoryActive.js';
import { dbManager } from '../database/connection.js';

export interface CompactInventoryItem {
  medicine_id: number;
  inventory_id: number;
  name: string;
  batch_no: string;
  expiry_date: string;
  mrp: number;
  sell_price?: number | null;
  stock_qty: number;
  loose_quantity: number;
  unit_price: number;
  cost_price: number;
  item_code: string;
  manufacturer: string;
  packaging: string;
  pack_size: number | null;
}

class InventoryCache {
  private cache: CompactInventoryItem[] | null = null;
  private lastUpdated = 0;
  private refreshInterval: NodeJS.Timeout | null = null;
  private rebuildPromise: Promise<void> | null = null;

  public initialize(db?: Database) {
    // P3 gated worker (API_OPTIMIZATION plan): registry key `bg.inventoryCache`
    // + idle backoff — 10 min rebuild while active, 30 min when user idle >30 min.
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    const tick = async () => {
      let delay = 10 * 60 * 1000;
      try {
        const { getBackendFetchMode } = await import('./dataFetchControl.js');
        const mode = await getBackendFetchMode('bg.inventoryCache', 'auto');
        if (mode === 'off') return; // stay off until next process start
        if (mode === 'manual') {
          const { activityTracker } = await import('../utils/activityTracker.js');
          if (activityTracker.isIdle()) {
            this.refreshInterval = setTimeout(tick, 5 * 60 * 1000) as unknown as NodeJS.Timeout;
            return;
          }
        } else {
          const { activityTracker } = await import('../utils/activityTracker.js');
          if (activityTracker.isIdle()) delay = 30 * 60 * 1000;
        }
      } catch (_) {}
      this.rebuild().catch(err => console.error('[InventoryCache] Background rebuild failed:', err));
      this.refreshInterval = setTimeout(tick, delay) as unknown as NodeJS.Timeout;
    };
    this.refreshInterval = setTimeout(tick, 10 * 60 * 1000) as unknown as NodeJS.Timeout;
  }

  public async get(db?: Database): Promise<CompactInventoryItem[]> {
    if (!this.cache) {
      await this.rebuild(db);
    }
    return this.cache || [];
  }

  public rebuild(db?: Database): Promise<void> {
    // Share the in-flight rebuild so concurrent get() calls wait for fresh data
    // instead of seeing a null cache and returning an empty list.
    if (this.rebuildPromise) return this.rebuildPromise;

    this.rebuildPromise = (async () => {
      try {
        const activeDb = db || await dbManager.getConnection();
        // Query essential columns for active inventory items. Limit fields to optimize memory.
        const items = await activeDb.all<CompactInventoryItem[]>(
          `SELECT
            m.id AS medicine_id,
            im.id AS inventory_id,
            m.name,
            im.batch_no,
            im.expiry_date,
            COALESCE(im.mrp, m.mrp, 0) AS mrp,
            m.sell_price,
            im.quantity AS stock_qty,
            im.loose_quantity,
            im.unit_price,
            COALESCE(im.cost_price, 0) AS cost_price,
            m.item_code,
            m.manufacturer,
            m.packaging,
            m.pack_size
           FROM inventory_master im
           JOIN medicines m ON im.medicine_id = m.id
           WHERE ${INVENTORY_ACTIVE_WHERE}
           ORDER BY m.name ASC, im.expiry_date ASC`
        );

        this.cache = items;
        this.lastUpdated = Date.now();
      } catch (err) {
        console.error('[InventoryCache] Error rebuilding cache:', err);
      } finally {
        this.rebuildPromise = null;
      }
    })();
    return this.rebuildPromise;
  }

  public invalidate(): void {
    // Force rebuild next time get() is called
    this.cache = null;
    this.lastUpdated = 0;
    this.rebuild().catch(err => console.error('[InventoryCache] On-demand rebuild failed:', err));
  }
}

export const inventoryCache = new InventoryCache();

