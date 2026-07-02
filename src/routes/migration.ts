// Migration Utility API
import express from 'express';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { migrationStatus, runManualMigration, runManualMigrationQueue, MigrationTask } from '../worker/migrationWorker.js';
import csvParser from 'csv-parser';
import zlib from 'zlib';
import { detectDataModules, autoMapColumn, matchesFilters, runSimulation, runValidationCheck } from '../utils/preMigrationIntelligence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const MIGRATION_DIR = path.resolve(__dirname, '..', '..', 'MIGRATION SAMPEL');

if (!fs.existsSync(MIGRATION_DIR)) fs.mkdirSync(MIGRATION_DIR, { recursive: true });


const openConnections = new Set<any>();
let stagingDbLocked = false;

export function lockStagingDb() {
  stagingDbLocked = true;
}

export function unlockStagingDb() {
  stagingDbLocked = false;
}

export async function closeAllStagingConnections() {
  for (const db of openConnections) {
    try {
      await db.close();
    } catch (_) { }
  }
  openConnections.clear();
}

async function openStagingDb() {
  if (stagingDbLocked) {
    throw new Error('Staging database is currently locked for maintenance/reset.');
  }
  const db = await open({ filename: STAGING_DB_PATH, driver: sqlite3.Database });
  openConnections.add(db);
  const originalClose = db.close.bind(db);
  db.close = async () => {
    openConnections.delete(db);
    return originalClose();
  };
  return db;
}


const ALLOWED_MIGRATION_EXTENSIONS = /\.(zip|sql|gz|tgz|csv|xlsx|xls)$/i;
const MAX_MIGRATION_SIZE = 500 * 1024 * 1024; // 500MB

// ─── AUTO FILE-TYPE DETECTION ────────────────────────────────────────────────
const INVENTORY_KEYWORDS = ['batch', 'expiry', 'exp', 'rack', 'stock', 'qty', 'quantity', 'mrp', 'rate', 'medicine', 'product', 'item'];
const PURCHASE_KEYWORDS = ['distributor', 'supplier', 'vendor', 'purchase', 'invoice', 'bill', 'received', 'party', 'cgst', 'sgst'];
const SALES_KEYWORDS = ['patient', 'customer', 'sold', 'sale', 'bill_no', 'sell', 'doctor', 'retail', 'receipt'];
const CUSTOMER_KEYWORDS = ['name', 'phone', 'mobile', 'address', 'credit', 'balance'];

function autoDetectFileType(headers: string[]): { type: string; confidence: number } {
  const lower = headers.map(h => h.toLowerCase().replace(/[^a-z]/g, '_'));
  const score = (keywords: string[]) =>
    lower.filter(h => keywords.some(k => h.includes(k))).length;

  const scores = {
    inventory: score(INVENTORY_KEYWORDS),
    purchases: score(PURCHASE_KEYWORDS),
    sales: score(SALES_KEYWORDS),
    customers: score(CUSTOMER_KEYWORDS),
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  return { type: best[1] > 0 ? best[0] : 'unknown', confidence: Math.round((best[1] / total) * 100) };
}

// Helper: read headers from a CSV file
async function readCsvHeaders(filePath: string, skipLines = 0): Promise<{ headers: string[], samples: any[] }> {
  const headers: string[] = [];
  const samples: any[] = [];
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csvParser({ skipLines }))
      .on('headers', (h: string[]) => headers.push(...h))
      .on('data', (row: any) => { if (samples.length < 5) samples.push(row); })
      .on('end', resolve)
      .on('error', reject);
  });
  return { headers, samples };
}

// Helper: read headers from an Excel file
function readExcelHeaders(filePath: string): { headers: string[], samples: any[], sheetNames: string[] } {
  const wb = XLSX.readFile(filePath, { sheetRows: 6 });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[];
  if (!rows || rows.length === 0) return { headers: [], samples: [], sheetNames: wb.SheetNames };
  const headers = (rows[0] as string[]).map(String).filter(h => h.trim());
  const samples = rows.slice(1, 6).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, (row as any[])[i] ?? '']))
  );
  return { headers, samples, sheetNames: wb.SheetNames };
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, MIGRATION_DIR);
  },
  filename: (_req, file, cb) => {
    const sanitized = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${sanitized}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MIGRATION_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIGRATION_EXTENSIONS.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip, .sql, .gz, .tgz, .csv, .xlsx, .xls files are allowed'));
    }
  }
});

const router = express.Router();

router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Upload Error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ success: true, message: 'File uploaded successfully', file: req.file.filename });
  });
});

// Get live migration status
router.get('/status', (req, res) => {
  res.json(migrationStatus);
});

