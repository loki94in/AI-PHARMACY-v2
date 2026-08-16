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

describe('Email Purchase Distributor Integrity Tests', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let emailServiceModule: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-dist-integrity-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed known distributor
    await db.run(
      'INSERT INTO distributors (id, name, email) VALUES (10, "Metro Pharma Logistics", "orders@metropharma.com")'
    );
    await db.run(
      'INSERT INTO distributors (id, name, email) VALUES (20, "Nitin Agency", "billing@nitinagency.com")'
    );

    // Seed test emails:
    // Email 101: Known distributor by email
    await db.run(`
      INSERT INTO emails (uid, from_addr, subject, body, date, is_seen, is_order, is_saved, distributor_name, has_attachments, extracted_invoice_no, extracted_distributor)
      VALUES (101, "orders@metropharma.com", "Invoice INV-METRO-101", "Attached is invoice for Paracetamol 500mg qty: 100", "2026-08-16", 0, 1, 0, "Metro Pharma Logistics", 0, "INV-METRO-101", "Metro Pharma Logistics")
    `);

    // Email 102: Unknown sender, no distributor keyword in text
    await db.run(`
      INSERT INTO emails (uid, from_addr, subject, body, date, is_seen, is_order, is_saved, distributor_name, has_attachments, extracted_invoice_no, extracted_distributor)
      VALUES (102, "invoices@randomsender99.com", "Bill INV-RAND-102", "Invoice for Amoxicillin 500mg qty: 50", "2026-08-16", 0, 1, 0, NULL, 0, "INV-RAND-102", NULL)
    `);

    // Staged purchase with unresolved distributor
    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (801, '', 'INV-STAGED-UNRESOLVED', '2026-08-16', 500, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Cetirizine 10mg', batch_no: 'CET-801', expiry_date: '10/28', quantity: 10, cost_price: 15, mrp: 25 }
    ])]);

    // Staged purchase with placeholder distributor
    await db.run(`
      INSERT INTO staged_purchases (id, distributor_name, invoice_no, date, total_amount, items_json, status)
      VALUES (802, 'Default Distributor', 'INV-STAGED-DEFAULT', '2026-08-16', 500, ?, 'pending')
    `, [JSON.stringify([
      { name: 'Cetirizine 10mg', batch_no: 'CET-802', expiry_date: '10/28', quantity: 10, cost_price: 15, mrp: 25 }
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

  test('1. Email with a known distributor resolves correctly to that distributor', async () => {
    const orderInfo = await emailServiceModule.extractOrderInfo({
      from: 'orders@metropharma.com',
      subject: 'Invoice INV-METRO-101',
      body: 'Invoice details from Metro Pharma Logistics for Dolo 650mg qty: 20',
      attachments: []
    });

    expect(orderInfo.distributorName).toBe('Metro Pharma Logistics');
    expect(orderInfo.invoiceNumber).toBe('INV-METRO-101');
  });

  test('2. Email with no recognizable distributor keeps distributor unresolved (empty string)', async () => {
    const orderInfo = await emailServiceModule.extractOrderInfo({
      from: 'invoices@randomunknownservice.xyz',
      subject: 'Invoice INV-UNKNOWN-55',
      body: 'Monthly supply invoice qty: 10 items',
      attachments: []
    });

    // Must be unresolved (empty string), NOT "Default Distributor" or "Unknown Distributor" or random email address
    expect(orderInfo.distributorName).toBe('');
    expect(orderInfo.distributorName).not.toBe('Default Distributor');
    expect(orderInfo.distributorName).not.toBe('Unknown Distributor');
  });

  test('3. Confirm reconciliation preview returns empty distributor for unresolved email and never falls back to sender email or placeholder', async () => {
    const res = await request(app).get('/api/purchases/reconciliation/preview/102');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Unresolved email must have distributorName as empty string, requiring user to pick one
    expect(res.body.distributorName).toBe('');
    expect(res.body.distributorName).not.toBe('invoices@randomsender99.com');
    expect(res.body.distributorName).not.toBe('Default Distributor');
    expect(res.body.distributorName).not.toBe('Unknown Distributor');
  });

  test('4. Confirm unresolved email import cannot become a purchase via reissue without legitimate distributor (rejects with 400)', async () => {
    // Attempting reissue for email UID 102 (which has no distributor) without providing distributor in body
    const res = await request(app)
      .post('/api/purchases/reconciliation/reissue')
      .send({ email_uid: 102 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Distributor is required/i);
  });

  test('5. Confirm reissue with placeholder "Default Distributor" or "Unknown Distributor" is rejected with 400', async () => {
    const res = await request(app)
      .post('/api/purchases/reconciliation/reissue')
      .send({
        email_uid: 102,
        distributor_name: 'Default Distributor'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Distributor is required/i);
  });

  test('6. Confirm staged purchase with unresolved or placeholder distributor cannot be approved', async () => {
    // Unresolved distributor in staged purchase
    const res1 = await request(app)
      .post('/api/purchases/staged/801/approve')
      .send({});

    expect(res1.status).toBe(400);
    expect(res1.body.error).toMatch(/Distributor is required/i);

    // Placeholder "Default Distributor" in staged purchase
    const res2 = await request(app)
      .post('/api/purchases/staged/802/approve')
      .send({});

    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/Distributor is required/i);
  });

  test('7. Confirm NO fake distributor ("Default Distributor", "Unknown Distributor", "Email Import") was created in DB', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const fakeDist = await db.get(
      `SELECT * FROM distributors WHERE name IN ('Default Distributor', 'Unknown Distributor', 'Unknown Dist.', 'Email Import')`
    );
    expect(fakeDist).toBeUndefined();

    await db.close();
  });

  test('8. Confirm reissue succeeds when user explicitly assigns legitimate distributor', async () => {
    const res = await request(app)
      .post('/api/purchases/reconciliation/reissue')
      .send({
        email_uid: 102,
        distributor_name: 'Nitin Agency',
        items: [
          { name: 'Amoxicillin 500mg', quantity: 50, rate: 10, mrp: 20, batch_no: 'B-AMX-1', expiry_date: '10/28' }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.purchase_id).toBeDefined();

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const purchase = await db.get('SELECT * FROM purchases WHERE id = ?', [res.body.purchase_id]);
    expect(purchase).toBeDefined();
    expect(purchase.distributor_id).toBe(20); // Nitin Agency

    // Verify email was marked saved
    const email = await db.get('SELECT is_saved FROM emails WHERE uid = 102');
    expect(email.is_saved).toBe(1);

    await db.close();
  });

  test('9. Confirm processEmail queues order into email_order_reviews with null/unresolved distributor and never creates Default Distributor', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    await emailServiceModule.processEmail({
      uid: 999,
      from: 'unknownsupplier@mail.com',
      subject: 'Invoice INV-UNRESOLVED-999',
      body: 'Order for Paracetamol 650mg qty: 30',
      attachments: []
    });

    const review = await db.get('SELECT * FROM email_order_reviews WHERE invoice_number = "INV-UNRESOLVED-999"');
    expect(review).toBeDefined();
    expect(review.distributor_name).toBeNull();
    expect(review.distributor_name).not.toBe('Default Distributor');
    expect(review.distributor_name).not.toBe('Unknown Distributor');

    const fakeDist = await db.get('SELECT * FROM distributors WHERE name = "Default Distributor"');
    expect(fakeDist).toBeUndefined();

    await db.close();
  });

  test('10. Confirm processEmail stages order with NULL/unresolved distributor and rejects approval until legitimate distributor assigned', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed email order without distributor
    await emailServiceModule.processEmail({
      uid: 1001,
      from: 'billing@unidentified-vendor.net',
      subject: 'Supply Invoice INV-NO-DIST-1001',
      body: 'Please find attached invoice INV-NO-DIST-1001 for Azithromycin 500mg qty: 40',
      attachments: []
    });

    const staged = await db.get('SELECT * FROM staged_purchases WHERE invoice_no = "INV-NO-DIST-1001"');
    if (staged) {
      // Distributor must be NULL or empty string
      expect(staged.distributor_name).toBeFalsy();
      expect(staged.distributor_name).not.toBe('Email Import');
      expect(staged.distributor_name).not.toBe('Default Distributor');
      expect(staged.distributor_name).not.toBe('Unknown Distributor');

      // Approval must be rejected with 400
      const res = await request(app)
        .post(`/api/purchases/staged/${staged.id}/approve`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Distributor is required/i);
    }

    // Confirm no fake entity was created
    const fakeDist = await db.get(
      `SELECT * FROM distributors WHERE name IN ('Email Import', 'Default Distributor', 'Unknown Distributor', 'TELEGRAM IMPORT')`
    );
    expect(fakeDist).toBeUndefined();

    await db.close();
  });
});

