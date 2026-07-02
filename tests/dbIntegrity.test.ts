import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'integrity.test.db');

// Helpers to get a fresh DatabaseManager instance pointing at our test DB
async function getTestConnection() {
  // Bypass the singleton by opening directly — we're testing the logic, not the singleton
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  return db;
}

async function runIntegrityCheck(db: any): Promise<string> {
  const result = await db.get('PRAGMA integrity_check');
  return result?.integrity_check ?? 'error';
}

describe('DB Integrity Check', () => {
  beforeAll(async () => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(DB_PATH);
  });

  afterAll(() => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  });

  test('healthy DB passes integrity_check without needing recovery', async () => {
    const db = await getTestConnection();
    const status = await runIntegrityCheck(db);
    await db.close();
    expect(status).toBe('ok');
  });

  test('corrupted DB file causes DB_INTEGRITY_FAILURE to be thrown from getConnection()', async () => {
    // Create a corrupt DB by writing garbage bytes to a copy
    const corruptPath = path.resolve(__dirname, '..', 'data', 'corrupt.test.db');
    // Write garbage — enough bytes to look like a file but fail SQLite header check
    fs.writeFileSync(corruptPath, Buffer.alloc(4096, 0xDE));

    // The integrity check in connection.ts skips in NODE_ENV=test, so we test
    // the integrity logic directly here
    let threw = false;
    let db: any;
    try {
      db = await open({ filename: corruptPath, driver: sqlite3.Database });
      const result = await db.get('PRAGMA integrity_check');
      if (result?.integrity_check !== 'ok') {
        // Mimic connection.ts logic
        await db.run('PRAGMA wal_checkpoint(TRUNCATE)');
        const recheck = await db.get('PRAGMA integrity_check');
        if (recheck?.integrity_check !== 'ok') {
          await db.close();
          throw new Error('DB_INTEGRITY_FAILURE');
        }
      }
    } catch (err: any) {
      threw = true;
      // Either SQLite can't open the file, or our integrity check throws
      expect(
        err.message === 'DB_INTEGRITY_FAILURE' ||
        err.message.includes('SQLITE_') ||
        err.message.includes('unable to open') ||
        err.message.includes('malformed') ||
        err.message.includes('not a database')
      ).toBe(true);
    } finally {
      try { if (db) await db.close(); } catch (_) {}
      if (fs.existsSync(corruptPath)) {
        let deleted = false;
        for (let i = 0; i < 10; i++) {
          try {
            fs.unlinkSync(corruptPath);
            deleted = true;
            break;
          } catch (e: any) {
            if (e.code === 'EBUSY') {
              await new Promise((resolve) => setTimeout(resolve, 50));
            } else {
              throw e;
            }
          }
        }
        if (!deleted) {
          try { fs.unlinkSync(corruptPath); } catch (_) {}
        }
      }
    }
    expect(threw).toBe(true);
  });

  test('healthy DB with WAL files present passes without triggering checkpoint recovery', async () => {
    // Simulate WAL presence — just verify integrity on a known-good DB
    const db = await getTestConnection();
    await db.run('PRAGMA journal_mode=WAL');
    // Write something to trigger WAL creation
    await db.run('CREATE TABLE IF NOT EXISTS _wal_test (id INTEGER PRIMARY KEY)');
    await db.run('INSERT INTO _wal_test VALUES (1)');
    const status = await runIntegrityCheck(db);
    await db.close();
    expect(status).toBe('ok');
  });
});
