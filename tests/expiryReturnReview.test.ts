import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { scanAndCreateExpiryReviews } from '../src/services/returnsService.js';

describe('Task 4: Expiry Return Review & Removal of Automatic Returns', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expiry-review-test-'));
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

  test('1. Detection scan creates ONLY pending review items; inventory and returns remain UNTOUCHED', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed distributor, medicine, purchase, and expired inventory item
    const distRes = await db.run("INSERT INTO distributors (name, contact) VALUES ('Apollo Dist', '9876543210')");
    const distId = distRes.lastID;

    const medRes = await db.run("INSERT INTO medicines (name, mrp, pack_size) VALUES ('Paracetamol 650mg Expired', 30.0, 10)");
    const medId = medRes.lastID;

    const purchRes = await db.run(
      "INSERT INTO purchases (distributor_id, invoice_no, total_amount, date) VALUES (?, 'INV-9901', 500, '2020-01-01')",
      [distId]
    );
    const purchId = purchRes.lastID;

    await db.run(
      "INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'B-EXP-001', '01/20', 25, 20.0, 30.0)",
      [purchId, medId]
    );

    // Active inventory with expired date
    const invRes = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, loose_quantity, cost_price, mrp, is_active) VALUES (?, 'B-EXP-001', '01/20', 25, 0, 20.0, 30.0, 1)",
      [medId]
    );
    const invId = invRes.lastID;

    // Run scheduler scan
    const scanResult = await scanAndCreateExpiryReviews(db as any);
    expect(scanResult.expiredCount).toBeGreaterThanOrEqual(1);
    expect(scanResult.pendingCreated).toBeGreaterThanOrEqual(1);

    // Verify Pending Review item created in database
    const review = await db.get(
      'SELECT * FROM expiry_return_reviews WHERE inventory_id = ? AND status = "pending"',
      [invId]
    );
    expect(review).toBeDefined();
    expect(review.medicine_id).toBe(medId);
    expect(review.batch_no).toBe('B-EXP-001');
    expect(review.quantity).toBe(25);
    expect(review.status).toBe('pending');
    expect(review.proposed_return_amount).toBe(500); // 25 * 20

    // VERIFY CRITICAL SAFETY RULES:
    // A. Inventory MUST BE UNCHANGED
    const invAfterScan = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [invId]);
    expect(invAfterScan.quantity).toBe(25);

    // B. No completed return record created
    const returnCount = await db.get('SELECT COUNT(*) as cnt FROM returns');
    expect(returnCount.cnt).toBe(0);

    // C. No return items created
    const returnItemsCount = await db.get('SELECT COUNT(*) as cnt FROM return_items');
    expect(returnItemsCount.cnt).toBe(0);

    // D. Action log records pending alert
    const actionLog = await db.get(
      "SELECT * FROM action_logs WHERE action_type = 'EXPIRY_REVIEW_PENDING' ORDER BY id DESC LIMIT 1"
    );
    expect(actionLog).toBeDefined();
    expect(actionLog.description).toContain('B-EXP-001');

    await db.close();
  });

  test('2. GET /api/returns/expiry-reviews returns pending reviews with summary stats', async () => {
    const res = await request(app).get('/api/returns/expiry-reviews?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.reviews)).toBe(true);
    expect(res.body.reviews.length).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.pendingCount).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.pendingAmount).toBeGreaterThanOrEqual(500);

    const pendingItem = res.body.reviews.find((r: any) => r.batch_no === 'B-EXP-001');
    expect(pendingItem).toBeDefined();
    expect(pendingItem.status).toBe('pending');
    expect(pendingItem.medicine_name).toContain('Paracetamol');
  });

  test('3. Pharmacist approval creates return, deducts inventory, records ledger & credit note, and writes audit trail', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const review = await db.get(
      'SELECT id, inventory_id FROM expiry_return_reviews WHERE batch_no = "B-EXP-001" AND status = "pending"'
    );
    expect(review).toBeDefined();

    // Call approval endpoint
    const res = await request(app)
      .post(`/api/returns/expiry-reviews/${review.id}/approve`)
      .send({ notes: 'Verified and approved for supplier debit note', loss_percentage: 3.0 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.returnNo).toMatch(/^PR-\d+/);
    const returnId = res.body.returnId;

    // Verify Expiry Review updated to approved
    const updatedReview = await db.get('SELECT * FROM expiry_return_reviews WHERE id = ?', [review.id]);
    expect(updatedReview.status).toBe('approved');
    expect(updatedReview.reviewed_by).toBe('Pharmacist');
    expect(updatedReview.return_id).toBe(returnId);

    // Verify Inventory deducted
    const invAfterApprove = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [review.inventory_id]);
    expect(invAfterApprove.quantity).toBe(0);

    // Verify Return record created
    const returnRecord = await db.get('SELECT * FROM returns WHERE id = ?', [returnId]);
    expect(returnRecord).toBeDefined();
    expect(returnRecord.type).toBe('purchase');
    expect(returnRecord.return_sub_type).toBe('expiry');
    expect(returnRecord.total_amount).toBe(500);

    // Verify Return Line Items created
    const returnItem = await db.get('SELECT * FROM return_items WHERE return_id = ?', [returnId]);
    expect(returnItem).toBeDefined();
    expect(returnItem.quantity).toBe(25);
    expect(returnItem.total_price).toBe(500);

    // Verify Stock Ledger entry written
    const ledgerEntry = await db.get(
      "SELECT * FROM stock_ledger WHERE transaction_id = ? AND transaction_type = 'return_to_distributor'",
      [returnId]
    );
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.quantity).toBe(-25);

    // Verify Credit Note tracking created
    const creditNote = await db.get(
      'SELECT * FROM expiry_returns_tracking WHERE return_id = ?',
      [returnId]
    );
    expect(creditNote).toBeDefined();
    expect(creditNote.expected_credit_amount).toBe(485); // 500 minus 3% standard margin loss = 485

    // Verify Audit log entry written
    const auditLog = await db.get(
      "SELECT * FROM action_logs WHERE action_type = 'EXPIRY_RETURN_APPROVED' ORDER BY id DESC LIMIT 1"
    );
    expect(auditLog).toBeDefined();
    expect(auditLog.description).toContain('Pharmacist approved expiry return');

    await db.close();
  });

  test('4. Pharmacist rejection marks review rejected and leaves inventory unchanged', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const medRes = await db.run("INSERT INTO medicines (name, mrp, pack_size) VALUES ('Amoxicillin 500mg Expired', 100.0, 10)");
    const medId = medRes.lastID;

    const invRes = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, loose_quantity, cost_price, mrp, is_active) VALUES (?, 'B-REJ-999', '02/20', 15, 0, 70.0, 100.0, 1)",
      [medId]
    );
    const invId = invRes.lastID;

    // Run scan
    await scanAndCreateExpiryReviews(db as any);

    const review = await db.get(
      'SELECT id FROM expiry_return_reviews WHERE inventory_id = ? AND status = "pending"',
      [invId]
    );
    expect(review).toBeDefined();

    // Call reject endpoint
    const res = await request(app)
      .post(`/api/returns/expiry-reviews/${review.id}/reject`)
      .send({ notes: 'Physical batch re-check: Medicine relocated to quarantine' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify review status is rejected
    const updatedReview = await db.get('SELECT * FROM expiry_return_reviews WHERE id = ?', [review.id]);
    expect(updatedReview.status).toBe('rejected');

    // Verify Inventory is STILL 15 (UNTOUCHED)
    const invAfterReject = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [invId]);
    expect(invAfterReject.quantity).toBe(15);

    // Verify Audit log recorded
    const auditLog = await db.get(
      "SELECT * FROM action_logs WHERE action_type = 'EXPIRY_RETURN_REJECTED' ORDER BY id DESC LIMIT 1"
    );
    expect(auditLog).toBeDefined();
    expect(auditLog.description).toContain('Pharmacist rejected');

    await db.close();
  });

  test('5. Bulk approval processes multiple pending reviews correctly', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const med1 = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Bulk Med 1', 50.0)");
    const med2 = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Bulk Med 2', 80.0)");

    const inv1 = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'BULK-1', '03/20', 10, 35.0, 50.0, 1)",
      [med1.lastID]
    );
    const inv2 = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'BULK-2', '04/20', 8, 60.0, 80.0, 1)",
      [med2.lastID]
    );

    // Run scan
    await scanAndCreateExpiryReviews(db as any);

    const r1 = await db.get('SELECT id FROM expiry_return_reviews WHERE inventory_id = ? AND status = "pending"', [inv1.lastID]);
    const r2 = await db.get('SELECT id FROM expiry_return_reviews WHERE inventory_id = ? AND status = "pending"', [inv2.lastID]);

    const res = await request(app)
      .post('/api/returns/expiry-reviews/bulk-approve')
      .send({ ids: [r1.id, r2.id], loss_percentage: 3.0 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.approvedCount).toBe(2);

    // Verify both inventories are 0
    const invCheck1 = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [inv1.lastID]);
    const invCheck2 = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [inv2.lastID]);
    expect(invCheck1.quantity).toBe(0);
    expect(invCheck2.quantity).toBe(0);

    // Verify both reviews are approved
    const revCheck1 = await db.get('SELECT status FROM expiry_return_reviews WHERE id = ?', [r1.id]);
    const revCheck2 = await db.get('SELECT status FROM expiry_return_reviews WHERE id = ?', [r2.id]);
    expect(revCheck1.status).toBe('approved');
    expect(revCheck2.status).toBe('approved');

    await db.close();
  });

  test('6. GET /api/returns/expiry-reviews/audit-history returns full history log', async () => {
    const res = await request(app).get('/api/returns/expiry-reviews/audit-history');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(3);
  });

  test('7. Repeated scheduler execution does NOT duplicate pending or approved returns', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed expired medicine with inventory
    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Idempotency Test Med', 40.0)");
    const medId = medRes.lastID;
    const invRes = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'IDEMP-001', '01/20', 12, 25.0, 40.0, 1)",
      [medId]
    );
    const invId = invRes.lastID;

    // Run scheduler 1st time
    const res1 = await scanAndCreateExpiryReviews(db as any);
    expect(res1.pendingCreated).toBe(1);

    // Verify exactly 1 pending review exists
    const reviews1 = await db.all('SELECT * FROM expiry_return_reviews WHERE inventory_id = ?', [invId]);
    expect(reviews1.length).toBe(1);
    expect(reviews1[0].status).toBe('pending');
    expect(reviews1[0].quantity).toBe(12);

    // Run scheduler 2nd time (should NOT create a duplicate)
    const res2 = await scanAndCreateExpiryReviews(db as any);
    expect(res2.pendingCreated).toBe(0);

    const reviews2 = await db.all('SELECT * FROM expiry_return_reviews WHERE inventory_id = ?', [invId]);
    expect(reviews2.length).toBe(1);

    // Verify inventory still unchanged at 12
    const invBeforeApprove = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [invId]);
    expect(invBeforeApprove.quantity).toBe(12);

    // Now Pharmacist approves the pending review
    const approveRes = await request(app)
      .post(`/api/returns/expiry-reviews/${reviews1[0].id}/approve`)
      .send({ loss_percentage: 0.0 });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.success).toBe(true);

    // Verify inventory deducted to 0
    const invAfterApprove = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [invId]);
    expect(invAfterApprove.quantity).toBe(0);

    // Run scheduler 3rd time (after approval: inventory is 0, so no new review created)
    const res3 = await scanAndCreateExpiryReviews(db as any);
    expect(res3.pendingCreated).toBe(0);

    const reviews3 = await db.all('SELECT * FROM expiry_return_reviews WHERE inventory_id = ?', [invId]);
    expect(reviews3.length).toBe(1);
    expect(reviews3[0].status).toBe('approved');

    // Verify exactly 1 return was created for this batch
    const returnsForMed = await db.all('SELECT * FROM return_items WHERE batch_no = "IDEMP-001"');
    expect(returnsForMed.length).toBe(1);

    await db.close();
  });

  test('8. Scan does NOT re-flag rejected reviews with unchanged quantity, but re-flags when stock changes', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Reject Dedupe Med', 30.0)");
    const medId = medRes.lastID;
    const invRes = await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, 'REJ-DUP-1', '05/20', 7, 15.0, 30.0)",
      [medId]
    );
    const invId = invRes.lastID;

    // First scan flags the expired batch as pending
    await scanAndCreateExpiryReviews(db as any);
    let reviews = await db.all('SELECT * FROM expiry_return_reviews WHERE inventory_id = ?', [invId]);
    expect(reviews.length).toBe(1);
    expect(reviews[0].status).toBe('pending');

    // Pharmacist rejects it
    const rejRes = await request(app)
      .post(`/api/returns/expiry-reviews/${reviews[0].id}/reject`)
      .send({ notes: 'Keep in quarantine' });
    expect(rejRes.status).toBe(200);

    // Second scan: same batch, same quantity -> must NOT re-create a review
    await scanAndCreateExpiryReviews(db as any);
    reviews = await db.all('SELECT * FROM expiry_return_reviews WHERE inventory_id = ?', [invId]);
    expect(reviews.length).toBe(1);
    expect(reviews[0].status).toBe('rejected');

    // Stock changes afterwards (e.g. customer-return restock) -> re-flagged
    await db.run('UPDATE inventory_master SET quantity = quantity + 5 WHERE id = ?', [invId]);
    await scanAndCreateExpiryReviews(db as any);
    reviews = await db.all('SELECT * FROM expiry_return_reviews WHERE inventory_id = ? ORDER BY id', [invId]);
    expect(reviews.length).toBe(2);
    expect(reviews[1].status).toBe('pending');
    expect(reviews[1].quantity).toBe(12);

    // Inventory untouched throughout
    const invFinal = await db.get('SELECT quantity FROM inventory_master WHERE id = ?', [invId]);
    expect(invFinal.quantity).toBe(12);

    await db.close();
  });
});
