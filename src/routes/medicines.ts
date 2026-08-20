import express from 'express';
import { dbManager } from '../database/connection.js';
import { inventoryCache } from '../services/inventoryCache.js';
import { parsePackSizeFromPackaging } from '../utils/packaging.js';

const router = express.Router();

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

router.get('/medicines', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const search = (req.query.search as string) || '';
    const productName = (req.query.productName as string) || '';
    const mrpFilter = (req.query.mrpFilter as string) || '';
    const apiFilter = (req.query.apiFilter as string) || '';
    const packagingFilter = (req.query.packagingFilter as string) || '';
    const distributorFilter = (req.query.distributorFilter as string) || '';
    const categoryFilter = (req.query.category as string) || '';
    const offset = (page - 1) * limit;

    const db = await dbManager.getConnection();
    
    let countQuery = 'SELECT COUNT(*) as total FROM medicines';
    const params: any[] = [];
    const letter = (req.query.letter as string) || '';
    
    let whereClauses = [];
    
    if (letter) {
      whereClauses.push('medicines.name LIKE ?');
      params.push(`${letter}%`);
    }
    
    if (search) {
      const cleanSearch = search.trim();
      const tokens = cleanSearch.split(/\s+/).filter(t => t.length > 0);
      
      if (tokens.length === 1) {
        whereClauses.push('(medicines.name LIKE ? OR medicines.name LIKE ? OR medicines.item_code LIKE ? OR medicines.manufacturer LIKE ? OR medicines.api_reference LIKE ?)');
        const prefixParam = `${cleanSearch}%`;
        const containsParam = `%${cleanSearch}%`;
        params.push(prefixParam, containsParam, prefixParam, containsParam, containsParam);
      } else {
        const tokenClauses = tokens.map(() => '(medicines.name LIKE ? OR medicines.manufacturer LIKE ? OR medicines.api_reference LIKE ?)');
        whereClauses.push(`(${tokenClauses.join(' AND ')})`);
        for (const token of tokens) {
          const tParam = `%${token}%`;
          params.push(tParam, tParam, tParam);
        }
      }
    }

    if (productName) {
      whereClauses.push('medicines.name LIKE ?');
      params.push(`%${productName}%`);
    }

    if (apiFilter) {
      whereClauses.push('medicines.api_reference LIKE ?');
      params.push(`%${apiFilter}%`);
    }

    if (mrpFilter) {
      const norm = normalizeNumericSearch(mrpFilter);
      if (norm) {
        whereClauses.push('CAST(COALESCE(medicines.mrp, 0) AS TEXT) LIKE ?');
        params.push(`%${norm}%`);
      }
    }

    if (packagingFilter) {
      whereClauses.push('(medicines.packaging LIKE ? OR medicines.strength LIKE ?)');
      const packParam = `%${packagingFilter}%`;
      params.push(packParam, packParam);
    }

    if (distributorFilter) {
      whereClauses.push(`medicines.id IN (
        SELECT DISTINCT pi.medicine_id 
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        JOIN distributors d ON p.distributor_id = d.id
        WHERE d.name LIKE ?
      )`);
      params.push(`%${distributorFilter}%`);
    }

    if (categoryFilter) {
      whereClauses.push('medicines.category LIKE ?');
      params.push(`%${categoryFilter}%`);
    }
    
    const whereString = whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : '';
    countQuery += whereString;
    
    const sort = (req.query.sort as string) || 'id_desc';
    const orderString = sort === 'name_asc' ? 'ORDER BY name ASC' : 'ORDER BY id DESC';

    const buildQuery = (limitVal: number, offsetVal: number) => `
      WITH target_medicines AS (
        SELECT * FROM medicines
        ${whereString}
        ${orderString}
        LIMIT ${limitVal} OFFSET ${offsetVal}
      ),
      latest_purchase AS (
        SELECT pi.medicine_id,
               pi.cost_price,
               pi.mrp,
               d.name AS last_distributor_name,
               ROW_NUMBER() OVER (PARTITION BY pi.medicine_id ORDER BY p.date DESC) AS rn
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        LEFT JOIN distributors d ON p.distributor_id = d.id
        WHERE pi.medicine_id IN (SELECT id FROM target_medicines)
      )
      SELECT tm.*,
             lp.cost_price AS last_purchase_rate,
             lp.mrp AS last_purchase_mrp,
             lp.last_distributor_name
      FROM target_medicines tm
      LEFT JOIN latest_purchase lp ON lp.medicine_id = tm.id AND lp.rn = 1
    `;
    
    console.log('COUNT QUERY:', countQuery, 'PARAMS:', params);
    const countRow = await db.get(countQuery, ...params);
    const totalItems = countRow ? countRow.total : 0;
    const totalPages = Math.ceil(totalItems / limit);

    if (totalItems === 0) {
      return res.json({
        medicines: [],
        pagination: {
          totalItems: 0,
          totalPages: 0,
          currentPage: page,
          limit
        }
      });
    }

    const querySql = buildQuery(limit, offset);
    console.log('BUILD QUERY:', querySql, 'PARAMS:', params);
    let medicines = await db.all(querySql, ...params);
    
    // Fallback: if prefix search returns < 15 results, try middle-word search
    if (search && medicines.length < 15) {
      const fallbackParams = [...params];
      // Replace prefix params with middle-word params (positions 0-3 in params for search)
      for (let i = 0; i < fallbackParams.length; i++) {
        if (fallbackParams[i] === `${search}%`) {
          fallbackParams[i] = `%${search}%`;
        }
      }
      // Execute same query with fallback params
      const fallbackMedicines = await db.all(buildQuery(limit, offset), ...fallbackParams);
      // Merge results, avoiding duplicates by id
      const seenIds = new Set(medicines.map((m: any) => m.id));
      for (const med of fallbackMedicines) {
        if (!seenIds.has(med.id)) {
          medicines.push(med);
          seenIds.add(med.id);
        }
      }
      // Trim to limit
      medicines = medicines.slice(0, limit);
    }
    
    let suggestions: string[] = [];
    if (search && medicines.length === 0) {
      try {
        const candidateRows = await db.all('SELECT name FROM medicines LIMIT 500');
        const candidateNames = candidateRows.map((r: any) => r.name);
        const { findSimilarNames } = await import('../services/similarityService.js');
        suggestions = findSimilarNames(search, candidateNames, 4, 0.25);
      } catch (sugErr) {
        console.warn('[Medicines] Failed to compute search suggestions:', sugErr);
      }
    }

    await dbManager.close();
    
    res.json({
      data: medicines,
      totalPages,
      currentPage: page,
      totalItems,
      suggestions
    });
  } catch (error) {
    await dbManager.close();
    console.error('Failed to fetch medicines:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/medicines', async (req, res) => {
  const {
    name, generic_name, manufacturer, marketed_by,
    pack_unit, pack_size, cgst_per, sgst_per, igst_per,
    hsn_code, category, packaging, mrp, rate, sell_price,
    item_type, therapeutic, sub_therapeutic, schedule_type,
    short_code, ucode, api_reference, rack, rack_location,
    disable_auto_barcode, tb_medicine, allow_loose_sale,
    max_stock_level, item_code, metadata, strength
  } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Medicine name is required' });
  try {
    const { normalizeMedicineName } = await import('../utils/nameNormalizer.js');
    const adjustedName = normalizeMedicineName(name.trim(), manufacturer || '');
    const finalPackSize = parseInt(pack_size, 10) || parsePackSizeFromPackaging(packaging) || null;
    const db = await dbManager.getConnection();
    const rawRate = parseFloat(rate) || 0;
    const rawMrp = parseFloat(mrp) || 0;
    const rawSellPrice = (sell_price !== undefined && sell_price !== null && sell_price !== '' && !isNaN(Number(sell_price)))
      ? parseFloat(sell_price)
      : (rawMrp > 0 ? rawMrp : null);

    const rackVal = rack_location || rack || null;
    const metaStr = typeof metadata === 'object' && metadata !== null ? JSON.stringify(metadata) : (metadata || null);

    const result = await db.run(
      `INSERT INTO medicines (
        name, generic_name, manufacturer, marketed_by, pack_unit, pack_size,
        cgst_per, sgst_per, igst_per, hsn_code, category, packaging, mrp, rate, sell_price,
        item_type, therapeutic, sub_therapeutic, schedule_type, short_code, ucode,
        api_reference, rack, disable_auto_barcode, tb_medicine, allow_loose_sale,
        max_stock_level, item_code, metadata, strength
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adjustedName,
        generic_name || '',
        manufacturer || '',
        marketed_by || '',
        pack_unit || '',
        finalPackSize,
        parseFloat(cgst_per) || 0,
        parseFloat(sgst_per) || 0,
        parseFloat(igst_per) || 0,
        hsn_code || '',
        category || '',
        packaging || '',
        rawMrp,
        rawRate,
        rawSellPrice,
        item_type || null,
        therapeutic || null,
        sub_therapeutic || null,
        schedule_type || 'None',
        short_code || null,
        ucode || null,
        api_reference || '',
        rackVal,
        disable_auto_barcode ? 1 : 0,
        tb_medicine ? 1 : 0,
        allow_loose_sale !== undefined ? (allow_loose_sale ? 1 : 0) : 1,
        parseInt(max_stock_level, 10) || null,
        item_code || null,
        metaStr,
        strength || null
      ]
    );
    const id = result.lastID;
    const savedMed = await db.get('SELECT * FROM medicines WHERE id = ?', [id]);
    await dbManager.close();
    inventoryCache.invalidate();
    res.json({ success: true, data: savedMed });
  } catch (error) {
    await dbManager.close();
    console.error('Failed to create medicine:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/medicines/bulk-delete', async (req, res) => {
  const { ids, all, search, productName, mrpFilter, apiFilter, packagingFilter, distributorFilter, category } = req.body;
  try {
    const db = await dbManager.getConnection();
    let targetIds: number[] = [];

    if (all) {
      let query = 'SELECT id FROM medicines';
      const params: any[] = [];
      const whereClauses = [];

      if (search) {
        whereClauses.push('(name LIKE ? OR item_code LIKE ? OR manufacturer LIKE ? OR api_reference LIKE ?)');
        const searchParam = `%${search}%`;
        params.push(searchParam, searchParam, searchParam, searchParam);
      }
      if (productName) {
        whereClauses.push('name LIKE ?');
        params.push(`%${productName}%`);
      }
      if (apiFilter) {
        whereClauses.push('api_reference LIKE ?');
        params.push(`%${apiFilter}%`);
      }
      if (mrpFilter) {
        whereClauses.push('CAST(COALESCE(mrp, 0) AS TEXT) LIKE ?');
        params.push(`%${normalizeNumericSearch(mrpFilter)}%`);
      }
      if (packagingFilter) {
        whereClauses.push('(packaging LIKE ? OR strength LIKE ?)');
        const packParam = `%${packagingFilter}%`;
        params.push(packParam, packParam);
      }
      if (distributorFilter) {
        whereClauses.push(`id IN (
          SELECT DISTINCT pi.medicine_id 
          FROM purchase_items pi
          JOIN purchases p ON pi.purchase_id = p.id
          JOIN distributors d ON p.distributor_id = d.id
          WHERE d.name LIKE ?
        )`);
        params.push(`%${distributorFilter}%`);
      }
      if (category) {
        whereClauses.push('category LIKE ?');
        params.push(`%${category}%`);
      }

      if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
      }

      const rows = await db.all(query, ...params);
      targetIds = rows.map(r => r.id);
    } else {
      targetIds = ids || [];
    }

    if (targetIds.length === 0) {
      await dbManager.close();
      return res.json({ success: true, successCount: 0, failCount: 0, failedNames: [] });
    }

    let successCount = 0;
    let failCount = 0;
    const failedNames: string[] = [];

    for (const id of targetIds) {
      const med = await db.get('SELECT name FROM medicines WHERE id = ?', [id]);
      const name = med ? med.name : `ID ${id}`;

      const hasPurchases = await db.get('SELECT id FROM purchase_items WHERE medicine_id = ? LIMIT 1', [id]);
      const hasSales = await db.get('SELECT id FROM sale_items WHERE inventory_id IN (SELECT id FROM inventory_master WHERE medicine_id = ?) LIMIT 1', [id]);
      const hasReturns = await db.get('SELECT id FROM return_items WHERE medicine_id = ? LIMIT 1', [id]);
      const hasLedger = await db.get('SELECT id FROM stock_ledger WHERE medicine_id = ? LIMIT 1', [id]);

      if (hasPurchases || hasSales || hasReturns || hasLedger) {
        failCount++;
        failedNames.push(name);
        continue;
      }

      await db.run('DELETE FROM inventory_master WHERE medicine_id = ?', [id]);
      await db.run('DELETE FROM medicine_aliases WHERE medicine_id = ?', [id]);
      await db.run('DELETE FROM patient_refills WHERE medicine_id = ?', [id]);
      await db.run('DELETE FROM medicines WHERE id = ?', [id]);
      successCount++;
    }

    await dbManager.close();
    inventoryCache.invalidate();
    res.json({ success: true, successCount, failCount, failedNames });
  } catch (error) {
    await dbManager.close();
    console.error('Failed to bulk delete medicines:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/medicines/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    
    // Check references
    const hasPurchases = await db.get('SELECT id FROM purchase_items WHERE medicine_id = ? LIMIT 1', [id]);
    const hasSales = await db.get('SELECT id FROM sale_items WHERE inventory_id IN (SELECT id FROM inventory_master WHERE medicine_id = ?) LIMIT 1', [id]);
    const hasReturns = await db.get('SELECT id FROM return_items WHERE medicine_id = ? LIMIT 1', [id]);
    const hasLedger = await db.get('SELECT id FROM stock_ledger WHERE medicine_id = ? LIMIT 1', [id]);
    
    if (hasPurchases || hasSales || hasReturns || hasLedger) {
      await dbManager.close();
      return res.status(400).json({ 
        error: 'Cannot delete medicine. It has associated sales, purchases, or ledger transactions.' 
      });
    }
    
    // Delete safe references
    await db.run('DELETE FROM inventory_master WHERE medicine_id = ?', [id]);
    await db.run('DELETE FROM medicine_aliases WHERE medicine_id = ?', [id]);
    await db.run('DELETE FROM patient_refills WHERE medicine_id = ?', [id]);
    
    // Delete the medicine itself
    await db.run('DELETE FROM medicines WHERE id = ?', [id]);
    
    await dbManager.close();
    inventoryCache.invalidate();
    res.json({ success: true, message: 'Medicine deleted successfully' });
  } catch (error) {
    await dbManager.close();
    console.error('Failed to delete medicine:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dynamic Online Search using OpenFDA API fallback
const handleOnlineSearch: express.RequestHandler = async (req, res) => {
  const query = ((req.query.q || req.query.query) as string || '').trim();
  if (!query || query.length < 2) {
    return res.json([]);
  }
  try {
    const { checkConnectivity } = await import('../utils/networkDetector.js');
    const isOnline = await checkConnectivity();
    if (!isOnline) {
      return res.json([]);
    }
    const { OpenFdaClient } = await import('../services/apiClients/openFdaClient.js');
    const client = new OpenFdaClient();
    const result = await client.queryMedicine(query);
    if (!result) {
      return res.json([]);
    }
    res.json([{
      name: result.medicineName,
      api_reference: result.activeIngredients?.join(' + ') || '',
      manufacturer: result.manufacturer || ''
    }]);
  } catch (error) {
    console.error('Online search endpoint failed:', error);
    res.status(500).json({ error: 'Internal server error during online search' });
  }
};

router.get('/online-search', handleOnlineSearch);
router.get('/medicines/online-search', handleOnlineSearch);

// Auto-enrich composition by saving to database
const handleAutoEnrich: express.RequestHandler = async (req, res) => {
  const { name, api_reference, manufacturer } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Medicine name is required' });
  }
  try {
    const { normalizeMedicineName } = await import('../utils/nameNormalizer.js');
    const db = await dbManager.getConnection();
    const cleanName = name.trim();
    const cleanApi = (api_reference || '').trim();
    const cleanMfr = (manufacturer || '').trim();
    const adjustedName = normalizeMedicineName(cleanName, cleanMfr);

    let existing = await db.get('SELECT * FROM medicines WHERE LOWER(name) = LOWER(?)', [cleanName]);
    if (existing) {
      await db.run(
        "UPDATE medicines SET name = ?, api_reference = COALESCE(NULLIF(api_reference, ''), ?), manufacturer = COALESCE(NULLIF(manufacturer, ''), ?) WHERE id = ?",
        [adjustedName, cleanApi, cleanMfr, existing.id]
      );
      const updated = await db.get('SELECT * FROM medicines WHERE id = ?', [existing.id]);
      await dbManager.close();
      inventoryCache.invalidate();
      return res.json({ success: true, data: updated, isNew: false });
    } else {
      const result = await db.run(
        "INSERT INTO medicines (name, api_reference, manufacturer) VALUES (?, ?, ?)",
        [adjustedName, cleanApi || null, cleanMfr || null]
      );
      const newMed = await db.get('SELECT * FROM medicines WHERE id = ?', [result.lastID]);
      await dbManager.close();
      inventoryCache.invalidate();
      return res.json({ success: true, data: newMed, isNew: true });
    }
  } catch (error) {
    await dbManager.close();
    console.error('Auto enrichment save failed:', error);
    res.status(500).json({ error: 'Internal server error saving enrichment' });
  }
};

router.post('/auto-enrich', handleAutoEnrich);
router.post('/medicines/auto-enrich', handleAutoEnrich);

// GET unique manufacturers list matching search term
router.get('/manufacturers', async (req, res) => {
  let db;
  try {
    const q = (req.query.q as string || '').trim();
    db = await dbManager.getConnection();
    let rows;
    if (q.length > 0) {
      const likeQ = `%${q}%`;
      rows = await db.all(
        `SELECT DISTINCT manufacturer 
         FROM medicines 
         WHERE manufacturer LIKE ? AND manufacturer IS NOT NULL AND manufacturer != '' 
         ORDER BY manufacturer ASC 
         LIMIT 20`,
        [likeQ]
      );
    } else {
      rows = await db.all(
        `SELECT DISTINCT manufacturer 
         FROM medicines 
         WHERE manufacturer IS NOT NULL AND manufacturer != '' 
         ORDER BY manufacturer ASC 
         LIMIT 20`
      );
    }
    await dbManager.close();
    res.json(rows.map(r => r.manufacturer));
  } catch (error) {
    await dbManager.close();
    console.error('Failed to fetch manufacturers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET unique marketed_by list matching search term
router.get('/marketed-by', async (req, res) => {
  let db;
  try {
    const q = (req.query.q as string || '').trim();
    db = await dbManager.getConnection();
    let rows;
    if (q.length > 0) {
      const likeQ = `%${q}%`;
      rows = await db.all(
        `SELECT DISTINCT marketed_by 
         FROM medicines 
         WHERE marketed_by LIKE ? AND marketed_by IS NOT NULL AND marketed_by != '' 
         ORDER BY marketed_by ASC 
         LIMIT 20`,
        [likeQ]
      );
    } else {
      rows = await db.all(
        `SELECT DISTINCT marketed_by 
         FROM medicines 
         WHERE marketed_by IS NOT NULL AND marketed_by != '' 
         ORDER BY marketed_by ASC 
         LIMIT 20`
      );
    }
    await dbManager.close();
    res.json(rows.map(r => r.marketed_by));
  } catch (error) {
    await dbManager.close();
    console.error('Failed to fetch marketed-by list:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET compact inventory cache instantly
router.get('/medicines/compact', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const items = await inventoryCache.get(db);
    await dbManager.close();
    res.json(items);
  } catch (error) {
    await dbManager.close();
    console.error('Failed to get compact inventory:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET full details and alternatives for selected medicine
router.get('/medicines/:id/quick-details', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const medicine = await db.get(
      'SELECT id, name, generic_name, manufacturer, marketed_by, pack_unit, pack_size, strength, cgst_per, sgst_per, hsn_code, category, api_reference, schedule_type, packaging, sell_price, mrp FROM medicines WHERE id = ?',
      [id]
    );

    if (!medicine) {
      await dbManager.close();
      return res.status(404).json({ error: 'Medicine not found' });
    }

    // Find alternatives: medicines with the same non-empty api_reference or generic_name, excluding this medicine itself
    let alternatives: any[] = [];
    if (medicine.api_reference || medicine.generic_name) {
      alternatives = await db.all(
        `SELECT m.id, m.name, m.generic_name, m.manufacturer, m.pack_unit, m.pack_size, m.strength,
                COALESCE((SELECT SUM(quantity) FROM inventory_master WHERE medicine_id = m.id), 0) as stock_qty
         FROM medicines m
         WHERE m.id <> ? AND (
           (LOWER(m.api_reference) = LOWER(?) AND m.api_reference <> '') OR
           (LOWER(m.generic_name) = LOWER(?) AND m.generic_name <> '')
         )
         LIMIT 10`,
        [id, medicine.api_reference || '', medicine.generic_name || '']
      );
    }

    await dbManager.close();
    res.json({
      ...medicine,
      alternatives
    });
  } catch (error) {
    await dbManager.close();
    console.error('Failed to get medicine quick details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/medicines/seed-master - seed master reference catalog
router.post('/medicines/seed-master', async (req, res) => {
  try {
    const { seedMasterMedicines } = await import('../services/masterMedicinesSeedService.js');
    const result = await seedMasterMedicines(true);
    res.json({ success: true, message: `Seeded ${result.loaded} master medicines into database`, ...result });
  } catch (error: any) {
    console.error('Failed to seed master medicines:', error);
    res.status(500).json({ error: 'Failed to seed master medicines: ' + error.message });
  }
});

// POST /api/medicines/sync-from-inventory - pull purchase/sale items missing from master catalog
router.post('/medicines/sync-from-inventory', async (req, res) => {
  try {
    const { syncInventoryToMaster } = await import('../services/masterMedicinesSeedService.js');
    const result = await syncInventoryToMaster();
    res.json({ success: true, message: `Synced ${result.synced} medicine(s) from inventory into master catalog`, ...result });
  } catch (error: any) {
    console.error('Failed to sync inventory to master:', error);
    res.status(500).json({ error: 'Failed to sync inventory to master: ' + error.message });
  }
});

// PUT /api/medicines/:id/quick-edit - universal quick-edit save (medicine + primary inventory row)
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
    sell_price, mrp, rate, metadata, allow_loose_sale
  } = req.body;

  try {
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    const updates: string[] = [];
    const params: any[] = [];

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
    if (mrp !== undefined) {
      const parsedMrp = parseFloat(mrp) || 0;
      updates.push('mrp = ?');
      params.push(parsedMrp);
    }
    if (rate !== undefined) {
      const parsedRate = parseFloat(rate) || 0;
      updates.push('rate = ?');
      params.push(parsedRate);
    }
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

    if (inventory_id) {
      const invUpdates: string[] = [];
      const invParams: any[] = [];
      if (quantity !== undefined) { invUpdates.push('quantity = ?'); invParams.push(quantity); }
      if (rack_location !== undefined || rack !== undefined) {
        invUpdates.push('rack_location = ?');
        invParams.push(rack_location !== undefined ? rack_location : rack);
      }
      if (reorder_level !== undefined) { invUpdates.push('reorder_level = ?'); invParams.push(parseInt(reorder_level, 10) || 10); }
      if (rate !== undefined) { invUpdates.push('cost_price = ?'); invParams.push(parseFloat(rate) || 0); }
      if (mrp !== undefined) { invUpdates.push('mrp = ?'); invParams.push(parseFloat(mrp) || 0); }

      if (invUpdates.length > 0) {
        invParams.push(inventory_id);
        await db.run(`UPDATE inventory_master SET ${invUpdates.join(', ')} WHERE id = ?`, invParams);
      }
    }

    await db.run('COMMIT');
    inventoryCache.invalidate();

    res.json({ success: true, message: 'Medicine updated' });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (e) {}
    }
    console.error('Medicine quick-edit error:', error);
    res.status(500).json({ error: 'Internal server error during update' });
  }
});

// PATCH /api/medicines/:id/allow-loose-sale - fast cross-page toggle
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

// POST /api/medicines/merge - merge duplicate/variant medicine into canonical master medicine
router.post('/medicines/merge', async (req, res) => {
  const { primaryMedicineId, secondaryMedicineId, secondaryMedicineIds: rawSecondaryIds, distributorId, billName } = req.body;
  const secondaryIds: number[] = Array.isArray(rawSecondaryIds)
    ? rawSecondaryIds.map(Number).filter(n => !isNaN(n) && n > 0)
    : (secondaryMedicineId && !isNaN(Number(secondaryMedicineId)) && Number(secondaryMedicineId) > 0 ? [Number(secondaryMedicineId)] : []);

  if (!primaryMedicineId || isNaN(Number(primaryMedicineId)) || secondaryIds.length === 0) {
    return res.status(400).json({ error: 'primaryMedicineId and valid secondaryMedicineId(s) are required' });
  }

  const cleanPrimaryId = Number(primaryMedicineId);
  if (secondaryIds.includes(cleanPrimaryId)) {
    return res.status(400).json({ error: 'Primary medicine cannot be merged into itself' });
  }

  let db;
  try {
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    const primary = await db.get('SELECT * FROM medicines WHERE id = ?', [cleanPrimaryId]);
    if (!primary) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Primary master medicine not found' });
    }

    const placeholders = secondaryIds.map(() => '?').join(',');
    const secondaries = await db.all(`SELECT * FROM medicines WHERE id IN (${placeholders})`, secondaryIds);
    if (!secondaries || secondaries.length === 0) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'No valid secondary medicines found to merge' });
    }

    const params = [cleanPrimaryId, ...secondaryIds];

    // 1. Re-link inventory_master batches and stock
    await db.run(`UPDATE inventory_master SET medicine_id = ? WHERE medicine_id IN (${placeholders})`, params);

    // 2. Re-link purchase_items (preserves original bill raw names in purchase line)
    await db.run(`UPDATE purchase_items SET medicine_id = ? WHERE medicine_id IN (${placeholders})`, params);

    // 3. Re-link stock ledger
    try {
      await db.run(`UPDATE stock_ledger SET medicine_id = ? WHERE medicine_id IN (${placeholders})`, params);
    } catch (_) {}

    // 4. Re-link special orders and shortage requests
    try {
      await db.run(`UPDATE special_orders SET medicine_id = ? WHERE medicine_id IN (${placeholders})`, params);
    } catch (_) {}

    // 5. Clean up pre-computed substitutes referencing secondaries
    try {
      await db.run(`DELETE FROM substitutes WHERE source_medicine_id IN (${placeholders}) OR substitute_medicine_id IN (${placeholders})`, [...secondaryIds, ...secondaryIds]);
    } catch (_) {}

    // 6. Register aliases in medicine_aliases
    for (const sec of secondaries) {
      if (sec.name && sec.name.trim()) {
        await db.run(
          'INSERT OR IGNORE INTO medicine_aliases (alias_name, medicine_id) VALUES (?, ?)',
          [sec.name.trim(), cleanPrimaryId]
        );
      }
    }
    if (billName && typeof billName === 'string' && billName.trim()) {
      await db.run(
        'INSERT OR IGNORE INTO medicine_aliases (alias_name, medicine_id) VALUES (?, ?)',
        [billName.trim(), cleanPrimaryId]
      );
    }

    // Re-link existing medicine_aliases safely
    try {
      await db.run(
        `DELETE FROM medicine_aliases 
         WHERE medicine_id IN (${placeholders}) 
           AND alias_name IN (SELECT alias_name FROM medicine_aliases WHERE medicine_id = ?)`,
        [...secondaryIds, cleanPrimaryId]
      );
      await db.run(`UPDATE medicine_aliases SET medicine_id = ? WHERE medicine_id IN (${placeholders})`, params);
    } catch (_) {}

    // 7. Register distributor specific alias if distributorId is provided
    if (distributorId && !isNaN(Number(distributorId)) && Number(distributorId) > 0) {
      const cleanDistId = Number(distributorId);
      if (billName && typeof billName === 'string' && billName.trim()) {
        await db.run(
          `INSERT INTO distributor_medicine_aliases (distributor_id, alias_name, medicine_id) 
           VALUES (?, ?, ?) 
           ON CONFLICT(distributor_id, alias_name) DO UPDATE SET medicine_id = excluded.medicine_id`,
          [cleanDistId, billName.trim(), cleanPrimaryId]
        );
      }
      for (const sec of secondaries) {
        if (sec.name && sec.name.trim()) {
          await db.run(
            `INSERT INTO distributor_medicine_aliases (distributor_id, alias_name, medicine_id) 
             VALUES (?, ?, ?) 
             ON CONFLICT(distributor_id, alias_name) DO UPDATE SET medicine_id = excluded.medicine_id`,
            [cleanDistId, sec.name.trim(), cleanPrimaryId]
          );
        }
      }
    }

    // Re-link existing distributor_medicine_aliases safely
    try {
      await db.run(
        `DELETE FROM distributor_medicine_aliases 
         WHERE medicine_id IN (${placeholders}) 
           AND (distributor_id, alias_name) IN (SELECT distributor_id, alias_name FROM distributor_medicine_aliases WHERE medicine_id = ?)`,
        [...secondaryIds, cleanPrimaryId]
      );
      await db.run(`UPDATE distributor_medicine_aliases SET medicine_id = ? WHERE medicine_id IN (${placeholders})`, params);
    } catch (_) {}

    // 8. Delete secondary medicine master rows
    await db.run(`DELETE FROM medicines WHERE id IN (${placeholders})`, secondaryIds);

    // 9. Log action in audit logs
    try {
      const secondaryNames = secondaries.map(s => `"${s.name}" (#${s.id})`).join(', ');
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['MEDICINE_MERGE', `Merged ${secondaryNames} into master "${primary.name}" (#${cleanPrimaryId})`]
      );
    } catch (_) {}

    await db.run('COMMIT');
    inventoryCache.invalidate();

    res.json({
      success: true,
      message: `Successfully merged ${secondaries.length} medicine(s) into master "${primary.name}"`,
      primaryMedicineId: cleanPrimaryId,
      primaryName: primary.name
    });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Medicine merge error:', error);
    res.status(500).json({ error: 'Failed to merge medicines: ' + error.message });
  }
});

export default router;


