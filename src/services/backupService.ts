import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron, { type ScheduledTask } from 'node-cron';
import { dbManager } from '../database/connection.js';
import Database from 'better-sqlite3';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';

import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = config.dbPath;
const BACKUP_DIR = config.backupDir;

const MAX_BACKUPS = 20;

// Active scheduled task reference (so we can cancel & reschedule)
let scheduledTask: ScheduledTask | null = null;

/**
 * Create a backup of the database file.
 * @param reason - A short description for the action log (e.g. 'Manual', 'Scheduled 3h', 'Shutdown')
 */
export async function createBackup(reason: string = 'Manual'): Promise<{ filename: string }> {
  // ponytail: defer auto-backups during cold boot to avoid SQLite lock contention
  const isManual = reason === 'Manual';
  const isShutdown = reason.startsWith('Shutdown');
  if (!isManual && !isShutdown && process.uptime() < 60) {
    console.log(`[Backup] Skipping ${reason} — server uptime ${Math.round(process.uptime())}s < 60s`);
    throw new Error('Backup deferred: server still starting up (retry after 60s)');
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `app_backup_${timestamp}.db.gz`;
  const backupPath = path.join(BACKUP_DIR, filename);

  // Use native better-sqlite3 backup API to safely checkpoint WAL and clone live SQLite database
  const tempDbPath = backupPath.replace('.gz', '');
  const tempDb = new Database(DB_PATH);
  await tempDb.backup(tempDbPath);
  tempDb.close();

  // Compress the backup using gzip (ponytail: native stdlib zlib)
  const gzip = zlib.createGzip();
  const source = fs.createReadStream(tempDbPath);
  const destination = fs.createWriteStream(backupPath);
  try {
    await pipeline(source, gzip, destination);
  } finally {
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  }

  // Log the action
  try {
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['BACKUP', `Backup created (${reason}): ${filename}`]
    );
  } catch {
    // If DB logging fails, the backup file was still written — don't throw
    console.error('Backup created but failed to log action');
  }

  // Enforce retention limit
  enforceRetention();

  return { filename };
}

/**
 * List all backup files with metadata, sorted newest-first.
 */
export function listBackups(): { filename: string; sizeBytes: number; createdAt: string }[] {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }

  const results: { filename: string; sizeBytes: number; createdAt: string }[] = [];

  const scanDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const filename of files) {
      const filePath = path.join(dir, filename);
      try {
        const stats = fs.statSync(filePath);
        if (stats.isFile() && (filename.endsWith('.db') || filename.endsWith('.db.gz') || filename.endsWith('.zip'))) {
          // Avoid duplicate filenames if same file is listed in root vs subdir
          if (!results.some(r => r.filename === filename)) {
            results.push({
              filename,
              sizeBytes: stats.size,
              createdAt: stats.mtime.toISOString(),
            });
          }
        }
      } catch (_) {}
    }
  };

  scanDir(BACKUP_DIR);
  scanDir(path.join(BACKUP_DIR, 'archives'));
  scanDir(path.join(BACKUP_DIR, 'snapshots'));

  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Delete a specific backup file.
 * Uses path.basename() to prevent path-traversal attacks.
 */
export function deleteBackup(filename: string): void {
  // Security: strip any directory traversal from filename
  const sanitized = path.basename(filename);
  if (!sanitized.endsWith('.db') && !sanitized.endsWith('.db.gz') && !sanitized.endsWith('.zip')) {
    throw new Error('Invalid backup filename');
  }

  let filePath = path.join(BACKUP_DIR, sanitized);
  if (!fs.existsSync(filePath)) {
    const archivesPath = path.join(BACKUP_DIR, 'archives', sanitized);
    const snapshotsPath = path.join(BACKUP_DIR, 'snapshots', sanitized);
    if (fs.existsSync(archivesPath)) filePath = archivesPath;
    else if (fs.existsSync(snapshotsPath)) filePath = snapshotsPath;
  }

  // Verify the resolved path is inside BACKUP_DIR
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(BACKUP_DIR + path.sep) && resolved !== BACKUP_DIR) {
    throw new Error('Invalid backup path');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error('Backup file not found');
  }

  fs.unlinkSync(filePath);
}

/**
 * Restore a specific backup file by copying it over the active database.
 */
