/**
 * TASK 9 — Invoice Number Integrity
 * Verifies that:
 *   1. Real invoice numbers are preserved exactly.
 *   2. Missing invoice numbers cause the record to be skipped with an audit entry.
 *   3. Duplicate invoice numbers are handled without fabricating a new one.
 *   4. No Date.now(), random numbers, counters, or arbitrary strings are used
 *      as replacements for historical invoice numbers.
 */

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  clearAllMaps,
  patientMap,
  distributorMap,
} from '../src/worker/importers/pgMasterImporter.js';
import {
  importOrder,
  flushSalesInvoices,
  clearSalesMap,
} from '../src/worker/importers/pgSalesImporter.js';
import {
  importInventory,
  flushPurchases,
  clearPurchaseMap,
} from '../src/worker/importers/pgPurchaseImporter.js';
import { processSalesLine } from '../src/worker/parsers/salesParser.js';
import {
  ensureMigrationAuditTable,
  getMigrationAuditSummary,
  getMigrationAuditRecords,
  clearMigrationAudit,
  flushMigrationAudits,
} from '../src/utils/migrationAudit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '..', 'data', 'test_invoice_number_integrity.db');

describe('TASK 9: Invoice Number Integrity', () => {
  let db: any;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = await open({ filename: TEST_DB, driver: sqlite3.Database });

    await db.exec(`
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        legacy_id TEXT
      );

      CREATE TABLE doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        legacy_id TEXT
      );

      CREATE TABLE distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        legacy_id TEXT
      );

      CREATE TABLE sales_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE,
        customer_id INTEGER,
        doctor_id INTEGER,
        date TEXT,
        total_amount REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        payment_medium TEXT,
        roff REAL DEFAULT 0,
        cgst_value REAL DEFAULT 0,
        sgst_value REAL DEFAULT 0,
        igst_value REAL DEFAULT 0,
        legacy_id TEXT,
        business_date TEXT,
        discount REAL DEFAULT 0,
        subtotal REAL DEFAULT 0
      );

      CREATE TABLE sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER,
        inventory_id INTEGER,
        quantity INTEGER,
        unit_price REAL
      );

      CREATE TABLE inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER,
        batch_no TEXT,
        quantity INTEGER DEFAULT 0,
        rack_location TEXT
      );

      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );

      CREATE TABLE purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT,
        distributor_id INTEGER,
        date TEXT,
        total_amount REAL DEFAULT 0,
        cgst_value REAL DEFAULT 0,
        sgst_value REAL DEFAULT 0,
        igst_value REAL DEFAULT 0,
        roff REAL DEFAULT 0,
        status TEXT DEFAULT 'PUBLISHED',
        legacy_id TEXT,
        business_date TEXT
      );

      CREATE TABLE migration_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT,
        row_index INTEGER,
        raw_data TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    await ensureMigrationAuditTable(db);
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  beforeEach(async () => {
    clearAllMaps();
    clearSalesMap();
    clearPurchaseMap();
    await clearMigrationAudit(db);
    await db.run('DELETE FROM sales_invoices');
    await db.run('DELETE FROM purchases');
    await db.run('DELETE FROM customers');
    await db.run('DELETE FROM doctors');
    await db.run('DELETE FROM distributors');
  });

  // ─── 1. Real invoice number ────────────────────────────────

  describe('1. Real invoice number is preserved', () => {
    it('pgSalesImporter: preserves original invoice number exactly as imported', async () => {
      const custRes = await db.run('INSERT INTO customers (name) VALUES (?)', ['Arjun Kapoor']);
      patientMap.set('PAT_01', custRes.lastID!);

      await importOrder({
        order_id: 'ORD_REAL_01',
        patient_id: 'PAT_01',
        invoice: 'BILL-2025-00123',
        amount: '1500',
        created_time: '2025-06-15 10:00:00',
        order_status: 'BILL',
      }, db);
      await flushSalesInvoices(db);

      const inv = await db.get('SELECT invoice_no FROM sales_invoices WHERE invoice_no = ?', ['BILL-2025-00123']);
      expect(inv).toBeDefined();
      expect(inv.invoice_no).toBe('BILL-2025-00123');
      // Must NOT be a synthetic fallback
      expect(inv.invoice_no).not.toMatch(/^ORD_REAL_01$/);
      expect(inv.invoice_no).not.toMatch(/LEGACY-/);
      expect(inv.invoice_no).not.toMatch(/^\d{13}$/); // no timestamp

      const summary = await getMigrationAuditSummary(db);
      expect(summary.skippedRecords).toBe(0);
    });

    it('pgPurchaseImporter: preserves original invoice number exactly as imported', async () => {
      const distRes = await db.run('INSERT INTO distributors (name) VALUES (?)', ['Sun Pharma Ltd']);
      distributorMap.set('DIST_01', distRes.lastID!);

      await importInventory({
        inventory_id: 'INV_REAL_01',
        distributor_id: 'DIST_01',
        invoice: 'PUR-2025-00456',
        created_time: '2025-06-10 09:00:00',
        amount: '8000',
        status: 'PUBLISHED',
      }, db);
      await flushPurchases(db);

      const pur = await db.get('SELECT invoice_no FROM purchases WHERE legacy_id = ?', ['INV_REAL_01']);
      expect(pur).toBeDefined();
      // FY suffix may be appended but the core invoice number must be present
      expect(pur.invoice_no).toContain('PUR-2025-00456');
      expect(pur.invoice_no).not.toMatch(/^INV_REAL_01$/);
      expect(pur.invoice_no).not.toMatch(/LEGACY-/);

      await flushMigrationAudits(db);
      const summary = await getMigrationAuditSummary(db);
      expect(summary.skippedRecords).toBe(0);
    });

    it('salesParser (SQL): preserves valid invoice number from legacy SQL INSERT', async () => {
      const sqlLine = `INSERT INTO legacy_sales VALUES ('INV-SQL-2025-999', '0', '2025-08-01', '750.00', '67.50')`;
      const result = await processSalesLine(sqlLine, db);
      expect(result).toBe(true);

      const inv = await db.get("SELECT invoice_no FROM sales_invoices WHERE invoice_no = 'INV-SQL-2025-999'");
      expect(inv).toBeDefined();
      expect(inv.invoice_no).toBe('INV-SQL-2025-999');
    });
  });

  // ─── 2. Missing invoice number → skip + audit ─────────────

  describe('2. Missing invoice number is skipped with audit entry', () => {
    it('pgSalesImporter: skips order with null invoice field and creates audit entry', async () => {
      const custRes = await db.run('INSERT INTO customers (name) VALUES (?)', ['Meera Singh']);
      patientMap.set('PAT_02', custRes.lastID!);

      await importOrder({
        order_id: 'ORD_NO_INV_01',
        patient_id: 'PAT_02',
        invoice: null, // No invoice number
        amount: '500',
        created_time: '2025-07-01 12:00:00',
        order_status: 'BILL',
      }, db);
      await flushSalesInvoices(db);

      // No record should be created
      const invCount = await db.get('SELECT COUNT(*) as cnt FROM sales_invoices');
      expect(invCount.cnt).toBe(0);

      // Must not use legacyId as invoice_no
      const legacyFallback = await db.get("SELECT * FROM sales_invoices WHERE invoice_no = 'ORD_NO_INV_01'");
      expect(legacyFallback).toBeUndefined();

      // Audit entry must exist
      const summary = await getMigrationAuditSummary(db);
      expect(summary.skippedRecords).toBeGreaterThanOrEqual(1);
      const records = await getMigrationAuditRecords(db);
      const invoiceSkip = records.rows.find((r: any) => r.entity_type === 'invoice' && r.status === 'skipped');
      expect(invoiceSkip).toBeDefined();
      expect(invoiceSkip.reason).toContain('ORD_NO_INV_01');
      expect(invoiceSkip.reason).toContain('no invoice number');
    });

    it('pgSalesImporter: skips order with empty-string invoice and creates audit entry', async () => {
      await importOrder({
        order_id: 'ORD_EMPTY_INV_01',
        patient_id: null,
        invoice: '', // Empty string
        amount: '200',
        created_time: '2025-07-02 08:00:00',
        order_status: 'BILL',
      }, db);
      await flushSalesInvoices(db);

      const invCount = await db.get('SELECT COUNT(*) as cnt FROM sales_invoices');
      expect(invCount.cnt).toBe(0);

      const summary = await getMigrationAuditSummary(db);
      expect(summary.skippedRecords).toBeGreaterThanOrEqual(1);

      // Confirm the record_identifier uses legacy_id, not a synthesized invoice number
      const records = await getMigrationAuditRecords(db);
      const invoiceSkip = records.rows.find((r: any) => r.entity_type === 'invoice');
      expect(invoiceSkip).toBeDefined();
      expect(invoiceSkip.record_identifier).toBe('ORD_EMPTY_INV_01');
    });

    it('pgPurchaseImporter: skips purchase with null invoice fields and creates audit entry', async () => {
      await importInventory({
        inventory_id: 'INV_NO_NUM_01',
        distributor_id: null,
        invoice: null,    // No invoice
        invoice_id: null, // No invoice_id
        created_time: '2025-06-20 11:00:00',
        amount: '3000',
        status: 'PUBLISHED',
      }, db);
      await flushPurchases(db);

      const purCount = await db.get('SELECT COUNT(*) as cnt FROM purchases');
      expect(purCount.cnt).toBe(0);

      // Must not use legacyId as invoice_no
      const legacyFallback = await db.get("SELECT * FROM purchases WHERE invoice_no = 'INV_NO_NUM_01'");
      expect(legacyFallback).toBeUndefined();

      await flushMigrationAudits(db);
      const summary = await getMigrationAuditSummary(db);
      expect(summary.skippedRecords).toBeGreaterThanOrEqual(1);
      const records = await getMigrationAuditRecords(db);
      const invoiceSkip = records.rows.find((r: any) => r.entity_type === 'invoice' && r.status === 'skipped');
      expect(invoiceSkip).toBeDefined();
      expect(invoiceSkip.reason).toContain('INV_NO_NUM_01');
    });

    it('salesParser (SQL): skips and audits empty invoice_no in legacy SQL INSERT', async () => {
      const sqlLine = `INSERT INTO legacy_sales VALUES ('', '0', '2025-08-01', '300.00', '27.00')`;
      const result = await processSalesLine(sqlLine, db);
      expect(result).toBe(false);

      const invCount = await db.get('SELECT COUNT(*) as cnt FROM sales_invoices');
      expect(invCount.cnt).toBe(0);

      // No fabricated LEGACY- or timestamp invoice must exist
      const fabricated = await db.get("SELECT * FROM sales_invoices WHERE invoice_no LIKE 'LEGACY-%'");
      expect(fabricated).toBeUndefined();

      await flushMigrationAudits(db);
      const summary = await getMigrationAuditSummary(db);
      expect(summary.skippedRecords).toBeGreaterThanOrEqual(1);
    });

    it('salesParser (SQL): skips and audits NULL invoice_no in legacy SQL INSERT', async () => {
      const sqlLine = `INSERT INTO legacy_sales VALUES (NULL, '0', '2025-08-02', '150.00', '13.50')`;
      const result = await processSalesLine(sqlLine, db);
      expect(result).toBe(false);

      const invCount = await db.get('SELECT COUNT(*) as cnt FROM sales_invoices');
      expect(invCount.cnt).toBe(0);
    });
  });

  // ─── 3. Duplicate invoice number ─────────────────────────

  describe('3. Duplicate invoice number does not produce fabricated IDs', () => {
    it('pgSalesImporter: duplicate invoice handled without fabricating a synthetic invoice number', async () => {
      const custRes = await db.run('INSERT INTO customers (name) VALUES (?)', ['Sonal Mehta']);
      patientMap.set('PAT_DUP', custRes.lastID!);

      // First import
      await importOrder({
        order_id: 'ORD_DUP_01',
        patient_id: 'PAT_DUP',
        invoice: 'DUP-BILL-2025-001',
        amount: '900',
        created_time: '2025-06-01 10:00:00',
        order_status: 'BILL',
      }, db);
      await flushSalesInvoices(db);

      // Second import — same invoice number, different order_id
      await importOrder({
        order_id: 'ORD_DUP_02',
        patient_id: 'PAT_DUP',
        invoice: 'DUP-BILL-2025-001',
        amount: '900',
        created_time: '2025-06-01 10:00:00',
        order_status: 'BILL',
      }, db);
      await flushSalesInvoices(db);

      const invoices = await db.all("SELECT invoice_no FROM sales_invoices WHERE invoice_no LIKE 'DUP-BILL-%'");
      // Any invoice_no produced must be traceable to the original — never a fabricated LEGACY- or timestamp
      for (const inv of invoices) {
        expect(inv.invoice_no).not.toMatch(/^LEGACY-\d+/);
        expect(inv.invoice_no).not.toMatch(/^\d{13}/);
        expect(inv.invoice_no).toContain('DUP-BILL-2025-001');
      }
    });
  });
});
