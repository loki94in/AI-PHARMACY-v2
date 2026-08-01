import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rebuildMigrationInventoryStock } from '../src/utils/migrationStockRebuild.js';
import { applyStockDelta, rebuildStockFromLedger } from '../src/utils/stockRebuild.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB = path.join(__dirname, '..', 'data', 'test_migration_stock_rebuild.db');

describe('migrationStockRebuild', () => {
  let db: any;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = await open({ filename: TEST_DB, driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE medicines (id INTEGER PRIMARY KEY, name TEXT, pack_size INTEGER DEFAULT 10);
      CREATE TABLE inventory_master (
        id INTEGER PRIMARY KEY, medicine_id INTEGER, batch_no TEXT,
        quantity INTEGER DEFAULT 0, loose_quantity INTEGER DEFAULT 0, legacy_batch_id TEXT,
        expiry_date TEXT
      );
      CREATE TABLE purchase_items (id INTEGER PRIMARY KEY, medicine_id INTEGER, batch_no TEXT, quantity INTEGER);
      CREATE TABLE sale_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, inventory_id INTEGER, quantity INTEGER, loose_qty INTEGER);
      CREATE TABLE returns (id INTEGER PRIMARY KEY, type TEXT);
      CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, medicine_id INTEGER, batch_no TEXT, quantity INTEGER);
      CREATE TABLE stock_ledger (id INTEGER PRIMARY KEY, medicine_id INTEGER, batch_no TEXT, quantity INTEGER, loose_quantity INTEGER);
    `);
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (1, "Paracetamol", 10)');
  });

  afterEach(async () => {
    await db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('zeros stock when sales exceed imported quantity', async () => {
    await db.run(
      'INSERT INTO inventory_master (id, medicine_id, batch_no, quantity) VALUES (1, 1, "B1", 100)'
    );
    await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, loose_qty) VALUES (1, 1, 100, 0)');

    const result = await rebuildMigrationInventoryStock(db);
    const row = await db.get('SELECT quantity, loose_quantity FROM inventory_master WHERE id = 1');

    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(row.quantity).toBe(0);
    expect(row.loose_quantity).toBe(0);
  });

  it('rebuilds from stock_ledger when ledger rows exist', async () => {
    await db.run(
      'INSERT INTO inventory_master (id, medicine_id, batch_no, quantity, legacy_batch_id) VALUES (1, 1, "B1", 999, "legacy-1")'
    );
    await db.run(
      'INSERT INTO stock_ledger (medicine_id, batch_no, quantity, loose_quantity) VALUES (1, "B1", 5, 3)'
    );

    await rebuildMigrationInventoryStock(db);
    const row = await db.get('SELECT quantity, loose_quantity FROM inventory_master WHERE id = 1');
    const expected = rebuildStockFromLedger([{ quantity: 5, loose_quantity: 3 }], 10);

    expect(row.quantity).toBe(expected.quantity);
    expect(row.loose_quantity).toBe(expected.loose_quantity);
  });

  it('adds purchase quantity to inventory baseline before subtracting sales', async () => {
    await db.run(
      'INSERT INTO inventory_master (id, medicine_id, batch_no, quantity) VALUES (1, 1, "B1", 0)'
    );
    await db.run('INSERT INTO purchase_items (medicine_id, batch_no, quantity) VALUES (1, "B1", 50)');
    await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, loose_qty) VALUES (1, 1, 20, 0)');

    await rebuildMigrationInventoryStock(db);
    const row = await db.get('SELECT quantity FROM inventory_master WHERE id = 1');
    expect(row.quantity).toBe(30);
  });
});
