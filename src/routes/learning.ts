// Learning Engine API (Agent 2)
import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getSummaryCache, rebuildLearningStatsCache, triggerBackgroundSummaryRebuild } from '../services/summaryCacheService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Submit learning data (e.g., from POS) for future model improvements
router.post('/', async (req, res) => {
  const { payload } = req.body;
  if (!payload) return res.status(400).json({ error: 'payload required' });
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['LEARNING_DATA', JSON.stringify(payload).slice(0, 200)]
    );
        res.json({ success: true, message: 'Learning data received' });
  } catch (error) {
    console.error('Learning endpoint error:', error);
    res.status(500).json({ error: 'Failed to store learning data' });
  }
});

// Analyze legacy data structure using rule-based approach (zero-budget alternative to Claude AI)
router.post('/analyze', async (req, res) => {
  const { sampleData } = req.body;
  if (!sampleData) return res.status(400).json({ error: 'sampleData is required' });

  try {
    // Simple rule-based mapping for common pharmacy legacy data formats
    // This provides a basic mapping without requiring external AI APIs

    // Try to parse as JSON first
    let parsedData;
    let headers: string[] = [];
    let sampleRows = [];

    try {
      parsedData = JSON.parse(sampleData);
      if (Array.isArray(parsedData) && parsedData.length > 0) {
        // Assume it's an array of objects
        const firstItem = parsedData[0];
        if (typeof firstItem === 'object' && firstItem !== null) {
          headers = Object.keys(firstItem);
          sampleRows = parsedData.slice(0, 3); // Take first 3 rows as sample
        }
      } else if (typeof parsedData === 'object' && parsedData !== null) {
        // Single object
        headers = Object.keys(parsedData);
        sampleRows = [parsedData];
      }
    } catch (e) {
      // Not JSON, try to parse as CSV-like format
      const lines = sampleData.split('\n').filter((line: string) => line.trim() !== '');
      if (lines.length > 0) {
        // Assume first line is header
        headers = lines[0].split(',').map((h: string) => h.trim());
        sampleRows = lines.slice(1, 4).map((line: string) => {
          const values = line.split(',').map((v: string) => v.trim());
          const rowObj: Record<string, string> = {};
          headers.forEach((header, index) => {
            rowObj[header] = values[index] || '';
          });
          return rowObj;
        });
      }
    }

    // Generate mapping based on common field name patterns
    const mapping: any = {
      item_name: null,
      quantity: null,
      price: null,
      expiry_date: null,
      batch_number: null
    };

    // Common patterns for each field
    const patterns: Record<string, string[]> = {
      item_name: ['item_name', 'product_name', 'medicine_name', 'name', 'description', 'item', 'product'],
      quantity: ['quantity', 'qty', 'amount', 'count', 'units'],
      price: ['price', 'cost', 'rate', 'amount', 'mrp', 'sale_price'],
      expiry_date: ['expiry_date', 'expiry', 'exp_date', 'expires', 'expiration_date'],
      batch_number: ['batch_number', 'batch', 'lot_number', 'lot', 'batch_no']
    };

    // Find best matches for each field
    Object.keys(patterns).forEach(field => {
      const possibleMatches = patterns[field];
      const match = headers.find(header =>
        possibleMatches.some(pattern =>
          header.toLowerCase().includes(pattern.toLowerCase())
        )
      );
      if (match) {
        mapping[field] = match;
      }
    });

    // If we couldn't find good matches, provide a fallback based on position
    if (headers.length >= 5) {
      // Assume standard order: name, quantity, price, expiry, batch
      if (!mapping.item_name) mapping.item_name = headers[0];
      if (!mapping.quantity) mapping.quantity = headers[1];
      if (!mapping.price) mapping.price = headers[2];
      if (!mapping.expiry_date) mapping.expiry_date = headers[3];
      if (!mapping.batch_number) mapping.batch_number = headers[4];
    }

    const hasValidMapping = Object.values(mapping).some(value => value !== null);

    if (hasValidMapping) {
      res.json({
        success: true,
        mapping,
        raw: `Rule-based analysis complete. Detected headers: ${headers.join(', ')}`,
        note: 'Using zero-budget rule-based analyzer. For more accurate results, consider configuring API keys for AI-powered analysis.'
      });
    } else {
      res.json({
        success: false,
        error: 'Could not automatically map legacy data format. Please provide sample data with recognizable column names.',
        raw: `Sample data preview: ${sampleData.substring(0, 200)}...`,
        headersDetected: headers
      });
    }
  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze legacy data structure' });
  }
});

