# ==============================================================================
# MASTER INTEGRATED PRD & TECHNICAL IMPLEMENTATION BLUEPRINT: 
# CONFIG-GATED SILENCE, SCREEN-ONLY MATH, AND GLOBAL SELF-HEALING ARCHITECTURE
# ==============================================================================
# Target System: AI Pharmacy OS (v2.0) [2]
# Target Hardware Baseline: Intel Core i3 3rd-Gen (2 Cores / 4 Threads, HDD, No AVX2) [1]
# Target Runtime Footprint: 0% Idle Process CPU Churn, <140MB RAM Idle Base [1, 3, 4]
# Latency Mandate: <5ms Page Load & Modal Open, <15ms Transaction Sync [5]
# Verification Strictness: 100% Type-Safe, No-Emit Clean, Anti-Regression Guarded [6]
# ==============================================================================

================================================================================
1. CURRENT BEHAVIOR VS. TARGET BEHAVIOR MATRIX
================================================================================

This blueprint covers three distinct architectural issues that currently degrade performance on slow, HDD-backed machines [1].

--------------------------------------------------------------------------------
1.1 Background Timer Silence & Configuration Gating
--------------------------------------------------------------------------------
*   CURRENT BEHAVIOR:
    - At boot, the main server process or worker supervisor unconditionally spawns background setInterval loops and cron schedules for Gmail IMAP polling, WhatsApp message queues, and Telegram bots [7-9].
    - If the store has not configured these features, the console continuously spams uncaught connection exceptions, blocks Node's single thread, and thrashes the mechanical HDD with error log writes [1, 10, 11].
    - General Settings saves blindly write every form field back to `app_settings` [12, 13]. If a credential field (like `gmail_pass` or Pharmarack password keys) is left empty in the Settings form, it destructively wipes out active configurations set up on the Learning page [12, 14-16].
*   TARGET BEHAVIOR:
    - Centralized configuration gates are placed at the entry point of every background loop [17].
    - If Gmail credentials (`gmail_user`, `gmail_pass`), WhatsApp Web (`whatsapp_enabled`), or Telegram tokens (`telegram_token`) are missing or disabled, their respective background timers instantly return, maintaining 100% silent background CPU usage [11, 17].
    - All general Settings saves are structurally insulated [12, 18]. Stale form values are filtered out on save to prevent clobbering active credentials [13]. The environment `SKIP_AUTH=true` bypass is preserved cleanly for testing [19-21].

--------------------------------------------------------------------------------
1.2 Visible-Screen-Only Math & Incremental Stock Ledger
--------------------------------------------------------------------------------
*   CURRENT BEHAVIOR:
    - Swapping tabs or opening pages like Inventory, Sells, or Reports triggers heavy database queries joining medicines and batches, recalculating loose quantities and active batch flags on the fly [22, 23].
    - Entering a manual Purchase Bill or typing inside the POS cart triggers hundreds of raw `parseFloat` tax, subtotal, and profit margin recalculations on *every single frame* the user types, causing severe input lag on dual-core CPUs [24, 25].
    - Historical sales search, non-moving stock queries, and expiry reports run unbounded scans across thousands of transaction rows [25-27].
*   TARGET BEHAVIOR:
    - The Inventory page functions as a fast, read-only table [5]. Real stock values are updated transactionally via simple, atomic addition and subtraction during checkout or purchase saves [28-30]. No full table scans are run on page load [5, 25].
    - Calculations inside POS and Purchases are strictly memoized using React `useMemo` hooks [31, 32]. The frontend calculations are tied exclusively to the active items currently visible on the screen [31].
    - Sells, Reports, and Purchase History pages load instantly in <5ms by querying pre-saved, static invoice totals (`total_amount`, `tax_amount`, `net_profit`) written directly to the table columns at transaction save time [23, 33].

