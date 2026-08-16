import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve(true)),
  initClient: jest.fn(() => Promise.resolve(true)),
  currentQr: null,
  isReady: false,
  forceReconnect: jest.fn(),
  destroyClient: jest.fn(),
  shouldRouteToBusiness: jest.fn(() => Promise.resolve(false)),
  isPuppeteerDetachedError: jest.fn(() => false),
  hasSavedSession: jest.fn(() => false),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isReady: false, initializing: false }))
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

describe('Email Purchase Date Integrity Tests', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let emailServiceModule: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-date-integrity-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed test distributor
    await db.run(
      'INSERT INTO distributors (id, name, email) VALUES (1, "Apex Pharma Distributors", "orders@apexpharma.com")'
    );

    // 1. Seed Email with explicit historical invoice date in body/subject
    await db.run(`
      INSERT INTO emails (uid, from_addr, subject, body, date, is_seen, is_order, is_saved, distributor_name, has_attachments, extracted_invoice_no, extracted_distributor)
      VALUES (201, "orders@apexpharma.com", "Invoice APEX-2024-001 Date: 15/03/2024", "Invoice APEX-2024-001 dated 15/03/2024 for Paracetamol 500mg qty: 50", "2026-08-16T12:00:00Z", 0, 1, 0, "Apex Pharma Distributors", 0, "APEX-2024-001", "Apex Pharma Distributors")
    `);

    // 2. Seed Email with NO invoice date anywhere
    await db.run(`
      INSERT INTO emails (uid, from_addr, subject, body, date, is_seen, is_order, is_saved, distributor_name, has_attachments, extracted_invoice_no, extracted_distributor)
      VALUES (202, "orders@apexpharma.com", "Invoice APEX-NODATE-999", "Please find medicines for order qty: 20", "2026-08-16T12:00:00Z", 0, 1, 0, "Apex Pharma Distributors", 0, "APEX-NODATE-999", "Apex Pharma Distributors")
    `);

    // 3. Seed staged purchase with historical date (e.g. 2024-01-10)
    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (901, 'Apex Pharma Distributors', 'INV-HIST-901', '2024-01-10', 1000, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Dolo 650', batch_no: 'BATCH-HIST-1', expiry_date: '12/28', quantity: 20, cost_price: 25, mrp: 35 }
    ])]);

    // 4. Seed staged purchase with NULL/missing date
    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (902, 'Apex Pharma Distributors', 'INV-NODATE-902', NULL, 1000, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Amoxicillin 500', batch_no: 'BATCH-NODATE-1', expiry_date: '12/28', quantity: 10, cost_price: 50, mrp: 75 }
    ])]);

    await db.close();

    const { emailService } = await import('../src/services/emailService.js');
    emailServiceModule = emailService;

    const { default: purchasesRouter } = await import('../src/routes/purchases.js');

    app = express();
    app.use(express.json());
    app.use('/api/purchases', purchasesRouter);
  }, 30000);

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // Test 1: Correct invoice date extracted
  test('1. Correct invoice date extracted from invoice text without falling back to today', async () => {
    const res = await request(app).get('/api/purchases/reconciliation/preview/201');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.date).toBe('2024-03-15');
    // Ensure it did not use today's date or email arrival timestamp
    expect(res.body.date).not.toBe(new Date().toISOString().split('T')[0]);
  });

  // Test 2: Missing invoice date preserves empty/null and requires user input before approval
  test('2. Missing invoice date is preserved as empty string in preview and rejects approval without date', async () => {
    const previewRes = await request(app).get('/api/purchases/reconciliation/preview/202');
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.success).toBe(true);
    // Date must NOT default to today
    expect(previewRes.body.date).toBe('');

    // Attempting to approve staged purchase #902 (which has NULL date) without providing date must return 400
    const approveFail = await request(app)
      .post('/api/purchases/staged/902/approve')
      .send({
        distributor_name: 'Apex Pharma Distributors',
        invoice_no: 'INV-NODATE-902'
      });
    expect(approveFail.status).toBe(400);
    expect(approveFail.body.error).toMatch(/invoice date is required/i);
  });

  // Test 3: Old invoice imported today keeps the actual historical date rather than today's import date
  test('3. Old invoice staged keeps the actual historical date rather than import date', async () => {
    const approveSuccess = await request(app)
      .post('/api/purchases/staged/901/approve')
      .send({
        distributor_name: 'Apex Pharma Distributors',
        invoice_no: 'INV-HIST-901'
      });
    expect(approveSuccess.status).toBe(200);
    expect(approveSuccess.body.success).toBe(true);
    expect(approveSuccess.body.purchase_id).toBeDefined();

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const savedPurchase = await db.get('SELECT * FROM purchases WHERE id = ?', [approveSuccess.body.purchase_id]);
    expect(savedPurchase).toBeDefined();
    // Must keep original historical date: 2024-01-10
    expect(savedPurchase.date).toBe('2024-01-10');
    expect(savedPurchase.date).not.toBe(new Date().toISOString().split('T')[0]);

    await db.close();
  });

  // Test 4: Approval with user-verified date correctly sets and preserves the verified date
  test('4. Providing verified invoice date approves and saves with the exact verified date', async () => {
    const approveVerified = await request(app)
      .post('/api/purchases/staged/902/approve')
      .send({
        distributor_name: 'Apex Pharma Distributors',
        invoice_no: 'INV-VERIFIED-902',
        date: '2023-11-20'
      });
    expect(approveVerified.status).toBe(200);
    expect(approveVerified.body.success).toBe(true);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const savedPurchase = await db.get('SELECT * FROM purchases WHERE id = ?', [approveVerified.body.purchase_id]);
    expect(savedPurchase).toBeDefined();
    expect(savedPurchase.date).toBe('2023-11-20');

    await db.close();
  });
});
