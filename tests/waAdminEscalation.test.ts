import { jest } from '@jest/globals';

// 1. Mock the WhatsApp Client sendMessage method BEFORE importing internal code
const mockSendMessage = jest.fn(() => Promise.resolve());

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: mockSendMessage
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('WhatsApp Admin Auto-Escalation Service Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let waAdminEscalationService: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-admin-esc-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    // Dynamically import the service under test
    waAdminEscalationService = (await import('../src/services/waAdminEscalationService.js')).waAdminEscalationService;
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM app_settings');
    await db.run('DELETE FROM wa_admin_escalations');
    await db.run('DELETE FROM staged_medicine_reviews');
    await db.run('DELETE FROM medicines');
    
    // Seed default settings needed for escalation
    await db.run("INSERT INTO app_settings (key, value) VALUES ('wa_auto_share_admin', 'true')");
    await db.run("INSERT INTO app_settings (key, value) VALUES ('admin_whatsapp', '919876543210')");
  });

  test('found_local outcome sends Type-1 message and saves to wa_admin_escalations', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    await waAdminEscalationService.maybeEscalate({
      customer: { id: 1, name: 'Alice Test', phone: '919000000001@c.us' },
      isNewCustomer: false,
      medicineName: 'Paracetamol 650mg',
      quantity: 2,
      unit: 'strips',
      localMatches: ['Paracetamol 650mg'],
      catalogResults: null,
      confidence: 98,
      isRepeat: false,
      source: 'text',
      messageBody: 'need paracetamol 650mg',
      msgId: 'msg-abc-123',
      phone: '919000000001@c.us'
    });

    // Check mock called
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][0]).toBe('919876543210');
    expect(mockSendMessage.mock.calls[0][2]).toContain('🔔 *Prescription Medicine Extracted*');
    expect(mockSendMessage.mock.calls[0][2]).toContain('Alice Test');
    expect(mockSendMessage.mock.calls[0][2]).toContain('Paracetamol 650mg');

    // Check DB record
    const row = await db.get('SELECT * FROM wa_admin_escalations WHERE msg_id = ?', ['msg-abc-123']);
    expect(row).toBeDefined();
    expect(row.outcome).toBe('found_local');
    expect(row.status).toBe('sent');
  });

  test('does not send duplicates on same msgId and medicine key', async () => {
    await waAdminEscalationService.maybeEscalate({
      customer: { id: 1, name: 'Alice Test', phone: '919000000001@c.us' },
      isNewCustomer: false,
      medicineName: 'Paracetamol 650mg',
      quantity: 2,
      unit: 'strips',
      localMatches: ['Paracetamol 650mg'],
      catalogResults: null,
      confidence: 98,
      isRepeat: false,
      source: 'text',
      messageBody: 'need paracetamol 650mg',
      msgId: 'msg-abc-123',
      phone: '919000000001@c.us'
    });

    // Try same escalation again
    await waAdminEscalationService.maybeEscalate({
      customer: { id: 1, name: 'Alice Test', phone: '919000000001@c.us' },
      isNewCustomer: false,
      medicineName: 'paracetamol 650mg ', // slightly different casing/spacing
      quantity: 2,
      unit: 'strips',
      localMatches: ['Paracetamol 650mg'],
      catalogResults: null,
      confidence: 98,
      isRepeat: false,
      source: 'text',
      messageBody: 'need paracetamol 650mg',
      msgId: 'msg-abc-123',
      phone: '919000000001@c.us'
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1); // Only first went through
  });

  test('rate-limits customer repeat query for same medicine key within 24 hours', async () => {
    // First message
    await waAdminEscalationService.maybeEscalate({
      customer: { id: 1, name: 'Alice Test', phone: '919000000001@c.us' },
      isNewCustomer: false,
      medicineName: 'Dolo 650',
      quantity: 1,
      unit: 'strip',
      localMatches: ['Dolo 650'],
      catalogResults: null,
      confidence: 99,
      isRepeat: false,
      source: 'text',
      messageBody: 'dolo 650 please',
      msgId: 'msg-1',
      phone: '919000000001@c.us'
    });

    // Second message from same phone, different msgId, within 24 hours
    await waAdminEscalationService.maybeEscalate({
      customer: { id: 1, name: 'Alice Test', phone: '919000000001@c.us' },
      isNewCustomer: false,
      medicineName: 'dolo 650',
      quantity: 1,
      unit: 'strip',
      localMatches: ['Dolo 650'],
      catalogResults: null,
      confidence: 99,
      isRepeat: false,
      source: 'text',
      messageBody: 'send dolo 650',
      msgId: 'msg-2',
      phone: '919000000001@c.us'
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1); // Muted by rate limiter
  });

  test('pharmarack outcome sends Type-2 message and inserts staged review review_id', async () => {
    const { dbManager } = await import('../src/database.js'); // Use src/database to find types or connection
    const { dbManager: dbConn } = await import('../src/database/connection.js');
    const db = await dbConn.getConnection();

    await waAdminEscalationService.maybeEscalate({
      customer: { id: 2, name: 'Bob Test', phone: '919000000002@c.us' },
      isNewCustomer: false,
      medicineName: 'Aspirin 75mg',
      quantity: 1,
      unit: 'box',
      localMatches: [],
      catalogResults: {
        mapped: [
          { name: 'ASPIRIN 75MG TABLET', mrp: 12.5, packaging: '14 Tab', distributor: 'XYZ Pharma', isMapped: true }
        ],
        nonMapped: []
      },
      confidence: 90,
      isRepeat: false,
      source: 'text',
      messageBody: 'get aspirin 75mg',
      msgId: 'msg-aspirin',
      phone: '919000000002@c.us'
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][2]).toContain('⚠️ *Medicine NOT in Local Stock — PharmaRack Matches*');
    expect(mockSendMessage.mock.calls[0][2]).toContain('ASPIRIN 75MG TABLET');

    // Staged review record must be created
    const review = await db.get("SELECT * FROM staged_medicine_reviews WHERE source = 'whatsapp'");
    expect(review).toBeDefined();
    expect(review.medicine_name).toBe('ASPIRIN 75MG TABLET');
    expect(review.search_query).toBe('Aspirin 75mg');
    expect(JSON.parse(review.original_row_data).customerName).toBe('Bob Test');

    // Escalation record must point to this review ID
    const escalation = await db.get('SELECT * FROM wa_admin_escalations WHERE msg_id = ?', ['msg-aspirin']);
    expect(escalation.review_id).toBe(review.id);
  });

  test('wa_auto_share_admin = false gates the escalation', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run("UPDATE app_settings SET value = 'false' WHERE key = 'wa_auto_share_admin'");

    await waAdminEscalationService.maybeEscalate({
      customer: { id: 1, name: 'Alice Test', phone: '919000000001@c.us' },
      isNewCustomer: false,
      medicineName: 'Paracetamol 650mg',
      quantity: 2,
      unit: 'strips',
      localMatches: ['Paracetamol 650mg'],
      catalogResults: null,
      confidence: 98,
      isRepeat: false,
      source: 'text',
      messageBody: 'need paracetamol 650mg',
      msgId: 'msg-abc-123',
      phone: '919000000001@c.us'
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
    const count = await db.get('SELECT COUNT(*) as cnt FROM wa_admin_escalations');
    expect(count.cnt).toBe(0);
  });
});
