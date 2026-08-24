import { jest } from '@jest/globals';

// Mock WhatsApp dependency BEFORE any other imports that might cause it to be loaded
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve(true)),
  initClient: jest.fn(() => Promise.resolve(true)),
  destroyClient: jest.fn(() => Promise.resolve()),
  reconnectClient: jest.fn(() => Promise.resolve()),
  forceReconnect: jest.fn(() => Promise.resolve()),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, isReady: true, status: 'CONNECTED' })),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : ''),
  shouldRouteToBusiness: jest.fn(() => false),
  hashMessageBody: jest.fn((b: string) => b.length),
  hasSavedSession: jest.fn(() => true),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  markWhatsAppActivity: jest.fn(),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([])),
  getMessageMedia: jest.fn(() => Promise.resolve({ mimetype: 'image/jpeg', data: '' })),
  currentQr: null,
  isReady: true,
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn()
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

let mockSendMessage: any;
let notificationService: any;
let dbManager: any;

describe('Distributor WhatsApp Notification Automation Tests', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-notif-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    mockSendMessage = (await import('../src/whatsappClient.js')).sendMessage;
    notificationService = (await import('../src/services/notificationService.js')).notificationService;
    dbManager = (await import('../src/database/connection.js')).dbManager;
  });

  afterAll(async () => {
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM distributors');
    await db.run('DELETE FROM purchases');
    await db.run('DELETE FROM purchase_items');
    await db.run('DELETE FROM delivery_boys');
    await db.run('DELETE FROM dispatch_orders');
    await db.run('DELETE FROM automation_notifications');
    await db.run('DELETE FROM action_logs');
    await db.run('DELETE FROM medicines');
  });

  test('Successful flow: Distributor receives notification with medicines and delivery boy', async () => {
    const db = await dbManager.getConnection();

    // 1. Insert distributor
    await db.run(
      "INSERT INTO distributors (id, name, phone) VALUES (?, ?, ?)",
      [1, "ABC Distributor", "9876543210, 9876543211"]
    );

    // 2. Insert delivery boy
    await db.run(
      "INSERT INTO delivery_boys (id, name, whatsapp_number, is_active) VALUES (?, ?, ?, ?)",
      [10, "Rahul Sharma", "9999999999, 8888888888", 1]
    );

    // 3. Insert purchase and purchase items
    await db.run(
      "INSERT INTO purchases (id, distributor_id, invoice_no, total_amount) VALUES (?, ?, ?, ?)",
      [100, 1, "BILL-10025", 500.0]
    );
    await db.run("INSERT INTO medicines (id, name) VALUES (?, ?)", [50, "Paracetamol 500mg"]);
    await db.run("INSERT INTO medicines (id, name) VALUES (?, ?)", [51, "Azithromycin 500mg"]);

    await db.run(
      "INSERT INTO purchase_items (purchase_id, medicine_id, quantity) VALUES (?, ?, ?)",
      [100, 50, 20]
    );
    await db.run(
      "INSERT INTO purchase_items (purchase_id, medicine_id, quantity) VALUES (?, ?, ?)",
      [100, 51, 10]
    );

    // 4. Insert dispatch order with delivery boy
    await db.run(
      "INSERT INTO dispatch_orders (patient_name, patient_phone, delivery_boy_id, invoice_no) VALUES (?, ?, ?, ?)",
      ["Patient John", "919999999999", 10, "BILL-10025"]
    );

    // 5. Trigger notification
    const res = await notificationService.notifyDistributorAboutDeliveryBoy("BILL-10025");
    expect(res).toBe(true);

    // 6. Verify notification was logged and prepared for both distributor numbers
    const notifs = await db.all("SELECT * FROM automation_notifications ORDER BY id ASC");
    expect(notifs.length).toBe(2);
    expect(notifs[0].recipient_phone).toBe("919876543210");
    expect(notifs[1].recipient_phone).toBe("919876543211");

    // Verify message content
    const sentMessage = notifs[0].message;
    expect(sentMessage).toContain("TODAY DISTRIBUTOR ORDER");
    expect(sentMessage).toContain("Medicines List:");
    expect(sentMessage).toContain("Paracetamol 500mg");
    expect(sentMessage).toContain("*20 Units*");
    expect(sentMessage).toContain("Azithromycin 500mg");
    expect(sentMessage).toContain("*10 Units*");
    expect(sentMessage).toContain("Rahul Sharma");
    expect(sentMessage).toContain("Delivery Boy / Pickup Person:");
  });

  test('Edge Case: Delivery boy not assigned yet falls back to Admin/Owner or DB active delivery boy', async () => {
    const db = await dbManager.getConnection();

    await db.run("INSERT INTO distributors (id, name, phone) VALUES (?, ?, ?)", [1, "ABC Distributor", "9876543210"]);
    await db.run("INSERT INTO app_settings (key, value) VALUES (?, ?)", ['owner_whatsapp_number', '9876543210']);
    await db.run("INSERT INTO purchases (id, distributor_id, invoice_no) VALUES (?, ?, ?)", [100, 1, "BILL-10025"]);
    await db.run("INSERT INTO medicines (id, name) VALUES (?, ?)", [50, "Paracetamol 500mg"]);
    await db.run("INSERT INTO purchase_items (purchase_id, medicine_id, quantity) VALUES (?, ?, ?)", [100, 50, 20]);
    await db.run("INSERT INTO dispatch_orders (patient_name, delivery_boy_id, invoice_no) VALUES (?, ?, ?)", ["Patient John", null, "BILL-10025"]);

    const res = await notificationService.notifyDistributorAboutDeliveryBoy("BILL-10025");
    expect(res).toBe(true);

    const notifs = await db.all("SELECT * FROM automation_notifications ORDER BY id ASC");
    expect(notifs.length).toBe(1);
    const sentMessage = notifs[0].message;
    expect(sentMessage).toContain("Admin / Store Owner");
    expect(sentMessage).toContain("+91 98765 43210");
  });

  test('Edge Case: Distributor has no WhatsApp number', async () => {
    const db = await dbManager.getConnection();

    await db.run("INSERT INTO distributors (id, name, phone) VALUES (?, ?, ?)", [1, "ABC Distributor", ""]);
    await db.run("INSERT INTO purchases (id, distributor_id, invoice_no) VALUES (?, ?, ?)", [100, 1, "BILL-10025"]);

    const res = await notificationService.notifyDistributorAboutDeliveryBoy("BILL-10025");
    expect(res).toBe(false);

    // Verify warning log exists
    const log = await db.get("SELECT * FROM action_logs WHERE action_type = 'DISTRIBUTOR_NOTIF_SKIP'");
    expect(log).toBeDefined();
    expect(log.description).toContain("has no WhatsApp number");
  });

  test('Edge Case: Empty medicine list', async () => {
    const db = await dbManager.getConnection();

    await db.run("INSERT INTO distributors (id, name, phone) VALUES (?, ?, ?)", [1, "ABC Distributor", "9876543210"]);
    await db.run("INSERT INTO purchases (id, distributor_id, invoice_no) VALUES (?, ?, ?)", [100, 1, "BILL-10025"]);

    const res = await notificationService.notifyDistributorAboutDeliveryBoy("BILL-10025");
    expect(res).toBe(true);

    const notifs = await db.all("SELECT * FROM automation_notifications ORDER BY id ASC");
    expect(notifs.length).toBe(1);
    const sentMessage = notifs[0].message;
    expect(sentMessage).toContain("Standard Pharmacy Order Items");
  });

  test('Edge Case: Duplicate phone numbers are de-duplicated', async () => {
    const db = await dbManager.getConnection();

    // Insert distributor with duplicate numbers
    await db.run(
      "INSERT INTO distributors (id, name, phone) VALUES (?, ?, ?)",
      [1, "ABC Distributor", "9876543210, 9876543210, 919876543210"]
    );
    await db.run("INSERT INTO purchases (id, distributor_id, invoice_no) VALUES (?, ?, ?)", [100, 1, "BILL-10025"]);

    const res = await notificationService.notifyDistributorAboutDeliveryBoy("BILL-10025");
    expect(res).toBe(true);

    // Should only send once because of de-duplication
    const notifs = await db.all("SELECT * FROM automation_notifications ORDER BY id ASC");
    expect(notifs.length).toBe(1);
    expect(notifs[0].recipient_phone).toBe("919876543210");
  });

  test('Edge Case: Multiple delivery boys assigned', async () => {
    const db = await dbManager.getConnection();

    await db.run("INSERT INTO distributors (id, name, phone) VALUES (?, ?, ?)", [1, "ABC Distributor", "9876543210"]);
    await db.run("INSERT INTO purchases (id, distributor_id, invoice_no) VALUES (?, ?, ?)", [100, 1, "BILL-10025"]);

    // Insert two delivery boys
    await db.run("INSERT INTO delivery_boys (id, name, whatsapp_number, is_active) VALUES (?, ?, ?, ?)", [10, "Rahul Sharma", "9999999999", 1]);
    await db.run("INSERT INTO delivery_boys (id, name, whatsapp_number, is_active) VALUES (?, ?, ?, ?)", [11, "Dave Rider", "8888888888", 1]);

    // Dispatch order with multiple delivery boys comma-separated
    await db.run("INSERT INTO dispatch_orders (patient_name, delivery_boy_id, invoice_no) VALUES (?, ?, ?)", ["Patient John", "10,11", "BILL-10025"]);

    const res = await notificationService.notifyDistributorAboutDeliveryBoy("BILL-10025");
    expect(res).toBe(true);

    const notifs = await db.all("SELECT * FROM automation_notifications ORDER BY id ASC");
    expect(notifs.length).toBe(1);
    const sentMessage = notifs[0].message;
    expect(sentMessage).toContain("Rahul Sharma");
  });
});
