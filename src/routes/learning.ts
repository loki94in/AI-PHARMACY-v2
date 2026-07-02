// Learning Engine API (Agent 2)
import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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

// Retrain/Refresh learning model
router.post('/refresh-model', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['REFRESH_MODEL', 'Learning engine model retrained']
    );
        res.json({ success: true, message: 'Learning model refreshed successfully' });
  } catch (error) {
    console.error('Refresh model error:', error);
    res.status(500).json({ error: 'Failed to refresh learning model' });
  }
});

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
    const profiles = await db.all(`
      SELECT d.id as distributor_id, d.name as distributor_name, d.email as distributor_email, d.phone as distributor_phone,
             lp.last_updated,
             (SELECT COUNT(*) FROM distributor_historical_files WHERE distributor_id = d.id) as files_count,
             (SELECT status FROM distributor_historical_files WHERE distributor_id = d.id ORDER BY id DESC LIMIT 1) as last_status
      FROM distributors d
      LEFT JOIN distributor_learning_profiles lp ON d.id = lp.distributor_id
      ORDER BY d.name ASC
    `);
    await dbManager.close();
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
    const distributor = await db.get('SELECT * FROM distributors WHERE id = ?', [distId]);
    if (!distributor) {
            return res.status(404).json({ error: 'Distributor not found' });
    }
    const profile = await db.get('SELECT * FROM distributor_learning_profiles WHERE distributor_id = ?', [distId]);
    const files = await db.all('SELECT * FROM distributor_historical_files WHERE distributor_id = ? ORDER BY id DESC', [distId]);
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

export default router;


