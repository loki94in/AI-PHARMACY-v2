# ENGINEERING PRD & IMPLEMENTATION PLAN: CONFIG-GATED SILENCE & SCREEN-ONLY MATH
# SYSTEM PATH: AI PHARMACY v2 (OFFLINE-FIRST PHARMACY OS)
# HARDWARE CONSTRAINT: INTEL i3 3RD-GEN (2 CORES, 4 THREADS, HDD, NO AVX2)
# TARGET RUNTIME FOOTPRINT: 0% IDLE CPU PROCESS CHURN, <5ms INTERACTIVE RENDERING [RC-1, RC-2, RC-3]

================================================================================
1. ARCHITECTURAL SCOPE & FILE INVENTORY (FILE COUNT & MATRIX)
================================================================================
To achieve a completely silent background state and eliminate wasteful data recalculations across the app, a total of 15 files must be modified (6 Backend, 9 Frontend). No core data schemas or tables are deleted or structurally broken. All migrations, purchases, and POS features remain 100% functional.

### 1.1 Backend Files to Modify (6 Files)
1. `src/server.ts` — Centralized cron/timer initialization gate.
2. `src/config/index.ts` — Retain test-mode authentication bypass and configuration environment settings [1, 2].
3. `src/worker/emailPoller.ts` — IMAP polling worker gating [3-5].
4. `src/services/telegramPrescriptionService.ts` — Telegram bot listener gating [4, 6].
5. `src/services/whatsappQueue.ts` — WhatsApp message sender gating [4, 6].
6. `src/routes/sales.ts` — Transactional inventory increment/decrement ledger triggers [7-9].

### 1.2 Frontend Files to Modify (9 Files)
1. `frontend/src/pages/POS/index.tsx` — Memoize cart item calculations, bound math to active screen items, preserve test-bypass authorization indicators [10, 11].
2. `frontend/src/pages/Inventory/index.tsx` — Transition page list to a pure read-only indexed render, eliminating aggregate stock query loops [12].
3. `frontend/src/pages/Purchases/index.tsx` — Implement memoization for tax, subtotal, and margins during manual bill entry [13].
4. `frontend/src/pages/Sells/index.tsx` — Direct rendering from static pre-saved totals [14].
5. `frontend/src/pages/PurchaseHistory/index.tsx` — Direct rendering from static pre-saved invoice totals [15, 16].
6. `frontend/src/pages/Reports/index.tsx` — Read pre-calculated metrics compiled at write-time [17, 18].
7. `frontend/src/pages/Learning/index.tsx` — Render live status indicators bound to active gater states [19, 20].
8. `frontend/src/pages/Settings/index.tsx` — Unify configuration gating toggles for background silence [21, 22].
9. `frontend/src/components/Layout.tsx` — Central status banners that dynamically react to config gates without polling [23].

================================================================================
2. PHASE 1: CONFIGURATION-GATED BACKGROUND SILENCE (BACKEND PROCESSES)
================================================================================

