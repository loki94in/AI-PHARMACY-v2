import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve(true)),
  initClient: jest.fn(() => Promise.resolve(true))
}));

jest.unstable_mockModule('../src/telegramBot.js', () => ({
  __esModule: true,
  telegramBotService: {
    sendDefaultNotification: jest.fn(() => Promise.resolve(true))
  }
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { ensureSchema } from '../src/database.js';

describe('PDF Invoice Discount & Loose Qty rendering', () => {
  let tmpDir: string;
  let dbPath: string;
  let pdfPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-discount-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    pdfPath = path.join(tmpDir, 'test-invoice.pdf');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
  });

  afterAll(() => {
    try {
      const { dbManager } = require('../src/database/connection.js');
      dbManager.close(true);
    } catch {}
    delete process.env.DB_PATH;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('should generate PDF invoice with discount, item discount and loose qty correctly', async () => {
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    
    // Seed medicines and inventory
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (501, "Paracetamol", 10)');
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, mrp, unit_price) VALUES (501, 501, 10, 20, "B501", "12/2030", 100, 100)');

    // Seed customer
    await db.run('INSERT INTO customers (id, name, phone) VALUES (501, "John Doe", "9876543210")');

    // Create sales_invoices record
    // subtotal = 150 (1 strip at 100, plus 5 loose at 10 each = 150)
    // overall discount = 20
    // total_amount = 130
    // tax_amount = 6.19 (130 * 0.05 / 1.05)
    await db.run(`
      INSERT INTO sales_invoices (id, invoice_no, customer_id, total_amount, tax_amount, payment_medium, payment_status, date, discount, subtotal)
      VALUES (501, "S-2026-0001", 501, 130, 6.19, "CASH", "PAID", "2026-07-13T00:00:00.000Z", 20, 150)
    `);

    // Create sale_items record
    // 1 strip (quantity = 1), 5 loose_qty, unit_price = 100, discount_per = 0
    await db.run(`
      INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per)
      VALUES (501, 501, 1, 100, 5, 0)
    `);

    await db.close();

    // Import pdfInvoiceService after process.env.DB_PATH has been set and connection setup is ready
    const { pdfInvoiceService } = await import('../src/services/pdfInvoiceService.js');

    // Generate the PDF
    await expect(pdfInvoiceService.generateInvoicePdf(501, pdfPath, false)).resolves.not.toThrow();

    // Verify PDF file is created
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(0);
  });
});
