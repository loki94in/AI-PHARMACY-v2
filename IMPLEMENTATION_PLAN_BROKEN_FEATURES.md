# AI Pharmacy v2 — Broken & Incomplete Features Implementation Plan

> **Document type:** Implementation plan for fixing all broken, incomplete, and half-built features  
> **Created:** 2026-08-04  
> **Status:** SAVED — DO NOT IMPLEMENT UNTIL RE-VERIFIED BY AGENT  
> **Total Items:** 39 (4 Critical, 11 High, 13 Medium, 11 Low)  
> **Estimated Total Time:** ~22-28 hours  
> **Safety Rule:** Every phase MUST be verified by agent before proceeding to next phase

---

## RE-VERIFICATION PROTOCOL

Before implementing ANY phase, the agent MUST:

1. **Read this entire plan** — understand all dependencies
2. **Read `AGENTS.md`** — understand all contracts and guardrails
3. **Read `SMALL_BUG_FIX_PLAN.md`** — understand what's already fixed
4. **Verify each finding** listed in the phase by reading the actual source file
5. **Confirm the finding still exists** — code may have been updated since audit
6. **Check for conflicts** — ensure fix doesn't break adjacent features
7. **Run `node scripts/quick-update.mjs`** after every file change
8. **Run typecheck/lint** after every phase completion

**If any finding has already been fixed, SKIP it and note "ALREADY FIXED" in the phase log.**

---

## PHASE 1: CRITICAL — Schema & Data Fixes (2-3 hours)

> **Priority:** P0 — Breaks core functionality or causes data loss  
> **Risk:** LOW — These are additive schema changes and targeted bug fixes  
> **Prerequisite:** Re-verify each finding still exists

### 1A. Create `credit_notes` table in database schema

**Finding:** `src/routes/creditNotes.ts` queries `credit_notes` table but `src/database.ts` never creates it. All `/api/credit-notes/*` endpoints throw `no such table`.

**File to edit:** `src/database.ts`

**Implementation:**
```sql
-- Add inside the main schema initialization, after the last CREATE TABLE IF NOT EXISTS block
CREATE TABLE IF NOT EXISTS credit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distributor_id INTEGER,
  cn_number TEXT,
  cn_date TEXT,
  amount REAL DEFAULT 0,
  applied_amount REAL DEFAULT 0,
  reason TEXT,
  related_purchase_id INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (distributor_id) REFERENCES distributors(id),
  FOREIGN KEY (related_purchase_id) REFERENCES purchases(id)
);
```

**Verification:**
- [ ] Table exists after server start: `SELECT name FROM sqlite_master WHERE type='table' AND name='credit_notes'`
- [ ] `GET /api/credit-notes` returns empty array (not error)
- [ ] `POST /api/credit-notes` with test data succeeds
- [ ] `GET /api/credit-notes/:id` returns the created record

**Dependencies:** None

---

### 1B. Fix Schedule H1 Compliance Register — write/read table mismatch

**Finding:** `src/routes/compliance.ts` writes to `action_logs` but reads from `compliance_logs`. The H1 register always returns empty.

**File to edit:** `src/routes/compliance.ts`

**Implementation:**
- Change POST `/add` (line ~40) to INSERT INTO `compliance_logs` with proper structured columns
- Change POST `/add-schedule-h1` (line ~62) to INSERT INTO `compliance_logs` with proper structured columns
- Keep the GET `/h1-register` (line ~77) reading from `compliance_logs` (already correct)

**SQL for POST `/add` should become:**
```sql
INSERT INTO compliance_logs (date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type)
VALUES (?, ?, ?, ?, ?, ?, ?, 'general')
```

**SQL for POST `/add-schedule-h1` should become:**
```sql
INSERT INTO compliance_logs (date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type)
VALUES (?, ?, ?, ?, ?, ?, ?, 'H1')
```

**Verification:**
- [ ] POST a compliance entry → check `compliance_logs` table has the row
- [ ] POST a schedule H1 entry → check `compliance_logs` table has the row with `schedule_type = 'H1'`
- [ ] GET `/h1-register` returns the posted entries
- [ ] Data in `action_logs` for `COMPLIANCE_ENTRY` / `SCHEDULE_H1_DISPENSE` action types is NOT lost (check if any existing data should be migrated)

