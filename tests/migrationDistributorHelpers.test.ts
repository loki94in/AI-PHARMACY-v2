import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findOrCreateDistributor, resetDistributorLookupCache } from '../src/utils/migrationDistributorHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '..', 'data', 'test_migration_distributor.db');

describe('migrationDistributorHelpers', () => {
  let db: any;

  beforeEach(async () => {
    resetDistributorLookupCache();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = await open({ filename: TEST_DB, driver: sqlite3.Database });
    await db.exec('CREATE TABLE distributors (id INTEGER PRIMARY KEY, name TEXT)');
  });

  afterEach(async () => {
    await db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('reuses distributor when normalized name matches', async () => {
    await db.run('INSERT INTO distributors (name) VALUES (?)', ['Sun Pharma Ltd.']);
    const first = await findOrCreateDistributor(db, 'SUN PHARMA');
    const second = await findOrCreateDistributor(db, 'Sun Pharmaceutical');
    expect(first.id).toBe(second.id);
    const count = await db.get('SELECT COUNT(*) as cnt FROM distributors');
    expect(count.cnt).toBe(1);
  });

  it('creates a new distributor when no normalized match exists', async () => {
    const created = await findOrCreateDistributor(db, 'Acme Medical Agency');
    expect(created.id).toBeGreaterThan(0);
    const row = await db.get('SELECT name FROM distributors WHERE id = ?', [created.id]);
    expect(row.name).toBe('Acme Medical Agency');
  });
});
