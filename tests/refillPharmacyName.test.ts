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

describe('Task 13 — Refill WhatsApp Pharmacy Name Enforcement', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-pharmacy-name-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    mockSendMessage = (await import('../src/whatsappClient.js')).sendMessage;

    const { default: refillsRouter } = await import('../src/routes/refills.js');

    app = express();
    app.use(express.json());
    app.use('/api/refills', refillsRouter);
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

  beforeEach(async () => {
    jest.clearAllMocks();
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run('DELETE FROM app_settings');
    await db.run('DELETE FROM patient_refills');
    await db.run('DELETE FROM medicines');
    await db.run('DELETE FROM automation_notifications');
    await db.close();
  });

  test('1. Blocks immediate refill send when pharmacy name is unconfigured', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run('INSERT INTO medicines (id, name) VALUES (1, "Metformin 500mg")');
    await db.run(`
      INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, refill_interval_days, is_active, status)
      VALUES (1, "Rahul Sharma", "919876543210", 1, 30, 1, "pending")
    `);
    await db.close();

    const res = await request(app).post('/api/refills/1/send');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Pharmacy name required in Settings.');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('2. Blocks immediate refill send when pharmacy name is placeholder "XYZ MEDICAL"', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run("INSERT INTO app_settings (key, value) VALUES ('shop_name', 'XYZ MEDICAL')");
    await db.run('INSERT INTO medicines (id, name) VALUES (1, "Metformin 500mg")');
    await db.run(`
      INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, refill_interval_days, is_active, status)
      VALUES (1, "Rahul Sharma", "919876543210", 1, 30, 1, "pending")
    `);
    await db.close();

    const res = await request(app).post('/api/refills/1/send');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Pharmacy name required in Settings.');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('3. Sends refill reminder with saved pharmacy name when configured in Settings', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run("INSERT INTO app_settings (key, value) VALUES ('shop_name', 'APOLLO HEALTH PHARMACY')");
    await db.run('INSERT INTO medicines (id, name) VALUES (1, "Metformin 500mg")');
    await db.run(`
      INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, refill_interval_days, is_active, status)
      VALUES (1, "Rahul Sharma", "919876543210", 1, 30, 1, "pending")
    `);
    await db.close();

    const res = await request(app).post('/api/refills/1/send');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '919876543210',
      undefined,
      expect.stringContaining('APOLLO HEALTH PHARMACY')
    );
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.stringContaining('XYZ MEDICAL')
    );
  });

  test('4. Blocks send-reminder-now when pharmacy name is missing and allows when configured', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run('INSERT INTO medicines (id, name) VALUES (1, "Amlodipine 5mg")');
    await db.run(`
      INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, refill_interval_days, is_active, status)
      VALUES (2, "Priya Patel", "919123456780", 1, 30, 1, "pending")
    `);
    await db.close();

    // Attempt without pharmacy name
    const resBlocked = await request(app)
      .post('/api/refills/send-reminder-now')
      .send({ patient_phone: '919123456780' });
    expect(resBlocked.status).toBe(400);
    expect(resBlocked.body.error).toContain('Pharmacy name required in Settings.');

    // Set pharmacy name in settings
    const db2 = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db2.run("INSERT INTO app_settings (key, value) VALUES ('pharmacy_name', 'MEDPLUS PHARMACY')");
    await db2.close();

    const resSuccess = await request(app)
      .post('/api/refills/send-reminder-now')
      .send({ patient_phone: '919123456780' });
    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body.success).toBe(true);

    const db3 = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const notification = await db3.get('SELECT * FROM automation_notifications WHERE reference_id = "2"');
    await db3.close();

    expect(notification).toBeDefined();
    expect(notification.message).toContain('MEDPLUS PHARMACY');
    expect(notification.message).not.toContain('XYZ MEDICAL');
  });

  test('5. Blocks send-tomorrow-reminder when pharmacy name is missing and allows when configured', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 19).replace('T', ' ');

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run('INSERT INTO medicines (id, name) VALUES (1, "Thyronorm 50mcg")');
    await db.run(`
      INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, refill_interval_days, is_active, status, is_ready, next_refill_date)
      VALUES (3, "Amit Roy", "919988776655", 1, 30, 1, "pending", 1, ?)
    `, [tomorrowStr]);
    await db.close();

    // Attempt without pharmacy name
    const resBlocked = await request(app)
      .post('/api/refills/send-tomorrow-reminder')
      .send({ patient_phone: '919988776655' });
    expect(resBlocked.status).toBe(400);
    expect(resBlocked.body.error).toContain('Pharmacy name required in Settings.');

    // Set pharmacy name in settings
    const db2 = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db2.run("INSERT INTO app_settings (key, value) VALUES ('store_name', 'WELLNESS FOREVER')");
    await db2.close();

    const resSuccess = await request(app)
      .post('/api/refills/send-tomorrow-reminder')
      .send({ patient_phone: '919988776655' });
    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body.success).toBe(true);

    const db3 = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const notification = await db3.get('SELECT * FROM automation_notifications WHERE reference_id = "3"');
    await db3.close();

    expect(notification).toBeDefined();
    expect(notification.message).toContain('WELLNESS FOREVER');
    expect(notification.message).not.toContain('XYZ MEDICAL');
  });

  test('6. Staged refill collection notification is not created when pharmacy name is missing or placeholder', async () => {
    const { createQuickBillForRefill } = await import('../src/services/refillService.js');
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    await db.run('INSERT INTO medicines (id, name, mrp) VALUES (10, "Cough Syrup", 120)');
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, batch_no, expiry_date, mrp) VALUES (101, 10, 10, "CS-101", "12/28", 120)');

    const refillObj = {
      id: 50,
      medicine_id: 10,
      medicine_name: 'Cough Syrup',
      patient_name: 'Suresh Raina',
      patient_phone: '919876500000',
      quantity: 1
    };

    // Case A: Missing pharmacy name in settings
    await createQuickBillForRefill(db, refillObj);
    const notifA = await db.get('SELECT * FROM automation_notifications WHERE reference_id = "50"');
    expect(notifA).toBeUndefined();

    // Case B: Placeholder "XYZ MEDICAL"
    await db.run("INSERT INTO app_settings (key, value) VALUES ('shop_name', 'XYZ MEDICAL')");
    await createQuickBillForRefill(db, refillObj);
    const notifB = await db.get('SELECT * FROM automation_notifications WHERE reference_id = "50"');
    expect(notifB).toBeUndefined();

    // Case C: Legitimate configured pharmacy name
    await db.run("UPDATE app_settings SET value = 'LIFELINE PHARMACY' WHERE key = 'shop_name'");
    await createQuickBillForRefill(db, refillObj);
    const notifC = await db.get('SELECT * FROM automation_notifications WHERE reference_id = "50"');
    expect(notifC).toBeDefined();
    expect(notifC.message).toContain('LIFELINE PHARMACY');
    expect(notifC.message).not.toContain('XYZ MEDICAL');

    await db.close();
  });
});
