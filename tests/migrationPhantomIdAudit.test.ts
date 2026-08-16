import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  clearMigrationAudit,
  recordAuditEntry,
  getMigrationAuditSummary,
  saveMigrationAuditSummary,
  ensureMigrationAuditTable,
} from '../src/utils/migrationAudit.js';
import {
  clearAllMaps,
  patientMap,
  doctorMap,
  customerMap,
} from '../src/worker/importers/pgMasterImporter.js';
import {
  importOrder,
  flushSalesInvoices,
  clearSalesMap,
} from '../src/worker/importers/pgSalesImporter.js';
import {
  importB2BSale,
  flushB2BInvoices,
  clearB2BMap,
} from '../src/worker/importers/pgB2BImporter.js';
import {
  importScheduledOrder,
  flushRefills,
  clearExtrasMap,
} from '../src/worker/importers/pgExtrasImporter.js';
import { processSalesLine } from '../src/worker/parsers/salesParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '..', 'data', 'test_migration_phantom_id_audit.db');

describe('TASK 7: Remove Phantom Customer/Doctor ID Fallbacks & Migration Audit', () => {
  let db: any;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = await open({ filename: TEST_DB, driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        notes TEXT,
        legacy_id TEXT
      );

      CREATE TABLE doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        degree TEXT,
        reg_no TEXT,
        hospital TEXT,
        phone TEXT,
        address TEXT,
        legacy_id TEXT,
        speciality TEXT
      );

      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );

      CREATE TABLE inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER,
        batch_no TEXT,
        quantity INTEGER DEFAULT 0
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

      CREATE TABLE b2b_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE,
        customer_id INTEGER,
        date TEXT,
        total_amount REAL DEFAULT 0,
        cgst_value REAL DEFAULT 0,
        sgst_value REAL DEFAULT 0,
        igst_value REAL DEFAULT 0,
        roff REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        payment_medium TEXT,
        legacy_id TEXT,
        business_date TEXT
      );

      CREATE TABLE patient_refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        patient_name TEXT NOT NULL,
        patient_phone TEXT NOT NULL,
        medicine_id INTEGER DEFAULT 0,
        refill_interval_days INTEGER DEFAULT 30,
        last_refill_date TEXT,
        next_refill_date TEXT,
        status TEXT DEFAULT 'pending',
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE migration_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT,
        row_index INTEGER,
        raw_data TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    clearB2BMap();
    clearExtrasMap();
    await clearMigrationAudit(db);
  });

  describe('1. Audit Tracking Core Functions', () => {
    it('records and summarizes unresolved relationships accurately', async () => {
      await recordAuditEntry({
        table: 'sales_invoices',
        recordIdentifier: 'INV-1001',
        entityType: 'customer',
        action: 'preserved_null',
        reason: 'Legacy patient_id "PAT-99" was not found in patient master — relationship preserved as NULL',
        rawId: 'PAT-99',
      }, db);

      await recordAuditEntry({
        table: 'sales_invoices',
        recordIdentifier: 'INV-1001',
        entityType: 'doctor',
        action: 'preserved_null',
        reason: 'Legacy doctor_id "DOC-88" was not found in doctor master — relationship preserved as NULL',
        rawId: 'DOC-88',
      }, db);

      await recordAuditEntry({
        table: 'patient_refills',
        recordIdentifier: 'scheduled_order_501',
        entityType: 'customer',
        action: 'skipped',
        reason: 'Mandatory customer relationship unresolved for scheduled order "501" — record skipped',
        rawId: 'PAT-99',
      }, db);

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedCustomers).toBe(2);
      expect(summary.unresolvedDoctors).toBe(1);
      expect(summary.preservedNullRecords).toBe(2);
      expect(summary.skippedRecords).toBe(1);
      expect(summary.records.length).toBe(3);
      expect(summary.records[0].action).toBe('preserved_null');
      expect(summary.records[2].action).toBe('skipped');
    });
  });

  describe('2. Retail Sales Importer (pgSalesImporter)', () => {
    it('correctly maps valid customer and doctor IDs', async () => {
      // Seed real customer and doctor in DB and in maps
      const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Aarav Mehta', '9876543210']);
      patientMap.set('PAT_01', custRes.lastID!);

      const docRes = await db.run('INSERT INTO doctors (name) VALUES (?)', ['Dr. Rajiv Sen']);
      doctorMap.set('DOC_01', docRes.lastID!);

      await importOrder({
        order_id: 'ORD_101',
        patient_id: 'PAT_01',
        doctor_id: 'DOC_01',
        invoice: 'INV-VALID-01',
        amount: '1200',
        created_time: '2026-08-01 10:00:00',
      }, db);
      await flushSalesInvoices(db);

      const inv = await db.get('SELECT * FROM sales_invoices WHERE invoice_no = ?', ['INV-VALID-01']);
      expect(inv).toBeDefined();
      expect(inv.customer_id).toBe(custRes.lastID);
      expect(inv.doctor_id).toBe(docRes.lastID);

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedCustomers).toBe(0);
      expect(summary.unresolvedDoctors).toBe(0);
    });

    it('preserves customer_id and doctor_id as NULL when legacy IDs are missing/unresolved (NEVER assigns ID 1)', async () => {
      // Intentionally do NOT register PAT_UNKNOWN or DOC_UNKNOWN in maps
      await importOrder({
        order_id: 'ORD_102',
        patient_id: 'PAT_UNKNOWN',
        doctor_id: 'DOC_UNKNOWN',
        invoice: 'INV-UNRESOLVED-01',
        amount: '850',
        created_time: '2026-08-02 11:00:00',
      }, db);
      await flushSalesInvoices(db);

      const inv = await db.get('SELECT * FROM sales_invoices WHERE invoice_no = ?', ['INV-UNRESOLVED-01']);
      expect(inv).toBeDefined();
      // MUST be NULL, never 1 or any fallback ID
      expect(inv.customer_id).toBeNull();
      expect(inv.doctor_id).toBeNull();
      expect(inv.customer_id).not.toBe(1);
      expect(inv.doctor_id).not.toBe(1);

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedCustomers).toBe(1);
      expect(summary.unresolvedDoctors).toBe(1);
      expect(summary.preservedNullRecords).toBe(2);
      expect(summary.records.some(r => r.entityType === 'customer' && r.rawId === 'PAT_UNKNOWN')).toBe(true);
      expect(summary.records.some(r => r.entityType === 'doctor' && r.rawId === 'DOC_UNKNOWN')).toBe(true);
    });
  });

  describe('3. B2B Sales Importer (pgB2BImporter)', () => {
    it('preserves customer_id as NULL when B2B customer ID is unresolved (NEVER assigns ID 1)', async () => {
      await importB2BSale({
        b2b_sales_id: 'B2B_101',
        customer_id: 'CUST_NON_EXISTENT',
        invoice: 'B2B-INV-01',
        amount: '5000',
        invoice_date: '2026-08-03',
      }, db);
      await flushB2BInvoices(db);

      const b2bInv = await db.get('SELECT * FROM b2b_invoices WHERE invoice_no = ?', ['B2B-INV-01']);
      expect(b2bInv).toBeDefined();
      expect(b2bInv.customer_id).toBeNull();
      expect(b2bInv.customer_id).not.toBe(1);

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedCustomers).toBe(1);
      expect(summary.preservedNullRecords).toBe(1);
    });
  });

  describe('4. Scheduled Orders / Refills Importer (pgExtrasImporter)', () => {
    it('skips scheduled order when mandatory customer is unresolved and reports it in audit & errors', async () => {
      await importScheduledOrder({
        scheduled_order_id: 'SCHED_999',
        patient_id: 'PAT_ORPHAN',
        schedule_interval: '30',
        start_date: '2026-08-01',
      }, db);
      await flushRefills(db);

      const refill = await db.get('SELECT * FROM patient_refills WHERE patient_name = ?', ['PAT_ORPHAN']);
      expect(refill).toBeUndefined();

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedCustomers).toBe(1);
      expect(summary.skippedRecords).toBe(1);
      expect(summary.records[0].action).toBe('skipped');
      expect(summary.records[0].reason).toContain('Mandatory customer relationship unresolved');

      const err = await db.get("SELECT * FROM migration_errors WHERE file_name = 'scheduled_orders'");
      expect(err).toBeDefined();
      expect(err.error_message).toContain('Skipped scheduled order SCHED_999');
    });
  });

  describe('5. Legacy SQL Sales Parser (salesParser)', () => {
    it('preserves customer_id as NULL when legacy SQL customer ID is not found in database (never assigns phantom ID)', async () => {
      const sqlLine = `INSERT INTO legacy_sales VALUES ('LEGACY-INV-777', '99999', '2026-08-04', '450.00', '22.50');`;
      const handled = await processSalesLine(sqlLine, db);
      expect(handled).toBe(true);

      const inv = await db.get('SELECT * FROM sales_invoices WHERE invoice_no = ?', ['LEGACY-INV-777']);
      expect(inv).toBeDefined();
      expect(inv.customer_id).toBeNull();
      expect(inv.customer_id).not.toBe(99999);
      expect(inv.customer_id).not.toBe(1);

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedCustomers).toBe(1);
      expect(summary.preservedNullRecords).toBe(1);
      expect(summary.records[0].reason).toContain('not found in customer master');
    });
  });

  describe('6. Save and Persistence of Migration Audit Summary', () => {
    it('persists audit summary to app_settings and allows retrieval after DB reconnect', async () => {
      await recordAuditEntry({
        table: 'sales_invoices',
        recordIdentifier: 'INV-PERSIST-1',
        entityType: 'customer',
        action: 'preserved_null',
        reason: 'Unresolved customer preserved as NULL',
        rawId: 'CUST-001',
      }, db);

      await saveMigrationAuditSummary(db);

      const settingRow = await db.get("SELECT value FROM app_settings WHERE key = 'migration_audit_summary'");
      expect(settingRow).toBeDefined();
      const parsed = JSON.parse(settingRow.value);
      expect(parsed.unresolvedCustomers).toBeGreaterThan(0);
      expect(parsed.records.length).toBeGreaterThan(0);
    });
  });
});
