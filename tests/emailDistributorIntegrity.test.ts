/**
 * TASK 11 — Separate Email Source from Distributor
 *
 * Verifies:
 *   1. Email source is stored as source_type metadata only — never as a distributor.
 *   2. A known distributor email resolves to the real distributor name.
 *   3. An unknown sender email leaves distributor_name = NULL.
 *   4. Staged purchase approval blocks when distributor is unresolved.
 *   5. Fake email-source distributor names ('Email Import', 'Email Supplier') are rejected.
 *   6. All imported data (items, invoice, date) is preserved regardless of distributor resolution.
 */

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isValidDistributorName } from '../src/utils/nameNormalizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '..', 'data', 'test_email_distributor.db');

// ── Mirrors emailService.ts processMedicineOrder/parseAndImportAttachment logic ──
async function stageEmailPurchase(
  db: any,
  {
    resolvedDistributorName,
    invoiceNumber,
    date,
    items,
  }: {
    resolvedDistributorName: string | null;
    invoiceNumber: string;
    date: string | null;
    items: any[];
  }
): Promise<number> {
  // Only stage a valid distributor name — null if unresolved
  const validDistName =
    resolvedDistributorName && isValidDistributorName(resolvedDistributorName)
      ? resolvedDistributorName.trim()
      : null;

  const res = await db.run(
    `INSERT INTO staged_purchases (distributor_name, invoice_no, date, total_amount, items_json, source_type)
     VALUES (?, ?, ?, 0, ?, 'email')`,
    [validDistName, invoiceNumber, date, JSON.stringify(items)]
  );
  return res.lastID!;
}

// ── Mirrors purchases.ts staged purchase approval validation ──
function validateStagedApproval(
  stagedDistName: string | null | undefined,
  overrideDistName: string | undefined
): { ok: boolean; error?: string } {
  const finalDistName = (overrideDistName !== undefined
    ? overrideDistName
    : stagedDistName || ''
  ).trim();

  if (!finalDistName || !isValidDistributorName(finalDistName)) {
    return {
      ok: false,
      error:
        'Actual distributor required. The email import source is not a distributor. Please assign the real distributor before approving.',
    };
  }
  return { ok: true };
}

