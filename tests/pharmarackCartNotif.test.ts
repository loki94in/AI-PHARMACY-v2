import { jest } from '@jest/globals';

// Mock WhatsApp dependency BEFORE importing any internal modules
const mockSendMessage = jest.fn((..._args: any[]) => Promise.resolve(true));
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: mockSendMessage,
  initClient: jest.fn(() => Promise.resolve(true))
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ensureSchema } from '../src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbManager: any;
let notificationService: any;

describe('Pharmarack Cart Notifications Tests', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-notif-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    process.env.DB_PATH = dbPath;

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
    await db.run('DELETE FROM delivery_boys');
    await db.run('DELETE FROM automation_notifications');
    await db.run('DELETE FROM pharmarack_cart_snapshots');
  });

  test('notifyAboutCartOrder successfully routes messages to distributor and delivery boy', async () => {
    const db = await dbManager.getConnection();

    // 1. Setup distributor
    await db.run(
      "INSERT INTO distributors (name, phone) VALUES (?, ?)",
      ["Test Dist", "9876543210"]
    );

    // 2. Setup active delivery boy
    await db.run(
      "INSERT INTO delivery_boys (name, whatsapp_number, is_active) VALUES (?, ?, ?)",
      ["Delivery Boy John", "8888888888", 1]
    );

    const items = [
      { productName: "Aspirin", qty: 2 },
      { productName: "Ibuprofen", qty: 5 }
    ];

    const deliveryPersons = [
      { name: "Delivery Boy John", code: "DBJ01" }
    ];

    const result = await notificationService.notifyAboutCartOrder("Test Dist", 123, deliveryPersons, items);
    expect(result).toBe(true);

    // We expect two messages to be sent:
    // 1. To the distributor ("919876543210")
    // 2. To the delivery boy ("918888888888")
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    
    // Check that phone numbers are parsed and formatted with 91 prefix
    expect(mockSendMessage).toHaveBeenCalledWith("919876543210", undefined, expect.any(String));
    expect(mockSendMessage).toHaveBeenCalledWith("918888888888", undefined, expect.any(String));

    // Verify messages content
    const msg = mockSendMessage.mock.calls[0][2];
    expect(msg).toContain("Order Finalized (Pharmarack Cart)");
    expect(msg).toContain("Aspirin × 2");
    expect(msg).toContain("Ibuprofen × 5");
    expect(msg).toContain("Delivery Boy John");
    expect(msg).toContain("Mobile: 918888888888");
  });
});
