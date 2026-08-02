// Migration Utility API
import express from 'express';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { migrationStatus, runManualMigration, runManualMigrationQueue } from '../worker/migrationWorker.js';
import csvParser from 'csv-parser';
import { detectDataModules, autoMapColumn } from '../utils/preMigrationIntelligence.js';
import { normalizeDate } from '../utils/migrationUtils.js';
import { rebuildMigrationInventoryStock } from '../utils/migrationStockRebuild.js';
import { getStagedModules, getImportOrderWarnings, getImportStats, clearStagedModuleTracking } from '../utils/migrationMeta.js';
import { setReportCutoverDate } from '../utils/reportCutover.js';
import { config, getAppDataDir } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Both must come from config.dbPath / getAppDataDir(), the same value dbManager opens. Deriving them
// from __dirname instead lets the finalize step write app.db to a different location
// than every page reads from (they diverge in a packaged build), and lets this module
// and migrationWorker disagree about where staging.db lives.
const DB_PATH = config.dbPath;
const MIGRATION_DIR = path.join(getAppDataDir(), 'MIGRATION SAMPEL');
const STAGING_DB_PATH = path.join(path.dirname(DB_PATH), 'staging.db');

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

const ALLOWED_MIGRATION_EXTENSIONS = /\.(zip|sql|gz|tgz|csv|xlsx|xls|db)$/i;
const MAX_MIGRATION_SIZE = 500 * 1024 * 1024; // 500MB

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
      cb(new Error('Only .zip, .sql, .gz, .tgz, .csv, .xlsx, .xls, .db files are allowed'));
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

// Get active migration summary & table counts
router.get('/summary', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const medRow = await db.get('SELECT COUNT(*) as cnt FROM medicines');
    const invRow = await db.get('SELECT COUNT(*) as cnt FROM inventory_master');
    const purRow = await db.get('SELECT COUNT(*) as cnt FROM purchases');
    const salRow = await db.get('SELECT COUNT(*) as cnt FROM sales_invoices');
    const retRow = await db.get('SELECT COUNT(*) as cnt FROM returns');
    const distRow = await db.get('SELECT COUNT(*) as cnt FROM distributors');
    const custRow = await db.get('SELECT COUNT(*) as cnt FROM customers');
    const docRow = await db.get('SELECT COUNT(*) as cnt FROM doctors');

    res.json({
      success: true,
      stats: {
        medicines: medRow?.cnt || 0,
        inventory: invRow?.cnt || 0,
        purchases: purRow?.cnt || 0,
        sales: salRow?.cnt || 0,
        returns: retRow?.cnt || 0,
        distributors: distRow?.cnt || 0,
        customers: custRow?.cnt || 0,
        doctors: docRow?.cnt || 0,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch migration summary', details: err.message });
  }
});

// Helper: read headers from a CSV file
async function readCsvHeaders(filePath: string, skipLines = 0): Promise<{ headers: string[], samples: any[], totalRows: number }> {
  const headers: string[] = [];
  const samples: any[] = [];
  let totalRows = 0;
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csvParser({ skipLines }))
      .on('headers', (h: string[]) => headers.push(...h))
      .on('data', (row: any) => { totalRows++; if (samples.length < 100) samples.push(row); })
      .on('end', resolve)
      .on('error', reject);
  });
  return { headers, samples, totalRows };
}

// Helper: read headers from an Excel file
function readExcelHeaders(filePath: string, skipLines = 0, sheetIdx = 0): { headers: string[], samples: any[], sheetNames: string[], totalRows: number } {
  const wb = XLSX.readFile(filePath, { sheetRows: skipLines + 105 });
  const sheetName = wb.SheetNames[sheetIdx] || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[];
  if (!rows || rows.length === 0) return { headers: [], samples: [], sheetNames: wb.SheetNames, totalRows: 0 };
  const headers = (rows[skipLines] as string[]).map(String).filter(h => h.trim());
  const samples = rows.slice(skipLines + 1, skipLines + 101).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, (row as any[])[i] ?? '']))
  );
  // sheetRows truncates the parsed rows, but the sheet's original dimensions survive on
  // !fullref (SheetJS keeps the untruncated range there when sheetRows is set) — use that
  // for an accurate total instead of the capped rows.length.
  let totalRows = Math.max(0, rows.length - skipLines - 1);
  const fullRef = (ws['!fullref'] || ws['!ref']) as string | undefined;
  if (fullRef) {
    try {
      const range = XLSX.utils.decode_range(fullRef);
      totalRows = Math.max(0, (range.e.r - range.s.r + 1) - skipLines - 1);
    } catch (_) { /* fall back to the capped count above */ }
  }
  return { headers, samples, sheetNames: wb.SheetNames, totalRows };
}

