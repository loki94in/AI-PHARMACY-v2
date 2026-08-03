// @ts-ignore
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';

describe('Distributor Phone Number Persistence & Sync Tests', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-sync-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    await ensureSchema(dbPath);
    await dbManager.getConnection();

    const { default: distributorsRouter } = await import('../src/routes/distributors.js');
    const { default: pharmarackRouter } = await import('../src/routes/pharmarack.js');
    const { default: contactsRouter } = await import('../src/routes/contacts.js');

    app = express();
    app.use(express.json());
    app.use('/api/distributors', distributorsRouter);
    app.use('/api/pharmarack', pharmarackRouter);
    app.use('/api/contacts', contactsRouter);
  });

  afterAll(async () => {
    try {
      await dbManager.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('Updating distributor phone via /api/distributors syncs distributors, pharmarack_distributor_mappings, and contacts tables', async () => {
    // 1. Create a distributor
    const createRes = await request(app)
      .post('/api/distributors')
      .send({
        name: 'Alpha Pharma Wholesalers',
        phone: '+91 98765 43210',
        email: 'alpha@example.com'
      });

    expect(createRes.status).toBe(200);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data).toBeDefined();
    expect(createRes.body.data.phone).toBe('9876543210');

    const distId = createRes.body.id;

    // Verify SQLite directly
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    
    // Check distributors table
    const distRow = await db.get('SELECT * FROM distributors WHERE id = ?', [distId]);
    expect(distRow).toBeDefined();
    expect(distRow.phone).toBe('9876543210');
    expect(distRow.contact).toBe('9876543210');

    // Check pharmarack_distributor_mappings table
    const mapRow = await db.get('SELECT * FROM pharmarack_distributor_mappings WHERE store_name = ?', ['Alpha Pharma Wholesalers']);
    expect(mapRow).toBeDefined();
    expect(mapRow.distributor_id).toBe(distId);
    expect(mapRow.phone).toBe('9876543210');

    // Check contacts table
    const contactRow = await db.get('SELECT * FROM contacts WHERE name = ? AND type = ?', ['Alpha Pharma Wholesalers', 'distributor']);
    expect(contactRow).toBeDefined();
    expect(contactRow.phone).toBe('9876543210');

    await db.close();
  });

  test('Saving store mapping via /api/pharmarack/distributor-mappings syncs back to distributors table and contacts table', async () => {
    const saveRes = await request(app)
      .post('/api/pharmarack/distributor-mappings')
      .send({
        store_name: 'Beta Healthcare Agencies',
        phone: '9123456789'
      });

    expect(saveRes.status).toBe(200);
    expect(saveRes.body.success).toBe(true);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    // Verify created distributor in central distributors table
    const distRow = await db.get('SELECT * FROM distributors WHERE LOWER(name) = ?', ['beta healthcare agencies']);
    expect(distRow).toBeDefined();
    expect(distRow.phone).toBe('9123456789');

    // Verify mapping
    const mapRow = await db.get('SELECT * FROM pharmarack_distributor_mappings WHERE LOWER(store_name) = ?', ['beta healthcare agencies']);
    expect(mapRow).toBeDefined();
    expect(mapRow.distributor_id).toBe(distRow.id);

    // Verify contacts
    const contactRow = await db.get('SELECT * FROM contacts WHERE LOWER(name) = ? AND type = ?', ['beta healthcare agencies', 'distributor']);
    expect(contactRow).toBeDefined();
    expect(contactRow.phone).toBe('9123456789');

    await db.close();
  });

  test('GET /api/pharmarack/distributor-mappings returns numbers for both mapped and unmapped distributors', async () => {
    const res = await request(app).get('/api/pharmarack/distributor-mappings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.mappings)).toBe(true);

    const alpha = res.body.mappings.find((m: any) => m.store_name === 'Alpha Pharma Wholesalers');
    expect(alpha).toBeDefined();
    expect(alpha.distributor_phone || alpha.phone).toBe('9876543210');

    const beta = res.body.mappings.find((m: any) => m.store_name === 'Beta Healthcare Agencies');
    expect(beta).toBeDefined();
    expect(beta.distributor_phone || beta.phone).toBe('9123456789');
  });

  test('PUT /api/distributors/:id updates phone and persists across simulated refresh', async () => {
    // Fetch Alpha dist id
    const db1 = await open({ filename: dbPath, driver: sqlite3.Database });
    const distRow = await db1.get('SELECT id FROM distributors WHERE name = ?', ['Alpha Pharma Wholesalers']);
    await db1.close();

    const putRes = await request(app)
      .put(`/api/distributors/${distRow.id}`)
      .send({
        name: 'Alpha Pharma Wholesalers',
        phone: '9998887776'
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.data.phone).toBe('9998887776');

    // Simulate page refresh fetching mappings
    const getRes = await request(app).get('/api/pharmarack/distributor-mappings');
    const updatedAlpha = getRes.body.mappings.find((m: any) => m.store_name === 'Alpha Pharma Wholesalers');
    expect(updatedAlpha).toBeDefined();
    expect(updatedAlpha.distributor_phone || updatedAlpha.phone).toBe('9998887776');
  });
});
