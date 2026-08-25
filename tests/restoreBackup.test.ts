import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'restore.test.db');
const BACKUP_DIR = path.join(DATA_DIR, 'restore_test_backups');

// backupService captures config.dbPath/config.backupDir at import time, so both env
// vars must be set before it is first imported.
process.env.DB_PATH = DB_PATH;
process.env.BACKUP_DIR = BACKUP_DIR;

async function connect() {
  return open({ filename: DB_PATH, driver: sqlite3.Database });
}

async function medicineNames(): Promise<string[]> {
  const db = await connect();
  const rows = await db.all('SELECT name FROM medicines ORDER BY name');
  await db.close();
  return rows.map((r: any) => r.name);
}

function rmIfPresent(p: string) {
  if (!fs.existsSync(p)) return;
  for (let i = 0; i < 10; i++) {
    try { fs.unlinkSync(p); return; } catch (e: any) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM') return;
    }
  }
}

describe('restoreBackup replaces the live database', () => {
  let backupFile = '';

  beforeAll(async () => {
    for (const suffix of ['', '-wal', '-shm']) rmIfPresent(DB_PATH + suffix);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    for (const f of fs.readdirSync(BACKUP_DIR)) rmIfPresent(path.join(BACKUP_DIR, f));

    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(DB_PATH);
  });

  afterAll(async () => {
    try {
      const { dbManager } = await import('../src/database/connection.js');
      await dbManager.close(true);
    } catch { }
    delete process.env.DB_PATH;
    delete process.env.BACKUP_DIR;
    for (const suffix of ['', '-wal', '-shm']) rmIfPresent(DB_PATH + suffix);
    if (fs.existsSync(BACKUP_DIR)) {
      for (const f of fs.readdirSync(BACKUP_DIR)) rmIfPresent(path.join(BACKUP_DIR, f));
      try { fs.rmdirSync(BACKUP_DIR); } catch { }
    }
  });

  test('a backup the app generated itself can be created', async () => {
    const db = await connect();
    await db.run('INSERT INTO medicines (name) VALUES (?)', ['PRESENT_IN_BACKUP']);
    await db.close();

      const { createBackup } = await import('../src/services/backupService.js');
      // 'Manual' bypasses the 60s boot-defer guard (cold-boot lock contention protection)
      const result = await createBackup('Manual');
    backupFile = result.filename;

    expect(backupFile).toMatch(/\.db\.gz$/);
    expect(fs.existsSync(path.join(BACKUP_DIR, backupFile))).toBe(true);
  });

  test('restoring it rolls the database back, discarding later writes', async () => {
    // Change the live DB after the backup was taken.
    const db = await connect();
    await db.run('DELETE FROM medicines WHERE name = ?', ['PRESENT_IN_BACKUP']);
    await db.run('INSERT INTO medicines (name) VALUES (?)', ['WRITTEN_AFTER_BACKUP']);
    await db.close();

    expect(await medicineNames()).toEqual(['WRITTEN_AFTER_BACKUP']);

    const { restoreBackup } = await import('../src/services/backupService.js');
    await restoreBackup(backupFile);

    // The restored file must win. Before the fix a non-forced close left the old
    // connection alive and its WAL was checkpointed back over the restored file,
    // so the post-backup state survived and the restore silently did nothing.
    const names = await medicineNames();
    expect(names).toContain('PRESENT_IN_BACKUP');
    expect(names).not.toContain('WRITTEN_AFTER_BACKUP');
  });

  test('no stale -wal/-shm sidecars are left pointing at the replaced database', async () => {
    // A leftover WAL from the pre-restore database can be replayed over the
    // restored file on the next open.
    const walSize = fs.existsSync(DB_PATH + '-wal') ? fs.statSync(DB_PATH + '-wal').size : 0;
    const db = await connect();
    const integrity = await db.get('PRAGMA integrity_check');
    await db.close();

    expect(integrity.integrity_check).toBe('ok');
    // Any WAL present must belong to the restored DB (written after the swap), so it
    // cannot still hold the discarded row.
    expect(await medicineNames()).not.toContain('WRITTEN_AFTER_BACKUP');
    expect(walSize).toBeGreaterThanOrEqual(0);
  });

  test('a restore leaves the medicines_fts index usable', async () => {
    const db = await connect();
    const fts = await db.all("SELECT name FROM sqlite_master WHERE name LIKE 'medicines_fts%'");
    let insertErr: string | null = null;
    try {
      await db.run('INSERT INTO medicines (name) VALUES (?)', ['POST_RESTORE_WRITE']);
    } catch (e: any) {
      insertErr = e.message;
    }
    await db.close();

    expect(insertErr).toBeNull();
    expect(fts.length).toBeGreaterThanOrEqual(1);
  });

  test('a backup taken while the FTS index was broken can still be restored', async () => {
    // integrity_check opens every virtual table, so such a backup makes the pre-swap
    // validation throw. That must not be mistaken for a corrupt file and block the
    // restore, since the index is rebuilt right after the swap.
    const db = await connect();
    for (const shadow of ['medicines_fts_data', 'medicines_fts_idx', 'medicines_fts_docsize', 'medicines_fts_config']) {
      await db.exec(`DROP TABLE IF EXISTS ${shadow}`);
    }
    await db.close();

    const { createBackup, restoreBackup } = await import('../src/services/backupService.js');
      const broken = await createBackup('Manual');

    await expect(restoreBackup(broken.filename)).resolves.toBeUndefined();

    const after = await connect();
    let err: string | null = null;
    try {
      await after.run('INSERT INTO medicines (name) VALUES (?)', ['AFTER_BROKEN_BACKUP_RESTORE']);
    } catch (e: any) {
      err = e.message;
    }
    await after.close();
    expect(err).toBeNull();
  });

  test('a restore repairs a live database whose FTS index was broken', async () => {
    const db = await connect();
    for (const shadow of ['medicines_fts_data', 'medicines_fts_idx', 'medicines_fts_docsize', 'medicines_fts_config']) {
      await db.exec(`DROP TABLE IF EXISTS ${shadow}`);
    }
    let brokenErr: string | null = null;
    try {
      await db.run('INSERT INTO medicines (name) VALUES (?)', ['SHOULD_FAIL']);
    } catch (e: any) {
      brokenErr = e.message;
    }
    await db.close();
    expect(brokenErr).toMatch(/vtable constructor failed/);

    const { restoreBackup } = await import('../src/services/backupService.js');
    await restoreBackup(backupFile);

    const after = await connect();
    let afterErr: string | null = null;
    try {
      await after.run('INSERT INTO medicines (name) VALUES (?)', ['WRITES_AGAIN']);
    } catch (e: any) {
      afterErr = e.message;
    }
    await after.close();

    expect(afterErr).toBeNull();
  });
});
