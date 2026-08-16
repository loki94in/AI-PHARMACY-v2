/**
 * TASK 8 — Remove Fabricated Legacy Medicine Names
 * Tests that LEGACY_MEDICINE_<id> is never created during migration.
 * Required behavior:
 *   - Valid medicine_id resolves correctly.
 *   - Unknown medicine_id is skipped with an audit entry.
 *   - No fake medicine master record is created.
 *   - No inventory_master record is created for an unresolved medicine.
 */

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processInventoryLine } from '../src/worker/parsers/inventoryParser.js';
import { processSalesLine } from '../src/worker/parsers/salesParser.js';
import {
  ensureMigrationAuditTable,
  getMigrationAuditSummary,
  getMigrationAuditRecords,
  clearMigrationAudit,
} from '../src/utils/migrationAudit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '..', 'data', 'test_migration_legacy_medicine.db');

describe('TASK 8: Fabricated Legacy Medicine Name Removal', () => {
  let db: any;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = await open({ filename: TEST_DB, driver: sqlite3.Database });

    await db.exec(`
      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );

      CREATE TABLE inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 0,
        rack_location TEXT,
        batch_no TEXT,
        expiry_date TEXT
      );

      CREATE TABLE sales_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE,
        customer_id INTEGER,
        date TEXT,
        total_amount REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        subtotal REAL DEFAULT 0
      );

      CREATE TABLE sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER,
        inventory_id INTEGER,
        quantity INTEGER,
        unit_price REAL
      );
    `);

    await ensureMigrationAuditTable(db);
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  beforeEach(async () => {
    await clearMigrationAudit(db);
    await db.run('DELETE FROM sale_items');
    await db.run('DELETE FROM sales_invoices');
    await db.run('DELETE FROM inventory_master');
    await db.run('DELETE FROM medicines');
  });

  describe('1. Valid medicine mapping', () => {
    it('processes an inventory line successfully when medicine exists in medicines table', async () => {
      await db.run("INSERT INTO medicines (id, name) VALUES (42, 'Paracetamol 500mg')");

      const inventoryLine = `INSERT INTO legacy_stock VALUES (42, 100, 'A-1', 'BATCH-2025-01', '2027-06-30')`;
      const result = await processInventoryLine(inventoryLine, db);

      expect(result).toBe(true);

      const inv = await db.get('SELECT * FROM inventory_master WHERE medicine_id = 42');
      expect(inv).toBeDefined();
      expect(inv.quantity).toBe(100);
      expect(inv.batch_no).toBe('BATCH-2025-01');

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedMedicines).toBe(0);
    });
  });

  describe('2. Unknown medicine ID is skipped', () => {
    it('skips inventory line and records audit entry when medicine_id does not exist', async () => {
      const inventoryLine = `INSERT INTO legacy_stock VALUES (999, 50, 'B-2', 'BATCH-OLD-01', '2026-12-31')`;
      const result = await processInventoryLine(inventoryLine, db);

      expect(result).toBe(false);

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedMedicines).toBe(1);
      expect(summary.skippedRecords).toBe(1);

      const records = await getMigrationAuditRecords(db);
      expect(records.rows.length).toBe(1);
      const auditRow = records.rows[0];
      expect(auditRow.entity_type).toBe('medicine');
      expect(auditRow.status).toBe('skipped');
      expect(String(auditRow.raw_value)).toBe('999');
      expect(auditRow.reason).toContain('999');
      expect(auditRow.reason).not.toContain('LEGACY_MEDICINE');
    });

    it('skips sale item and records audit entry when medicine_id does not exist in inventory_master', async () => {
      await db.run(
        "INSERT INTO sales_invoices (invoice_no, customer_id, date, total_amount, tax_amount, subtotal) VALUES ('INV-LEGACY-TEST-01', NULL, '2026-08-01', 500, 50, 500)"
      );

      const saleItemLine = `INSERT INTO legacy_saleItems VALUES (1, 'INV-LEGACY-TEST-01', 777, 2, 250.00)`;
      const result = await processSalesLine(saleItemLine, db);

      expect(result).toBe(false);

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedMedicines).toBe(1);
      expect(summary.skippedRecords).toBe(1);

      const records = await getMigrationAuditRecords(db);
      const medicineAudit = records.rows.find((r: any) => r.entity_type === 'medicine');
      expect(medicineAudit).toBeDefined();
      expect(String(medicineAudit.raw_value)).toBe('777');
      expect(medicineAudit.reason).not.toContain('LEGACY_MEDICINE');
    });
  });

  describe('3. No fake medicine record is created', () => {
    it('does not insert any medicine row when medicine_id cannot be resolved (inventory parser)', async () => {
      const inventoryLine = `INSERT INTO legacy_stock VALUES (123, 30, 'C-3', 'BATCH-NOMED', '2025-10-01')`;
      await processInventoryLine(inventoryLine, db);

      const medicineRows = await db.all('SELECT * FROM medicines');
      expect(medicineRows.length).toBe(0);

      const fakeMed = await db.get("SELECT * FROM medicines WHERE name LIKE 'LEGACY_MEDICINE_%'");
      expect(fakeMed).toBeUndefined();
    });

    it('does not insert any medicine row when medicine_id cannot be resolved (sales parser)', async () => {
      await db.run(
        "INSERT INTO sales_invoices (invoice_no, customer_id, date, total_amount, tax_amount, subtotal) VALUES ('INV-NOMEDTEST-02', NULL, '2026-08-01', 300, 30, 300)"
      );

      const saleItemLine = `INSERT INTO legacy_saleItems VALUES (1, 'INV-NOMEDTEST-02', 456, 1, 300.00)`;
      await processSalesLine(saleItemLine, db);

      const medicineRows = await db.all('SELECT * FROM medicines');
      expect(medicineRows.length).toBe(0);

      const fakeMed = await db.get("SELECT * FROM medicines WHERE name LIKE 'LEGACY_MEDICINE_%'");
      expect(fakeMed).toBeUndefined();
    });
  });

  describe('4. No inventory record is created for unresolved medicine', () => {
    it('does not insert any inventory_master row when medicine_id cannot be resolved (inventory parser)', async () => {
      const inventoryLine = `INSERT INTO legacy_stock VALUES (888, 10, 'D-4', 'BATCH-GHOST', '2026-01-01')`;
      await processInventoryLine(inventoryLine, db);

      const invRows = await db.all('SELECT * FROM inventory_master');
      expect(invRows.length).toBe(0);
    });

    it('does not insert any sale_items row when medicine_id cannot be resolved (sales parser)', async () => {
      await db.run(
        "INSERT INTO sales_invoices (invoice_no, customer_id, date, total_amount, tax_amount, subtotal) VALUES ('INV-GHOSTMED-03', NULL, '2026-08-01', 400, 40, 400)"
      );

      const saleItemLine = `INSERT INTO legacy_saleItems VALUES (1, 'INV-GHOSTMED-03', 321, 3, 133.00)`;
      await processSalesLine(saleItemLine, db);

      const saleItems = await db.all('SELECT * FROM sale_items');
      expect(saleItems.length).toBe(0);

      const invRows = await db.all('SELECT * FROM inventory_master');
      expect(invRows.length).toBe(0);
    });
  });
});
