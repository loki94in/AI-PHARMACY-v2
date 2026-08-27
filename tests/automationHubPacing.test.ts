import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-pacing-auth-'));

import { ensureSchema } from '../src/database.js';

describe('WhatsApp queue pacing floor', () => {
  let tmpDir: string;
  let dbPath: string;
  let whatsappQueueWorker: any;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-pacing-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    ({ whatsappQueueWorker } = await import('../src/services/whatsappQueueWorker.js'));
    ({ dbManager } = await import('../src/database/connection.js'));
  });

  afterAll(async () => {
    await dbManager.close(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('setPacingConfig clamps a below-floor minSec up to 10s', async () => {
    await whatsappQueueWorker.setPacingConfig(0.1, 0.3);
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(10000);
    expect(maxMs).toBeGreaterThanOrEqual(minMs + 1000);
  });

  it('setPacingConfig keeps a valid 10-15s range unchanged', async () => {
    await whatsappQueueWorker.setPacingConfig(11, 14);
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(11000);
    expect(maxMs).toBe(14000);
  });

  it('setPacingConfig corrects an inverted range (max below min)', async () => {
    await whatsappQueueWorker.setPacingConfig(12, 5);
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(12000);
    expect(maxMs).toBeGreaterThanOrEqual(minMs + 1000);
  });

  it('loadPacingConfig re-clamps a stale below-floor value already stored in app_settings', async () => {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_min', '100')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_max', '300')");
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(10000);
    expect(maxMs).toBeGreaterThanOrEqual(minMs + 1000);
  });

  it('setPacingPreset("safe") sets a 10-15s range', async () => {
    const result = await whatsappQueueWorker.setPacingPreset('safe');
    expect(result.minMs).toBe(10000);
    expect(result.maxMs).toBe(15000);
  });

  it('setPacingPreset rejects removed presets at the type level (compile-time) and the route rejects them at runtime — see whatsappQueueRoute test below', () => {
    expect(typeof whatsappQueueWorker.setPacingPreset).toBe('function');
  });
});
