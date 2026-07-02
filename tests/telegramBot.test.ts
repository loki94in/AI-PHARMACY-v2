import { jest } from '@jest/globals';

// Mock node-telegram-bot-api BEFORE importing any internal code
jest.unstable_mockModule('node-telegram-bot-api', () => {
  const mockBotInstance = {
    onText: jest.fn(),
    on: jest.fn(),
    isPolling: jest.fn().mockReturnValue(true),
    stopPolling: jest.fn(() => Promise.resolve()),
  };
  const MockBotConstructor = jest.fn(() => mockBotInstance);
  return {
    default: MockBotConstructor,
    __esModule: true
  };
});

import { ensureSchema } from '../src/database.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Telegram Bot Service Configuration & Reload', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-bot-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    process.env.DB_PATH = dbPath;
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('should load credentials from database and initialize bot when enabled', async () => {
    const { telegramBotService } = await import('../src/telegramBot.js');
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    // Enable Telegram bot in DB
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('telegram_enabled', 'true')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('telegram_token', '123456:fake_token')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('telegram_chat_id', '987654')");

    // Initialize bot service
    await telegramBotService.initializeOrReloadBot();

    // Check service internal state (token, chatId, enabled)
    expect((telegramBotService as any).token).toBe('123456:fake_token');
    expect((telegramBotService as any).chatId).toBe('987654');
    expect((telegramBotService as any).enabled).toBe(true);
    expect((telegramBotService as any).bot).toBeDefined();
  });

  test('should stop polling and disable bot when disabled in DB', async () => {
    const { telegramBotService } = await import('../src/telegramBot.js');
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    const oldBot = (telegramBotService as any).bot;
    expect(oldBot).toBeDefined();

    // Disable Telegram bot in DB
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('telegram_enabled', 'false')");

    // Reload bot service
    await telegramBotService.initializeOrReloadBot();

    expect((telegramBotService as any).enabled).toBe(false);
    expect((telegramBotService as any).bot).toBeNull();
    expect(oldBot.stopPolling).toHaveBeenCalled();
  });
});
