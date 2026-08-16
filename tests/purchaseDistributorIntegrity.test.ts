import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve(true)),
  initClient: jest.fn(() => Promise.resolve(true))
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

describe('Purchase Distributor Integrity Verification', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-integrity-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (901, '', 'INV-STAGED-901', '2026-08-16', 500, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Cetirizine 10mg', batch_no: 'CET-01', expiry_date: '10/28', quantity: 10, cost_price: 15, mrp: 25 }
    ])]);
    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (902, 'Email Import', 'INV-STAGED-902', '2026-08-16', 500, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Cetirizine 10mg', batch_no: 'CET-02', expiry_date: '10/28', quantity: 10, cost_price: 15, mrp: 25 }
    ])]);
    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (903, 'Metro Pharma Logistics', 'INV-STAGED-903', '2026-08-16', 500, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Cetirizine 10mg', batch_no: 'CET-03', expiry_date: '10/28', quantity: 10, cost_price: 15, mrp: 25 }
    ])]);
    await db.close();

    const { default: purchasesRouter } = await import('../src/routes/purchases.js');

    app = express();
    app.use(express.json());
    app.use('/api/purchases', purchasesRouter);
  }, 30000);

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('1. Reject manual purchase when distributor is missing', async () => {
    const res = await request(app)
      .post('/api/purchases/manual')
      .send({
        invoice_no: 'INV-TEST-001',
        date: '2026-08-16',
        items: [
          { medicine_name: 'Amoxicillin 500mg', batch_no: 'AMX-001', qty: 10, rate: 50, mrp: 70 }
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Distributor is required/i);
  }, 15000);

  test('2. Reject manual purchase when distributor is "Default Distributor" or "Unknown Distributor"', async () => {
    const res1 = await request(app)
      .post('/api/purchases/manual')
      .send({
        distributor: 'Default Distributor',
        invoice_no: 'INV-TEST-002',
        date: '2026-08-16',
        items: [
          { medicine_name: 'Amoxicillin 500mg', batch_no: 'AMX-002', qty: 10, rate: 50, mrp: 70 }
        ]
      });

    expect(res1.status).toBe(400);
    expect(res1.body.error).toMatch(/Distributor is required/i);

    const res2 = await request(app)
      .post('/api/purchases/manual')
      .send({
        distributor: 'Unknown Distributor',
        invoice_no: 'INV-TEST-003',
        date: '2026-08-16',
        items: [
          { medicine_name: 'Amoxicillin 500mg', batch_no: 'AMX-003', qty: 10, rate: 50, mrp: 70 }
        ]
      });

    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/Distributor is required/i);
  }, 15000);

  test('3. Reject staged purchase approval if distributor is missing', async () => {
    const res = await request(app)
      .post('/api/purchases/staged/901/approve')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Distributor is required/i);
  }, 15000);

  test('4. Reject staged purchase approval if distributor is placeholder "Email Import" or "Default Distributor"', async () => {
    const res = await request(app)
      .post('/api/purchases/staged/902/approve')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Distributor is required/i);
  }, 15000);

  test('5. Successfully approve staged purchase when legitimate distributor is assigned', async () => {
    const res = await request(app)
      .post('/api/purchases/staged/903/approve')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const dbCheck = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const metroDist = await dbCheck.get('SELECT * FROM distributors WHERE name = ?', ['Metro Pharma Logistics']);
    expect(metroDist).toBeDefined();
    expect(metroDist.name).toBe('Metro Pharma Logistics');
    await dbCheck.close();
  }, 15000);

  test('6. Successfully save manual purchase with legitimate distributor', async () => {
    const res = await request(app)
      .post('/api/purchases/manual')
      .send({
        distributor: 'Apex Pharma Distributors',
        invoice_no: 'INV-APEX-101',
        date: '2026-08-16',
        items: [
          { medicine_name: 'Dolo 650mg', batch_no: 'DOLO-99', qty: 50, rate: 20, mrp: 30 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    
    // Verify distributor record
    const dist = await db.get('SELECT * FROM distributors WHERE name = ?', ['Apex Pharma Distributors']);
    expect(dist).toBeDefined();
    expect(dist.name).toBe('Apex Pharma Distributors');

    // Verify purchase record linked to Apex Pharma Distributors
    const purchase = await db.get('SELECT * FROM purchases WHERE invoice_no = ?', ['INV-APEX-101']);
    expect(purchase).toBeDefined();
    expect(purchase.distributor_id).toBe(dist.id);

    // Verify inventory created with real batch and quantity
    const inv = await db.get('SELECT * FROM inventory_master WHERE batch_no = ?', ['DOLO-99']);
    expect(inv).toBeDefined();
    expect(inv.quantity).toBe(50);

    // Verify NEVER created Default Distributor
    const defaultDist = await db.get('SELECT * FROM distributors WHERE name = "Default Distributor"');
    expect(defaultDist).toBeUndefined();

    await db.close();
  }, 15000);
});
