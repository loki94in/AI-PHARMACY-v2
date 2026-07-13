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

describe('Inventory Stock Filtering', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-filters-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { default: inventoryRouter } = await import('../src/routes/inventory.js');

    app = express();
    app.use(express.json());
    app.use('/api/inventory', inventoryRouter);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('should correctly filter stock by positive, zero, and negative values', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed medicines
    await db.run('INSERT INTO medicines (id, name) VALUES (1, "MedPositive")');
    await db.run('INSERT INTO medicines (id, name) VALUES (2, "MedZero")');
    await db.run('INSERT INTO medicines (id, name) VALUES (3, "MedNegative")');

    // Seed inventory:
    // 1. Positive stock (quantity = 5, loose = 0)
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no) VALUES (10, 1, 5, 0, "B-POS")');
    // 2. Zero stock (quantity = 0, loose = 0)
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no) VALUES (20, 2, 0, 0, "B-ZERO")');
    // 3. Negative stock (quantity = -2, loose = 0)
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no) VALUES (30, 3, -2, 0, "B-NEG")');
    await db.close();

    // 1. All stock (no filter)
    const resAll = await request(app).get('/api/inventory').query({ stock_filter: 'all' });
    expect(resAll.body.data.length).toBe(3);

    // 2. Positive stock only
    const resPos = await request(app).get('/api/inventory').query({ stock_filter: 'positive' });
    expect(resPos.body.data.length).toBe(1);
    expect(resPos.body.data[0].batch_number).toBe('B-POS');

    // 3. Zero stock only
    const resZero = await request(app).get('/api/inventory').query({ stock_filter: 'zero' });
    expect(resZero.body.data.length).toBe(1);
    expect(resZero.body.data[0].batch_number).toBe('B-ZERO');

    // 4. Negative stock only
    const resNeg = await request(app).get('/api/inventory').query({ stock_filter: 'negative' });
    expect(resNeg.body.data.length).toBe(1);
    expect(resNeg.body.data[0].batch_number).toBe('B-NEG');
  });
});
