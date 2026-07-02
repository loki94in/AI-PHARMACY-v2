import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { processInventoryLine } from '../src/worker/parsers/inventoryParser.js';
import { ensureSchema } from '../src/database.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.resolve(__dirname, '..', 'data', 'test-inventory-parser.db');

describe('inventoryParser', () => {
    let db: any;

    beforeAll(async () => {
        // Clean up any existing test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }

        // Ensure the data directory exists
        const testDataDir = path.dirname(TEST_DB_PATH);
        if (!fs.existsSync(testDataDir)) {
            fs.mkdirSync(testDataDir, { recursive: true });
        }

        // Open a test SQLite database
        db = await open({
            filename: TEST_DB_PATH,
            driver: sqlite3.Database
        });

        // Ensure the database schema matches the production schema
        await ensureSchema(TEST_DB_PATH);
    });

    afterAll(async () => {
        await db.close();
        // Clean up test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
    });

    test('should process legacy_stock INSERT statement with MM/YY date format', async () => {
        const sqlLine = "INSERT INTO legacy_stock (medicine_id, quantity, rack_location, batch_no, expiry_date) VALUES (101, 50, 'A1', 'BATCH001', '06/25');";
        const result = await processInventoryLine(sqlLine, db);
        expect(result).toBe(true);

        // Verify the record was inserted correctly
        const rows = await db.all("SELECT * FROM inventory_master WHERE medicine_id = 101");
        expect(rows.length).toBe(1);
        expect(rows[0].medicine_id).toBe(101);
        expect(rows[0].quantity).toBe(50);
        expect(rows[0].rack_location).toBe('A1');
        expect(rows[0].batch_no).toBe('BATCH001');
        // For 06/25, it should be converted to 2025-06-01 00:00:00
        expect(rows[0].expiry_date).toBe('2025-06-01 00:00:00');
    }, 20000); // Increased timeout for database initialization

    test('should process legacy_batches INSERT statement with DD-MM-YYYY date format', async () => {
        const sqlLine = "INSERT INTO legacy_batches VALUES (202, 25, 'B2', 'BATCH002', '15-12-2024');";
        const result = await processInventoryLine(sqlLine, db);
        expect(result).toBe(true);

        // Verify the record was inserted correctly
        const rows = await db.all("SELECT * FROM inventory_master WHERE medicine_id = 202");
        expect(rows.length).toBe(1);
        expect(rows[0].medicine_id).toBe(202);
        expect(rows[0].quantity).toBe(25);
        expect(rows[0].rack_location).toBe('B2');
        expect(rows[0].batch_no).toBe('BATCH002');
        // For 15-12-2024, it should be converted to 2024-12-15 00:00:00
        expect(rows[0].expiry_date).toBe('2024-12-15 00:00:00');
    }, 20000); // Increased timeout for database initialization

    test('should handle YYYY-MM-DD date format', async () => {
        const sqlLine = "INSERT INTO legacy_stock (medicine_id, quantity, rack_location, batch_no, expiry_date) VALUES (303, 100, 'C3', 'BATCH003', '2023-08-15');";
        const result = await processInventoryLine(sqlLine, db);
        expect(result).toBe(true);

        // Verify the record was inserted correctly
        const rows = await db.all("SELECT * FROM inventory_master WHERE medicine_id = 303");
        expect(rows.length).toBe(1);
        expect(rows[0].medicine_id).toBe(303);
        expect(rows[0].quantity).toBe(100);
        expect(rows[0].rack_location).toBe('C3');
        expect(rows[0].batch_no).toBe('BATCH003');
        expect(rows[0].expiry_date).toBe('2023-08-15 00:00:00');
    });

    test('should return false for non-inventory INSERT statements', async () => {
        const sqlLine = "INSERT INTO some_other_table (col1, col2) VALUES (1, 'test');";
        const result = await processInventoryLine(sqlLine, db);
        expect(result).toBe(false);
    });

    test('should return false for malformed SQL', async () => {
        const sqlLine = "INSERT INTO legacy_stock VALUES (1, 2);"; // Missing values
        const result = await processInventoryLine(sqlLine, db);
        expect(result).toBe(false);
    });

    test('should handle invalid date formats gracefully', async () => {
        const sqlLine = "INSERT INTO legacy_stock VALUES (404, 10, 'D4', 'BATCH004', 'invalid-date');";
        const result = await processInventoryLine(sqlLine, db);
        expect(result).toBe(false);
    });

    test('should handle NULL expiry date', async () => {
        const sqlLine = "INSERT INTO legacy_stock VALUES (505, 5, 'E5', 'BATCH005', NULL);";
        const result = await processInventoryLine(sqlLine, db);
        expect(result).toBe(true);

        // Verify the record was inserted correctly with NULL expiry_date
        const rows = await db.all("SELECT * FROM inventory_master WHERE medicine_id = 505");
        expect(rows.length).toBe(1);
        expect(rows[0].expiry_date).toBeNull();
    });
});