// Apply processed learning model to database
router.post('/apply-model', async (req, res) => {
  const { rawData, mapping } = req.body;
  if (!rawData || !mapping) return res.status(400).json({ error: 'rawData and mapping required' });
  try {
    const db = await dbManager.getConnection();
    // For demo, store raw data and mapping in action_logs
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['LEARNING_APPLY', JSON.stringify({ rawData, mapping })]
    );
        res.json({ success: true, message: 'Learning model applied' });
  } catch (error) {
    console.error('Apply model error:', error);
    res.status(500).json({ error: 'Failed to apply learning model' });
  }
});

// Live counts for the Intelligent Suggestions stats card
router.get('/stats', async (_req, res) => {
  try {
    const cached = await getSummaryCache<any>('learning_stats');
    if (cached) {
      return res.json(cached);
    }
    const fresh = await rebuildLearningStatsCache();
    res.json(fresh);
  } catch (error) {
    console.error('Learning stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch learning stats' });
  }
});

// Retrain/Refresh learning model
const handleRetrainOrRefresh = async (_req: any, res: any) => {
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['REFRESH_MODEL', 'Learning engine model retrained']
    );
    await rebuildLearningStatsCache();
    res.json({ success: true, message: 'Learning model retrained & refreshed successfully' });
  } catch (error) {
    console.error('Refresh model error:', error);
    res.status(500).json({ error: 'Failed to refresh learning model' });
  }
};

router.post('/refresh-model', handleRetrainOrRefresh);
router.post('/retrain', handleRetrainOrRefresh);

// Look up a learned mapping for a medicine name
router.get('/mapping', async (req, res) => {
  const name = (req.query.name as string || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'name query parameter is required' });
  let db;
  try {
    db = await dbManager.getConnection();
    const correction = await db.get('SELECT correct FROM ocr_corrections WHERE LOWER(ocr) = ?', [name]);
    if (correction) {
      const medicine = await db.get('SELECT id, name, mrp, rate, cgst_per, sgst_per FROM medicines WHERE LOWER(name) = ?', [correction.correct.toLowerCase()]);
      if (medicine) {
                return res.json({ success: true, mapped: true, medicine });
      }
    }
        res.json({ success: true, mapped: false });
  } catch (error: any) {
    console.error('Failed to look up mapping:', error);
    res.status(500).json({ error: 'Failed to look up mapping' });
  }
});

// GET /api/learning/profiles - fetch all learning profiles
router.get('/profiles', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    await db.run(`
      CREATE TABLE IF NOT EXISTS pharmarack_distributor_mappings (
        store_name TEXT PRIMARY KEY,
        distributor_id INTEGER,
        phone TEXT,
        updated_at DATETIME
      )
    `);

    const profiles = await db.all(`
      SELECT d.id as distributor_id, d.name as distributor_name, d.email as distributor_email,
             d.phone as distributor_phone,
             lp.last_updated,
             COALESCE(dhf_agg.files_count, 0) as files_count,
             dhf.filename as last_file_name,
             dhf.status as last_status,
             (
               SELECT GROUP_CONCAT(DISTINCT store_name)
               FROM (
                 SELECT store_name, distributor_id FROM pharmarack_distributor_mappings
                 UNION
                 SELECT store_name, NULL as distributor_id FROM pharmarack_placed_orders
               )
               WHERE distributor_id = d.id OR LOWER(TRIM(store_name)) = LOWER(TRIM(d.name))
             ) as mapped_store_names
      FROM distributors d
      LEFT JOIN distributor_learning_profiles lp ON d.id = lp.distributor_id
      LEFT JOIN (
        SELECT distributor_id, COUNT(*) as files_count, MAX(id) as max_id
        FROM distributor_historical_files
        GROUP BY distributor_id
      ) dhf_agg ON d.id = dhf_agg.distributor_id
      LEFT JOIN distributor_historical_files dhf ON dhf.id = dhf_agg.max_id
      ORDER BY d.name ASC
      LIMIT 1000
    `);
    res.json({ success: true, profiles });
  } catch (error: any) {
    console.error('Failed to fetch learning profiles:', error);
    res.status(500).json({ error: 'Failed to fetch learning profiles' });
  }
});

