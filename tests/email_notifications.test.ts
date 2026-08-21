import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';

jest.setTimeout(20000);

// Mock whatsappClient so sendMessage resolves instantly without launching Puppeteer
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  sendMessage: jest.fn<any>().mockResolvedValue({ sent: true }),
}));

describe('Email Mail Arrival Notifications', () => {
  let tmpDir: string;
  let dbPath: string;
  let emailService: any;
  let dbManager: any;
  let ensureSchema: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-notif-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    const dbModule = await import('../src/database.js');
    const connModule = await import('../src/database/connection.js');
    const emailModule = await import('../src/services/emailService.js');

    ensureSchema = dbModule.ensureSchema;
    dbManager = connModule.dbManager;
    emailService = emailModule.emailService;

    await ensureSchema(dbPath);
  }, 20000);

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('notifyMailArrival logs with email_uid_ references and prevents duplicate WhatsApp sends', async () => {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('shop_phone', '9876543210')");

    const testEmail = {
      from: 'distributor@pharmacy.com',
      subject: 'Monthly Medicine Price List',
      body: 'Please find attached the latest price list for medicines.',
      attachments: [{ filename: 'pricelist.csv', content: Buffer.from('test'), contentType: 'text/csv' }]
    };

    const orderInfo = {
      distributorName: 'Unknown Distributor',
      invoiceNumber: 'N/A',
      timeStr: '12:00 PM',
      medicines: [],
      totalItems: 0,
      urgencyLevel: 'normal'
    };

    const emailUid = 88102;

    // First call: should send WhatsApp and log reference_id = 'email_uid_88102'
    await emailService.notifyMailArrival({
      uid: emailUid,
      processedEmail: testEmail,
      orderInfo,
      isOrder: false,
      parsedDate: new Date()
    });

    const notifCountBefore = await db.get(
      "SELECT COUNT(*) as cnt FROM automation_notifications WHERE (reference_id = 'email_uid_88102' OR reference_id LIKE 'email_uid_88102%') AND status = 'sent'"
    );
    expect(notifCountBefore.cnt).toBe(1);

    // Second call with same UID: should detect existing log and skip duplicate WhatsApp send
    await emailService.notifyMailArrival({
      uid: emailUid,
      processedEmail: testEmail,
      orderInfo,
      isOrder: false,
      parsedDate: new Date()
    });

    const notifCountAfter = await db.get(
      "SELECT COUNT(*) as cnt FROM automation_notifications WHERE (reference_id = 'email_uid_88102' OR reference_id LIKE 'email_uid_88102%') AND status = 'sent'"
    );
    // Count remains 1 — duplicate WhatsApp skipped!
    expect(notifCountAfter.cnt).toBe(1);
  });

  test('notifyMailArrival handles distributor order email notification with custom UID refId', async () => {
    const db = await dbManager.getConnection();

    const testEmail = {
      from: 'billing@prakashpharma.com',
      subject: 'Tax Invoice INV-2026-999',
      body: 'Invoice details attached.',
      attachments: [{ filename: 'inv-999.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }]
    };

    const orderInfo = {
      distributorName: 'PRAKASH PHARMACEUTICALS',
      invoiceNumber: 'INV-2026-999',
      timeStr: '02:30 PM',
      medicines: [{ name: 'Paracetamol 500mg', quantity: '10' }],
      totalItems: 10,
      urgencyLevel: 'normal'
    };

    const emailUid = 88103;

    await emailService.notifyMailArrival({
      uid: emailUid,
      processedEmail: testEmail,
      orderInfo,
      isOrder: true,
      parsedDate: new Date()
    });

    const notif = await db.get(
      "SELECT * FROM automation_notifications WHERE (reference_id = 'email_uid_88103' OR reference_id LIKE 'email_uid_88103%') ORDER BY id DESC LIMIT 1"
    );
    expect(notif).toBeDefined();
    expect(notif.status).toBe('sent');
  });

  test('notifyMailArrival respects notify_owner_on_email_whatsapp toggle setting when set to 0', async () => {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('notify_owner_on_email_whatsapp', '0')");

    const testEmail = {
      from: 'disabled_toggle@pharmacy.com',
      subject: 'Disabled Test Subject',
      body: 'Should not send WhatsApp.',
      attachments: []
    };

    const orderInfo = {
      distributorName: 'Test Vendor',
      invoiceNumber: 'INV-TOGGLE-OFF',
      timeStr: '04:00 PM',
      medicines: [],
      totalItems: 0,
      urgencyLevel: 'normal'
    };

    const emailUid = 99999;

    await emailService.notifyMailArrival({
      uid: emailUid,
      processedEmail: testEmail,
      orderInfo,
      isOrder: true,
      parsedDate: new Date()
    });

    const notif = await db.get(
      "SELECT * FROM automation_notifications WHERE reference_id = 'email_uid_99999'"
    );
    expect(notif).toBeUndefined();

    // Re-enable setting for subsequent tests
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('notify_owner_on_email_whatsapp', '1')");
  });
});
