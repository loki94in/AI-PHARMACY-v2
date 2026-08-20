import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('AI Pharmacy — Near-Expiry Audit Report & Returns Verification', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'near-expiry-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    await ensureSchema(dbPath);

    const { default: returnsRouter } = await import('../src/routes/returns.js');

    app = express();
    app.use(express.json());
    app.use('/api/returns', returnsRouter);
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('Validation Tests 1-6: Near-Expiry returns filtering respects physical unsold inventory and exclusions', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed distributor
    const distRes = await db.run("INSERT INTO distributors (name, contact) VALUES ('Apollo Dist', '9876543210')");
    const distId = distRes.lastID;

    // Seed 6 test medicines
    const medA = (await db.run("INSERT INTO medicines (name, mrp, pack_size) VALUES ('Medicine A (Unsold Near Expiry)', 100.0, 10)")).lastID;
    const medB = (await db.run("INSERT INTO medicines (name, mrp, pack_size) VALUES ('Medicine B (Completely Sold)', 100.0, 10)")).lastID;
    const medC = (await db.run("INSERT INTO medicines (name, mrp, pack_size) VALUES ('Medicine C (Already Returned)', 100.0, 10)")).lastID;
    const medD = (await db.run("INSERT INTO medicines (name, mrp, pack_size) VALUES ('Medicine D (Outside Window)', 100.0, 10)")).lastID;
    const medE = (await db.run("INSERT INTO medicines (name, mrp, pack_size) VALUES ('Medicine E (Partially Sold)', 100.0, 10)")).lastID;
    const medF = (await db.run("INSERT INTO medicines (name, mrp, pack_size) VALUES ('Medicine F (Partial Return)', 100.0, 10)")).lastID;

    // Helper to get near-future MM/YY string (e.g. 2 months ahead)
    const now = new Date();
    const nearMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    const nearExpStr = `${String(nearMonth.getMonth() + 1).padStart(2, '0')}/${String(nearMonth.getFullYear()).slice(-2)}`;

    // Helper to get far-future MM/YY string (e.g. 24 months ahead)
    const farMonth = new Date(now.getFullYear(), now.getMonth() + 24, 1);
    const farExpStr = `${String(farMonth.getMonth() + 1).padStart(2, '0')}/${String(farMonth.getFullYear()).slice(-2)}`;

    // Seed purchase invoices
    const purchRes = await db.run("INSERT INTO purchases (distributor_id, invoice_no, total_amount, date) VALUES (?, 'INV-1001', 5000, '2026-01-01')", [distId]);
    const purchId = purchRes.lastID;

    // 1. Batch A: Unsold near-expiry (quantity = 10, expiry within window)
    await db.run("INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BATCH-A', ?, 10, 80, 100)", [purchId, medA, nearExpStr]);
    await db.run("INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, loose_quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-A', ?, 10, 0, 80, 100, 1)", [medA, nearExpStr]);

    // 2. Batch B: Completely sold (purchased 100, sold 100, current quantity = 0)
    await db.run("INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BATCH-B', ?, 100, 80, 100)", [purchId, medB, nearExpStr]);
    await db.run("INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, loose_quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-B', ?, 0, 0, 80, 100, 0)", [medB, nearExpStr]);

    // 3. Batch C: Already completely returned (purchased 50, returned 50, current quantity = 0)
    await db.run("INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BATCH-C', ?, 50, 80, 100)", [purchId, medC, nearExpStr]);
    await db.run("INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, loose_quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-C', ?, 0, 0, 80, 100, 0)", [medC, nearExpStr]);
    const retResC = await db.run("INSERT INTO returns (return_no, type, total_amount, distributor_id, return_sub_type, date) VALUES ('PR-001', 'purchase', 4000, ?, 'expiry', '2026-02-01')", [distId]);
    await db.run("INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, cost_price, mrp, total_price) VALUES (?, ?, 'BATCH-C', 50, 80, 100, 4000)", [retResC.lastID, medC]);

    // 4. Batch D: Outside expiry window (quantity = 20, expiry far in future)
    await db.run("INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BATCH-D', ?, 20, 80, 100)", [purchId, medD, farExpStr]);
    await db.run("INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, loose_quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-D', ?, 20, 0, 80, 100, 1)", [medD, farExpStr]);

    // 5. Batch E: Partially sold (purchased 100, sold 70, current quantity = 30)
    await db.run("INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BATCH-E', ?, 100, 80, 100)", [purchId, medE, nearExpStr]);
    await db.run("INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, loose_quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-E', ?, 30, 0, 80, 100, 1)", [medE, nearExpStr]);

    // 6. Batch F: Partial return (purchased 50, returned 20, current quantity = 30)
    await db.run("INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BATCH-F', ?, 50, 80, 100)", [purchId, medF, nearExpStr]);
    await db.run("INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, loose_quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-F', ?, 30, 0, 80, 100, 1)", [medF, nearExpStr]);
    const retResF = await db.run("INSERT INTO returns (return_no, type, total_amount, distributor_id, return_sub_type, date) VALUES ('PR-002', 'purchase', 1600, ?, 'expiry', '2026-02-01')", [distId]);
    await db.run("INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, cost_price, mrp, total_price) VALUES (?, ?, 'BATCH-F', 20, 80, 100, 1600)", [retResF.lastID, medF]);

    // Query GET /api/returns/near-expiry?months=6
    const res = await request(app).get('/api/returns/near-expiry?months=6');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const distGroup = res.body.find((g: any) => g.distributor_id === distId);
    expect(distGroup).toBeDefined();
    const items = distGroup.items;

    const batchMap = new Map<string, any>(items.map((i: any) => [i.batch_no, i]));

    // Test 1: Batch A (Unsold near-expiry) must be VISIBLE with quantity 10
    expect(batchMap.has('BATCH-A')).toBe(true);
    expect(batchMap.get('BATCH-A').quantity).toBe(10);

    // Test 2: Batch B (Completely sold) must NOT be visible
    expect(batchMap.has('BATCH-B')).toBe(false);

    // Test 3: Batch C (Already completely returned) must NOT be visible
    expect(batchMap.has('BATCH-C')).toBe(false);

    // Test 4: Batch D (Outside window) must NOT be visible
    expect(batchMap.has('BATCH-D')).toBe(false);

    // Test 5: Batch E (Partially sold) must be VISIBLE with current inventory quantity 30
    expect(batchMap.has('BATCH-E')).toBe(true);
    expect(batchMap.get('BATCH-E').quantity).toBe(30);

    // Test 6: Batch F (Partial return) must be VISIBLE with remaining inventory quantity 30
    expect(batchMap.has('BATCH-F')).toBe(true);
    expect(batchMap.get('BATCH-F').quantity).toBe(30);
  });

  test('Validation Test 7: Audit validation engine reports CLEAN when near-expiry scope is correct', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const { runAudit } = await import('../src/utils/auditEngine.js');
    const report = await runAudit(db as any);

    const expiryCategory = report.categories.find(c => c.category === 'Expiry');
    expect(expiryCategory).toBeDefined();
    expect(expiryCategory?.status).toBe('CLEAN');
    expect(expiryCategory?.findings.length).toBe(0);
  });
});
