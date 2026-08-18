import { jest } from '@jest/globals';

const mockSendMessage = jest.fn((..._args: any[]) => Promise.resolve(true));
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: mockSendMessage,
  initClient: jest.fn(() => Promise.resolve(true))
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import request from 'supertest';
import { ensureSchema } from '../src/database.js';

describe('Pharmarack Cart Item Visibility & Selective Dispatch Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: express.Express;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-vis-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    dbManager = (await import('../src/database/connection.js')).dbManager;
    const pharmarackRouter = (await import('../src/routes/pharmarack.js')).default;

    app = express();
    app.use(express.json());
    app.use('/api/pharmarack', pharmarackRouter);
  });

  afterAll(async () => {
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM pharmarack_placed_orders');
    await db.run('DELETE FROM distributors');
    await db.run('DELETE FROM delivery_boys');
  });

  test('1. GET /api/pharmarack/sent-orders/latest-map returns placed orders with item placedAt timestamps', async () => {
    const db = await dbManager.getConnection();

    const yesterdayMs = Date.now() - (24 * 60 * 60 * 1000);
    const yesterdayDate = new Date(yesterdayMs).toISOString().split('T')[0];
    await db.run(`
      INSERT INTO pharmarack_placed_orders (order_date, store_id, store_name, placed_at, items_json, delivery_persons_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      yesterdayDate,
      101,
      'Apex Pharma Agency',
      yesterdayMs,
      JSON.stringify([
        { productCode: 'P-101', productName: 'Azithromycin 500mg', qty: 10, rate: 45, mrp: 90 }
      ]),
      JSON.stringify([{ name: 'Ravi Delivery', code: 'D1' }])
    ]);

    const res = await request(app).get('/api/pharmarack/sent-orders/latest-map');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sentMap).toBeDefined();

    const storeInfo = res.body.sentMap['101'];
    expect(storeInfo).toBeDefined();
    expect(storeInfo.storeName).toBe('Apex Pharma Agency');
    expect(storeInfo.placedAt).toBe(yesterdayMs);
    expect(storeInfo.items).toHaveLength(1);
    expect(storeInfo.items[0].productName).toBe('Azithromycin 500mg');
    expect(storeInfo.items[0].placedAt).toBe(yesterdayMs);
  });

  test('2. POST /api/pharmarack/log-placed-order records new placed orders and updates latest-map', async () => {
    const logRes = await request(app)
      .post('/api/pharmarack/log-placed-order')
      .send({
        store_id: 202,
        store_name: 'Metro Pharma Logistics',
        items: [
          { productCode: 'P-202', productName: 'Paracetamol 650mg', qty: 20, rate: 15, mrp: 30 }
        ],
        delivery_persons: [{ name: 'Suresh Kumar', code: 'D2' }]
      });

    expect(logRes.status).toBe(200);
    expect(logRes.body.success).toBe(true);

    const mapRes = await request(app).get('/api/pharmarack/sent-orders/latest-map');
    expect(mapRes.status).toBe(200);
    const storeInfo = mapRes.body.sentMap['202'];
    expect(storeInfo).toBeDefined();
    expect(storeInfo.storeName).toBe('Metro Pharma Logistics');
    expect(storeInfo.items[0].productName).toBe('Paracetamol 650mg');
  });

  test('3. Dates endpoint GET /api/pharmarack/sent-orders/dates returns distinct formatted dates', async () => {
    const db = await dbManager.getConnection();
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    await db.run(`
      INSERT INTO pharmarack_placed_orders (order_date, store_id, store_name, placed_at, items_json)
      VALUES (?, 303, 'Prime Medicals', ?, '[]')
    `, [today, now]);

    const res = await request(app).get('/api/pharmarack/sent-orders/dates');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.dates)).toBe(true);
    expect(res.body.dates.length).toBeGreaterThanOrEqual(1);
    expect(res.body.dates).toContain(today);
  });
});
