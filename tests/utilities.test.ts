// Integration tests for utilities routes
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { ensureSchema } from '../src/database.js';

describe('Utilities routes', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'util-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    process.env.DB_PATH = dbPath;
    // Import router after setting DB_PATH
    const { default: utilitiesRouter } = await import('../src/routes/utilities.js');
    app = express();
    app.use(express.json());
    app.use('/utils', utilitiesRouter);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('POST /utils/backup creates a backup file', async () => {
    const res = await request(app).post('/utils/backup');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const backupFilename = res.body.backupFilename as string;
    const backupPath = path.resolve(process.cwd(), 'backup', backupFilename);
    expect(fs.existsSync(backupPath)).toBe(true);
  });

  test('GET /utils/barcode/:code returns PDF URL', async () => {
    const code = 'ABC123';
    const res = await request(app).get(`/utils/barcode/${code}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pdfUrl).toMatch(new RegExp(`barcode_${code}_.*\\.pdf$`));
    const pdfPath = path.resolve(process.cwd(), 'uploads', path.basename(res.body.pdfUrl));
    expect(fs.existsSync(pdfPath)).toBe(true);
  });

  test('GET /utils/gmail/test returns success', async () => {
    const res = await request(app).get('/utils/gmail/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Gmail connection OK');
  });

  test('GET /utils/whatsapp/test returns success', async () => {
    const res = await request(app).get('/utils/whatsapp/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('WhatsApp connection OK');
  });

  test('POST /utils/whatsapp/send returns mock success', async () => {
    const res = await request(app).post('/utils/whatsapp/send').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('WhatsApp test message sent (mock)');
  });

  test('POST /utils/reset-data clears data but preserves settings', async () => {
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.run("INSERT INTO medicines (name) VALUES ('Test Medicine')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('shop_name', 'My Configured Shop')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_user', 'user@gmail.com')");
    
    // Verify insertion
    const medBefore = await db.get("SELECT * FROM medicines");
    expect(medBefore).toBeDefined();
    expect(medBefore.name).toBe('Test Medicine');
    
    // Close connection to release file locks on Windows
    await db.close();

    // Call the reset endpoint
    const res = await request(app).post('/utils/reset-data');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Reopen connection to verify data is cleared but settings are preserved
    const dbAfter = await open({ filename: dbPath, driver: sqlite3.Database });
    const medAfter = await dbAfter.get("SELECT * FROM medicines");
    expect(medAfter).toBeUndefined();

    const shopName = await dbAfter.get("SELECT value FROM app_settings WHERE key = 'shop_name'");
    expect(shopName).toBeDefined();
    expect(shopName.value).toBe('My Configured Shop');

    const gmailUser = await dbAfter.get("SELECT value FROM app_settings WHERE key = 'gmail_user'");
    expect(gmailUser).toBeDefined();
    expect(gmailUser.value).toBe('user@gmail.com');

    await dbAfter.close();
  });
});