**Dependencies:** None

---

### 1C. Fix Cash Bill Phone Validation (OPEN-02)

**Finding:** `handleCompleteSale()` in POS requires phone number for ALL payment types, blocking cash sales.

**File to edit:** `frontend/src/pages/POS/index.tsx` (~line 1846)

**Implementation:**
- Gate the phone validation to only trigger when `paymentMedium === 'CREDIT'` OR when user has WhatsApp enabled
- For cash/walk-in with WhatsApp off, skip the phone number requirement
- Keep the phone validation for credit sales and WhatsApp-enabled transactions

**Pseudo-code:**
```tsx
// BEFORE (broken)
if (!isValid10DigitPhone(phoneNumber)) {
  setShowPhoneModal(true);
  return;
}

// AFTER (fixed)
const requiresPhone = paymentMedium === 'CREDIT' || sendWhatsApp;
if (requiresPhone && !isValid10DigitPhone(phoneNumber)) {
  setShowPhoneModal(true);
  return;
}
```

**Verification:**
- [ ] Cash bill with empty phone → saves successfully (no phone modal)
- [ ] Cash bill with WhatsApp enabled + empty phone → shows phone modal
- [ ] Credit bill with empty phone → shows phone modal
- [ ] Credit bill with valid phone → saves successfully

**Dependencies:** None

---

## PHASE 2: CRITICAL — Security & Auth Fixes (1-2 hours)

> **Priority:** P0 — Security vulnerabilities  
> **Risk:** MEDIUM — Auth changes can break login flow  
> **Prerequisite:** Phase 1 complete, re-verify findings

### 2A. Remove hardcoded default credentials

**Finding:** `src/database.ts` seeds `admin123`/`master999` passwords. `src/config/index.ts` has hardcoded API key fallback `Pass@123`.

**Files to edit:**
- `src/database.ts` — Remove or gate the seed INSERT for default users
- `src/config/index.ts` — Remove hardcoded API key fallback

**Implementation:**
- Check if this is the first-run seed (only inserts if no users exist) — if so, it may be acceptable but should force password change on first login
- If it's a fallback that always runs, remove it entirely
- Replace API key fallback with `throw new Error('API_KEY environment variable required')`

**Verification:**
- [ ] Fresh install creates admin user with a random password (printed to console/logs)
- [ ] No hardcoded credentials appear in source code
- [ ] App refuses to start if `API_KEY` env var is missing

**Dependencies:** None

---

### 2B. Fix auth bypass in development mode

**Finding:** Auth middleware skips verification when `NODE_ENV !== 'production'`.

**File to edit:** Auth middleware (likely `src/middleware/auth.ts` or `src/server.ts` auth setup)

**Implementation:**
- Remove the `NODE_ENV` bypass entirely
- Or change it to only bypass in a specific `NODE_ENV=development` check (not any non-production value)

**Verification:**
- [ ] With `NODE_ENV=development`, auth still required
- [ ] With `NODE_ENV=test`, auth can be bypassed (if needed for tests)
- [ ] Login flow works correctly in all environments

**Dependencies:** None

---

## PHASE 3: HIGH — Background Workers & Automation (1-2 hours)

> **Priority:** P1 — Major feature gaps, stock calculations stale  
> **Risk:** LOW — Workers are currently disabled, enabling them is additive  
> **Prerequisite:** Phase 1-2 complete, re-verify findings

### 3A. Enable stock calculator worker

**Finding:** `DISABLE_BACKGROUND_WORKERS` defaults to `'true'`, killing all cron jobs and the stock calculator.

**File to edit:** `src/server.ts` line 68

**Implementation:**
- Change default from `'true'` to `'false'`
- Keep the env var override so it can be disabled if needed
- Verify `setupCrons()` actually registers cron jobs when enabled

```typescript
// BEFORE
process.env.DISABLE_BACKGROUND_WORKERS = process.env.DISABLE_BACKGROUND_WORKERS || 'true';

// AFTER
process.env.DISABLE_BACKGROUND_WORKERS = process.env.DISABLE_BACKGROUND_WORKERS || 'false';
```