// GET /api/learning/profiles/:distributorId - fetch profile details
router.get('/profiles/:distributorId', async (req, res) => {
  const distId = parseInt(req.params.distributorId);
  if (isNaN(distId)) return res.status(400).json({ error: 'Invalid distributor ID' });
  let db;
  try {
    db = await dbManager.getConnection();
    const [distributor, profile, files] = await Promise.all([
      db.get('SELECT * FROM distributors WHERE id = ?', [distId]),
      db.get('SELECT * FROM distributor_learning_profiles WHERE distributor_id = ?', [distId]),
      db.all(
        'SELECT id, distributor_id, filename, file_path, file_type, file_headers, mapping_config, status, created_at FROM distributor_historical_files WHERE distributor_id = ? ORDER BY id DESC',
        [distId]
      )
    ]);
    if (!distributor) {
      return res.status(404).json({ error: 'Distributor not found' });
    }
    res.json({
      success: true,
      distributor,
      profile: profile || null,
      files
    });
  } catch (error: any) {
    console.error('Failed to fetch profile detail:', error);
    res.status(500).json({ error: 'Failed to fetch profile detail' });
  }
});

// POST /api/learning/profiles/:distributorId/mapping - update manual column mapping
router.post('/profiles/:distributorId/mapping', async (req, res) => {
  const distId = parseInt(req.params.distributorId);
  const { mappingRules } = req.body;
  if (isNaN(distId)) return res.status(400).json({ error: 'Invalid distributor ID' });
  if (!mappingRules || typeof mappingRules !== 'object') return res.status(400).json({ error: 'mappingRules object is required' });

  let db;
  try {
    db = await dbManager.getConnection();
    await db.run(`
      INSERT INTO distributor_learning_profiles (distributor_id, file_mapping_rules, last_updated)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(distributor_id) DO UPDATE SET
        file_mapping_rules = excluded.file_mapping_rules,
        last_updated = CURRENT_TIMESTAMP
    `, [distId, JSON.stringify(mappingRules)]);
        res.json({ success: true, message: 'Column mapping updated successfully' });
  } catch (error: any) {
    console.error('Failed to update column mapping:', error);
    res.status(500).json({ error: 'Failed to update column mapping' });
  }
});

// POST /api/learning/profiles/:distributorId/reset - reset learning profile
router.post('/profiles/:distributorId/reset', async (req, res) => {
  const distId = parseInt(req.params.distributorId);
  if (isNaN(distId)) return res.status(400).json({ error: 'Invalid distributor ID' });

  let db;
  try {
    db = await dbManager.getConnection();
    
    // Find all files to delete their path on disk
    const files = await db.all('SELECT file_path FROM distributor_historical_files WHERE distributor_id = ?', [distId]);
    for (const f of files) {
      if (f.file_path && fs.existsSync(f.file_path)) {
        try { fs.unlinkSync(f.file_path); } catch (e) { console.warn('Failed to delete file:', f.file_path, e); }
      }
    }

    await db.run('DELETE FROM distributor_learning_profiles WHERE distributor_id = ?', [distId]);
    await db.run('DELETE FROM distributor_historical_files WHERE distributor_id = ?', [distId]);
    
    res.json({ success: true, message: 'Learning profile reset successfully' });
  } catch (error: any) {
    console.error('Failed to reset profile:', error);
    res.status(500).json({ error: 'Failed to reset profile' });
  }
});