// List files in the MIGRATION SAMPEL folder
router.get('/files', (req, res) => {
  try {
    if (!fs.existsSync(MIGRATION_DIR)) fs.mkdirSync(MIGRATION_DIR, { recursive: true });
    const allowedExtensions = ['.zip', '.sql', '.gz', '.tgz', '.tar.gz'];
    const files = fs.readdirSync(MIGRATION_DIR).filter(f => {
      const lower = f.toLowerCase();
      return allowedExtensions.some(ext => lower.endsWith(ext));
    });
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Trigger a manual migration script
router.post('/run', async (req, res) => {
  const { tasks, fileName, dataType, mapping, skipLines, sheetIndex, filters, medicineActions } = req.body;
  if (!tasks && !fileName) {
    return res.status(400).json({ error: 'fileName or tasks required' });
  }
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['MIGRATION', `Requested manual migration for: ${tasks ? 'Queue (' + tasks.length + ' files)' : fileName}`]
    );

    // Call the worker in the background
    if (tasks && Array.isArray(tasks)) {
      runManualMigrationQueue(tasks).catch(error => {
        console.error('Background migration queue error:', error);
      });
    } else {
      const skipCount = parseInt(skipLines) || 0;
      const sheetIdx = parseInt(sheetIndex) || 0;
      runManualMigration(fileName, dataType || 'inventory', mapping, skipCount, sheetIdx, filters, medicineActions).catch(error => {
        console.error('Background migration error:', error);
      });
    }

    res.json({ success: true, message: `Migration started in the background` });
  } catch (error: any) {
    console.error('Migration error:', error);
    res.status(500).json({ error: error.message || 'Failed to start migration' });
  }
});

router.post('/pre-migration-analyze', async (req, res) => {
  const { fileName, skipLines, sheetIndex, userMapping } = req.body;
  if (!fileName) return res.status(400).json({ error: 'fileName required' });

  const filePath = path.join(MIGRATION_DIR, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  try {
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const skipCount = parseInt(skipLines) || 0;
    const sheetIdx = parseInt(sheetIndex) || 0;

    let headers: string[] = [];
    let samples: any[] = [];
    let sheetNames: string[] = [];

    if (ext === 'csv') {
      const r = await readCsvHeaders(filePath, skipCount);
      headers = r.headers;
      samples = r.samples;
    } else if (ext === 'xlsx' || ext === 'xls') {
      const wb = XLSX.readFile(filePath, { sheetRows: skipCount + 100 });
      sheetNames = wb.SheetNames;
      const sheetName = wb.SheetNames[sheetIdx] || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[];
      const headerRow = (rows[skipCount] as string[]) || [];
      headers = headerRow.map(String).filter(h => h.trim());
      samples = rows.slice(skipCount + 1, skipCount + 100).map(row =>
        Object.fromEntries(headers.map((h, i) => [h, (row as any[])[i] ?? '']))
      );
    }

    const detected = detectDataModules(headers);
    const moduleResult = detected[0] || { type: 'unknown', confidence: 0 };

    const autoMapping: Record<string, string> = {};
    headers.forEach(h => {
      autoMapping[h] = autoMapColumn(h);
    });

    const activeMapping = userMapping || autoMapping;
    const unmappedColumns = headers.filter(h => !activeMapping[h]);

    // Extract unique medicine candidates
    const nameKey = Object.keys(activeMapping).find(k => activeMapping[k] === 'name');
    const medicineCandidates: string[] = [];
    if (nameKey) {
      const candidates = new Set<string>();
      samples.forEach(s => {
        if (s[nameKey]) candidates.add(String(s[nameKey]).trim());
      });
      medicineCandidates.push(...Array.from(candidates));
    }

    // Get database medicines to check merge suggestions
    const db = await dbManager.getConnection();
    const dbMeds = await db.all('SELECT name FROM medicines');
    const dbMedsList = dbMeds.map(m => String(m.name));

    const mergeSuggestions: Record<string, string[]> = {};
    medicineCandidates.forEach(cand => {
      const matches = dbMedsList.filter(m => m.toLowerCase().includes(cand.toLowerCase()) || cand.toLowerCase().includes(m.toLowerCase()));
      if (matches.length > 0) {
        mergeSuggestions[cand] = matches.slice(0, 5);
      }
    });

    res.json({
      success: true,
      module: moduleResult,
      columns: headers,
      autoMapping,
      unmappedColumns,
      medicineCandidates: medicineCandidates.slice(0, 100),
      mergeSuggestions,
      dependencyAlerts: [],
      relationshipPreview: {
        medicinesFound: medicineCandidates.length,
        inventoryRecords: moduleResult.type === 'inventory' ? samples.length : 0,
        purchaseBills: moduleResult.type === 'purchases' ? samples.length : 0,
        salesBills: moduleResult.type === 'sales' ? samples.length : 0,
      },
      sheetNames
    });
  } catch (err: any) {
    console.error('Pre-migration analyze error:', err);
    res.status(500).json({ error: 'Pre-migration analysis failed', details: err.message });
  }
});

router.post('/pre-migration-simulate', async (req, res) => {
  const { fileName, dataType, mapping, skipLines, sheetIndex, filters } = req.body;
  if (!fileName) return res.status(400).json({ error: 'fileName required' });

  const filePath = path.join(MIGRATION_DIR, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  try {
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const skipCount = parseInt(skipLines) || 0;
    const sheetIdx = parseInt(sheetIndex) || 0;

    let rows: any[] = [];
    if (ext === 'csv') {
      const r = await readCsvHeaders(filePath, skipCount);
      // Read up to 1000 rows for simulation preview
      const fullRows: any[] = [];
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csvParser({ skipLines: skipCount }))
          .on('data', (row: any) => { if (fullRows.length < 1000) fullRows.push(row); })
          .on('end', resolve)
          .on('error', reject);
      });
      rows = fullRows;
    } else if (ext === 'xlsx' || ext === 'xls') {
      const wb = XLSX.readFile(filePath, { sheetRows: skipCount + 1000 });
      const sheetName = wb.SheetNames[sheetIdx] || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const allRows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[];
      const headerRow = (allRows[skipCount] as string[]) || [];
      const headers = headerRow.map(String).filter(h => h.trim());
      rows = allRows.slice(skipCount + 1, skipCount + 1000).map(row =>
        Object.fromEntries(headers.map((h, i) => [h, (row as any[])[i] ?? '']))
      );
    }

    const activeMapping = mapping || {};
    const filteredRows = rows.filter((r, idx) => {
      const rowNum = idx + 1;
      if (filters && filters.ignoredRows && Array.isArray(filters.ignoredRows) && filters.ignoredRows.includes(rowNum)) {
        return false;
      }
      return matchesFilters(r, activeMapping, filters);
    });

    const db = await dbManager.getConnection();
    const rowsDb = await db.all('SELECT name FROM medicines');
    const existingMedsList = rowsDb.map((r: any) => String(r.name));

    const simulation = runSimulation(filteredRows, activeMapping, dataType || 'inventory', existingMedsList);
    const validation = runValidationCheck(filteredRows, activeMapping, dataType || 'inventory');

    res.json({
      success: true,
      simulation,
      validation
    });
  } catch (err: any) {
    console.error('Pre-migration simulation error:', err);
    res.status(500).json({ error: 'Pre-migration simulation failed', details: err.message });
  }
});

