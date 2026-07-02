import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import unzipper from 'unzipper';
import zlib from 'zlib';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import readline from 'readline';
import csvParser from 'csv-parser';
import * as XLSX from 'xlsx';
import { eventService } from '../services/eventService.js';
import { normalizeDate } from '../utils/migrationUtils.js';
import { matchesFilters } from '../utils/preMigrationIntelligence.js';

// PostgreSQL COPY parser
import { parseCopyHeader, parseCopyDataRow, isCopyEndMarker, isPgDump } from './parsers/pgCopyParser.js';

// Importers
import {
  clearAllMaps, categoryMap, manufacturerMap, distributorMap, doctorMap, patientMap, medicineMap,
  importCategory, importManufacturer, importDistributor, flushDistributors,
  importDoctor, flushDoctors, importPatient, flushPatients,
  importCustomer, flushCustomers,
  importGeneric,
  importMedicine, flushMedicines,
} from './importers/pgMasterImporter.js';

import {
  batchMap, purchaseMap, clearPurchaseMap,
  importBatch, flushBatches,
  importInventory, flushPurchases,
  importInventoryMedicine, flushPurchaseItems,
} from './importers/pgPurchaseImporter.js';

import {
  salesInvoiceMap, clearSalesMap,
  importOrder, flushSalesInvoices,
  importOrderItem, flushSaleItems,
} from './importers/pgSalesImporter.js';

import {
  returnMap, clearReturnsMap,
  importReturnOrder, flushReturns,
  importReturnOrderItem, flushReturnItems,
  importStockEffect, flushStockLedger,
} from './importers/pgReturnsImporter.js';

import {
  paymentMap, clearPaymentsMap,
  importPayment, flushPayments,
  importPaymentDetail, flushPaymentDetails,
  importOrderCredit, flushOrderCredits,
  importCrNoteResolution,
} from './importers/pgPaymentsImporter.js';

import {
  b2bInvoiceMap, clearB2BMap,
  importB2BSale, flushB2BInvoices,
  importB2BSaleItem, flushB2BItems,
} from './importers/pgB2BImporter.js';

import {
  purchaseOrderMap, clearExtrasMap,
  importPurchaseOrder, flushPurchaseOrders,
  importPurchaseOrderItem, flushPurchaseOrderItems,
  importScheduledOrder, flushRefills,
  importRetailer,
} from './importers/pgExtrasImporter.js';

// Legacy parsers (kept for backward compat with INSERT-style SQL files)
import { processReturnsLine } from './parsers/returnsParser.js';
import { processInventoryLine } from './parsers/inventoryParser.js';
import { processSalesLine } from './parsers/salesParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION_DIR = path.join(PROJECT_ROOT, 'MIGRATION SAMPEL');
const TEMP_DIR = path.join(PROJECT_ROOT, 'data', 'temp_migration');
const DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, 'data', 'app.db');
const STAGING_DB_PATH = path.join(PROJECT_ROOT, 'data', 'staging.db');

let currentMsgPrefix = '';

export const migrationStatus = new Proxy({
  active: false,
  progress: 0,
  message: 'Idle',
  file: null as string | null,
  isStagingReady: false,
  errorCount: 0,
  startTime: null as number | null,
}, {
  set(target: any, prop: string, value: any) {
    if (prop === 'message' && typeof value === 'string' && currentMsgPrefix) {
      if (!value.startsWith(currentMsgPrefix)) {
        value = `${currentMsgPrefix}${value}`;
      }
    }
    target[prop] = value;
    eventService.broadcast('migration_update', { ...target });
    return true;
  }
});

async function ensureMigrationErrorsTable(db: any) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS migration_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT,
      row_index INTEGER,
      raw_data TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.run('DELETE FROM migration_errors');
}

