import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';

export interface CompactInventoryItem {
  medicine_id: number;
  inventory_id: number;
  name: string;
  batch_no: string;
  expiry_date: string;
  mrp: number;
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
    // Set up periodic background refresh every 10 minutes
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.refreshInterval = setInterval(() => {
      this.rebuild().catch(err => console.error('[InventoryCache] Background rebuild failed:', err));
    }, 10 * 60 * 1000);
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
           WHERE (im.quantity > 0 OR im.loose_quantity > 0) AND (im.expiry_date IS NULL OR 
             CASE 
               WHEN length(im.expiry_date) = 5 THEN ('20' || substr(im.expiry_date, 4, 2) || '-' || substr(im.expiry_date, 1, 2))
               WHEN length(im.expiry_date) = 7 THEN (substr(im.expiry_date, 4, 4) || '-' || substr(im.expiry_date, 1, 2))
               WHEN im.expiry_date LIKE '____-__%' THEN substr(im.expiry_date, 1, 7)
               ELSE im.expiry_date
             END >= strftime('%Y-%m', 'now')
           )
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

