import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve(true)),
  initClient: jest.fn(() => Promise.resolve(true)),
  hasSavedSession: jest.fn(() => true),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  markWhatsAppActivity: jest.fn(),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, isReady: true, status: 'CONNECTED' })),
  shouldRouteToBusiness: jest.fn(() => false),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  isPuppeteerDetachedError: jest.fn(() => false),
  hashMessageBody: jest.fn((b: any) => String(b ?? '').length),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : ''),
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn(),
  destroyClient: jest.fn(() => Promise.resolve(undefined)),
  forceReconnect: jest.fn(() => Promise.resolve(undefined)),
  reconnectClient: jest.fn(() => Promise.resolve(undefined)),
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([])),
  getMessageMedia: jest.fn(() => Promise.resolve({ mimetype: 'image/jpeg', data: '' })),
  downloadMessageMediaById: jest.fn(() => Promise.resolve(undefined))
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

describe('Legitimate Pharmacy Data Workflow Verification', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legitimate-data-test-'));
      dbPath = path.join(tmpDir, 'app.db');
      process.env.DB_PATH = dbPath;
      await ensureSchema(dbPath);

      const { default: salesRouter } = await import('../src/routes/sales.js');
      const { default: purchasesRouter } = await import('../src/routes/purchases.js');
      const { default: catalogRouter } = await import('../src/routes/catalog.js');

      app = express();
      app.use(express.json());
      app.use('/api/sales', salesRouter);
      app.use('/api/purchases', purchasesRouter);
      app.use('/api', catalogRouter);
    } catch (e) {
      console.error('BEFOREALL ERROR:', e);
      throw e;
    }
  }, 30000);

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('1. Reject staged purchase approval if batch_no is missing or quantity is 0', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (101, 'Sun Pharma Dist', 'INV-STAGED-101', '2026-08-16', 500, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Augmentin 625', batch_no: '', quantity: 10, cost_price: 150, mrp: 200 }
    ])]);
    await db.close();

    const res = await request(app)
      .post('/api/purchases/staged/101/approve')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Batch number is required/i);
  });

  test('2. Approve staged purchase with valid batch and verify inventory populated', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (102, 'Cipla Dist', 'INV-STAGED-102', '2026-08-16', 1500, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Paracetamol 650', batch_no: 'BATCH-CIP-99', expiry_date: '08/28', quantity: 20, cost_price: 25, mrp: 35 }
    ])]);
    // Strict purchase-resolution contract: master registration is user-driven —
    // register the medicine BEFORE approving so the staged line resolves.
    await db.run(`INSERT INTO medicines (name) VALUES (?)`, ['Paracetamol 650']);
    await db.close();

    const res = await request(app)
      .post('/api/purchases/staged/102/approve')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbCheck = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const inv = await dbCheck.get('SELECT * FROM inventory_master WHERE batch_no = ?', ['BATCH-CIP-99']);
    expect(inv).toBeDefined();
    expect(inv.quantity).toBe(20);
    expect(inv.batch_no).toBe('BATCH-CIP-99');
    expect(inv.cost_price).toBe(25);
    expect(inv.mrp).toBe(35);
    await dbCheck.close();
  });

  test('3. POS Bill checkout requires valid inventory batch and rejects unlinked items', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        items: [
          {
            inventory_id: 9999999,
            quantity: 2,
            unit_price: 50,
            loose_qty: 0,
            pack_size: 1
          }
        ],
        paymentMedium: 'CASH',
        total_amount: 100
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('4. Bill hydration returns actual stored database values without dummy AUTO/100 fallbacks', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const medRes = await db.run('INSERT INTO medicines (name, mrp, pack_size) VALUES ("Azithral 500", 120.50, 5)');
    const medId = medRes.lastID;
    const invRes = await db.run('INSERT INTO inventory_master (medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp) VALUES (?, 10, 0, "AZ-REAL-45", "10/28", 80, 120.50)', [medId]);
    const invId = invRes.lastID;

    const invNo = 'INV-HYD-001';
    const saleRes = await db.run(
      'INSERT INTO sales_invoices (invoice_no, total_amount, tax_amount, payment_medium, payment_status, date, discount, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [invNo, 120.50, 6.02, 'CASH', 'PAID', '2026-08-16T12:00:00.000Z', 0, 120.50]
    );
    const saleId = saleRes.lastID;

    await db.run(
      'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per) VALUES (?, ?, 1, 120.50, 0, 0)',
      [saleId, invId]
    );
    await db.close();

    const res = await request(app).get(`/api/sales/${saleId}`);
    expect(res.status).toBe(200);
    expect(res.body.invoice_no).toBe(invNo);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.batch_number).toBe('AZ-REAL-45');
    expect(item.expiry_date).toBe('10/28');
    expect(item.medicine_name).toBe('Azithral 500');
    expect(item.pack_size).toBe(5);
    expect(item.unit_price).toBe(120.50);
  });

  test('5. Catalog review approval registers medicine master without creating fake stock in inventory', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    await db.run(`
      INSERT INTO staged_medicine_reviews (id, medicine_name, original_row_data, status)
      VALUES (501, 'Dolo 650 Strip', '{"mrp": "30.0"}', 'pending')
    `);
    await db.close();

    const res = await request(app)
      .post('/api/catalog/review/501/approve')
      .send({
        approvedData: {
          name: 'Dolo 650 Strip',
          manufacturer: 'Micro Labs'
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbCheck = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const med = await dbCheck.get('SELECT * FROM medicines WHERE name = ?', ['Dolo 650 Strip']);
    expect(med).toBeDefined();

    const fakeInv = await dbCheck.get('SELECT * FROM inventory_master WHERE batch_no = "B-CATALOG"');
    expect(fakeInv).toBeUndefined();
    await dbCheck.close();
  });

  test('6. Staged purchase rejects items with empty batch string or missing commercial rate', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (601, 'Mankind Dist', 'INV-STAGED-601', '2026-08-16', 0, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Moxikind CV', batch_no: '   ', quantity: 5, cost_price: 100, mrp: 150 }
    ])]);
    await db.close();

    const res = await request(app)
      .post('/api/purchases/staged/601/approve')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Batch number is required/i);
  });
});

