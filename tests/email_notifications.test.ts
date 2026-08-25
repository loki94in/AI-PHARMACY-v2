import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';

jest.setTimeout(20000);

// Mock whatsappClient so sendMessage resolves instantly without launching Puppeteer
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  sendMessage: jest.fn<any>().mockResolvedValue({ sent: true }),
  waitForWhatsAppReady: jest.fn<any>().mockResolvedValue(true),
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

  test('extractOrderInfo carries the REAL mail timestamp (not sync time)', async () => {
    // Mail arrived 7 AM IST, synced whenever — timeStr must reflect the mail's own date
    const mailArrival = new Date('2026-08-20T07:10:00+05:30');
    const orderInfo = await emailService.extractOrderInfo({
      from: 'Fresh Distributors <fresh@example.com>',
      subject: 'Tax Invoice INV-77',
      body: 'Invoice attached.',
      date: mailArrival,
      attachments: []
    });
    expect(orderInfo.timeStr).toMatch(/07:10/);
    expect(orderInfo.emailDate).toBeDefined();

    // Legacy callers without any date degrade gracefully instead of crashing
    const legacy = await emailService.extractOrderInfo({
      from: 'x@y.com',
      subject: 'Hi',
      body: '',
      attachments: []
    });
    expect(legacy.emailDate).toBeUndefined();
  });

  test('extractOrderInfo finds billing amount inside text attachments', async () => {
    const orderInfo = await emailService.extractOrderInfo({
      from: 'billing@prakashpharma.com',
      subject: 'Tax Invoice INV-2026-999',
      body: 'Please find the invoice attached.',
      attachments: [{
        filename: 'inv-999.csv',
        content: Buffer.from('Item,Qty,Rate\nParacetamol,10,15\nGrand Total,1500.00\n'),
        contentType: 'text/csv'
      }]
    });
    expect(orderInfo.billAmount).toBe('₹1,500.00');
  });

  test('order WhatsApp alert prints Bill Amount: N/A when undetectable', async () => {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('shop_phone', '9876543210')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('notify_owner_on_email_whatsapp', '1')");

    await emailService.notifyMailArrival({
      uid: 88500,
      processedEmail: {
        from: 'billing@noamount.com',
        subject: 'Tax Invoice NA-1',
        body: 'No totals mentioned anywhere.',
        attachments: []
      },
      orderInfo: {
        distributorName: 'Amount Unknown Pharma',
        invoiceNumber: 'NA-1',
        timeStr: '10:00 AM',
        medicines: [],
        totalItems: 0,
        urgencyLevel: 'normal'
      },
      isOrder: true,
      parsedDate: new Date()
    });

    const notif = await db.get(
      "SELECT * FROM automation_notifications WHERE reference_id LIKE 'email_uid_88500%' AND status = 'sent'"
    );
    expect(notif).toBeDefined();
    expect(notif.message).toContain('Bill Amount: N/A');
  });

  test('dirty-format saved mail IDs resolve, and display-name matches learn back the mail ID', async () => {
    const db = await dbManager.getConnection();
    await db.run("DELETE FROM distributors WHERE name IN ('Dirty Email Dist', 'Learn Back Pharma')");
    const ins = await db.run(
      "INSERT INTO distributors (name, email) VALUES ('Dirty Email Dist', '\"Dirty Email Dist\" <dirty@distmail.com>, old@distmail.com')"
    );

    // Priority 1: stored display-formatted / multi-address entry still resolves by clean compare
    const resolved = await emailService.extractOrderInfo({
      from: 'Dirty Email Dist Accounts <DIRTY@DistMail.com>',
      subject: 'Bill',
      body: '',
      attachments: []
    });
    expect(resolved.distributorName).toBe('Dirty Email Dist');

    // Learn-back: display-name match saves the sender mail ID onto the profile
    await db.run("INSERT INTO distributors (name, email) VALUES ('Learn Back Pharma', NULL)");
    const learned = await emailService.extractOrderInfo({
      from: 'Learn Back Pharma <lbp@learnpharma.com>',
      subject: 'Bill',
      body: '',
      attachments: []
    });
    expect(learned.distributorName).toBe('Learn Back Pharma');
    const lbpRow = await db.get("SELECT email FROM distributors WHERE name = 'Learn Back Pharma'");
    expect(lbpRow.email).toContain('lbp@learnpharma.com');

    // Second distinct address appends; re-processing never duplicates
    await emailService.extractOrderInfo({
      from: '"Learn Back Pharma" <accounts@learnpharma.com>',
      subject: 'Bill',
      body: '',
      attachments: []
    });
    await emailService.extractOrderInfo({
      from: 'Learn Back Pharma <lbp@learnpharma.com>',
      subject: 'Bill',
      body: '',
      attachments: []
    });
    const mergedRow = await db.get("SELECT email FROM distributors WHERE name = 'Learn Back Pharma'");
    expect(mergedRow.email).toContain('accounts@learnpharma.com');
    expect(mergedRow.email.split(/[,;]/).length).toBe(2);

    await db.run('DELETE FROM distributors WHERE id = ?', [ins.lastID]);
    await db.run("DELETE FROM distributors WHERE name IN ('Dirty Email Dist', 'Learn Back Pharma')");
  });
});