// Analyze a CSV file to return headers and a sample row for the UI Mapping Wizard
router.post('/analyze', async (req, res) => {
  const { fileName, skipLines } = req.body;
  if (!fileName) return res.status(400).json({ error: 'fileName required' });

  const filePath = path.join(MIGRATION_DIR, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  if (!fileName.toLowerCase().endsWith('.csv')) {
    return res.json({ headers: [], sample: {}, isCsv: false });
  }

  const headersSet = new Set<string>();
  let sampleRows: any[] = [];
  const skipCount = parseInt(skipLines) || 0;

  try {
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csvParser({ skipLines: skipCount }))
        .on('headers', (headers: string[]) => {
          headers.forEach((h: string) => headersSet.add(h));
        })
        .on('data', (row) => {
          if (sampleRows.length < 5) {
            sampleRows.push(row);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Also get file size as an indicator of data amount
    const stat = fs.statSync(filePath);

    res.json({
      isCsv: true,
      headers: Array.from(headersSet).filter(h => h.trim() !== ''),
      samples: sampleRows,
      fileSize: stat.size,
      detected: autoDetectFileType(Array.from(headersSet).filter(h => h.trim() !== '')),
    });
  } catch (err: any) {
    console.error('CSV Analyze Error:', err);
    res.status(500).json({ error: 'Failed to analyze CSV', details: err.message });
  }
});

// ─── ANALYZE EXCEL FILE ───────────────────────────────────────────────────────
router.post('/analyze-excel', async (req, res) => {
  const { fileName, sheetIndex, skipLines } = req.body;
  if (!fileName) return res.status(400).json({ error: 'fileName required' });
  const filePath = path.join(MIGRATION_DIR, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  const ext = fileName.toLowerCase();
  if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
    return res.status(400).json({ error: 'Not an Excel file' });
  }
  try {
    const skipCount = parseInt(skipLines as string) || 0;
    const wb = XLSX.readFile(filePath, { sheetRows: skipCount + 10 });
    const sheetName = wb.SheetNames[sheetIndex ?? 0] ?? wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[];
    const headerRow = (rows[skipCount] as string[]) || [];
    const headers = headerRow.map(String).filter(h => h.trim());
    const samples = rows.slice(skipCount + 1, skipCount + 6).map(row =>
      Object.fromEntries(headers.map((h, i) => [h, (row as any[])[i] ?? '']))
    );
    const stat = fs.statSync(filePath);
    res.json({
      isExcel: true,
      sheetNames: wb.SheetNames,
      activeSheet: sheetName,
      headers,
      samples,
      fileSize: stat.size,
      detected: autoDetectFileType(headers),
    });
  } catch (err: any) {
    console.error('Excel Analyze Error:', err);
    res.status(500).json({ error: 'Failed to analyze Excel file', details: err.message });
  }
});

// ─── ANALYZE ZIP FILE ─────────────────────────────────────────────────────────
// Extracts the ZIP in memory (no disk write), reads headers of each file inside
router.post('/analyze-zip', async (req, res) => {
  const { fileName } = req.body;
  if (!fileName) return res.status(400).json({ error: 'fileName required' });
  const filePath = path.join(MIGRATION_DIR, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  if (!fileName.toLowerCase().endsWith('.zip')) {
    return res.status(400).json({ error: 'Not a ZIP file' });
  }
  try {
    const buffer = fs.readFileSync(filePath);
    const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

    const files: any[] = [];

    if (isGzip) {
      // Decompress GZIP in memory
      const decompressed = zlib.gunzipSync(buffer);

      // Determine a reasonable filename for the inner SQL file
      const baseName = fileName.replace(/\.zip$/i, '').replace(/\.gz$/i, '');
      const innerName = baseName.toLowerCase().endsWith('.sql') ? baseName : `${baseName}.sql`;

      const extractedName = `zip_${Date.now()}_${innerName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const extractedPath = path.join(MIGRATION_DIR, extractedName);
      fs.writeFileSync(extractedPath, decompressed);

      files.push({
        originalName: innerName,
        extractedFileName: extractedName,
        ext: 'sql',
        headers: ['[SQL file — will be auto-imported]'],
        samples: [],
        sheetNames: [],
        detected: { type: 'inventory', confidence: 50 },
        rowCount: null,
      });
    } else {
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      const supportedExts = ['.csv', '.xlsx', '.xls', '.sql'];

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const name = path.basename(entry.entryName);
        const ext = path.extname(name).toLowerCase();
        if (!supportedExts.includes(ext)) continue;

        // Extract this file to MIGRATION_DIR so it can be analyzed/processed
        const extractedName = `zip_${Date.now()}_${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const extractedPath = path.join(MIGRATION_DIR, extractedName);
        fs.writeFileSync(extractedPath, entry.getData());

        let headers: string[] = [];
        let samples: any[] = [];
        let sheetNames: string[] = [];

        try {
          if (ext === '.csv') {
            const r = await readCsvHeaders(extractedPath);
            headers = r.headers;
            samples = r.samples;
          } else if (ext === '.xlsx' || ext === '.xls') {
            const r = readExcelHeaders(extractedPath);
            headers = r.headers;
            samples = r.samples;
            sheetNames = r.sheetNames;
          } else if (ext === '.sql') {
            headers = ['[SQL file — will be auto-imported]'];
            samples = [];
          }
        } catch (_) { /* keep going even if one file fails */ }

        const detected = autoDetectFileType(headers);
        files.push({
          originalName: name,
          extractedFileName: extractedName,
          ext: ext.replace('.', ''),
          headers,
          samples: samples.slice(0, 3),
          sheetNames,
          detected,
          rowCount: null, // unknown without full parse
        });
      }
    }

    res.json({ zipFile: fileName, files });
  } catch (err: any) {
    console.error('ZIP Analyze Error:', err);
    res.status(500).json({ error: 'Failed to analyze ZIP file', details: err.message });
  }
});

// ─── ROLLBACK: Delete staging DB ─────────────────────────────────────────────
router.delete('/staging/rollback', async (_req, res) => {
  const STAGING_DB_PATH_LOCAL = path.resolve(__dirname, '..', '..', 'data', 'staging.db');
  try {
    if (fs.existsSync(STAGING_DB_PATH_LOCAL)) {
      fs.unlinkSync(STAGING_DB_PATH_LOCAL);
    }
    // Reset migration status
    Object.assign(migrationStatus, { active: false, progress: 0, message: 'Idle', file: null, isStagingReady: false, errorCount: 0 });
    res.json({ success: true, message: 'Staging cleared. Ready for a fresh migration.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to rollback staging', details: err.message });
  }
});

// --- STAGING APIS ---

const STAGING_DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'staging.db');

router.get('/staging/errors', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT id, file_name, row_index, raw_data, error_message, created_at 
      FROM migration_errors 
      ORDER BY id DESC LIMIT 500
    `);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/inventory', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT m.name as medicine_name, m.api_reference, m.hsn_code, m.manufacturer, m.marketed_by, m.cgst, m.sgst,
             i.id, i.batch_no, i.expiry_date, i.quantity, i.loose_quantity, i.mrp, i.cost_price, i.rack_location 
      FROM inventory_master i
      LEFT JOIN medicines m ON i.medicine_id = m.id
      ORDER BY i.id DESC LIMIT 200
    `);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/staging/inventory/:id', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB' });
  try {
    const db = await openStagingDb();
    const {
      rack_location, medicine_name, api_reference, batch_no, expiry_date,
      quantity, loose_quantity, mrp, cost_price, hsn_code, manufacturer, marketed_by, cgst, sgst
    } = req.body;

    const updates = [];
    const params = [];
    if (rack_location !== undefined) { updates.push('rack_location = ?'); params.push(rack_location); }
    if (batch_no !== undefined) { updates.push('batch_no = ?'); params.push(batch_no); }
    if (expiry_date !== undefined) { updates.push('expiry_date = ?'); params.push(expiry_date); }
    if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
    if (loose_quantity !== undefined) { updates.push('loose_quantity = ?'); params.push(loose_quantity); }
    if (mrp !== undefined) { updates.push('mrp = ?'); params.push(mrp); }
    if (cost_price !== undefined) { updates.push('cost_price = ?'); params.push(cost_price); }

    if (updates.length > 0) {
      await db.run(`UPDATE inventory_master SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    }

    if (
      medicine_name !== undefined || api_reference !== undefined || hsn_code !== undefined ||
      manufacturer !== undefined || marketed_by !== undefined || cgst !== undefined || sgst !== undefined
    ) {
      const inv = await db.get('SELECT medicine_id FROM inventory_master WHERE id = ?', req.params.id);
      if (inv && inv.medicine_id) {
        const mUpdates = [];
        const mParams = [];
        if (medicine_name !== undefined) { mUpdates.push('name = ?'); mParams.push(medicine_name); }
        if (api_reference !== undefined) { mUpdates.push('api_reference = ?'); mParams.push(api_reference); }
        if (hsn_code !== undefined) { mUpdates.push('hsn_code = ?'); mParams.push(hsn_code); }
        if (manufacturer !== undefined) { mUpdates.push('manufacturer = ?'); mParams.push(manufacturer); }
        if (marketed_by !== undefined) { mUpdates.push('marketed_by = ?'); mParams.push(marketed_by); }
        if (cgst !== undefined) { mUpdates.push('cgst = ?'); mParams.push(cgst); }
        if (sgst !== undefined) { mUpdates.push('sgst = ?'); mParams.push(sgst); }
        await db.run(`UPDATE medicines SET ${mUpdates.join(', ')} WHERE id = ?`, [...mParams, inv.medicine_id]);
      }
    }
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/staging/inventory/:id', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB' });
  try {
    const db = await openStagingDb();
    await db.run('DELETE FROM inventory_master WHERE id = ?', req.params.id);
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/sales', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT s.id, s.invoice_no, s.date, s.total_amount, c.name as patient_name, d.name as doctor_name,
             (SELECT COALESCE(SUM(si.quantity),0) FROM sale_items si WHERE si.invoice_id = s.id) as total_qty,
             (SELECT COUNT(*) FROM sale_items si WHERE si.invoice_id = s.id) as item_count
      FROM sales_invoices s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN doctors d ON s.doctor_id = d.id
      ORDER BY s.id DESC LIMIT 100
    `);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/staging/sales/:id', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB' });
  try {
    const db = await openStagingDb();
    const { invoice_no, date, total_amount, patient_name, doctor_name } = req.body;
    const updates = [];
    const params = [];
    if (invoice_no !== undefined) { updates.push('invoice_no = ?'); params.push(invoice_no); }
    if (date !== undefined) { updates.push('date = ?'); params.push(date); }
    if (total_amount !== undefined) { updates.push('total_amount = ?'); params.push(total_amount); }

    if (updates.length > 0) {
      await db.run(`UPDATE sales_invoices SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    }

    const sale = await db.get('SELECT customer_id, doctor_id FROM sales_invoices WHERE id = ?', req.params.id);
    if (sale) {
      if (patient_name !== undefined && sale.customer_id) {
        await db.run('UPDATE customers SET name = ? WHERE id = ?', [patient_name, sale.customer_id]);
      }
      if (doctor_name !== undefined && sale.doctor_id) {
        await db.run('UPDATE doctors SET name = ? WHERE id = ?', [doctor_name, sale.doctor_id]);
      }
    }
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/staging/sales/:id', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB' });
  try {
    const db = await openStagingDb();
    await db.run('DELETE FROM sales_invoices WHERE id = ?', req.params.id);
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/purchases', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT p.id, p.invoice_no, p.date, p.total_amount, d.name as distributor_name,
             (SELECT COALESCE(SUM(pi.quantity),0) FROM purchase_items pi WHERE pi.purchase_id = p.id) as total_qty,
             (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) as item_count
      FROM purchases p
      LEFT JOIN distributors d ON p.distributor_id = d.id
      ORDER BY p.id DESC LIMIT 100
    `);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/staging/purchases/:id', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB' });
  try {
    const db = await openStagingDb();
    const { invoice_no, date, total_amount, distributor_name } = req.body;
    const updates = [];
    const params = [];
    if (invoice_no !== undefined) { updates.push('invoice_no = ?'); params.push(invoice_no); }
    if (date !== undefined) { updates.push('date = ?'); params.push(date); }
    if (total_amount !== undefined) { updates.push('total_amount = ?'); params.push(total_amount); }

    if (updates.length > 0) {
      await db.run(`UPDATE purchases SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    }

    if (distributor_name !== undefined) {
      const pur = await db.get('SELECT distributor_id FROM purchases WHERE id = ?', req.params.id);
      if (pur && pur.distributor_id) {
        await db.run('UPDATE distributors SET name = ? WHERE id = ?', [distributor_name, pur.distributor_id]);
      }
    }
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/staging/purchases/:id', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB' });
  try {
    const db = await openStagingDb();
    await db.run('DELETE FROM purchases WHERE id = ?', req.params.id);
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/returns', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT r.id, r.return_no, r.date, r.total_amount, r.return_invoice_id, r.return_sub_type, r.raw_return_type, r.return_date_time, d.name as distributor_name,
             (SELECT COALESCE(SUM(ri.quantity),0) FROM return_items ri WHERE ri.return_id = r.id) as total_qty,
             (SELECT COUNT(*) FROM return_items ri WHERE ri.return_id = r.id) as item_count
      FROM returns r
      LEFT JOIN distributors d ON r.distributor_id = d.id
      ORDER BY r.id DESC LIMIT 100
    `);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/staging/returns/:id', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB' });
  try {
    const db = await openStagingDb();
    const { return_no, date, total_amount, distributor_name, return_invoice_id, return_sub_type, raw_return_type, return_date_time } = req.body;
    const updates = [];
    const params = [];
    if (return_no !== undefined) { updates.push('return_no = ?'); params.push(return_no); }
    if (date !== undefined) { updates.push('date = ?'); params.push(date); }
    if (total_amount !== undefined) { updates.push('total_amount = ?'); params.push(total_amount); }
    if (return_invoice_id !== undefined) { updates.push('return_invoice_id = ?'); params.push(return_invoice_id); }
    if (return_sub_type !== undefined) { updates.push('return_sub_type = ?'); params.push(return_sub_type); }
    if (raw_return_type !== undefined) { updates.push('raw_return_type = ?'); params.push(raw_return_type); }
    if (return_date_time !== undefined) { updates.push('return_date_time = ?'); params.push(return_date_time); }

    if (updates.length > 0) {
      await db.run(`UPDATE returns SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    }

    if (distributor_name !== undefined) {
      const ret = await db.get('SELECT distributor_id FROM returns WHERE id = ?', req.params.id);
      if (ret && ret.distributor_id) {
        await db.run('UPDATE distributors SET name = ? WHERE id = ?', [distributor_name, ret.distributor_id]);
      }
    }
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/staging/returns/:id', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB' });
  try {
    const db = await openStagingDb();
    await db.run('DELETE FROM returns WHERE id = ?', req.params.id);
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/sales/:id/items', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT si.id, si.invoice_id, si.inventory_id, si.quantity, si.loose_qty, si.unit_price, si.mrp, im.batch_no, m.name as medicine_name
      FROM sale_items si
      LEFT JOIN inventory_master im ON si.inventory_id = im.id
      LEFT JOIN medicines m ON im.medicine_id = m.id
      WHERE si.invoice_id = ?
    `, [req.params.id]);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/purchases/:id/items', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT pi.id, pi.purchase_id, pi.medicine_id, pi.batch_no, pi.expiry_date, pi.quantity, pi.cost_price, pi.mrp, m.name as medicine_name
      FROM purchase_items pi
      LEFT JOIN medicines m ON pi.medicine_id = m.id
      WHERE pi.purchase_id = ?
    `, [req.params.id]);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/returns/:id/items', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT ri.id, ri.return_id, ri.medicine_id, ri.batch_no, ri.quantity, ri.cost_price, ri.mrp, ri.total_price, m.name as medicine_name
      FROM return_items ri
      LEFT JOIN medicines m ON ri.medicine_id = m.id
      WHERE ri.return_id = ?
    `, [req.params.id]);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Staging Items Resolution Helpers
async function resolveMedicineId(db: any, name: string): Promise<number> {
  const cleanName = name.trim();
  let med = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [cleanName]);
  if (!med) {
    const result = await db.run('INSERT INTO medicines (name) VALUES (?)', [cleanName]);
    return result.lastID;
  }
  return med.id;
}

async function resolveStagingInventoryId(db: any, medicineId: number): Promise<number> {
  let inv = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? LIMIT 1', [medicineId]);
  if (!inv) {
    const result = await db.run('INSERT INTO inventory_master (medicine_id, quantity) VALUES (?, 0)', [medicineId]);
    return result.lastID;
  }
  return inv.id;
}

// STAGED SALE ITEMS
router.put('/staging/sales/:invoiceId/items/:itemId', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  try {
    const db = await openStagingDb();
    const { quantity, loose_qty, unit_price, mrp, batch_no, medicine_name } = req.body;
    const updates = [];
    const params = [];
    if (medicine_name !== undefined) {
      const medicineId = await resolveMedicineId(db, medicine_name);
      const inventoryId = await resolveStagingInventoryId(db, medicineId);
      updates.push('inventory_id = ?');
      params.push(inventoryId);
    }
    if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
    if (loose_qty !== undefined) { updates.push('loose_qty = ?'); params.push(loose_qty); }
    if (unit_price !== undefined) { updates.push('unit_price = ?'); params.push(unit_price); }
    if (mrp !== undefined) { updates.push('mrp = ?'); params.push(mrp); }
    if (batch_no !== undefined) { updates.push('batch_no = ?'); params.push(batch_no); }

    if (updates.length > 0) {
      await db.run(`UPDATE sale_items SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.itemId]);
    }
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/staging/sales/:invoiceId/items/:itemId', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  try {
    const db = await openStagingDb();
    await db.run('DELETE FROM sale_items WHERE id = ?', [req.params.itemId]);
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/staging/sales/:invoiceId/items', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  try {
    const db = await openStagingDb();
    const { quantity, loose_qty, unit_price, mrp, batch_no, medicine_name } = req.body;
    const medicineId = await resolveMedicineId(db, medicine_name || 'Unknown Medicine');
    const inventoryId = await resolveStagingInventoryId(db, medicineId);

    await db.run(
      `INSERT INTO sale_items (invoice_id, inventory_id, quantity, loose_qty, unit_price, mrp, batch_no)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.invoiceId, inventoryId, quantity || 0, loose_qty || 0, unit_price || 0, mrp || 0, batch_no || 'BATCH']
    );
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// STAGED PURCHASE ITEMS
router.put('/staging/purchases/:purchaseId/items/:itemId', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  try {
    const db = await openStagingDb();
    const { quantity, cost_price, mrp, batch_no, expiry_date, medicine_name } = req.body;
    const updates = [];
    const params = [];
    if (medicine_name !== undefined) {
      const medicineId = await resolveMedicineId(db, medicine_name);
      updates.push('medicine_id = ?');
      params.push(medicineId);
    }
    if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
    if (cost_price !== undefined) { updates.push('cost_price = ?'); params.push(cost_price); }
    if (mrp !== undefined) { updates.push('mrp = ?'); params.push(mrp); }
    if (batch_no !== undefined) { updates.push('batch_no = ?'); params.push(batch_no); }
    if (expiry_date !== undefined) { updates.push('expiry_date = ?'); params.push(expiry_date); }

    if (updates.length > 0) {
      await db.run(`UPDATE purchase_items SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.itemId]);
    }
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/staging/purchases/:purchaseId/items/:itemId', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  try {
    const db = await openStagingDb();
    await db.run('DELETE FROM purchase_items WHERE id = ?', [req.params.itemId]);
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/staging/purchases/:purchaseId/items', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  try {
    const db = await openStagingDb();
    const { quantity, cost_price, mrp, batch_no, expiry_date, medicine_name } = req.body;
    const medicineId = await resolveMedicineId(db, medicine_name || 'Unknown Medicine');

    await db.run(
      `INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.purchaseId, medicineId, batch_no || 'BATCH', expiry_date || '2028-12-01 00:00:00', quantity || 0, cost_price || 0, mrp || 0]
    );
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// STAGED RETURN ITEMS
router.put('/staging/returns/:returnId/items/:itemId', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  try {
    const db = await openStagingDb();
    const { quantity, cost_price, mrp, batch_no, expiry_date, medicine_name } = req.body;
    const updates = [];
    const params = [];
    if (medicine_name !== undefined) {
      const medicineId = await resolveMedicineId(db, medicine_name);
      updates.push('medicine_id = ?');
      params.push(medicineId);
    }
    if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
    if (cost_price !== undefined) { updates.push('cost_price = ?'); params.push(cost_price); }
    if (mrp !== undefined) { updates.push('mrp = ?'); params.push(mrp); }
    if (batch_no !== undefined) { updates.push('batch_no = ?'); params.push(batch_no); }
    if (expiry_date !== undefined) { updates.push('expiry_date = ?'); params.push(expiry_date); }

    if (updates.length > 0) {
      await db.run(`UPDATE return_items SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.itemId]);
    }
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/staging/returns/:returnId/items/:itemId', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  try {
    const db = await openStagingDb();
    await db.run('DELETE FROM return_items WHERE id = ?', [req.params.itemId]);
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/staging/returns/:returnId/items', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  try {
    const db = await openStagingDb();
    const { quantity, cost_price, mrp, batch_no, expiry_date, medicine_name } = req.body;
    const medicineId = await resolveMedicineId(db, medicine_name || 'Unknown Medicine');

    await db.run(
      `INSERT INTO return_items (return_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, total_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.returnId, medicineId, batch_no || 'BATCH', expiry_date || null, quantity || 0, cost_price || 0, mrp || 0, (quantity || 0) * (cost_price || 0)]
    );
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});


router.post('/staging/finalize', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  const { regenerateInvoices } = req.body;
  try {
    // 1. Validate staging.db integrity before swap
    try {
      const Database = (await import('better-sqlite3')).default;
      const checkDb = new Database(STAGING_DB_PATH, { readonly: true });
      const checkResult = checkDb.pragma('integrity_check') as any;
      checkDb.close();
      if (!checkResult || !checkResult[0] || checkResult[0].integrity_check !== 'ok') {
        return res.status(400).json({ error: `Staging database integrity validation failed: ${JSON.stringify(checkResult)}` });
      }
    } catch (integrityErr: any) {
      return res.status(400).json({ error: `Failed to validate staging database: ${integrityErr.message}` });
    }

    if (regenerateInvoices) {
      const db = await openStagingDb();
      const invoices = await db.all('SELECT id FROM sales_invoices ORDER BY id ASC');
      let counter = 1;
      const today = new Date();
      const prefix = `INV-${today.getFullYear()}${(today.getMonth() + 1).toString().padStart(2, '0')}`;

      await db.run('BEGIN TRANSACTION');
      for (const inv of invoices) {
        const newInvoiceNo = `${prefix}-${counter.toString().padStart(5, '0')}`;
        await db.run('UPDATE sales_invoices SET invoice_no = ? WHERE id = ?', [newInvoiceNo, inv.id]);
        counter++;
      }
      await db.run('COMMIT');
      await db.close();
    }

    // Close all open staging connections to ensure files are fully written and closed cleanly
    await closeAllStagingConnections();

    // Checkpoint staging DB to commit all WAL frames before moving
    try {
      const Database = (await import('better-sqlite3')).default;
      const tempStagingDb = new Database(STAGING_DB_PATH);
      tempStagingDb.pragma('wal_checkpoint(TRUNCATE)');
      tempStagingDb.close();
    } catch (checkpointErr) {
      console.warn('[Migration Finalize] Staging DB checkpoint warning:', checkpointErr);
    }

    // Checkpoint active DB to merge any pending transactions
    if (fs.existsSync(DB_PATH)) {
      try {
        const Database = (await import('better-sqlite3')).default;
        const tempAppDb = new Database(DB_PATH);
        tempAppDb.pragma('wal_checkpoint(TRUNCATE)');
        tempAppDb.close();
      } catch (checkpointErr) {
        console.warn('[Migration Finalize] Active DB checkpoint warning:', checkpointErr);
      }
    }

    // Close the live connection pool to app.db before we replace the file
    await dbManager.close(true);

    // Stop all supervisor background workers to prevent database corruption during file swap
    try {
      const { workerSupervisor } = await import('../worker/workerSupervisor.js');
      workerSupervisor.stop();
    } catch (err) {
      console.warn('Failed to stop workers:', err);
    }

    // Backup the old app.db just in case
    const timestamp = Date.now();
    const backupPath = DB_PATH + '.bak_' + timestamp;
    if (fs.existsSync(DB_PATH)) {
      fs.copyFileSync(DB_PATH, backupPath);

      // Save backup to snapshots table
      try {
        const coreDb = await open({ filename: DB_PATH, driver: sqlite3.Database });
        await coreDb.run('INSERT INTO migration_snapshots (backup_path) VALUES (?)', [backupPath]);
        await coreDb.close();
      } catch (dbErr) {
        console.error('Failed to log snapshot:', dbErr);
      }
    }

    // Delete WAL and SHM files of app.db to prevent SQLite recovery mismatch / corruption
    const appWal = DB_PATH + '-wal';
    const appShm = DB_PATH + '-shm';
    if (fs.existsSync(appWal)) {
      try { fs.unlinkSync(appWal); } catch (_) { }
    }
    if (fs.existsSync(appShm)) {
      try { fs.unlinkSync(appShm); } catch (_) { }
    }

    // Delete staging database WAL and SHM files
    const stagingWal = STAGING_DB_PATH + '-wal';
    const stagingShm = STAGING_DB_PATH + '-shm';
    if (fs.existsSync(stagingWal)) {
      try { fs.unlinkSync(stagingWal); } catch (_) { }
    }
    if (fs.existsSync(stagingShm)) {
      try { fs.unlinkSync(stagingShm); } catch (_) { }
    }

    // Replace app.db with staging.db
    fs.copyFileSync(STAGING_DB_PATH, DB_PATH);

    // Validate the newly copied app.db before deleting staging database
    try {
      const Database = (await import('better-sqlite3')).default;
      const checkDb = new Database(DB_PATH, { readonly: true });
      const checkResult = checkDb.pragma('integrity_check') as any;
      checkDb.close();
      if (!checkResult || !checkResult[0] || checkResult[0].integrity_check !== 'ok') {
        throw new Error(`Integrity check failed: ${JSON.stringify(checkResult)}`);
      }
      fs.unlinkSync(STAGING_DB_PATH);
    } catch (integrityErr: any) {
      console.error('[Migration Finalize] Swapped app.db integrity check failed:', integrityErr);
      // Restore from backup immediately if swap is corrupted
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, DB_PATH);
      }
      throw new Error(`Swapped database integrity check failed. Restored from backup. Details: ${integrityErr.message}`);
    }

    // Reset migration status
    migrationStatus.isStagingReady = false;
    migrationStatus.message = 'Idle';

    // Restart supervisor background workers
    try {
      const { workerSupervisor } = await import('../worker/workerSupervisor.js');
      workerSupervisor.start();
    } catch (err) {
      console.warn('Failed to restart workers:', err);
    }

    res.json({ success: true, message: 'Migration finalized and live!' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- V2 ENTERPRISE MIGRATION ENDPOINTS ---

router.get('/projects', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const projects = await db.all('SELECT * FROM migration_projects ORDER BY id DESC');
    res.json(projects);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/projects', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  try {
    const db = await dbManager.getConnection();
    const result = await db.run('INSERT INTO migration_projects (name) VALUES (?)', [name.trim()]);
    res.json({ success: true, id: result.lastID, name });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM migration_projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/templates', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const templates = await db.all('SELECT * FROM migration_templates ORDER BY name ASC');
    res.json(templates);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/templates', async (req, res) => {
  const { name, moduleType, mappings } = req.body;
  if (!name || !moduleType || !mappings) {
    return res.status(400).json({ error: 'name, moduleType, and mappings are required' });
  }
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT OR REPLACE INTO migration_templates (name, module_type, mappings) VALUES (?, ?, ?)',
      [name.trim(), moduleType, typeof mappings === 'string' ? mappings : JSON.stringify(mappings)]
    );
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/conflicts', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const conflicts = await db.all('SELECT * FROM migration_conflicts WHERE status = "pending"');
    await db.close();
    res.json(conflicts);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/staging/resolve', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  const { conflictId, resolution } = req.body;
  if (!conflictId || !resolution) {
    return res.status(400).json({ error: 'conflictId and resolution are required' });
  }
  try {
    const db = await openStagingDb();
    const conflict = await db.get('SELECT * FROM migration_conflicts WHERE id = ?', [conflictId]);
    if (!conflict) {
      await db.close();
      return res.status(404).json({ error: 'Conflict not found' });
    }
    const rawRow = JSON.parse(conflict.raw_imported_data);

    if (conflict.module_type === 'inventory') {
      if (resolution === 'skip') {
        // Just resolve it
      } else if (resolution === 'replace') {
        if (conflict.matching_record_id) {
          await db.run('DELETE FROM inventory_master WHERE id = ?', [conflict.matching_record_id]);
        }
        await db.run(
          'INSERT INTO inventory_master (medicine_id, quantity, loose_quantity, rack_location, batch_no, expiry_date, cost_price, mrp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [rawRow.medicine_id, rawRow.quantity, rawRow.loose_quantity, rawRow.rack_location, rawRow.batch_no, rawRow.expiry_date, rawRow.cost_price, rawRow.mrp]
        );
      } else if (resolution === 'merge') {
        const existing = await db.get('SELECT * FROM inventory_master WHERE id = ?', [conflict.matching_record_id]);
        if (existing) {
          const newQty = (existing.quantity || 0) + (rawRow.quantity || 0);
          const newLooseQty = (existing.loose_quantity || 0) + (rawRow.loose_quantity || 0);
          await db.run(
            'UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?',
            [newQty, newLooseQty, conflict.matching_record_id]
          );
        }
      } else if (resolution === 'create_new') {
        const modifiedBatch = `${rawRow.batch_no || 'BATCH'}-NEW`;
        await db.run(
          'INSERT INTO inventory_master (medicine_id, quantity, loose_quantity, rack_location, batch_no, expiry_date, cost_price, mrp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [rawRow.medicine_id, rawRow.quantity, rawRow.loose_quantity, rawRow.rack_location, modifiedBatch, rawRow.expiry_date, rawRow.cost_price, rawRow.mrp]
        );
      }
    }

    await db.run('UPDATE migration_conflicts SET status = ? WHERE id = ?', [`resolved_${resolution}`, conflictId]);
    await db.close();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/snapshots', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const snapshots = await db.all('SELECT * FROM migration_snapshots ORDER BY id DESC');
    res.json(snapshots);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/snapshots/restore', async (req, res) => {
  const { snapshotId } = req.body;
  if (!snapshotId) return res.status(400).json({ error: 'snapshotId is required' });
  try {
    const db = await dbManager.getConnection();
    const snapshot = await db.get('SELECT * FROM migration_snapshots WHERE id = ?', [snapshotId]);
    if (!snapshot) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }
    if (fs.existsSync(snapshot.backup_path)) {
      // Stop supervisor background workers to prevent database corruption during file swap
      try {
        const { workerSupervisor } = await import('../worker/workerSupervisor.js');
        workerSupervisor.stop();
      } catch (err) {
        console.warn('Failed to stop workers:', err);
      }

      await dbManager.close(true);

      // Delete existing app.db wal and shm files to prevent database corruption during copy
      const appWal = DB_PATH + '-wal';
      const appShm = DB_PATH + '-shm';
      if (fs.existsSync(appWal)) {
        try { fs.unlinkSync(appWal); } catch (_) { }
      }
      if (fs.existsSync(appShm)) {
        try { fs.unlinkSync(appShm); } catch (_) { }
      }

      fs.copyFileSync(snapshot.backup_path, DB_PATH);

      // Restart supervisor background workers
      try {
        const { workerSupervisor } = await import('../worker/workerSupervisor.js');
        workerSupervisor.start();
      } catch (err) {
        console.warn('Failed to restart workers:', err);
      }

      res.json({ success: true, message: 'Database successfully restored from recovery snapshot!' });
    } else {
      res.status(400).json({ error: 'Backup snapshot file does not exist on disk' });
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
