import express from 'express';
import { inventoryService } from '../services/inventoryService.js';
import { inventoryCache } from '../services/inventoryCache.js';
import { dbManager } from '../database/connection.js';
import { cacheService } from '../services/cacheService.js';
import { parsePackSizeFromPackaging } from '../utils/packaging.js';
import { eventService } from '../services/eventService.js';

import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

// P1 push event (API_OPTIMIZATION plan): any successful non-GET mutation on this
// router broadcasts `inventory_changed` so UIs (Inventory/POS/Dashboard) update
// without polling. Covers all current AND future endpoints on this router.
router.use((req, res, next) => {
  if (req.method !== 'GET') {
    const origJson = res.json.bind(res);
    (res as any).json = (body: any) => {
      try {
        if (res.statusCode < 400 && body && typeof body === 'object' && body.success) {
          eventService.broadcast('inventory_changed', { reason: 'manual_edit', method: req.method, path: req.path });
          if (!req.path.startsWith('/bulk-sell-prices')) {
            // sell-price edits don't touch expiry data; stock/expiry edits do
            if (['/override', '/bulk-action'].includes(req.path)) {
              eventService.broadcast('expiry_list_changed', { reason: 'inventory_edit' });
            }
          }
        }
      } catch (_) {}
      return origJson(body);
    };
  }
  next();
});

// Helper to normalize numeric search terms (e.g., stripping trailing decimal zeros like "31.00" -> "31")
// to align with SQLite CAST(value AS TEXT) representations.
const normalizeNumericSearch = (val: string): string => {
  const cleaned = val.trim();
  if (!cleaned) return '';
  // If it's a decimal number, parse it to strip trailing zeros (e.g., 31.00 -> 31, 31.50 -> 31.5)
  if (/^\d+\.\d+$/.test(cleaned)) {
    return String(parseFloat(cleaned));
  }
  // If it ends with a dot, strip it (e.g., 31. -> 31)
  if (/^\d+\.$/.test(cleaned)) {
    return cleaned.slice(0, -1);
  }
  return cleaned;
};

// Cached COUNT(*) for GET /api/inventory — counting the full inventory×medicines join on
// every keystroke/page-switch was a top latency source. Keyed by filter signature,
// short TTL + explicit invalidation on inventory writes (see database/connection.ts).
const INVENTORY_COUNT_TTL_MS = 60_000;
const inventoryCountCache = new Map<string, { total: number; ts: number }>();

/** Called by the DB write interceptor whenever inventory_master changes. */
export function invalidateInventoryCountCache() {
  inventoryCountCache.clear();
}

