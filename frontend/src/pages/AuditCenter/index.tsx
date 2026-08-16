import React, { useState, useMemo } from 'react';
import {
  ShieldCheck, ShieldX, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, Search, Filter, RefreshCw,
  FileText, AlertCircle, Info, Wrench, Eye,
} from 'lucide-react';

// ── Audit metadata ───────────────────────────────────────────────────────────
const AUDIT_VERSION = '15.0';
const AUDIT_DATE = '2026-08-16';

type FindingStatus = 'CLEAN' | 'FIXED' | 'REQUIRES_USER_ACTION' | 'REMAINS_OPEN';
type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

interface AuditFinding {
  id: string; feature: string; area: string;
  severity: FindingSeverity; status: FindingStatus;
  checked: string; found: string; fixed: string;
  remains: string; actionRequired: string; file?: string;
}

// ── All 36 findings from Task 15 codebase scan ───────────────────────────────
const FINDINGS: AuditFinding[] = [
  {
    id: 'POS-01', feature: 'POS / Sales Billing', area: 'POS',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Invoice number auto-generation, patient name fallback, payment status fallback, Walk-in customer creation, discount and GST calculations',
    found: 'Walk-in Customer is a display label only. paymentStatus||"paid" is a logger-only fallback. patient_name||"Customer" used only for WhatsApp message text. Nothing fabricated is written to DB.',
    fixed: 'N/A — patterns are display/logging only.',
    remains: 'None', actionRequired: 'None', file: 'src/routes/sales.ts',
  },
  {
    id: 'POS-02', feature: 'POS – Refill Scheduling', area: 'POS',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Auto-insertion of customer records during refill registration',
    found: 'Only inserts customer if a real phone number is provided. Anonymous customers without contact info are never created.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/sales.ts',
  },
  {
    id: 'BILLING-01', feature: 'PDF Invoice Generation', area: 'Billing',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Customer name, total amount, batch number rendering in PDF invoices',
    found: 'Walk-in Customer and N/A used only as display fallbacks in PDF — not written to database.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None',
    file: 'src/routes/sales.ts, src/services/pdfInvoiceService.ts',
  },
  {
    id: 'INV-01', feature: 'Inventory – Auto-creation guard', area: 'Inventory',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Whether catalog sync, OCR scan, email import, or medicine registration auto-creates inventory_master records',
    found: 'Explicit comment in inventory.ts: "Do NOT auto-create dummy inventory_master records." Only Purchase flow and aiCamera confirmed-accept flow create inventory.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/inventory.ts',
  },
  {
    id: 'INV-02', feature: 'Inventory – aiCamera batch accept (qty=0)', area: 'Inventory',
    severity: 'LOW', status: 'CLEAN',
    checked: 'aiCamera: user accepts a scanned medicine with batch number — inventory_master row created with quantity=0',
    found: 'quantity=0 is intentional: registers the batch without stock (stock must come from a purchase). No fabricated MRP, batch ID, or expiry date injected.',
    fixed: 'N/A — zero-qty batch on user-confirmed OCR accept is legitimate.',
    remains: 'None', actionRequired: 'None', file: 'src/routes/aiCamera.ts:79',
  },
  {
    id: 'PUR-01', feature: 'Purchases – App Invoice Numbering (appInvoiceNo)', area: 'Purchases',
    severity: 'LOW', status: 'CLEAN',
    checked: 'appInvoiceNo sequential P-001, P-002 used as internal reference',
    found: 'appInvoiceNo is an app-internal sequential reference, not the distributor invoice number. Actual invoice_no is always taken from distributor data first (user input, email extraction, OCR). appInvoiceNo only fills in if all external sources are missing and is visible to user for verification.',
    fixed: 'N/A — internal sequence number is not fabricated business data.',
    remains: 'None', actionRequired: 'None', file: 'src/routes/purchases.ts:2803',
  },
  {
    id: 'PUR-02', feature: 'Purchases – Email Date Fallback', area: 'Purchases',
    severity: 'MEDIUM', status: 'FIXED',
    checked: 'When email.date is missing, new Date().toISOString() used as purchase date',
    found: 'email.date || new Date().toISOString() — genuinely date-less emails get today as purchase date. Reviewed in Task 5.',
    fixed: 'Warning logged when date is auto-filled. Date highlighted in review UI for operator confirmation.',
    remains: 'The fallback still exists as last-resort for genuinely date-less emails. Date is clearly visible to user.',
    actionRequired: 'USER ACTION: In Purchases -> Email Import review screen, always verify the "Date" field before approving any email-imported purchase. Edit manually if incorrect.',
    file: 'src/routes/purchases.ts:2821',
  },
  {
    id: 'PUR-03', feature: 'Purchases – Manual Purchase Entry', area: 'Purchases',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Manual purchase via Purchases page — fields validated before DB insert',
    found: 'Requires distributor ID, invoice number, items with batch/expiry/mrp. No fabricated data.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/purchases.ts',
  },
  {
    id: 'PURH-01', feature: 'Purchase History – PDF Display', area: 'PurchaseHistory',
    severity: 'INFO', status: 'CLEAN',
    checked: 'N/A fallbacks in purchase history PDF for invoice_no, date, distributor_name, medicine_name',
    found: 'Fallbacks are display-only in PDF. Underlying DB data not modified.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/purchases.ts:1969',
  },
  {
    id: 'RET-01', feature: 'Returns – Default reason fallback "Supplier Return"', area: 'Returns',
    severity: 'MEDIUM', status: 'REQUIRES_USER_ACTION',
    checked: 'Default return reason "Supplier Return" inserted when req.body.reason is missing',
    found: 'req.body.reason || "Supplier Return" — if frontend omits reason, the string "Supplier Return" is written to the database.',
    fixed: 'Not fixed. Frontend always sends a reason; this is a backend safety net.',
    remains: 'If return submitted via API without a reason, "Supplier Return" is auto-inserted — could misrepresent expiry or damage returns.',
    actionRequired: 'USER ACTION: Always select the correct return reason (Expiry / Damaged / Short Expiry / Supplier Return) in the Returns form before submitting. Do not submit returns via API without providing a reason.',
    file: 'src/routes/returns.ts:88',
  },
  {
    id: 'RET-02', feature: 'Returns – Expiry Return Workflow', area: 'Returns',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Expiry return tracking, loss_percentage calculation, financial note generation',
    found: 'Task 7 (Refactor Expiry Return Workflow) fixed fabricated inventory re-creation on expiry return. Only existing batches can be returned.',
    fixed: 'Expiry return no longer creates inventory records. Loss tracked against actual cost price.',
    remains: 'None', actionRequired: 'None', file: 'src/routes/returns.ts',
  },
  {
    id: 'EXP-01', feature: 'Expiry Management', area: 'Expiry',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Expiry date parsing, near-expiry alerts, auto-return triggering',
    found: 'Expiry dates read from inventory_master. No fabricated expiry dates. Near-expiry alerts are read-only notifications.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/expiry.ts',
  },
  {
    id: 'INV3-01', feature: 'Investigation Center – Ledger', area: 'Investigation',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Party name fallbacks (Walk-in, Unknown), transaction reconstruction',
    found: '"Walk-in" and "Unknown" are display fallbacks for party names in ledger view — no data is fabricated.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/investigation.ts',
  },
  {
    id: 'OCR-01', feature: 'OCR / AI Camera – Medicine Registration', area: 'OCR',
    severity: 'INFO', status: 'CLEAN',
    checked: 'OCR result to medicine registration flow, batch creation, inventory guard',
    found: 'OCR registers medicine master only. inventory_master only created when batch number explicitly present. quantity always 0 on scan-create.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/aiCamera.ts',
  },
  {
    id: 'EMAIL-01', feature: 'Email Import – Distributor Resolution', area: 'EmailImport',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Whether email import auto-creates distributors or fabricates distributor IDs',
    found: 'Tasks 10/11 (Fix Email Distributor Workflow) fixed auto-creation of phantom distributors. Email-imported orders require explicit distributor mapping before purchase record is created.',
    fixed: 'Distributor must be linked before email purchase is approved. No fabricated distributor IDs.',
    remains: 'None', actionRequired: 'None',
    file: 'src/routes/purchases.ts, src/services/emailService.ts',
  },
  {
    id: 'EMAIL-02', feature: 'Email Import – Purchase Staging', area: 'EmailImport',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Whether email import auto-creates inventory without user review',
    found: 'Comment in emailService.ts confirms: "Stage the order for user verification instead of fabricating dummy inventory." Purchases from email go to staged review queue.',
    fixed: 'N/A — correct behavior already in place.',
    remains: 'None', actionRequired: 'None', file: 'src/services/emailService.ts:1815',
  },
  {
    id: 'MIG-01', feature: 'Migration – Ghost Inventory for Sales Linkage', area: 'Migration',
    severity: 'HIGH', status: 'REQUIRES_USER_ACTION',
    checked: 'Migration worker creates inventory_master rows with quantity=0 and batch="" for legacy sales referencing inventory not in new DB',
    found: 'Line 1740: INSERT INTO inventory_master with quantity=0 and batchVal||"". Creates zero-stock "ghost" batch rows to satisfy sale_items FK references during migration of sales without matching inventory.',
    fixed: 'Partial: migrationMeta.ts warns "Sales were imported without inventory — sale items may link to placeholder batches with zero stock." Warning surfaces in Migration page.',
    remains: 'Ghost inventory_master rows (qty=0, batch="") in databases that ran migration with incomplete inventory data.',
    actionRequired: 'USER ACTION: After any data migration, go to Investigation Center -> Inventory Ledger and filter for items with batch="" (empty). Review and delete ghost rows or properly link to real purchase records.',
    file: 'src/worker/migrationWorker.ts:1740',
  },
  {
    id: 'MIG-02', feature: 'Migration – Dummy Batch Strings Removed', area: 'Migration',
    severity: 'INFO', status: 'FIXED',
    checked: 'B-GEN, B-CATALOG, B-IMPORT, B-OFFLINE, B-REISSUE, B-MANUAL, B-NEW, BATCH123 strings in codebase',
    found: 'None found in any .ts/.tsx file. All previously banned batch strings removed in Tasks 1-14.',
    fixed: 'All 8 dummy batch ID patterns eliminated from the codebase.',
    remains: 'None', actionRequired: 'None', file: 'src/ (all routes, services, workers)',
  },
  {
    id: 'MIG-03', feature: 'Migration – Invoice Number Fabrication', area: 'Migration',
    severity: 'INFO', status: 'FIXED',
    checked: 'Auto-generated invoice numbers during legacy migration (Task 4)',
    found: 'Previously migrations generated arbitrary INV-XXXX invoice numbers.',
    fixed: 'Migration now requires real invoice number from source data. If absent, migration line is skipped with a warning.',
    remains: 'None', actionRequired: 'None', file: 'src/routes/migration.ts',
  },
  {
    id: 'MIG-04', feature: 'Migration – Medicine ID & Name Fabrication', area: 'Migration',
    severity: 'INFO', status: 'FIXED',
    checked: 'Auto-generated medicine IDs & "Unknown Product" name fallbacks during migration (Tasks 2, 3, and 15)',
    found: 'Previously migrations created arbitrary medicine master records with generic names or "Unknown Product" placeholders.',
    fixed: 'Migration skips items where medicine cannot be matched or name is empty. Logged to migration_errors. All "Unknown Product" fallbacks removed.',
    remains: 'None', actionRequired: 'None', file: 'src/worker/migrationWorker.ts',
  },
  {
    id: 'MOBILE-01', feature: 'Mobile / Telegram Bot', area: 'Mobile',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Telegram bot medicine search, cart, prescription handling',
    found: 'Bot reads real inventory data. Does not fabricate stock, MRP, or patient information.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/telegramBot.ts',
  },
  {
    id: 'WA-01', feature: 'WhatsApp – Delivery Boy Resolution', area: 'WhatsApp',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Delivery boy name and phone resolution in WhatsApp order templates',
    found: 'AGENTS.md contract enforced: resolves from delivery_boys table, falls back to store admin from app_settings. No hardcoded +91 99999 99999 found.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/whatsappQueue.ts',
  },
  {
    id: 'WA-02', feature: 'WhatsApp – Refill Messages', area: 'WhatsApp',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Refill notification content — patient name, medicine name, quantities',
    found: 'All values read from patient_refills and inventory. No fabricated data in messages.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/services/refillService.ts',
  },
  {
    id: 'COMP-01', feature: 'Compliance – REG-NA License Placeholder', area: 'Compliance',
    severity: 'HIGH', status: 'FIXED',
    checked: 'Legacy compliance_logs records with license_no = "REG-NA" placeholder',
    found: 'Historical records existed with fake "REG-NA" license values written by old code.',
    fixed: 'compliance.ts GET / route sanitizes on every load: sets license_no=NULL, missing_license=1 for any REG-NA rows. These surface in Compliance review queue for operator action.',
    remains: 'Sanitization runs on page load so existing records are corrected automatically.',
    actionRequired: 'USER ACTION: Open Compliance page. Any Schedule H/H1 records with missing_license=1 require you to enter the correct doctor registration number.',
    file: 'src/routes/compliance.ts:28-35',
  },
  {
    id: 'COMP-02', feature: 'Compliance – schedule_type Hardcoded "general"', area: 'Compliance',
    severity: 'LOW', status: 'REMAINS_OPEN',
    checked: 'POST /api/compliance/add inserts schedule_type="general" hardcoded for non-H1 entries',
    found: 'Line 52: schedule_type hardcoded to "general" when using the generic /add endpoint. The dedicated /add-schedule-h1 endpoint correctly sets "H1".',
    fixed: 'Not fixed — the /add endpoint is only called for non-H drugs where "general" is correct by design.',
    remains: 'If Schedule H drugs are ever logged via /add instead of /add-schedule-h1, they get schedule_type="general". Workflow risk.',
    actionRequired: 'USER ACTION: Ensure all Schedule H and H1 drug dispensing events are logged using the Schedule H1 dispensing button in the Compliance screen, not the generic "Add Entry" form.',
    file: 'src/routes/compliance.ts:52',
  },
  {
    id: 'REP-01', feature: 'Reports – N/A Fallbacks in Report Data', area: 'Reports',
    severity: 'INFO', status: 'CLEAN',
    checked: 'batchNo, purchaseDate, expiryDate falling back to N/A in report rows',
    found: '"N/A" used as display string in report output when inventory data is missing. Not written back to DB.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/reports.ts:272-274',
  },
  {
    id: 'SETTINGS-01', feature: 'Settings – Store Name Fallback "AI PHARMACY"', area: 'Settings',
    severity: 'MEDIUM', status: 'REQUIRES_USER_ACTION',
    checked: 'getStoreMedicalName() returns "AI PHARMACY" if no shop name configured in app_settings',
    found: 'storeSettingsService.ts line 90: return "AI PHARMACY" — used in WhatsApp messages and reports if no real pharmacy name is configured.',
    fixed: 'XYZ MEDICAL and XYZ Pharmacy are blocked as placeholder values. "AI PHARMACY" fallback remains.',
    remains: '"AI PHARMACY" appears in WhatsApp customer messages and reports if pharmacy name is not configured.',
    actionRequired: 'USER ACTION: Go to Settings -> Store Profile. Enter your actual pharmacy name (e.g. "Sharma Medical Store"). CRITICAL — WhatsApp messages sent to customers will show "AI PHARMACY" until configured.',
    file: 'src/services/storeSettingsService.ts:90',
  },
  {
    id: 'SETTINGS-02', feature: 'Settings – XYZ MEDICAL Cleanup', area: 'Settings',
    severity: 'INFO', status: 'FIXED',
    checked: 'XYZ MEDICAL and XYZ Pharmacy legacy placeholder names in app_settings',
    found: 'database.ts migration purges XYZ MEDICAL/XYZ Pharmacy from app_settings on startup.',
    fixed: 'Purge runs on every DB initialization. storeSettingsService also filters them out.',
    remains: 'None', actionRequired: 'None', file: 'src/database.ts:1914',
  },
  {
    id: 'DB-01', feature: 'Database – Customer Auto-Creation with Placeholder Name', area: 'Database',
    severity: 'MEDIUM', status: 'REQUIRES_USER_ACTION',
    checked: 'database.ts startup: auto-inserts customers named "Walk-in Patient" or "Customer" when phone exists but no customer record',
    found: 'Lines 1077, 1095, 1112: if a patient_refill, special_order, or held_bill has a phone but no linked customer, a customer record is created with a placeholder name.',
    fixed: 'Reviewed — acceptable since real phone number exists. But name "Walk-in Patient" or "Customer" is fabricated.',
    remains: 'Refills/bills with phone but no real patient name create customers named "Walk-in Patient" visible in CRM.',
    actionRequired: 'USER ACTION: In CRM -> Customers, search for "Walk-in Patient" and "Customer" entries. Update with real patient names where known. Always enter patient name during billing.',
    file: 'src/database.ts:1077, 1095, 1112',
  },
  {
    id: 'DB-02', feature: 'Database – Email String in Phone Column Cleanup', area: 'Database',
    severity: 'INFO', status: 'FIXED',
    checked: 'Email addresses mistakenly written into phone/contact columns of distributors table',
    found: 'database.ts migration detects email strings in phone/contact columns.',
    fixed: 'UPDATE clears any value with @ or .com from phone/contact columns on startup.',
    remains: 'None', actionRequired: 'None', file: 'src/database.ts:1121',
  },
  {
    id: 'BG-01', feature: 'Background Jobs – Idle Gating', area: 'BackgroundJobs',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Background sync tasks, backups, catalog updates running during user idle',
    found: 'AGENTS.md Data Fetch Control & Idle Gating Contract enforced: jobs query activityTracker.isIdle() before executing.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/services/ (various background services)',
  },
  {
    id: 'BG-02', feature: 'Background Jobs – Pharmarack Session Temp Paths', area: 'BackgroundJobs',
    severity: 'INFO', status: 'CLEAN',
    checked: 'Session refresh generating random temp profile paths using Date.now() + randomSuffix',
    found: 'randomSuffix and Date.now() in pharmarack.ts used only for temp filesystem paths — not business IDs.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/pharmarack.ts',
  },
  {
    id: 'IMPORT-01', feature: 'Import – Seed Scripts in Production Source Path', area: 'ImportExport',
    severity: 'MEDIUM', status: 'REQUIRES_USER_ACTION',
    checked: 'seedMassiveMeds.ts, seedIndianMeds.ts, seedRealMeds.ts, seedCompanies.ts in src/scripts/',
    found: 'Seed scripts use Math.random() to generate synthetic medicine names and data. They exist in the production source path.',
    fixed: 'Scripts are not called from any route or startup code — they are CLI-only tools.',
    remains: 'Seed scripts exist and could be run accidentally against production database.',
    actionRequired: 'USER ACTION: Do NOT run any seed script (seedMassiveMeds, seedIndianMeds, seedRealMeds, seedCompanies) against your production database. These scripts create fake/synthetic medicine records.',
    file: 'src/scripts/seedMassiveMeds.ts, seedIndianMeds.ts, seedRealMeds.ts, seedCompanies.ts',
  },
  {
    id: 'IMPORT-02', feature: 'Import – Inventory Parser (Migration CSV)', area: 'ImportExport',
    severity: 'INFO', status: 'CLEAN',
    checked: 'inventoryParser.ts: creates inventory_master from legacy CSV import',
    found: 'Validates medicine ID exists before inserting. Returns false and logs error if medicine not found — no phantom medicine created.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/worker/parsers/inventoryParser.ts',
  },
  {
    id: 'NOTIF-01', feature: 'Notifications – Unknown/NA Fallbacks in Low Stock Alert', area: 'BackgroundJobs',
    severity: 'LOW', status: 'CLEAN',
    checked: 'Low stock notification: medicine_name||name||"Unknown", batch_no||"N/A"',
    found: '"Unknown" and "N/A" appear only in notification message text — not written to DB.',
    fixed: 'N/A', remains: 'None', actionRequired: 'None', file: 'src/routes/notifications.ts:340',
  },
  {
    id: 'WA-03', feature: 'WhatsApp – Customer Name Fallback in Order Messages', area: 'WhatsApp',
    severity: 'MEDIUM', status: 'REQUIRES_USER_ACTION',
    checked: 'buildOrderReadyNotificationMessage uses "Customer" when requesterName is empty',
    found: '(requesterName || "Customer").trim() — blank special order requester gets addressed as "Hi Customer,".',
    fixed: 'Not fixed — this is a data-entry issue, not a code defect.',
    remains: 'WhatsApp messages may say "Hi Customer," instead of patient name if name was not entered.',
    actionRequired: 'USER ACTION: Always enter patient/customer name when creating a Special Order. Check CRM -> Special Orders for entries with empty requester name.',
    file: 'src/services/storeSettingsService.ts:199',
  },
];

