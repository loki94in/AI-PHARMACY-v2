import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron, { type ScheduledTask } from 'node-cron';
import { dbManager } from '../database/connection.js';
import Database from 'better-sqlite3';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'backup');

const MAX_BACKUPS = 20;

// Active scheduled task reference (so we can cancel & reschedule)
let scheduledTask: ScheduledTask | null = null;

/**
 * Create a backup of the database file.
 * @param reason - A short description for the action log (e.g. 'Manual', 'Scheduled 3h', 'Shutdown')
 */
export async function createBackup(reason: string = 'Manual'): Promise<{ filename: string }> {
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

  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db') || f.endsWith('.db.gz'))
    .map(filename => {
      const filePath = path.join(BACKUP_DIR, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        sizeBytes: stats.size,
        createdAt: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Delete a specific backup file.
 * Uses path.basename() to prevent path-traversal attacks.
 */
export function deleteBackup(filename: string): void {
  // Security: strip any directory traversal from filename
  const sanitized = path.basename(filename);
  if (!sanitized.endsWith('.db') && !sanitized.endsWith('.db.gz')) {
    throw new Error('Invalid backup filename');
  }

  const filePath = path.join(BACKUP_DIR, sanitized);

  // Verify the resolved path is inside BACKUP_DIR
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(BACKUP_DIR + path.sep)) {
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
  if (!sanitized.endsWith('.db') && !sanitized.endsWith('.db.gz')) {
    throw new Error('Invalid backup filename');
  }

  const filePath = path.join(BACKUP_DIR, sanitized);

  // Verify the resolved path is inside BACKUP_DIR
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(BACKUP_DIR + path.sep)) {
    throw new Error('Invalid backup path');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error('Backup file not found');
  }

  // Close the active DB connection before overwriting
  await dbManager.close();

  if (sanitized.endsWith('.gz')) {
    // Decompress the gzip backup to the live database path (ponytail: native stdlib zlib)
    const gunzip = zlib.createGunzip();
    const source = fs.createReadStream(filePath);
    const destination = fs.createWriteStream(DB_PATH);
    await pipeline(source, gunzip, destination);
  } else {
    fs.copyFileSync(filePath, DB_PATH);
  }

  // Re-open and log
  const db = await dbManager.getConnection();
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