function validateAndCleanCSVRow(row: any, mapping?: Record<string, string>): { isValid: boolean; errors: string[]; cleaned: any } {
  const errors: string[] = [];
  const cleaned = { ...row };

  if (mapping) {
    for (const [rawKey, targetCol] of Object.entries(mapping)) {
      if (targetCol === 'IGNORE' || !targetCol) continue;
      const rawVal = row[rawKey];
      if (rawVal === undefined || rawVal === null) continue;

      if (targetCol === 'quantity' || targetCol === 'loose_qty' || targetCol === 'loose_quantity') {
        const valStr = String(rawVal).trim();
        const parsed = parseInt(valStr, 10);
        if (valStr !== '' && (isNaN(parsed) || parsed < 0)) {
          errors.push(`${targetCol} must be a non-negative integer: "${rawVal}"`);
        } else if (valStr !== '') {
          cleaned[rawKey] = parsed;
        }
      }
      else if (targetCol === 'mrp' || targetCol === 'cost_price' || targetCol === 'total_amount' || targetCol === 'cgst' || targetCol === 'sgst' || targetCol === 'discount') {
        const valStr = String(rawVal).trim();
        const parsed = parseFloat(valStr);
        if (valStr !== '' && (isNaN(parsed) || parsed < 0)) {
          errors.push(`${targetCol} must be a non-negative decimal: "${rawVal}"`);
        } else if (valStr !== '') {
          cleaned[rawKey] = parsed;
        }
      }
      else if (targetCol === 'expiry_date') {
        const valStr = String(rawVal).trim();
        if (valStr !== '' && !valStr.includes('/') && !valStr.includes('-')) {
          const date = new Date(valStr);
          if (isNaN(date.getTime())) {
            errors.push(`Invalid date format for expiry: "${rawVal}"`);
          }
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors, cleaned };
}

// Ensure directories exist
if (!fs.existsSync(MIGRATION_DIR)) fs.mkdirSync(MIGRATION_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

export interface MigrationTask {
  fileName: string;
  dataType: string;
  mapping?: Record<string, string>;
  skipLines?: number;
  sheetIndex?: number;
  filters?: any;
  medicineActions?: any;
}

let isQueueRunning = false;
let migrationQueue: MigrationTask[] = [];

export async function runManualMigrationQueue(tasks: MigrationTask[]): Promise<void> {
  if (migrationStatus.active || isQueueRunning) {
    throw new Error('A migration is already in progress.');
  }

  isQueueRunning = true;
  migrationQueue = [...tasks];

  // Start background processing
  (async () => {
    try {
      Object.assign(migrationStatus, {
        active: true,
        progress: 0,
        message: 'Starting migration queue...',
        file: null,
        isStagingReady: false,
        errorCount: 0,
        startTime: Date.now()
      });

      const totalTasks = migrationQueue.length;
      let completedTasks = 0;

      while (migrationQueue.length > 0) {
        const task = migrationQueue.shift()!;
        const taskIndex = completedTasks;
        
        currentMsgPrefix = `[File ${taskIndex + 1}/${totalTasks}] `;
        
        const filePath = path.join(MIGRATION_DIR, task.fileName);
        if (!fs.existsSync(filePath)) {
          throw new Error(`File ${task.fileName} does not exist in MIGRATION SAMPEL folder.`);
        }

        const lowerFileName = task.fileName.toLowerCase();
        const allowedExtensions = ['.zip', '.sql', '.gz', '.tgz', '.tar.gz', '.csv', '.xlsx', '.xls'];
        const isValid = allowedExtensions.some(ext => lowerFileName.endsWith(ext));

        if (!isValid) {
          throw new Error(`Unsupported file format for ${task.fileName}.`);
        }

        await processMigrationFile(
          filePath,
          task.dataType,
          task.mapping,
          task.skipLines || 0,
          task.sheetIndex || 0,
          task.filters,
          task.medicineActions,
          migrationQueue.length > 0
        );

        completedTasks++;
      }

      currentMsgPrefix = '';
      Object.assign(migrationStatus, {
        active: false,
        progress: 100,
        message: 'Staging Complete! Awaiting user verification.',
        file: null,
        isStagingReady: true
      });
    } catch (err: any) {
      console.error('Migration queue processing failed:', err);
      migrationQueue = [];
      currentMsgPrefix = '';
      Object.assign(migrationStatus, {
        active: false,
        progress: 0,
        message: `Failed: ${err.message}`,
        file: null,
        isStagingReady: false
      });
    } finally {
      isQueueRunning = false;
    }
  })();
}

export async function runManualMigration(
  fileName: string,
  dataType: string,
  mapping?: Record<string, string>,
  skipLines: number = 0,
  sheetIndex: number = 0,
  filters?: any,
  medicineActions?: any
): Promise<void> {
  await runManualMigrationQueue([{
    fileName,
    dataType,
    mapping,
    skipLines,
    sheetIndex,
    filters,
    medicineActions
  }]);
}

async function processMigrationFile(
  originalFilePath: string,
  dataType: string,
  mapping?: Record<string, string>,
  skipLines: number = 0,
  sheetIndex: number = 0,
  filters?: any,
  medicineActions?: any,
  isIntermediate: boolean = false
) {
  let extractPath: string | undefined = undefined;
  let tempCsvPath = '';
  let tempProcessingPath = '';
  try {
    const ext = path.extname(originalFilePath).toLowerCase();
    const basename = path.basename(originalFilePath);
    
    // Copy the original file to a temp copy inside TEMP_DIR and work on that copy
    tempProcessingPath = path.join(TEMP_DIR, `proc_${Date.now()}_${basename}`);
    fs.copyFileSync(originalFilePath, tempProcessingPath);

    Object.assign(migrationStatus, { active: true, progress: 0, message: 'Processing migration file...', file: basename, errorCount: 0 });

    const archiveDir = path.join(PROJECT_ROOT, 'data', 'archived_migrations');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    // Step 0: Always recreate staging.db from scratch to avoid corrupt leftovers from failed retries
    if (fs.existsSync(STAGING_DB_PATH)) {
      try { fs.unlinkSync(STAGING_DB_PATH); } catch (_) {}
      try { fs.unlinkSync(STAGING_DB_PATH + '-wal'); } catch (_) {}
      try { fs.unlinkSync(STAGING_DB_PATH + '-shm'); } catch (_) {}
    }
    migrationStatus.message = 'Creating staging database...';
    if (fs.existsSync(DB_PATH)) {
      // ponytail: removed dbManager.close(true) — it killed the global singleton
      // while Express routes were actively serving, causing SQLITE_MISUSE errors.
      // The WAL checkpoint below uses a separate better-sqlite3 handle which is safe.

      // 1. Checkpoint WAL of active app.db to merge frames safely before copying
      try {
        const Database = (await import('better-sqlite3')).default;
        const appDb = new Database(DB_PATH);
        appDb.pragma('wal_checkpoint(FULL)');
        appDb.close();
      } catch (checkpointErr) {
        console.warn('[Migration Worker] Failed to checkpoint app.db WAL before copy:', checkpointErr);
      }

      // 2. Perform file copy
      await fs.promises.copyFile(DB_PATH, STAGING_DB_PATH);

      // 3. Immediately validate the integrity of staging.db
      try {
        const Database = (await import('better-sqlite3')).default;
        const checkDb = new Database(STAGING_DB_PATH, { readonly: true });
        const checkResult = checkDb.pragma('integrity_check') as any;
        checkDb.close();
        if (!checkResult || !checkResult[0] || checkResult[0].integrity_check !== 'ok') {
          throw new Error(`Integrity check result not ok: ${JSON.stringify(checkResult)}`);
        }
      } catch (integrityErr: any) {
        throw new Error(`Failed to copy staging database securely: ${integrityErr.message}`);
      }
    }

    let actualFilePath = tempProcessingPath;
    let sqlFilePath = tempProcessingPath;

    if (ext === '.xlsx' || ext === '.xls') {
      migrationStatus.message = 'Excel file detected — converting to CSV...';
      const workbook = XLSX.readFile(tempProcessingPath);
      const sheetName = workbook.SheetNames[sheetIndex] || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const csvContent = XLSX.utils.sheet_to_csv(worksheet);

      tempCsvPath = path.join(TEMP_DIR, `converted_${Date.now()}.csv`);
      fs.writeFileSync(tempCsvPath, csvContent);
      actualFilePath = tempCsvPath;
    }

    if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
      migrationStatus.message = `CSV/Excel file detected — starting dynamic ${dataType} import into staging...`;
      await parseAndImportCSV(actualFilePath, STAGING_DB_PATH, dataType, mapping, skipLines, filters, medicineActions);
      if (!isIntermediate) {
        Object.assign(migrationStatus, { active: false, progress: 100, message: 'Staging Complete! Awaiting user verification.', file: null, isStagingReady: true });
      }
      if (!originalFilePath.includes('archived_migrations')) {
        try {
          fs.copyFileSync(tempProcessingPath, path.join(archiveDir, basename));
        } catch (archiveErr) {
          console.warn('Failed to archive migration file:', archiveErr);
        }
      }
      if (tempCsvPath && fs.existsSync(tempCsvPath)) {
        fs.unlinkSync(tempCsvPath);
      }
      return;
    }
    else if (ext === '.sql') {
      // Direct SQL file — use as-is
      sqlFilePath = tempProcessingPath;
    }
    else if (ext === '.gz' || tempProcessingPath.toLowerCase().endsWith('.sql.gz')) {
      migrationStatus.message = 'Decompressing GZIP file...';
      extractPath = path.join(TEMP_DIR, `extract_${Date.now()}`);
      fs.mkdirSync(extractPath, { recursive: true });
      sqlFilePath = path.join(extractPath, 'decompressed_backup.sql');

      await new Promise<void>((resolve, reject) => {
        const gzStream = zlib.createGunzip();
        gzStream.on('error', reject);
        const writeStream = fs.createWriteStream(sqlFilePath);
        writeStream.on('close', resolve);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        fs.createReadStream(tempProcessingPath)
          .pipe(gzStream)
          .pipe(writeStream);
      });
    }
    else if (ext === '.zip') {
      extractPath = path.join(TEMP_DIR, `extract_${Date.now()}`);
      fs.mkdirSync(extractPath, { recursive: true });

      // ponytail: check magic bytes to detect GZIP-named-as-.zip before trying unzipper
      const headerBuf = Buffer.alloc(2);
      const fdCheck = fs.openSync(tempProcessingPath, 'r');
      fs.readSync(fdCheck, headerBuf, 0, 2, 0);
      fs.closeSync(fdCheck);
      const isActuallyGzip = headerBuf[0] === 0x1f && headerBuf[1] === 0x8b;

      if (isActuallyGzip) {
        // GZIP file with .zip extension — decompress directly, skip unzipper
        migrationStatus.message = 'Decompressing GZIP backup (detected inside .zip container)...';
        sqlFilePath = path.join(extractPath, 'decompressed_backup.sql');
        await new Promise<void>((resolve, reject) => {
          const gzStream = zlib.createGunzip();
          gzStream.on('error', reject);
          const writeStream = fs.createWriteStream(sqlFilePath);
          writeStream.on('close', resolve);
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
          fs.createReadStream(tempProcessingPath)
            .pipe(gzStream)
            .pipe(writeStream);
        });
      } else {
        // True ZIP archive — extract with unzipper then find the SQL file
        try {
          await fs.createReadStream(tempProcessingPath)
            .pipe(unzipper.Extract({ path: extractPath }))
            .promise();
        } catch (unzipError: any) {
          throw new Error(`Failed to extract ZIP file: ${unzipError.message}`);
        }

        migrationStatus.message = 'Scanning extracted files...';
        const files = fs.readdirSync(extractPath);
        const sqlFile = files.find(f => f.toLowerCase().endsWith('.sql'));
        if (!sqlFile) {
          throw new Error('No .sql file found in the ZIP archive');
        }
        sqlFilePath = path.join(extractPath, sqlFile);
      }
    }
    else if (ext === '.tar' || ext === '.tgz' || tempProcessingPath.toLowerCase().endsWith('.tar.gz')) {
      migrationStatus.message = 'Extracting TAR archive...';
      extractPath = path.join(TEMP_DIR, `extract_${Date.now()}`);
      fs.mkdirSync(extractPath, { recursive: true });

      const { execSync } = await import('child_process');
      try {
        execSync(`tar -xf "${tempProcessingPath}" -C "${extractPath}"`);
      } catch (tarError: any) {
        throw new Error(`Failed to extract TAR archive: ${tarError.message}`);
      }

      const findSqlFile = (dir: string): string | null => {
        const list = fs.readdirSync(dir);
        for (const item of list) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const found = findSqlFile(fullPath);
            if (found) return found;
          } else if (item.toLowerCase().endsWith('.sql')) {
            return fullPath;
          }
        }
        return null;
      };

      const foundSql = findSqlFile(extractPath);
      if (!foundSql) {
        throw new Error('No .sql file found in the TAR archive');
      }
      sqlFilePath = foundSql;
    }
    else {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    // Auto-detect format: PostgreSQL COPY or legacy INSERT
    migrationStatus.message = 'Detecting dump format...';
    const formatDetected = await detectDumpFormat(sqlFilePath);

    if (formatDetected === 'pg_dump') {
      migrationStatus.message = 'PostgreSQL dump detected — starting multi-pass import into staging...';
      await parseAndImportPgDump(sqlFilePath, STAGING_DB_PATH);
    } else {
      migrationStatus.message = 'Legacy SQL format detected — parsing INSERT statements into staging...';
      await parseAndImportLegacySQL(sqlFilePath, STAGING_DB_PATH);
    }

    if (!isIntermediate) {
      Object.assign(migrationStatus, { active: false, progress: 100, message: 'Staging Complete! Awaiting user verification.', file: null, isStagingReady: true });
    }

    // Archive the copy under the original name
    if (!originalFilePath.includes('archived_migrations')) {
      try {
        fs.copyFileSync(tempProcessingPath, path.join(archiveDir, basename));
      } catch (archiveErr) {
        console.warn('Failed to archive migration file:', archiveErr);
      }
    }

  } catch (err: any) {
    console.error('Migration failed:', err);
    Object.assign(migrationStatus, { active: false, progress: 0, message: `Failed: ${err.message}`, file: null });
    throw err; // Re-throw so caller knows it failed
  } finally {
    if (tempProcessingPath && fs.existsSync(tempProcessingPath)) {
      try {
        fs.unlinkSync(tempProcessingPath);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp copy:', cleanupError);
      }
    }
    if (extractPath && fs.existsSync(extractPath)) {
      try {
        fs.rmSync(extractPath, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Failed to cleanup extraction directory:', cleanupError);
      }
    }
  }
}

/**
 * Detect if a SQL file is a PostgreSQL pg_dump or legacy INSERT-based format.
 */
async function detectDumpFormat(sqlPath: string): Promise<'pg_dump' | 'legacy'> {
  const fileStream = fs.createReadStream(sqlPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const headerLines: string[] = [];

  for await (const line of rl) {
    headerLines.push(line);
    if (headerLines.length >= 30) break;
  }
  rl.close();
  fileStream.destroy();

  return isPgDump(headerLines) ? 'pg_dump' : 'legacy';
}

/**
 * Multi-pass PostgreSQL dump importer.
 * 
 * Pass 1: Reference tables (category, manufacturer, distributor, doctor, patient)
 * Pass 2: Medicine master (286K rows)
 * Pass 3: Inventory & stock (batch, inventory, inventory_medicine)
 * Pass 4: Sales & returns (orders, order_item, return_orders, return_order_item, stock_effects)
 */
async function parseAndImportPgDump(sqlPath: string, targetDbPath: string) {
  const db = await open({ filename: targetDbPath, driver: sqlite3.Database });
  try {
    // Enable WAL mode for better concurrent write performance
    await db.run('PRAGMA journal_mode = WAL');
  await db.run('PRAGMA synchronous = NORMAL');
  await db.run('PRAGMA cache_size = -64000'); // 64MB cache
  await db.run('PRAGMA busy_timeout = 30000'); // 30s wait on lock

  await ensureMigrationErrorsTable(db);

  // Clear all maps for a fresh import
  clearAllMaps();
  clearPurchaseMap();
  clearSalesMap();
  clearReturnsMap();
  clearPaymentsMap();
  clearB2BMap();
  clearExtrasMap();

  // Prevent duplicate legacy records if the migration is run again
  const tablesWithLegacyId = [
    'medicines', 'distributors', 'customers', 'doctors',
    'purchases', 'purchase_items', 'sales_invoices', 'sale_items',
    'returns', 'return_items', 'stock_ledger',
    'distributor_payments', 'distributor_payment_details', 'order_credits',
    'purchase_orders', 'purchase_order_items',
    'b2b_invoices', 'b2b_invoice_items'
  ];
  for (const table of tablesWithLegacyId) {
    try {
      await db.run(`DELETE FROM ${table} WHERE legacy_id IS NOT NULL`);
    } catch (err) {
      // Ignore if table/column does not exist
    }
  }
  try {
    await db.run(`DELETE FROM inventory_master WHERE legacy_batch_id IS NOT NULL`);
  } catch (err) { }

  const totalPasses = 4;
  const stats = {
    categories: 0,
    manufacturers: 0,
    distributors: 0,
    doctors: 0,
    patients: 0,
    medicines: 0,
    batches: 0,
    purchases: 0,
    purchaseItems: 0,
    salesInvoices: 0,
    saleItems: 0,
    returns: 0,
    returnItems: 0,
    stockLedger: 0,
    payments: 0,
    paymentDetails: 0,
    orderCredits: 0,
    b2bInvoices: 0,
    b2bItems: 0,
    purchaseOrders: 0,
    purchaseOrderItems: 0,
    scheduledOrders: 0,
  };

  // ─── PASS 1: Reference Tables ─────────────────────────────
  migrationStatus.message = 'Pass 1/4: Importing reference tables (distributors, doctors, patients, customers, generics)...';
  migrationStatus.progress = 5;

  let errorCount = 0;
  const logError = async (table: string, row: Record<string, string|null>, err: any) => {
    errorCount++;
    migrationStatus.errorCount = errorCount;
    try {
      await db.run(
        'INSERT INTO migration_errors (file_name, row_index, raw_data, error_message) VALUES (?, ?, ?, ?)',
        [table, errorCount, JSON.stringify(row).slice(0, 1000), String(err?.message || err).slice(0, 500)]
      );
    } catch (_) { /* don't crash on logging failure */ }
  };

  const wrap = (table: string, fn: (row: Record<string, string|null>) => Promise<void> | void) =>
    async (row: Record<string, string|null>) => {
      try { await fn(row); } catch (e: any) { await logError(table, row, e); }
    };

  await streamPgDump(sqlPath, {
    'category': wrap('category', (row) => { importCategory(row); stats.categories++; }),
    'manufacturer': wrap('manufacturer', (row) => { importManufacturer(row); stats.manufacturers++; }),
    'generic': wrap('generic', (row) => { importGeneric(row); }),
    'distributor': wrap('distributor', async (row) => { await importDistributor(row, db); stats.distributors++; }),
    'doctor': wrap('doctor', async (row) => { await importDoctor(row, db); stats.doctors++; }),
    'patient': wrap('patient', async (row) => { await importPatient(row, db); stats.patients++; }),
    'customer': wrap('customer', async (row) => { await importCustomer(row, db); stats.patients++; }),
  }, db);

  // Flush remaining batches
  await flushDistributors(db);
  await flushDoctors(db);
  await flushPatients(db);
  await flushCustomers(db);

  migrationStatus.message = `Pass 1 done: ${stats.categories} categories, ${stats.manufacturers} mfg, ${stats.distributors} distributors, ${stats.doctors} doctors, ${stats.patients} patients/customers`;
  migrationStatus.progress = 20;
  console.log(migrationStatus.message);

  // ─── PASS 2: Medicine Master ──────────────────────────────
  migrationStatus.message = 'Pass 2/4: Importing medicines (this may take a moment)...';
  migrationStatus.progress = 25;

  await streamPgDump(sqlPath, {
    'medicine': wrap('medicine', async (row) => {
      await importMedicine(row, db);
      stats.medicines++;
      if (stats.medicines % 10000 === 0) {
        migrationStatus.message = `Pass 2/4: Imported ${stats.medicines} medicines...`;
        migrationStatus.progress = 25 + Math.min(20, Math.floor(stats.medicines / 15000));
      }
    }),
  }, db);

  await flushMedicines(db);

  migrationStatus.message = `Pass 2 done: ${stats.medicines} medicines imported`;
  migrationStatus.progress = 45;
  console.log(migrationStatus.message);

  // ─── PASS 3: Inventory & Stock ────────────────────────────
  migrationStatus.message = 'Pass 3/4: Importing purchases, batches, and inventory...';
  migrationStatus.progress = 50;

  await streamPgDump(sqlPath, {
    'batch': wrap('batch', async (row) => { await importBatch(row, db); stats.batches++; }),
    'inventory': wrap('inventory', async (row) => { await importInventory(row, db); stats.purchases++; }),
    'inventory_medicine': wrap('inventory_medicine', async (row) => { await importInventoryMedicine(row, db); stats.purchaseItems++; }),
  }, db);

  await flushBatches(db);
  await flushPurchases(db);
  await flushPurchaseItems(db);

  migrationStatus.message = `Pass 3 done: ${stats.batches} batches, ${stats.purchases} purchases, ${stats.purchaseItems} purchase items`;
  migrationStatus.progress = 70;
  console.log(migrationStatus.message);

  // ─── PASS 4: Sales & Returns (Part 1: Invoices and Returns) ──────────────
  migrationStatus.message = 'Pass 4/5: Importing sales invoices and return orders...';
  migrationStatus.progress = 75;

  await streamPgDump(sqlPath, {
    'orders': wrap('orders', async (row) => { await importOrder(row, db); stats.salesInvoices++; }),
    'return_orders': wrap('return_orders', async (row) => { await importReturnOrder(row, db); stats.returns++; }),
  }, db);

  await flushSalesInvoices(db);
  await flushReturns(db);

  // ─── PASS 5: Sales & Returns (Part 2: Items & Movements) ───────────────
  migrationStatus.message = 'Pass 5/5: Importing sale items, return items, and stock ledger...';
  migrationStatus.progress = 85;

  await streamPgDump(sqlPath, {
    'order_item': wrap('order_item', async (row) => { await importOrderItem(row, db); stats.saleItems++; }),
    'return_order_item': wrap('return_order_item', async (row) => { await importReturnOrderItem(row, db); stats.returnItems++; }),
    'stock_effects': wrap('stock_effects', async (row) => { await importStockEffect(row, db); stats.stockLedger++; }),
  }, db);

  await flushSaleItems(db);
  await flushReturnItems(db);
  await flushStockLedger(db);

  // Rebuild inventory quantities from stock_ledger (batches were imported with qty=0)
  migrationStatus.message = 'Rebuilding inventory quantities from stock ledger...';
  try {
    await db.run(`
      UPDATE inventory_master
      SET quantity = COALESCE((
        SELECT SUM(sl.quantity)
        FROM stock_ledger sl
        WHERE sl.medicine_id = inventory_master.medicine_id
          AND sl.batch_no = inventory_master.batch_no
      ), 0)
      WHERE legacy_batch_id IS NOT NULL
    `);
    console.log('[Migration] Inventory quantities rebuilt from stock_ledger');
  } catch (qtyErr: any) {
    console.warn('[Migration] Stock quantity rebuild skipped:', qtyErr.message);
  }

  migrationStatus.message = `Pass 5 done: ${stats.salesInvoices} invoices, ${stats.saleItems} sale items, ${stats.returns} returns, ${stats.stockLedger} stock movements`;
  migrationStatus.progress = 88;
  console.log(migrationStatus.message);

  // ─── PASS 6: Payments, Credits & B2B ────────────────────────
  migrationStatus.message = 'Pass 6/7: Importing payments, credits, and B2B sales...';
  migrationStatus.progress = 89;

  await streamPgDump(sqlPath, {
    'payments': wrap('payments', async (row) => { await importPayment(row, db); stats.payments++; }),
    'order_credit': wrap('order_credit', async (row) => { await importOrderCredit(row, db); stats.orderCredits++; }),
    'b2b_sales': wrap('b2b_sales', async (row) => { await importB2BSale(row, db); stats.b2bInvoices++; }),
    'cr_note_resolution': wrap('cr_note_resolution', async (row) => { await importCrNoteResolution(row, db); }),
  }, db);

  await flushPayments(db);
  await flushOrderCredits(db);
  await flushB2BInvoices(db);

  // Payment details and B2B items depend on parent maps from above
  await streamPgDump(sqlPath, {
    'payment_details': wrap('payment_details', async (row) => { await importPaymentDetail(row, db); stats.paymentDetails++; }),
    'b2b_sales_item': wrap('b2b_sales_item', async (row) => { await importB2BSaleItem(row, db); stats.b2bItems++; }),
  }, db);

  await flushPaymentDetails(db);
  await flushB2BItems(db);

  migrationStatus.message = `Pass 6 done: ${stats.payments} payments, ${stats.orderCredits} credits, ${stats.b2bInvoices} B2B invoices`;
  migrationStatus.progress = 93;
  console.log(migrationStatus.message);

  // ─── PASS 7: Purchase Orders, Scheduled Orders & Settings ───
  migrationStatus.message = 'Pass 7/7: Importing purchase orders, schedules, and shop settings...';
  migrationStatus.progress = 94;

  await streamPgDump(sqlPath, {
    'purchase_order': wrap('purchase_order', async (row) => { await importPurchaseOrder(row, db); stats.purchaseOrders++; }),
    'scheduled_orders': wrap('scheduled_orders', async (row) => { await importScheduledOrder(row, db); stats.scheduledOrders++; }),
    'retailer': wrap('retailer', async (row) => { await importRetailer(row, db); }),
  }, db);

  await flushPurchaseOrders(db);
  await flushRefills(db);

  await streamPgDump(sqlPath, {
    'purchase_order_item': wrap('purchase_order_item', async (row) => { await importPurchaseOrderItem(row, db); stats.purchaseOrderItems++; }),
  }, db);

  await flushPurchaseOrderItems(db);

  migrationStatus.message = `Pass 7 done: ${stats.purchaseOrders} POs, ${stats.scheduledOrders} schedules`;
  migrationStatus.progress = 97;
  console.log(migrationStatus.message);

    // ─── Generate Summary Report ──────────────────────────────
    migrationStatus.message = 'Generating migration summary report...';
    await generateMigrationReport(db, stats);

    migrationStatus.message = `Migration Complete! ${stats.medicines} medicines, ${stats.purchases} purchases, ${stats.salesInvoices} sales, ${stats.returns} returns, ${stats.payments} payments, ${stats.b2bInvoices} B2B invoices, ${stats.purchaseOrders} POs imported.`;
    migrationStatus.progress = 100;
    console.log('=== MIGRATION COMPLETE ===');
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await db.close();
  }
}

/**
 * Stream a pg_dump SQL file and call handlers for matching tables.
 */
async function streamPgDump(
  sqlPath: string,
  handlers: Record<string, (row: Record<string, string | null>) => Promise<void> | void>,
  db: any
) {
  const fileStream = fs.createReadStream(sqlPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentTable: string | null = null;
  let currentColumns: string[] = [];
  let activeHandler: ((row: Record<string, string | null>) => Promise<void> | void) | null = null;

  for await (const line of rl) {
    // Check for COPY header
    if (line.startsWith('COPY public.')) {
      const parsed = parseCopyHeader(line);
      if (parsed && handlers[parsed.table]) {
        currentTable = parsed.table;
        currentColumns = parsed.columns;
        activeHandler = handlers[parsed.table];
      } else {
        currentTable = null;
        activeHandler = null;
      }
      continue;
    }

    // Check for end of COPY data
    if (isCopyEndMarker(line)) {
      // Flush database buffers when the COPY block finishes
      if (currentTable === 'orders') {
        await flushSalesInvoices(db);
      } else if (currentTable === 'order_item') {
        await flushSaleItems(db);
      } else if (currentTable === 'return_orders') {
        await flushReturns(db);
      } else if (currentTable === 'return_order_item') {
        await flushReturnItems(db);
      } else if (currentTable === 'stock_effects') {
        await flushStockLedger(db);
      } else if (currentTable === 'distributor') {
        await flushDistributors(db);
      } else if (currentTable === 'doctor') {
        await flushDoctors(db);
      } else if (currentTable === 'patient') {
        await flushPatients(db);
      } else if (currentTable === 'customer') {
        await flushCustomers(db);
      } else if (currentTable === 'medicine') {
        await flushMedicines(db);
      } else if (currentTable === 'batch') {
        await flushBatches(db);
      } else if (currentTable === 'inventory') {
        await flushPurchases(db);
      } else if (currentTable === 'inventory_medicine') {
        await flushPurchaseItems(db);
      } else if (currentTable === 'payments') {
        await flushPayments(db);
      } else if (currentTable === 'payment_details') {
        await flushPaymentDetails(db);
      } else if (currentTable === 'order_credit') {
        await flushOrderCredits(db);
      } else if (currentTable === 'b2b_sales') {
        await flushB2BInvoices(db);
      } else if (currentTable === 'b2b_sales_item') {
        await flushB2BItems(db);
      } else if (currentTable === 'purchase_order') {
        await flushPurchaseOrders(db);
      } else if (currentTable === 'purchase_order_item') {
        await flushPurchaseOrderItems(db);
      } else if (currentTable === 'scheduled_orders') {
        await flushRefills(db);
      }

      currentTable = null;
      currentColumns = [];
      activeHandler = null;
      continue;
    }

    // Process data row if we have an active handler
    if (activeHandler && currentColumns.length > 0) {
      const rowData = parseCopyDataRow(line, currentColumns);
      await activeHandler(rowData);
    }
  }

  rl.close();
  fileStream.destroy();
}

/**
 * Generate migration summary report files.
 */
async function generateMigrationReport(db: any, stats: any) {
  const reportsDir = path.join(PROJECT_ROOT, 'data', 'migration_reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  // Summary report
  const summary = {
    migration_date: new Date().toISOString(),
    source_format: 'PostgreSQL pg_dump',
    stats,
    id_maps: {
      distributors: distributorMap.size,
      doctors: doctorMap.size,
      patients_as_customers: patientMap.size,
      medicines: medicineMap.size,
      batches: batchMap.size,
      purchases: purchaseMap.size,
      sales_invoices: salesInvoiceMap.size,
      returns: returnMap.size,
      payments: paymentMap.size,
      b2b_invoices: b2bInvoiceMap.size,
      purchase_orders: purchaseOrderMap.size,
    }
  };

  fs.writeFileSync(
    path.join(reportsDir, 'migration_summary.json'),
    JSON.stringify(summary, null, 2)
  );

  // Quick row-count verification from SQLite
  const counts: Record<string, number> = {};
  const tables = ['medicines', 'distributors', 'customers', 'doctors', 'inventory_master', 'purchases', 'purchase_items', 'sales_invoices', 'sale_items', 'returns', 'return_items', 'stock_ledger', 'distributor_payments', 'distributor_payment_details', 'order_credits', 'b2b_invoices', 'b2b_invoice_items', 'purchase_orders', 'purchase_order_items'];
  for (const tbl of tables) {
    try {
      const row = await db.get(`SELECT COUNT(*) as cnt FROM ${tbl}`);
      counts[tbl] = row?.cnt || 0;
    } catch {
      counts[tbl] = -1; // table doesn't exist
    }
  }

  fs.writeFileSync(
    path.join(reportsDir, 'row_counts.json'),
    JSON.stringify(counts, null, 2)
  );

  console.log('Migration reports saved to:', reportsDir);
}

/**
 * Legacy SQL parser (INSERT-based) — kept for backward compatibility.
 */
async function parseAndImportLegacySQL(sqlPath: string, targetDbPath: string) {
  migrationStatus.message = 'Parsing and Importing SQL Data (legacy format)...';

  const db = await open({ filename: targetDbPath, driver: sqlite3.Database });
  try {
    await db.run('PRAGMA busy_timeout = 30000');
    await ensureMigrationErrorsTable(db);

    const fileStream = fs.createReadStream(sqlPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let linesProcessed = 0;
    let linesMigrated = 0;

    for await (const line of rl) {
      const trimmedLine = line.trim();

      // Yield every 500 lines to keep event loop free
      if (linesProcessed % 500 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }

      if (!trimmedLine) {
        linesProcessed++;
        if (linesProcessed % 1000 === 0) {
          migrationStatus.progress = Math.min(99, Math.floor(linesProcessed / 1000));
          migrationStatus.message = `Processed ${linesProcessed} lines, migrated ${linesMigrated} rows...`;
        }
        continue;
      }

      let migrated = false;

      try {
        if (trimmedLine.toUpperCase().startsWith('INSERT INTO LEGACY_RETURNS')) {
          migrated = await processReturnsLine(trimmedLine, db);
        }
        else if (trimmedLine.toUpperCase().startsWith('INSERT INTO LEGACY_STOCK') ||
          trimmedLine.toUpperCase().startsWith('INSERT INTO LEGACY_BATCHES')) {
          migrated = await processInventoryLine(trimmedLine, db);
        }
        else if (trimmedLine.toUpperCase().startsWith('INSERT INTO LEGACY_SALES') ||
          trimmedLine.toUpperCase().startsWith('INSERT INTO LEGACY_SALEITEMS') ||
          trimmedLine.toUpperCase().startsWith('INSERT INTO LEGACY_SALE_ITEMS')) {
          migrated = await processSalesLine(trimmedLine, db);
        }
      } catch (err: any) {
        migrationStatus.errorCount++;
        const errMsg = err.message || 'Unknown processing error';
        await db.run(
          'INSERT INTO migration_errors (file_name, row_index, raw_data, error_message) VALUES (?, ?, ?, ?)',
          [path.basename(sqlPath), linesProcessed, trimmedLine.slice(0, 1000), errMsg]
        );
      }

      if (migrated) {
        linesMigrated++;
      }

      linesProcessed++;
      if (linesProcessed % 1000 === 0) {
        migrationStatus.progress = Math.min(99, Math.floor(linesProcessed / 1000));
        migrationStatus.message = `Processed ${linesProcessed} lines, migrated ${linesMigrated} rows...`;
      }
    }

    migrationStatus.message = `Migration Complete! Processed ${linesProcessed} lines, migrated ${linesMigrated} rows`;
  } finally {
    await db.close();
  }
}

/**
 * Dynamic CSV parser and importer for multiple data types.
 * Automatically creates missing columns in inventory_master or maps them using the provided mapping.
 */
async function parseAndImportCSV(csvPath: string, targetDbPath: string, dataType: string, mapping?: Record<string, string>, skipLines: number = 0, filters?: any, medicineActions?: any) {
  const db = await open({ filename: targetDbPath, driver: sqlite3.Database });
  try {
    await db.run('PRAGMA busy_timeout = 30000');
    await ensureMigrationErrorsTable(db);

  if (skipLines > 0) {
    try {
      const content = fs.readFileSync(csvPath, 'utf8');
      const lines = content.split(/\r?\n/).slice(0, skipLines);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          await db.run(
            'INSERT INTO migration_errors (file_name, row_index, raw_data, error_message) VALUES (?, ?, ?, ?)',
            [path.basename(csvPath), i + 1, line, 'Skipped Row (Header)']
          );
        }
      }
    } catch (e) {
      console.error('[MigrationWorker] Failed to log skipped lines:', e);
    }
  }

  const tableInfo = await db.all('PRAGMA table_info(inventory_master)');
  const existingCols = tableInfo.map(c => c.name.toLowerCase());

  // Alter schema for custom fields dynamically
  if (mapping) {
    for (const [csvCol, targetCol] of Object.entries(mapping)) {
      if (targetCol && String(targetCol).startsWith('custom_col_')) {
        const dbColName = String(targetCol).substring(11).trim().replace(/\s+/g, '_').toLowerCase();

        let targetTable = 'medicines';
        if (dataType === 'customers') targetTable = 'customers';
        else if (dataType === 'sales') targetTable = 'sales_invoices';
        else if (dataType === 'purchases') targetTable = 'purchases';
        else if (dataType === 'returns') targetTable = 'returns';

        const targetTableInfo = await db.all(`PRAGMA table_info(${targetTable})`);
        const existingTableCols = targetTableInfo.map(c => c.name.toLowerCase());

        if (dbColName && !existingTableCols.includes(dbColName)) {
          try {
            await db.run(`ALTER TABLE ${targetTable} ADD COLUMN "${dbColName}" TEXT`);
            console.log(`[MigrationWorker] Dynamically added custom column "${dbColName}" to ${targetTable} table.`);
          } catch (alterErr: any) {
            console.error(`[MigrationWorker] Failed to add custom column ${dbColName} to ${targetTable}:`, alterErr.message);
          }
        }
      }
    }
  }

  const results: any[] = [];
  let rowCount = 0;

  migrationStatus.message = 'Reading and analyzing CSV structure...';

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csvParser({ skipLines: skipLines })) // Skip user-defined garbage rows
      .on('headers', async (headers) => {
        if (dataType === 'inventory' || dataType === 'combined') {
          for (const rawHeader of headers) {
            const rawColName = rawHeader.trim();
            if (!rawColName) continue;

            let colName = rawColName.replace(/\s+/g, '_').toLowerCase();

            // Apply mapping if provided
            if (mapping && mapping[rawColName] && mapping[rawColName] !== 'IGNORE') {
              colName = mapping[rawColName];
            } else if (mapping && mapping[rawColName] === 'IGNORE') {
              continue; // Skip this column entirely
            }

            if (colName === 'loose_qty') {
              colName = 'loose_quantity';
            }

            const medicineFields = [
              'api_reference', 'mrp', 'hsn_code', 'schedule_type', 'manufacturer',
              'category', 'marketed_by', 'manufactured_by', 'legacy_id', 'packaging',
              'strength', 'item_type', 'cgst', 'sgst', 'igst', 'rack',
              'generic_name', 'pack_unit', 'cgst_per', 'sgst_per', 'item_code'
            ];

            if (!existingCols.includes(colName) && colName !== '' && colName !== 'name' && !medicineFields.includes(colName) && !colName.startsWith('custom_col_')) {
              try {
                await db.run(`ALTER TABLE inventory_master ADD COLUMN "${colName}" TEXT`);
                existingCols.push(colName);
              } catch (e: any) {
                console.error(`Failed to add column ${colName}:`, e.message);
              }
            }
          }
        }
      })
      .on('data', (data) => {
        results.push(data);
        rowCount++;
        if (rowCount % 1000 === 0) {
          migrationStatus.progress = Math.min(50, Math.floor((rowCount / 50000) * 50));
        }
      })
      .on('end', async () => {
        migrationStatus.message = `Parsed ${rowCount} CSV rows. Inserting into database...`;

        await db.run('BEGIN TRANSACTION');
        try {
          let insertCount = 0;
          for (const row of results) {
            // Yield every 200 rows to keep event loop free
            if (insertCount % 200 === 0) {
              await new Promise(resolve => setImmediate(resolve));
            }

            // Apply range boundaries and evaluate filters if provided
            const rowNum = insertCount + 1;
            if (filters) {
              if (filters.ignoredRows && Array.isArray(filters.ignoredRows) && filters.ignoredRows.includes(rowNum)) {
                insertCount++;
                continue;
              }
              if (filters.rangeStart !== undefined && rowNum < Number(filters.rangeStart)) {
                insertCount++;
                continue;
              }
              if (filters.rangeEnd !== undefined && rowNum > Number(filters.rangeEnd)) {
                insertCount++;
                continue;
              }
              if (!matchesFilters(row, mapping || {}, filters)) {
                insertCount++;
                continue;
              }
            }

            // Resolve medicine name and check for skips or merges
            let nameKeyForAction = Object.keys(mapping || {}).find(k => mapping?.[k] === 'name');
            let resolvedMedName = nameKeyForAction ? String(row[nameKeyForAction] || '').trim() : '';
            if (!resolvedMedName && (dataType === 'inventory' || dataType === 'sales' || dataType === 'purchases' || dataType === 'returns')) {
              resolvedMedName = String(row['Medicine'] || row['name'] || '').trim();
            }

            if (resolvedMedName && medicineActions) {
              const actionObj = medicineActions[resolvedMedName];
              if (actionObj && actionObj.action === 'skip') {
                insertCount++;
                continue; // skip the whole row
              }
            }

            // Perform dynamic schema validation
            const validation = validateAndCleanCSVRow(row, mapping);
            if (!validation.isValid) {
              migrationStatus.errorCount++;
              const errorMsg = validation.errors.join('; ');
              await db.run(
                'INSERT INTO migration_errors (file_name, row_index, raw_data, error_message) VALUES (?, ?, ?, ?)',
                [path.basename(csvPath), insertCount + skipLines + 1, JSON.stringify(row), errorMsg]
              );
              insertCount++;
              continue;
            }

            const cleanRow = validation.cleaned;

            if (dataType === 'inventory') {
              let nameKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'name');
              let rawName = nameKey ? String(cleanRow[nameKey] || '').trim() : String(cleanRow['Medicine'] || cleanRow['name'] || 'Unknown Product').trim();
              let medName = rawName;
              if (rawName && medicineActions) {
                const actionObj = medicineActions[rawName];
                if (actionObj && actionObj.action === 'merge' && actionObj.target) {
                  medName = actionObj.target;
                }
              }

              const medCols: string[] = [];
              const medVals: any[] = [];
              const medUpdates: string[] = [];

              for (const [key, val] of Object.entries(cleanRow)) {
                if (val === undefined || val === null || val === '') continue;
                const mappedTarget = mapping?.[key];
                if (!mappedTarget || mappedTarget === 'IGNORE') continue;

                let dbCol = mappedTarget;
                let isCustom = false;
                if (dbCol.startsWith('custom_col_')) {
                  dbCol = dbCol.substring(11).trim().replace(/\s+/g, '_').toLowerCase();
                  isCustom = true;
                } else {
                  if (dbCol === 'hsncode' || dbCol === 'hsn_code') dbCol = 'hsn_code';
                  if (dbCol === 'mfg' || dbCol === 'manufacturer') dbCol = 'manufacturer';
                  if (dbCol === 'mrkby' || dbCol === 'marketed_by') dbCol = 'marketed_by';
                }
                if (dbCol === 'loos_qty' || dbCol === 'loose_qty' || dbCol === 'loose_quantity') continue; // inventory
                if (dbCol === 'rate') continue; // inventory
                if (dbCol === 'name') continue;

                const medicineFields = [
                  'api_reference', 'mrp', 'hsn_code', 'schedule_type', 'manufacturer',
                  'category', 'marketed_by', 'manufactured_by', 'legacy_id', 'packaging',
                  'strength', 'item_type', 'cgst', 'sgst', 'igst', 'rack',
                  'generic_name', 'pack_unit', 'cgst_per', 'sgst_per', 'item_code'
                ];

                if (medicineFields.includes(dbCol) || isCustom) {
                  medCols.push(`"${dbCol}"`);
                  medVals.push(val);
                  medUpdates.push(`"${dbCol}" = ?`);
                }
              }

              let med = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [medName]);
              if (!med) {
                const colsStr = ['name', ...medCols].join(', ');
                const placeholdersStr = ['?', ...medVals.map(() => '?')].join(', ');
                const result = await db.run(`INSERT INTO medicines (${colsStr}) VALUES (${placeholdersStr})`, [medName, ...medVals]);
                med = { id: result.lastID };
              } else {
                if (medUpdates.length > 0) {
                  await db.run(`UPDATE medicines SET ${medUpdates.join(', ')} WHERE id = ?`, [...medVals, med.id]);
                }
              }

              const colsToInsert = ['medicine_id'];
              const valuesToInsert = [med.id];
              const placeholders = ['?'];

              for (const [key, val] of Object.entries(cleanRow)) {
                const rawColName = key.trim();
                let colName = rawColName.replace(/\s+/g, '_').toLowerCase();

                if (mapping && mapping[rawColName] === 'IGNORE') continue;
                if (mapping && mapping[rawColName]) {
                  colName = mapping[rawColName];
                }

                if (colName === 'loose_qty' || colName === 'loose_quantity') {
                  colName = 'loose_quantity';
                }
                if (colName === 'rate') {
                  colName = 'cost_price';
                }

                if (!colName || colName === 'medicine' || colName === 'name' || val === '' || colName.startsWith('custom_col_')) continue;

                if (existingCols.includes(colName)) {
                  colsToInsert.push(`"${colName}"`);
                  if (colName === 'expiry_date') {
                    valuesToInsert.push(normalizeDate(String(val)) || val);
                  } else {
                    valuesToInsert.push(val);
                  }
                  placeholders.push('?');
                }
              }

              const batchKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'batch_no');
              const batchVal = batchKey ? String(cleanRow[batchKey] || '').trim() : '';
              const existingBatch = batchVal ? await db.get(
                'SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?',
                [med.id, batchVal]
              ) : null;

              if (existingBatch) {
                const qtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'quantity' || mapping?.[k] === 'quantity_sold' || mapping?.[k] === 'return_quantity');
                const looseQtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'loose_qty' || mapping?.[k] === 'loose_quantity');
                const rackKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'rack_location');
                const expKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'expiry_date');
                const costKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'cost_price' || mapping?.[k] === 'rate' || mapping?.[k] === 'unit_price');
                const mrpKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'mrp');

                const rawImportedData = {
                  medicine_id: med.id,
                  quantity: qtyKey ? parseInt(cleanRow[qtyKey]) || 0 : 0,
                  loose_quantity: looseQtyKey ? parseInt(cleanRow[looseQtyKey]) || 0 : 0,
                  rack_location: rackKey ? String(cleanRow[rackKey] || '').trim() : '',
                  batch_no: batchVal,
                  expiry_date: expKey ? (normalizeDate(String(cleanRow[expKey])) || String(cleanRow[expKey])) : '',
                  cost_price: costKey ? parseFloat(cleanRow[costKey]) || 0 : 0,
                  mrp: mrpKey ? parseFloat(cleanRow[mrpKey]) || 0 : 0,
                };
                await db.run(
                  'INSERT INTO migration_conflicts (module_type, raw_imported_data, matching_record_id, conflict_reason) VALUES (?, ?, ?, ?)',
                  ['inventory', JSON.stringify(rawImportedData), existingBatch.id, 'Duplicate Batch Number']
                );
              } else {
                const insertQuery = `INSERT INTO inventory_master (${colsToInsert.join(', ')}) VALUES (${placeholders.join(', ')})`;
                await db.run(insertQuery, valuesToInsert);
              }
            }
            else if (dataType === 'sales') {
              const invoiceNoKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'invoice_no' || mapping?.[k] === 'bill_no');
              const dateKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'date' || mapping?.[k] === 'return_date');
              const patientKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'patient_name');
              const doctorKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'doctor_name');
              const totalAmountKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'total_amount');
              const discountKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'discount');
              const cgstKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'cgst');
              const sgstKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'sgst');

              const invoiceNo = invoiceNoKey ? String(cleanRow[invoiceNoKey] || '').trim() : `INV-${Date.now()}-${insertCount}`;
              const dateStr = dateKey ? cleanRow[dateKey] : new Date().toISOString();
              const patientName = patientKey ? String(cleanRow[patientKey] || '').trim() : 'Walk-in Customer';
              const doctorName = doctorKey ? String(cleanRow[doctorKey] || '').trim() : 'Self';
              const totalAmount = totalAmountKey ? parseFloat(cleanRow[totalAmountKey]) || 0 : 0;
              const discount = discountKey ? parseFloat(cleanRow[discountKey]) || 0 : 0;
              const cgstVal = cgstKey ? parseFloat(cleanRow[cgstKey]) || 0 : 0;
              const sgstVal = sgstKey ? parseFloat(cleanRow[sgstKey]) || 0 : 0;

              let customer = await db.get('SELECT id FROM customers WHERE LOWER(name) = LOWER(?)', [patientName]);
              if (!customer) {
                const result = await db.run('INSERT INTO customers (name) VALUES (?)', [patientName]);
                customer = { id: result.lastID };
              }

              let doctor = await db.get('SELECT id FROM doctors WHERE LOWER(name) = LOWER(?)', [doctorName]);
              if (!doctor) {
                const result = await db.run('INSERT INTO doctors (name) VALUES (?)', [doctorName]);
                doctor = { id: result.lastID };
              }

              let invoice = await db.get('SELECT id FROM sales_invoices WHERE invoice_no = ?', [invoiceNo]);
              if (!invoice) {
                const saleCols: string[] = [];
                const saleVals: any[] = [];
                for (const [key, val] of Object.entries(cleanRow)) {
                  const mappedTarget = mapping?.[key];
                  if (mappedTarget && mappedTarget.startsWith('custom_col_')) {
                    const dbColName = mappedTarget.substring(11).trim().replace(/\s+/g, '_').toLowerCase();
                    saleCols.push(`"${dbColName}"`);
                    saleVals.push(val);
                  }
                }
                const baseCols = ['invoice_no', 'customer_id', 'doctor_id', 'date', 'total_amount', 'discount', 'cgst_value', 'sgst_value'];
                const baseVals = [invoiceNo, customer.id, doctor.id, dateStr, totalAmount, discount, cgstVal, sgstVal];
                const colsStr = [...baseCols, ...saleCols].join(', ');
                const placeholdersStr = [...baseCols, ...saleCols].map(() => '?').join(', ');
                const result = await db.run(
                  `INSERT INTO sales_invoices (${colsStr}) VALUES (${placeholdersStr})`,
                  [...baseVals, ...saleVals]
                );
                invoice = { id: result.lastID };
              }

              let nameKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'name');
              let rawName = nameKey ? String(cleanRow[nameKey] || '').trim() : String(cleanRow['Medicine'] || cleanRow['name'] || 'Unknown Product').trim();
              let medName = rawName;
              if (rawName && medicineActions) {
                const actionObj = medicineActions[rawName];
                if (actionObj && actionObj.action === 'merge' && actionObj.target) {
                  medName = actionObj.target;
                }
              }

              let med = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [medName]);
              if (!med) {
                const result = await db.run('INSERT INTO medicines (name) VALUES (?)', [medName]);
                med = { id: result.lastID };
              }

              let inv = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ?', [med.id]);
              if (!inv) {
                const result = await db.run('INSERT INTO inventory_master (medicine_id, quantity) VALUES (?, 0)', [med.id]);
                inv = { id: result.lastID };
              }

              const qtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'quantity' || mapping?.[k] === 'quantity_sold');
              const looseQtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'loose_qty' || mapping?.[k] === 'loose_quantity');
              const mrpKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'mrp');
              const rateKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'cost_price' || mapping?.[k] === 'rate' || mapping?.[k] === 'unit_price');

              const quantity = qtyKey ? parseInt(cleanRow[qtyKey]) || 0 : 0;
              const looseQty = looseQtyKey ? parseInt(cleanRow[looseQtyKey]) || 0 : 0;
              const mrp = mrpKey ? parseFloat(cleanRow[mrpKey]) || 0 : 0;
              const unitPrice = rateKey ? parseFloat(cleanRow[rateKey]) || mrp : mrp;

              await db.run(
                `INSERT INTO sale_items (invoice_id, inventory_id, quantity, loose_qty, unit_price, mrp)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [invoice.id, inv.id, quantity, looseQty, unitPrice, mrp]
              );
            }
            else if (dataType === 'purchases') {
              const invoiceNoKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'invoice_no' || mapping?.[k] === 'bill_id');
              const dateKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'date');
              const distributorKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'distributor_name');
              const totalAmountKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'total_amount');

              const invoiceNo = invoiceNoKey ? String(cleanRow[invoiceNoKey] || '').trim() : `PUR-${Date.now()}-${insertCount}`;
              const dateStr = dateKey ? cleanRow[dateKey] : new Date().toISOString();
              const distributorName = distributorKey ? String(cleanRow[distributorKey] || '').trim() : 'Unknown Supplier';
              const totalAmount = totalAmountKey ? parseFloat(cleanRow[totalAmountKey]) || 0 : 0;

              let distributor = await db.get('SELECT id FROM distributors WHERE LOWER(name) = LOWER(?)', [distributorName]);
              if (!distributor) {
                const result = await db.run('INSERT INTO distributors (name) VALUES (?)', [distributorName]);
                distributor = { id: result.lastID };
              }

              let purchase = await db.get('SELECT id FROM purchases WHERE invoice_no = ? AND distributor_id = ?', [invoiceNo, distributor.id]);
              if (!purchase) {
                const purCols: string[] = [];
                const purVals: any[] = [];
                for (const [key, val] of Object.entries(cleanRow)) {
                  const mappedTarget = mapping?.[key];
                  if (mappedTarget && mappedTarget.startsWith('custom_col_')) {
                    const dbColName = mappedTarget.substring(11).trim().replace(/\s+/g, '_').toLowerCase();
                    purCols.push(`"${dbColName}"`);
                    purVals.push(val);
                  }
                }
                const baseCols = ['invoice_no', 'distributor_id', 'date', 'total_amount'];
                const baseVals = [invoiceNo, distributor.id, dateStr, totalAmount];
                const colsStr = [...baseCols, ...purCols].join(', ');
                const placeholdersStr = [...baseCols, ...purCols].map(() => '?').join(', ');
                const result = await db.run(
                  `INSERT INTO purchases (${colsStr}) VALUES (${placeholdersStr})`,
                  [...baseVals, ...purVals]
                );
                purchase = { id: result.lastID };
              }

              let nameKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'name');
              let rawName = nameKey ? String(cleanRow[nameKey] || '').trim() : String(cleanRow['Medicine'] || cleanRow['name'] || 'Unknown Product').trim();
              let medName = rawName;
              if (rawName && medicineActions) {
                const actionObj = medicineActions[rawName];
                if (actionObj && actionObj.action === 'merge' && actionObj.target) {
                  medName = actionObj.target;
                }
              }

              let med = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [medName]);
              if (!med) {
                const result = await db.run('INSERT INTO medicines (name) VALUES (?)', [medName]);
                med = { id: result.lastID };
              }

              const qtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'quantity');
              const mrpKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'mrp');
              const costPriceKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'cost_price' || mapping?.[k] === 'rate');
              const batchNoKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'batch_no');
              const expKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'expiry_date');

              const quantity = qtyKey ? parseInt(cleanRow[qtyKey]) || 0 : 0;
              const mrp = mrpKey ? parseFloat(cleanRow[mrpKey]) || 0 : 0;
              const costPrice = costPriceKey ? parseFloat(cleanRow[costPriceKey]) || mrp : mrp;
              const batchNo = batchNoKey ? String(cleanRow[batchNoKey] || '').trim() : 'BATCH';
              const expiryDate = expKey ? (normalizeDate(String(cleanRow[expKey] || '')) || String(cleanRow[expKey] || '').trim()) : '2028-12-01 00:00:00';

              await db.run(
                `INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [purchase.id, med.id, batchNo, expiryDate, quantity, costPrice, mrp]
              );
            }
            else if (dataType === 'returns') {
              const returnNoKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'return_no');
              const dateKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'date' || mapping?.[k] === 'return_date');
              const distributorKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'distributor_name');
              const totalAmountKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'total_amount');
              const returnInvoiceIdKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'return_invoice_id' || mapping?.[k] === 'invoice_no');
              const returnSubTypeKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'return_sub_type' || mapping?.[k] === 'return_status');
              const returnDateTimeKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'return_date_time');

              const returnNo = returnNoKey ? String(cleanRow[returnNoKey] || '').trim() : `RET-${Date.now()}-${insertCount}`;
              const dateStr = dateKey ? cleanRow[dateKey] : new Date().toISOString();
              const distributorName = distributorKey ? String(cleanRow[distributorKey] || '').trim() : 'Unknown Supplier';
              const totalAmount = totalAmountKey ? parseFloat(cleanRow[totalAmountKey]) || 0 : 0;
              const returnInvoiceId = returnInvoiceIdKey ? String(cleanRow[returnInvoiceIdKey] || '').trim() : null;
              const rawReturnSubType = returnSubTypeKey ? String(cleanRow[returnSubTypeKey] || '').trim() : '';
              let resolvedReturnSubType = 'good';
              if (rawReturnSubType.toLowerCase().includes('expiry') || rawReturnSubType.toLowerCase().includes('expire')) {
                resolvedReturnSubType = 'expiry';
              }
              const returnDateTime = returnDateTimeKey ? cleanRow[returnDateTimeKey] : null;

              let distributor = await db.get('SELECT id FROM distributors WHERE LOWER(name) = LOWER(?)', [distributorName]);
              if (!distributor) {
                const result = await db.run('INSERT INTO distributors (name) VALUES (?)', [distributorName]);
                distributor = { id: result.lastID };
              }

              let retRecord = await db.get('SELECT id FROM returns WHERE return_no = ?', [returnNo]);
              if (!retRecord) {
                const retCols: string[] = [];
                const retVals: any[] = [];
                for (const [key, val] of Object.entries(cleanRow)) {
                  const mappedTarget = mapping?.[key];
                  if (mappedTarget && mappedTarget.startsWith('custom_col_')) {
                     const dbColName = mappedTarget.substring(11).trim().replace(/\s+/g, '_').toLowerCase();
                     retCols.push(`"${dbColName}"`);
                     retVals.push(val);
                  }
                }
                const baseCols = ['return_no', 'distributor_id', 'type', 'date', 'total_amount', 'return_invoice_id', 'return_sub_type', 'raw_return_type', 'return_date_time'];
                const baseVals = [returnNo, distributor.id, 'purchase', dateStr, totalAmount, returnInvoiceId, resolvedReturnSubType, rawReturnSubType || null, returnDateTime];
                const colsStr = [...baseCols, ...retCols].join(', ');
                const placeholdersStr = [...baseCols, ...retCols].map(() => '?').join(', ');
                const result = await db.run(
                  `INSERT INTO returns (${colsStr}) VALUES (${placeholdersStr})`,
                  [...baseVals, ...retVals]
                );
                retRecord = { id: result.lastID };
              }

              let nameKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'name');
              let rawName = nameKey ? String(cleanRow[nameKey] || '').trim() : String(cleanRow['Medicine'] || cleanRow['name'] || 'Unknown Product').trim();
              let medName = rawName;
              if (rawName && medicineActions) {
                const actionObj = medicineActions[rawName];
                if (actionObj && actionObj.action === 'merge' && actionObj.target) {
                  medName = actionObj.target;
                }
              }

              let med = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [medName]);
              if (!med) {
                const result = await db.run('INSERT INTO medicines (name) VALUES (?)', [medName]);
                med = { id: result.lastID };
              }

              const qtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'quantity' || mapping?.[k] === 'return_quantity');
              const mrpKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'mrp');
              const costPriceKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'cost_price' || mapping?.[k] === 'rate');
              const batchNoKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'batch_no');
              const expKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'expiry_date');

              const quantity = qtyKey ? parseInt(cleanRow[qtyKey]) || 0 : 0;
              const mrp = mrpKey ? parseFloat(cleanRow[mrpKey]) || 0 : 0;
              const costPrice = costPriceKey ? parseFloat(cleanRow[costPriceKey]) || mrp : mrp;
              const batchNo = batchNoKey ? String(cleanRow[batchNoKey] || '').trim() : 'BATCH';
              const expiryDate = expKey ? (normalizeDate(String(cleanRow[expKey] || '')) || String(cleanRow[expKey] || '').trim()) : null;

              await db.run(
                `INSERT INTO return_items (return_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, total_price)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [retRecord.id, med.id, batchNo, expiryDate, quantity, costPrice, mrp, quantity * costPrice]
              );
            }
            else if (dataType === 'customers') {
              const patientKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'patient_name');
              const nameKeyCust = Object.keys(mapping || {}).find(k => mapping?.[k] === 'name') || patientKey;
              const phoneKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'phone') || Object.keys(mapping || {}).find(k => mapping?.[k] === 'mobile');
              const addressKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'address');
              const notesKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'notes');

              const name = nameKeyCust ? String(cleanRow[nameKeyCust] || '').trim() : 'Unnamed Customer';
              const phone = phoneKey ? String(cleanRow[phoneKey] || '').trim() : '';
              const address = addressKey ? String(cleanRow[addressKey] || '').trim() : '';
              const notes = notesKey ? String(cleanRow[notesKey] || '').trim() : '';

              let customer = await db.get('SELECT id FROM customers WHERE LOWER(name) = LOWER(?)', [name]);
              const custCols: string[] = [];
              const custVals: any[] = [];
              const custUpdates: string[] = [];
              for (const [key, val] of Object.entries(cleanRow)) {
                const mappedTarget = mapping?.[key];
                if (mappedTarget && mappedTarget.startsWith('custom_col_')) {
                  const dbColName = mappedTarget.substring(11).trim().replace(/\s+/g, '_').toLowerCase();
                  custCols.push(`"${dbColName}"`);
                  custVals.push(val);
                  custUpdates.push(`"${dbColName}" = ?`);
                }
              }

              if (!customer) {
                const baseCols = ['name', 'phone', 'address', 'notes'];
                const baseVals = [name, phone, address, notes];
                const colsStr = [...baseCols, ...custCols].join(', ');
                const placeholdersStr = [...baseCols, ...custCols].map(() => '?').join(', ');
                await db.run(
                  `INSERT INTO customers (${colsStr}) VALUES (${placeholdersStr})`,
                  [...baseVals, ...custVals]
                );
              } else {
                await db.run(
                  `UPDATE customers SET phone = COALESCE(NULLIF(phone, ""), ?), address = COALESCE(NULLIF(address, ""), ?), notes = COALESCE(NULLIF(notes, ""), ?) ${custUpdates.length > 0 ? ', ' + custUpdates.join(', ') : ''} WHERE id = ?`,
                  [phone, address, notes, ...custVals, customer.id]
                );
              }
            }
            else if (dataType === 'combined') {
              // 1. Customer
              let customerId: number | null = null;
              const patientKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'patient_name' || mapping?.[k] === 'customer_name');
              const nameKeyCust = Object.keys(mapping || {}).find(k => mapping?.[k] === 'name') || patientKey;
              if (nameKeyCust && cleanRow[nameKeyCust] && patientKey) {
                const patientName = String(cleanRow[nameKeyCust] || '').trim();
                const phoneKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'phone') || Object.keys(mapping || {}).find(k => mapping?.[k] === 'mobile');
                const addressKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'address');
                const notesKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'notes');

                const phone = phoneKey ? String(cleanRow[phoneKey] || '').trim() : '';
                const address = addressKey ? String(cleanRow[addressKey] || '').trim() : '';
                const notes = notesKey ? String(cleanRow[notesKey] || '').trim() : '';

                let customer = await db.get('SELECT id FROM customers WHERE LOWER(name) = LOWER(?)', [patientName]);
                if (!customer) {
                  const result = await db.run('INSERT INTO customers (name, phone, address, notes) VALUES (?, ?, ?, ?)', [patientName, phone, address, notes]);
                  customerId = result.lastID ?? null;
                } else {
                  customerId = customer.id;
                  await db.run(
                    `UPDATE customers SET phone = COALESCE(NULLIF(phone, ""), ?), address = COALESCE(NULLIF(address, ""), ?), notes = COALESCE(NULLIF(notes, ""), ?) WHERE id = ?`,
                    [phone, address, notes, customer.id]
                  );
                }
              }

              // 2. Doctor
              let doctorId: number | null = null;
              const doctorKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'doctor_name');
              if (doctorKey && cleanRow[doctorKey]) {
                const doctorName = String(cleanRow[doctorKey] || '').trim();
                let doctor = await db.get('SELECT id FROM doctors WHERE LOWER(name) = LOWER(?)', [doctorName]);
                if (!doctor) {
                  const result = await db.run('INSERT INTO doctors (name) VALUES (?)', [doctorName]);
                  doctorId = result.lastID ?? null;
                } else {
                  doctorId = doctor.id;
                }
              }

              // 3. Distributor
              let distributorId: number | null = null;
              const distributorKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'distributor_name' || mapping?.[k] === 'distributor');
              if (distributorKey && cleanRow[distributorKey]) {
                const distributorName = String(cleanRow[distributorKey] || '').trim();
                let distributor = await db.get('SELECT id FROM distributors WHERE LOWER(name) = LOWER(?)', [distributorName]);
                if (!distributor) {
                  const result = await db.run('INSERT INTO distributors (name) VALUES (?)', [distributorName]);
                  distributorId = result.lastID ?? null;
                } else {
                  distributorId = distributor.id;
                }
              }

              // 4. Medicine
              let medicineId: number | null = null;
              const nameKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'name');
              if (nameKey && cleanRow[nameKey]) {
                let rawName = String(cleanRow[nameKey] || '').trim();
                let medName = rawName;
                if (rawName && medicineActions) {
                  const actionObj = medicineActions[rawName];
                  if (actionObj && actionObj.action === 'merge' && actionObj.target) {
                    medName = actionObj.target;
                  }
                }

                const medCols: string[] = [];
                const medVals: any[] = [];
                const medUpdates: string[] = [];

                for (const [key, val] of Object.entries(cleanRow)) {
                  if (val === undefined || val === null || val === '') continue;
                  const mappedTarget = mapping?.[key];
                  if (!mappedTarget || mappedTarget === 'IGNORE') continue;

                  let dbCol = mappedTarget;
                  let isCustom = false;
                  if (dbCol.startsWith('custom_col_')) {
                    dbCol = dbCol.substring(11).trim().replace(/\s+/g, '_').toLowerCase();
                    isCustom = true;
                  } else {
                    if (dbCol === 'hsncode' || dbCol === 'hsn_code') dbCol = 'hsn_code';
                    if (dbCol === 'mfg' || dbCol === 'manufacturer') dbCol = 'manufacturer';
                    if (dbCol === 'mrkby' || dbCol === 'marketed_by') dbCol = 'marketed_by';
                  }
                  if (dbCol === 'loos_qty' || dbCol === 'loose_qty' || dbCol === 'loose_quantity') continue;
                  if (dbCol === 'rate') continue;
                  if (dbCol === 'name') continue;

                  const medicineFields = [
                    'api_reference', 'mrp', 'hsn_code', 'schedule_type', 'manufacturer',
                    'category', 'marketed_by', 'manufactured_by', 'legacy_id', 'packaging',
                    'strength', 'item_type', 'cgst', 'sgst', 'igst', 'rack',
                    'generic_name', 'pack_unit', 'cgst_per', 'sgst_per', 'item_code'
                  ];

                  if (medicineFields.includes(dbCol) || isCustom) {
                    medCols.push(`"${dbCol}"`);
                    medVals.push(val);
                    medUpdates.push(`"${dbCol}" = ?`);
                  }
                }

                let med = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [medName]);
                if (!med) {
                  const colsStr = ['name', ...medCols].join(', ');
                  const placeholdersStr = ['?', ...medVals.map(() => '?')].join(', ');
                  const result = await db.run(`INSERT INTO medicines (${colsStr}) VALUES (${placeholdersStr})`, [medName, ...medVals]);
                  medicineId = result.lastID ?? null;
                } else {
                  medicineId = med.id;
                  if (medUpdates.length > 0) {
                    await db.run(`UPDATE medicines SET ${medUpdates.join(', ')} WHERE id = ?`, [...medVals, med.id]);
                  }
                }
              }

              // 5. Inventory
              let inventoryId: number | null = null;
              if (medicineId) {
                const qtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'quantity' || mapping?.[k] === 'quantity_sold' || mapping?.[k] === 'return_quantity');
                const looseQtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'loose_qty' || mapping?.[k] === 'loose_quantity');
                const mrpKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'mrp');
                const costPriceKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'cost_price' || mapping?.[k] === 'rate' || mapping?.[k] === 'unit_price');
                const batchNoKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'batch_no');
                const expKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'expiry_date');
                const rackKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'rack_location');

                const quantity = qtyKey ? parseInt(cleanRow[qtyKey]) || 0 : 0;
                const looseQty = looseQtyKey ? parseInt(cleanRow[looseQtyKey]) || 0 : 0;
                const mrp = mrpKey ? parseFloat(cleanRow[mrpKey]) || 0 : 0;
                const costPrice = costPriceKey ? parseFloat(cleanRow[costPriceKey]) || mrp : mrp;
                const batchNo = batchNoKey ? String(cleanRow[batchNoKey] || '').trim() : 'BATCH';
                const expiryDate = expKey ? (normalizeDate(String(cleanRow[expKey] || '')) || String(cleanRow[expKey] || '').trim()) : '2028-12-01 00:00:00';
                const rackLocation = rackKey ? String(cleanRow[rackKey] || '').trim() : '';

                let inv = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medicineId, batchNo]);
                if (!inv) {
                  const result = await db.run(
                    `INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, loose_quantity, mrp, cost_price, rack_location)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [medicineId, batchNo, expiryDate, quantity, looseQty, mrp, costPrice, rackLocation]
                  );
                  inventoryId = result.lastID ?? null;
                } else {
                  inventoryId = inv.id;
                  await db.run(
                    `UPDATE inventory_master SET quantity = quantity + ?, loose_quantity = loose_quantity + ? WHERE id = ?`,
                    [quantity, looseQty, inv.id]
                  );
                }
              }

              // 6. Sale or Purchase Invoice
              const invoiceNoKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'invoice_no' || mapping?.[k] === 'bill_no' || mapping?.[k] === 'bill_id');
              if (invoiceNoKey && cleanRow[invoiceNoKey]) {
                const invoiceNo = String(cleanRow[invoiceNoKey] || '').trim();
                const dateKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'date');
                const dateStr = dateKey ? cleanRow[dateKey] : new Date().toISOString();
                const totalAmountKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'total_amount');
                const totalAmount = totalAmountKey ? parseFloat(cleanRow[totalAmountKey]) || 0 : 0;
                const discountKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'discount');
                const discount = discountKey ? parseFloat(cleanRow[discountKey]) || 0 : 0;
                const cgstKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'cgst');
                const cgstVal = cgstKey ? parseFloat(cleanRow[cgstKey]) || 0 : 0;
                const sgstKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'sgst');
                const sgstVal = sgstKey ? parseFloat(cleanRow[sgstKey]) || 0 : 0;

                const patientKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'patient_name' || mapping?.[k] === 'customer_name');
                const distributorKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'distributor_name' || mapping?.[k] === 'distributor');

                if (patientKey && cleanRow[patientKey]) {
                  // Sale Invoice
                  let invoice = await db.get('SELECT id FROM sales_invoices WHERE invoice_no = ?', [invoiceNo]);
                  if (!invoice) {
                    const result = await db.run(
                      `INSERT INTO sales_invoices (invoice_no, customer_id, doctor_id, date, total_amount, discount, cgst_value, sgst_value)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                      [invoiceNo, customerId || 1, doctorId || 1, dateStr, totalAmount, discount, cgstVal, sgstVal]
                    );
                    invoice = { id: result.lastID };
                  }

                  if (medicineId && inventoryId) {
                    const qtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'quantity' || mapping?.[k] === 'quantity_sold');
                    const looseQtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'loose_qty' || mapping?.[k] === 'loose_quantity');
                    const mrpKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'mrp');
                    const costPriceKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'cost_price' || mapping?.[k] === 'rate' || mapping?.[k] === 'unit_price');

                    const quantity = qtyKey ? parseInt(cleanRow[qtyKey]) || 0 : 0;
                    const looseQty = looseQtyKey ? parseInt(cleanRow[looseQtyKey]) || 0 : 0;
                    const mrp = mrpKey ? parseFloat(cleanRow[mrpKey]) || 0 : 0;
                    const unitPrice = costPriceKey ? parseFloat(cleanRow[costPriceKey]) || mrp : mrp;

                    await db.run(
                      `INSERT INTO sale_items (invoice_id, inventory_id, quantity, loose_qty, unit_price, mrp)
                       VALUES (?, ?, ?, ?, ?, ?)`,
                      [invoice.id, inventoryId, quantity, looseQty, unitPrice, mrp]
                    );
                  }
                }
                else if (distributorKey && cleanRow[distributorKey]) {
                  // Purchase Invoice
                  let purchase = await db.get('SELECT id FROM purchases WHERE invoice_no = ? AND distributor_id = ?', [invoiceNo, distributorId || 1]);
                  if (!purchase) {
                    const result = await db.run(
                      `INSERT INTO purchases (invoice_no, distributor_id, date, total_amount)
                       VALUES (?, ?, ?, ?)`,
                      [invoiceNo, distributorId || 1, dateStr, totalAmount]
                    );
                    purchase = { id: result.lastID };
                  }

                  if (medicineId) {
                    const qtyKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'quantity');
                    const mrpKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'mrp');
                    const costPriceKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'cost_price' || mapping?.[k] === 'rate');
                    const batchNoKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'batch_no');
                    const expKey = Object.keys(mapping || {}).find(k => mapping?.[k] === 'expiry_date');

                    const quantity = qtyKey ? parseInt(cleanRow[qtyKey]) || 0 : 0;
                    const mrp = mrpKey ? parseFloat(cleanRow[mrpKey]) || 0 : 0;
                    const costPrice = costPriceKey ? parseFloat(cleanRow[costPriceKey]) || mrp : mrp;
                    const batchNo = batchNoKey ? String(cleanRow[batchNoKey] || '').trim() : 'BATCH';
                    const expiryDate = expKey ? (normalizeDate(String(cleanRow[expKey] || '')) || String(cleanRow[expKey] || '').trim()) : '2028-12-01 00:00:00';

                    await db.run(
                      `INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp)
                       VALUES (?, ?, ?, ?, ?, ?, ?)`,
                      [purchase.id, medicineId, batchNo, expiryDate, quantity, costPrice, mrp]
                    );
                  }
                }
              }
            }

            insertCount++;
            if (insertCount % 1000 === 0) {
              migrationStatus.progress = 50 + Math.min(50, Math.floor((insertCount / rowCount) * 50));
            }
          }
          await db.run('COMMIT');
          resolve();
        } catch (err: any) {
          await db.run('ROLLBACK');
          reject(err);
        }
      })
      .on('end', () => { })
      .on('error', reject);
  });
  } finally {
    await db.close();
  }
}