// ── Stats computation ────────────────────────────────────────────────────────
function computeStats(findings: AuditFinding[]) {
  const total = findings.length;
  const clean = findings.filter(f => f.status === 'CLEAN').length;
  const fixed = findings.filter(f => f.status === 'FIXED').length;
  const requiresAction = findings.filter(f => f.status === 'REQUIRES_USER_ACTION').length;
  const remainsOpen = findings.filter(f => f.status === 'REMAINS_OPEN').length;
  const critical = findings.filter(f => f.severity === 'CRITICAL').length;
  const high = findings.filter(
    f => f.severity === 'HIGH' && f.status !== 'FIXED' && f.status !== 'CLEAN'
  ).length;
  const warnings = findings.filter(
    f => (f.severity === 'MEDIUM' || f.severity === 'LOW') &&
      (f.status === 'REQUIRES_USER_ACTION' || f.status === 'REMAINS_OPEN')
  ).length;
  const failedChecks = requiresAction + remainsOpen;
  const isReady = critical === 0 && high === 0 && remainsOpen === 0;
  return { total, clean, fixed, requiresAction, remainsOpen, critical, high, warnings, totalChecks: total, failedChecks, isReady };
}

// ── Styling maps ─────────────────────────────────────────────────────────────
const statusConfig: Record<FindingStatus, { label: string; color: string; bg: string }> = {
  CLEAN: { label: 'CLEAN', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' },
  FIXED: { label: 'FIXED', color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/30' },
  REQUIRES_USER_ACTION: { label: 'USER ACTION', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  REMAINS_OPEN: { label: 'OPEN', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
};

const severityConfig: Record<FindingSeverity, { color: string; bg: string }> = {
  CRITICAL: { color: 'text-red-300', bg: 'bg-red-500/20 border-red-500/50' },
  HIGH: { color: 'text-orange-300', bg: 'bg-orange-500/15 border-orange-500/40' },
  MEDIUM: { color: 'text-amber-300', bg: 'bg-amber-500/10 border-amber-500/30' },
  LOW: { color: 'text-blue-300', bg: 'bg-blue-500/10 border-blue-500/25' },
  INFO: { color: 'text-text/50', bg: 'bg-white/5 border-border' },
};

// ── FindingCard ──────────────────────────────────────────────────────────────
function FindingCard({ finding }: { finding: AuditFinding }) {
  const [open, setOpen] = useState(false);
  const sc = statusConfig[finding.status];
  const sv = severityConfig[finding.severity];

  return (
    <div className={`border rounded-xl overflow-hidden transition-all duration-200 ${
      finding.status === 'REMAINS_OPEN' ? 'border-red-500/40' :
      finding.status === 'REQUIRES_USER_ACTION' ? 'border-amber-500/30' : 'border-border'
    }`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
        aria-expanded={open}
      >
        <div className="shrink-0 mt-0.5">
          {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted">{finding.id}</span>
            <span className="text-sm font-semibold text-text">{finding.feature}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${sc.bg} ${sc.color}`}>
              {sc.label}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sv.bg} ${sv.color}`}>
              {finding.severity}
            </span>
            <span className="text-[10px] text-muted bg-white/5 border border-border px-2 py-0.5 rounded-full">
              {finding.area}
            </span>
          </div>
        </div>
        {finding.status === 'REQUIRES_USER_ACTION' && <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-1" />}
        {finding.status === 'REMAINS_OPEN' && <XCircle size={16} className="text-red-400 shrink-0 mt-1" />}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
          {([
            { icon: <Eye size={11} />, label: 'What was checked', text: finding.checked },
            { icon: <Search size={11} />, label: 'What was found', text: finding.found },
            { icon: <Wrench size={11} />, label: 'What was fixed', text: finding.fixed },
            { icon: <Info size={11} />, label: 'What remains', text: finding.remains },
          ] as { icon: React.ReactNode; label: string; text: string }[]).map(r => (
            <div key={r.label}>
              <div className="flex items-center gap-1.5 mb-1 text-muted">
                {r.icon}
                <span className="text-[10px] font-bold uppercase tracking-wider">{r.label}</span>
              </div>
              <p className="text-xs text-text/80 leading-relaxed pl-4">{r.text}</p>
            </div>
          ))}
          {finding.actionRequired !== 'None' && (
            <div className="mt-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-1.5 mb-1.5 text-amber-400">
                <AlertTriangle size={12} />
                <span className="text-[10px] font-black uppercase tracking-wider">Action Required</span>
              </div>
              <p className="text-xs text-amber-200/90 leading-relaxed">{finding.actionRequired}</p>
            </div>
          )}
          {finding.file && (
            <div className="flex items-center gap-1.5">
              <FileText size={11} className="text-muted" />
              <span className="text-[10px] text-muted font-mono">{finding.file}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, sub }: { label: string; value: number | string; color?: string; sub?: string }) {
  return (
    <div className="bg-glass-bg border border-glass-border rounded-xl p-4 flex flex-col gap-1">
      <span className={`text-2xl font-black tabular-nums ${color ?? 'text-text'}`}>{value}</span>
      <span className="text-[11px] font-semibold text-text/80">{label}</span>
      {sub && <span className="text-[10px] text-muted">{sub}</span>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AuditCenter() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FindingStatus | 'ALL'>('ALL');
  const [filterArea, setFilterArea] = useState('ALL');

  const stats = useMemo(() => computeStats(FINDINGS), []);
  const areas = useMemo(
    () => ['ALL', ...Array.from(new Set(FINDINGS.map(f => f.area))).sort()],
    []
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return FINDINGS.filter(f => {
      if (filterStatus !== 'ALL' && f.status !== filterStatus) return false;
      if (filterArea !== 'ALL' && f.area !== filterArea) return false;
      if (q && !f.feature.toLowerCase().includes(q) && !f.id.toLowerCase().includes(q) && !f.checked.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, filterStatus, filterArea]);

  const needsAttention = filtered.filter(f => f.status === 'REMAINS_OPEN' || f.status === 'REQUIRES_USER_ACTION');
  const fixedItems = filtered.filter(f => f.status === 'FIXED');
  const cleanItems = filtered.filter(f => f.status === 'CLEAN');

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg text-text">
      {/* Header */}
      <div className="flex-none p-5 border-b border-border bg-glass-bg/60 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              {stats.isReady
                ? <ShieldCheck size={22} className="text-green-400" />
                : <ShieldX size={22} className="text-red-400" />}
              <h1 className="text-xl font-black tracking-tight text-text">Business Data Integrity Audit</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 border border-border text-muted">
                v{AUDIT_VERSION}
              </span>
            </div>
            <p className="text-xs text-muted">Task 15 — Final Audit · {AUDIT_DATE} · AI PHARMACY v2</p>
          </div>

          {/* PROJECT READY / NOT READY verdict */}
          <div className={`flex items-center gap-2 px-5 py-3 rounded-xl border-2 font-black text-sm ${
            stats.isReady
              ? 'bg-green-500/15 border-green-500/50 text-green-300'
              : 'bg-red-500/15 border-red-500/50 text-red-300'
          }`}>
            {stats.isReady
              ? <><CheckCircle2 size={18} /> PROJECT READY</>
              : <><XCircle size={18} /> PROJECT NOT READY</>}
          </div>
        </div>

        {!stats.isReady && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300">
            <AlertCircle size={12} className="inline mr-1.5" />
            {stats.remainsOpen} issue(s) remain open and {stats.requiresAction} require user action before this project can be finalized.
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="flex-none p-5 border-b border-border">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard label="Workflows Audited" value={stats.total} />
          <StatCard label="Clean" value={stats.clean} color="text-green-400" />
          <StatCard label="Fixed" value={stats.fixed} color="text-sky-400" />
          <StatCard label="User Action" value={stats.requiresAction} color="text-amber-400" />
          <StatCard label="Remains Open" value={stats.remainsOpen} color="text-red-400" />
          <StatCard label="Critical Issues" value={stats.critical} color={stats.critical > 0 ? 'text-red-400' : 'text-green-400'} />
          <StatCard label="Warnings" value={stats.warnings} color={stats.warnings > 0 ? 'text-amber-400' : 'text-text/60'} />
          <StatCard label="Data Checks" value={stats.totalChecks} sub={`${stats.failedChecks} failed`} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex-none px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="audit-search"
            type="text"
            placeholder="Search findings…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs bg-bg2 border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={13} className="text-muted" />
          <select
            id="audit-filter-status"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as FindingStatus | 'ALL')}
            className="text-xs bg-bg2 border border-border rounded-lg px-3 py-2 text-text focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="CLEAN">Clean</option>
            <option value="FIXED">Fixed</option>
            <option value="REQUIRES_USER_ACTION">User Action Required</option>
            <option value="REMAINS_OPEN">Remains Open</option>
          </select>
          <select
            id="audit-filter-area"
            value={filterArea}
            onChange={e => setFilterArea(e.target.value)}
            className="text-xs bg-bg2 border border-border rounded-lg px-3 py-2 text-text focus:outline-none cursor-pointer"
          >
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <span className="text-[10px] text-muted ml-auto">{filtered.length} of {FINDINGS.length} findings</span>
      </div>

      {/* Findings List */}
      <div className="flex-1 overflow-y-auto p-5">
        {filterStatus === 'ALL' ? (
          <>
            {needsAttention.length > 0 && (
              <div className="mb-5">
                <div className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={11} /> Needs Attention ({needsAttention.length})
                </div>
                <div className="space-y-2">{needsAttention.map(f => <FindingCard key={f.id} finding={f} />)}</div>
              </div>
            )}
            {fixedItems.length > 0 && (
              <div className="mb-5">
                <div className="text-[10px] font-black uppercase tracking-widest text-sky-400 mb-2 flex items-center gap-1.5">
                  <Wrench size={11} /> Fixed in Tasks 1–14 ({fixedItems.length})
                </div>
                <div className="space-y-2">{fixedItems.map(f => <FindingCard key={f.id} finding={f} />)}</div>
              </div>
            )}
            {cleanItems.length > 0 && (
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-green-400 mb-2 flex items-center gap-1.5">
                  <CheckCircle2 size={11} /> Clean ({cleanItems.length})
                </div>
                <div className="space-y-2">{cleanItems.map(f => <FindingCard key={f.id} finding={f} />)}</div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">{filtered.map(f => <FindingCard key={f.id} finding={f} />)}</div>
        )}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted">
            <Search size={28} className="mb-3 opacity-40" />
            <p className="text-sm">No findings match your filters</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-none px-5 py-3 border-t border-border bg-glass-bg/40 flex items-center justify-between flex-wrap gap-2 text-[10px] text-muted">
        <div className="flex items-center gap-3">
          <RefreshCw size={11} />
          <span>Last audit: {AUDIT_DATE} · Task 15 · v{AUDIT_VERSION}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-green-400">{stats.clean} Clean</span>
          <span className="text-sky-400">{stats.fixed} Fixed</span>
          <span className="text-amber-400">{stats.requiresAction} User Action</span>
          <span className="text-red-400">{stats.remainsOpen} Open</span>
        </div>
      </div>
    </div>
  );
}
