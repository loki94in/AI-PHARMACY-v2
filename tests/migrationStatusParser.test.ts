import { parseCopyHeader } from '../src/worker/parsers/pgCopyParser.js';
import { importOrder, clearSalesMap, salesInvoiceMap } from '../src/worker/importers/pgSalesImporter.js';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_STATUS_DB_PATH = path.join(__dirname, '..', 'data', 'test_status_staging.db');

describe('Migration Order Status & Copy Header Parsing Tests', () => {
  let db: any;

  beforeAll(async () => {
    if (fs.existsSync(TEST_STATUS_DB_PATH)) {
      try { fs.unlinkSync(TEST_STATUS_DB_PATH); } catch (_) {}
    }
    db = await open({ filename: TEST_STATUS_DB_PATH, driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sales_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT,
        customer_id INTEGER,
        date TEXT,
        total_amount REAL,
        tax_amount REAL,
        doctor_id INTEGER,
        payment_medium TEXT,
        roff REAL,
        cgst_value REAL,
        sgst_value REAL,
        igst_value REAL,
        legacy_id TEXT,
        business_date TEXT,
        discount REAL,
        subtotal REAL
      );
    `);
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(TEST_STATUS_DB_PATH)) {
      try { fs.unlinkSync(TEST_STATUS_DB_PATH); } catch (_) {}
    }
  });

  beforeEach(() => {
    clearSalesMap();
  });

  it('should parse COPY header lines with different schemas, quotes, and spacing', () => {
    const header1 = parseCopyHeader('COPY public.orders (order_id, created_time, amount) FROM stdin;');
    expect(header1).toEqual({ table: 'orders', columns: ['order_id', 'created_time', 'amount'] });

    const header2 = parseCopyHeader('COPY "public"."orders" ("order_id", "created_time") FROM stdin;');
    expect(header2).toEqual({ table: 'orders', columns: ['order_id', 'created_time'] });

    const header3 = parseCopyHeader('COPY orders (order_id, amount) FROM stdin;');
    expect(header3).toEqual({ table: 'orders', columns: ['order_id', 'amount'] });

    const header4 = parseCopyHeader('COPY "orders" ("order_id", "amount") FROM stdin;');
    expect(header4).toEqual({ table: 'orders', columns: ['order_id', 'amount'] });
  });

  it('should import orders with lowercase and alternative completed order statuses', async () => {
    const testRows = [
      { order_id: 'ORD-101', order_status: 'billed', invoice: 'INV-101', amount: '150.00' },
      { order_id: 'ORD-102', order_status: 'BILLED', invoice: 'INV-102', amount: '200.00' },
      { order_id: 'ORD-103', order_status: 'closed', invoice: 'INV-103', amount: '350.00' },
      { order_id: 'ORD-104', order_status: 'PAID', invoice: 'INV-104', amount: '450.00' },
      { order_id: 'ORD-105', order_status: 'completed', invoice: 'INV-105', amount: '500.00' },
      { order_id: 'ORD-106', order_status: 'DELIVERED', invoice: 'INV-106', amount: '600.00' },
      { order_id: 'ORD-107', order_status: 'BILL', invoice: 'INV-107', amount: '700.00' },
    ];

    for (const row of testRows) {
      await importOrder(row, db);
    }

    // Flush batch to database
    const { flushSalesInvoices } = await import('../src/worker/importers/pgSalesImporter.js');
    await flushSalesInvoices(db);

    const countRow = await db.get('SELECT COUNT(*) as count FROM sales_invoices');
    expect(countRow.count).toBe(7);

    for (const row of testRows) {
      expect(salesInvoiceMap.has(row.order_id)).toBe(true);
    }
  });

  it('should skip cancelled or deleted orders', async () => {
    const cancelledRow = { order_id: 'ORD-999', order_status: 'CANCELLED', invoice: 'INV-999', amount: '100.00' };
    const deletedRow = { order_id: 'ORD-888', order_status: 'COMPLETED', deleted: 't', invoice: 'INV-888', amount: '100.00' };

    await importOrder(cancelledRow, db);
    await importOrder(deletedRow, db);

    const { flushSalesInvoices } = await import('../src/worker/importers/pgSalesImporter.js');
    await flushSalesInvoices(db);

    expect(salesInvoiceMap.has('ORD-999')).toBe(false);
    expect(salesInvoiceMap.has('ORD-888')).toBe(false);
  });
});
