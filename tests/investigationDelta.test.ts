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

describe('Investigation Delta-Based Stock Reconciliation', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'investigation-delta-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { default: investigationRouter } = await import('../src/routes/investigation.js');

    app = express();
    app.use(express.json());
    app.use('/api/investigation', investigationRouter);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('should allow purchase corrections when some stock has been sold (delta safety check)', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed data
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (500, "DeltaPurchaseMed", 10)');
    await db.run('INSERT INTO purchases (id, invoice_no, total_amount) VALUES (500, "PUR-500", 1000)');
    // Initial purchase: 10 strips
    await db.run('INSERT INTO purchase_items (purchase_id, medicine_id, quantity, free_qty, batch_no, expiry_date, cost_price, mrp) VALUES (500, 500, 10, 0, "B-DELTA", "12/2099", 100, 150)');
    // Current stock: 8 strips (2 sold)
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp) VALUES (500, 500, 8, 0, "B-DELTA", "12/2099", 100, 150)');
    await db.close();

    // Try to correct purchase: edit cost price and mrp but KEEP quantity = 10 (net change = 0)
    const res = await request(app)
      .put('/api/investigation/purchases/500')
      .send({
        items: [{
          medicine_id: 500,
          batch_no: 'B-DELTA',
          quantity: 10,
          free_qty: 0,
          cost_price: 90,
          mrp: 140,
          expiry_date: '12/2099'
        }]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbVerify = await open({ filename: dbPath, driver: sqlite3.default.Database });
    // Verify inventory quantity is STILL 8 (net change 0)
    const inv = await dbVerify.get('SELECT quantity, cost_price, mrp FROM inventory_master WHERE id = 500');
    // Verify purchase total updated
    const purchase = await dbVerify.get('SELECT total_amount FROM purchases WHERE id = 500');
    await dbVerify.close();

    expect(inv.quantity).toBe(8);
    expect(purchase.total_amount).toBe(900); // 10 * 90 = 900
  });

  test('should allow sales corrections including loose quantity deltas', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed data
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (501, "DeltaSaleMed", 10)');
    await db.run('INSERT INTO sales_invoices (id, invoice_no, total_amount) VALUES (501, "INV-501", 300)');
    // Initial sale: 2 strips and 2 loose units
    await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty) VALUES (501, 501, 2, 100, 2)');
    // Initial inventory master (after sale): 5 strips and 5 loose
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp) VALUES (501, 501, 5, 5, "B-SALE-DELTA", "12/2099", 70, 100)');
    await db.close();

    // Correct sale: change sale to 1 strip and 5 loose units
    // Net change:
    // Qty (strips): 1 - 2 = -1 (returning 1 strip to inventory)
    // Loose: 5 - 2 = +3 (selling 3 more loose units)
    // Net unit change: -1 * 10 + 3 = -7 units (net return of 7 units to inventory, which is +0.7 strips)
    // Since we are returning units, it should always succeed.
    const res = await request(app)
      .put('/api/investigation/sales/501')
      .send({
        items: [{
          inventory_id: 501,
          quantity: 1,
          loose_qty: 5,
          unit_price: 100
        }]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbVerify = await open({ filename: dbPath, driver: sqlite3.default.Database });
    // Verify inventory quantities.
    // Starting units: 5 strips * 10 + 5 loose = 55 units.
    // Net return: 7 units.
    // Ending units: 62 units.
    // Represented as strips and loose: 6 strips, 2 loose (6 * 10 + 2 = 62).
    const inv = await dbVerify.get('SELECT quantity, loose_quantity FROM inventory_master WHERE id = 501');
    // Verify invoice total updated: 1 strip * 100 + 5 loose * 10 = 150. Tax = 7.5. Round(157.5) = 158.
    const sale = await dbVerify.get('SELECT total_amount, subtotal FROM sales_invoices WHERE id = 501');
    await dbVerify.close();

    expect(inv.quantity).toBe(6);
    expect(inv.loose_quantity).toBe(2);
    expect(sale.subtotal).toBe(150);
    expect(sale.total_amount).toBe(158);
  });
});
