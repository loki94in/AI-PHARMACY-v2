/**
 * Task 15 — Project Readiness / Business-Data Integrity Audit Engine.
 *
 * Every check below queries live application data (or, where DB signal doesn't
 * exist, does a fresh source-content scan) at the moment `runAudit()` is called.
 * Nothing here is a hardcoded finding — CLEAN/ISSUE is recomputed each run, so
 * the result reflects the database and code actually in front of the auditor,
 * not a snapshot frozen at the time this file was written.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { isValidDistributorName, isValidCustomerName } from './nameNormalizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type CategoryStatus = 'CLEAN' | 'ISSUE';

export interface AuditFinding {
  id: string;
  category: string;
  severity: Severity;
  summary: string;          // what is wrong
  where: string;             // file / table / location
  codeFixAvailable: boolean;
  userActionRequired: boolean;
  exactAction: string;
  evidenceCount?: number;
}

export interface CategoryResult {
  category: string;
  status: CategoryStatus;
  findings: AuditFinding[];
}

export interface AuditReport {
  timestamp: string;
  appVersion: string;
  buildId: string;
  categories: CategoryResult[];
  findings: AuditFinding[];
  totalCategories: number;
  cleanCategories: number;
  issueCategories: number;
  blockingCount: number;
  status: 'PROJECT READY' | 'PROJECT NOT READY';
}

export const REQUIRED_CATEGORIES = [
  'POS', 'Inventory', 'Purchases', 'Purchase History', 'Sales',
  'Customer Returns', 'Supplier Returns', 'Expiry', 'OCR', 'Email Import',
  'Migration', 'Mobile', 'WhatsApp', 'Compliance', 'Reports',
  'PDF Invoices', 'Settings', 'Database Integrity',
] as const;

type Db = {
  get: (sql: string, params?: any[]) => Promise<any>;
  all: (sql: string, params?: any[]) => Promise<any[]>;
  run: (sql: string, params?: any[]) => Promise<any>;
};

function finding(f: Omit<AuditFinding, 'id'> & { id: string }): AuditFinding {
  return f;
}

async function tableExists(db: Db, name: string): Promise<boolean> {
  const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]);
  return !!row;
}

async function columnExists(db: Db, table: string, column: string): Promise<boolean> {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return cols.some((c: any) => String(c.name).toLowerCase() === column.toLowerCase());
}

// ── POS ──────────────────────────────────────────────────────────────────────
async function auditPOS(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  const placeholderNames = [
    'walk-in patient', 'walk-in customer', 'walk in customer', 'walk-in', 'walk in',
    'unnamed customer', 'unnamed', 'customer', 'patient', 'unknown customer', 'unknown',
  ];
  if (await tableExists(db, 'customers')) {
    const rows = await db.all('SELECT id, name FROM customers');
    const bad = rows.filter(r => placeholderNames.includes(String(r.name || '').trim().toLowerCase()));
    if (bad.length > 0) {
      findings.push(finding({
        id: 'POS-CUSTOMER-NAME', category: 'POS', severity: 'MEDIUM',
        summary: `${bad.length} customer record(s) exist with a fabricated placeholder name instead of a real patient name.`,
        where: 'customers.name',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Open CRM → Customers, search for "Walk-in Patient" / "Customer" / "Unnamed" entries, and replace with the real patient name where known. Always enter the real name during billing/refill registration going forward.',
        evidenceCount: bad.length,
      }));
    }
  }
  return { category: 'POS', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Inventory ────────────────────────────────────────────────────────────────
async function auditInventory(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  const negative = await db.get('SELECT COUNT(*) c FROM inventory_master WHERE quantity < 0 OR loose_quantity < 0');
  if (negative.c > 0) {
    findings.push(finding({
      id: 'INV-NEGATIVE-QTY', category: 'Inventory', severity: 'HIGH',
      summary: `${negative.c} inventory batch(es) hold a negative quantity or loose_quantity — impossible stock state.`,
      where: 'inventory_master.quantity / loose_quantity',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Open Investigation Center → Inventory Ledger, filter for negative stock, and reconcile against the actual physical count before any further sale/purchase touches that batch.',
      evidenceCount: negative.c,
    }));
  }
  const noBatch = await db.get("SELECT COUNT(*) c FROM inventory_master WHERE quantity > 0 AND (batch_no IS NULL OR TRIM(batch_no) = '')");
  if (noBatch.c > 0) {
    findings.push(finding({
      id: 'INV-MISSING-BATCH', category: 'Inventory', severity: 'MEDIUM',
      summary: `${noBatch.c} inventory row(s) carry real stock (quantity > 0) with no batch number.`,
      where: 'inventory_master.batch_no',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Open Inventory and assign the correct batch number to each flagged row so the stock is traceable to its source purchase.',
      evidenceCount: noBatch.c,
    }));
  }
  return { category: 'Inventory', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Purchases ────────────────────────────────────────────────────────────────
async function auditPurchases(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  const noDist = await db.get('SELECT COUNT(*) c FROM purchases WHERE distributor_id IS NULL');
  if (noDist.c > 0) {
    findings.push(finding({
      id: 'PUR-NO-DISTRIBUTOR', category: 'Purchases', severity: 'HIGH',
      summary: `${noDist.c} purchase record(s) exist with no distributor linked at all.`,
      where: 'purchases.distributor_id',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Open Purchases, locate the flagged invoice(s), and assign the real distributor. Current purchase entry already blocks this for new purchases — these are pre-existing rows that must be corrected manually.',
      evidenceCount: noDist.c,
    }));
  }
  if (await tableExists(db, 'purchase_items')) {
    const badMrp = await db.get('SELECT COUNT(*) c FROM purchase_items WHERE mrp IS NULL OR mrp <= 0');
    if (badMrp.c > 0) {
      findings.push(finding({
        id: 'PUR-MISSING-MRP', category: 'Purchases', severity: 'HIGH',
        summary: `${badMrp.c} purchase line item(s) have no real MRP (NULL or zero).`,
        where: 'purchase_items.mrp',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Open the affected purchase invoice and enter the actual MRP from the distributor bill for each flagged item. Never estimate MRP from the purchase rate.',
        evidenceCount: badMrp.c,
      }));
    }
  }
  return { category: 'Purchases', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Purchase History ─────────────────────────────────────────────────────────
async function auditPurchaseHistory(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  const noInvoice = await db.get("SELECT COUNT(*) c FROM purchases WHERE invoice_no IS NULL OR TRIM(invoice_no) = ''");
  if (noInvoice.c > 0) {
    findings.push(finding({
      id: 'PURH-NO-INVOICE-NO', category: 'Purchase History', severity: 'MEDIUM',
      summary: `${noInvoice.c} historical purchase record(s) have no real invoice number stored.`,
      where: 'purchases.invoice_no',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Open Purchase History, locate records with a blank invoice number, and attach the actual distributor invoice number if it can be recovered. Do not fabricate one.',
      evidenceCount: noInvoice.c,
    }));
  }
  return { category: 'Purchase History', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Sales ────────────────────────────────────────────────────────────────────
async function auditSales(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  if (await tableExists(db, 'sale_items')) {
    const badPrice = await db.get('SELECT COUNT(*) c FROM sale_items WHERE unit_price <= 0');
    if (badPrice.c > 0) {
      findings.push(finding({
        id: 'SALES-ZERO-PRICE', category: 'Sales', severity: 'HIGH',
        summary: `${badPrice.c} sold line item(s) were billed at a zero or negative unit price.`,
        where: 'sale_items.unit_price',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Open Investigation Center → Ledger, locate the affected sale(s), and correct the pricing. A sale must never post at ₹0 or a negative amount unless it is an explicit, documented free-goods entry.',
        evidenceCount: badPrice.c,
      }));
    }
    const badQty = await db.get('SELECT COUNT(*) c FROM sale_items WHERE quantity <= 0');
    if (badQty.c > 0) {
      findings.push(finding({
        id: 'SALES-ZERO-QTY', category: 'Sales', severity: 'HIGH',
        summary: `${badQty.c} sale line item(s) recorded a zero or negative quantity.`,
        where: 'sale_items.quantity',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Review and correct the flagged sale line items — a sale must always move a real, positive quantity of stock.',
        evidenceCount: badQty.c,
      }));
    }
  }
  return { category: 'Sales', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Customer Returns (returns.type = 'sale') ────────────────────────────────
async function auditCustomerReturns(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  if (await tableExists(db, 'returns')) {
    const contradiction = await db.get(
      "SELECT COUNT(*) c FROM returns WHERE type = 'sale' AND reason = 'Supplier Return'"
    );
    if (contradiction.c > 0) {
      findings.push(finding({
        id: 'CRET-REASON-MISMATCH', category: 'Customer Returns', severity: 'MEDIUM',
        summary: `${contradiction.c} customer return(s) carry the backend default reason "Supplier Return", which does not describe a customer-facing return — the reason was likely never actually submitted by the user.`,
        where: 'returns.reason (routes/returns.ts fallback)',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Open Returns, locate the flagged customer return(s), and set the real return reason (Expiry / Damaged / Wrong item / etc). Always select a reason in the Returns form before submitting.',
        evidenceCount: contradiction.c,
      }));
    }
  }
  return { category: 'Customer Returns', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Supplier Returns (returns.type = 'purchase') ────────────────────────────
async function auditSupplierReturns(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  if (await tableExists(db, 'returns')) {
    const noDist = await db.get("SELECT COUNT(*) c FROM returns WHERE type = 'purchase' AND distributor_id IS NULL");
    if (noDist.c > 0) {
      findings.push(finding({
        id: 'SRET-NO-DISTRIBUTOR', category: 'Supplier Returns', severity: 'HIGH',
        summary: `${noDist.c} supplier return(s) have no distributor linked.`,
        where: 'returns.distributor_id',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Open Returns, locate the flagged supplier return(s), and link the real distributor that the stock is being returned to.',
        evidenceCount: noDist.c,
      }));
    }
  }
  return { category: 'Supplier Returns', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Expiry ───────────────────────────────────────────────────────────────────
async function auditExpiry(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  if (await tableExists(db, 'expiry_return_reviews')) {
    const unaccountable = await db.get(
      "SELECT COUNT(*) c FROM expiry_return_reviews WHERE status = 'approved' AND (reviewed_by IS NULL OR TRIM(reviewed_by) = '' OR reviewed_at IS NULL)"
    );
    if (unaccountable.c > 0) {
      findings.push(finding({
        id: 'EXP-UNACCOUNTABLE-APPROVAL', category: 'Expiry', severity: 'HIGH',
        summary: `${unaccountable.c} expiry return(s) are marked "approved" with no recorded reviewer/timestamp — an approval must always be traceable to a human action.`,
        where: 'expiry_return_reviews.reviewed_by / reviewed_at',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Open Expiry → review the flagged approvals and confirm who actually approved them. If this occurred through an automated path, that path must be corrected — expiry returns must always go through explicit user approval.',
        evidenceCount: unaccountable.c,
      }));
    }
  }
  return { category: 'Expiry', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── OCR ──────────────────────────────────────────────────────────────────────
const BANNED_BATCH_STRINGS = ['BATCH123', 'B-GEN', 'B-CATALOG', 'B-IMPORT', 'B-OFFLINE', 'B-REISSUE', 'B-MANUAL', 'B-NEW'];
async function auditOCR(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  const placeholders = BANNED_BATCH_STRINGS.map(() => 'batch_no = ?').join(' OR ');
  const rows = await db.all(`SELECT batch_no, COUNT(*) c FROM inventory_master WHERE ${placeholders} GROUP BY batch_no`, BANNED_BATCH_STRINGS);
  const total = rows.reduce((s, r) => s + r.c, 0);
  if (total > 0) {
    findings.push(finding({
      id: 'OCR-DUMMY-BATCH', category: 'OCR', severity: 'HIGH',
      summary: `${total} inventory row(s) carry a known dummy/placeholder batch identifier (${rows.map(r => r.batch_no).join(', ')}).`,
      where: 'inventory_master.batch_no',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Open Inventory, locate rows using a placeholder batch number, and replace it with the real batch number from the physical package or purchase invoice.',
      evidenceCount: total,
    }));
  }
  return { category: 'OCR', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Email Import ─────────────────────────────────────────────────────────────
async function auditEmailImport(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  const distributors = await db.all('SELECT id, name FROM distributors');
  const bad = distributors.filter(d => !isValidDistributorName(d.name));
  if (bad.length > 0) {
    findings.push(finding({
      id: 'EMAIL-FAKE-DISTRIBUTOR', category: 'Email Import', severity: 'HIGH',
      summary: `${bad.length} distributor record(s) in the database are placeholder/channel names, not real suppliers (e.g. ${bad.slice(0, 5).map(b => `"${b.name}"`).join(', ')}).`,
      where: 'distributors.name',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Open Purchases → Distributors, find the flagged placeholder entries, re-point any purchases linked to them at the real distributor, then delete the placeholder distributor record.',
      evidenceCount: bad.length,
    }));
  }
  return { category: 'Email Import', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Migration ────────────────────────────────────────────────────────────────
async function auditMigration(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  const ghost = await db.get(
    "SELECT COUNT(*) c FROM inventory_master WHERE (batch_no IS NULL OR TRIM(batch_no) = '') AND quantity = 0 AND loose_quantity = 0"
  );
  if (ghost.c > 0) {
    findings.push(finding({
      id: 'MIG-GHOST-INVENTORY', category: 'Migration', severity: 'HIGH',
      summary: `${ghost.c} zero-stock "ghost" inventory row(s) with no batch number exist — created to satisfy foreign-key references for migrated sales that had no matching inventory record.`,
      where: 'inventory_master (batch_no empty, quantity=0)',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Open Investigation Center → Inventory Ledger, filter for batch_no = "" (empty), and review each row: either link it to the real historical purchase or delete it if it cannot be resolved.',
      evidenceCount: ghost.c,
    }));
  }
  if (await tableExists(db, 'medicines')) {
    const legacy = await db.get("SELECT COUNT(*) c FROM medicines WHERE name LIKE 'LEGACY\\_MEDICINE\\_%' ESCAPE '\\'");
    if (legacy.c > 0) {
      findings.push(finding({
        id: 'MIG-LEGACY-MEDICINE-NAME', category: 'Migration', severity: 'HIGH',
        summary: `${legacy.c} medicine master record(s) still carry a generated "LEGACY_MEDICINE_<id>" name instead of a real medicine name.`,
        where: 'medicines.name',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Open Database/Migration review, identify each LEGACY_MEDICINE_ row, and either map it to the correct real medicine or remove it if it never sold.',
        evidenceCount: legacy.c,
      }));
    }
  }
  return { category: 'Migration', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Mobile ───────────────────────────────────────────────────────────────────
async function auditMobile(): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  try {
    const botPath = path.resolve(__dirname, '..', 'telegramBot.ts');
    if (fs.existsSync(botPath)) {
      const src = fs.readFileSync(botPath, 'utf8');
      const suspicious = /const\s+(FAKE|MOCK|DUMMY|SAMPLE)_?(STOCK|INVENTORY|MEDICINE)/i.test(src);
      if (suspicious) {
        findings.push(finding({
          id: 'MOBILE-FABRICATED-DATA', category: 'Mobile', severity: 'HIGH',
          summary: 'telegramBot.ts appears to define a hardcoded stock/inventory data block instead of reading live inventory.',
          where: 'src/telegramBot.ts',
          codeFixAvailable: true, userActionRequired: false,
          exactAction: 'Remove the hardcoded data block and replace it with a live query against inventory_master.',
        }));
      }
    }
  } catch (_e) {
    // Source scan is best-effort only; absence of the file is not itself a finding.
  }
  return { category: 'Mobile', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────
async function auditWhatsApp(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  if (await tableExists(db, 'delivery_boys')) {
    const badNumber = await db.get("SELECT COUNT(*) c FROM delivery_boys WHERE whatsapp_number LIKE '%99999 99999%' OR whatsapp_number = '+919999999999'");
    if (badNumber.c > 0) {
      findings.push(finding({
        id: 'WA-PLACEHOLDER-NUMBER', category: 'WhatsApp', severity: 'HIGH',
        summary: `${badNumber.c} delivery boy record(s) store the placeholder number pattern (+91 99999 99999) as a real WhatsApp contact.`,
        where: 'delivery_boys.whatsapp_number',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Open Settings → Delivery Boys and replace the placeholder number with the real WhatsApp number for that delivery staff member.',
        evidenceCount: badNumber.c,
      }));
    }
    const activeBoy = await db.get("SELECT COUNT(*) c FROM delivery_boys WHERE is_active = 1 AND whatsapp_number IS NOT NULL AND whatsapp_number != ''");
    const adminFallback = await db.get("SELECT value FROM app_settings WHERE key IN ('store_admin_whatsapp','admin_whatsapp_number') AND value IS NOT NULL AND TRIM(value) != '' LIMIT 1");
    if (activeBoy.c === 0 && !adminFallback) {
      findings.push(finding({
        id: 'WA-NO-DELIVERY-CONTACT', category: 'WhatsApp', severity: 'MEDIUM',
        summary: 'No active delivery boy with a WhatsApp number is configured, and no store-admin fallback WhatsApp number is set in Settings.',
        where: 'delivery_boys / app_settings',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Add at least one active delivery boy with a real WhatsApp number, or configure a store-admin fallback WhatsApp number in Settings, so order-ready notifications have a valid recipient.',
      }));
    }
  }
  return { category: 'WhatsApp', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Compliance ───────────────────────────────────────────────────────────────
async function auditCompliance(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  if (await tableExists(db, 'compliance_logs')) {
    const fake = await db.get("SELECT COUNT(*) c FROM compliance_logs WHERE license_no = 'REG-NA'");
    if (fake.c > 0) {
      findings.push(finding({
        id: 'COMP-REG-NA', category: 'Compliance', severity: 'HIGH',
        summary: `${fake.c} compliance record(s) still store the fake license placeholder "REG-NA".`,
        where: 'compliance_logs.license_no',
        codeFixAvailable: true, userActionRequired: false,
        exactAction: 'Open the Compliance page once — GET /api/compliance automatically sanitizes REG-NA rows to missing_license=1 on load.',
        evidenceCount: fake.c,
      }));
    }
    if (await columnExists(db, 'compliance_logs', 'missing_license')) {
      const missing = await db.get('SELECT COUNT(*) c FROM compliance_logs WHERE missing_license = 1');
      if (missing.c > 0) {
        findings.push(finding({
          id: 'COMP-MISSING-LICENSE', category: 'Compliance', severity: 'MEDIUM',
          summary: `${missing.c} Schedule H/H1 dispensing record(s) are missing a real doctor registration/license number.`,
          where: 'compliance_logs.missing_license',
          codeFixAvailable: false, userActionRequired: true,
          exactAction: 'Open Compliance and enter the correct doctor registration number for each flagged record.',
          evidenceCount: missing.c,
        }));
      }
    }
  }
  return { category: 'Compliance', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Reports ──────────────────────────────────────────────────────────────────
async function auditReports(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  if (await tableExists(db, 'summary_cache')) {
    const rows = await db.all('SELECT cache_key, cache_value FROM summary_cache');
    const bad = rows.filter(r => /REG-NA|LEGACY_MEDICINE_|Default Distributor/i.test(String(r.cache_value || '')));
    if (bad.length > 0) {
      findings.push(finding({
        id: 'REP-STALE-CACHE', category: 'Reports', severity: 'LOW',
        summary: `${bad.length} cached report entr(y/ies) still contain a known placeholder value, meaning the cache predates the underlying data fix.`,
        where: 'summary_cache.cache_value',
        codeFixAvailable: true, userActionRequired: false,
        exactAction: 'Cache will refresh automatically on next write; force a refresh from Reports if needed.',
        evidenceCount: bad.length,
      }));
    }
  }
  return { category: 'Reports', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── PDF Invoices ─────────────────────────────────────────────────────────────
async function auditPdfInvoices(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  const legacyPurchase = await db.get("SELECT COUNT(*) c FROM purchases WHERE invoice_no LIKE 'LEGACY-%'");
  const legacyReturn = (await tableExists(db, 'returns'))
    ? await db.get("SELECT COUNT(*) c FROM returns WHERE return_no LIKE 'LEGACY-%'")
    : { c: 0 };
  const total = (legacyPurchase?.c || 0) + (legacyReturn?.c || 0);
  if (total > 0) {
    findings.push(finding({
      id: 'PDF-SYNTHETIC-INVOICE', category: 'PDF Invoices', severity: 'HIGH',
      summary: `${total} invoice/return number(s) use the synthetic "LEGACY-<timestamp>" pattern instead of the real distributor/return document number.`,
      where: 'purchases.invoice_no / returns.return_no',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Recover the real invoice/return number from the source document where possible; if it cannot be recovered, mark the record unresolved rather than printing the synthetic number on any PDF.',
      evidenceCount: total,
    }));
  }
  return { category: 'PDF Invoices', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Settings ─────────────────────────────────────────────────────────────────
async function auditSettings(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];
  const configured = await db.get(
    `SELECT value FROM app_settings
     WHERE key IN ('shop_name', 'store_name', 'pharmacy_name', 'medical_name')
       AND value IS NOT NULL AND TRIM(value) != ''
       AND TRIM(value) != 'XYZ MEDICAL' AND TRIM(value) != 'XYZ Pharmacy'
     LIMIT 1`
  );
  if (!configured) {
    findings.push(finding({
      id: 'SETTINGS-NO-STORE-NAME', category: 'Settings', severity: 'MEDIUM',
      summary: 'No real pharmacy name is configured — the app falls back to the generic label "AI PHARMACY" on WhatsApp messages, reports and PDFs.',
      where: 'app_settings (shop_name / store_name / pharmacy_name)',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Go to Settings → Store Profile and enter the real pharmacy name. Customer-facing WhatsApp messages will show "AI PHARMACY" until this is set.',
    }));
  }
  return { category: 'Settings', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Database Integrity ───────────────────────────────────────────────────────
async function auditDatabaseIntegrity(db: Db): Promise<CategoryResult> {
  const findings: AuditFinding[] = [];

  try {
    const integrity = await db.get('PRAGMA integrity_check');
    const result = integrity ? (integrity.integrity_check ?? Object.values(integrity)[0]) : null;
    if (result && result !== 'ok') {
      findings.push(finding({
        id: 'DB-INTEGRITY-CHECK', category: 'Database Integrity', severity: 'CRITICAL',
        summary: `SQLite PRAGMA integrity_check reported a problem: ${result}`,
        where: 'database file',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Stop using the application immediately and restore the most recent known-good backup. Do not continue writing to a corrupted database.',
      }));
    }
  } catch (e: any) {
    findings.push(finding({
      id: 'DB-INTEGRITY-CHECK-FAILED', category: 'Database Integrity', severity: 'CRITICAL',
      summary: `PRAGMA integrity_check could not be executed: ${e?.message || e}`,
      where: 'database file',
      codeFixAvailable: false, userActionRequired: true,
      exactAction: 'Restore from the most recent backup and investigate the database file directly.',
    }));
  }

  try {
    const fkIssues = await db.all('PRAGMA foreign_key_check');
    if (fkIssues && fkIssues.length > 0) {
      findings.push(finding({
        id: 'DB-ORPHANED-REFERENCES', category: 'Database Integrity', severity: 'HIGH',
        summary: `${fkIssues.length} row(s) reference a parent record that no longer exists (orphaned foreign keys).`,
        where: 'PRAGMA foreign_key_check',
        codeFixAvailable: false, userActionRequired: true,
        exactAction: 'Review the orphaned rows (table + rowid reported by PRAGMA foreign_key_check) and either relink them to the correct parent record or remove them.',
        evidenceCount: fkIssues.length,
      }));
    }
  } catch (_e) {
    // best-effort
  }

  try {
    await db.get('SELECT COUNT(*) c FROM medicines_fts');
  } catch (e: any) {
    findings.push(finding({
      id: 'DB-FTS-UNHEALTHY', category: 'Database Integrity', severity: 'MEDIUM',
      summary: 'The medicines_fts full-text search index is unusable — medicine search may be degraded.',
      where: 'medicines_fts',
      codeFixAvailable: true, userActionRequired: false,
      exactAction: 'Restart the application — the schema bootstrap self-heals this index by rebuilding it from the medicines table on next startup.',
    }));
  }

  return { category: 'Database Integrity', status: findings.length ? 'ISSUE' : 'CLEAN', findings };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
function readAppVersion(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(process.cwd(), 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (pkg?.version) return String(pkg.version);
    } catch (_e) { /* try next candidate */ }
  }
  return '0.0.0';
}

function readBuildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
      .toString().trim() || 'unknown';
  } catch (_e) {
    return 'unknown';
  }
}

export async function runAudit(db: Db): Promise<AuditReport> {
  const categoryResults = await Promise.all([
    auditPOS(db),
    auditInventory(db),
    auditPurchases(db),
    auditPurchaseHistory(db),
    auditSales(db),
    auditCustomerReturns(db),
    auditSupplierReturns(db),
    auditExpiry(db),
    auditOCR(db),
    auditEmailImport(db),
    auditMigration(db),
    auditMobile(),
    auditWhatsApp(db),
    auditCompliance(db),
    auditReports(db),
    auditPdfInvoices(db),
    auditSettings(db),
    auditDatabaseIntegrity(db),
  ]);

  const findings = categoryResults.flatMap(c => c.findings);
  const blocking = findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const cleanCategories = categoryResults.filter(c => c.status === 'CLEAN').length;

  return {
    timestamp: new Date().toISOString(),
    appVersion: readAppVersion(),
    buildId: readBuildId(),
    categories: categoryResults,
    findings,
    totalCategories: categoryResults.length,
    cleanCategories,
    issueCategories: categoryResults.length - cleanCategories,
    blockingCount: blocking.length,
    status: blocking.length === 0 ? 'PROJECT READY' : 'PROJECT NOT READY',
  };
}