**Verification:**
- [ ] Server starts and logs show cron jobs being registered
- [ ] Stock calculator worker runs and updates `stock_config` table
- [ ] `reorder_level` and `min_stock_level` values are recalculated
- [ ] Setting `DISABLE_BACKGROUND_WORKERS=true` env var disables them again

**Dependencies:** None

---

### 3B. Enable self-healing workers

**Finding:** `DISABLE_SELF_HEALING_WORKERS` defaults to `'true'`.

**File to edit:** `src/server.ts` line 69

**Implementation:**
- Same pattern as 3A — change default to `'false'`

**Verification:**
- [ ] Self-healing workers start on server boot
- [ ] Setting `DISABLE_SELF_HEALING_WORKERS=true` env var disables them

**Dependencies:** 3A (same pattern)

---

### 3C. Clean up substitute cache worker stub

**Finding:** `src/worker/substituteCacheWorker.ts` is an empty function body. `startSubstituteCacheWorker()` is commented out.

**Files to edit:**
- `src/worker/substituteCacheWorker.ts` — Either implement or delete
- `src/server.ts` line 451 — Remove commented-out import/call

**Implementation (Option A — Delete):**
- Remove `substituteCacheWorker.ts`
- Remove the commented-out `startSubstituteCacheWorker()` line from `server.ts`
- Remove any imports of this module

**Implementation (Option B — Keep as documented no-op):**
- Keep the file but add clear JSDoc: "This worker is intentionally disabled. Dynamic composition-match lookup is used instead."
- Remove the commented-out call from `server.ts`

**Verification:**
- [ ] No TypeScript errors after removal
- [ ] Server starts cleanly
- [ ] Grep for `substituteCacheWorker` shows no dangling references

**Dependencies:** None

---

## PHASE 4: HIGH — Dead Code Cleanup (2-3 hours)

> **Priority:** P1 — Reduces confusion, bundle size, and maintenance burden  
> **Risk:** LOW — Removing unused code  
> **Prerequisite:** Phase 3 complete, re-verify all items are truly dead

### 4A. Delete `src/routes/v1/sales.ts`

**Finding:** 789-line orphan route file, never imported in `server.ts`.

**File to delete:** `src/routes/v1/sales.ts`

**Verification:**
- [ ] `grep -r "routes/v1/sales" src/` returns zero matches
- [ ] No import references this file
- [ ] TypeScript compiles without errors
- [ ] `/api/sales/*` endpoints still work (they use `routes/sales.ts`)

**Dependencies:** None

---

### 4B. Delete `src/services/nNotificationService.ts`

**Finding:** Duplicate file with typo in name. Never imported.

**File to delete:** `src/services/nNotificationService.ts`

**Verification:**
- [ ] `grep -r "nNotificationService" src/` returns zero matches
- [ ] `src/services/notificationService.ts` (the correct file) still exists and works

**Dependencies:** None

---

### 4C. Delete `src/whatsappHandler.ts`

**Finding:** Never imported. WhatsApp handling migrated to `whatsappClient.ts`.

**File to delete:** `src/whatsappHandler.ts`

**Verification:**
- [ ] `grep -r "whatsappHandler" src/` returns zero matches
- [ ] No import references this file

**Dependencies:** None

---

### 4D. Delete or wire up `src/middleware/validation.ts`

**Finding:** Never imported. Exports validation functions.

**Option A (Delete):** Remove the file entirely if validation is handled inline in routes.

**Option B (Wire up):** Import and use in high-value routes (sales, purchases) for input validation.

**Recommendation:** Option A for now, Option B in a future security hardening pass.

**Verification:**
- [ ] No TypeScript errors after deletion
- [ ] Existing route validation (inline) still works

**Dependencies:** None

---

### 4E. Delete or wire up `src/middleware/licenseGate.ts`

**Finding:** Never imported AND internally bypassed with `return next()`.

**Option A (Delete):** Remove entirely if licensing is not a feature.

**Option B (Implement):** Remove the bypass, wire into `server.ts`, implement actual license checking.

