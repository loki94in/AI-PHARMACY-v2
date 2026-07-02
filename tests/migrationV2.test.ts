import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test_staging.db');

describe('Migration V2 Staging & Conflicts Tests', () => {
  let db: any;

  beforeAll(async () => {
    // Setup a clean staging DB for tests
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    db = await open({ filename: TEST_DB_PATH, driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER,
        quantity INTEGER DEFAULT 0,
        loose_quantity INTEGER DEFAULT 0,
        rack_location TEXT,
        batch_no TEXT,
        expiry_date DATETIME,
        cost_price REAL DEFAULT 0,
        mrp REAL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS migration_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        module_type TEXT,
        raw_imported_data TEXT,
        matching_record_id INTEGER,
        conflict_reason TEXT,
        status TEXT DEFAULT 'pending'
      );
    `);
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it('should stage a duplicate batch conflict correctly', async () => {
    // 1. Insert existing medicine and inventory batch
    await db.run('INSERT INTO medicines (name) VALUES (?)', ['Paracetamol']);
    await db.run(
      'INSERT INTO inventory_master (medicine_id, quantity, batch_no, cost_price, mrp) VALUES (?, ?, ?, ?, ?)',
      [1, 50, 'BATCH-01', 10, 15]
    );

    // 2. Mock importer logic detecting duplicate medicine/batch
    const rawImportedData = {
      medicine_id: 1,
      quantity: 100,
      loose_quantity: 0,
      rack_location: 'RACK-A',
      batch_no: 'BATCH-01',
      expiry_date: '2028-12-31',
      cost_price: 12,
      mrp: 18,
    };

    const existingBatch = await db.get(
      'SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?',
      [1, 'BATCH-01']
    );
    expect(existingBatch).toBeDefined();
    expect(existingBatch.id).toBe(1);

    // Write conflict to table
    await db.run(
      'INSERT INTO migration_conflicts (module_type, raw_imported_data, matching_record_id, conflict_reason) VALUES (?, ?, ?, ?)',
      ['inventory', JSON.stringify(rawImportedData), existingBatch.id, 'Duplicate Batch Number']
    );

    const conflict = await db.get('SELECT * FROM migration_conflicts WHERE status = "pending"');
    expect(conflict).toBeDefined();
    expect(conflict.module_type).toBe('inventory');
    expect(JSON.parse(conflict.raw_imported_data).quantity).toBe(100);
  });

  it('should resolve conflict with Merge option correctly', async () => {
    const conflict = await db.get('SELECT * FROM migration_conflicts WHERE status = "pending"');
    const rawRow = JSON.parse(conflict.raw_imported_data);

    // Execute Merge resolution
    const existing = await db.get('SELECT * FROM inventory_master WHERE id = ?', [conflict.matching_record_id]);
    const newQty = (existing.quantity || 0) + (rawRow.quantity || 0);
    await db.run('UPDATE inventory_master SET quantity = ? WHERE id = ?', [newQty, conflict.matching_record_id]);
    await db.run('UPDATE migration_conflicts SET status = "resolved_merge" WHERE id = ?', [conflict.id]);

    const updatedBatch = await db.get('SELECT quantity FROM inventory_master WHERE id = 1');
    expect(updatedBatch.quantity).toBe(150); // 50 + 100
  });
});
