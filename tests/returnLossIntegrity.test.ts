import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { trackExpiryReturn } from '../src/services/creditNoteService.js';
import { scanAndCreateExpiryReviews } from '../src/services/returnsService.js';

describe('Task 5: Removal of Hardcoded 3% Return Loss/Commission & Enforcing Explicit Rates', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'return-loss-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    await ensureSchema(dbPath);

    const { default: returnsRouter } = await import('../src/routes/returns.js');
    const { default: expiryRouter } = await import('../src/routes/expiry.js');

    app = express();
    app.use(express.json());
    app.use('/api/returns', returnsRouter);
    app.use('/api/expiry', expiryRouter);
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('1. trackExpiryReturn service rejects missing, null, negative, or out-of-range (>100) loss percentage', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Missing percentage
    await expect((trackExpiryReturn as any)(db, 1, 1, 1000, undefined)).rejects.toThrow(
      /A valid percentage between 0 and 100 is required and cannot be assumed/
    );

    // Null percentage
    await expect((trackExpiryReturn as any)(db, 1, 1, 1000, null)).rejects.toThrow(
      /A valid percentage between 0 and 100 is required and cannot be assumed/
    );

    // Negative percentage
    await expect(trackExpiryReturn(db as any, 1, 1, 1000, -5.0)).rejects.toThrow(
      /A valid percentage between 0 and 100 is required and cannot be assumed/
    );

    // Greater than 100%
    await expect(trackExpiryReturn(db as any, 1, 1, 1000, 105.0)).rejects.toThrow(
      /A valid percentage between 0 and 100 is required and cannot be assumed/
    );

    await db.close();
  });

  test('2. POST /api/returns/expiry-reviews/:id/approve requires explicit valid loss_percentage and calculates exact expected credit note', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const distRes = await db.run("INSERT INTO distributors (name) VALUES ('Loss Dist A')");
    const distId = distRes.lastID;
    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Loss Med 1', 100)");
    const medId = medRes.lastID;

    const purchRes = await db.run("INSERT INTO purchases (distributor_id, invoice_no) VALUES (?, 'PINV-L1')", [distId]);
    await db.run(
      "INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BATCH-L1', '01/20', 10, 80.0, 100.0)",
      [purchRes.lastID, medId]
    );

    const invRes = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-L1', '01/20', 10, 80.0, 100.0, 1)",
      [medId]
    );
    const invId = invRes.lastID;

    await scanAndCreateExpiryReviews(db as any);
    const review = await db.get('SELECT id FROM expiry_return_reviews WHERE inventory_id = ? AND status = "pending"', [invId]);
    expect(review).toBeDefined();

    // A. Reject when loss_percentage is missing
    const missingRes = await request(app)
      .post(`/api/returns/expiry-reviews/${review.id}/approve`)
      .send({ notes: 'Missing loss percentage' });
    expect(missingRes.status).toBe(400);
    expect(missingRes.body.error).toContain('Return percentage required');

    // B. Reject when loss_percentage is invalid (e.g. -2 or 150)
    const invalidRes = await request(app)
      .post(`/api/returns/expiry-reviews/${review.id}/approve`)
      .send({ notes: 'Invalid loss percentage', loss_percentage: -10 });
    expect(invalidRes.status).toBe(400);

    // C. Accept explicit valid 5.0% loss (Total = 10 * 80 = 800; Expected Credit = 800 * 0.95 = 760)
    const validRes = await request(app)
      .post(`/api/returns/expiry-reviews/${review.id}/approve`)
      .send({ notes: 'Approved with 5% agreed distributor deduction', loss_percentage: 5.0 });
    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);

    const tracking = await db.get('SELECT * FROM expiry_returns_tracking WHERE return_id = ?', [validRes.body.returnId]);
    expect(tracking).toBeDefined();
    expect(tracking.original_amount).toBe(800);
    expect(tracking.loss_percentage).toBe(5.0);
    expect(tracking.expected_credit_amount).toBe(760.0); // Exactly 800 - 5% = 760

    await db.close();
  });

  test('3. Approving with 0.0% loss percentage yields 100% full credit note recovery', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const distRes = await db.run("INSERT INTO distributors (name) VALUES ('Zero Loss Dist')");
    const distId = distRes.lastID;
    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Zero Loss Med', 50)");
    const medId = medRes.lastID;

    const purchRes = await db.run("INSERT INTO purchases (distributor_id, invoice_no) VALUES (?, 'PINV-ZERO')", [distId]);
    await db.run(
      "INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BATCH-ZERO', '02/20', 20, 40.0, 50.0)",
      [purchRes.lastID, medId]
    );

    const invRes = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-ZERO', '02/20', 20, 40.0, 50.0, 1)",
      [medId]
    );
    const invId = invRes.lastID;

    await scanAndCreateExpiryReviews(db as any);
    const review = await db.get('SELECT id FROM expiry_return_reviews WHERE inventory_id = ? AND status = "pending"', [invId]);

    // Approve with 0% loss (Total = 20 * 40 = 800; Expected Credit = 800)
    const res = await request(app)
      .post(`/api/returns/expiry-reviews/${review.id}/approve`)
      .send({ loss_percentage: 0.0 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const tracking = await db.get('SELECT * FROM expiry_returns_tracking WHERE return_id = ?', [res.body.returnId]);
    expect(tracking.loss_percentage).toBe(0.0);
    expect(tracking.expected_credit_amount).toBe(800.0);

    await db.close();
  });

  test('4. POST /api/returns/process-returns rejects missing loss_percentage and calculates exact custom percentage', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const distRes = await db.run("INSERT INTO distributors (name) VALUES ('Process Return Dist')");
    const distId = distRes.lastID;
    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Process Med', 60)");
    const medId = medRes.lastID;

    const items = [
      { medicine_id: medId, batch_no: 'B-PR-1', quantity: 5, cost_price: 50.0, mrp: 60.0, distributor_id: distId }
    ];

    // A. Missing loss_percentage
    const missingRes = await request(app)
      .post('/api/returns/process-returns')
      .send({ items });
    expect(missingRes.status).toBe(400);
    expect(missingRes.body.error).toContain('Return percentage required');

    // B. Valid 2.5% loss (Total = 5 * 50 = 250; Expected = 250 * 0.975 = 243.75)
    const validRes = await request(app)
      .post('/api/returns/process-returns')
      .send({ items, loss_percentage: 2.5 });
    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);

    const returnRec = await db.get("SELECT id FROM returns WHERE return_no LIKE 'PR-%' ORDER BY id DESC LIMIT 1");
    const tracking = await db.get('SELECT * FROM expiry_returns_tracking WHERE return_id = ?', [returnRec.id]);
    expect(tracking.loss_percentage).toBe(2.5);
    expect(tracking.expected_credit_amount).toBe(243.75);

    await db.close();
  });

  test('5. POST /api/expiry/create-return requires explicit loss_percentage and calculates custom rate', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const distRes = await db.run("INSERT INTO distributors (name) VALUES ('Expiry Direct Dist')");
    const distId = distRes.lastID;
    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Expiry Direct Med', 120)");
    const medId = medRes.lastID;

    const purchRes = await db.run("INSERT INTO purchases (distributor_id, invoice_no) VALUES (?, 'EXP-INV-1')", [distId]);
    await db.run(
      "INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'B-EXP-DIR', '01/20', 10, 100.0, 120.0)",
      [purchRes.lastID, medId]
    );

    const invRes = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'B-EXP-DIR', '01/20', 10, 100.0, 120.0, 1)",
      [medId]
    );

    // A. Missing loss_percentage
    const missingRes = await request(app)
      .post('/api/expiry/create-return')
      .send({ inventory_id: invRes.lastID, quantity: 4 });
    expect(missingRes.status).toBe(400);
    expect(missingRes.body.error).toContain('Return percentage required');

    // B. Valid 7.0% loss (Total = 4 * 100 = 400; Expected = 400 * 0.93 = 372)
    const validRes = await request(app)
      .post('/api/expiry/create-return')
      .send({ inventory_id: invRes.lastID, quantity: 4, loss_percentage: 7.0 });
    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);

    const returnRec = await db.get('SELECT id FROM returns WHERE return_no = ?', [validRes.body.returnNo]);
    const tracking = await db.get('SELECT * FROM expiry_returns_tracking WHERE return_id = ?', [returnRec.id]);
    expect(tracking.loss_percentage).toBe(7.0);
    expect(tracking.expected_credit_amount).toBe(372.0);

    await db.close();
  });

  test('6. POST /api/returns/expiry-reviews/bulk-approve rejects missing percentage and processes custom percentage', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const distRes = await db.run("INSERT INTO distributors (name) VALUES ('Bulk Dist')");
    const distId = distRes.lastID;
    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Bulk Loss Med', 200)");
    const medId = medRes.lastID;

    const purchRes = await db.run("INSERT INTO purchases (distributor_id, invoice_no) VALUES (?, 'BLK-INV-1')", [distId]);
    await db.run(
      "INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BLK-BATCH-1', '01/20', 10, 150.0, 200.0)",
      [purchRes.lastID, medId]
    );

    const invRes = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'BLK-BATCH-1', '01/20', 10, 150.0, 200.0, 1)",
      [medId]
    );

    await scanAndCreateExpiryReviews(db as any);
    const review = await db.get('SELECT id FROM expiry_return_reviews WHERE inventory_id = ? AND status = "pending"', [invRes.lastID]);

    // A. Missing loss_percentage
    const missingRes = await request(app)
      .post('/api/returns/expiry-reviews/bulk-approve')
      .send({ ids: [review.id] });
    expect(missingRes.status).toBe(400);
    expect(missingRes.body.error).toContain('Return percentage required');

    // B. Valid 4.0% loss (Total = 10 * 150 = 1500; Expected = 1500 * 0.96 = 1440)
    const validRes = await request(app)
      .post('/api/returns/expiry-reviews/bulk-approve')
      .send({ ids: [review.id], loss_percentage: 4.0 });
    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);

    const updatedReview = await db.get('SELECT return_id FROM expiry_return_reviews WHERE id = ?', [review.id]);
    const tracking = await db.get('SELECT * FROM expiry_returns_tracking WHERE return_id = ?', [updatedReview.return_id]);
    expect(tracking.loss_percentage).toBe(4.0);
    expect(tracking.expected_credit_amount).toBe(1440.0);

    await db.close();
  });
});
