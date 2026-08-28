import { jest } from '@jest/globals';

// Mock WhatsApp dependency BEFORE any other imports — src/routes/automation.ts imports
// sendMessage from whatsappClient.js at module load time, and that module would otherwise
// try to boot real Puppeteer/whatsapp-web.js during the test. Mirrors tests/automation.test.ts.
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve({ sent: true })),
  initClient: jest.fn(() => Promise.resolve(true)),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, isReady: true, sleeping: false, initializing: false, status: 'CONNECTED' })),
  shouldRouteToBusiness: jest.fn(() => false),
  hashMessageBody: jest.fn(() => 'mock-hash'),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : ''),
  hasSavedSession: jest.fn(() => true),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  markWhatsAppActivity: jest.fn(),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  isPuppeteerDetachedError: jest.fn(() => false),
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

import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import request from 'supertest';

process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-hub-summary-auth-'));

import { ensureSchema } from '../src/database.js';

describe('Automation hub summary endpoint', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: express.Express;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-hub-summary-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const automationRouter = (await import('../src/routes/automation.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/automation', automationRouter);

    ({ dbManager } = await import('../src/database/connection.js'));
  });

  afterAll(async () => {
    await dbManager.close(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /catalog returns every catalog entry with an enabled flag', async () => {
    const res = await request(app).get('/api/automation/catalog');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const entry of res.body) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.enabled).toBe('boolean');
    }
  });

  it('POST /catalog/:id/toggle persists the new state and GET /catalog reflects it', async () => {
    const catalogRes = await request(app).get('/api/automation/catalog');
    const target = catalogRes.body[0];

    const toggleRes = await request(app)
      .post(`/api/automation/catalog/${target.id}/toggle`)
      .send({ enabled: false });
    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.success).toBe(true);

    const afterRes = await request(app).get('/api/automation/catalog');
    const afterTarget = afterRes.body.find((e: any) => e.id === target.id);
    expect(afterTarget.enabled).toBe(false);
  });

  it('GET /hub-summary returns headline "idle" when there is no recent activity', async () => {
    const res = await request(app).get('/api/automation/hub-summary');
    expect(res.status).toBe(200);
    expect(res.body.headline).toBe('idle');
    expect(Array.isArray(res.body.activity)).toBe(true);
  });

  it('GET /hub-summary returns headline "sending" when a queue item is pending', async () => {
    const db = await dbManager.getConnection();
    await db.run(
      "INSERT INTO whatsapp_send_queue (number, message, type, status, target_name) VALUES ('919999999999', 'test', 'credit_reminder', 'pending', 'Test Customer')"
    );
    const res = await request(app).get('/api/automation/hub-summary');
    expect(res.body.headline).toBe('sending');
  });

  it('GET /hub-summary returns headline "failed" and unresolvedFailuresCount > 0 when item failed', async () => {
    const db = await dbManager.getConnection();
    await db.run("DELETE FROM whatsapp_send_queue");
    await db.run(
      "INSERT INTO whatsapp_send_queue (number, message, type, status, target_name, error_message, acknowledged) VALUES ('919999999999', 'test', 'credit_reminder', 'failed_perm', 'Test Customer', 'Invalid phone number', 0)"
    );
    const res = await request(app).get('/api/automation/hub-summary');
    expect(res.body.headline).toBe('failed');
    expect(res.body.unresolvedFailuresCount).toBe(1);
    expect(res.body.activity.length).toBeGreaterThan(0);
    expect(res.body.activity[0].errorMessage).toBe('Invalid phone number');
  });

  it('POST /resolve-failure marks failed items as resolved', async () => {
    const resolveRes = await request(app)
      .post('/api/automation/resolve-failure')
      .send({ resolveAll: true });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.success).toBe(true);

    const summaryRes = await request(app).get('/api/automation/hub-summary');
    expect(summaryRes.body.unresolvedFailuresCount).toBe(0);
    expect(summaryRes.body.headline).toBe('idle');
  });
});
