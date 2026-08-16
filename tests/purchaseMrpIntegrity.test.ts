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

describe('Purchase MRP Integrity Verification', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrp-integrity-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager: dbm } = await import('../src/database/connection.js');
    dbManager = dbm;
    const db = await dbManager.getConnection();

    // Seed legitimate distributor
    await db.run(`INSERT INTO distributors (id, name, email) VALUES (10, 'Sun Pharma Distributors', 'orders@sunpharma.com')`);

    // Seed medicines
    await db.run(`INSERT INTO medicines (id, name, mrp, rate) VALUES (1, 'Paracetamol 650mg', 22.00, 12.50)`);
    await db.run(`INSERT INTO medicines (id, name, mrp, rate) VALUES (2, 'Cetirizine 10mg', 25.50, 15.00)`);
    await db.run(`INSERT INTO medicines (id, name, mrp, rate) VALUES (3, 'Pantoprazole 40mg', 85.00, 45.50)`);
    await db.run(`INSERT INTO medicines (id, name, mrp, rate) VALUES (4, 'Amoxicillin 500mg', 75.00, 50.00)`);

    // Seed email record for reissue test
    await db.run(`
      INSERT INTO emails (uid, from_addr, subject, body, date, is_seen, is_order, is_saved, distributor_name)
      VALUES (201, 'orders@sunpharma.com', 'Invoice INV-SUN-201', 'Invoice INV-SUN-201\\nParacetamol 650mg 10x', '2026-08-16', 0, 1, 0, 'Sun Pharma Distributors')
    `);

    // Seed staged purchase with missing MRP
    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (801, 'Sun Pharma Distributors', 'INV-STAGED-801', '2026-08-16', 500, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Cetirizine 10mg', batch_no: 'CET-801', expiry_date: '10/28', quantity: 10, cost_price: 15, mrp: 0 }
    ])]);

    // Seed staged purchase with valid MRP
    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (802, 'Sun Pharma Distributors', 'INV-STAGED-802', '2026-08-16', 500, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Cetirizine 10mg', batch_no: 'CET-802', expiry_date: '10/28', quantity: 10, cost_price: 15, mrp: 25.50 }
    ])]);

    const { default: purchasesRouter } = await import('../src/routes/purchases.js');

    app = express();
    app.use(express.json());
    app.use('/api/purchases', purchasesRouter);
  }, 30000);

  afterAll(async () => {
    try {
      if (dbManager) await dbManager.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('1. Reject manual purchase when item MRP is missing or 0', async () => {
    const res = await request(app)
      .post('/api/purchases/manual')
      .send({
        distributor: 'Sun Pharma Distributors',
        invoice_no: 'INV-TEST-MRP-01',
        date: '2026-08-16',
        items: [
          { medicine_name: 'Amoxicillin 500mg', batch_no: 'AMX-001', qty: 10, rate: 50, mrp: 0 }
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Amoxicillin 500mg.*requires a valid MRP/i);
  }, 15000);

  test('2. Reject manual purchase with multiple items when one item lacks MRP, showing specific item name', async () => {
    const res = await request(app)
      .post('/api/purchases/manual')
      .send({
        distributor: 'Sun Pharma Distributors',
        invoice_no: 'INV-TEST-MRP-02',
        date: '2026-08-16',
        items: [
          { medicine_name: 'Amoxicillin 500mg', batch_no: 'AMX-002', qty: 10, rate: 50, mrp: 75.00 },
          { medicine_name: 'Azithromycin 250mg', batch_no: 'AZI-001', qty: 5, rate: 40, mrp: '' }
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Azithromycin 250mg.*requires a valid MRP/i);
  }, 15000);

  test('3. Accept manual purchase with valid legitimate MRP and verify inventory receives exact MRP', async () => {
    const res = await request(app)
      .post('/api/purchases/manual')
      .send({
        distributor: 'Sun Pharma Distributors',
        invoice_no: 'INV-TEST-MRP-03',
        date: '2026-08-16',
        items: [
          { medicine_name: 'Pantoprazole 40mg', batch_no: 'PAN-001', qty: 20, free_qty: 2, rate: 45.50, mrp: 85.00 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const db = await dbManager.getConnection();
    const inv = await db.get('SELECT * FROM inventory_master WHERE batch_no = ?', ['PAN-001']);
    expect(inv).toBeDefined();
    expect(inv.quantity).toBe(22);
    expect(inv.cost_price).toBe(45.50);
    expect(inv.mrp).toBe(85.00); // Exact MRP from invoice, never fabricated from rate

    const purItem = await db.get('SELECT * FROM purchase_items WHERE batch_no = ?', ['PAN-001']);
    expect(purItem).toBeDefined();
    expect(purItem.mrp).toBe(85.00);
    expect(purItem.cost_price).toBe(45.50);
  }, 15000);

  test('4. Reject email reissue when items lack legitimate MRP (does not fabricate rate * 1.2)', async () => {
    const res = await request(app)
      .post('/api/purchases/reconciliation/reissue')
      .send({
        email_uid: 201,
        distributor_name: 'Sun Pharma Distributors',
        items: [
          { name: 'Paracetamol 650mg', quantity: 10, rate: 12.50, mrp: 0, batch_no: 'PCM-201', expiry_date: '10/28' }
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing MRP/i);

    // Verify inventory never received any fabricated MRP or stock
    const db = await dbManager.getConnection();
    const inv = await db.get('SELECT * FROM inventory_master WHERE batch_no = ?', ['PCM-201']);
    expect(inv).toBeUndefined();
  }, 15000);

  test('5. Accept email reissue with legitimate user-provided MRP', async () => {
    const res = await request(app)
      .post('/api/purchases/reconciliation/reissue')
      .send({
        email_uid: 201,
        distributor_name: 'Sun Pharma Distributors',
        items: [
          { name: 'Paracetamol 650mg', quantity: 10, rate: 12.50, mrp: 22.00, batch_no: 'PCM-201', expiry_date: '10/28' }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const db = await dbManager.getConnection();
    const inv = await db.get('SELECT * FROM inventory_master WHERE batch_no = ?', ['PCM-201']);
    expect(inv).toBeDefined();
    expect(inv.quantity).toBe(10);
    expect(inv.cost_price).toBe(12.50);
    expect(inv.mrp).toBe(22.00); // Exact legitimate MRP
  }, 15000);

  test('6. Reject approving staged purchase when item lacks MRP', async () => {
    const res = await request(app)
      .post('/api/purchases/staged/801/approve')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/MRP is required/i);

    const db = await dbManager.getConnection();
    const inv = await db.get('SELECT * FROM inventory_master WHERE batch_no = ?', ['CET-801']);
    expect(inv).toBeUndefined();
  }, 15000);

  test('7. Accept approving staged purchase with valid MRP', async () => {
    const res = await request(app)
      .post('/api/purchases/staged/802/approve')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const db = await dbManager.getConnection();
    const inv = await db.get('SELECT * FROM inventory_master WHERE batch_no = ?', ['CET-802']);
    expect(inv).toBeDefined();
    expect(inv.mrp).toBe(25.50);
  }, 15000);
});
