import express from 'express';
import { inventoryService } from '../services/inventoryService.js';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

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

// Get inventory master
router.get('/', async (req, res) => {
  let db;
  const page = parseInt(req.query.page as string) || 1;
  const search = (req.query.search as string || '').trim();
  
  const medicine = (req.query.medicine as string || '').trim();
  const batch = (req.query.batch as string || '').trim();
  const expiry = (req.query.expiry as string || '').trim();
  const packs = (req.query.packs as string || '').trim();
  const loose = (req.query.loose as string || '').trim();
  const mrp = (req.query.mrp as string || '').trim();
  const rack = (req.query.rack as string || '').trim();

  const hasFilters = !!(search || medicine || batch || expiry || packs || loose || mrp || rack);
  const limit = req.query.limit !== undefined 
    ? parseInt(req.query.limit as string) 
    : (hasFilters ? 5000 : 100);
  
  try {
    db = await dbManager.getConnection();
    
    let baseQuery = `
      FROM inventory_master im
      LEFT JOIN medicines m ON im.medicine_id = m.id
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (search) {
      baseQuery += ` AND (m.name LIKE ? OR im.batch_no LIKE ? OR m.item_code LIKE ? OR im.rack_location LIKE ? OR m.api_reference LIKE ? OR m.generic_name LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s);
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
      baseQuery += ` AND CAST(im.quantity AS TEXT) LIKE ?`;
      params.push(`%${normalizeNumericSearch(packs)}%`);
    }
    if (loose) {
      baseQuery += ` AND CAST(im.loose_quantity AS TEXT) LIKE ?`;
      params.push(`%${normalizeNumericSearch(loose)}%`);
    }
    if (mrp) {
      baseQuery += ` AND CAST(im.mrp AS TEXT) LIKE ?`;
      params.push(`%${normalizeNumericSearch(mrp)}%`);
    }
    if (rack) {
      baseQuery += ` AND im.rack_location LIKE ?`;
      params.push(`%${rack}%`);
    }
    
    // If limit is 0, fetch all (warning: can cause frontend lag)
    if (limit === 0) {
      const rows = await db.all(`
        SELECT im.*, 
               m.name as name, 
               m.name as medicine_name, 
               im.batch_no as batch_number, 
               im.quantity as stock_quantity, 
               m.item_code as item_code
        ${baseQuery}
        ORDER BY m.name ASC, im.id DESC
      `, params);
      return res.json({ data: rows, totalPages: 1, currentPage: 1, totalItems: rows.length });
    }

    // Pagination logic
    const offset = (page - 1) * limit;
    
    const countRow = await db.get(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const totalItems = countRow.total;
    const totalPages = Math.ceil(totalItems / limit);

    const rows = await db.all(`
      SELECT im.*, 
             m.name as name, 
             m.name as medicine_name, 
             im.batch_no as batch_number, 
             im.quantity as stock_quantity, 
             m.item_code as item_code
      ${baseQuery}
      ORDER BY m.name ASC, im.id DESC
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
  const { quantity, rack_location, batch_no, expiry_date, reorder_level, name, mrp, loose_quantity } = req.body;
  const qtyVal = quantity !== undefined ? quantity : req.body.stock_quantity;
  const batchNoVal = batch_no !== undefined ? batch_no : req.body.batch_number;
  try {
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    db = await dbManager.getConnection();
    
    // 1. Update inventory_master fields
    await db.run(
      `UPDATE inventory_master 
       SET quantity = ?, rack_location = ?, batch_no = ?, expiry_date = ?, reorder_level = ?, mrp = ?, loose_quantity = ? 
       WHERE id = ?`,
      [qtyVal, rack_location, batchNoVal, expiry_date, reorder_level, mrp, loose_quantity, id]
    );

    // 2. Fetch the medicine_id associated with this inventory record
    const invItem = await db.get('SELECT medicine_id FROM inventory_master WHERE id = ?', [id]);
    
    // 3. Update the medicines table if name or mrp changes
    if (invItem && invItem.medicine_id) {
      if (name !== undefined || mrp !== undefined) {
        const updates = [];
        const params = [];
        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (mrp !== undefined) { updates.push('mrp = ?'); params.push(mrp); }
        
        if (updates.length > 0) {
          params.push(invItem.medicine_id);
          await db.run(`UPDATE medicines SET ${updates.join(', ')} WHERE id = ?`, params);
        }
      }
      
      // Check if new stock triggers pending patient refills
      await inventoryService.checkAndTriggerRefillsForMedicine(invItem.medicine_id);
    }

        res.json({ success: true, message: 'Inventory updated' });
  } catch (error: any) {
    if (db)     console.error(JSON.stringify({
      message: 'Inventory update error',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error' });
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
    
    // 2. Insert initial inventory master record
    const invResult = await db.run(
      `INSERT INTO inventory_master (medicine_id, quantity, rack_location, batch_no, expiry_date, unit_price, cost_price, mrp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        medicineId,
        parseInt(quantity, 10) || 100,
        rack_location || 'A-1',
        batch_no || 'B-NEW',
        expiry_date || '12/2028',
        parseFloat(mrp) || 0,
        parseFloat(cost_price) || 0,
        parseFloat(mrp) || 0
      ]
    );
    
        res.json({
      success: true,
      message: 'Medicine and inventory registered successfully',
      medicine_id: medicineId,
      inventory_id: invResult.lastID
    });
  } catch (error: any) {
    console.error('Failed to create medicine and inventory:', error);
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
    if (q.length < 2) return res.json([]);
    db = await dbManager.getConnection();
    const likeQ = `%${q}%`;
    
    // Pass 1: Query by name and aliases (extremely fast since name is primary search target)
    const primaryRows = await db.all(
      `SELECT id, name, item_code, manufacturer, strength, packaging, mrp, generic_name
       FROM medicines
       WHERE name LIKE ?
       UNION ALL
       SELECT m.id, m.name, m.item_code, m.manufacturer, m.strength, m.packaging, m.mrp, m.generic_name
       FROM medicine_aliases a
       JOIN medicines m ON a.medicine_id = m.id
       WHERE a.alias_name LIKE ?
       ORDER BY name ASC LIMIT 25`,
      [likeQ, likeQ]
    );

    const rows: any[] = [];
    const seenIds = new Set<number>();
    
    for (const r of primaryRows) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        rows.push(r);
      }
    }

    // Pass 2: Fall back to slower fields (api_reference, item_code, manufacturer) only if we need more results
    if (rows.length < 25) {
      const needed = 25 - rows.length;
      const secondaryRows = await db.all(
        `SELECT id, name, item_code, manufacturer, strength, packaging, mrp, generic_name
         FROM medicines
         WHERE api_reference LIKE ? OR item_code LIKE ? OR manufacturer LIKE ?
         ORDER BY name ASC LIMIT ?`,
        [likeQ, likeQ, likeQ, needed * 2]
      );
      for (const r of secondaryRows) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          rows.push(r);
          if (rows.length >= 25) break;
        }
      }
    }

    res.json(rows);
  } catch (error: any) {
    console.error('Catalog search error:', error.message);
    res.status(500).json({ error: 'Search failed' });
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

    // Lookup matching entry in enrichment cache
    const cacheRow = await db.get(
      'SELECT enriched_data FROM medicine_enrichment_cache WHERE LOWER(medicine_name) = ?',
      [medicine.name.toLowerCase().trim()]
    );
    
    const enrichment = cacheRow ? JSON.parse(cacheRow.enriched_data) : null;

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
    
    // Fetch medicine details
    const medicine = await db.get('SELECT * FROM medicines WHERE id = ?', [id]);
    if (!medicine) {
            return res.status(404).json({ error: 'Medicine not found' });
    }

    // Fetch primary inventory record (latest batch or highest quantity)
    const invPrimary = await db.get(`
      SELECT id as inventory_id, quantity, rack_location, batch_no, expiry_date 
      FROM inventory_master 
      WHERE medicine_id = ? 
      ORDER BY quantity DESC LIMIT 1
    `, [id]);

    // Calculate total stock across all batches
    const stockRow = await db.get(`SELECT SUM(quantity) as total_stock FROM inventory_master WHERE medicine_id = ?`, [id]);
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
    inventory_id, quantity, rack_location 
  } = req.body;
  
  try {
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    // 1. Update medicines table
    const updates = [];
    const params = [];
    
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (generic_name !== undefined) { updates.push('generic_name = ?'); params.push(generic_name); }
    if (manufacturer !== undefined) { updates.push('manufacturer = ?'); params.push(manufacturer); }
    if (marketed_by !== undefined) { updates.push('marketed_by = ?'); params.push(marketed_by); }
    if (packaging !== undefined) { updates.push('packaging = ?'); params.push(packaging); }
    if (pack_unit !== undefined) { updates.push('pack_unit = ?'); params.push(pack_unit); }
    if (item_code !== undefined) { updates.push('item_code = ?'); params.push(item_code); }
    if (category !== undefined) { updates.push('category = ?'); params.push(category); }
    if (api_reference !== undefined) { updates.push('api_reference = ?'); params.push(api_reference); }

    if (updates.length > 0) {
      params.push(id);
      await db.run(`UPDATE medicines SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // 2. Update primary inventory record if inventory_id is provided
    if (inventory_id) {
      const invUpdates = [];
      const invParams = [];
      if (quantity !== undefined) { invUpdates.push('quantity = ?'); invParams.push(quantity); }
      if (rack_location !== undefined) { invUpdates.push('rack_location = ?'); invParams.push(rack_location); }
      
      if (invUpdates.length > 0) {
        invParams.push(inventory_id);
        await db.run(`UPDATE inventory_master SET ${invUpdates.join(', ')} WHERE id = ?`, invParams);
      }
    }

    await db.run('COMMIT');
    
    res.json({ success: true, message: 'Medicine universally updated' });
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
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Failed to sync stock overrides:', error);
    res.status(500).json({ error: error.message || 'Internal server error during stock sync' });
  }
});

export default router;