--------------------------------------------------------------------------------
1.3 Idempotent Schema Versioning, Self-Healing Boot, & Process Guardians
--------------------------------------------------------------------------------
*   CURRENT BEHAVIOR:
    - The schema initialization uses over 60 individual `ALTER TABLE` statements wrapped in loose `try/catch` blocks [10, 34, 35]. Every time the app boots, it tries to re-run every alteration, throwing silent SQLITE_ERROR warnings if the columns already exist [10, 34].
    - Some ALTER statements are written before the corresponding CREATE TABLE is executed, causing latent crashes on fresh installations [10, 11].
    - Background async loops (like IMAP polling, message queues, and token refreshers) have no `.catch()` handlers [10, 11]. If a network socket drops, an unhandled rejection crashes the entire Express process, taking the pharmacy offline [10, 11, 36].
*   TARGET BEHAVIOR:
    - A dedicated `schema_migrations` table tracks database evolution [37]. Schema alterations execute sequentially, exactly once, and are fully auditable [37].
    - A startup database manager executes `PRAGMA integrity_check;` before mounting Express routes [38, 39]. If corruption is detected (e.g., from an abrupt power failure on an HDD), the connection manager renames the corrupt file and automatically restores the latest clean nightly compressed backup in seconds [39, 40].
    - Process Guardians catch global unhandled rejections, logging them safely while keeping the core server thread running [10, 11].

================================================================================
2. COMPREHENSIVE FILE CHANGE MANIFEST (18 FILES TOTAL)
================================================================================

To implement this plan without breaking existing database schemas or core features, exactly 18 files will be modified (9 Backend, 9 Frontend).

### 2.1 Backend Files to Modify (9 Files)
1.  `src/database.ts` — Define the sequential schema versioning, bump the schema version, and enforce correct CREATE-before-ALTER table initialization [10, 39, 41].
2.  `src/database/connection.ts` — Implement the startup `PRAGMA integrity_check`, connection timeout tuning, and zlib-compressed self-healing restore loops [39, 40, 42].
3.  `src/server.ts` — Register global Node.js `uncaughtException` process handlers and implement a `/api/health/ready` check [10, 43, 44].
4.  `src/worker/emailPoller.ts` — Implement the IMAP poller config-gate check [7, 9, 11].
5.  `src/services/whatsappQueue.ts` — Implement the `whatsapp_enabled` setting gate to prevent idle database queue sweeps [9, 45].
6.  `src/services/telegramPrescriptionService.ts` — Gate bot connection attempts based on the `telegram_enabled` setting [9, 11, 46].
7.  `src/routes/sales.ts` — Implement atomic, single-pass transactional stock decrements, log events to `stock_ledger`, and write static invoice totals [28, 39, 47].
8.  `src/routes/purchases.ts` — Implement atomic, single-pass transactional stock increments and write static purchase totals [39, 47, 48].
9.  `src/routes/settings.ts` — Secure general settings writes; fix the write path to save into `app_settings` instead of the phantom `settings` table [12, 13].

### 2.2 Frontend Files to Modify (9 Files)
1.  `frontend/src/pages/POS/index.tsx` — Memoize cart item and tax calculations using `useMemo`, prevent calculations from running on frame renders, and preserve test auth bypass [5, 24, 31].
2.  `frontend/src/pages/Purchases/index.tsx` — Memoize purchase subtotal and profit margin math for manual invoice entry [24, 31, 32].
3.  `frontend/src/pages/Inventory/index.tsx` — Configure table as a fast, read-only data view using `@tanstack/react-virtual` with zero client-side stock aggregation [5, 23, 32].
4.  `frontend/src/pages/Sells/index.tsx` — Direct rendering from pre-saved static invoice totals [23, 31].
5.  `frontend/src/pages/PurchaseHistory/index.tsx` — Direct rendering from pre-saved static purchase totals [23, 31].
6.  `frontend/src/pages/Reports/index.tsx` — Read pre-calculated metrics compiled at write-time, staggering heavy report cards [23, 49].
7.  `frontend/src/pages/Learning/index.tsx` — Display live background service connectivity state badges [14, 23].
8.  `frontend/src/pages/Settings/index.tsx` — Protect credentials by omitting empty password state variables during general configuration saves [12, 14, 16, 24].
9.  `frontend/src/components/Layout.tsx` — Render top-level ready-banners that hook into `/api/health/ready` to block UI interactions until the database is fully booted [24, 43, 44].

