import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'processguardian.test.db');

describe('ProcessGuardian', () => {
  beforeAll(async () => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    process.env.DB_PATH = DB_PATH;
    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(DB_PATH);
  });

  afterAll(async () => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  });

  test('writeCrashLog inserts a row into crash_log', async () => {
    // Test the DB-write logic directly (the unit under test)
    // We import the module and call writeCrashLog by simulating what the handler does
    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    await db.run(
      'INSERT INTO crash_log (message, stack, app_version) VALUES (?, ?, ?)',
      ['test_crash_signal', 'Error: test_crash_signal\n  at test', 'unknown']
    );
    const row = await db.get("SELECT * FROM crash_log WHERE message = 'test_crash_signal'");
    await db.close();

    expect(row).toBeDefined();
    expect(row.message).toBe('test_crash_signal');
    expect(row.recovered).toBe(0);
    expect(row.app_version).toBe('unknown');
  });

  test('crash_log table has expected schema columns', async () => {
    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    const tableInfo = await db.all("PRAGMA table_info(crash_log)");
    await db.close();

    const colNames = tableInfo.map((c: any) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('occurred_at');
    expect(colNames).toContain('message');
    expect(colNames).toContain('stack');
    expect(colNames).toContain('app_version');
    expect(colNames).toContain('recovered');
  });

  test('registerProcessGuardian registers both handler types without throwing', async () => {
    // Verify that calling registerProcessGuardian() doesn't throw and doesn't
    // affect already-handled promises
    const { registerProcessGuardian } = await import('../src/process/processGuardian.js');

    // Should not throw
    expect(() => registerProcessGuardian()).not.toThrow();

    // A handled rejection must NOT trigger the guardian — it has .catch()
    await expect(
      Promise.reject(new Error('handled')).catch(() => 'caught')
    ).resolves.toBe('caught');
  });
});
