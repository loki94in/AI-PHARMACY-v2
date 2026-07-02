import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Investigation routes', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let inventoryId: number;
  let invoiceId: number;
  let purchaseId: number;
  let medicineId: number;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'investigation-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    process.env.DB_PATH = dbPath;

    const { default: investigationRouter } = await import('../src/routes/investigation.js');

    // Populate mock data
    const { open } = await import('sqlite');
    const { default: sqlite3 } = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    // 1. Insert Medicine
    const medRes = await db.run('INSERT INTO medicines (name, mrp) VALUES (?, ?)', ['Aspirin', 10.0]);
    medicineId = medRes.lastID!;

    // 2. Insert Inventory Master
    const invRes = await db.run(
      'INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, mrp, cost_price, loose_quantity) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [medicineId, 100, 'B123', '12/28', 10.0, 7.0]
    );
    inventoryId = invRes.lastID!;

    // 3. Insert Distributor & Purchase Bill
    const distRes = await db.run('INSERT INTO distributors (name) VALUES (?)', ['PharmaCorp']);
    const distributorId = distRes.lastID;
    const purRes = await db.run(
      'INSERT INTO purchases (distributor_id, invoice_no, total_amount) VALUES (?, ?, ?)',
      [distributorId, 'P-777', 700.0]
    );
    purchaseId = purRes.lastID!;
    await db.run(
      'INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [purchaseId, medicineId, 'B123', '12/28', 100, 0, 7.0, 10.0]
    );

    // 4. Insert Customer & Sales Invoice
    const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['John Doe', '9876543210']);
    const customerId = custRes.lastID;
    const saleRes = await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, tax_amount, discount, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
      ['S-999', customerId, 50.0, 2.5, 0.0, 50.0]
    );
    invoiceId = saleRes.lastID!;
    await db.run(
      'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, inventoryId, 5, 10.0, 0]
    );

    await db.close();

    app = express();
    app.use(express.json());
    app.use('/investigation', investigationRouter);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('GET /search with filter returns matching medicine', async () => {
    const res = await request(app).get('/investigation/search').query({ medicineName: 'Aspirin' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].medicine_name).toBe('Aspirin');
    expect(res.body[0].batch_no).toBe('B123');
  });

  test('GET /details/:inventoryId returns details, purchase/sale bills, and timeline', async () => {
    const res = await request(app).get(`/investigation/details/${inventoryId}`);
    expect(res.status).toBe(200);
    expect(res.body.inventory).toBeDefined();
    expect(res.body.inventory.medicine_name).toBe('Aspirin');
    expect(res.body.purchases.length).toBe(1);
    expect(res.body.purchases[0].invoice_no).toBe('P-777');
    expect(res.body.sales.length).toBe(1);
    expect(res.body.sales[0].invoice_no).toBe('S-999');
    expect(res.body.timeline.length).toBe(2);
  });

  test('PUT /inventory/:inventoryId updates direct inventory and logs action', async () => {
    const res = await request(app)
      .put(`/investigation/inventory/${inventoryId}`)
      .send({
        quantity: 120,
        loose_quantity: 5,
        batch_no: 'B123-NEW',
        expiry_date: '01/29',
        mrp: 11.0,
        cost_price: 8.0,
        rack_location: 'R1'
      });
    expect(res.status).toBe(200);

    // Verify change persisted
    const detailsRes = await request(app).get(`/investigation/details/${inventoryId}`);
    expect(detailsRes.body.inventory.quantity).toBe(120);
    expect(detailsRes.body.inventory.batch_no).toBe('B123-NEW');
    expect(detailsRes.body.inventory.expiry_date).toBe('01/29');

    // Verify audit logs
    const logsRes = await request(app).get(`/investigation/audit-logs/${inventoryId}`);
    expect(logsRes.status).toBe(200);
    expect(logsRes.body.length).toBeGreaterThan(0);
    expect(logsRes.body[0].action_type).toBe('INVENTORY_CORRECTION');
  });

  test('PUT /sales/:invoiceId edits sales bill and updates stock', async () => {
    // Current stock after direct inventory correction test is 120
    // Invoice S-999 has old sold quantity = 5.
    // Reverting it adds 5 back to inventory -> 125.
    // Correcting it to new sold quantity = 8 should subtract 8 -> remaining stock should be 117.
    const res = await request(app)
      .put(`/investigation/sales/${invoiceId}`)
      .send({
        items: [
          {
            inventory_id: inventoryId,
            quantity: 8,
            unit_price: 11.0,
            loose_qty: 0
          }
        ],
        discount: 2.0
      });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(90); // 8 * 11 = 88 subtotal. 88 * 0.05 = 4.4 tax. 88 + 4 - 2 discount = 90.

    // Verify stock
    const detailsRes = await request(app).get(`/investigation/details/${inventoryId}`);
    expect(detailsRes.body.inventory.quantity).toBe(117);
  });

  test('PUT /purchases/:purchaseId edits purchase bill and updates stock', async () => {
    // Current stock is 117.
    // Old purchased quantity in P-777 was 100.
    // Reverting it subtracts 100 -> 17.
    // Correcting it to new purchased quantity = 150 should add 150 -> remaining stock should be 167.
    const res = await request(app)
      .put(`/investigation/purchases/${purchaseId}`)
      .send({
        items: [
          {
            medicine_id: medicineId,
            batch_no: 'B123-NEW', // Match the updated inventory batch
            quantity: 150,
            cost_price: 8.0,
            mrp: 11.0
          }
        ]
      });
    expect(res.status).toBe(200);

    // Verify stock
    const detailsRes = await request(app).get(`/investigation/details/${inventoryId}`);
    expect(detailsRes.body.inventory.quantity).toBe(167);
  });

  test('GET /timeline with query filters returns matching results', async () => {
    // 1. Without filters, should return at least mock sale and purchase (2 items)
    let res = await request(app).get('/investigation/timeline');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);

    // 2. Filter by reference
    res = await request(app).get('/investigation/timeline').query({ reference: 'S-999' });
    expect(res.status).toBe(200);
    expect(res.body.data.every((tx: any) => tx.reference === 'S-999')).toBe(true);

    // 3. Filter by party
    res = await request(app).get('/investigation/timeline').query({ party: 'PharmaCorp' });
    expect(res.status).toBe(200);
    expect(res.body.data.every((tx: any) => tx.party === 'PharmaCorp')).toBe(true);
  });
});
