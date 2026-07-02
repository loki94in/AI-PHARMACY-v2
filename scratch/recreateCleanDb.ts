import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';

async function checkIntegrity(dbPath: string): Promise<boolean> {
  try {
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const result = await db.get('PRAGMA integrity_check');
    await db.close();
    return result?.integrity_check === 'ok';
  } catch (e) {
    return false;
  }
}

async function run() {
  const dbPath = path.resolve('data', 'app.db');
  console.log('Current DB Path:', dbPath);

  // Close any existing connection first
  try {
    await dbManager.close(true);
  } catch (_) {}

  // List backups
  const backupDir = path.resolve('backup');
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('app_backup_') && f.endsWith('.db.gz'))
    .map(f => path.join(backupDir, f));

  console.log('Found backups:', files);

  let restored = false;

  // Try to restore from backups starting from latest
  for (const backupPath of files.reverse()) {
    console.log(`Checking backup: ${backupPath}`);
    const tempDbPath = dbPath + '.temp_check';
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

    try {
      const buffer = fs.readFileSync(backupPath);
      const decompressed = zlib.gunzipSync(buffer);
      fs.writeFileSync(tempDbPath, decompressed);

      const isHealthy = await checkIntegrity(tempDbPath);
      if (isHealthy) {
        console.log(`Backup is HEALTHY: ${backupPath}. Restoring it...`);
        // Remove active db
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
        if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');

        fs.writeFileSync(dbPath, decompressed);
        restored = true;
        fs.unlinkSync(tempDbPath);
        break;
      } else {
        console.warn(`Backup is CORRUPT: ${backupPath}`);
        fs.unlinkSync(tempDbPath);
      }
    } catch (e: any) {
      console.error(`Failed to process backup ${backupPath}:`, e.message);
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    }
  }

  if (!restored) {
    console.log('No healthy backup found. Re-initializing a clean database...');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');

    await ensureSchema(dbPath);
    console.log('Clean database initialized successfully.');
  } else {
    console.log('Successfully restored from healthy backup.');
  }

  // Double check new database health
  const isHealthyNow = await checkIntegrity(dbPath);
  console.log('Active DB is healthy:', isHealthyNow);
}

run().catch(console.error);
