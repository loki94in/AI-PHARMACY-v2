import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { processSalesLine } from '../src/worker/parsers/salesParser.js';
import { ensureSchema } from '../src/database.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.resolve(__dirname, '..', 'data', 'test-sales-parser.db');

describe('salesParser', () => {
  let db: any;

  beforeAll(async () => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Open a test SQLite database
    db = await open({
      filename: TEST_DB_PATH,
      driver: sqlite3.Database
    });

    // Ensure the database schema matches the production schema
    await ensureSchema(TEST_DB_PATH);

    // Insert some test medicines for foreign key resolution
    await db.exec(`
        INSERT INTO medicines (id, name) VALUES (101, 'Paracetamol');
        INSERT INTO medicines (id, name) VALUES (202, 'Amoxicillin');
        INSERT INTO medicines (id, name) VALUES (303, 'Cetirizine');
    `);

    // Insert some test inventory for foreign key resolution
    await db.exec(`
        INSERT INTO inventory_master (id, medicine_id, quantity) VALUES (1, 101, 100);
        INSERT INTO inventory_master (id, medicine_id, quantity) VALUES (2, 202, 50);
        INSERT INTO inventory_master (id, medicine_id, quantity) VALUES (3, 303, 75);
    `);
  });

  afterAll(async () => {
    await db.close();
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

    test('should process legacy_sales INSERT statement', async () => {
        const sqlLine = "INSERT INTO legacy_sales VALUES (1001, 1, '2024-01-15', 500.0, 25.0);";
        const result = await processSalesLine(sqlLine, db);
        expect(result).toBe(true);

        // Verify the record was inserted correctly
        const rows = await db.all("SELECT * FROM sales_invoices WHERE invoice_no = '1001'");
        expect(rows.length).toBe(1);
        expect(rows[0].invoice_no).toBe('1001');
        expect(rows[0].customer_id).toBe(1);
        expect(rows[0].total_amount).toBe(500.0);
        expect(rows[0].tax_amount).toBe(25.0);
    }, 15000); // Increased timeout for cache initialization

    test('should process legacy_saleItems INSERT statement', async () => {
        // First insert a legacy sales invoice to reference
        await db.run("INSERT INTO sales_invoices (invoice_no, customer_id, date, total_amount, tax_amount) VALUES (?, ?, ?, ?, ?)",
                    ['INV001', 1, '2024-01-15', 500.0, 25.0]);

        const sqlLine = "INSERT INTO legacy_saleItems VALUES (1, 'INV001', 101, 2, 100.0);";
        const result = await processSalesLine(sqlLine, db);
        expect(result).toBe(true);

        // Verify the record was inserted correctly
        const rows = await db.all(`
            SELECT si.invoice_no, si.total_amount, si.tax_amount,
                   sii.quantity, sii.unit_price, im.medicine_id
            FROM sale_items sii
            JOIN sales_invoices si ON sii.invoice_id = si.id
            JOIN inventory_master im ON sii.inventory_id = im.id
            WHERE si.invoice_no = 'INV001'
        `);
        expect(rows.length).toBe(1);
        expect(rows[0].invoice_no).toBe('INV001');
        expect(rows[0].quantity).toBe(2);
        expect(rows[0].unit_price).toBe(100.0);
        expect(rows[0].medicine_id).toBe(101);
    }, 15000); // Increased timeout for cache initialization

    test('should handle missing inventory medicine_id gracefully by auto-creating medicine and inventory records', async () => {
        // Insert a legacy sales invoice to reference
        await db.run("INSERT INTO sales_invoices (invoice_no, customer_id, date, total_amount, tax_amount) VALUES (?, ?, ?, ?, ?)",
                    ['INV002', 1, '2024-01-16', 300.0, 15.0]);

        // Try to insert a sale item with a medicine_id that doesn't exist in inventory_master
        const sqlLine = "INSERT INTO legacy_saleItems VALUES (2, 'INV002', 999, 1, 50.0);"; // medicine_id 999 doesn't exist
        const result = await processSalesLine(sqlLine, db);
        expect(result).toBe(true); // Should succeed by auto-creating the missing medicine/inventory

        // Verify a record was inserted for this invoice
        const count = await db.get(`
            SELECT COUNT(*) as count FROM sale_items sii
            JOIN sales_invoices si ON sii.invoice_id = si.id
            WHERE si.invoice_no = 'INV002'
        `);
        expect(count.count).toBe(1);

        // Verify the inserted record has correct values
        const saleItem = await db.get(`
            SELECT sii.quantity, sii.unit_price, im.medicine_id
            FROM sale_items sii
            JOIN sales_invoices si ON sii.invoice_id = si.id
            JOIN inventory_master im ON sii.inventory_id = im.id
            WHERE si.invoice_no = 'INV002'
        `);
        expect(saleItem.quantity).toBe(1);
        expect(saleItem.unit_price).toBe(50.0);
        expect(saleItem.medicine_id).toBe(999); // Should reference the auto-created medicine
    }, 15000); // Increased timeout for cache initialization and auto-creation

    test('should return false for non-sales INSERT statements', async () => {
        const sqlLine = "INSERT INTO some_other_table (col1, col2) VALUES (1, 'test');";
        const result = await processSalesLine(sqlLine, db);
        expect(result).toBe(false);
    });

    test('should handle malformed SQL gracefully', async () => {
        const sqlLine = "INSERT INTO legacy_sales VALUES (1);"; // Missing values
        const result = await processSalesLine(sqlLine, db);
        expect(result).toBe(false);
    });
});