**Recommendation:** Delete for now if license enforcement is not active. If it's a planned feature, keep but mark with clear TODO.

**Verification:**
- [ ] No TypeScript errors
- [ ] Server starts cleanly

**Dependencies:** None

---

### 4F. Remove dead frontend components

**Finding:** `AdminMatchPanel.tsx` (381 lines) is exported but never imported.

**File to delete:** `frontend/src/components/AdminMatchPanel.tsx`

**Verification:**
- [ ] `grep -r "AdminMatchPanel" frontend/src/` returns zero matches (after deletion)
- [ ] No TypeScript errors

**Dependencies:** None

---

### 4G. Remove dead imports in POS and Purchases

**Finding:**
- `POS/index.tsx:8` — `BrandBanner` imported but never used
- `Purchases/index.tsx:10` — `PriceIntelPanel` imported but never rendered

**Files to edit:**
- `frontend/src/pages/POS/index.tsx` — Remove unused import
- `frontend/src/pages/Purchases/index.tsx` — Remove unused import

**Verification:**
- [ ] No TypeScript errors
- [ ] POS page renders correctly
- [ ] Purchases page renders correctly

**Dependencies:** None

---

### 4H. Delete orphan page files

**Finding:** 5 page files exist on disk but are no longer routed (children of other pages).

**Files to evaluate:**
- `frontend/src/pages/Expiry/index.tsx` — Embedded in Returns
- `frontend/src/pages/CustomerReturn/index.tsx` — Embedded in Returns
- `frontend/src/pages/CustomerReturnHistory/index.tsx` — Embedded in Returns
- `frontend/src/pages/CatalogUpload/index.tsx` — Embedded in Database
- `frontend/src/pages/NonMappedDistributors/index.tsx` — Embedded in PharmarackCart

**Verification BEFORE deletion:**
- [ ] Confirm each file IS imported as a child component in its parent
- [ ] Confirm the parent handles the rendering (not the router)
- [ ] Confirm no other file imports these pages independently

**Dependencies:** None

---

## PHASE 5: MEDIUM — Notification & Email Fixes (3-4 hours)

> **Priority:** P2 — Degraded UX, missing features  
> **Risk:** MEDIUM — Email/notification changes can break delivery  
> **Prerequisite:** Phase 4 complete, re-verify findings

### 5A. Implement email notification channel

**Finding:** `src/services/notificationService.ts:121-125` — email case is a stub returning failure.

**File to edit:** `src/services/notificationService.ts`

**Implementation:**
- Use the existing `emailService.ts` infrastructure (nodemailer is already a dependency)
- Implement the `'email'` case to call `emailService.sendEmail()` or similar
- Add proper error handling and retry logic

**Verification:**
- [ ] `sendNotification({ type: 'email', ... })` returns `{ success: true }`
- [ ] Email is actually delivered (check inbox)
- [ ] Failed deliveries are logged and retried

**Dependencies:** None (emailService.ts already exists)

---

### 5B. Enable email invoice parsing (processMedicineOrder)

**Finding:** `src/services/emailService.ts:1502` — `processMedicineOrder` is commented out.

**File to edit:** `src/services/emailService.ts`

**Implementation:**
- Uncomment the `await this.processMedicineOrder(email)` call
- Verify `processMedicineOrder` method (line 1571) is functional
- Add error handling so a single bad email doesn't crash the pipeline
- Add a user-facing notification/queue so users can review before importing

**Verification:**
- [ ] Send a test email with a CSV/XLSX attachment
- [ ] Check that `processMedicineOrder` is called
- [ ] Check that the attachment is parsed
- [ ] Check that parsed data appears in the purchase import queue (not auto-imported)
- [ ] Error in one email doesn't crash the email poller

**Dependencies:** None

---

### 5C. Implement background enrichment on purchase save

**Finding:** Background enrichment is commented out in 3 locations.

**Files to edit:**
- `src/routes/purchases.ts:1273` — Uncomment enrichment loop
- `src/routes/catalog.ts:251` — Uncomment post-import enrichment
- `src/worker/catalogWorker.ts:971` — Uncomment enrichment block

