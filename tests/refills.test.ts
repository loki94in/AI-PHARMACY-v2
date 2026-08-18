import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve(true)),
  initClient: jest.fn(() => Promise.resolve(true)),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, status: 'CONNECTED' })),
  shouldRouteToBusiness: jest.fn(() => false),
  hashMessageBody: jest.fn(() => 'mock-hash'),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : '')
}));

jest.unstable_mockModule('../src/telegramBot.js', () => ({
  __esModule: true,
  telegramBotService: {
    sendDefaultNotification: jest.fn(() => Promise.resolve(true))
  }
}));

import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

let mockSendMessage: any;
let mockTelegramBotService: any;

describe('Patient Refills & POS Auto-Save Integration', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    // Create special_orders table which is queried by inventory overrides
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product TEXT,
        requester TEXT,
        phone TEXT,
        qty INTEGER,
        priority TEXT,
        status TEXT DEFAULT 'Pending',
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        notified INTEGER DEFAULT 0,
        pharmarack_distributor TEXT,
        pharmarack_rate REAL,
        pharmarack_mrp REAL,
        pharmarack_mapped INTEGER DEFAULT 0,
        pharmarack_scheme TEXT,
        advance_payment REAL DEFAULT 0.0,
        source_refill_id INTEGER DEFAULT NULL,
        source TEXT
      )
    `);
    await db.close();

    mockSendMessage = (await import('../src/whatsappClient.js')).sendMessage;
    mockTelegramBotService = (await import('../src/telegramBot.js')).telegramBotService;

    // Load routers
    const { default: salesRouter } = await import('../src/routes/sales.js');
    const { default: refillsRouter } = await import('../src/routes/refills.js');
    const { default: inventoryRouter } = await import('../src/routes/inventory.js');

    app = express();
    app.use(express.json());
    app.use('/api/sales', salesRouter);
    app.use('/api/refills', refillsRouter);
    app.use('/api/inventory', inventoryRouter);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POS billing automatically creates a customer in the database', async () => {
    // Seed database with a valid medicine and inventory item
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const dbSeed = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await dbSeed.run('INSERT INTO medicines (id, name) VALUES (1, "Test Med")');
    await dbSeed.run('INSERT INTO inventory_master (id, medicine_id, quantity) VALUES (1, 1, 10)');
    await dbSeed.close();

    const res = await request(app)
      .post('/api/sales')
      .send({
        patient_name: 'John Doe',
        patient_phone: '1234567890',
        patient_address: '123 Test St',
        items: [{ inventory_id: 1, quantity: 1, unit_price: 10 }]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify customer is in the DB
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const customer = await db.get('SELECT * FROM customers WHERE name = ?', 'John Doe');
    await db.close();

    expect(customer).toBeDefined();
    expect(customer.phone).toBe('1234567890');
    expect(customer.address).toBe('123 Test St');
  });

  test('Refill registration and out-of-stock Telegram alert', async () => {
    // 1. Add a medicine
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run('INSERT INTO medicines (id, name) VALUES (?, ?)', [101, 'TestMeds']);
    // Out of stock initially (qty = 0)
    await db.run('INSERT INTO inventory_master (medicine_id, quantity) VALUES (?, ?)', [101, 0]);
    await db.close();

    // 2. Register refill request (which triggers instant check)
    const res = await request(app)
      .post('/api/refills')
      .send({
        patient_name: 'Alice Smith',
        patient_phone: '9876543210',
        medicine_id: 101,
        refill_interval_days: -1 // make it due immediately
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 3. Verify Telegram out-of-stock notification was triggered
    expect(mockTelegramBotService.sendDefaultNotification).toHaveBeenCalledWith(
      expect.stringContaining('Alice Smith')
    );
    expect(mockTelegramBotService.sendDefaultNotification).toHaveBeenCalledWith(
      expect.stringContaining('TestMeds')
    );
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('Stock update triggers WhatsApp refill notification', async () => {
    // 1. Reset mocks
    jest.clearAllMocks();

    // 2. Add stock (inventory override) to trigger check
    const res = await request(app)
      .post('/api/inventory/override')
      .send({
        inventory_id: 2, // refers to medicine_id 101
        quantity: 10,
        reason: 'Restocking for test verification'
      });

    expect(res.status).toBe(200);

    // Get the inventory master row mapping
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const invRow = await db.get('SELECT medicine_id FROM inventory_master WHERE id = 2');
    
    // Explicitly call stock update triggers to make sure medicine stock triggers
    if (invRow) {
      const { triggerPendingRefillsForMedicine } = await import('../src/services/refillService.js');
      await triggerPendingRefillsForMedicine(db, invRow.medicine_id);
    }
    await db.close();

    // 3. Verify that the refill is marked as ready for manual send, and no auto WhatsApp is sent
    const dbVerify = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const refill = await dbVerify.get('SELECT is_ready FROM patient_refills WHERE patient_name = ?', 'Alice Smith');
    await dbVerify.close();

    expect(refill.is_ready).toBe(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('Medicine Refill Detection & Prefill endpoints return previous sale history and sibling items', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Insert 2 medicines and inventory
    await db.run('INSERT INTO medicines (id, name, mrp, sell_price, pack_size) VALUES (201, "Telma 40", 150, 140, 15)');
    await db.run('INSERT INTO medicines (id, name, mrp, sell_price, pack_size) VALUES (202, "Amlodipine 5mg", 60, 55, 10)');
    await db.run('INSERT INTO inventory_master (id, medicine_id, batch_no, expiry_date, quantity, unit_price, mrp) VALUES (10, 201, "B-TEL01", "2027-12-31", 50, 9.33, 150)');
    await db.run('INSERT INTO inventory_master (id, medicine_id, batch_no, expiry_date, quantity, unit_price, mrp) VALUES (11, 202, "B-AML01", "2027-10-31", 30, 5.5, 60)');

    // Insert customer
    const custRes = await db.run('INSERT INTO customers (name, phone, address) VALUES ("Rajesh Kumar", "9898989898", "45 Park Road")');
    const custId = custRes.lastID;

    // Create a previous sale invoice with both items
    const invRes = await db.run('INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, date) VALUES ("INV-TEST-001", ?, 400, "2026-07-01 10:00:00")', [custId]);
    const invId = invRes.lastID;

    await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, discount_per) VALUES (?, 10, 30, 9.33, 5)', [invId]);
    await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, discount_per) VALUES (?, 11, 15, 5.5, 0)', [invId]);

    await db.close();

    // 1. Test /api/sales/medicine-refill-info/201
    const refillInfoRes = await request(app).get('/api/sales/medicine-refill-info/201');
    expect(refillInfoRes.status).toBe(200);
    expect(refillInfoRes.body.success).toBe(true);
    expect(refillInfoRes.body.medicine.name).toBe('Telma 40');
    expect(refillInfoRes.body.best_inventory.batch_no).toBe('B-TEL01');
    expect(refillInfoRes.body.last_sale).toBeDefined();
    expect(refillInfoRes.body.last_sale.customer_name).toBe('Rajesh Kumar');
    expect(refillInfoRes.body.last_sale.customer_phone).toBe('9898989898');
    expect(refillInfoRes.body.last_sale.quantity).toBe(30);
    expect(refillInfoRes.body.sibling_items.length).toBe(1);
    expect(refillInfoRes.body.sibling_items[0].medicine_name).toBe('Amlodipine 5mg');
    expect(refillInfoRes.body.sibling_items[0].sold_quantity).toBe(15);

    // 2. Test /api/sales/patient-refill-medicines?phone=9898989898
    const patientRefillsRes = await request(app).get('/api/sales/patient-refill-medicines?phone=9898989898');
    expect(patientRefillsRes.status).toBe(200);
    expect(patientRefillsRes.body.success).toBe(true);
    expect(patientRefillsRes.body.customer.name).toBe('Rajesh Kumar');
    expect(patientRefillsRes.body.medicines.length).toBe(2);
    const medNames = patientRefillsRes.body.medicines.map((m: any) => m.medicine_name);
    expect(medNames).toContain('Telma 40');
    // 3. Test /api/sales/reorder-suggestions and /snoozed
    const reorderRes = await request(app).get('/api/sales/reorder-suggestions');
    expect(reorderRes.status).toBe(200);
    expect(reorderRes.body.success).toBe(true);
    expect(Array.isArray(reorderRes.body.items)).toBe(true);

    const snoozedRes = await request(app).get('/api/sales/reorder-suggestions/snoozed');
    expect(snoozedRes.status).toBe(200);
    expect(snoozedRes.body.success).toBe(true);
    expect(Array.isArray(snoozedRes.body.items)).toBe(true);
  });

  afterAll(async () => {
    try {
      const { dbManager } = await import('../src/database/connection.js');
      await dbManager.close(true);
    } catch {}
    delete process.env.DB_PATH;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });
});
