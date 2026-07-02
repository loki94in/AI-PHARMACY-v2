import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { processReturnsLine } from '../src/worker/parsers/returnsParser.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.resolve(__dirname, '..', 'data', 'test-returns-parser.db');

describe('returnsParser', () => {
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

        // Create the required tables for testing
        await db.exec(`
            CREATE TABLE sales_invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_no TEXT UNIQUE,
                date DATETIME DEFAULT CURRENT_TIMESTAMP,
                total_amount REAL
            );

            CREATE TABLE purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_no TEXT,
                total_amount REAL
            );

            CREATE TABLE returns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                return_no TEXT UNIQUE,
                original_invoice_id INTEGER,
                type TEXT CHECK(type IN ('sale', 'purchase')),
                date DATETIME DEFAULT CURRENT_TIMESTAMP,
                total_amount REAL,
                return_invoice_id TEXT DEFAULT NULL,
                return_sub_type TEXT CHECK(return_sub_type IN ('expiry', 'good')) DEFAULT 'good',
                return_date_time DATETIME DEFAULT NULL
            );
        `);
    });

    afterAll(async () => {
        await db.close();
        // Clean up test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
    });

    test('should process legacy sales return INSERT statement', async () => {
        // First insert a sale invoice to reference
        await db.run('INSERT INTO sales_invoices (invoice_no, total_amount) VALUES (?, ?)', ['INV001', 100.0]);

        const sqlLine = "INSERT INTO legacy_returns (return_no, original_invoice_number, type, date, total_amount) VALUES ('RET001', 'INV001', 'sale', '2024-01-15', 50.0);";
        const result = await processReturnsLine(sqlLine, db);
        expect(result).toBe(true);

        // Verify the record was inserted correctly
        const rows = await db.all("SELECT * FROM returns WHERE return_no = 'RET001'");
        expect(rows.length).toBe(1);
        expect(rows[0].return_no).toBe('RET001');
        expect(rows[0].original_invoice_id).toBe(1); // Should reference the sales_invoices id
        expect(rows[0].type).toBe('sale');
        expect(rows[0].date).toBe('2024-01-15 00:00:00');
        expect(rows[0].total_amount).toBe(50.0);
    });

    test('should process legacy purchase return INSERT statement', async () => {
        // First insert a purchase invoice to reference
        await db.run('INSERT INTO purchases (invoice_no, total_amount) VALUES (?, ?)', ['PINV001', 75.0]);

        const sqlLine = "INSERT INTO legacy_returns (return_no, original_invoice_number, type, date, total_amount) VALUES ('PRET001', 'PINV001', 'purchase', '2024-02-20', 25.0);";
        const result = await processReturnsLine(sqlLine, db);
        expect(result).toBe(true);

        // Verify the record was inserted correctly
        const rows = await db.all("SELECT * FROM returns WHERE return_no = 'PRET001'");
        expect(rows.length).toBe(1);
        expect(rows[0].return_no).toBe('PRET001');
        expect(rows[0].original_invoice_id).toBe(1); // Should reference the purchases id
        expect(rows[0].type).toBe('purchase');
        expect(rows[0].date).toBe('2024-02-20 00:00:00');
        expect(rows[0].total_amount).toBe(25.0);
    });

    test('should handle missing original invoice gracefully', async () => {
        const sqlLine = "INSERT INTO legacy_returns (return_no, original_invoice_number, type, date, total_amount) VALUES ('RET002', 'NONEXISTENT', 'sale', '2024-03-10', 30.0);";
        const result = await processReturnsLine(sqlLine, db);
        expect(result).toBe(true); // Should still process even if invoice not found

        // Verify the record was inserted with NULL original_invoice_id
        const rows = await db.all("SELECT * FROM returns WHERE return_no = 'RET002'");
        expect(rows.length).toBe(1);
        expect(rows[0].return_no).toBe('RET002');
        expect(rows[0].original_invoice_id).toBeNull(); // Should be NULL when invoice not found
        expect(rows[0].type).toBe('sale');
        expect(rows[0].date).toBe('2024-03-10 00:00:00');
        expect(rows[0].total_amount).toBe(30.0);
    });

    test('should return false for non-returns INSERT statements', async () => {
        const sqlLine = "INSERT INTO some_other_table (col1, col2) VALUES (1, 'test');";
        const result = await processReturnsLine(sqlLine, db);
        expect(result).toBe(false);
    });

    test('should return false for malformed SQL', async () => {
        const sqlLine = "INSERT INTO legacy_returns VALUES (1, 2);"; // Missing values
        const result = await processReturnsLine(sqlLine, db);
        expect(result).toBe(false);
    });

    test('should validate type column constraint', async () => {
        const sqlLine = "INSERT INTO legacy_returns (return_no, original_invoice_number, type, date, total_amount) VALUES ('RET003', 'INV001', 'invalid', '2024-04-01', 40.0);";
        const result = await processReturnsLine(sqlLine, db);
        expect(result).toBe(false); // Should reject invalid type
    });

    test('should process legacy sales return with 8 values (new columns)', async () => {
        // First insert a sale invoice to reference
        await db.run('INSERT INTO sales_invoices (invoice_no, total_amount) VALUES (?, ?)', ['INV008', 100.0]);

        const sqlLine = "INSERT INTO legacy_returns (return_no, original_invoice_number, type, date, total_amount, return_invoice_id, return_sub_type, return_date_time) VALUES ('RET008', 'INV008', 'sale', '2024-01-15', 50.0, 'RETI_123', 'good', '2024-01-15 10:30:00');";
        const result = await processReturnsLine(sqlLine, db);
        expect(result).toBe(true);

        const rows = await db.all("SELECT * FROM returns WHERE return_no = 'RET008'");
        expect(rows.length).toBe(1);
        expect(rows[0].return_invoice_id).toBe('RETI_123');
        expect(rows[0].return_sub_type).toBe('good');
        expect(rows[0].return_date_time).toBe('2024-01-15 10:30:00');
    });
});