**Implementation:**
- Uncomment each block
- Add error handling so enrichment failure doesn't block the save/import
- Add a "skip enrichment" flag for bulk imports where enrichment would be too slow

**Verification:**
- [ ] Save a purchase → enrichment runs in background
- [ ] Import a catalog → enrichment runs after import
- [ ] Enrichment failure doesn't block the primary operation
- [ ] "Skip enrichment" flag works for bulk imports

**Dependencies:** None

---

### 5D. Fix "Coming Soon" catch-all route

**Finding:** `frontend/src/App.tsx:155-158` — Shows "Coming Soon" for unmatched routes.

**File to edit:** `frontend/src/App.tsx`

**Implementation:**
- Replace with a proper 404 page
- Show "Page not found" with a link back to dashboard
- Log the attempted navigation for analytics

**Verification:**
- [ ] Navigate to `/nonexistent-page` → shows "Page not found"
- [ ] Click "Go to Dashboard" → navigates to `/dashboard`
- [ ] No "Coming Soon" text anywhere in the app

**Dependencies:** None

---

### 5E. Fix connection leak in email auto-response

**Finding:** `src/services/emailService.ts:1660,1675,1683` — Three `dbManager.getConnection()` without close.

**File to edit:** `src/services/emailService.ts`

**Implementation:**
- Refactor to use a single connection for the method
- Wrap in try/finally to ensure connection is released

**Verification:**
- [ ] No connection pool exhaustion after processing multiple emails
- [ ] Memory usage stays stable during email processing

**Dependencies:** None

---

## PHASE 6: MEDIUM — Frontend Quality Fixes (4-6 hours)

> **Priority:** P2 — Type safety, UI consistency, UX violations  
> **Risk:** MEDIUM — Large file changes can introduce regressions  
> **Prerequisite:** Phase 5 complete, run full test suite before starting

### 6A. Remove `@ts-nocheck` from Purchases page

**Finding:** `frontend/src/pages/Purchases/index.tsx` — 3,395 lines with ALL TypeScript checking disabled.

**File to edit:** `frontend/src/pages/Purchases/index.tsx`

**Implementation:**
- Remove `// @ts-nocheck` from line 1
- Run TypeScript compiler to identify ALL type errors
- Fix each error systematically (likely 50-100+ errors)
- Use `any` type sparingly as a temporary bridge, mark with `// TODO: fix type`
- Priority: Fix errors that indicate actual bugs, suppress cosmetic ones

