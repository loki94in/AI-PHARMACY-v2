// Simple test for CRM router fetch
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('CRM routes', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    process.env.DB_PATH = dbPath;
    const { default: crmRouter } = await import('../src/routes/crm.js');
    // Insert a customer directly via db
    const { open } = await import('sqlite');
    const { default: sqlite3 } = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Test User', '12345']);
    await db.close();
    app = express();
    app.use(express.json());
    app.use('/crm', crmRouter);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('GET /crm returns customers list', async () => {
    const res = await request(app).get('/crm');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((c: any) => c.name === 'Test User');
    expect(found).toBeDefined();
  });
});