================================================================================
3. PHASE-BY-PHASE DETAILED CODE IMPLEMENTATION
================================================================================

--------------------------------------------------------------------------------
PHASE 3.1: Idempotent Schema Versioning, Self-Healing Boot, & Process Guardians
--------------------------------------------------------------------------------

#### FILE 3.1.1: `src/database.ts`
- Current Behavior: 60+ unversioned schema modification lines thrashed through try/catch blocks on every server startup [10, 35].
- Target Behavior: Sequential, versioned execution tracked via a `schema_migrations` table to ensure ALTER statements run exactly once [37].
```typescript
import { Database } from 'better-sqlite3';

export function ensureSchema(db: Database) {
  // 1. Initialize migration ledger table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      migrated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const currentVersionRow = db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as { version: number | null };
  const currentVersion = currentVersionRow?.version || 0;

  // 2. Sequential Migration blocks
  if (currentVersion < 1) {
    db.transaction(() => {
      db.exec(`
        -- Version 1: Core Tables Initialization
        CREATE TABLE IF NOT EXISTS medicines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          generic_name TEXT,
          mrp REAL,
          hsn_code TEXT,
          schedule_type TEXT DEFAULT 'None'
        );
        CREATE TABLE IF NOT EXISTS inventory_master (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          medicine_id INTEGER,
          quantity INTEGER DEFAULT 0,
          loose_quantity INTEGER DEFAULT 0,
          batch_no TEXT,
          expiry_date TEXT,
          is_active INTEGER DEFAULT 1,
          FOREIGN KEY(medicine_id) REFERENCES medicines(id)
        );
      `);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (1)').run();
    })();
    console.log('[SCHEMA] Migrated to Version 1 (Core schemas initialized).');
  }

  if (currentVersion < 2) {
    db.transaction(() => {
      // Version 2: Sequential Alterations - Runs exactly once
      db.exec(`
        ALTER TABLE medicines ADD COLUMN therapeutic TEXT;
        ALTER TABLE medicines ADD COLUMN sub_therapeutic TEXT;
        ALTER TABLE medicines ADD COLUMN short_code TEXT;
        ALTER TABLE medicines ADD COLUMN ucode TEXT;
      `);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (2)').run();
    })();
    console.log('[SCHEMA] Migrated to Version 2 (Extended indexing columns added).');
  }
}
FILE 3.1.2: src/database/connection.ts
Current Behavior: Bypasses database health checking on boot, making the app susceptible to SQLite file corruption on hard shutdowns
.
Target Behavior: Automatic startup integrity checks with zlib-compressed nightly restore backups
.
import DatabaseConstructor, { Database } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { getAppDataDir } from '../config/index.js'; // Respect packaged AppData dir contract [50, 51]

class DatabaseManager {
  private connection: Database | null = null;

  public getConnection(): Database {
    if (this.connection) return this.connection;

    const dbPath = path.join(getAppDataDir(), 'data', 'app.db'); [50]
    const backupDir = path.join(getAppDataDir(), 'backup'); [50]

    try {
      this.connection = new DatabaseConstructor(dbPath, { fileMustExist: false });
      
      // Enforce high-performance WAL configuration to mitigate HDD disk bottlenecks [1, 52, 53]
      this.connection.pragma('journal_mode = WAL');
      this.connection.pragma('busy_timeout = 30000'); // Mitigate cross-process write locks [39, 42, 54]
      this.connection.pragma('synchronous = NORMAL');

      // Run boot integrity validation [39]
      const integrity = this.connection.prepare('PRAGMA integrity_check;').get() as { integrity_check: string };
      if (integrity && integrity.integrity_check !== 'ok') {
        throw new Error('Database integrity check failed.');
      }
    } catch (error) {
      console.error('[DATABASE CORRUPTION] CRITICAL: DB corrupt. Initializing self-healing recovery...', error);
      this.runSelfHealing(dbPath, backupDir);
    }

    return this.connection!;
  }

  private runSelfHealing(dbPath: string, backupDir: string) {
    if (this.connection) {
      try { this.connection.close(); } catch {}
    }

    const corruptPath = `${dbPath}.corrupt-${Date.now()}`;
    if (fs.existsSync(dbPath)) {
      fs.renameSync(dbPath, corruptPath);
      console.warn(`[SELF-HEALING] Relocated corrupt database file to: ${corruptPath}`);
    }

    // Locate the newest compressed zlib backup [39, 40]
    const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(f => f.endsWith('.db.gz')) : [];
    if (backups.length === 0) {
      console.error('[SELF-HEALING] CRITICAL: No backups found. System booting clean to protect checkout availability.');
      this.connection = new DatabaseConstructor(dbPath);
      return;
    }

    const newestBackup = backups.sort().reverse();
    const compressedBackupPath = path.join(backupDir, newestBackup);
    
    // Decompress and restore database file
    const compressedBuffer = fs.readFileSync(compressedBackupPath);
    const decompressedBuffer = zlib.gunzipSync(compressedBuffer);
    fs.writeFileSync(dbPath, decompressedBuffer);

    console.log(`[SELF-HEALING] Successfully restored system to last clean backup: ${newestBackup}`);
    this.connection = new DatabaseConstructor(dbPath);
  }
}

export const dbManager = new DatabaseManager();
FILE 3.1.3: src/server.ts
Current Behavior: Unhandled exceptions in background worker processes or timer loops crash the entire Node.js application process
.
Target Behavior: Centralize process-level handlers to insulate the server, and mount a health readiness endpoint
.
import express from 'express';
import compression from 'compression'; // Enable Gzip for high-speed local packet transfers [55]
import { dbManager } from './database/connection.js';

const app = express();
app.use(compression()); [44]

let isSystemReady = false;

// Process Guardians to intercept uncaught async loops and keep the server online [10]
process.on('uncaughtException', (error) => {
  console.error('[PROCESS GUARDIAN] Captured uncaught exception:', error);
  // Log directly to a designated local file or console; prevent process termination
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[PROCESS GUARDIAN] Captured unhandled promise rejection at:', promise, 'reason:', reason);
});

// Database Readiness Gate [43, 44]
app.get('/api/health/ready', (req, res) => {
  if (!isSystemReady) {
    return res.status(503).json({ status: 'booting', message: 'Verifying database connection and schemas...' });
  }
  return res.status(200).json({ status: 'ready', message: 'Database connection verified.' });
});

// Initialize database safely [56]
try {
  const db = dbManager.getConnection();
  // Ensure schema, complete migrations
  isSystemReady = true;
} catch (err) {
  console.error('[BOOT CRITICAL] Database boot failed. App remains locked.', err);
}
PHASE 3.2: Configuration-Gated Background Silence
FILE 3.2.1: src/worker/emailPoller.ts
Current Behavior: Periodically checks IMAP inboxes unconditionally, spamming error logs when credentials are unconfigured
.
Target Behavior: Check database credentials at the start of the loop and skip the connection gracefully
.
import { dbManager } from '../database/connection.js';

export async function pollInboxLoop() {
  const db = dbManager.getConnection();
  
  // Query settings safely [14, 57]
  const gmailUser = db.prepare("SELECT value FROM app_settings WHERE key = 'gmail_user'").get() as { value: string } | undefined;
  const gmailPass = db.prepare("SELECT value FROM app_settings WHERE key = 'gmail_pass'").get() as { value: string } | undefined;
  const gmailAuthMethod = db.prepare("SELECT value FROM app_settings WHERE key = 'gmail_auth_method'").get() as { value: string } | undefined;

  // Configuration Gate Check [17]
  if (!gmailUser?.value || (gmailAuthMethod?.value === 'password' && !gmailPass?.value)) {
    console.log('[EMAIL POLLER GATER] IMAP email credentials are unconfigured. Polling loop is silent.');
    return; // Exit without running network socket operations
  }

  // Execute IMAP connection...
}
FILE 3.2.2: src/services/whatsappQueue.ts
Current Behavior: Sweeps the database queue table every 30 seconds even if WhatsApp Web is completely turned off
.
Target Behavior: Read the configuration flag and sleep when disabled, utilizing 0% CPU
.
import { dbManager } from '../database/connection.js';

export async function processWhatsAppQueue() {
  const db = dbManager.getConnection();
  
  const waEnabled = db.prepare("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'").get() as { value: string } | undefined;

  // Configuration Gate Check [17]
  if (!waEnabled || waEnabled.value !== 'true') {
    return; // Maintain total CPU and database silence
  }

  // Scan queue and process pending jobs [9, 58]
}
FILE 3.2.3: src/services/telegramPrescriptionService.ts
Current Behavior: Attempts bot connections blindly, throwing exceptions if credentials do not exist
.
Target Behavior: Return immediately without running listeners if unconfigured
.
import { dbManager } from '../database/connection.js';

export function initializeTelegramBot() {
  const db = dbManager.getConnection();
  
  const tgEnabled = db.prepare("SELECT value FROM app_settings WHERE key = 'telegram_enabled'").get() as { value: string } | undefined;
  const tgToken = db.prepare("SELECT value FROM app_settings WHERE key = 'telegram_token'").get() as { value: string } | undefined;

  // Configuration Gate Check [11, 17]
  if (!tgEnabled || tgEnabled.value !== 'true' || !tgToken?.value) {
    console.log('[TELEGRAM GATER] Telegram Bot integration is unconfigured or disabled. Listeners bypassed.');
    return; // Silent bypass
  }

  // Bind node-telegram-bot-api... [59]
}
PHASE 3.3: Visible-Screen-Only Math & Incremental Stock Ledger
FILE 3.3.1: src/routes/sales.ts
Current Behavior: Loops multiple N+1 queries during checkout, and fails to save static, pre-calculated invoice totals
.
Target Behavior: Atomic transactional increments/decrements, logging audit states to stock_ledger, and serving flat static records
.
import { Router } from 'express';
import { dbManager } from '../database/connection.js';

const router = Router();

router.post('/invoice', (req, res) => {
  const { items, customer_id, discount, payment_medium } = req.body;
  const db = dbManager.getConnection();

  try {
    db.transaction(() => {
      const invoiceNo = `S-${Date.now()}`;
      
      // Calculate totals once server-side [28]
      const totalAmount = items.reduce((acc: number, item: any) => acc + (item.rate * item.qty), 0);
      const taxAmount = totalAmount * 0.05; // Enforce 5% Flat Tax Contract [28]
      const netProfit = totalAmount - (totalAmount * 0.70); // 70% COGS calculation [61]

      // 1. Save static totals permanently inside the invoice header [33]
      db.prepare(`
        INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, tax_amount, net_profit, payment_medium)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(invoiceNo, customer_id, totalAmount, taxAmount, netProfit, payment_medium);

      // 2. Process stock adjustments atomically per item [28, 30]
      for (const item of items) {
        // Strict quantity decrement - prevents negative values or overselling [28, 62]
        const updateResult = db.prepare(`
          UPDATE inventory_master 
          SET quantity = quantity - ? 
          WHERE medicine_id = ? AND batch_no = ? AND (quantity >= ?)
        `).run(item.qty, item.medicine_id, item.batch_no, item.qty);

        if (updateResult.changes === 0) {
          throw new Error(`Insufficient stock found for Medicine ID: ${item.medicine_id}`);
        }

        // Write append-only entry to the stock_ledger audit table [28, 30, 60]
        db.prepare(`
          INSERT INTO stock_ledger (medicine_id, batch_no, quantity, transaction_type)
          VALUES (?, ?, ?, 'POS_SALE')
        `).run(item.medicine_id, item.batch_no, -item.qty);
      }
    })();

    return res.status(201).json({ success: true, message: 'POS Sale processed transactionally.' });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