export async function restoreBackup(filename: string): Promise<void> {
  // Security: strip any directory traversal from filename
  const sanitized = path.basename(filename);
  if (!sanitized.endsWith('.db') && !sanitized.endsWith('.db.gz') && !sanitized.endsWith('.zip')) {
    throw new Error('Invalid backup filename. Must be .db, .db.gz, or .zip');
  }

  let filePath = path.join(BACKUP_DIR, sanitized);

  // Check subdirectories (snapshots and archives) if not found in root BACKUP_DIR
  if (!fs.existsSync(filePath)) {
    const archivesPath = path.join(BACKUP_DIR, 'archives', sanitized);
    const snapshotsPath = path.join(BACKUP_DIR, 'snapshots', sanitized);
    if (fs.existsSync(archivesPath)) {
      filePath = archivesPath;
    } else if (fs.existsSync(snapshotsPath)) {
      filePath = snapshotsPath;
    }
  }

  // Verify the resolved path is inside BACKUP_DIR
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(BACKUP_DIR + path.sep) && resolved !== BACKUP_DIR) {
    throw new Error('Invalid backup path');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${sanitized}`);
  }

  // Unpack to a sibling temp file first: writing straight onto the live path would
  // destroy the current database if decompression failed halfway through.
  const stagedPath = `${DB_PATH}.restoring_${Date.now()}`;
  let tempExtractDir: string | null = null;

  // Background workers must not reopen the database between the close and the swap,
  // or they recreate the -wal we are about to delete.
  let workers: { start: () => void; stop: () => void } | null = null;
  const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
  if (!isTest) {
    try {
      workers = (await import('../worker/workerSupervisor.js')).workerSupervisor;
      workers.stop();
    } catch (_) {
      workers = null;
    }
  }

  try {
    let dbSourcePath = filePath;
    if (sanitized.endsWith('.zip')) {
      const { default: AdmZip } = await import('adm-zip');
      tempExtractDir = path.join(BACKUP_DIR, `temp_restore_${Date.now()}`);
      fs.mkdirSync(tempExtractDir, { recursive: true });
      const zip = new AdmZip(filePath);
      zip.extractAllTo(tempExtractDir, true);

      const dbFiles = fs.readdirSync(tempExtractDir).filter(f => f.endsWith('.db') || f.endsWith('.db.gz'));
      if (dbFiles.length === 0) {
        throw new Error('No valid database file (.db or .db.gz) found inside the zip archive.');
      }
      dbSourcePath = path.join(tempExtractDir, dbFiles[0]);
    }

    if (dbSourcePath.endsWith('.gz')) {
      await pipeline(fs.createReadStream(dbSourcePath), zlib.createGunzip(), fs.createWriteStream(stagedPath));
    } else {
      fs.copyFileSync(dbSourcePath, stagedPath);
    }

    // Never put an unreadable database live.
    const probe = new Database(stagedPath, { readonly: true });
    try {
      const integrity = probe.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (!integrity?.[0] || integrity[0].integrity_check !== 'ok') {
        throw new Error(`Backup failed its integrity check: ${JSON.stringify(integrity)}`);
      }
    } catch (probeErr: any) {
      // integrity_check opens every virtual table, so a backup taken while the search
      // index was damaged makes the check itself throw. The file is fine and the index
      // is rebuilt after the swap below, so this must not block the restore.
      if (!String(probeErr?.message).includes('vtable constructor failed')) {
        throw probeErr;
      }
      console.warn('[Restore] Backup has a damaged search index; it will be rebuilt after the restore.');
    } finally {
      probe.close();
    }

    // force=true is required. A pooled close keeps handles open, and the surviving
    // connection would go on serving the old database and later checkpoint its WAL
    // back over the restored file — the restore would appear to succeed and be undone.
    await dbManager.close(true);

    // The -wal/-shm sidecars belong to the database being replaced. Left in place,
    // SQLite would replay those old frames on top of the restored file.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = DB_PATH + suffix;
      if (!fs.existsSync(sidecar)) continue;
      try {
        fs.unlinkSync(sidecar);
      } catch (err: any) {
        throw new Error(`Could not clear ${path.basename(sidecar)} before restore: ${err.message}`);
      }
    }

    try {
      fs.renameSync(stagedPath, DB_PATH);
    } catch (renameErr: any) {
      // Windows can still hold a transient lock on the destination; a copy works there.
      if (renameErr.code === 'EPERM' || renameErr.code === 'EBUSY' || renameErr.code === 'EEXIST') {
        fs.copyFileSync(stagedPath, DB_PATH);
        try { fs.unlinkSync(stagedPath); } catch (_) { }
      } else {
        throw renameErr;
      }
    } finally {
      if (tempExtractDir && fs.existsSync(tempExtractDir)) {
        try { fs.rmSync(tempExtractDir, { recursive: true, force: true }); } catch (_) { }
      }
    }
  } catch (err) {
    if (tempExtractDir && fs.existsSync(tempExtractDir)) {
      try { fs.rmSync(tempExtractDir, { recursive: true, force: true }); } catch (_) { }
    }
    try { if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath); } catch (_) { }
    try { await dbManager.getConnection(); } catch (_) { }
    if (workers) { try { workers.start(); } catch (_) { } }
    throw err;
  }

  // Re-open, then bring the restored file up to the current schema. An older backup
  // can predate recent tables, and its search index has to be confirmed usable —
  // a broken medicines_fts blocks every medicine write.
  const db = await dbManager.getConnection();
  try {
    const { ensureSchema, ensureMedicinesFts } = await import('../database.js');
    await ensureSchema(DB_PATH);
    await ensureMedicinesFts(db);
  } catch (schemaErr: any) {
    console.warn('[Restore] Schema verification after restore failed:', schemaErr.message);
  }

  if (workers) { try { workers.start(); } catch (_) { } }

  await db.run(
    'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
    ['RESTORE_BACKUP', `Database restored from backup: ${sanitized}`]
  );
}

/**
 * Get the current backup frequency setting from app_settings.
 * Returns 'off' | '3h' | '6h'
 */
export async function getScheduleConfig(): Promise<string> {
  try {
    const db = await dbManager.getConnection();
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'backup_frequency'");
    return row?.value || 'off';
  } catch {
    return 'off';
  }
}

/**
 * Save the backup frequency setting and restart the scheduler.
 */
export async function setScheduleConfig(frequency: string): Promise<void> {
  const allowed = ['off', '3h', '6h'];
  if (!allowed.includes(frequency)) {
    throw new Error('Invalid frequency. Must be: off, 3h, or 6h');
  }

  const db = await dbManager.getConnection();
  await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
  await db.run(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backup_frequency', ?)",
    [frequency]
  );

  // Restart the scheduler with the new frequency
  startScheduler(frequency);
}

/**
 * Start (or restart) the periodic backup cron based on frequency.
 */
export function startScheduler(frequency?: string): void {
  // Cancel any existing scheduled task
  stopScheduler();

  if (!frequency || frequency === 'off') {
    console.log('[Backup] Scheduled backup is OFF');
    return;
  }

  // Map frequency to cron expression
  let cronExpr: string;
  if (frequency === '3h') {
    cronExpr = '0 */3 * * *'; // Every 3 hours at :00
  } else if (frequency === '6h') {
    cronExpr = '0 */6 * * *'; // Every 6 hours at :00
  } else {
    return;
  }

  scheduledTask = cron.schedule(cronExpr, async () => {
    try {
      const { getBackendFetchMode } = await import('./dataFetchControl.js');
      const mode = await getBackendFetchMode('settings.backupSchedule', 'manual');
      if (mode === 'off') {
        console.log('[Backup] Scheduled backup is disabled (mode=off)');
        return;
      }
      const { activityTracker } = await import('../utils/activityTracker.js');
      if (mode === 'manual' && activityTracker.isIdle()) {
        console.log('[Backup] Scheduled backup skipped (mode=manual, system is idle)');
        return;
      }
    } catch (err) {
      console.error('[Backup] Failed to check fetch control in scheduler:', err);
    }

    console.log(`[Backup] Running scheduled backup (${frequency})...`);
    try {
      const result = await createBackup(`Scheduled ${frequency}`);
      console.log(`[Backup] Scheduled backup created: ${result.filename}`);
    } catch (err) {
      console.error('[Backup] Scheduled backup failed:', err);
    }
  });

  console.log(`[Backup] Scheduler started: every ${frequency}`);
}

/**
 * Stop the active scheduled backup task.
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

/**
 * Delete oldest backups if total exceeds MAX_BACKUPS.
 */
function enforceRetention(): void {
  try {
    const backups = listBackups(); // already sorted newest-first
    if (backups.length > MAX_BACKUPS) {
      const toDelete = backups.slice(MAX_BACKUPS);
      for (const b of toDelete) {
        const filePath = path.join(BACKUP_DIR, b.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[Backup] Retention cleanup: deleted ${b.filename}`);
        }
      }
    }
  } catch (err) {
    console.error('[Backup] Retention enforcement failed:', err);
  }
}

/**
 * Initialize the backup scheduler on server startup.
 * Reads the saved frequency from app_settings and starts the cron.
 */
export async function initBackupScheduler(): Promise<void> {
  const freq = await getScheduleConfig();
  startScheduler(freq);
}
