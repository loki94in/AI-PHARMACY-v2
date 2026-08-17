import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { runAudit, REQUIRED_CATEGORIES } from '../src/utils/auditEngine.js';

describe('Task 15: Project Readiness Audit', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    jest.setTimeout(20000);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    await ensureSchema(dbPath);

    const { default: auditRouter } = await import('../src/routes/audit.js');
    app = express();
    app.use(express.json());
    app.use('/api/audit', auditRouter);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    db = await open({ filename: dbPath, driver: sqlite3.default.Database });
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { await db.close(); } catch (_) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('1. All 18 required categories are present in every audit run', async () => {
    const report = await runAudit(db);
    expect(report.categories).toHaveLength(REQUIRED_CATEGORIES.length);
    const names = report.categories.map(c => c.category);
    for (const cat of REQUIRED_CATEGORIES) {
      expect(names).toContain(cat);
    }
  });

  test('2. Valid scenario: a legitimate distributor + purchase with real MRP stays CLEAN', async () => {
    const dist = await db.run("INSERT INTO distributors (name, contact) VALUES ('Apollo Pharma Distributors', '9876543210')");
    const distId = dist.lastID;
    const med = await db.run("INSERT INTO medicines (name, mrp, pack_size) VALUES ('Paracetamol 650mg', 30.0, 10)");
    const medId = med.lastID;
    const purch = await db.run(
      "INSERT INTO purchases (distributor_id, invoice_no, total_amount, date) VALUES (?, 'REAL-INV-2001', 500, '2026-06-01')",
      [distId]
    );
    await db.run(
      "INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'B-2026-001', '12/27', 25, 20.0, 30.0)",
      [purch.lastID, medId]
    );

    const report = await runAudit(db);
    const purchases = report.categories.find(c => c.category === 'Purchases')!;
    const emailImport = report.categories.find(c => c.category === 'Email Import')!;
    expect(purchases.status).toBe('CLEAN');
    expect(emailImport.status).toBe('CLEAN');
  });

  test('3. Blocked/missing-data scenario: a bypassed placeholder distributor is detected as a blocking issue', async () => {
    // Simulate legacy/bypassed data that slipped past the app-level STRICT VALIDATION guard
    // (e.g. written directly by an old migration) — the audit must catch it independently of that guard.
    await db.run("INSERT INTO distributors (name, contact) VALUES ('Email Import', '')");

    const report = await runAudit(db);
    const emailImport = report.categories.find(c => c.category === 'Email Import')!;
    expect(emailImport.status).toBe('ISSUE');
    expect(emailImport.findings.some(f => f.severity === 'HIGH')).toBe(true);
    expect(report.blockingCount).toBeGreaterThan(0);
    expect(report.status).toBe('PROJECT NOT READY');
  });

  test('4. Fixing the flagged issue flips the category — and overall status — back to clean/ready', async () => {
    await db.run("DELETE FROM distributors WHERE name = 'Email Import'");

    const report = await runAudit(db);
    const emailImport = report.categories.find(c => c.category === 'Email Import')!;
    expect(emailImport.status).toBe('CLEAN');
    expect(report.blockingCount).toBe(0);
    expect(report.status).toBe('PROJECT READY');
  });

  test('5. Running the audit via the API persists the result, and it can be reopened', async () => {
    const runRes = await request(app).post('/api/audit/run');
    expect(runRes.status).toBe(200);
    expect(runRes.body.id).toBeDefined();
    expect(['PROJECT READY', 'PROJECT NOT READY']).toContain(runRes.body.status);

    const latestRes = await request(app).get('/api/audit/latest');
    expect(latestRes.status).toBe(200);
    expect(latestRes.body.id).toBe(runRes.body.id);
    expect(latestRes.body.status).toBe(runRes.body.status);

    const historyRes = await request(app).get('/api/audit/history');
    expect(historyRes.status).toBe(200);
    expect(Array.isArray(historyRes.body)).toBe(true);
    expect(historyRes.body.find((h: any) => h.id === runRes.body.id)).toBeDefined();

    const byIdRes = await request(app).get(`/api/audit/${runRes.body.id}`);
    expect(byIdRes.status).toBe(200);
    expect(byIdRes.body.timestamp).toBe(runRes.body.timestamp);
    expect(byIdRes.body.findings.length).toBe(runRes.body.findings.length);
  });

  test('6. Every finding reports what/where/severity/codeFixAvailable/userActionRequired/exactAction', async () => {
    await db.run("INSERT INTO distributors (name, contact) VALUES ('Unknown Supplier', '')");
    const report = await runAudit(db);
    expect(report.findings.length).toBeGreaterThan(0);
    for (const f of report.findings) {
      expect(f.summary).toBeTruthy();
      expect(f.where).toBeTruthy();
      expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).toContain(f.severity);
      expect(typeof f.codeFixAvailable).toBe('boolean');
      expect(typeof f.userActionRequired).toBe('boolean');
      expect(f.exactAction).toBeTruthy();
    }
    await db.run("DELETE FROM distributors WHERE name = 'Unknown Supplier'");
  });
});