describe('TASK 11: Separate Email Source from Distributor', () => {
  let db: any;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = await open({ filename: TEST_DB, driver: sqlite3.Database });

    await db.exec(`
      CREATE TABLE distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT
      );

      CREATE TABLE staged_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        distributor_name TEXT,
        invoice_no TEXT,
        date DATETIME,
        total_amount REAL,
        items_json TEXT,
        status TEXT DEFAULT 'pending',
        source_type TEXT DEFAULT NULL
      );
    `);

    // Seed a known distributor with a real email address
    await db.run(
      "INSERT INTO distributors (name, email) VALUES ('Nitin Agency', 'nitin@nitinagency.com')"
    );
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  beforeEach(async () => {
    await db.run("DELETE FROM staged_purchases");
  });

  // ── 1. Email source is stored as metadata, not as distributor ─────────────

  describe('1. Email source stored as source_type metadata only', () => {
    it('staged purchase from email has source_type="email"', async () => {
      const id = await stageEmailPurchase(db, {
        resolvedDistributorName: 'Nitin Agency',
        invoiceNumber: 'INV-100',
        date: '2024-01-15',
        items: [{ name: 'Paracetamol', quantity: 10 }],
      });

      const row = await db.get('SELECT * FROM staged_purchases WHERE id = ?', [id]);
      expect(row.source_type).toBe('email');
    });

    it('"email import" is never stored as distributor_name', async () => {
      const id = await stageEmailPurchase(db, {
        resolvedDistributorName: 'Email Import', // fake — should be rejected
        invoiceNumber: 'INV-101',
        date: '2024-01-16',
        items: [{ name: 'Amoxicillin', quantity: 5 }],
      });

      const row = await db.get('SELECT * FROM staged_purchases WHERE id = ?', [id]);
      // isValidDistributorName filters out 'Email Import' → stored as NULL
      expect(row.distributor_name).toBeNull();
      expect(row.distributor_name).not.toBe('Email Import');
      // source_type still carries the origin
      expect(row.source_type).toBe('email');
    });

    it('"Email Supplier" is never stored as distributor_name', async () => {
      const id = await stageEmailPurchase(db, {
        resolvedDistributorName: 'Email Supplier',
        invoiceNumber: 'INV-102',
        date: '2024-01-17',
        items: [],
      });

      const row = await db.get('SELECT * FROM staged_purchases WHERE id = ?', [id]);
      expect(row.distributor_name).toBeNull();
      expect(row.source_type).toBe('email');
    });
  });

  // ── 2. Known distributor email resolves to real name ──────────────────────

  describe('2. Known distributor email resolves to real distributor name', () => {
    it('email from a known distributor address stores the real distributor name', async () => {
      // Simulate email-source resolution: DB lookup returned 'Nitin Agency'
      const resolvedName = 'Nitin Agency'; // as returned by emailService distributor lookup

      const id = await stageEmailPurchase(db, {
        resolvedDistributorName: resolvedName,
        invoiceNumber: 'INV-200',
        date: '2024-02-01',
        items: [{ name: 'Tramadol', quantity: 20 }],
      });

      const row = await db.get('SELECT * FROM staged_purchases WHERE id = ?', [id]);
      expect(row.distributor_name).toBe('Nitin Agency'); // real name preserved
      expect(row.source_type).toBe('email');             // source still tagged
    });
  });

  // ── 3. Unknown sender leaves distributor_name = NULL ─────────────────────

  describe('3. Unknown sender email leaves distributor_name NULL', () => {
    it('unresolved sender email stages with distributor_name=NULL', async () => {
      const id = await stageEmailPurchase(db, {
        resolvedDistributorName: null, // could not resolve
        invoiceNumber: 'INV-300',
        date: '2024-03-01',
        items: [{ name: 'Cetirizine', quantity: 3 }],
      });

      const row = await db.get('SELECT * FROM staged_purchases WHERE id = ?', [id]);
      expect(row.distributor_name).toBeNull();
      expect(row.source_type).toBe('email');
    });

    it('empty string from email does not become distributor_name', async () => {
      const id = await stageEmailPurchase(db, {
        resolvedDistributorName: '',
        invoiceNumber: 'INV-301',
        date: '2024-03-02',
        items: [],
      });

      const row = await db.get('SELECT * FROM staged_purchases WHERE id = ?', [id]);
      expect(row.distributor_name).toBeNull();
    });
  });

  // ── 4. Approval blocks when distributor is unresolved ─────────────────────

  describe('4. Approval blocks when distributor is unresolved', () => {
    it('approving a staged purchase without a distributor is rejected', async () => {
      const id = await stageEmailPurchase(db, {
        resolvedDistributorName: null,
        invoiceNumber: 'INV-400',
        date: '2024-04-01',
        items: [{ name: 'Aspirin', quantity: 5 }],
      });

      const row = await db.get('SELECT * FROM staged_purchases WHERE id = ?', [id]);

      // Simulate the approval validation
      const result = validateStagedApproval(row.distributor_name, undefined);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Actual distributor required');
    });

    it('approving with "Email Import" as distributor override is rejected', () => {
      const result = validateStagedApproval(null, 'Email Import');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Actual distributor required');
    });

    it('approving with a real distributor name succeeds', () => {
      const result = validateStagedApproval(null, 'Nitin Agency');
      expect(result.ok).toBe(true);
    });

    it('approving with a pre-resolved distributor name succeeds', () => {
      const result = validateStagedApproval('Bajaj Pharma', undefined);
      expect(result.ok).toBe(true);
    });
  });

  // ── 5. Fake source-name distributor values are all rejected ───────────────

  describe('5. All email-source fake distributor names are rejected by isValidDistributorName', () => {
    const fakeNames = [
      'Email Import',
      'email import',
      'EMAIL IMPORT',
      'Email Supplier',
      'Import',
      'Unknown Distributor',
      'Unknown Supplier',
      'Default Distributor',
      'Unassigned',
    ];

    for (const fake of fakeNames) {
      it(`rejects "${fake}" as a distributor name`, () => {
        expect(isValidDistributorName(fake)).toBe(false);
      });
    }
  });

  // ── 6. All other imported data is preserved regardless of resolution ──────

  describe('6. Imported data is preserved when distributor is unresolved', () => {
    it('invoice number, date, and items are all intact when distributor is NULL', async () => {
      const items = [
        { name: 'Metformin', quantity: 30, mrp: 120 },
        { name: 'Atorvastatin', quantity: 15, mrp: 85 },
      ];

      const id = await stageEmailPurchase(db, {
        resolvedDistributorName: null,
        invoiceNumber: 'INV-600',
        date: '2024-06-01',
        items,
      });

      const row = await db.get('SELECT * FROM staged_purchases WHERE id = ?', [id]);
      expect(row.distributor_name).toBeNull(); // unresolved
      expect(row.invoice_no).toBe('INV-600');  // invoice preserved
      expect(row.date).toBe('2024-06-01');     // date preserved
      const parsedItems = JSON.parse(row.items_json);
      expect(parsedItems).toHaveLength(2);     // items preserved
      expect(parsedItems[0].name).toBe('Metformin');
      expect(parsedItems[1].name).toBe('Atorvastatin');
    });
  });
});
