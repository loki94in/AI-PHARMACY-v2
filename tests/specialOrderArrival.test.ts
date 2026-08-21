import { jest } from '@jest/globals';

const mockEnqueue = jest.fn((_phone: string, _msg: string, _type: string, _name: string) => Promise.resolve(true));

jest.unstable_mockModule('../src/services/whatsappQueueWorker.js', () => ({
  __esModule: true,
  whatsappQueueWorker: {
    enqueue: (...args: any[]) => mockEnqueue(...(args as [string, string, string, string])),
    forceNext: jest.fn(() => Promise.resolve(true))
  }
}));

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve({ sent: true })),
  initClient: jest.fn(() => Promise.resolve(true)),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, status: 'CONNECTED' })),
  shouldRouteToBusiness: jest.fn(() => false),
  hashMessageBody: jest.fn(() => 'mock-hash'),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : ''),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false))
}));

import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { scoreOrderNameMatch, ARRIVAL_MATCH_THRESHOLD } from '../src/utils/orderNameMatcher.js';

describe('Special Order Arrival Matcher (scorer)', () => {
  test('exact normalized names score full title weight as exact_name', () => {
    const r = scoreOrderNameMatch('Dolo 650 Tab', 'dolo 650 tab');
    expect(r.score).toBe(75);
    expect(r.matchType).toBe('exact_name');
    expect(r.confidence).toBe(0.75);
  });

  test('packaging/format variants reach High tier as fuzzy_name', () => {
    const variants: Array<[string, string]> = [
      ['Dolo-650 Tab', 'Dolo 650 Tablet'],
      ['Shelcal 500 Tab', 'Shelcal-500 Tablet'],
      ['Pan 40 Tab', 'PAN 40MG TABLET'],
      ['Thyronorm 100 ML Bottle', 'Thyronorm 100ml']
    ];
    for (const [a, b] of variants) {
      const r = scoreOrderNameMatch(a, b);
      expect(r.score).toBeGreaterThanOrEqual(ARRIVAL_MATCH_THRESHOLD);
      expect(r.matchType).toBe('fuzzy_name');
    }
  });

  test('different medicines and strength-variant siblings stay below threshold', () => {
    expect(scoreOrderNameMatch('Dolo 650 Tab', 'Azithral 500 Tablet').score).toBeLessThan(ARRIVAL_MATCH_THRESHOLD);
    expect(scoreOrderNameMatch('Dolo 650 Tab', 'Dolo 650 Plus Tablet').score).toBeLessThan(ARRIVAL_MATCH_THRESHOLD);
    expect(scoreOrderNameMatch('', 'Anything').score).toBe(0);
  });

  test('distributor and MRP context add confidence points', () => {
    const base = scoreOrderNameMatch('Nurokind Plus Cap', 'Nurokind Plus Capsule');
    const boosted = scoreOrderNameMatch('Nurokind Plus Cap', 'Nurokind Plus Capsule', {
      incomingDistributor: 'Apollo Distributors',
      orderDistributor: 'apollo dist',
      incomingMrp: 150,
      orderMrp: 150.5
    });
    expect(boosted.score).toBeGreaterThan(base.score);
  });
});