// POST /api/learning/profiles/merge - merge duplicate distributor profiles into one primary distributor
router.post('/profiles/merge', async (req, res) => {
  const { primaryId, secondaryIds: rawSecondaryIds, secondaryId, newName } = req.body;
  const secondaryIds: number[] = Array.isArray(rawSecondaryIds)
    ? rawSecondaryIds.map(Number).filter(n => !isNaN(n) && n > 0)
    : (secondaryId && !isNaN(Number(secondaryId)) && Number(secondaryId) > 0 ? [Number(secondaryId)] : []);

  if (!primaryId || isNaN(Number(primaryId)) || secondaryIds.length === 0) {
    return res.status(400).json({ error: 'primaryId and valid secondaryIds (or secondaryId) are required' });
  }
  const cleanPrimaryId = Number(primaryId);
  if (secondaryIds.includes(cleanPrimaryId)) {
    return res.status(400).json({ error: 'Primary distributor cannot be included in secondary distributors' });
  }

  try {
    const db = await dbManager.getConnection();
    let primary = await db.get('SELECT * FROM distributors WHERE id = ?', [cleanPrimaryId]);
    if (!primary) return res.status(404).json({ error: 'Primary distributor not found' });

    // Optionally rename primary distributor to Pharmarack/custom name during merge
    if (newName && typeof newName === 'string' && newName.trim() && newName.trim() !== primary.name) {
      const cleanNewName = newName.trim();
      await db.run('UPDATE distributors SET name = ? WHERE id = ?', [cleanNewName, cleanPrimaryId]);
      primary = await db.get('SELECT * FROM distributors WHERE id = ?', [cleanPrimaryId]);
    }

    const placeholders = secondaryIds.map(() => '?').join(',');
    const params = [cleanPrimaryId, ...secondaryIds];

    // 1. Tables without unique constraints on distributor_id
    const standardTables = [
      'purchases',
      'purchase_orders',
      'returns',
      'distributor_payments',
      'distributor_payment_details',
      'distributor_historical_files'
    ];

    for (const tbl of standardTables) {
      try {
        const info = await db.all(`PRAGMA table_info(${tbl})`);
        if (info && info.some((c: any) => c.name === 'distributor_id')) {
          await db.run(`UPDATE ${tbl} SET distributor_id = ? WHERE distributor_id IN (${placeholders})`, params);
        }
      } catch (_e) {
        // Ignore if table or column doesn't exist
      }
    }

    // 2. Safe re-linking for distributor_medicine_aliases (has UNIQUE(distributor_id, alias_name))
    try {
      await db.run(
        `DELETE FROM distributor_medicine_aliases 
         WHERE distributor_id IN (${placeholders}) 
           AND alias_name IN (SELECT alias_name FROM distributor_medicine_aliases WHERE distributor_id = ?)`,
        [...secondaryIds, cleanPrimaryId]
      );
      await db.run(
        `UPDATE distributor_medicine_aliases SET distributor_id = ? WHERE distributor_id IN (${placeholders})`,
        params
      );
    } catch (_e) {}

    // 3. Safe re-linking for pharmarack_distributor_mappings
    try {
      await db.run(
        `UPDATE OR IGNORE pharmarack_distributor_mappings SET distributor_id = ? WHERE distributor_id IN (${placeholders})`,
        params
      );
      await db.run(
        `DELETE FROM pharmarack_distributor_mappings WHERE distributor_id IN (${placeholders})`,
        secondaryIds
      );
    } catch (_e) {}

    // Clean up secondary profiles and ensure primary profile exists
    await db.run(`DELETE FROM distributor_learning_profiles WHERE distributor_id IN (${placeholders})`, secondaryIds);
    await db.run(`INSERT OR IGNORE INTO distributor_learning_profiles (distributor_id) VALUES (?)`, [cleanPrimaryId]);

    // Delete secondary distributors
    await db.run(`DELETE FROM distributors WHERE id IN (${placeholders})`, secondaryIds);

    // Sync phone number to pharmarack_distributors
    if (primary.phone && primary.name) {
      const cleanPhone = String(primary.phone).replace(/\D/g, '');
      try {
        await db.run("UPDATE pharmarack_distributors SET phone = ? WHERE LOWER(store_name) LIKE ?", [cleanPhone, `%${primary.name.toLowerCase().trim()}%`]);
      } catch (_) {}
    }

    res.json({ success: true, message: `Successfully merged ${secondaryIds.length} distributor profile(s) into '${primary.name}'`, primaryId: cleanPrimaryId, primaryName: primary.name });
  } catch (error: any) {
    console.error('Failed to merge learning profiles:', error);
    res.status(500).json({ error: 'Failed to merge learning profiles: ' + error.message });
  }
});


