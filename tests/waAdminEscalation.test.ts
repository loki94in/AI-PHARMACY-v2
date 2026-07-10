import { jest } from '@jest/globals';

// 1. Mock the WhatsApp Client sendMessage method BEFORE importing internal code
const mockSendMessage = jest.fn((...args: any[]) => Promise.resolve());

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
    await db.run('DELETE FROM whatsapp_chats');

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

  test('pharmarack message shows manufacturer, score %, wa.me link, and mapped/other groups', async () => {
    await waAdminEscalationService.maybeEscalate({
      customer: { id: 3, name: 'Ramesh Patil', phone: '919822012345' },
      isNewCustomer: false,
      medicineName: 'Novastat 20',
      quantity: 1,
      unit: 'strip',
      localMatches: [],
      catalogResults: {
        mapped: [
          { name: "NOVASTAT 20MG TAB 10'S", mrp: 85, packaging: '10 Tab', distributor: 'XYZ Pharma', manufacturer: 'Cipla', isMapped: true, score: 0.82 }
        ],
        nonMapped: [
          { name: 'NOVASTAT 10MG TAB', mrp: 60, packaging: '10 Tab', distributor: 'ABC Distributors', manufacturer: 'Cipla', isMapped: false, score: 0.7 }
        ]
      },
      confidence: 82,
      isRepeat: false,
      source: 'text',
      messageBody: 'novastt 20 pathva',
      msgId: 'msg-novastat',
      phone: '919822012345@c.us'
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const text = mockSendMessage.mock.calls[0][2] as string;
    expect(text).toContain('*Old Customer*: Ramesh Patil');
    expect(text).toContain('https://wa.me/919822012345');
    expect(text).toContain('✅ *Mapped distributors*');
    expect(text).toContain('📦 *Other distributors*');
    expect(text).toContain('Cipla');
    expect(text).toContain('82%');
    // Mapped match must be listed before the non-mapped one
    expect(text.indexOf("NOVASTAT 20MG TAB 10'S")).toBeLessThan(text.indexOf('NOVASTAT 10MG TAB'));

    // Staged review must persist manufacturer + score
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const review = await db.get("SELECT * FROM staged_medicine_reviews WHERE source = 'whatsapp'");
    const rowData = JSON.parse(review.original_row_data);
    expect(rowData.topMatches[0].manufacturer).toBe('Cipla');
    expect(rowData.topMatches[0].score).toBe(0.82);
  });

  test('unresolved @lid sender falls back to whatsapp_chats.resolved_number for phone + link', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run(
      `INSERT INTO whatsapp_chats (id, name, resolved_number) VALUES (?, ?, ?)`,
      ['123456789012345@lid', 'Lid User', '919923777352']
    );

    await waAdminEscalationService.maybeEscalate({
      customer: null,
      isNewCustomer: true,
      medicineName: 'Dolo 650',
      quantity: 1,
      unit: 'strip',
      localMatches: [],
      catalogResults: {
        mapped: [{ name: 'DOLO 650 TAB', mrp: 30, packaging: '15 Tab', distributor: 'XYZ Pharma', manufacturer: 'Micro Labs', isMapped: true, score: 0.9 }],
        nonMapped: []
      },
      confidence: 90,
      isRepeat: false,
      source: 'text',
      messageBody: 'dolo 650 pathva',
      msgId: 'msg-lid-1',
      phone: '123456789012345@lid',
      chatId: '123456789012345@lid'
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const text = mockSendMessage.mock.calls[0][2] as string;
    expect(text).toContain('*New Customer*');
    expect(text).toContain('+919923777352');
    expect(text).toContain('https://wa.me/919923777352');
    expect(text).not.toContain('123456789012345');
  });

  test('old-customer context block renders purchases, refills, and recent messages', async () => {
    await waAdminEscalationService.maybeEscalate({
      customer: { id: 4, name: 'Sunita Deshmukh', phone: '919800011122' },
      isNewCustomer: false,
      medicineName: 'Telma 40',
      quantity: 1,
      unit: 'strip',
      localMatches: [],
      catalogResults: {
        mapped: [{ name: 'TELMA 40 TAB', mrp: 120, packaging: '15 Tab', distributor: 'ABC', manufacturer: 'Glenmark', isMapped: true, score: 0.95 }],
        nonMapped: []
      },
      confidence: 95,
      isRepeat: false,
      source: 'text',
      messageBody: 'telma 40 send',
      msgId: 'msg-ctx-1',
      phone: '919800011122@c.us',
      context: {
        purchases: [{ date: '2026-06-12', name: 'Dolo 650', quantity: 2 }],
        refills: [{ medicine_name: 'Telma 40', next_refill_date: '2026-07-15', last_refill_date: '2026-06-15' }],
        lastMessages: [{ body: 'kal ka order aaya?' }]
      }
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const text = mockSendMessage.mock.calls[0][2] as string;
    expect(text).toContain('🧾 *Recent purchases*: Dolo 650 x2');
    expect(text).toContain('🔁 *Refills*: Telma 40');
    expect(text).toContain('💬 *Recent msgs*: "kal ka order aaya?"');
  });

  test('new customer gets no context block even if context is passed', async () => {
    await waAdminEscalationService.maybeEscalate({
      customer: null,
      isNewCustomer: true,
      medicineName: 'Telma 40',
      quantity: 1,
      unit: 'strip',
      localMatches: [],
      catalogResults: {
        mapped: [{ name: 'TELMA 40 TAB', mrp: 120, packaging: '15 Tab', distributor: 'ABC', manufacturer: 'Glenmark', isMapped: true, score: 0.95 }],
        nonMapped: []
      },
      confidence: 95,
      isRepeat: false,
      source: 'text',
      messageBody: 'telma 40',
      msgId: 'msg-ctx-2',
      phone: '919800099887@c.us',
      context: { purchases: [], refills: [], lastMessages: [{ body: 'hello' }] }
    });

    const text = mockSendMessage.mock.calls[0][2] as string;
    expect(text).not.toContain('Recent msgs');
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
