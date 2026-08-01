import './sqlitePatch.js';
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';

import { config, getAppDataDir, isPackagedApp } from '../config/index.js';

const DB_PATH = config.dbPath;

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
    const dbPath = config.dbPath;
    if (this.connection) {
      try {
        await this.connection.get('SELECT 1');
      } catch (err: any) {
        if (err?.code === 'SQLITE_MISUSE' || err?.message?.includes('closed') || err?.message?.includes('MISUSE')) {
          this.connection = null;
        }
      }
    }

    if (!this.connection || this.currentDbPath !== dbPath) {
      if (this.connection) {
        try {
          await this.connection.close();
        } catch (e) {}
        this.connection = null;
      }

      const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
      const busyTimeout = isTest ? 5000 : 30000;
      const maxAttempts = 10;
      let lastError: any = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let db = new Database({ filename: dbPath, driver: sqlite3.Database });
        let needsHeal = false;
        let initialErrorMsg = '';
        let openSuccess = false;

        try {
          await db.open();
          await db.run(`PRAGMA busy_timeout = ${busyTimeout};`);
          await db.run('PRAGMA journal_mode = WAL;');
          openSuccess = true;
        } catch (err: any) {
          lastError = err;
          const isBusy = err?.message?.includes('SQLITE_BUSY') || err?.message?.includes('locked') || err?.code === 'SQLITE_BUSY';
          if (!isBusy) {
            needsHeal = true;
            initialErrorMsg = err.message || 'Failed to open database file';
          } else {
            console.warn(`[DB] Database busy on connection open (attempt ${attempt}/${maxAttempts}), retrying...`);
          }
          try {
            await db.close();
          } catch (_) {}
        }

        if (needsHeal) {
          try {
            db = await this.runSelfHealing(dbPath, busyTimeout, initialErrorMsg);
            openSuccess = true;
          } catch (healErr) {
            lastError = healErr;
            openSuccess = false;
          }
        }

        if (openSuccess) {
          this.setupWriteInterceptor(db);
          this.connection = db;
          this.currentDbPath = dbPath;
          break;
        }

        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 300 * attempt));
        }
      }

      if (!this.connection) {
        throw new Error(`Database connection is currently busy or unavailable. Please retry. (${lastError?.message || 'SQLITE_BUSY'})`);
      }

      // Run background integrity check if production/packaged and not test
      const isProductionOrPkg = process.env.NODE_ENV === 'production' || isPackagedApp();
      if (isProductionOrPkg && !isTest) {
        const activeConn = this.connection;
        setImmediate(async () => {
          try {
            const integrityResult = await activeConn.get('PRAGMA quick_check');
            if (integrityResult?.quick_check !== 'ok') {
              console.error('[DB] Quick check failed, attempting WAL checkpoint recovery...');
              await activeConn.run('PRAGMA wal_checkpoint(TRUNCATE)');
              const recheck = await activeConn.get('PRAGMA quick_check');
              if (recheck?.quick_check !== 'ok') {
                console.error('[DB] Background quick check failed after WAL checkpoint. Starting silent background restoration...');
                const healedDb = await this.runSelfHealing(dbPath, busyTimeout, 'Quick check failed after WAL checkpoint', activeConn);
                this.setupWriteInterceptor(healedDb);
                this.connection = healedDb;
              } else {
                console.log('[DB] WAL checkpoint recovery succeeded in background.');
              }
            }
          } catch (err: any) {
            const isBusy = err?.message?.includes('SQLITE_BUSY') || err?.message?.includes('locked');
            if (isBusy) {
              console.warn('[DB] Quick check hit transient busy lock. Skipping self-healing.');
              return;
            }

            if (err?.message?.includes('vtable constructor failed')) {
              console.warn('[DB] Quick check blocked by an unusable virtual table — rebuilding the search index.');
              try {
                const { ensureMedicinesFts } = await import('../database.js');
                await ensureMedicinesFts(activeConn);
                const recheck = await activeConn.get('PRAGMA quick_check');
                if (recheck?.quick_check === 'ok') {
                  console.log('[DB] Search index rebuilt; database is healthy, no restore needed.');
                  return;
                }
              } catch (ftsErr: any) {
                console.error('[DB] Search index rebuild failed:', ftsErr.message);
              }
            }

            console.error('[DB] Background quick check error:', err);
            try {
              const healedDb = await this.runSelfHealing(dbPath, busyTimeout, err.message || 'Background check error', activeConn);
              this.setupWriteInterceptor(healedDb);
              this.connection = healedDb;
            } catch (healErr) {
              console.error('[DB] Background healing failed:', healErr);
            }
          }
        });
      }
    }
    return this.connection;
  }

  private setupWriteInterceptor(db: Database) {
    const originalRun = db.run.bind(db);
    const originalExec = db.exec.bind(db);

    const checkWriteQuery = (sql: string): { isInventoryWrite: boolean } => {
      if (!sql) return { isInventoryWrite: false };
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
        return { isInventoryWrite };
      }
      return { isInventoryWrite: false };
    };

    db.run = async function (sql: any, ...params: any[]) {
      if (typeof sql === 'string') {
        const sqlLower = sql.toLowerCase();
        const { isInventoryWrite } = checkWriteQuery(sql);
        if (isInventoryWrite) {
          let inventoryIds: number[] | undefined;
          if (sqlLower.includes('update') && sqlLower.includes('inventory_master') && sqlLower.includes('where')) {
            const flatParams: any[] = [];
            for (const p of params) {
              if (Array.isArray(p)) flatParams.push(...p);
              else if (p !== undefined && p !== null) flatParams.push(p);
            }
            const lastNum = [...flatParams].reverse().find(v => typeof v === 'number' && Number.isInteger(v) && v > 0);
            if (lastNum !== undefined) inventoryIds = [lastNum as number];
          }
          import('../services/expiryAlertService.js')
            .then(m => m.triggerExpiryCacheRebuildDebounced(inventoryIds))
            .catch(err => console.error('Failed to trigger expiry cache rebuild:', err));
        }
      }
      return originalRun(sql, ...params);
    } as any;

    db.exec = async function (sql: string) {
      checkWriteQuery(sql);
      return originalExec(sql);
    };
  }

  private async runSelfHealing(dbPath: string, busyTimeout: number, initialErrorMsg: string, oldDb?: Database): Promise<Database> {
    if (process.env.DISABLE_SELF_HEALING_WORKERS !== 'false') {
      console.warn('[DB] Self-healing DB worker is DISABLED. Skipping silent DB auto-restoration.');
      throw new Error(`DB_INTEGRITY_FAILURE: ${initialErrorMsg}`);
    }

    if (oldDb) {
      try {
        await oldDb.close();
      } catch (_) {}
    }

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
    const snapshotsDir = path.join(getAppDataDir(), 'backup', 'snapshots');
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
      await healedDb.run(`PRAGMA busy_timeout = ${busyTimeout};`);

      // Re-verify
      const healedIntegrity = await healedDb.get('PRAGMA integrity_check');
      if (healedIntegrity?.integrity_check !== 'ok') {
        appendLog(`[ERROR] Restored database from ${targetBackup.name} failed integrity check.`);
        await healedDb.close();
        throw new Error('DB_INTEGRITY_FAILURE');
      }

      appendLog('[SUCCESS] Boot self-healing finished. System resumed successfully.');
      console.log('[DB] Silent self-healing database recovery succeeded.');

      return healedDb;
    } catch (err: any) {
      appendLog(`[FATAL] Failed to open healed database: ${err.message}`);
      throw new Error('DB_INTEGRITY_FAILURE');
    }
  }

  public async close(force: boolean = false): Promise<void> {
    if (force) {
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
      await db.run('BEGIN IMMEDIATE TRANSACTION');
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