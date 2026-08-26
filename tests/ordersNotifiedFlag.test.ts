import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Special Order Booking notified flag & status', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-flag-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    const { default: ordersRouter } = await import('../src/routes/orders.js');
    app = express();
    app.use(express.json());
    app.use('/api/orders', ordersRouter);
  });

  afterAll(async () => {
    try {
      const { dbManager } = await import('../src/database/connection.js');
      await dbManager.close(true);
    } catch {}
    delete process.env.DB_PATH;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('POST /api/orders with sendWhatsApp = true queues notification and sets notified = 0 and status = Pending', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        product: 'Paracetamol 500mg',
        requester: 'John Doe',
        phone: '9876543210',
        qty: 2,
        sendWhatsApp: true
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE product = ?', ['Paracetamol 500mg']);
    expect(order).toBeDefined();
    // notified flag tracks arrival notification (on Mark Ready), so starts at 0
    expect(order.notified).toBe(0);
    expect(order.notification_count).toBe(0);
    expect(order.status).toBe('Pending');

    const notif = await db.get('SELECT * FROM automation_notifications WHERE reference_id = ?', [String(order.id)]);
    expect(notif).toBeDefined();
    expect(notif.status).toBe('queued');
  });

  test('POST /api/orders with sendWhatsApp = false or omitted sets notified = 0 and status = Pending without queuing notification', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        product: 'Amoxicillin 250mg',
        requester: 'Jane Doe',
        phone: '9876543211',
        qty: 1,
        sendWhatsApp: false
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE product = ?', ['Amoxicillin 250mg']);
    expect(order).toBeDefined();
    expect(order.notified).toBe(0);
    expect(order.notification_count).toBe(0);
    expect(order.status).toBe('Pending');

    const notif = await db.get('SELECT * FROM automation_notifications WHERE reference_id = ?', [String(order.id)]);
    expect(notif).toBeUndefined();
  });

  test('POST /api/orders/batch with sendWhatsApp = true queues notifications and sets notified = 0 for all items', async () => {
    const res = await request(app)
      .post('/api/orders/batch')
      .send({
        requester: 'Alice Smith',
        phone: '9876543212',
        sendWhatsApp: true,
        items: [
          { product: 'Metformin 500mg', qty: 3 },
          { product: 'Atorvastatin 10mg', qty: 2 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const order1 = await db.get('SELECT * FROM special_orders WHERE product = ?', ['Metformin 500mg']);
    const order2 = await db.get('SELECT * FROM special_orders WHERE product = ?', ['Atorvastatin 10mg']);
    expect(order1.notified).toBe(0);
    expect(order1.notification_count).toBe(0);
    expect(order1.status).toBe('Pending');
    expect(order2.notified).toBe(0);
    expect(order2.notification_count).toBe(0);
    expect(order2.status).toBe('Pending');

    const notif1 = await db.get('SELECT * FROM automation_notifications WHERE reference_id = ?', [String(order1.id)]);
    expect(notif1).toBeDefined();
    expect(notif1.status).toBe('queued');
  });

  test('POST /api/orders/batch with sendWhatsApp = false sets notified = 0 for all items and status = Pending', async () => {
    const res = await request(app)
      .post('/api/orders/batch')
      .send({
        requester: 'Bob Smith',
        phone: '9876543213',
        sendWhatsApp: false,
        items: [
          { product: 'Cetirizine 10mg', qty: 1 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE product = ?', ['Cetirizine 10mg']);
    expect(order).toBeDefined();
    expect(order.notified).toBe(0);
    expect(order.notification_count).toBe(0);
    expect(order.status).toBe('Pending');
  });
});
