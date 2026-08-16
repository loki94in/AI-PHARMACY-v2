import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processSalesLine } from '../src/worker/parsers/salesParser.js';
import {
  ensureMigrationAuditTable,
  recordMigrationAudit,
  queueMigrationAudit,
  flushMigrationAudits,
  getMigrationAuditSummary,
  getMigrationAuditRecords,
  clearMigrationAudit,
} from '../src/utils/migrationAudit.js';
import { isValidCustomerName, isValidDoctorName } from '../src/utils/nameNormalizer.js';
import { sanitizeDoctorName } from '../src/utils/doctorUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '..', 'data', 'test_migration_relationship_audit.db');

describe('TASK 7: Phantom Customer/Doctor Fallback Removal & Migration Audit Tests', () => {
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
        notes TEXT
      );

      CREATE TABLE doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        specialization TEXT
      );

      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );

      CREATE TABLE inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER,
        batch_no TEXT,
        quantity INTEGER DEFAULT 0,
        rack_location TEXT
      );

      CREATE TABLE sales_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE,
        customer_id INTEGER,
        doctor_id INTEGER,
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

      CREATE TABLE patient_refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        patient_name TEXT NOT NULL,
        patient_phone TEXT NOT NULL,
        medicine_id INTEGER,
        refill_interval_days INTEGER DEFAULT 30,
        last_refill_date TEXT,
        next_refill_date TEXT,
        status TEXT DEFAULT 'pending',
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE b2b_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT,
        customer_id INTEGER,
        date TEXT,
        total_amount REAL DEFAULT 0
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
    await db.run('DELETE FROM sales_invoices');
    await db.run('DELETE FROM customers');
    await db.run('DELETE FROM doctors');
    await db.run('DELETE FROM patient_refills');
    await db.run('DELETE FROM b2b_invoices');
  });

  describe('1. Phantom Customer & Doctor ID Fallback Prevention', () => {
    it('migrates valid customer and doctor with legitimate resolved IDs', async () => {
      // Seed real customer & doctor
      const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Rajesh Kumar', '9876543210']);
      const docRes = await db.run('INSERT INTO doctors (name) VALUES (?)', ['Dr. Anand Verma']);

      const realCustomerId = custRes.lastID;
      const realDoctorId = docRes.lastID;

      // Simulate sales line with existing valid customer ID
      const validSaleLine = `INSERT INTO legacy_sales VALUES ('INV-VALID-01', '${realCustomerId}', '2026-08-01', '1250.00', '150.00')`;
      const processed = await processSalesLine(validSaleLine, db);
      expect(processed).toBe(true);

      const invoice = await db.get('SELECT * FROM sales_invoices WHERE invoice_no = ?', ['INV-VALID-01']);
      expect(invoice).toBeDefined();
      expect(invoice.customer_id).toBe(realCustomerId);
      expect(invoice.customer_id).not.toBeNull();
      expect(invoice.customer_id).not.toBe(0);
    });

    it('preserves customer_id as NULL when legacy customer ID does not exist in customers table (NEVER defaults to 1 or arbitrary ID)', async () => {
      // Ensure customers table has a pre-existing record with a different ID
      const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Pre-existing Customer 1', '9000000001']);
      expect(custRes.lastID).toBeDefined();
      expect(custRes.lastID).not.toBe(999);

      // Now attempt to import a sales row with legacy customer_id = 999 (which does NOT exist in master)
      const missingCustLine = `INSERT INTO legacy_sales VALUES ('INV-UNRESOLVED-999', '999', '2026-08-01', '750.00', '90.00')`;
      const processed = await processSalesLine(missingCustLine, db);
      expect(processed).toBe(true);

      // Flush audits
      await flushMigrationAudits(db);

      const invoice = await db.get('SELECT * FROM sales_invoices WHERE invoice_no = ?', ['INV-UNRESOLVED-999']);
      expect(invoice).toBeDefined();
      // CRITICAL: Must be NULL and NOT silently assigned to customer ID 1
      expect(invoice.customer_id).toBeNull();
      expect(invoice.customer_id).not.toBe(1);

      // Verify audit entry was logged for unresolved customer
      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedCustomers).toBe(1);
      expect(summary.preservedNullRecords).toBe(1);

      const records = await getMigrationAuditRecords(db);
      expect(records.rows.length).toBe(1);
      expect(records.rows[0].entity_type).toBe('customer');
      expect(records.rows[0].status).toBe('preserved_null');
      expect(records.rows[0].raw_value).toBe('999');
      expect(records.rows[0].reason).toContain('999');
    });

    it('preserves doctor_id as NULL when doctor is missing or unmapped in CSV migration', async () => {
      const patientName = 'Priya Sharma';
      const doctorName = 'Self'; // Invalid doctor name / placeholder

      let customerId: number | null = null;
      if (isValidCustomerName(patientName)) {
        const result = await db.run('INSERT INTO customers (name) VALUES (?)', [patientName]);
        customerId = result.lastID ?? null;
      }

      let doctorId: number | null = null;
      if (isValidDoctorName(doctorName)) {
        const cleanDoc = sanitizeDoctorName(doctorName) || doctorName;
        const result = await db.run('INSERT INTO doctors (name) VALUES (?)', [cleanDoc]);
        doctorId = result.lastID ?? null;
      } else if (doctorName) {
        doctorId = null;
        queueMigrationAudit({
          file_name: 'sales_2026.csv',
          record_type: 'sales_invoice',
          record_identifier: 'INV-CSV-1001',
          entity_type: 'doctor',
          raw_value: doctorName,
          status: 'preserved_null',
          reason: `Unresolved or invalid doctor name "${doctorName}"; doctor_id preserved as NULL`,
        });
      }

      await db.run(
        'INSERT INTO sales_invoices (invoice_no, customer_id, doctor_id, date, total_amount, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
        ['INV-CSV-1001', customerId, doctorId, '2026-08-01', 300, 300]
      );
      await flushMigrationAudits(db);

      const invoice = await db.get('SELECT * FROM sales_invoices WHERE invoice_no = ?', ['INV-CSV-1001']);
      expect(invoice.customer_id).toBe(customerId);
      expect(invoice.doctor_id).toBeNull();
      expect(invoice.doctor_id).not.toBe(1);

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedDoctors).toBe(1);
      expect(summary.preservedNullRecords).toBe(1);
    });

    it('skips mandatory relationship records safely when customer is unresolved (patient_refills)', async () => {
      // Simulate scheduled order import where patient_id cannot be resolved
      const unresolvableRefill = {
        legacy_id: 'SCHED-888',
        patient_id: 'LEGACY-PATIENT-UNKNOWN',
        interval_days: 30,
        start_date: '2026-08-01',
        end_date: '2026-09-01',
      };

      const customerMap = new Map<string, number>(); // empty map -> unresolved

      const customerId = unresolvableRefill.patient_id ? customerMap.get(unresolvableRefill.patient_id) : null;
      if (!customerId) {
        queueMigrationAudit({
          record_type: 'patient_refill',
          record_identifier: unresolvableRefill.legacy_id,
          entity_type: 'customer',
          raw_value: unresolvableRefill.patient_id,
          status: 'skipped',
          reason: `Mandatory customer relationship unresolved for scheduled order ${unresolvableRefill.legacy_id}; record skipped`,
        });
      }

      await flushMigrationAudits(db);

      // Verify no orphan/phantom refill was inserted
      const refillCount = await db.get('SELECT COUNT(*) as cnt FROM patient_refills');
      expect(refillCount.cnt).toBe(0);

      // Verify audit logged as skipped with clear reason
      const summary = await getMigrationAuditSummary(db);
      expect(summary.skippedRecords).toBe(1);
      expect(summary.unresolvedCustomers).toBe(1);

      const records = await getMigrationAuditRecords(db);
      expect(records.rows[0].status).toBe('skipped');
      expect(records.rows[0].record_type).toBe('patient_refill');
      expect(records.rows[0].reason).toContain('Mandatory customer relationship unresolved');
    });
  });

  describe('2. Migration Audit Reporting Aggregations & Retrieval', () => {
    it('accurately reports counts of unresolved customer and doctor relationships', async () => {
      await recordMigrationAudit(db, {
        file_name: 'sales_dump.sql',
        record_type: 'sales_invoice',
        record_identifier: 'INV-A1',
        entity_type: 'customer',
        raw_value: 'LEGACY-CUST-99',
        status: 'preserved_null',
        reason: 'Customer not found in master; customer_id preserved as NULL',
      });

      await recordMigrationAudit(db, {
        file_name: 'sales_dump.sql',
        record_type: 'sales_invoice',
        record_identifier: 'INV-A2',
        entity_type: 'customer',
        raw_value: 'LEGACY-CUST-100',
        status: 'preserved_null',
        reason: 'Customer not found in master; customer_id preserved as NULL',
      });

      await recordMigrationAudit(db, {
        file_name: 'sales_dump.sql',
        record_type: 'sales_invoice',
        record_identifier: 'INV-A3',
        entity_type: 'doctor',
        raw_value: 'LEGACY-DOC-55',
        status: 'preserved_null',
        reason: 'Doctor not found in master; doctor_id preserved as NULL',
      });

      await recordMigrationAudit(db, {
        file_name: 'scheduled_orders.sql',
        record_type: 'patient_refill',
        record_identifier: 'SCHED-01',
        entity_type: 'customer',
        raw_value: 'PAT-404',
        status: 'skipped',
        reason: 'Mandatory customer relationship missing; refill skipped',
      });

      const summary = await getMigrationAuditSummary(db);
      expect(summary.unresolvedCustomers).toBe(3); // 2 preserved_null + 1 skipped
      expect(summary.unresolvedDoctors).toBe(1);
      expect(summary.preservedNullRecords).toBe(3);
      expect(summary.skippedRecords).toBe(1);
      expect(summary.totalAuditEntries).toBe(4);

      const page = await getMigrationAuditRecords(db, 2, 0);
      expect(page.rows.length).toBe(2);
      expect(page.total).toBe(4);
    });
  });

  describe('3. TASK 9 — Invoice Number Integrity (No Fabricated IDs)', () => {
    it('preserves valid invoice_no as-is and inserts the record', async () => {
      const validLine = `INSERT INTO legacy_sales VALUES ('BILL-2026-001', '0', '2026-08-01', '500.00', '45.00')`;
      const result = await processSalesLine(validLine, db);
      expect(result).toBe(true);

      const invoice = await db.get('SELECT * FROM sales_invoices WHERE invoice_no = ?', ['BILL-2026-001']);
      expect(invoice).toBeDefined();
      expect(invoice.invoice_no).toBe('BILL-2026-001');
      // Must never have been substituted with a timestamp-based value
      expect(invoice.invoice_no).not.toMatch(/LEGACY-\d+/);
      expect(invoice.invoice_no).not.toMatch(/INV-\d{13}/);
    });

    it('skips and audits a legacy_sales INSERT that has no invoice_no (empty first value)', async () => {
      await clearMigrationAudit(db);

      // Empty string in position 0 = no bill_no
      const missingNoLine = `INSERT INTO legacy_sales VALUES ('', '0', '2026-08-01', '300.00', '27.00')`;
      const result = await processSalesLine(missingNoLine, db);

      // Must be skipped — not inserted
      expect(result).toBe(false);

      // Must not have inserted a row with a fabricated invoice number
      const countRow = await db.get(`SELECT COUNT(*) as cnt FROM sales_invoices WHERE invoice_no LIKE 'LEGACY-%'`);
      expect(countRow.cnt).toBe(0);

      const timestampRow = await db.get(`SELECT COUNT(*) as cnt FROM sales_invoices WHERE invoice_no LIKE 'INV-%'`);
      expect(timestampRow.cnt).toBe(0);

      // Audit entry must exist and be categorised as an invoice skip
      await flushMigrationAudits(db);
      const summary = await getMigrationAuditSummary(db);
      expect(summary.skippedRecords).toBeGreaterThanOrEqual(1);

      const records = await getMigrationAuditRecords(db);
      const invoiceSkip = records.rows.find((r: any) => r.entity_type === 'invoice' && r.status === 'skipped');
      expect(invoiceSkip).toBeDefined();
      expect(invoiceSkip.reason).toContain('invoice_id / bill_no');
    });

    it('skips and audits a legacy_sales INSERT whose bill_no is NULL', async () => {
      await clearMigrationAudit(db);

      // NULL in position 0
      const nullNoLine = `INSERT INTO legacy_sales VALUES (NULL, '0', '2026-08-02', '150.00', '13.50')`;
      const result = await processSalesLine(nullNoLine, db);

      expect(result).toBe(false);

      // No LEGACY- or timestamp row must exist
      const legacyCount = await db.get(`SELECT COUNT(*) as cnt FROM sales_invoices WHERE invoice_no LIKE 'LEGACY-%'`);
      expect(legacyCount.cnt).toBe(0);

      await flushMigrationAudits(db);
      const summary = await getMigrationAuditSummary(db);
      expect(summary.skippedRecords).toBeGreaterThanOrEqual(1);
    });
  });
});

