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

describe('Sales Validation & Loose-Only Sales', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-validation-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { default: salesRouter } = await import('../src/routes/sales.js');

    app = express();
    app.use(express.json());
    app.use('/api/sales', salesRouter);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('should allow checkout of loose-only items (quantity/strips = 0, loose_qty > 0)', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed database
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (200, "LooseOnlyMed", 10)');
    // Seed inventory: 2 strips and 5 loose units (total 25 units)
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date) VALUES (200, 200, 2, 5, "B-LOOSE", "12/2099")');
    await db.close();

    const res = await request(app)
      .post('/api/sales')
      .send({
        patient_name: 'Test Customer',
        patient_phone: '1234567890',
        items: [{
          inventory_id: 200,
          medicine_name: 'LooseOnlyMed',
          quantity: 0,
          loose_qty: 3,
          unit_price: 100,
          pack_size: 10
        }],
        total_amount: 30 // 3 loose units of 100 per strip (10 per loose) = 30
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify stock has decremented loose quantity from 5 to 2
    const dbVerify = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const inv = await dbVerify.get('SELECT quantity, loose_quantity FROM inventory_master WHERE id = 200');
    await dbVerify.close();

    expect(inv.quantity).toBe(2);
    expect(inv.loose_quantity).toBe(2);
  });

  test('should fail validation if both quantity and loose_qty are 0', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        patient_name: 'Test Customer',
        patient_phone: '1234567890',
        items: [{
          inventory_id: 200,
          medicine_name: 'LooseOnlyMed',
          quantity: 0,
          loose_qty: 0,
          unit_price: 100,
          pack_size: 10
        }]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('must have a quantity or loose quantity greater than 0');
  });

  test('should convert whole strip to loose units if loose sale exceeds loose stock', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed database
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (201, "ConvertMed", 10)');
    // Seed inventory: 2 strips and 2 loose units
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date) VALUES (201, 201, 2, 2, "B-CONV", "12/2099")');
    await db.close();

    // Sell 0 strips and 5 loose units (requires breaking 1 strip -> 1 strip remaining, 12 loose total -> 5 sold -> 7 remaining)
    const res = await request(app)
      .post('/api/sales')
      .send({
        patient_name: 'Test Customer',
        patient_phone: '1234567890',
        items: [{
          inventory_id: 201,
          medicine_name: 'ConvertMed',
          quantity: 0,
          loose_qty: 5,
          unit_price: 100,
          pack_size: 10
        }],
        total_amount: 50
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbVerify = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const inv = await dbVerify.get('SELECT quantity, loose_quantity FROM inventory_master WHERE id = 201');
    await dbVerify.close();

    expect(inv.quantity).toBe(1);
    expect(inv.loose_quantity).toBe(7);
  });
});