// Analyze a CSV file to return headers and a sample row for the UI Mapping Wizard
router.post('/analyze', async (req, res) => {
  const { fileName, skipLines } = req.body;
  if (!fileName) return res.status(400).json({ error: 'fileName required' });

  const filePath = path.join(MIGRATION_DIR, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const ext = path.extname(fileName).toLowerCase();
  const skipCount = parseInt(skipLines) || 0;

  try {
    let headers: string[] = [];
    let samples: any[] = [];
    let isCsv = false;
    let isExcel = false;
    let sheetNames: string[] = [];
    let totalRows = 0;

    if (ext === '.csv') {
      isCsv = true;
      const r = await readCsvHeaders(filePath, skipCount);
      headers = r.headers;
      samples = r.samples;
      totalRows = r.totalRows;
    } else if (ext === '.xlsx' || ext === '.xls') {
      isExcel = true;
      const r = readExcelHeaders(filePath, skipCount, 0);
      headers = r.headers;
      samples = r.samples;
      sheetNames = r.sheetNames;
      totalRows = r.totalRows;
    }

    const stat = fs.statSync(filePath);
    const lowercaseHeaders = headers.map(h => h.toLowerCase().trim());
    const detected = detectDataModules(headers);

    res.json({
      isCsv,
      isExcel,
      headers: headers.filter(h => h.trim() !== ''),
      samples: samples.slice(0, 5),
      totalRows,
      sheetNames,
      fileSize: stat.size,
      detected: detected[0] || { type: 'unknown', confidence: 0 }
    });
  } catch (err: any) {
    console.error('Analyze Error:', err);
    res.status(500).json({ error: 'Failed to analyze file', details: err.message });
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

    if (['zip', 'sql', 'gz', 'tgz', 'db'].includes(ext) || ext.endsWith('zip') || ext.endsWith('gz')) {
      return res.json({
        success: true,
        module: { type: 'database_dump', confidence: 1.0 },
        columns: [],
        autoMapping: {},
        unmappedColumns: [],
        validation: {
          errors: [],
          requiredFieldsMapped: true,
          missingRequired: []
        },
        sheetNames: []
      });
    }

    if (ext === 'csv') {
      const r = await readCsvHeaders(filePath, skipCount);
      headers = r.headers;
      samples = r.samples;
    } else if (ext === 'xlsx' || ext === 'xls') {
      const r = readExcelHeaders(filePath, skipCount, sheetIdx);
      headers = r.headers;
      samples = r.samples;
      sheetNames = r.sheetNames;
    }

    const detected = detectDataModules(headers);
    const moduleResult = detected[0] || { type: 'unknown', confidence: 0 };

    const autoMapping: Record<string, string> = {};
    headers.forEach(h => {
      autoMapping[h] = autoMapColumn(h);
    });

    const activeMapping = userMapping || autoMapping;
    const unmappedColumns = headers.filter(h => !activeMapping[h]);

    // Validation checks
    const getRequiredFields = (type: string) => {
      switch (type) {
        case 'inventory': return ['name', 'batch_no', 'expiry_date'];
        case 'purchases': return ['invoice_no', 'date'];
        case 'sales': return ['invoice_no', 'date'];
        case 'returns': return ['return_no', 'date'];
        default: return ['name'];
      }
    };

    const required = getRequiredFields(moduleResult.type);
    const mappedTargets = Object.values(activeMapping);
    const missingRequired = required.filter(f => !mappedTargets.includes(f));
    const requiredFieldsMapped = missingRequired.length === 0;

    const errors: Array<{ row: number; column: string; value: any; message: string }> = [];

    // Row-by-row validation check on samples
    samples.forEach((row, idx) => {
      const rowNum = idx + 1;
      
      required.forEach(field => {
        const headerName = Object.keys(activeMapping).find(k => activeMapping[k] === field);
        if (headerName) {
          const val = row[headerName];
          if (val === undefined || val === null || String(val).trim() === '') {
            errors.push({
              row: rowNum,
              column: field,
              value: val,
              message: `Mandatory field "${field}" is empty`
            });
          }
        }
      });

      ['expiry_date', 'date'].forEach(field => {
        const headerName = Object.keys(activeMapping).find(k => activeMapping[k] === field);
        if (headerName) {
          const val = row[headerName];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            const normalized = normalizeDate(String(val).trim());
            if (!normalized || isNaN(Date.parse(normalized))) {
              errors.push({
                row: rowNum,
                column: field,
                value: val,
                message: `Invalid date format: "${val}"`
              });
            }
          }
        }
      });

      ['mrp', 'cost_price', 'total_amount', 'cgst', 'sgst', 'discount', 'quantity'].forEach(field => {
        const headerName = Object.keys(activeMapping).find(k => activeMapping[k] === field);
        if (headerName) {
          const val = row[headerName];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            const num = parseFloat(String(val).replace(/[^\d.-]/g, ''));
            if (isNaN(num) || num < 0) {
              errors.push({
                row: rowNum,
                column: field,
                value: val,
                message: `Must be a positive number: "${val}"`
              });
            }
          }
        }
      });
    });

    res.json({
      success: true,
      module: moduleResult,
      columns: headers,
      autoMapping,
      unmappedColumns,
      validation: {
        errors,
        requiredFieldsMapped,
        missingRequired
      },
      sheetNames
    });
  } catch (err: any) {
    console.error('Pre-migration analyze error:', err);
    res.status(500).json({ error: 'Pre-migration analysis failed', details: err.message });
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

// --- STAGING APIS ---

router.get('/staging/errors', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json({ rows: [], total: 0 });
  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10) || 500, 5000);
  const offset = parseInt(String(req.query.offset || '0'), 10) || 0;
  try {
    const db = await openStagingDb();
    const totalRow = await db.get('SELECT COUNT(*) as cnt FROM migration_errors');
    const rows = await db.all(`
      SELECT id, file_name, row_index, raw_data, error_message, created_at 
      FROM migration_errors 
      ORDER BY id DESC LIMIT ? OFFSET ?
    `, [limit, offset]);
    await db.close();
    res.json({ rows, total: totalRow?.cnt || 0, limit, offset });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/inventory', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json({ rows: [], total: 0 });
  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10) || 500, 5000);
  const offset = parseInt(String(req.query.offset || '0'), 10) || 0;
  try {
    const db = await openStagingDb();
    const totalRow = await db.get('SELECT COUNT(*) as cnt FROM inventory_master');
    const rows = await db.all(`
      SELECT m.name as medicine_name, m.api_reference, m.hsn_code, m.manufacturer, m.marketed_by, m.cgst_per AS cgst, m.sgst_per AS sgst,
             i.id, i.batch_no, i.expiry_date, i.quantity, i.loose_quantity, i.mrp, i.cost_price, i.rack_location 
      FROM inventory_master i
      LEFT JOIN medicines m ON i.medicine_id = m.id
      ORDER BY i.id DESC LIMIT ? OFFSET ?
    `, [limit, offset]);
    await db.close();
    res.json({ rows, total: totalRow?.cnt || 0, limit, offset });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/sales', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json({ rows: [], total: 0 });
  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10) || 500, 5000);
  const offset = parseInt(String(req.query.offset || '0'), 10) || 0;
  try {
    const db = await openStagingDb();
    const totalRow = await db.get('SELECT COUNT(*) as cnt FROM sales_invoices');
    const rows = await db.all(`
      SELECT s.id, s.invoice_no, s.date, s.total_amount, c.name as patient_name, d.name as doctor_name
      FROM sales_invoices s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN doctors d ON s.doctor_id = d.id
      ORDER BY s.id DESC LIMIT ? OFFSET ?
    `, [limit, offset]);
    await db.close();
    res.json({ rows, total: totalRow?.cnt || 0, limit, offset });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/purchases', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json({ rows: [], total: 0 });
  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10) || 500, 5000);
  const offset = parseInt(String(req.query.offset || '0'), 10) || 0;
  try {
    const db = await openStagingDb();
    const totalRow = await db.get('SELECT COUNT(*) as cnt FROM purchases');
    const rows = await db.all(`
      SELECT p.id, p.invoice_no, p.date, p.total_amount, d.name as distributor_name
      FROM purchases p
      LEFT JOIN distributors d ON p.distributor_id = d.id
      ORDER BY p.id DESC LIMIT ? OFFSET ?
    `, [limit, offset]);
    await db.close();
    res.json({ rows, total: totalRow?.cnt || 0, limit, offset });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/returns', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json({ rows: [], total: 0 });
  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10) || 500, 5000);
  const offset = parseInt(String(req.query.offset || '0'), 10) || 0;
  try {
    const db = await openStagingDb();
    const totalRow = await db.get('SELECT COUNT(*) as cnt FROM returns');
    const rows = await db.all(`
      SELECT r.id, r.return_no, r.date, r.total_amount, d.name as distributor_name
      FROM returns r
      LEFT JOIN distributors d ON r.distributor_id = d.id
      ORDER BY r.id DESC LIMIT ? OFFSET ?
    `, [limit, offset]);
    await db.close();
    res.json({ rows, total: totalRow?.cnt || 0, limit, offset });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/staging/rollback', async (_req, res) => {
  try {
    if (fs.existsSync(STAGING_DB_PATH)) {
      fs.unlinkSync(STAGING_DB_PATH);
    }
    Object.assign(migrationStatus, { active: false, progress: 0, message: 'Idle', file: null, isStagingReady: false, errorCount: 0 });
    res.json({ success: true, message: 'Staging cleared. Ready for a fresh migration.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to rollback staging', details: err.message });
  }
});

