import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isValidCustomerName, isValidDoctorName, isValidDistributorName } from '../src/utils/nameNormalizer.js';
import { findOrCreateDistributor, resetDistributorLookupCache } from '../src/utils/migrationDistributorHelpers.js';
import { sanitizeDoctorName } from '../src/utils/doctorUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '..', 'data', 'test_migration_placeholder_integrity.db');

describe('TASK 6: Remove Fabricated Migration Entities Integrity Tests', () => {
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

      CREATE TABLE distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        gstin TEXT
      );

      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );

      CREATE TABLE inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER,
        batch_no TEXT,
        expiry_date TEXT,
        quantity INTEGER DEFAULT 0,
        loose_quantity INTEGER DEFAULT 0,
        mrp REAL DEFAULT 0,
        cost_price REAL DEFAULT 0,
        rack_location TEXT
      );

      CREATE TABLE sales_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT,
        customer_id INTEGER,
        doctor_id INTEGER,
        date TEXT,
        total_amount REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        subtotal REAL DEFAULT 0,
        cgst_value REAL DEFAULT 0,
        sgst_value REAL DEFAULT 0
      );

      CREATE TABLE purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT,
        distributor_id INTEGER,
        date TEXT,
        total_amount REAL DEFAULT 0
      );

      CREATE TABLE returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_no TEXT,
        distributor_id INTEGER,
        type TEXT,
        date TEXT,
        total_amount REAL DEFAULT 0,
        return_invoice_id TEXT,
        return_sub_type TEXT,
        raw_return_type TEXT,
        return_date_time TEXT
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
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  beforeEach(() => {
    resetDistributorLookupCache();
  });

  describe('1. Entity Name Validation Rules', () => {
    it('rejects customer placeholder names and accepts legitimate customer names', () => {
      expect(isValidCustomerName('Walk-in Customer')).toBe(false);
      expect(isValidCustomerName('walk in customer')).toBe(false);
      expect(isValidCustomerName('Walk-in')).toBe(false);
      expect(isValidCustomerName('Unnamed Customer')).toBe(false);
      expect(isValidCustomerName('Customer')).toBe(false);
      expect(isValidCustomerName('Self')).toBe(false);
      expect(isValidCustomerName('N/A')).toBe(false);
      expect(isValidCustomerName('')).toBe(false);
      expect(isValidCustomerName('   ')).toBe(false);
      expect(isValidCustomerName(null)).toBe(false);
      expect(isValidCustomerName(undefined)).toBe(false);

      expect(isValidCustomerName('John Doe')).toBe(true);
      expect(isValidCustomerName('Aarav Sharma')).toBe(true);
    });

    it('rejects doctor placeholder names and accepts legitimate doctor names', () => {
      expect(isValidDoctorName('Self')).toBe(false);
      expect(isValidDoctorName('Doctor')).toBe(false);
      expect(isValidDoctorName('Dr.')).toBe(false);
      expect(isValidDoctorName('Unknown Doctor')).toBe(false);
      expect(isValidDoctorName('General Doctor')).toBe(false);
      expect(isValidDoctorName('Default')).toBe(false);
      expect(isValidDoctorName('N/A')).toBe(false);
      expect(isValidDoctorName('')).toBe(false);
      expect(isValidDoctorName(null)).toBe(false);

      expect(isValidDoctorName('Dr. B. K. Roy')).toBe(true);
      expect(isValidDoctorName('Dr. Sharma')).toBe(true);
    });

    it('rejects distributor placeholder names and accepts legitimate distributor names', () => {
      expect(isValidDistributorName('Unknown Supplier')).toBe(false);
      expect(isValidDistributorName('Unknown Distributor')).toBe(false);
      expect(isValidDistributorName('Default Distributor')).toBe(false);
      expect(isValidDistributorName('Unassigned')).toBe(false);
      expect(isValidDistributorName('Email Import')).toBe(false);
      expect(isValidDistributorName('')).toBe(false);
      expect(isValidDistributorName(null)).toBe(false);

      expect(isValidDistributorName('Sun Pharma Ltd')).toBe(true);
      expect(isValidDistributorName('Cipla Distributors')).toBe(true);
    });
  });

  describe('2. Distributor Helper Logic', () => {
    it('returns null and creates no row for missing or placeholder distributor', async () => {
      const res1 = await findOrCreateDistributor(db, 'Unknown Supplier');
      expect(res1).toBeNull();

      const res2 = await findOrCreateDistributor(db, '');
      expect(res2).toBeNull();

      const count = await db.get("SELECT COUNT(*) as cnt FROM distributors WHERE LOWER(name) = 'unknown supplier'");
      expect(count.cnt).toBe(0);
    });

    it('creates legitimate distributor record when valid name provided', async () => {
      const dist = await findOrCreateDistributor(db, 'Apollo Wholesale Agency');
      expect(dist).not.toBeNull();
      expect(dist!.id).toBeGreaterThan(0);

      const row = await db.get('SELECT name FROM distributors WHERE id = ?', [dist!.id]);
      expect(row.name).toBe('Apollo Wholesale Agency');
    });
  });

  describe('3. Migration Behavior Scenarios', () => {
    it('Scenario 1: Complete record migrates with valid customer, doctor, distributor', async () => {
      // 1. Resolve Customer
      const patientName = 'Amit Verma';
      let customerId: number | null = null;
      if (isValidCustomerName(patientName)) {
        const res = await db.run('INSERT INTO customers (name) VALUES (?)', [patientName]);
        customerId = res.lastID;
      }

      // 2. Resolve Doctor
      const doctorName = 'Dr. Rajesh Gupta';
      let doctorId: number | null = null;
      if (isValidDoctorName(doctorName)) {
        const cleanDoc = sanitizeDoctorName(doctorName) || doctorName;
        const res = await db.run('INSERT INTO doctors (name) VALUES (?)', [cleanDoc]);
        doctorId = res.lastID;
      }

      // 3. Insert Sale Invoice
      const saleRes = await db.run(
        'INSERT INTO sales_invoices (invoice_no, customer_id, doctor_id, date, total_amount) VALUES (?, ?, ?, ?, ?)',
        ['INV-1001', customerId, doctorId, '2026-08-01', 500]
      );

      const sale = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [saleRes.lastID]);
      expect(sale.customer_id).toBe(customerId);
      expect(sale.doctor_id).toBe(doctorId);
      expect(sale.customer_id).not.toBeNull();
      expect(sale.doctor_id).not.toBeNull();

      // 4. Resolve Distributor & Purchase
      const dist = await findOrCreateDistributor(db, 'Apex Pharma Agency');
      const purRes = await db.run(
        'INSERT INTO purchases (invoice_no, distributor_id, date, total_amount) VALUES (?, ?, ?, ?)',
        ['PUR-1001', dist?.id ?? null, '2026-08-01', 2000]
      );
      const purchase = await db.get('SELECT * FROM purchases WHERE id = ?', [purRes.lastID]);
      expect(purchase.distributor_id).toBe(dist!.id);
    });

    it('Scenario 2: Missing customer preserves customer_id as NULL and creates 0 Walk-in Customer records', async () => {
      const patientName = ''; // Missing customer
      let customerId: number | null = null;
      if (isValidCustomerName(patientName)) {
        const res = await db.run('INSERT INTO customers (name) VALUES (?)', [patientName]);
        customerId = res.lastID;
      }

      const saleRes = await db.run(
        'INSERT INTO sales_invoices (invoice_no, customer_id, doctor_id, date, total_amount) VALUES (?, ?, ?, ?, ?)',
        ['INV-1002', customerId, null, '2026-08-01', 150]
      );

      const sale = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [saleRes.lastID]);
      expect(sale.customer_id).toBeNull();

      const placeholderCust = await db.get("SELECT * FROM customers WHERE LOWER(name) IN ('walk-in customer', 'walk-in', 'unnamed customer')");
      expect(placeholderCust).toBeUndefined();
    });

    it('Scenario 3: Missing doctor preserves doctor_id as NULL and creates 0 Self records', async () => {
      const doctorName = 'Self'; // Placeholder doctor
      let doctorId: number | null = null;
      if (isValidDoctorName(doctorName)) {
        const cleanDoc = sanitizeDoctorName(doctorName) || doctorName;
        const res = await db.run('INSERT INTO doctors (name) VALUES (?)', [cleanDoc]);
        doctorId = res.lastID;
      }

      const saleRes = await db.run(
        'INSERT INTO sales_invoices (invoice_no, customer_id, doctor_id, date, total_amount) VALUES (?, ?, ?, ?, ?)',
        ['INV-1003', null, doctorId, '2026-08-01', 250]
      );

      const sale = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [saleRes.lastID]);
      expect(sale.doctor_id).toBeNull();

      const placeholderDoc = await db.get("SELECT * FROM doctors WHERE LOWER(name) IN ('self', 'doctor', 'dr.', 'unknown doctor')");
      expect(placeholderDoc).toBeUndefined();
    });

    it('Scenario 4: Missing distributor preserves distributor_id as NULL and creates 0 Unknown Supplier records', async () => {
      const distributorName = 'Unknown Supplier'; // Placeholder distributor
      let distributorId: number | null = null;
      if (isValidDistributorName(distributorName)) {
        const dist = await findOrCreateDistributor(db, distributorName);
        distributorId = dist ? dist.id : null;
      }

      const purRes = await db.run(
        'INSERT INTO purchases (invoice_no, distributor_id, date, total_amount) VALUES (?, ?, ?, ?)',
        ['PUR-1002', distributorId, '2026-08-01', 1200]
      );

      const purchase = await db.get('SELECT * FROM purchases WHERE id = ?', [purRes.lastID]);
      expect(purchase.distributor_id).toBeNull();

      const retRes = await db.run(
        'INSERT INTO returns (return_no, distributor_id, type, date, total_amount) VALUES (?, ?, ?, ?, ?)',
        ['RET-1001', distributorId, 'purchase', '2026-08-01', 300]
      );
      const returnRec = await db.get('SELECT * FROM returns WHERE id = ?', [retRes.lastID]);
      expect(returnRec.distributor_id).toBeNull();

      const placeholderDist = await db.get("SELECT * FROM distributors WHERE LOWER(name) IN ('unknown supplier', 'unknown distributor', 'default')");
      expect(placeholderDist).toBeUndefined();
    });

    it('Scenario 5: Customer master row with missing name is skipped and warning is recorded in migration_errors', async () => {
      const row = { name: '', phone: '9876543210', address: 'Main Road' };

      if (!isValidCustomerName(row.name)) {
        await db.run(
          'INSERT INTO migration_errors (file_name, row_index, raw_data, error_message) VALUES (?, ?, ?, ?)',
          ['customers.csv', 12, JSON.stringify(row), 'Skipped: Missing required customer name']
        );
      } else {
        await db.run('INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)', [row.name, row.phone, row.address]);
      }

      // Verify no unnamed customer was inserted
      const unnamedCust = await db.get("SELECT * FROM customers WHERE phone = '9876543210'");
      expect(unnamedCust).toBeUndefined();

      // Verify error was logged with exact reason
      const err = await db.get("SELECT * FROM migration_errors WHERE file_name = 'customers.csv'");
      expect(err).toBeDefined();
      expect(err.row_index).toBe(12);
      expect(err.error_message).toBe('Skipped: Missing required customer name');
    });

    it('Scenario 6: Confirm zero placeholder entities exist across all master tables', async () => {
      const custPlaceholders = await db.all(`
        SELECT * FROM customers 
        WHERE LOWER(name) IN ('walk-in customer', 'walk in customer', 'walk-in', 'unnamed customer', 'customer', 'self', 'default')
      `);
      expect(custPlaceholders.length).toBe(0);

      const docPlaceholders = await db.all(`
        SELECT * FROM doctors 
        WHERE LOWER(name) IN ('self', 'doctor', 'dr', 'dr.', 'unknown doctor', 'general doctor')
      `);
      expect(docPlaceholders.length).toBe(0);

      const distPlaceholders = await db.all(`
        SELECT * FROM distributors 
        WHERE LOWER(name) IN ('unknown supplier', 'unknown distributor', 'default distributor', 'unassigned')
      `);
      expect(distPlaceholders.length).toBe(0);
    });
  });
});