--------------------------------------------------------------------------------
2.1 EMAIL / IMAP INGESTION TIMER GATING
--------------------------------------------------------------------------------
- CURRENT BEHAVIOR: At boot, `server.ts` spins up a background worker `emailPoller.ts` that automatically starts an active connection loop to poll Gmail via IMAP every 5 minutes [4, 5, 24]. If the user hasn't configured their email app passwords, the process throws uncaught connection exceptions, spamming the log files and wasting CPU thread cycles [24, 25].
- NEW BEHAVIOR: On startup, the poller checks the DB settings. If Gmail App credentials or OAuth parameters are empty or unconfigured, the poller exits immediately and never starts an active network socket connection [26].
- CODE CHANGE DESIGN (`src/worker/emailPoller.ts`):
```typescript
import { dbManager } from '../database/connection.js';

export async function initEmailPoller() {
  const db = dbManager.getConnection();
  const gmailUser = db.prepare("SELECT value FROM app_settings WHERE key = 'gmail_user'").get()?.value;
  const gmailPass = db.prepare("SELECT value FROM app_settings WHERE key = 'gmail_pass'").get()?.value;
  const gmailAuthMethod = db.prepare("SELECT value FROM app_settings WHERE key = 'gmail_auth_method'").get()?.value;

  if (!gmailUser || (gmailAuthMethod === 'password' && !gmailPass)) {
    console.log('[EMAIL POLLER GATER] Email credentials are not configured. Background IMAP poller remains silent.');
    return; // Exit without setting up active intervals or network sockets
  }

  // Proceed with existing IMAP polling logic...
}
2.2 WHATSAPP MESSAGE QUEUE SILENCE
CURRENT BEHAVIOR: A persistent background timer in whatsappQueue.ts wakes up every 30 seconds to scan the pending_whatsapp_jobs table, regardless of whether WhatsApp is enabled or connected
.
NEW BEHAVIOR: The queue worker evaluates the whatsapp_enabled key in app_settings
. If it is not 'true', the queue sleep interval is locked, running zero SELECT statements against the database.
CODE CHANGE DESIGN (src/services/whatsappQueue.ts):
export async function processWhatsAppQueue() {
  const db = dbManager.getConnection();
  const waEnabled = db.prepare("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'").get()?.value;

  if (waEnabled !== 'true') {
    return; // Do not query the pending table, perform no work, maintain total silence
  }

  // Scan queue and process messages...
}
2.3 TELEGRAM PRESCRIPTION BOT SILENCE
CURRENT BEHAVIOR: The server initializes a connection to the Telegram Bot API on boot, registering listeners even if no bot token exists
.
NEW BEHAVIOR: The bot connection remains completely uninitialized if the Telegram integration toggle is disabled
.
CODE CHANGE DESIGN (src/services/telegramPrescriptionService.ts):
export function initializeTelegramBot() {
  const db = dbManager.getConnection();
  const telegramEnabled = db.prepare("SELECT value FROM app_settings WHERE key = 'telegram_enabled'").get()?.value;
  const telegramToken = db.prepare("SELECT value FROM app_settings WHERE key = 'telegram_token'").get()?.value;

  if (telegramEnabled !== 'true' || !telegramToken) {
    console.log('[TELEGRAM GATER] Telegram Bot is disabled or missing a token. Network listeners are not registered.');
    return; // Skip bot initialization completely
  }

  // Initialize node-telegram-bot-api...
}
2.4 TESTING PHASE auth BYPASS RETENTION
CURRENT BEHAVIOR: When running in local development or staging, the SKIP_AUTH=true environment variable allows testing pages without mandatory credential lockouts
.
NEW BEHAVIOR: This logic must be preserved exactly as-is so you can continue testing POS, Purchases, and Inventory. The auth bypass check in src/middleware/auth.ts remains intact, and the system logs a prominent warning when authentication is bypassed so that it is never accidentally left open in production deployments
.
================================================================================3. PHASE 2: NO WASTEFUL RECALCULATIONS (VISIBLE-SCREEN-ONLY MATH)
3.1 INCREMENTAL / DECREMENTAL STOCK LEDGER MODEL (INVENTORY PAGE)
CURRENT BEHAVIOR: Opening the Inventory page or switching tabs currently triggers heavy database calculations, joining multiple tables on the fly to count remaining quantities
.
NEW BEHAVIOR: Inventory is treated as a simple, transactional increment/decrement ledger
. When a transaction is saved, the quantities are modified instantly. The Inventory page performs zero calculations on load; it simply reads the pre-saved, indexed, static numbers from the inventory_master table
.
CODE DESIGN FOR TRANSACTION STOCK WRITES (src/routes/sales.ts):
// DuringPOS checkout transaction:
dbManager.transaction(async (db) => {
  // 1. Deduct stock using transactional math:
  db.prepare(`
    UPDATE inventory_master 
    SET quantity = quantity - ?, loose_quantity = loose_quantity - ?
    WHERE medicine_id = ? AND batch_no = ?
  `).run(soldQty, soldLooseQty, medicineId, batchNo);

  // 2. Insert chronological stock ledger delta for auditing:
  db.prepare(`
    INSERT INTO stock_ledger (medicine_id, batch_no, quantity, loose_quantity, transaction_type, transaction_id)
    VALUES (?, ?, ?, ?, 'POS_SALE', ?)
  `).run(medicineId, batchNo, -soldQty, -soldLooseQty, invoiceId);
});
FRONTEND RENDER DESIGN (frontend/src/pages/Inventory/index.tsx): The page fetches the pre-calculated database rows directly. We use @tanstack/react-virtual to display the rows instantly
:
// Zero on-the-fly math, zero map loops inside the render body
const virtualRows = useVirtualizer({
  size: inventoryItems.length,
  parentRef,
  estimateSize: () => 50,
});

return (
  <div ref={parentRef}>
    {virtualRows.getVirtualItems().map(virtualRow => {
      const item = inventoryItems[virtualRow.index];
      return (
        <div key={item.id} style={{ height: `${virtualRow.size}px` }}>
          <span>{item.name}</span>
          <span>Strips: {item.quantity} | Loose: {item.loose_quantity}</span> {/* Flat display */}
        </div>
      );
    })}
  </div>
);
3.2 VISIBLE-SCREEN-ONLY MATH (POS & PURCHASES FORM PREVIEW)
CURRENT BEHAVIOR: Typing inside POS or entering items into a massive Purchase Bill forces the client to calculate subtotals, GSTs, and margins across all items on every keystroke, causing severe UI lag
.
NEW BEHAVIOR: The application utilizes strict useMemo to memoize mathematical calculations. Taxes, discounts, and margins are calculated only for the specific rows active on the screen
.
FRONTEND RENDER DESIGN (frontend/src/pages/Purchases/index.tsx):
// Memoize calculations so typing is butter-smooth at 60fps on i3 dual-core CPUs:
const calculatedTotals = useMemo(() => {
  let subtotal = 0;
  let taxTotal = 0;
  
  cartItems.forEach(item => {
    const rate = parseFloat(item.rate) || 0;
    const qty = parseInt(item.quantity) || 0;
    const gstPer = parseFloat(item.cgst_per) + parseFloat(item.sgst_per) || 0;
    
    const rowSubtotal = rate * qty;
    const rowTax = rowSubtotal * (gstPer / 100);
    
    subtotal += rowSubtotal;
    taxTotal += rowTax;
  });

  return {
    subtotal: subtotal.toFixed(2),
    taxTotal: taxTotal.toFixed(2),
    grandTotal: (subtotal + taxTotal).toFixed(2),
  };
}, [cartItems]); // Recalculates ONLY when cartItems array length or row values mutate
3.3 STATIC INVOICE TOTALS (SELLS & PURCHASE HISTORY PAGES)
CURRENT BEHAVIOR: Opening historical lists or reports triggers on-the-fly SQL aggregate sums over thousands of rows
.
NEW BEHAVIOR: When an invoice (POS or Purchase) is finalized, its final totals (gross amount, taxes, net profit) are calculated once and saved permanently inside static columns in sales_invoices and purchases
. When browsing Sells or Purchase History, the frontend simply reads these pre-saved totals directly, doing 0 calculations.
CODE DESIGN FOR DIRECT FLAT READS (src/routes/sales.ts):
-- Direct query loads pre-saved calculated totals instantly in <2ms:
SELECT invoice_no, total_amount, tax_amount, net_profit, payment_medium, date 
FROM sales_invoices 
ORDER BY date DESC 
LIMIT 100;
================================================================================4. THE SYSTEM INTEGRITY PROTECTION PIPELINE (ANTI-BREAK MODULE GATES)
To prevent breaking existing core workflows when shifting to this pre-calculated ledger model, the following verification gates are strictly enforced:
Migration Integrity Safeguard [3.6, 191]:
The /api/migration endpoints remain fully public and run inside an isolated staging database
.
Finalizing a legacy migration calls the existing rebuildMigrationInventoryStock routine
. This recalculates the first-time ledger quantities from the imported history, sets the baseline, and populates the inventory_master quantities. Only then does the app hand off control to our incremental/decremental ledger updates
.
Purchase Invoice Auto-Extraction
:
OCR-scanned invoices or email attachments continue to resolve to the correct medicine aliases
.
They load into the manual Purchases page preview, allowing the pharmacist to review taxes before saving
. Once approved, the saving transaction increases the baseline physical stock in inventory_master transactionally
.
POS Bill Cart Hold & Restore
:
Holding a bill serialize-saves the current active cart to the held_bills table.
Restoring a bill pulls the JSON data back into the frontend memory cache, verifying stock levels on the screen before the transaction is saved
.
================================================================================5. THE AGENT ANTI-HALLUCINATION & GLOBAL VERIFICATION LOOP
To guarantee zero-error execution, the coding agent MUST execute and report the results of every step in this loop. No steps are skipped.
                  ┌──────────────────────────────────────────┐
                  │   STEP 5.1: PRE-IMPLEMENTATION DEPS      │
                  │   - Verify all 15 files exist via tsc    │
                  │   - Snapshot existing database file      │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   STEP 5.2: STEP-BY-STEP DEVELOPMENT     │
                  │   - Modify backend silencers one by one   │
                  │   - Apply memoization to POS & Purchases │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   STEP 5.3: COMPILATION & BUILD SANITY   │
                  │   - Run backend check: npx tsc --noEmit  │
                  │   - Run frontend check: npx tsc -b       │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   STEP 5.4: FUNCTIONAL REGRESSION CHECKS │
                  │   - Verify cash bill walk-in checkout    │
                  │   - Verify OCR invoice auto-mapping      │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   STEP 5.5: GRAPH & AUDIT INTEGRITY      │
                  │   - Run: node scripts/quick-update.mjs   │
                  │   - Ensure PROJECT_AUDIT.md matches      │
                  └──────────────────────────────────────────┘
Step 5.1: Pre-Implementation Sanity Checks
[ ] Confirm all 15 files to modify exist and are readable using view_file or list_dir
.
[ ] Take a temporary file-copy backup of your development data/app.db before making any database-related changes
.
Step 5.2: Step-by-Step Development Order
[ ] Modify src/worker/emailPoller.ts to implement config-gated silence
.
[ ] Modify src/services/telegramPrescriptionService.ts to implement config-gated silence
.
[ ] Modify src/services/whatsappQueue.ts to implement config-gated silence
.
[ ] Implement incremental/decremental ledger changes in src/routes/sales.ts and src/routes/purchases.ts
.
[ ] Add useMemo hooks for on-screen cart math in frontend/src/pages/POS/index.tsx and frontend/src/pages/Purchases/index.tsx
.
[ ] Remove on-the-fly SQL recalculations from Sells, Inventory, and Reports, moving to flat, indexed column reads
.
Step 5.3: Compilation & Build Verification
[ ] Run backend typecheck from project root: $ npx tsc --noEmit
[ ] Run frontend typecheck from frontend/ directory: $ npx tsc -b --force --noEmit
[ ] Run Vite production build to verify bundles split cleanly without syntax errors: $ npm run build --prefix frontend
Step 5.4: Regression Testing (Do Not Re-break)
[ ] Check a Cash Walk-In Sale checkout (with WhatsApp off) → Verify it saves immediately without forcing a phone number prompt
.
[ ] Check a Credit Sale → Verify it requires a valid 10-digit phone number
.
[ ] Verify Legacy Migration is untouched and successfully inserts rows into staging DB first
.
[ ] Verify OCR Invoice Extraction continues to map columns and pre-fill Purchases without errors
.
Step 5.5: Knowledge Graph Synchronization
[ ] Run the auto-knowledge graph updater to ensure all edited file relationships are correctly recorded: $ node scripts/quick-update.mjs
[ ] Verify PROJECT_AUDIT.md has refreshed and cleanly reflects your structural changes
.

---

📊 **What should we do next?** We can proceed with implementing **Phase 1: Config-Gated Background Silence** for the IMAP, WhatsApp, and Telegram services directly in your backend codebase, or begin drafting the precise **`useMemo` mathematical layout** for your POS cart row!