// Staging summary — row counts + error/conflict tallies before commit
router.get('/staging/summary', async (_req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) {
    return res.json({ success: true, ready: false, stats: {}, errorCount: 0, conflictCount: 0 });
  }
  try {
    const db = await openStagingDb();
    const count = async (table: string) => {
      try {
        const row = await db.get(`SELECT COUNT(*) as cnt FROM ${table}`);
        return row?.cnt || 0;
      } catch {
        return 0;
      }
    };
    const errRow = await db.get('SELECT COUNT(*) as cnt FROM migration_errors').catch(() => ({ cnt: 0 }));
    const conflictRow = await db.get(`SELECT COUNT(*) as cnt FROM migration_conflicts WHERE status = 'pending'`).catch(() => ({ cnt: 0 }));
    const stagedModules = await getStagedModules(db);
    const importStats = await getImportStats(db);
    const warnings = getImportOrderWarnings(stagedModules);
    const stats = {
      medicines: await count('medicines'),
      inventory: await count('inventory_master'),
      purchases: await count('purchases'),
      sales: await count('sales_invoices'),
      returns: await count('returns'),
      distributors: await count('distributors'),
      customers: await count('customers'),
      doctors: await count('doctors'),
    };
    await db.close();
    res.json({
      success: true,
      ready: true,
      stats,
      errorCount: errRow?.cnt || 0,
      conflictCount: conflictRow?.cnt || 0,
      stagedModules,
      importStats,
      warnings,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/staging/conflicts', async (_req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT c.id, c.module_type, c.raw_imported_data, c.matching_record_id, c.conflict_reason, c.status,
             m.name as existing_medicine_name, i.batch_no as existing_batch_no, i.quantity as existing_quantity
      FROM migration_conflicts c
      LEFT JOIN inventory_master i ON c.matching_record_id = i.id
      LEFT JOIN medicines m ON i.medicine_id = m.id
      WHERE c.status = 'pending'
      ORDER BY c.id ASC
      LIMIT 500
    `);
    await db.close();
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/staging/resolve', async (req, res) => {
  const { conflictId, resolution } = req.body;
  if (!conflictId || !resolution) {
    return res.status(400).json({ error: 'conflictId and resolution are required' });
  }
  if (!fs.existsSync(STAGING_DB_PATH)) {
    return res.status(400).json({ error: 'No staging database found' });
  }
  const allowed = ['merge', 'overwrite', 'skip'];
  if (!allowed.includes(resolution)) {
    return res.status(400).json({ error: `resolution must be one of: ${allowed.join(', ')}` });
  }

  try {
    const db = await openStagingDb();
    const conflict = await db.get('SELECT * FROM migration_conflicts WHERE id = ? AND status = ?', [conflictId, 'pending']);
    if (!conflict) {
      await db.close();
      return res.status(404).json({ error: 'Conflict not found or already resolved' });
    }

    const rawRow = JSON.parse(conflict.raw_imported_data);

    if (resolution === 'merge' && conflict.module_type === 'inventory') {
      const existing = await db.get('SELECT * FROM inventory_master WHERE id = ?', [conflict.matching_record_id]);
      if (existing) {
        const newQty = (existing.quantity || 0) + (rawRow.quantity || 0);
        const newLoose = (existing.loose_quantity || 0) + (rawRow.loose_quantity || 0);
        await db.run(
          'UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?',
          [newQty, newLoose, conflict.matching_record_id]
        );
      }
      await db.run('UPDATE migration_conflicts SET status = ? WHERE id = ?', ['resolved_merge', conflictId]);
    } else if (resolution === 'overwrite' && conflict.module_type === 'inventory') {
      await db.run(
        `UPDATE inventory_master SET quantity = ?, loose_quantity = ?, rack_location = COALESCE(?, rack_location),
         expiry_date = COALESCE(?, expiry_date), cost_price = COALESCE(?, cost_price), mrp = COALESCE(?, mrp)
         WHERE id = ?`,
        [
          rawRow.quantity ?? 0,
          rawRow.loose_quantity ?? 0,
          rawRow.rack_location || null,
          rawRow.expiry_date || null,
          rawRow.cost_price ?? null,
          rawRow.mrp ?? null,
          conflict.matching_record_id,
        ]
      );
      await db.run('UPDATE migration_conflicts SET status = ? WHERE id = ?', ['resolved_overwrite', conflictId]);
    } else if (resolution === 'skip') {
      await db.run('UPDATE migration_conflicts SET status = ? WHERE id = ?', ['resolved_skip', conflictId]);
    } else {
      await db.close();
      return res.status(400).json({ error: 'Unsupported resolution for this conflict type' });
    }

    await db.close();
    res.json({ success: true, message: `Conflict ${conflictId} resolved as ${resolution}` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/snapshots', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      'SELECT id, backup_path, created_at FROM migration_snapshots ORDER BY id DESC LIMIT 20'
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/snapshots/restore', async (req, res) => {
  const { snapshotId } = req.body;
  if (!snapshotId) return res.status(400).json({ error: 'snapshotId required' });

  try {
    const db = await dbManager.getConnection();
    const snap = await db.get('SELECT * FROM migration_snapshots WHERE id = ?', [snapshotId]);
    if (!snap?.backup_path || !fs.existsSync(snap.backup_path)) {
      return res.status(404).json({ error: 'Snapshot backup file not found on disk' });
    }

    try {
      const { workerSupervisor } = await import('../worker/workerSupervisor.js');
      workerSupervisor.stop();
    } catch (_) {}

    await closeAllStagingConnections();
    await dbManager.close(true);

    if (fs.existsSync(DB_PATH)) {
      const emergency = DB_PATH + '.pre_restore_' + Date.now();
      fs.copyFileSync(DB_PATH, emergency);
    }

    fs.copyFileSync(snap.backup_path, DB_PATH);

    ['app.db-wal', 'app.db-shm'].forEach(f => {
      const p = path.join(path.dirname(DB_PATH), f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (_) {}
      }
    });

    const activeDb = await dbManager.getConnection();
    try {
      const { ensureMedicinesFts } = await import('../database.js');
      await ensureMedicinesFts(activeDb);
    } catch (ftsErr: any) {
      console.warn('[Migration Restore] FTS repair warning:', ftsErr.message);
    }

    try {
      const { workerSupervisor } = await import('../worker/workerSupervisor.js');
      workerSupervisor.start();
    } catch (_) {}

    res.json({ success: true, message: 'Database restored from snapshot. Please reload the app.', requiresReload: true });
  } catch (e: any) {
    try {
      await dbManager.getConnection();
      const { workerSupervisor } = await import('../worker/workerSupervisor.js');
      workerSupervisor.start();
    } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

router.post('/staging/finalize', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.status(400).json({ error: 'No staging DB found' });
  const { regenerateInvoices, reportCutoverDate } = req.body;
  let backupPath: string | null = null;

  try {
    // 0. Final stock reconciliation on staging before swap
    try {
      const stagingDb = await openStagingDb();
      try {
        await rebuildMigrationInventoryStock(stagingDb);
      } finally {
        await stagingDb.close();
      }
    } catch (rebuildErr: any) {
      console.warn('[Migration Finalize] Pre-finalize stock rebuild warning:', rebuildErr.message);
    }

    // 1. If requested, regenerate invoice numbers on staging.db
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

    await closeAllStagingConnections();

    // 1b. Verify the search index of the database about to go live. This matters before
    // the integrity check below, which opens every virtual table and would throw on a
    // damaged medicines_fts — blocking the swap even though the data itself is fine.
    // Relevant when the staged database came straight from an imported .db backup.
    try {
      const stagingDb = await open({ filename: STAGING_DB_PATH, driver: sqlite3.Database });
      try {
        const { ensureMedicinesFts } = await import('../database.js');
        await ensureMedicinesFts(stagingDb);
      } finally {
        await stagingDb.close();
      }
    } catch (ftsErr: any) {
      console.warn('[Migration Finalize] Could not verify staging medicines_fts:', ftsErr.message);
    }

    // 2. Checkpoint staging.db and set journal_mode = DELETE to cleanly merge all WAL frames into staging.db file
    try {
      const Database = (await import('better-sqlite3')).default;
      const tempStagingDb = new Database(STAGING_DB_PATH);
      tempStagingDb.pragma('wal_checkpoint(TRUNCATE)');
      tempStagingDb.pragma('journal_mode = DELETE');
      tempStagingDb.close();
    } catch (checkpointErr) {
      console.warn('[Migration Finalize] Staging DB checkpoint warning:', checkpointErr);
    }

    // 3. Validate staging.db integrity before swap
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

    // 4. Close all open staging connections and stop supervisor background workers
    try {
      await closeAllStagingConnections();
      const { workerSupervisor } = await import('../worker/workerSupervisor.js');
      workerSupervisor.stop();
    } catch (err) {
      console.warn('Failed to stop workers or close staging connections:', err);
    }

    // 5. Close live dbManager connection pool FIRST to release file handles
    await dbManager.close(true);

    // 6. Checkpoint active DB using better-sqlite3 with timeout
    if (fs.existsSync(DB_PATH)) {
      try {
        const Database = (await import('better-sqlite3')).default;
        const tempAppDb = new Database(DB_PATH, { timeout: 10000 });
        tempAppDb.pragma('wal_checkpoint(TRUNCATE)');
        tempAppDb.pragma('journal_mode = DELETE');
        tempAppDb.close();
      } catch (checkpointErr) {
        console.warn('[Migration Finalize] Active DB checkpoint warning:', checkpointErr);
      }
    }

    // 6. Create backup of active app.db
    const timestamp = Date.now();
    backupPath = DB_PATH + '.bak_' + timestamp;
    if (fs.existsSync(DB_PATH)) {
      fs.copyFileSync(DB_PATH, backupPath);
    }

    // Clean any leftover wal/shm files for app.db and staging.db
    ['app.db-wal', 'app.db-shm', 'staging.db-wal', 'staging.db-shm'].forEach(f => {
      const p = path.join(path.dirname(DB_PATH), f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (_) { }
      }
    });

    // 7. Swap files: replace app.db with staging.db
    fs.copyFileSync(STAGING_DB_PATH, DB_PATH);

    // 8. Validate swapped app.db integrity
    try {
      const Database = (await import('better-sqlite3')).default;
      const checkDb = new Database(DB_PATH, { readonly: true });
      const checkResult = checkDb.pragma('integrity_check') as any;
      checkDb.close();
      if (!checkResult || !checkResult[0] || checkResult[0].integrity_check !== 'ok') {
        throw new Error(`Integrity check failed: ${JSON.stringify(checkResult)}`);
      }
      try { fs.unlinkSync(STAGING_DB_PATH); } catch (_) {}
    } catch (integrityErr: any) {
      console.error('[Migration Finalize] Swapped app.db integrity check failed:', integrityErr);
      if (backupPath && fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, DB_PATH);
      }
      throw new Error(`Swapped database integrity check failed. Restored from backup. Details: ${integrityErr.message}`);
    }

    // 9. Re-initialize live dbManager connection pool
    const activeDb = await dbManager.getConnection();

    // The database that just went live came from a staging copy or an imported
    // backup file, so verify its search index rather than assuming it is intact —
    // a broken medicines_fts would block every medicine write from here on.
    try {
      const { ensureMedicinesFts } = await import('../database.js');
      const ftsOutcome = await ensureMedicinesFts(activeDb);
      if (ftsOutcome === 'repaired') {
        console.log('[Migration Finalize] Rebuilt the medicines_fts index on the new live database.');
      }
    } catch (ftsErr: any) {
      console.warn('[Migration Finalize] Could not verify medicines_fts:', ftsErr.message);
    }

    // 10. Log backup snapshot in migration_snapshots table using active db
    try {
      if (backupPath) {
        await activeDb.run('INSERT INTO migration_snapshots (backup_path) VALUES (?)', [backupPath]);
      }
      if (reportCutoverDate) {
        await setReportCutoverDate(activeDb, String(reportCutoverDate));
      }
      await clearStagedModuleTracking(activeDb);
      try {
        const { backfillInventoryActiveFlags, deactivateExpiredInventory } = await import('../utils/inventoryActive.js');
        await backfillInventoryActiveFlags(activeDb);
        await deactivateExpiredInventory(activeDb);
      } catch (activeErr: any) {
        console.warn('[Migration Finalize] is_active sync warning:', activeErr.message);
      }
    } catch (dbErr) {
      console.error('Failed to log snapshot:', dbErr);
    }

    // 11. Reset migration status
    migrationStatus.isStagingReady = false;
    migrationStatus.message = 'Idle';

    // 12. Restart supervisor background workers
    try {
      const { workerSupervisor } = await import('../worker/workerSupervisor.js');
      workerSupervisor.start();
    } catch (err) {
      console.warn('Failed to restart workers:', err);
    }

    // 12b. Rebuild derived tables in the background (stock limits, substitutes)
    try {
      const { recalculateStockLimits } = await import('../worker/stockCalculatorWorker.js');
      const { precomputeSubstitutes } = await import('../worker/substituteCacheWorker.js');
      recalculateStockLimits().catch((err: any) =>
        console.warn('[Migration Finalize] Stock recalculation failed:', err.message)
      );
      precomputeSubstitutes().catch((err: any) =>
        console.warn('[Migration Finalize] Substitute rebuild failed:', err.message)
      );
    } catch (rebuildErr: any) {
      console.warn('[Migration Finalize] Post-migration rebuild skipped:', rebuildErr.message);
    }

    // 13. Query actual live database counts for the success modal
    let stats = { medicines: 0, inventory: 0, purchases: 0, sales: 0, returns: 0, distributors: 0 };
    try {
      const medRow = await activeDb.get('SELECT COUNT(*) as cnt FROM medicines');
      const invRow = await activeDb.get('SELECT COUNT(*) as cnt FROM inventory_master');
      const purRow = await activeDb.get('SELECT COUNT(*) as cnt FROM purchases');
      const salRow = await activeDb.get('SELECT COUNT(*) as cnt FROM sales_invoices');
      const retRow = await activeDb.get('SELECT COUNT(*) as cnt FROM returns');
      const distRow = await activeDb.get('SELECT COUNT(*) as cnt FROM distributors');

      stats = {
        medicines: medRow?.cnt || 0,
        inventory: invRow?.cnt || 0,
        purchases: purRow?.cnt || 0,
        sales: salRow?.cnt || 0,
        returns: retRow?.cnt || 0,
        distributors: distRow?.cnt || 0,
      };
    } catch (countErr) {
      console.warn('[Migration Finalize] Could not query table counts:', countErr);
    }

    res.json({ success: true, message: 'Migration finalized and live!', stats, requiresReload: true });
  } catch (e: any) {
    console.error('[Migration Finalize] Error during finalize:', e);

    // Ensure dbManager connection pool and background workers are restored even on failure
    try {
      if (backupPath && fs.existsSync(backupPath) && !fs.existsSync(DB_PATH)) {
        fs.copyFileSync(backupPath, DB_PATH);
      }
      await dbManager.getConnection();
    } catch (restoreErr) {
      console.error('Failed to restore connection after error:', restoreErr);
    }

    try {
      const { workerSupervisor } = await import('../worker/workerSupervisor.js');
      workerSupervisor.start();
    } catch (_) {}

    res.status(500).json({ error: e.message });
  }
});

// Scan local machine for RedBook & DGH backup files
router.get('/local-backups', async (_req, res) => {
  try {
    const backupDirs = [
      { path: 'D:\\redbook\\DGH_Backup', label: 'DGH Backup Folder' },
      { path: 'D:\\redbook', label: 'RedBook Root' },
      { path: MIGRATION_DIR, label: 'Migration Sample Folder' },
      { path: path.resolve(getAppDataDir(), 'data', 'archived_migrations'), label: 'Archived Migrations' }
    ];

    const backups: Array<{
      name: string;
      fullPath: string;
      sourceLabel: string;
      sizeBytes: number;
      lastModified: string;
      ext: string;
      isDbDump: boolean;
    }> = [];

    const ALLOWED_BACKUP_EXT = /\.(zip|sql|gz|tgz|db)$/i;

    for (const dirObj of backupDirs) {
      if (fs.existsSync(dirObj.path)) {
        try {
          const files = fs.readdirSync(dirObj.path);
          for (const f of files) {
            if (ALLOWED_BACKUP_EXT.test(f)) {
              const fullPath = path.join(dirObj.path, f);
              try {
                const stat = fs.statSync(fullPath);
                if (stat.isFile()) {
                  backups.push({
                    name: f,
                    fullPath,
                    sourceLabel: dirObj.label,
                    sizeBytes: stat.size,
                    lastModified: stat.mtime.toISOString(),
                    ext: path.extname(f).toLowerCase().replace('.', ''),
                    isDbDump: true
                  });
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
    }

    // Sort by last modified date descending
    backups.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

    res.json({ success: true, backups });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to scan local backups', details: err.message });
  }
});

// Trigger migration on a local detected backup file
router.post('/run-local-backup', async (req, res) => {
  try {
    const { fullPath, fileName } = req.body;
    let targetPath = fullPath;
    let targetName = fileName;

    if (!targetPath && targetName) {
      targetPath = path.join(MIGRATION_DIR, targetName);
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Local backup file not found at: ' + targetPath });
    }

    targetName = path.basename(targetPath);
    const destPath = path.join(MIGRATION_DIR, targetName);

    if (path.resolve(targetPath) !== path.resolve(destPath)) {
      fs.copyFileSync(targetPath, destPath);
    }

    runManualMigration(targetName, 'inventory').catch(err => {
      console.error('Local backup background migration error:', err);
    });

    res.json({
      success: true,
      message: `Local backup migration started in background for ${targetName}`,
      file: targetName
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to run local backup migration', details: err.message });
  }
});

// Migration projects — saved import sessions
router.get('/projects', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      'SELECT id, name, status, created_at as createdAt FROM migration_projects ORDER BY id DESC'
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/projects', async (req, res) => {
  const { name } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const db = await dbManager.getConnection();
    const result = await db.run(
      'INSERT INTO migration_projects (name) VALUES (?)',
      [String(name).trim()]
    );
    res.json({ success: true, id: result.lastID, name: String(name).trim() });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A project with this name already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid project id' });
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM migration_projects WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Column mapping templates for repeated CSV imports
router.get('/templates', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      'SELECT id, name, module_type as moduleType, mappings, created_at as createdAt FROM migration_templates ORDER BY name ASC'
    );
    res.json(rows.map((r: any) => ({
      ...r,
      mappings: typeof r.mappings === 'string' ? JSON.parse(r.mappings) : r.mappings,
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/templates', async (req, res) => {
  const { name, moduleType, mappings } = req.body;
  if (!name || !moduleType || !mappings) {
    return res.status(400).json({ error: 'name, moduleType, and mappings are required' });
  }
  try {
    const db = await dbManager.getConnection();
    const result = await db.run(
      'INSERT INTO migration_templates (name, module_type, mappings) VALUES (?, ?, ?)',
      [String(name).trim(), String(moduleType), JSON.stringify(mappings)]
    );
    res.json({ success: true, id: result.lastID });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A template with this name already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

export default router;