**Verification:**
- [ ] `npx tsc --noEmit` passes for this file (or at least doesn't crash)
- [ ] Purchases page loads and functions correctly
- [ ] No runtime errors in browser console

**Dependencies:** None (but do this AFTER all other changes to avoid merge conflicts)

---

### 6B. Remove `@ts-nocheck` from Returns page

**Finding:** `frontend/src/pages/Returns/index.tsx` — 1,647 lines with ALL TypeScript checking disabled.

**Same approach as 6A.**

**Dependencies:** 6A (apply same patterns)

---

### 6C. Replace native `alert()` calls with toast/modal (77 instances)

**Finding:** 77 native `alert()` calls across 11 frontend files violate the AGENTS.md contract.

**Files to edit (by count):**
1. `pages/POS/index.tsx` — 15 instances
2. `pages/Purchases/index.tsx` — 12 instances
3. `pages/Database/index.tsx` — 12 instances
4. `pages/Reports/index.tsx` — 10 instances
5. `pages/CatalogUpload/index.tsx` — 10 instances
6. `pages/Returns/index.tsx` — 9 instances
7. `pages/PurchaseHistory/index.tsx` — 6 instances
8. `pages/CustomerReturn/index.tsx` — 1 instance
9. `components/AdminMatchPanel.tsx` — 1 instance (DELETE THIS FILE per 4F)

**Implementation:**
- Import `toastEvent` or use the project's existing toast system
- Replace `alert('message')` with `toastEvent.trigger({ type: 'info', message: 'message' })`
- Replace `if (confirm('message'))` with a custom confirmation modal
- Keep `console.warn`/`console.error` for developer-facing messages (not user-facing)

**Verification:**
- [ ] `grep -r "alert(" frontend/src/` returns zero matches (excluding console.alert)
- [ ] `grep -r "confirm(" frontend/src/` returns zero matches
- [ ] All replaced alerts show as toasts/modals
- [ ] No broken user flows

**Dependencies:** 4F (AdminMatchPanel deletion removes 1 instance)

---

### 6D. Replace hardcoded Tailwind colors with semantic variables (100+ instances)

**Finding:** 100+ hardcoded colors across 15+ files break light mode.

**Files to edit (priority order):**
1. `components/Layout.tsx` — ~40 violations
2. `components/MobileConnectionModal.tsx` — ~30 violations
3. `components/LiveCartAddModal.tsx` — ~15 violations
4. `components/AICamera.tsx` — ~10 violations
5. `pages/Expiry/index.tsx` — ~15 violations
6. `components/InfiniteTable.tsx` — 2 violations
7. `components/StagedQueueFloatingWidget.tsx` — 3 violations
8. `components/ConnectedDevicesFooterBar.tsx` — 8 violations
9. `components/BackupCenterModal.tsx` — 6 violations
10. `pages/CustomerReturnHistory/index.tsx` — 5 violations
11. `pages/Settings/index.tsx` — 5+ violations

**Mapping (AGENTS.md rules):**
| Hardcoded | Semantic |
|-----------|----------|
| `bg-black/50`, `bg-black/20`, `bg-black/10`, `bg-black/5` | `bg-bg/50`, `bg-bg/20`, etc. |
| `bg-[#18181b]`, `bg-[#18181b]/95` | `bg-bg2`, `bg-bg3` |
| `text-white` | `text-text` |
| `bg-white/5`, `bg-white/[0.02]` | `bg-glass-bg` |
| `hover:text-white` | `hover:text-text` |
| `hover:bg-white/10` | `hover:bg-bg3` |
| `border-white/10` | `border-glass-border` |

**Verification:**
- [ ] Toggle light/dark mode → no hardcoded colors visible
- [ ] All backgrounds, text, and borders respect the theme
- [ ] `grep -r "bg-black\|bg-\[#\|text-white\|bg-white/" frontend/src/components/` returns zero matches

**Dependencies:** None (but do after 6A/6B to avoid conflicts)

---

### 6E. Fix POS typo tolerance (OPEN-03)

**Finding:** POS medicine dropdown has no fuzzy match. Typing a slightly wrong name yields zero suggestions.

**File to edit:** `frontend/src/pages/POS/index.tsx` — `filterLocalInventory()` function

**Implementation:**
- Layer 1: Keep existing prefix match (fast, <30ms)
- Layer 2: Add substring match (already exists)
- Layer 3: If 0 results and search length >= 2, call `/api/medicines/suggest-medicine` API (already exists)
- Debounce the API call at 400ms
- Append API results to local results

**Verification:**
- [ ] Type "PAUSE 500" → dropdown shows suggestions (even if exact match doesn't exist)
- [ ] Type "PARACITAMOL" → dropdown shows "PARACETAMOL" variants
- [ ] Local results still appear instantly (<30ms)
- [ ] API results append asynchronously without blocking

**Dependencies:** None

---

### 6F. Fix POS medicine add delay (OPEN-04)

**Finding:** Clicking a medicine from dropdown has a noticeable pause before the row appears.

**File to edit:** `frontend/src/pages/POS/index.tsx` — `rebalanceCartMedicine()` function

**Implementation:**
- Add cart row immediately from the clicked item's cache data (optimistic add)
- Defer `rebalanceCartMedicine()` via `queueMicrotask()` or `requestAnimationFrame()`
- Show a subtle loading indicator on the row while rebalancing

**Verification:**
- [ ] Click a medicine → row appears instantly
- [ ] Rebalance completes in background
- [ ] No visual glitches during rebalance
- [ ] Stock numbers update correctly after rebalance

**Dependencies:** None

---

## PHASE 7: MEDIUM — Architecture & Code Quality (3-4 hours)

> **Priority:** P2 — Maintenance, developer experience  
> **Risk:** LOW — Structural improvements  
> **Prerequisite:** Phase 6 complete

### 7A. Wire up validation middleware

**Finding:** `src/middleware/validation.ts` exists but is never used.

**Files to edit:**
- `src/middleware/validation.ts` — Review and update validation rules
- `src/server.ts` — Import and apply to high-value routes
- Or individual route files — Import and use as route-level middleware

**Implementation:**
- Start with `POST /api/sales` and `POST /api/purchases` (highest value)
- Add Zod schemas for request body validation
- Return 400 with descriptive error messages

**Verification:**
- [ ] Send invalid data to `POST /api/sales` → returns 400 with error details
- [ ] Send valid data → returns 200/201
- [ ] No regression in existing functionality

**Dependencies:** None

---

### 7B. Fix feature ownership conflicts (RED drift)

**Finding:** Gmail credentials, WhatsApp enable, Telegram config have dual-editor conflicts between Settings and Learning pages.

**Files to review:**
- `frontend/src/pages/Settings/index.tsx` — Check what keys it reads/writes
- `frontend/src/pages/Learning/index.tsx` — Check what keys it reads/writes
- `src/routes/settings.ts` — Check save logic

**Implementation (per AGENTS.md contract):**
- Settings: ONLY store metadata (Name, Address, GSTIN, License, Tax Rate, Invoice Prefix, DataFetchControl)
- Learning: OWN Telegram config (`telegram_enabled`, `telegram_token`, `telegram_chat_id`)
- Gmail: Decide single owner (likely Learning since it's email-related)
- WhatsApp: Decide single owner (likely Learning since it's integration-related)
- Remove duplicate UI controls from the non-owner page

**Verification:**
- [ ] Telegram config only editable on Learning page
- [ ] Gmail config only editable on one page (decided owner)
- [ ] WhatsApp config only editable on one page (decided owner)
- [ ] Settings save doesn't overwrite integration keys it doesn't own

**Dependencies:** None

---

### 7C. Add error logging to silent catch blocks (critical paths only)

**Finding:** 100+ empty `catch (_){}` blocks. Focus on data-critical paths.

**Priority files to fix:**
- `src/routes/orders.ts:42-78` — 13 consecutive silent catches in table creation
- `src/routes/settings.ts:147` — Silent error on distributor settings read
- `src/routes/notifications.ts:309` — Silent error on notification read

**Implementation:**
- Add `console.error` or structured logging to catch blocks in critical paths
- Keep defensive catches for cleanup operations (unlink temp files, etc.)

**Verification:**
- [ ] If table creation fails, error is logged
- [ ] If settings read fails, error is logged
- [ ] No change in behavior for non-critical catches

**Dependencies:** None

---

## PHASE 8: LOW — Cleanup & Housekeeping (2-3 hours)

> **Priority:** P3 — Cosmetic, documentation, dead schema  
> **Risk:** VERY LOW — Pure cleanup  
> **Prerequisite:** All previous phases complete

### 8A. Remove dead schema: `pending_shortage_requests` table

**Finding:** Created in `src/database.ts:963` but never queried. AGENTS.md says use `special_orders`.

**File to edit:** `src/database.ts`

**Implementation:**
- Comment out or remove the `CREATE TABLE IF NOT EXISTS pending_shortage_requests` block
- Add a comment: "// REMOVED: Use special_orders table per AGENTS.md contract"

**Verification:**
- [ ] Server starts cleanly
- [ ] `special_orders` functionality unaffected
- [ ] No references to `pending_shortage_requests` in code

**Dependencies:** None

---

### 8B. Fix runtime-only schema columns

**Finding:** `suggested_composition` and `search_term_override` columns only added at runtime in `compositionEnricher.ts`.

**File to edit:** `src/database.ts`

**Implementation:**
- Add `ALTER TABLE medicines ADD COLUMN suggested_composition TEXT` to the schema
- Add `ALTER TABLE medicines ADD COLUMN search_term_override TEXT` to the schema
- Keep the runtime ALTER as a safety fallback

**Verification:**
- [ ] Fresh install has both columns from the start
- [ ] Enrichment page loads without errors on fresh install

**Dependencies:** None

---

### 8C. Fix broken scripts

**Finding:**
- `scripts/importCatalog.ts:11` — references non-existent `catalog/` directory
- `scripts/extract-styles.mjs:4` — references non-existent `src/ui/ui-demo.html`

**Files to edit:**
- `scripts/importCatalog.ts` — Update `CATALOG_DIR` to `catalogue/raw/`
- `scripts/extract-styles.mjs` — Either fix path or delete if unused

**Verification:**
- [ ] `scripts/importCatalog.ts` runs without ENOENT error
- [ ] `scripts/extract-styles.mjs` runs or is deleted

**Dependencies:** None

---

### 8D. Update documentation

**Finding:** `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` cites old report routes. `IMPLEMENTATION_PLAN.md` contradicts itself.

**Files to edit:**
- `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` — Update API paths to match current routes
- `IMPLEMENTATION_PLAN.md` — Fix contradictory status header/footer
- `SMALL_BUG_FIX_PLAN.md` — Update open items after fixes are complete

**Verification:**
- [ ] All documentation references match actual code
- [ ] No stale route paths in docs

**Dependencies:** All previous phases complete

---

### 8E. Clean up empty directories

**Finding:** `src/plugins/` and `src/transport/` are empty placeholder directories.

**Implementation:**
- Delete both directories
- Add a `.gitkeep` if they're needed for future development

**Verification:**
- [ ] No code references these directories
- [ ] TypeScript compiles cleanly

**Dependencies:** None

---

### 8F. Remove excessive console.log/warn/error

**Finding:** 100+ console statements across frontend files.

**Implementation:**
- Remove `console.log` calls (keep `console.error` for actual errors)
- Remove `console.warn` calls that are informational (keep actual warnings)
- Use a logger abstraction if available

**Verification:**
- [ ] Browser console is clean in production mode
- [ ] Actual errors still appear

**Dependencies:** None

---

## DEPENDENCY GRAPH

```
Phase 1 (Schema Fixes)
  └── 1A, 1B, 1C are independent
Phase 2 (Security)
  └── 2A, 2B are independent
Phase 3 (Workers)
  └── 3A → 3B (same pattern)
  └── 3C independent
Phase 4 (Dead Code)
  └── 4A-4H are all independent
Phase 5 (Notifications)
  └── 5A-5E are all independent
Phase 6 (Frontend Quality)
  └── 6A → 6B (same pattern)
  └── 6C depends on 4F (AdminMatchPanel deleted first)
  └── 6D, 6E, 6F are independent
Phase 7 (Architecture)
  └── 7A-7C are independent
Phase 8 (Cleanup)
  └── 8A-8F are all independent
  └── 8D depends on all previous phases
```

## VERIFICATION CHECKLIST (per phase)

After completing each phase, agent MUST:

1. [ ] Run `npx tsc --noEmit` (TypeScript check)
2. [ ] Run `npm run lint` (if linter configured)
3. [ ] Run `node scripts/quick-update.mjs` (knowledge graph update)
4. [ ] Start server and verify key endpoints respond
5. [ ] Check browser console for errors
6. [ ] Update `SMALL_BUG_FIX_PLAN.md` (move items from Open to Fixed)
7. [ ] Commit with descriptive message

## SUCCESS METRICS

After all phases complete:
- [ ] Zero `alert()` calls in frontend
- [ ] Zero `@ts-nocheck` directives
- [ ] Zero hardcoded Tailwind colors
- [ ] Zero orphan files (v1/sales, nNotificationService, etc.)
- [ ] All 39 findings resolved or documented as intentional
- [ ] `SMALL_BUG_FIX_PLAN.md` shows 0 open items
- [ ] Background workers enabled by default
- [ ] Credit notes API functional
- [ ] Compliance register functional
- [ ] Cash bill saves without phone (when WhatsApp off)
- [ ] Email notifications functional
- [ ] POS fuzzy search working
- [ ] POS add-to-cart instant
- [ ] TypeScript compiles with zero errors
- [ ] Light/dark mode works on all pages

---

> **END OF IMPLEMENTATION PLAN**
> Created: 2026-08-04
> Status: SAVED — DO NOT IMPLEMENT UNTIL RE-VERIFIED BY AGENT
> Agent must re-verify each finding before implementing any phase.
