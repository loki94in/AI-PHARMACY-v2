import { jest } from '@jest/globals';

// Mock whatsappBusinessService BEFORE importing any internal code
jest.unstable_mockModule('../src/services/whatsappBusinessService.js', () => ({
  __esModule: true,
  whatsappBusinessService: {
    sendTextMessage: jest.fn(() => Promise.resolve({ success: true, messageId: 'msg-123' })),
    sendDocument: jest.fn(() => Promise.resolve({ success: true, messageId: 'doc-123' }))
  }
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('WhatsApp Routing Logic Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let sendMessage: any;
  let mockBusinessService: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-routing-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    process.env.DB_PATH = dbPath;

    // Dynamically import sendMessage and the mocked service
    sendMessage = (await import('../src/whatsappClient.js')).sendMessage;
    mockBusinessService = (await import('../src/services/whatsappBusinessService.js')).whatsappBusinessService;
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Clear settings table for clean test runs
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM app_settings');
  });

  test('Routes to official WhatsApp Business when enabled', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run("INSERT INTO app_settings (key, value) VALUES ('wa_business_enabled', 'true')");
    await db.run("INSERT INTO app_settings (key, value) VALUES ('whatsapp_preferred_system', 'official')");

    await sendMessage('919876543210', undefined, 'Hello Business');

    expect(mockBusinessService.sendTextMessage).toHaveBeenCalledWith('919876543210', 'Hello Business');
  });

  test('Routes base64 files to official WhatsApp Business document upload', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run("INSERT INTO app_settings (key, value) VALUES ('wa_business_enabled', 'true')");
    await db.run("INSERT INTO app_settings (key, value) VALUES ('whatsapp_preferred_system', 'official')");

    const filePayload = {
      mimetype: 'application/pdf',
      data: 'dGVzdCBkYXRh', // base64 for "test data"
      filename: 'invoice.pdf'
    };

    await sendMessage('919876543210', undefined, 'Pdf Caption', filePayload);

    expect(mockBusinessService.sendDocument).toHaveBeenCalledWith(
      '919876543210',
      expect.stringContaining('wa_temp_'),
      'Pdf Caption',
      'invoice.pdf'
    );
  });

  test('Falls back to automated WhatsApp client and throws if not initialized', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run("INSERT INTO app_settings (key, value) VALUES ('whatsapp_enabled', 'true')");
    await db.run("INSERT INTO app_settings (key, value) VALUES ('whatsapp_preferred_system', 'automated')");

    await expect(sendMessage('919876543210', undefined, 'Hello Automated')).rejects.toThrow(
      'Client not initialized'
    );
  });
});