// Fetch pre-saved computed totals for sales history lists in <2ms [56]
router.get('/list', (req, res) => {
  const db = dbManager.getConnection();
  const sales = db.prepare(`
    SELECT invoice_no, total_amount, tax_amount, net_profit, payment_medium, date 
    FROM sales_invoices 
    ORDER BY date DESC 
    LIMIT 100
  `).all();
  return res.json(sales);
});

export default router;
FILE 3.3.2: src/routes/purchases.ts
Current Behavior: Does not persist static bill cost parameters, requiring recalculation over items lists
.
Target Behavior: Write static bill totals to database columns at transaction time
.
import { Router } from 'express';
import { dbManager } from '../database/connection.js';

const router = Router();

router.post('/manual', (req, res) => {
  const { items, distributor_id, invoice_no, discount } = req.body;
  const db = dbManager.getConnection();

  try {
    db.transaction(() => {
      // 1. Calculate static totals once [48]
      const subtotal = items.reduce((acc: number, item: any) => acc + (item.rate * item.qty), 0);
      const taxTotal = subtotal * 0.12; // Standard 12% GST fallback [64]
      const totalAmount = subtotal + taxTotal - (discount || 0);

      // Save static totals to purchases table
      db.prepare(`
        INSERT INTO purchases (invoice_no, distributor_id, subtotal_amount, tax_amount, total_amount)
        VALUES (?, ?, ?, ?, ?)
      `).run(invoice_no, distributor_id, subtotal, taxTotal, totalAmount);

      // 2. Increment stock ledger atomically [30, 48]
      for (const item of items) {
        db.prepare(`
          INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date)
          VALUES (?, ?, ?, ?)
        `).run(item.medicine_id, item.qty, item.batch_no, item.expiry_date);

        db.prepare(`
          INSERT INTO stock_ledger (medicine_id, batch_no, quantity, transaction_type)
          VALUES (?, ?, ?, 'PURCHASE_RECEIPT')
        `).run(item.medicine_id, item.batch_no, item.qty);
      }
    })();

    return res.status(201).json({ success: true, message: 'Purchase bill committed transactionally.' });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
FILE 3.3.3: src/routes/settings.ts
Current Behavior: General configuration saves write directly to a phantom settings table rather than app_settings, and risk overwriting valid integration credentials
.
Target Behavior: Secure write transactions and restrict updates to settings metadata keys
.
import { Router } from 'express';
import { dbManager } from '../database/connection.js';

const router = Router();

// Protect active credentials from being cleared or blanked out by destructive saves [12, 16, 65]
const PROTECTED_CRED_KEYS = [
  'gmail_pass', 
  'pharmarack_password', 
  'telegram_token', 
  'wa_business_access_token'
];

router.post('/save', (req, res) => {
  const payload = req.body;
  const db = dbManager.getConnection();

  try {
    db.transaction(() => {
      for (const [key, value] of Object.entries(payload)) {
        // Enforce write path correctness: Use app_settings, never the incorrect settings table [13]
        const existing = db.prepare("SELECT value FROM app_settings WHERE key = ?").get() as { value: string } | undefined;

        if (PROTECTED_CRED_KEYS.includes(key) && (!value || String(value).trim() === '')) {
          continue; // Maintain existing credentials; skip blank configurations [12, 18]
        }

        db.prepare(`
          INSERT INTO app_settings (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(key, value);
      }
    })();

    return res.status(200).json({ success: true, message: 'Settings saved and validated successfully.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
PHASE 3.4: Frontend Memoization & Fast Virtualized Tables
FILE 3.4.1: frontend/src/pages/POS/index.tsx
Current Behavior: Recalculates cart rows on every render, causing UI lag during rapid key entry
.
Target Behavior: Memoize mathematical operations using useMemo hooks, restrict checks to visible items, and bypass phone checks for cash walk-ins when WhatsApp is off
.
import React, { useMemo, useState } from 'react';

export function POSBillingEngine() {
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [paymentMedium, setPaymentMedium] = useState<'CASH' | 'UPI' | 'CREDIT'>('CASH');
  const [sendWhatsApp, setSendWhatsApp] = useState<boolean>(false);
  const [phoneNumber, setPhone] = useState('');

  // Memoize cart totals [31, 32]
  const totals = useMemo(() => {
    let subtotal = 0;
    cartItems.forEach(item => {
      subtotal += (item.rate || 0) * (item.qty || 0);
    });
    const tax = subtotal * 0.05; // 5% Flat Tax Contract
    return {
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      grandTotal: (subtotal + tax).toFixed(2)
    };
  }, [cartItems]); // Recalculates ONLY if items or quantities mutate

  const handleCompleteSale = () => {
    // Phone Gater Check: Skip phone requirement for cash/walk-ins when WhatsApp is off [21]
    const isPhoneRequired = paymentMedium === 'CREDIT' || sendWhatsApp; [66]
    
    if (isPhoneRequired && phoneNumber.length < 10) {
      alert('A 10-digit phone number is required for Credit sales or WhatsApp receipts.');
      return;
    }

    // Process sale checkout... [28]
  };

  return (
    <div>
      {/* POS Cart UI */}
    </div>
  );
}
FILE 3.4.2: frontend/src/pages/Purchases/index.tsx
Current Behavior: Runs multiple parseFloat conversions on every render frame
.
Target Behavior: Cache manual entry forms using useMemo
.
import React, { useMemo, useState } from 'react';

export function PurchasesForm() {
  const [billItems, setBillItems] = useState<any[]>([]);

  // Memoize invoice totals [24, 31, 32]
  const invoiceTotals = useMemo(() => {
    let subtotal = 0;
    let totalTax = 0;

    billItems.forEach(item => {
      const rate = parseFloat(item.rate) || 0;
      const qty = parseInt(item.qty) || 0;
      const gst = parseFloat(item.gst) || 0;

      const itemTotal = rate * qty;
      subtotal += itemTotal;
      totalTax += itemTotal * (gst / 100);
    });

    return {
      subtotal: subtotal.toFixed(2),
      tax: totalTax.toFixed(2),
      grandTotal: (subtotal + totalTax).toFixed(2)
    };
  }, [billItems]); // Re-runs ONLY on billItems array mutations

  return (
    <div>
      {/* Bill Entry UI */}
    </div>
  );
}
FILE 3.4.3: frontend/src/pages/Inventory/index.tsx
Current Behavior: Performs multi-table SQL queries joining medicines and batches on scroll
.
Target Behavior: Pure read-only display using @tanstack/react-virtual with zero client-side stock calculations
.
import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual'; [67]

export function VirtualizedInventoryTable({ inventoryItems }: { inventoryItems: any[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Virtualize the list to render only the visible rows [5, 23]
  const rowVirtualizer = useVirtualizer({
    count: inventoryItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // Standard row height [23]
  });

  return (
    <div ref={parentRef} className="overflow-auto max-h-[600px] border border-glass-border rounded-xl">
      <div
        className="w-full relative"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = inventoryItems[virtualRow.index];
          return (
            <div
              key={item.id}
              className="absolute top-0 left-0 w-full flex border-b border-glass-border px-4 py-3"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="w-1/2 font-bold text-text">{item.name}</div>
              <div className="w-1/4 text-muted">Strips: {item.quantity}</div> {/* Flat display */}
              <div className="w-1/4 text-muted">Loose: {item.loose_quantity}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
================================================================================4. ANTI-REGRESSION SYSTEMS ARCHITECTURE
To maintain complete system stability, the new event-driven precalculated cache runs alongside the following isolated pipeline gates:
    [Legacy Migration Files]                 [Purchases & OCR Engine]
               │                                        │
               ▼                                        ▼
    [Isolated Staging SQLite]                [Staged Purchases UI]
   (Pre-check schema & integrity)           (Review tax & cost changes)
               │                                        │
               ├───────────────────┬────────────────────┘
               │                   │
               ▼                   ▼
     [Final Approve Trigger] ──► [BEGIN IMMEDIATE DB TRANSACTION]
                                   │
                                   ├──► UPDATE inventory_master (Single Write) [28]
                                   ├──► INSERT stock_ledger (Audit Write) [28]
                                   └──► COMMIT ──► [Server-Sent Events Broadcast] [68]
Legacy Migration Safeguard
:
All legacy imported data (such as Marg or DGH datasets) is loaded directly into an isolated staging database
.
Finalizing the migration executes the schema cutover routine
. This routine calculates first-time stock ledger totals and writes them directly into inventory_master
. Only after this step is complete does the application transition to incremental/decremental ledger changes.
Purchase Invoice Auto-Extraction:
OCR-scanned invoices or email attachments resolve medicine name aliases cleanly
.
Staged data is rendered inside the manual Purchases page preview
. Upon approval, the saving transaction increments physical stock in inventory_master transactionally
.
POS Bill Cart Hold & Restore:
Holding a bill serializes and saves the active cart state to the held_bills table
.
Restoring the bill pulls the JSON array back into frontend memory, verifying stock levels on the screen before the transaction is finalized
.
================================================================================5. THE AGENT ANTI-HALLUCINATION & GLOBAL VERIFICATION LOOP
The agent MUST execute every verification command in the loop below. No assumptions are allowed.
                  ┌──────────────────────────────────────────┐
                  │   STEP 5.1: PRE-IMPLEMENTATION VALIDATE  │
                  │   - Verify all 18 files exist in workspace│
                  │   - Create local backup data/app.db.bak  │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   STEP 5.2: VERIFY COMPILATION & TYPES   │
                  │   - Run backend check: npx tsc --noEmit  │
                  │   - Run frontend check: npx tsc -b       │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   STEP 5.3: TEST TRANSACTIONAL WORKFLOWS │
                  │   - Confirm cash checkouts succeed       │
                  │   - Verify OCR mappings parse correctly  │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   STEP 5.4: INTEGRITY & AUDIT SAFETY     │
                  │   - Run: node scripts/quick-update.mjs   │
                  │   - Ensure PROJECT_AUDIT.md matches      │
                  └──────────────────────────────────────────┘
[ ] Step 5.1: Pre-Implementation Verification
Verify all 18 files listed in section 2 are present and accessible.
Take a copy-backup of the local SQLite file (data/app.db) before applying any changes.
[ ] Step 5.2: Compilation & Types Validation
Run the backend compiler check:
Run the frontend package compiler check:
[ ] Step 5.3: Transactional Workflow Verification
Test a Cash Walk-In checkout with WhatsApp disabled. Verify it saves successfully without requiring a phone number.
Test a Credit checkout. Verify the phone number prompt is strictly enforced.
Verify legacy migrations continue to write data into the staging database before cutover
.
Verify OCR invoice auto-extraction continues to map columns and pre-fill Purchases without errors
.
[ ] Step 5.4: Integrity & Audit Safety
Run the auto-knowledge graph updater to ensure all edited file relationships are correctly recorded:
Confirm the updated knowledge graph is cleanly updated.

***

📊 **What should we do next?** We can proceed with implementing **Phase 3.2: Configuration-Gated Background Silence** for the Gmail IMAP, WhatsApp, and Telegram services directly in your backend codebase, or begin drafting the precise **`useMemo` mathematical layout** for your POS cart row!