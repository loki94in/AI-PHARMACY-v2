import './sqlitePatch.js';
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

class DatabaseManager {
  private static instance: DatabaseManager;
  private connection: Database | null = null;
  private currentDbPath: string | null = null;

  private constructor() {}

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public async getConnection(): Promise<Database> {
    const dbPath = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
    if (!this.connection || this.currentDbPath !== dbPath) {
      if (this.connection) {
        try {
          await this.connection.close();
        } catch (e) {}
      }
      let db = new Database({ filename: dbPath, driver: sqlite3.Database });
      let needsHeal = false;
      let initialErrorMsg = '';

      try {
        await db.open();
        await db.run('PRAGMA busy_timeout = 5000;');

        // Integrity check on cold start — must pass before any app code uses the DB
        const isProductionOrPkg = process.env.NODE_ENV === 'production' || typeof (process as any).pkg !== 'undefined';
        if (isProductionOrPkg && process.env.NODE_ENV !== 'test') {
          const integrityResult = await db.get('PRAGMA integrity_check');
          if (integrityResult?.integrity_check !== 'ok') {
            console.error('[DB] Integrity check failed, attempting WAL checkpoint recovery...');
            await db.run('PRAGMA wal_checkpoint(TRUNCATE)');
            const recheck = await db.get('PRAGMA integrity_check');
            if (recheck?.integrity_check !== 'ok') {
              needsHeal = true;
              initialErrorMsg = 'Integrity check failed after WAL checkpoint';
              await db.close();
            } else {
              console.log('[DB] WAL checkpoint recovery succeeded.');
            }
          }
        }
      } catch (err: any) {
        needsHeal = true;
        initialErrorMsg = err.message || 'Failed to open database file';
        try {
          await db.close();
        } catch (_) {}
      }

      if (needsHeal) {
        console.error('[DB] Database load failed. Starting silent self-healing database restoration...');
        const logPath = path.join(path.dirname(dbPath), 'self_healing.log');
        const appendLog = (msg: string) => {
          const timestamp = new Date().toISOString();
          fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
        };
        appendLog(`[ERROR] DB_CORRUPT: ${initialErrorMsg}`);

        // Find backups
        const backups: { path: string; name: string; mtime: number; type: 'bak' | 'gz' }[] = [];

        // 1. Check data folder for raw backups app.db.bak_*
        const dataDir = path.dirname(dbPath);
        if (fs.existsSync(dataDir)) {
          fs.readdirSync(dataDir).forEach(file => {
            if (file.startsWith('app.db.bak_')) {
              const fp = path.join(dataDir, file);
              backups.push({
                path: fp,
                name: file,
                mtime: fs.statSync(fp).mtime.getTime(),
                type: 'bak'
              });
            }
          });
        }

        // 2. Check backup/snapshots for snapshot_*.db.gz
        const snapshotsDir = path.resolve(__dirname, '..', '..', 'backup', 'snapshots');
        if (fs.existsSync(snapshotsDir)) {
          fs.readdirSync(snapshotsDir).forEach(file => {
            if (file.startsWith('snapshot_') && file.endsWith('.db.gz')) {
              const fp = path.join(snapshotsDir, file);
              backups.push({
                path: fp,
                name: file,
                mtime: fs.statSync(fp).mtime.getTime(),
                type: 'gz'
              });
            }
          });
        }

        // Sort backups newest first
        backups.sort((a, b) => b.mtime - a.mtime);

        if (backups.length === 0) {
          appendLog('[FATAL] Restoration failed: No backups available.');
          throw new Error('DB_INTEGRITY_FAILURE');
        }

        const targetBackup = backups[0];
        appendLog(`[ACTION] RENAME: ${dbPath} -> ${dbPath}.corrupt`);

        try {
          if (fs.existsSync(dbPath)) {
            if (fs.existsSync(dbPath + '.corrupt')) {
              fs.unlinkSync(dbPath + '.corrupt');
            }
            fs.renameSync(dbPath, dbPath + '.corrupt');
          }
          // Clean up logs to prevent carry-over corruption
          if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
          if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
        } catch (err: any) {
          appendLog(`[ERROR] Failed to rename corrupt database or clean logs: ${err.message}`);
          throw new Error('DB_INTEGRITY_FAILURE');
        }

        appendLog(`[ACTION] RESTORE: Restoring from backup ${targetBackup.name}`);
        try {
          if (targetBackup.type === 'gz') {
            const gunzip = zlib.createGunzip();
            const source = fs.createReadStream(targetBackup.path);
            const destination = fs.createWriteStream(dbPath);
            await pipeline(source, gunzip, destination);
          } else {
            fs.copyFileSync(targetBackup.path, dbPath);
          }
        } catch (err: any) {
          appendLog(`[ERROR] Failed to restore backup file: ${err.message}`);
          throw new Error('DB_INTEGRITY_FAILURE');
        }

        // Re-open DB
        try {
          const healedDb = await open({ filename: dbPath, driver: sqlite3.Database });
          await healedDb.run('PRAGMA busy_timeout = 5000;');

          // Re-verify
          const healedIntegrity = await healedDb.get('PRAGMA integrity_check');
          if (healedIntegrity?.integrity_check !== 'ok') {
            appendLog(`[ERROR] Restored database from ${targetBackup.name} failed integrity check.`);
            await healedDb.close();
            throw new Error('DB_INTEGRITY_FAILURE');
          }

          appendLog('[SUCCESS] Boot self-healing finished. System resumed successfully.');
          console.log('[DB] Silent self-healing database recovery succeeded.');

          db = healedDb;
        } catch (err: any) {
          appendLog(`[FATAL] Failed to open healed database: ${err.message}`);
          throw new Error('DB_INTEGRITY_FAILURE');
        }
      }

      // Intercept database writes for automatic backup snapshots
      const originalRun = db.run.bind(db);
      const originalExec = db.exec.bind(db);

      const checkWriteQuery = (sql: string) => {
        if (!sql) return;
        const sqlLower = sql.toLowerCase();
        const isWrite = sqlLower.includes('insert') || sqlLower.includes('update') || sqlLower.includes('delete');
        const isInternal = sqlLower.includes('action_logs') || sqlLower.includes('app_settings') || sqlLower.includes('processed_emails') || sqlLower.includes('processed_files') || sqlLower.includes('push_tokens');
        if (isWrite && !isInternal && process.env.NODE_ENV !== 'test') {
          import('../services/backupRecoveryService.js')
            .then(({ backupRecoveryService }) => {
              backupRecoveryService.triggerSnapshot();
            })
            .catch(err => console.error('Failed to import backupRecoveryService:', err));

          const isInventoryWrite = sqlLower.includes('inventory_master') || 
                                   sqlLower.includes('sale_items') || 
                                   sqlLower.includes('sales_invoices') || 
                                   sqlLower.includes('purchase_items') || 
                                   sqlLower.includes('purchases') || 
                                   sqlLower.includes('return_items') || 
                                   sqlLower.includes('returns');
          if (isInventoryWrite) {
            import('../services/expiryAlertService.js')
              .then(m => m.triggerExpiryCacheRebuildDebounced())
              .catch(err => console.error('Failed to trigger expiry cache rebuild:', err));
          }
        }
      };

      db.run = async function (sql: any, ...params: any[]) {
        if (typeof sql === 'string') {
          checkWriteQuery(sql);
        }
        return originalRun(sql, ...params);
      } as any;

      db.exec = async function (sql: string) {
        checkWriteQuery(sql);
        return originalExec(sql);
      };

      this.connection = db;
      this.currentDbPath = dbPath;
    }
    return this.connection;
  }

  public async close(force: boolean = false): Promise<void> {
    if (force || process.env.NODE_ENV === 'test') {
      if (this.connection) {
        try {
          await this.connection.close();
        } catch (e) {}
        this.connection = null;
        this.currentDbPath = null;
      }
    }
  }

  public async transaction<T>(callback: (db: Database) => Promise<T>): Promise<T> {
    const db = await this.getConnection();
    try {
      await db.run('BEGIN TRANSACTION');
      const result = await callback(db);
      await db.run('COMMIT');
      return result;
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }
}

export const dbManager = DatabaseManager.getInstance();