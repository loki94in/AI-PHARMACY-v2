import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'ftsRepair.test.db');

const FTS_SHADOWS = ['medicines_fts_data', 'medicines_fts_idx', 'medicines_fts_docsize', 'medicines_fts_config'];

async function connect() {
  return open({ filename: DB_PATH, driver: sqlite3.Database });
}

/**
 * Reproduce the exact damage a factory reset can leave behind: the medicines_fts
 * declaration survives in sqlite_master while all of its FTS5 shadow tables are
 * dropped. SQLite then cannot construct the vtable, and the medicines_ai trigger
 * makes every INSERT INTO medicines fail.
 */
async function orphanFts(db: any) {
  for (const shadow of FTS_SHADOWS) {
    await db.exec(`DROP TABLE IF EXISTS ${shadow}`);
  }
}

async function ftsObjectNames(db: any): Promise<string[]> {
  const rows = await db.all("SELECT name FROM sqlite_master WHERE name LIKE 'medicines_fts%' ORDER BY name");
  return rows.map((r: any) => r.name);
}

async function insertMedicine(db: any, name: string): Promise<string | null> {
  try {
    await db.run('INSERT INTO medicines (name) VALUES (?)', [name]);
    return null;
  } catch (err: any) {
    return err.message;
  }
}

async function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = DB_PATH + suffix;
    if (!fs.existsSync(p)) continue;
    for (let i = 0; i < 10; i++) {
      try { fs.unlinkSync(p); break; } catch (e: any) {
        if (e.code === 'EBUSY' || e.code === 'EPERM') await new Promise(r => setTimeout(r, 50));
        else break;
      }
    }
  }
}

describe('orphaned medicines_fts recovery', () => {
  beforeAll(async () => {
    await cleanup();
    process.env.DB_PATH = DB_PATH;
    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(DB_PATH);
  });

  afterAll(async () => {
    try {
      const { dbManager } = await import('../src/database/connection.js');
      await dbManager.close(true);
    } catch { }
    delete process.env.DB_PATH;
    await cleanup();
  });

  test('a freshly created schema has a working medicines_fts', async () => {
    const db = await connect();
    const names = await ftsObjectNames(db);
    const err = await insertMedicine(db, 'FTS BASELINE PROBE');
    await db.close();

    expect(names).toContain('medicines_fts');
    expect(err).toBeNull();
  });

  test('dropping the FTS5 shadow tables makes every INSERT INTO medicines fail', async () => {
    const db = await connect();
    await orphanFts(db);
    const names = await ftsObjectNames(db);
    const err = await insertMedicine(db, 'SHOULD NOT BE INSERTABLE');
    await db.close();

    // Confirm we really reproduced the orphan state, not something else
    expect(names).toEqual(['medicines_fts']);
    expect(err).toMatch(/vtable constructor failed/);
  });

  test('ensureSchema repairs an orphaned medicines_fts even on an already-versioned DB', async () => {
    // The DB already stores the current schema_version, so this also proves the
    // repair is not hidden behind ensureSchema's fast-path early return.
    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(DB_PATH);

    const db = await connect();
    const names = await ftsObjectNames(db);
    const err = await insertMedicine(db, 'INSERTABLE AFTER REPAIR');
    const count = await db.get('SELECT COUNT(*) AS c FROM medicines WHERE name = ?', ['INSERTABLE AFTER REPAIR']);
    await db.close();

    expect(err).toBeNull();
    expect(count.c).toBe(1);
    // the vtable plus all four shadow tables must be back
    expect(names).toEqual(expect.arrayContaining(['medicines_fts', ...FTS_SHADOWS]));
  });

  test('rows that existed before the breakage are searchable again after repair', async () => {
    // The rebuild path: these rows are already in `medicines` when the index is
    // destroyed, so no trigger can re-add them. A plain COUNT(*) on the FTS table is
    // served from the content table and would wrongly report the index as populated.
    const seed = await connect();
    await seed.run('INSERT INTO medicines (name) VALUES (?)', ['DOLOMITE FORTE 650']);
    for (const shadow of FTS_SHADOWS) {
      await seed.exec(`DROP TABLE IF EXISTS ${shadow}`);
    }
    await seed.close();

    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(DB_PATH);

    const db = await connect();
    const hit = await db.get("SELECT COUNT(*) AS c FROM medicines_fts WHERE medicines_fts MATCH 'dolomi'");
    await db.close();

    expect(hit.c).toBeGreaterThan(0);
  });

  test('the repaired FTS index is queryable and tracks new rows', async () => {
    const db = await connect();
    await insertMedicine(db, 'ZYRTEC CETIRIZINE 10MG');
    const hit = await db.get("SELECT COUNT(*) AS c FROM medicines_fts WHERE medicines_fts MATCH 'cetiri'");
    const integrity = await db.get('PRAGMA integrity_check');
    await db.close();

    expect(hit.c).toBeGreaterThan(0);
    expect(integrity.integrity_check).toBe('ok');
  });
});
