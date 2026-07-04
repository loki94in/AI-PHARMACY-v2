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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const MIGRATION_DIR = path.resolve(__dirname, '..', '..', 'MIGRATION SAMPEL');
const STAGING_DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'staging.db');

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

// Helper: read headers from a CSV file
async function readCsvHeaders(filePath: string, skipLines = 0): Promise<{ headers: string[], samples: any[] }> {
  const headers: string[] = [];
  const samples: any[] = [];
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csvParser({ skipLines }))
      .on('headers', (h: string[]) => headers.push(...h))
      .on('data', (row: any) => { if (samples.length < 100) samples.push(row); })
      .on('end', resolve)
      .on('error', reject);
  });
  return { headers, samples };
}

// Helper: read headers from an Excel file
function readExcelHeaders(filePath: string, skipLines = 0, sheetIdx = 0): { headers: string[], samples: any[], sheetNames: string[] } {
  const wb = XLSX.readFile(filePath, { sheetRows: skipLines + 105 });
  const sheetName = wb.SheetNames[sheetIdx] || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[];
  if (!rows || rows.length === 0) return { headers: [], samples: [], sheetNames: wb.SheetNames };
  const headers = (rows[skipLines] as string[]).map(String).filter(h => h.trim());
  const samples = rows.slice(skipLines + 1, skipLines + 101).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, (row as any[])[i] ?? '']))
  );
  return { headers, samples, sheetNames: wb.SheetNames };
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

    if (ext === '.csv') {
      isCsv = true;
      const r = await readCsvHeaders(filePath, skipCount);
      headers = r.headers;
      samples = r.samples;
    } else if (ext === '.xlsx' || ext === '.xls') {
      isExcel = true;
      const r = readExcelHeaders(filePath, skipCount, 0);
      headers = r.headers;
      samples = r.samples;
      sheetNames = r.sheetNames;
    }

    const stat = fs.statSync(filePath);
    const lowercaseHeaders = headers.map(h => h.toLowerCase().trim());
    const detected = detectDataModules(headers);

    res.json({
      isCsv,
      isExcel,
      headers: headers.filter(h => h.trim() !== ''),
      samples: samples.slice(0, 5),
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
      ORDER BY i.id DESC LIMIT 500
    `);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/sales', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT s.id, s.invoice_no, s.date, s.total_amount, c.name as patient_name, d.name as doctor_name
      FROM sales_invoices s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN doctors d ON s.doctor_id = d.id
      ORDER BY s.id DESC LIMIT 500
    `);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/purchases', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT p.id, p.invoice_no, p.date, p.total_amount, d.name as distributor_name
      FROM purchases p
      LEFT JOIN distributors d ON p.distributor_id = d.id
      ORDER BY p.id DESC LIMIT 500
    `);
    await db.close();
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/staging/returns', async (req, res) => {
  if (!fs.existsSync(STAGING_DB_PATH)) return res.json([]);
  try {
    const db = await openStagingDb();
    const rows = await db.all(`
      SELECT r.id, r.return_no, r.date, r.total_amountDistributor_name
      FROM returns r
      LEFT JOIN distributors d ON r.distributor_id = d.id
      ORDER BY r.id DESC LIMIT 500
    `);
    await db.close();
    res.json(rows);
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

export default router;
