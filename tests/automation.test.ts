import { jest } from '@jest/globals';

// Mock WhatsApp dependency BEFORE any other imports that might cause it to be loaded
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve(true)),
  initClient: jest.fn(() => Promise.resolve(true))
}));

import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

let mockSendMessage: any;

describe('Smart Auto Reminder & Communication Center APIs', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-test-'));
    dbPath = path.join(tmpDir, 'app.db');
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
        source_refill_id INTEGER DEFAULT NULL
      )
    `);
    await db.close();

    process.env.DB_PATH = dbPath;

    mockSendMessage = (await import('../src/whatsappClient.js')).sendMessage;

    // Load routers
    const { default: automationRouter } = await import('../src/routes/automation.js');
    const { default: refillsRouter } = await import('../src/routes/refills.js');

    app = express();
    app.use(express.json());
    app.use('/api/automation', automationRouter);
    app.use('/api/refills', refillsRouter);
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/automation/notifications starts empty', async () => {
    const res = await request(app).get('/api/automation/notifications');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  test('Log insertions and queries for communication center', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    
    // Insert a failed notification
    await db.run(`
      INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, ['refill_reminder', 'John Patient', '919999999999', 'Time for refill!', 'failed', 'Timeout error', '5']);
    
    await db.close();

    const res = await request(app).get('/api/automation/notifications');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].recipient_name).toBe('John Patient');
    expect(res.body[0].status).toBe('failed');
    expect(res.body[0].error_message).toBe('Timeout error');
  });

  test('POST /api/automation/notifications/:id/retry triggers resend and updates status to sent', async () => {
    const res = await request(app).post('/api/automation/notifications/1/retry');
    if (res.status !== 200) {
      console.log('RETRY FAIL BODY:', res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledWith('919999999999', undefined, 'Time for refill!');

    // Query DB to verify status is updated
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const notification = await db.get('SELECT * FROM automation_notifications WHERE id = 1');
    await db.close();

    expect(notification.status).toBe('sent');
    expect(notification.error_message).toBeNull();
  });

  test('POST /api/automation/notifications/:id/manual marks as sent_manually', async () => {
    // 1. Insert another failed notification
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run(`
      INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status)
      VALUES (?, ?, ?, ?, ?)
    `, ['delivery_boy', 'Rider Dave', '918888888888', 'Stock arrived', 'failed']);
    await db.close();

    // 2. Mark manually
    const res = await request(app).post('/api/automation/notifications/2/manual');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 3. Verify in DB
    const db2 = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const notification = await db2.get('SELECT * FROM automation_notifications WHERE id = 2');
    await db2.close();

    expect(notification.status).toBe('sent_manually');
  });

  test('PUT /api/refills/:id toggles is_active status', async () => {
    // 1. Seed database with medicine and refill schedule
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run('INSERT INTO medicines (id, name) VALUES (?, ?)', [99, 'Aspirin']);
    await db.run(`
      INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, refill_interval_days, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [10, 'Jane Doe', '917777777777', 99, 30, 1]);
    await db.close();

    // 2. Pause the schedule
    const resPause = await request(app)
      .put('/api/refills/10')
      .send({ is_active: false });

    expect(resPause.status).toBe(200);
    expect(resPause.body.success).toBe(true);

    // 3. Verify in DB
    const db2 = await open({ filename: dbPath, driver: sqlite3.default.Database });
    let refill = await db2.get('SELECT * FROM patient_refills WHERE id = 10');
    expect(refill.is_active).toBe(0);

    // 4. Resume the schedule
    const resResume = await request(app)
      .put('/api/refills/10')
      .send({ is_active: true });

    expect(resResume.status).toBe(200);
    expect(resResume.body.success).toBe(true);

    refill = await db2.get('SELECT * FROM patient_refills WHERE id = 10');
    await db2.close();
    expect(refill.is_active).toBe(1);
  });

  test('POST /api/refills/:id/send triggers instant notification and logs to automation center', async () => {
    const res = await request(app).post('/api/refills/10/send');
    if (res.status !== 200) {
      console.log('SEND REFILL FAIL BODY:', res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify WhatsApp was called
    expect(mockSendMessage).toHaveBeenCalledWith(
      '917777777777',
      undefined,
      expect.stringContaining('Jane Doe')
    );

    // Check DB for new log entry
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const log = await db.get('SELECT * FROM automation_notifications WHERE type = ? AND reference_id = ?', ['refill_reminder', '10']);
    const refill = await db.get('SELECT * FROM patient_refills WHERE id = 10');
    await db.close();

    expect(log).toBeDefined();
    expect(log.status).toBe('sent');
    expect(log.recipient_name).toBe('Jane Doe');
    expect(refill.status).toBe('notified');
  });
});