describe('Special Order arrival flow (Mark Ready WhatsApp + scoped matching)', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-arrival-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    db = await open({ filename: dbPath, driver: sqlite3.default.Database });
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('store_name', 'Apollo Pharmacy')");
    await db.close();

    const { default: ordersRouter } = await import('../src/routes/orders.js');
    app = express();
    app.use(express.json());
    app.use('/api/orders', ordersRouter);

    const { dbManager } = await import('../src/database/connection.js');
    db = await dbManager.getConnection();
  });

  afterAll(async () => {
    try {
      const { dbManager } = await import('../src/database/connection.js');
      await dbManager.close(true);
    } catch {}
    delete process.env.DB_PATH;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(() => { mockEnqueue.mockClear(); });

  async function seedOrder(product: string, phone: string | null, status = 'Ordered') {
    const res = await db.run(
      `INSERT INTO special_orders (product, requester, phone, qty, priority, status, date, notified)
       VALUES (?, ?, ?, 1, 'Normal', ?, datetime('now'), 0)`,
      [product, 'Test Customer', phone, status]
    );
    return res.lastID as number;
  }

  test('Mark Ready queues arrival WhatsApp exactly once (idempotent)', async () => {
    const id = await seedOrder('Dolo 650 Tablet', '9876500011');

    const first = await request(app).post(`/api/orders/${id}/status`).send({ status: 'Ready' });
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);
    expect(first.body.whatsapp_queued).toBe(true);

    let order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    expect(order.status).toBe('Ready');
    expect(order.notified).toBe(1);

    const waRow = await db.get(
      `SELECT * FROM automation_notifications WHERE reference_id = ? AND type = 'special_order_arrived'`,
      String(id)
    );
    expect(waRow).toBeDefined();
    expect(waRow.status).toBe('queued');
    expect(mockEnqueue).toHaveBeenCalledTimes(1);

    // Second Mark Ready click must NOT resend
    const second = await request(app).post(`/api/orders/${id}/status`).send({ status: 'Ready' });
    expect(second.status).toBe(200);
    expect(second.body.whatsapp_queued).toBe(false);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  test('Mark Ready skips messaging cleanly when no phone is stored', async () => {
    const id = await seedOrder('Azithral 500 Tablet', null);

    const res = await request(app).post(`/api/orders/${id}/status`).send({ status: 'Ready' });
    expect(res.status).toBe(200);
    expect(res.body.whatsapp_queued).toBe(false);

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    expect(order.status).toBe('Ready');
    expect(mockEnqueue).not.toHaveBeenCalled();

    const waRow = await db.get(
      `SELECT * FROM automation_notifications WHERE reference_id = ? AND type = 'special_order_arrived'`,
      String(id)
    );
    expect(waRow).toBeUndefined();
  });

  test('Completed maps to Fulfilled without any patient message', async () => {
    const id = await seedOrder('Cetirizine 10mg Tab', '9876500022', 'Pending');

    const res = await request(app).post(`/api/orders/${id}/status`).send({ status: 'Completed' });
    expect(res.status).toBe(200);
    expect(res.body.whatsapp_queued).toBe(false);
    expect(mockEnqueue).not.toHaveBeenCalled();

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    expect(order.status).toBe('Fulfilled');
    expect(order.notified).toBe(1);
  });

  test('detectOverlap matches active order variants but never old/fulfilled orders', async () => {
    const { overlapDetectionService } = await import('../src/services/overlapDetectionService.js');

    const activeId = await seedOrder('Thyronorm 100ml', '9876500033', 'Pending');

    await db.run(
      `INSERT INTO special_orders (product, requester, phone, qty, priority, status, date, notified)
       VALUES ('Old Med 5mg Tab', 'Old Customer', '9876500044', 1, 'Normal', 'Fulfilled', datetime('now', '-30 days'), 1)`
    );

    // Variant name hits the active order (fuzzy tier)
    const matches = await overlapDetectionService.detectOverlap({ medicineName: 'Thyronorm 100 ML Bottle' });
    const activeMatch = matches.find((m: any) => m.specialOrderId === activeId);
    expect(activeMatch).toBeDefined();
    expect(activeMatch!.matchConfidence).toBeGreaterThanOrEqual(ARRIVAL_MATCH_THRESHOLD / 100);

    const activeOrder = await db.get('SELECT * FROM special_orders WHERE id = ?', activeId);
    expect(activeOrder.status).toBe('Ready');
    expect(activeOrder.lifecycle_status).toBe('ARRIVED');
    expect(activeOrder.notified).toBe(0); // staged only; user still clicks to notify

    const overlapRow = await db.get(`SELECT * FROM order_overlaps WHERE special_order_id = ?`, activeId);
    expect(overlapRow).toBeDefined();
    expect(['exact_name', 'fuzzy_name']).toContain(overlapRow.match_type);

    // Same stock name must never revive the old Fulfilled order
    const oldMatches = await overlapDetectionService.detectOverlap({ medicineName: 'Old Med 5mg Tablet' });
    const revived = await db.all(`SELECT * FROM special_orders WHERE product = 'Old Med 5mg Tab' AND status != 'Fulfilled'`);
    expect(oldMatches.length).toBe(0);
    expect(revived.length).toBe(0);
  });

  test('reconcileIncomingInventory marks matching active order Ready with notified = 0', async () => {
    const { orderFulfillmentService } = await import('../src/services/orderFulfillmentService.js');
    const id = await seedOrder('Shelcal 500 Tab', '9876500055', 'Ordered');

    await orderFulfillmentService.reconcileIncomingInventory(db, 'Shelcal-500 Tablet');

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    expect(order.status).toBe('Ready');
    expect(order.notified).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled(); // arrival detection NEVER messages patients

    // Unrelated stock must not touch the order
    await db.run(`UPDATE special_orders SET status = 'Ordered' WHERE id = ?`, id);
    await orderFulfillmentService.reconcileIncomingInventory(db, 'Completely Different Medicine');
    const untouched = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    expect(untouched.status).toBe('Ordered');
  });
});