// Get inventory master
router.get('/', async (req, res) => {
  let db;
  const page = parseInt(req.query.page as string) || 1;
  const search = (req.query.search as string || '').trim();
  
  const medicine = (req.query.medicine as string || '').trim();
  const id = (req.query.id as string || '').trim();
  const batch = (req.query.batch as string || '').trim();
  const expiry = (req.query.expiry as string || '').trim();
  const packs = (req.query.packs as string || '').trim();
  const loose = (req.query.loose as string || '').trim();
  const mrp = (req.query.mrp as string || '').trim();
  const rack = (req.query.rack as string || '').trim();
  const stock_filter = (req.query.stock_filter as string || '').trim();

  const hasFilters = !!(search || medicine || id || batch || expiry || packs || loose || mrp || rack || stock_filter);
  const limit = req.query.limit !== undefined 
    ? parseInt(req.query.limit as string) 
    : (hasFilters ? 200 : 100);
  
  try {
    db = await dbManager.getConnection();
    
    let baseQuery = `
      FROM inventory_master im
      LEFT JOIN medicines m ON im.medicine_id = m.id
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (search) {
      baseQuery += ` AND (m.name LIKE ? OR m.item_code = ? OR im.batch_no LIKE ?)`;
      params.push(`%${search}%`, search, `%${search}%`);
    }
    if (medicine) {
      baseQuery += ` AND m.name LIKE ?`;
      params.push(`%${medicine}%`);
    }
    if (batch) {
      baseQuery += ` AND im.batch_no LIKE ?`;
      params.push(`%${batch}%`);
    }
    if (expiry) {
      baseQuery += ` AND im.expiry_date LIKE ?`;
      params.push(`%${expiry}%`);
    }
    if (packs) {
      const numVal = parseInt(packs, 10);
      if (!isNaN(numVal)) {
        baseQuery += ` AND im.quantity = ?`;
        params.push(numVal);
      }
    }
    if (loose) {
      const numVal = parseInt(loose, 10);
      if (!isNaN(numVal)) {
        baseQuery += ` AND im.loose_quantity = ?`;
        params.push(numVal);
      }
    }
    if (mrp) {
      const numVal = parseFloat(mrp);
      if (!isNaN(numVal)) {
        baseQuery += ` AND im.mrp = ?`;
        params.push(numVal);
      }
    }
    if (rack) {
      baseQuery += ` AND im.rack_location LIKE ?`;
      params.push(`%${rack}%`);
    }
    if (id) {
      const numVal = parseInt(id, 10);
      if (!isNaN(numVal)) {
        baseQuery += ` AND im.id = ?`;
        params.push(numVal);
      }
    }

    if (stock_filter === 'zero') {
      baseQuery += ` AND im.quantity = 0 AND im.loose_quantity = 0`;
    } else if (stock_filter === 'negative') {
      baseQuery += ` AND (im.quantity < 0 OR im.loose_quantity < 0)`;
    } else if (stock_filter === 'positive') {
      baseQuery += ` AND COALESCE(im.is_active, 1) = 1 AND (im.quantity > 0 OR im.loose_quantity > 0)`;
    }
    
    // If limit is 0, fetch all (warning: can cause frontend lag)
    if (limit === 0) {
      const rows = await db.all(`
        SELECT im.*, 
               COALESCE(m.name, 'Unlinked Batch (' || COALESCE(im.batch_no, 'No Batch') || ')') as name, 
               COALESCE(m.name, 'Unlinked Batch (' || COALESCE(im.batch_no, 'No Batch') || ')') as medicine_name, 
               im.batch_no as batch_number, 
               im.quantity as stock_quantity,
               m.item_code as item_code,
               m.sell_price as sell_price,
               m.cgst_per as cgst_per,
               m.sgst_per as sgst_per,
               m.pack_size as pack_size
        ${baseQuery}
        ORDER BY COALESCE(m.name, im.batch_no) ASC, im.id DESC
      `, params);
      return res.json({ data: rows, totalPages: 1, currentPage: 1, totalItems: rows.length });
    }

    // Pagination logic
    const offset = (page - 1) * limit;

    let totalItems: number;
    const countKey = JSON.stringify([search, medicine, id, batch, expiry, packs, loose, mrp, rack, stock_filter]);
    const cachedCount = inventoryCountCache.get(countKey);
    if (cachedCount && Date.now() - cachedCount.ts < INVENTORY_COUNT_TTL_MS) {
      totalItems = cachedCount.total;
    } else {
      const countRow = await db.get(`SELECT COUNT(*) as total ${baseQuery}`, params);
      totalItems = countRow.total;
      inventoryCountCache.set(countKey, { total: totalItems, ts: Date.now() });
    }
    const totalPages = Math.ceil(totalItems / limit);

    const rows = await db.all(`
      SELECT im.*, 
             COALESCE(m.name, 'Unlinked Batch (' || COALESCE(im.batch_no, 'No Batch') || ')') as name, 
             COALESCE(m.name, 'Unlinked Batch (' || COALESCE(im.batch_no, 'No Batch') || ')') as medicine_name, 
             im.batch_no as batch_number, 
             im.quantity as stock_quantity,
             m.item_code as item_code,
             m.sell_price as sell_price,
             m.cgst_per as cgst_per,
             m.sgst_per as sgst_per,
             m.pack_size as pack_size
      ${baseQuery}
      ORDER BY COALESCE(m.name, im.batch_no) ASC, im.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({
      data: rows,
      totalPages,
      currentPage: page,
      totalItems
    });
  } catch (error: any) {
    if (db)     console.error(JSON.stringify({
      message: 'Error fetching inventory',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update stock (Stock Override)
router.post('/override', async (req, res) => {
  let db;
  try {
    const { inventory_id, quantity, reason } = req.body;
    if (!inventory_id) {
      return res.status(400).json({ error: 'inventory_id required' });
    }
    if (typeof quantity !== 'number' || quantity < 0) {
      return res.status(400).json({ error: 'quantity must be a non-negative number' });
    }
    if (!reason || reason.trim() === '') {
      return res.status(400).json({ error: 'reason is required for stock override' });
    }
    db = await dbManager.getConnection();
    await db.run('UPDATE inventory_master SET quantity = ? WHERE id = ?', [quantity, inventory_id]);
    
    await db.run(
      `INSERT INTO action_logs (action_type, description) VALUES ('STOCK_OVERRIDE', ?)`,
      [`Override stock for inventory_id ${inventory_id} to ${quantity}. Reason: ${reason}`]
    );

    // Check if new stock triggers pending patient refills
    const invItem = await db.get('SELECT medicine_id FROM inventory_master WHERE id = ?', [inventory_id]);
    if (invItem && invItem.medicine_id) {
      await inventoryService.checkAndTriggerRefillsForMedicine(invItem.medicine_id);
    }

    inventoryCache.invalidate();
        res.json({ success: true, message: 'Stock updated' });
  } catch (error: any) {
    if (db)     console.error(JSON.stringify({
      message: 'Error overriding stock',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Smart-Hover Peek (Price Comparison Logs)
router.get('/peek/:medicine_id', async (req, res) => {
  let db;
  try {
    const { medicine_id } = req.params;
    if (!medicine_id) {
      return res.status(400).json({ error: 'medicine_id is required' });
    }
    db = await dbManager.getConnection();
    // Simplified: return last purchase price from purchases table joined via inventory_master
    const rows = await db.all(
      `SELECT im.id, im.batch_no, im.expiry_date, im.quantity, im.unit_price, im.cost_price
       FROM inventory_master im
       WHERE im.medicine_id = ?
       ORDER BY im.expiry_date ASC LIMIT 5`,
      [medicine_id]
    );

        res.json(rows);
  } catch (error: any) {
    if (db)     console.error(JSON.stringify({
      message: 'Error fetching peek data',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  let db;
  const { id } = req.params;
  const { quantity, rack_location, batch_no, expiry_date, reorder_level, name, mrp, loose_quantity, pack_size, sell_price } = req.body;
  const qtyVal = quantity !== undefined ? quantity : req.body.stock_quantity;
  const batchNoVal = batch_no !== undefined ? batch_no : req.body.batch_number;
  try {
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    const oldInv = await db.get('SELECT * FROM inventory_master WHERE id = ?', [id]);
    if (!oldInv) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Inventory record not found' });
    }

    // 1. Update inventory_master fields dynamically
    const updates = [];
    const params = [];
    if (qtyVal !== undefined) { updates.push('quantity = ?'); params.push(qtyVal); }
    if (rack_location !== undefined) { updates.push('rack_location = ?'); params.push(rack_location); }
    if (batchNoVal !== undefined) { updates.push('batch_no = ?'); params.push(batchNoVal); }
    if (expiry_date !== undefined) { updates.push('expiry_date = ?'); params.push(expiry_date); }
    if (reorder_level !== undefined) { updates.push('reorder_level = ?'); params.push(reorder_level); }
    if (mrp !== undefined) { updates.push('mrp = ?'); params.push(mrp); }
    if (loose_quantity !== undefined) { updates.push('loose_quantity = ?'); params.push(loose_quantity); }

    if (updates.length > 0) {
      params.push(id);
      await db.run(`UPDATE inventory_master SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // 2. Keep purchase_items in sync if batch, expiry, or mrp was updated
    if (batchNoVal !== undefined || expiry_date !== undefined || mrp !== undefined) {
      const piUpdates = [];
      const piParams = [];
      if (batchNoVal !== undefined) { piUpdates.push('batch_no = ?'); piParams.push(batchNoVal); }
      if (expiry_date !== undefined) { piUpdates.push('expiry_date = ?'); piParams.push(expiry_date); }
      if (mrp !== undefined) { piUpdates.push('mrp = ?'); piParams.push(mrp); }

      if (piUpdates.length > 0) {
        piParams.push(oldInv.medicine_id, oldInv.batch_no);
        await db.run(
          `UPDATE purchase_items SET ${piUpdates.join(', ')} WHERE medicine_id = ? AND batch_no = ?`,
          piParams
        );
      }
    }

    // 3. Update the medicines table if name, mrp, pack_size, or sell_price changes
    if (oldInv.medicine_id) {
      if (name !== undefined || mrp !== undefined || pack_size !== undefined || sell_price !== undefined) {
        const medUpdates = [];
        const medParams = [];
        if (name !== undefined) { medUpdates.push('name = ?'); medParams.push(name); }
        if (mrp !== undefined) { medUpdates.push('mrp = ?'); medParams.push(mrp); }
        if (pack_size !== undefined) { medUpdates.push('pack_size = ?'); medParams.push(parseInt(pack_size, 10) || null); }
        if (sell_price !== undefined) {
          const parsedPrice = (sell_price !== null && sell_price !== '' && !isNaN(Number(sell_price))) ? parseFloat(sell_price) : null;
          medUpdates.push('sell_price = ?');
          medParams.push(parsedPrice);
        }

        if (medUpdates.length > 0) {
          medParams.push(oldInv.medicine_id);
          await db.run(`UPDATE medicines SET ${medUpdates.join(', ')} WHERE id = ?`, medParams);
        }
      }

      await inventoryService.checkAndTriggerRefillsForMedicine(oldInv.medicine_id);
    }

    await db.run('COMMIT');
    inventoryCache.invalidate();

    res.json({ success: true, message: 'Inventory updated and synced across unified storage' });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Inventory update error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Bulk update sell prices for multiple medicines
router.post('/bulk-sell-prices', async (req, res) => {
  let db;
  try {
    const { items = [] } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    for (const item of items) {
      const { medicine_id, sell_price } = item;
      if (!medicine_id) continue;
      const parsedPrice = (sell_price !== null && sell_price !== '' && sell_price !== undefined && !isNaN(Number(sell_price)))
        ? parseFloat(sell_price)
        : null;
      await db.run('UPDATE medicines SET sell_price = ? WHERE id = ?', [parsedPrice, medicine_id]);
    }

    await db.run('COMMIT');
    inventoryCache.invalidate();
    res.json({ success: true, message: 'Bulk sell prices updated successfully' });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Bulk sell prices update error:', error);
    res.status(500).json({ error: error.message || 'Failed to update sell prices' });
  }
});

router.delete('/:id', async (req, res) => {
  let db;
  const { id } = req.params;
  try {
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    const invItem = await db.get('SELECT * FROM inventory_master WHERE id = ?', [id]);
    if (!invItem) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    await db.run('DELETE FROM inventory_master WHERE id = ?', [id]);

    await db.run(
      `INSERT INTO action_logs (action_type, description) VALUES ('INVENTORY_DELETE', ?)`,
      [`Deleted inventory_master record ID ${id} (Medicine ID: ${invItem.medicine_id}, Batch: ${invItem.batch_no}, Qty: ${invItem.quantity})`]
    );

    await db.run('COMMIT');
    inventoryCache.invalidate();

    res.json({ success: true, message: 'Inventory item deleted successfully' });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Inventory delete error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
router.post('/bulk-action', async (req, res) => {
  let db;
  const { action, ids = [] } = req.body;
  try {
    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    db = await dbManager.getConnection();
    // Log the bulk action to action_logs using the correct schema
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      [`BULK_${(action as string).toUpperCase()}`, `Bulk ${action} on ${ids.length} inventory items: [${(ids as any[]).join(',')}]`]
    );

        res.json({ success: true, message: `Bulk ${action} completed and logged` });
  } catch (error: any) {
    if (db)     console.error(JSON.stringify({
      message: 'Bulk action error',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new medicine and inventory batch
router.post('/', async (req, res) => {
  const { name, api_reference, mrp, cost_price, batch_no, expiry_date, quantity, rack_location, category } = req.body;
  if (!name) return res.status(400).json({ error: 'Medicine name is required' });
  
  let db;
  try {
    db = await dbManager.getConnection();
    
    // 1. Check duplicate and insert/retrieve medicine record
    const cleanName = name.trim();
    let dbMed = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [cleanName]);
    let medicineId;
    if (dbMed) {
      medicineId = dbMed.id;
      // Optionally update details if they are provided, e.g. api_reference, mrp, category
      await db.run(
        'UPDATE medicines SET api_reference = COALESCE(NULLIF(api_reference, ""), ?), mrp = COALESCE(NULLIF(mrp, 0), ?), category = COALESCE(NULLIF(category, ""), ?) WHERE id = ?',
        [api_reference || '', parseFloat(mrp) || 0, category || '', medicineId]
      );
    } else {
      const medResult = await db.run(
        'INSERT INTO medicines (name, api_reference, mrp, category) VALUES (?, ?, ?, ?)',
        [cleanName, api_reference || '', parseFloat(mrp) || 0, category || '']
      );
      medicineId = medResult.lastID;
    }
    
    // Do NOT auto-create dummy inventory_master records.
    // Stock is only created when an actual purchase is recorded through the Purchases workflow.
    inventoryCache.invalidate();
    res.json({
      success: true,
      message: 'Medicine registered successfully',
      medicine_id: medicineId
    });
  } catch (error: any) {
    console.error('Failed to create medicine:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Save a custom medicine alias (distributor name mapping)
router.post('/medicines/alias', async (req, res) => {
  const { alias_name, medicine_id } = req.body;
  if (!alias_name || !medicine_id) {
    return res.status(400).json({ error: 'alias_name and medicine_id are required' });
  }
  let db;
  try {
    db = await dbManager.getConnection();
    await db.run(
      'INSERT OR IGNORE INTO medicine_aliases (alias_name, medicine_id) VALUES (?, ?)',
      [alias_name, medicine_id]
    );
        res.json({ success: true, message: 'Alias saved successfully' });
  } catch (error: any) {
    console.error('Save alias error:', error.message);
    res.status(500).json({ error: 'Failed to save alias' });
  }
});

// Catalog search for auto-suggest in Manual Purchase Entry
router.get('/catalog-search', async (req, res) => {
  let db;
  try {
    const q = (req.query.q as string || '').trim();
    db = await dbManager.getConnection();

    if (!q || q.length < 2) {
      // Empty or 1-char query: return a seed slice of master medicines for the
      // Purchases page's module-cache pre-hydration (instant local list before
      // the first debounced query lands).
      const defaultRows = await db.all(
        `SELECT id, name, item_code, manufacturer, strength, packaging, pack_unit, mrp, rate, cgst_per, sgst_per, hsn_code, generic_name
         FROM medicines
         ORDER BY name ASC LIMIT 150`
      );
      return res.json(defaultRows);
    }

    const prefixQ = `${q}%`;
    const likeQ = `%${q}%`;
    
    // Pass 1: Prefix match on name & aliases (utilizes idx_medicines_name index range scan)
    const prefixRows = await db.all(
      `SELECT id, name, item_code, manufacturer, strength, packaging, pack_unit, mrp, rate, cgst_per, sgst_per, hsn_code, generic_name
       FROM medicines
       WHERE name LIKE ?
       UNION ALL
       SELECT m.id, m.name, m.item_code, m.manufacturer, m.strength, m.packaging, m.pack_unit, m.mrp, m.rate, m.cgst_per, m.sgst_per, m.hsn_code, m.generic_name
       FROM medicine_aliases a
       JOIN medicines m ON a.medicine_id = m.id
       WHERE a.alias_name LIKE ?
       ORDER BY name ASC LIMIT 30`,
      [prefixQ, prefixQ]
    );

    const rows: any[] = [];
    const seenIds = new Set<number>();
    
    for (const r of prefixRows) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        rows.push(r);
      }
    }

    // Pass 2: Containment match on name & aliases if needed
    if (rows.length < 30) {
      const containmentRows = await db.all(
        `SELECT id, name, item_code, manufacturer, strength, packaging, pack_unit, mrp, rate, cgst_per, sgst_per, hsn_code, generic_name
         FROM medicines
         WHERE name LIKE ?
         UNION ALL
         SELECT m.id, m.name, m.item_code, m.manufacturer, m.strength, m.packaging, m.pack_unit, m.mrp, m.rate, m.cgst_per, m.sgst_per, m.hsn_code, m.generic_name
         FROM medicine_aliases a
         JOIN medicines m ON a.medicine_id = m.id
         WHERE a.alias_name LIKE ?
         ORDER BY name ASC LIMIT 30`,
        [likeQ, likeQ]
      );
      for (const r of containmentRows) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          rows.push(r);
          if (rows.length >= 30) break;
        }
      }
    }

    // Pass 3: Secondary fields if still < 30 results
    if (rows.length < 30) {
      const needed = 30 - rows.length;
      const secondaryRows = await db.all(
        `SELECT id, name, item_code, manufacturer, strength, packaging, pack_unit, mrp, rate, cgst_per, sgst_per, hsn_code, generic_name
         FROM medicines
         WHERE api_reference LIKE ? OR item_code LIKE ? OR manufacturer LIKE ? OR generic_name LIKE ?
         ORDER BY name ASC LIMIT ?`,
        [likeQ, likeQ, likeQ, likeQ, needed]
      );
      for (const r of secondaryRows) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          rows.push(r);
          if (rows.length >= 30) break;
        }
      }
    }

    if (rows.length > 0) {
      const idsArr = Array.from(seenIds);
      const placeholders = idsArr.map(() => '?').join(',');
      const stockRows = await db.all(
        `SELECT medicine_id, COALESCE(SUM(quantity), 0) as stock_qty, COALESCE(SUM(loose_quantity), 0) as loose_qty
         FROM inventory_master
         WHERE medicine_id IN (${placeholders})
         GROUP BY medicine_id`,
        idsArr
      ).catch(() => []);
      const stockMap = new Map<number, { stock_qty: number; loose_qty: number }>();
      for (const s of stockRows) {
        stockMap.set(s.medicine_id, { stock_qty: s.stock_qty, loose_qty: s.loose_qty });
      }
      for (const r of rows) {
        const s = stockMap.get(r.id);
        r.stock_qty = s ? s.stock_qty : 0;
        r.loose_qty = s ? s.loose_qty : 0;
      }

      // Purchases-dropdown contract (owner request): ONE row per medicine NAME.
      // The 291k master catalog still contains a handful of legacy duplicate
      // name groups (different ids, identical names) — collapse them here so
      // the dropdown never shows the same medicine twice. Preference: in-stock
      // row wins, then the lower id (oldest canonical record).
      const byName = new Map<string, any>();
      const collapsed: any[] = [];
      for (const r of rows) {
        const key = String(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const existing = byName.get(key);
        if (!existing) {
          byName.set(key, r);
          collapsed.push(r);
          continue;
        }
        const eStock = ((existing.stock_qty as number) || 0) + ((existing.loose_qty as number) || 0);
        const rStock = ((r.stock_qty as number) || 0) + ((r.loose_qty as number) || 0);
        const winner = (rStock > 0 && eStock <= 0) ? r : (r.id < existing.id ? r : existing);
        if (winner === r) {
          byName.set(key, r);
          collapsed.splice(collapsed.indexOf(existing), 1, r);
        }
      }
      rows.length = 0;
      rows.push(...collapsed);
    }

    res.json(rows);
  } catch (error: any) {
    console.error('Catalog search error:', error.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /inventory/batch-info - Fetch batch info for a medicine and auto-fill rate, MRP, expiry, and GST
router.get('/batch-info', async (req, res) => {
  let db;
  try {
    const medicine_id = req.query.medicine_id ? parseInt(req.query.medicine_id as string, 10) : null;
    const batch_no = (req.query.batch_no as string || '').trim();

    if (!medicine_id || !batch_no) {
      return res.status(400).json({ error: 'medicine_id and batch_no are required' });
    }

    db = await dbManager.getConnection();

    const batchRow = await db.get(
      `SELECT im.batch_no, im.expiry_date, im.cost_price as rate, im.mrp, m.cgst_per, m.sgst_per
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE im.medicine_id = ? AND LOWER(im.batch_no) = LOWER(?)
       ORDER BY im.id DESC LIMIT 1`,
      [medicine_id, batch_no]
    );

    const medRow = await db.get('SELECT rate, mrp, cgst_per, sgst_per FROM medicines WHERE id = ?', [medicine_id]);

    const defaultCgst = (medRow?.cgst_per !== undefined && medRow?.cgst_per !== null && medRow?.cgst_per !== 0) ? medRow.cgst_per : 6;
    const defaultSgst = (medRow?.sgst_per !== undefined && medRow?.sgst_per !== null && medRow?.sgst_per !== 0) ? medRow.sgst_per : 6;

    if (batchRow) {
      return res.json({
        found: true,
        batch_no: batchRow.batch_no,
        expiry_date: batchRow.expiry_date,
        rate: batchRow.rate || medRow?.rate || 0,
        mrp: batchRow.mrp || medRow?.mrp || 0,
        cgst_per: (batchRow.cgst_per !== undefined && batchRow.cgst_per !== null && batchRow.cgst_per !== 0) ? batchRow.cgst_per : defaultCgst,
        sgst_per: (batchRow.sgst_per !== undefined && batchRow.sgst_per !== null && batchRow.sgst_per !== 0) ? batchRow.sgst_per : defaultSgst
      });
    }

    return res.json({
      found: false,
      rate: medRow?.rate || 0,
      mrp: medRow?.mrp || 0,
      cgst_per: defaultCgst,
      sgst_per: defaultSgst
    });
  } catch (error) {
    console.error('Fetch batch info error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Generate QR Code for an inventory item (Barcode/QR feature)
import QRCode from 'qrcode';
router.get('/barcode/:id', async (req, res) => {
  let db;
  try {
    const { id } = req.params;
    db = await dbManager.getConnection();
    
    // Fetch medicine and inventory details
    const item = await db.get(`
      SELECT im.*, m.name as medicine_name 
      FROM inventory_master im
      LEFT JOIN medicines m ON im.medicine_id = m.id
      WHERE im.id = ?
    `, [id]);
    
        
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Prepare barcode/QR data
    const qrData = JSON.stringify({
      id: item.id,
      name: item.medicine_name,
      batch: item.batch_no,
      exp: item.expiry_date,
      mrp: item.mrp
    });

    // Generate base64 Data URL for the QR code
    const qrImage = await QRCode.toDataURL(qrData, { width: 150, margin: 1 });
    
    res.json({
      success: true,
      qrCodeUrl: qrImage,
      item: {
        name: item.medicine_name,
        batch: item.batch_no,
        expiry: item.expiry_date,
        mrp: item.mrp
      }
    });

  } catch (error: any) {
    console.error('QR code generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR Code' });
  }
});

// Fetch enriched medicine information by ID (returns active ingredients, side effects, warnings, etc.)
router.get('/medicines/:id/enriched', async (req, res) => {
  let db;
  const { id } = req.params;
  try {
    db = await dbManager.getConnection();
    
    // Find the medicine brand name
    const medicine = await db.get('SELECT name, api_reference, manufacturer FROM medicines WHERE id = ?', [id]);
    if (!medicine) {
            return res.status(404).json({ error: 'Medicine not found' });
    }

    // Lookup matching entry in enrichment cache safely via cacheService
    const enrichment = await cacheService.get(medicine.name);

    res.json({
      success: true,
      medicineName: medicine.name,
      api_reference: medicine.api_reference,
      manufacturer: medicine.manufacturer,
      enrichment: enrichment || {
        isEnriched: false,
        activeIngredients: medicine.api_reference ? [medicine.api_reference] : [],
        indications: 'No detailed online indications found yet.',
        dosage: 'No custom dosage metadata cached.',
        sideEffects: 'No active side effects logged.',
        warnings: 'No standard warnings recorded.',
        enrichmentSource: 'Local Database'
      }
    });

  } catch (error: any) {
    console.error('Error fetching enriched medicine details:', error);
    res.status(500).json({ error: 'Failed to fetch enriched medicine details' });
  }
});

// Universal Medicine Quick Edit - GET Details
router.get('/medicines/:id/quick-edit', async (req, res) => {
  let db;
  const { id } = req.params;
  try {
    db = await dbManager.getConnection();
    
    // Fetch medicine details, primary inventory, and total stock in parallel
    const [medicine, invPrimary, stockRow] = await Promise.all([
      db.get('SELECT * FROM medicines WHERE id = ?', [id]),
      db.get(`
        SELECT id as inventory_id, quantity, rack_location, batch_no, expiry_date 
        FROM inventory_master 
        WHERE medicine_id = ? 
        ORDER BY quantity DESC LIMIT 1
      `, [id]),
      db.get(`SELECT SUM(quantity) as total_stock FROM inventory_master WHERE medicine_id = ?`, [id])
    ]);

    if (!medicine) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    const total_stock = stockRow?.total_stock || 0;

    
    res.json({
      success: true,
      medicine,
      inventory: invPrimary || {},
      total_stock
    });

  } catch (error: any) {
    console.error('Error fetching quick-edit medicine details:', error);
    res.status(500).json({ error: 'Failed to fetch quick-edit details' });
  }
});

// Universal Medicine Quick Edit - PUT Update
router.put('/medicines/:id/quick-edit', async (req, res) => {
  let db;
  const { id } = req.params;
  const { 
    name, generic_name, manufacturer, marketed_by, 
    packaging, pack_unit, item_code, category, api_reference,
    inventory_id, quantity, rack_location, hsn_code,
    item_type, therapeutic, sub_therapeutic, schedule_type,
    short_code, ucode, cgst_per, sgst_per, igst_per,
    reorder_level, max_stock_level, rack, disable_auto_barcode, tb_medicine,
    sell_price, metadata, allow_loose_sale
  } = req.body;
  
  try {
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');
 
    // 1. Update medicines table (up to 24 fields)
    const updates = [];
    const params = [];
    
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (generic_name !== undefined) { updates.push('generic_name = ?'); params.push(generic_name); }
    if (manufacturer !== undefined) { updates.push('manufacturer = ?'); params.push(manufacturer); }
    if (marketed_by !== undefined) { updates.push('marketed_by = ?'); params.push(marketed_by); }
    if (packaging !== undefined) { 
      updates.push('packaging = ?'); 
      params.push(packaging); 
      const parsedSize = parsePackSizeFromPackaging(packaging);
      if (parsedSize !== null) {
        updates.push('pack_size = ?');
        params.push(parsedSize);
      }
    }
    if (pack_unit !== undefined) { updates.push('pack_unit = ?'); params.push(pack_unit); }
    if (item_code !== undefined) { updates.push('item_code = ?'); params.push(item_code); }
    if (category !== undefined) { updates.push('category = ?'); params.push(category); }
    if (api_reference !== undefined) { updates.push('api_reference = ?'); params.push(api_reference); }
    if (hsn_code !== undefined) { updates.push('hsn_code = ?'); params.push(hsn_code); }
    if (item_type !== undefined) { updates.push('item_type = ?'); params.push(item_type); }
    if (therapeutic !== undefined) { updates.push('therapeutic = ?'); params.push(therapeutic); }
    if (sub_therapeutic !== undefined) { updates.push('sub_therapeutic = ?'); params.push(sub_therapeutic); }
    if (schedule_type !== undefined) { updates.push('schedule_type = ?'); params.push(schedule_type); }
    if (short_code !== undefined) { updates.push('short_code = ?'); params.push(short_code); }
    if (ucode !== undefined) { updates.push('ucode = ?'); params.push(ucode); }
    if (cgst_per !== undefined) { updates.push('cgst_per = ?'); params.push(parseFloat(cgst_per) || 0); }
    if (sgst_per !== undefined) { updates.push('sgst_per = ?'); params.push(parseFloat(sgst_per) || 0); }
    if (igst_per !== undefined) { updates.push('igst_per = ?'); params.push(parseFloat(igst_per) || 0); }
    if (allow_loose_sale !== undefined) { updates.push('allow_loose_sale = ?'); params.push(allow_loose_sale ? 1 : 0); }
    if (max_stock_level !== undefined) { updates.push('max_stock_level = ?'); params.push(parseInt(max_stock_level, 10) || null); }
    if (rack !== undefined) { updates.push('rack = ?'); params.push(rack); }
    if (disable_auto_barcode !== undefined) { updates.push('disable_auto_barcode = ?'); params.push(disable_auto_barcode ? 1 : 0); }
    if (tb_medicine !== undefined) { updates.push('tb_medicine = ?'); params.push(tb_medicine ? 1 : 0); }
    if (sell_price !== undefined) {
      const parsedPrice = (sell_price !== null && sell_price !== '' && !isNaN(Number(sell_price))) ? parseFloat(sell_price) : null;
      updates.push('sell_price = ?');
      params.push(parsedPrice !== null && parsedPrice > 0 ? parsedPrice : null);
    }
    if (metadata !== undefined) { updates.push('metadata = ?'); params.push(typeof metadata === 'string' ? metadata : JSON.stringify(metadata)); }
 
    if (updates.length > 0) {
      params.push(id);
      await db.run(`UPDATE medicines SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // 2. Update primary inventory record if inventory_id or inventory fields are provided
    if (inventory_id) {
      const invUpdates = [];
      const invParams = [];
      if (quantity !== undefined) { invUpdates.push('quantity = ?'); invParams.push(quantity); }
      if (rack_location !== undefined || rack !== undefined) { 
        invUpdates.push('rack_location = ?'); 
        invParams.push(rack_location !== undefined ? rack_location : rack); 
      }
      if (reorder_level !== undefined) { invUpdates.push('reorder_level = ?'); invParams.push(parseInt(reorder_level, 10) || 10); }
      
      if (invUpdates.length > 0) {
        invParams.push(inventory_id);
        await db.run(`UPDATE inventory_master SET ${invUpdates.join(', ')} WHERE id = ?`, invParams);
      }
    }

    await db.run('COMMIT');
    inventoryCache.invalidate();
    
    res.json({ success: true, message: 'Medicine universally updated across 26 fields' });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch(e) {}
    }
    console.error('Universal Medicine update error:', error);
    res.status(500).json({ error: 'Internal server error during update' });
  }
});

// Bulk Stock Overrides Sync (Remote operations mode fallback)
router.post('/sync', async (req, res) => {
  const { updates = [] } = req.body;
  if (!Array.isArray(updates)) {
    return res.status(400).json({ error: 'updates must be an array' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    let count = 0;
    for (const item of updates) {
      const { inventory_id, quantity, reason = 'Remote Admin Stock Update' } = item;
      if (!inventory_id || typeof quantity !== 'number' || quantity < 0) {
        continue;
      }

      await db.run('UPDATE inventory_master SET quantity = ? WHERE id = ?', [quantity, inventory_id]);
      
      await db.run(
        `INSERT INTO action_logs (action_type, description) VALUES ('STOCK_OVERRIDE', ?)`,
        [`Override stock for inventory_id ${inventory_id} to ${quantity}. Reason: ${reason}`]
      );

      // Check if new stock triggers pending patient refills
      const invItem = await db.get('SELECT medicine_id FROM inventory_master WHERE id = ?', [inventory_id]);
      if (invItem && invItem.medicine_id) {
        await inventoryService.checkAndTriggerRefillsForMedicine(invItem.medicine_id);
      }
      count++;
    }

    await db.run('COMMIT');
    res.json({ success: true, message: `Successfully synced ${count} stock override(s).`, count });
  } catch (error: any) {
    console.error('Failed to sync stock overrides:', error);
    res.status(500).json({ error: error.message || 'Internal server error during stock sync' });
  }
});

// Therapeutic Search Endpoint (POS fallback search)
router.get('/therapeutic-search', async (req, res) => {
  const { query } = req.query;
  if (!query || typeof query !== 'string') {
    return res.json([]);
  }
  try {
    const db = await dbManager.getConnection();
    const results = await db.all(
      `SELECT m.*, i.id as inventory_id, i.quantity, i.batch_no, i.expiry_date, i.mrp, i.rate, i.rack_location
       FROM medicines m
       LEFT JOIN inventory_master i ON i.medicine_id = m.id AND i.is_active = 1
       WHERE m.therapeutic LIKE ? OR m.sub_therapeutic LIKE ?
       ORDER BY m.name ASC LIMIT 30`,
      [`%${query.trim()}%`, `%${query.trim()}%`]
    );
    res.json(results);
  } catch (err: any) {
    console.error('Error searching by therapeutic class:', err);
    res.status(500).json({ error: 'Failed to search by therapeutic class' });
  }
});

// Pre-Calculated Background Cache Metrics Endpoint (Sub-2ms response)
router.get('/precalculated-metrics', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { low_stock_only, heavy_sell_only, limit = '100' } = req.query;

    let whereClause = '';
    const conditions: string[] = [];

    if (low_stock_only === 'true') {
      conditions.push('psm.low_stock_flag = 1');
    }
    if (heavy_sell_only === 'true') {
      conditions.push('psm.heavy_sell_flag = 1');
    }
    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    const rows = await db.all(`
      SELECT 
        psm.*,
        m.name as medicine_name,
        m.manufacturer,
        m.packaging
      FROM precalculated_stock_metrics psm
      JOIN medicines m ON m.id = psm.medicine_id
      ${whereClause}
      ORDER BY psm.burn_rate_ratio DESC, psm.updated_at DESC
      LIMIT ?
    `, [parseInt(String(limit), 10) || 100]);

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err: any) {
    console.error('Error fetching precalculated metrics:', err);
    res.status(500).json({ error: 'Failed to fetch precalculated metrics: ' + err.message });
  }
});

// Fast Cross-Page Toggle for Allow Loose Sale
router.patch('/medicines/:id/allow-loose-sale', async (req, res) => {
  try {
    const { id } = req.params;
    const { allow_loose_sale } = req.body;
    if (!id || allow_loose_sale === undefined) {
      return res.status(400).json({ error: 'id and allow_loose_sale boolean/number are required' });
    }
    const val = allow_loose_sale ? 1 : 0;
    const db = await dbManager.getConnection();
    await db.run('UPDATE medicines SET allow_loose_sale = ? WHERE id = ?', [val, id]);
    inventoryCache.invalidate();
    res.json({ success: true, medicine_id: Number(id), allow_loose_sale: val });
  } catch (err: any) {
    console.error('Error toggling allow_loose_sale:', err);
    res.status(500).json({ error: err.message || 'Failed to toggle allow_loose_sale' });
  }
});

export default router;