// GET /api/learning/historical-files/:fileId/data - get file side-by-side comparison data
router.get('/historical-files/:fileId/data', async (req, res) => {
  const fileId = parseInt(req.params.fileId);
  if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

  let db;
  try {
    db = await dbManager.getConnection();
    const fileRecord = await db.get('SELECT * FROM distributor_historical_files WHERE id = ?', [fileId]);
    
    if (!fileRecord) return res.status(404).json({ error: 'File record not found' });

    res.json({
      success: true,
      file: {
        id: fileRecord.id,
        distributor_id: fileRecord.distributor_id,
        filename: fileRecord.filename,
        file_path: fileRecord.file_path,
        file_type: fileRecord.file_type,
        file_headers: fileRecord.file_headers ? JSON.parse(fileRecord.file_headers) : [],
        mapping_config: fileRecord.mapping_config ? JSON.parse(fileRecord.mapping_config) : {},
        extracted_data: fileRecord.extracted_data ? JSON.parse(fileRecord.extracted_data) : [],
        status: fileRecord.status,
        created_at: fileRecord.created_at
      }
    });
  } catch (error: any) {
    console.error('Failed to get historical file data:', error);
    res.status(500).json({ error: 'Failed to get historical file data' });
  }
});

// DELETE /api/learning/historical-files/:fileId - delete specific historical file reference
router.delete('/historical-files/:fileId', async (req, res) => {
  const fileId = parseInt(req.params.fileId);
  if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

  let db;
  try {
    db = await dbManager.getConnection();
    const fileRecord = await db.get('SELECT file_path FROM distributor_historical_files WHERE id = ?', [fileId]);
    if (fileRecord) {
      if (fileRecord.file_path && fs.existsSync(fileRecord.file_path)) {
        try { fs.unlinkSync(fileRecord.file_path); } catch (e) { console.warn('Failed to delete file from disk:', fileRecord.file_path, e); }
      }
      await db.run('DELETE FROM distributor_historical_files WHERE id = ?', [fileId]);
    }
        res.json({ success: true, message: 'Historical file deleted successfully' });
  } catch (error: any) {
    console.error('Failed to delete historical file:', error);
    res.status(500).json({ error: 'Failed to delete historical file' });
  }
});

// GET /api/learning/dashboard-stats - unified learning activity overview
router.get('/dashboard-stats', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const [ocrCount, aliasCount, distAliasCount, pharmCount, totalMedicines] = await Promise.all([
      db.get('SELECT COUNT(*) as count FROM ocr_corrections').catch(() => ({ count: 0 })),
      db.get('SELECT COUNT(*) as count FROM medicine_aliases').catch(() => ({ count: 0 })),
      db.get('SELECT COUNT(*) as count FROM distributor_medicine_aliases').catch(() => ({ count: 0 })),
      db.get('SELECT COUNT(*) as count FROM pharmacist_corrections').catch(() => ({ count: 0 })),
      db.get('SELECT COUNT(*) as count FROM medicines').catch(() => ({ count: 0 }))
    ]);

    const recentOcr = await db.all('SELECT raw_ocr_text as ocr, correct_medicine_name as correct, success_count as count, updated_at FROM ocr_corrections ORDER BY updated_at DESC LIMIT 10').catch(() => []);
    const recentAliases = await db.all('SELECT alias_name, medicine_id, created_at FROM medicine_aliases ORDER BY id DESC LIMIT 10').catch(() => []);

    res.json({
      success: true,
      stats: {
        ocr_corrections: ocrCount?.count || 0,
        medicine_aliases: aliasCount?.count || 0,
        distributor_aliases: distAliasCount?.count || 0,
        pharmacist_corrections: pharmCount?.count || 0,
        total_medicines: totalMedicines?.count || 0
      },
      recent_ocr: recentOcr,
      recent_aliases: recentAliases
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch learning stats', details: err?.message });
  }
});

export default router;


