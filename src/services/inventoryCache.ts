import { Database } from 'sqlite';

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
  private db: Database | null = null;
  private isRebuilding = false;

  public initialize(db: Database) {
    this.db = db;
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
      const activeDb = db || this.db;
      if (!activeDb) {
        throw new Error('[InventoryCache] Not initialized and no database provided');
      }
      await this.rebuild(activeDb);
    }
    return this.cache || [];
  }

  public async rebuild(db?: Database): Promise<void> {
    const activeDb = db || this.db;
    if (!activeDb) {
      console.warn('[InventoryCache] Cannot rebuild, no database reference');
      return;
    }

    if (this.isRebuilding) return;
    this.isRebuilding = true;

    try {
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
         WHERE (im.quantity > 0 OR im.loose_quantity > 0) AND (im.expiry_date IS NULL OR im.expiry_date >= date('now'))
         ORDER BY m.name ASC, im.expiry_date ASC`
      );

      this.cache = items;
      this.lastUpdated = Date.now();
    } catch (err) {
      console.error('[InventoryCache] Error rebuilding cache:', err);
    } finally {
      this.isRebuilding = false;
    }
  }

  public invalidate(): void {
    // Force rebuild next time get() is called
    this.cache = null;
    this.lastUpdated = 0;
    if (this.db) {
      this.rebuild().catch(err => console.error('[InventoryCache] On-demand rebuild failed:', err));
    }
  }
}

export const inventoryCache = new InventoryCache();
