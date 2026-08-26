import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-catalog-auth-'));

import { ensureSchema } from '../src/database.js';

describe('Automation catalog', () => {
  let tmpDir: string;
  let dbPath: string;
  let AUTOMATION_CATALOG: any;
  let getAutomationToggleStates: any;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-catalog-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    ({ AUTOMATION_CATALOG, getAutomationToggleStates } = await import('../src/services/automationCatalog.js'));
    ({ dbManager } = await import('../src/database/connection.js'));
  });

  afterAll(async () => {
    await dbManager.close(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists at least the core known automation types with unique ids', () => {
    const ids = AUTOMATION_CATALOG.map((e: any) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'dispatch_reminder',
      'distributor_collection',
      'refill_reminder',
      'doctor_daily_summary',
      'expiry_report',
      'bounced_products_alert',
      'shortage_notice',
      'credit_reminder',
    ]));
  });

  it('every entry has a non-empty label, description, and app_settings key', () => {
    for (const entry of AUTOMATION_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.appSettingsKey.length).toBeGreaterThan(0);
    }
  });

  it('getAutomationToggleStates defaults every entry to enabled when app_settings is empty', async () => {
    const states = await getAutomationToggleStates();
    for (const entry of AUTOMATION_CATALOG) {
      expect(states[entry.id]).toBe(true);
    }
  });

  it('getAutomationToggleStates reflects an explicit false override', async () => {
    const db = await dbManager.getConnection();
    const target = AUTOMATION_CATALOG[0];
    await db.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, 'false')",
      [target.appSettingsKey]
    );
    const states = await getAutomationToggleStates();
    expect(states[target.id]).toBe(false);
  });
});
