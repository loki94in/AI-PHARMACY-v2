import './sqlitePatch.js';
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

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
      const db = await open({ filename: dbPath, driver: sqlite3.Database });
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
            await db.close();
            throw new Error('DB_INTEGRITY_FAILURE');
          }
          console.log('[DB] WAL checkpoint recovery succeeded.');
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