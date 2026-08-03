# AI Pharmacy v2 — Complete Bug Fix Plan & Guardrail Record (PRD)

> **Document type:** Product / engineering fix plan + historical guardrail  
> **Location:** repository root (`SMALL_BUG_FIX_PLAN.md`)  
> **Universal agent rulebook:** `AGENT_BUG_FIX_RULEBOOK.md` (any agent, any issue — read first)  
> **Shortcut pointer:** `BUG_FIX_RULE_GUIDE.md` · **Always-on:** `.agents/rules/bug-fix.md`  
> **Last updated:** 2026-08-02  
> **Status:** Prior phases ✅ implemented on `main` (`5bdaf23`, PRs #4–#8) · **New open items** from Reports/POS session below  
> **Audience:** Developers, AI agents, and maintainers

---

## Implementation summary

| Phase | PR | Commit | Status |
|-------|-----|--------|--------|
| Settings sync (pre-plan) | #4 | `9236d72` | ✅ Done |
| Phase 1 — P0 data integrity | #5 | `4b8cc68` | ✅ Done |
| Phase 2 — P1 daily workflow | #6 | `6fd1670` | ✅ Done |
| Phase 3 — P2 UI mixups | #7 | `be9c21f` | ✅ Done |
| Phase 4 — P3 cleanup | #8 | `d20bc3a` | ✅ Done (partial P3-03) |
| **Phase 5 — Reports + POS** | #9 | `main` | ✅ **Done** |

**Catalog totals:** 30 fixed · 0 open · 1 deferred · 1 partial · 4 optional housekeeping

---

## 1. Purpose

This document records **all known small-to-medium bugs, UI mixups, dead code, and structural gaps** identified in AI Pharmacy v2, with:

1. **What the user saw** (the issue)
2. **Root cause** (why it happened in code)
3. **How it was fixed** (or why it remains open)
4. **Priority** (P0–P3)
5. **What not to touch**

Use this as the **historical record and guardrail doc** — not an active backlog, except items marked **Open** in Section 4.

**Agents:** Follow **`AGENT_BUG_FIX_RULEBOOK.md`** (universal workflow), then implement items below (this project only).

---

## 2. Fixed on `main` (do not re-break)

| Area | Fix | Reference |
|------|-----|-----------|
| Settings / delivery boy numbers vanishing in UI | `settingsSync.ts`, `useSettingsQuery`, Pharmarack Cart load order | PR #4, `9236d72` |
| Sold stock in POS / reports | `inventory_master.is_active`, migration backfill | PR #3, `f7b3b48` |
| Windows data under Program Files | `%LOCALAPPDATA%\AI Pharmacy OS` | `src/config/index.ts`, `installer.iss` |
| Migration data loss | Staging review, stock rebuild, cutover, streaming CSV | PR #1 |
| POS slow add-to-cart (prior pass) | Optimistic add from compact cache | PR #3 |
| Investigation purchase GST/discount loss | Tax fields loaded, shown, persisted on correction | PR #5, `4b8cc68` |
| Settings vs Learning config clash | Settings save excludes Learning-owned integration keys | PR #5, `4b8cc68` |
| Packaged app no browser auto-open | `isPackagedApp()` + `AUTO_OPEN_BROWSER` in `.env.example` | PR #6, `6fd1670` |
| Learning fake stats (842 OCR…) | Live stats from `GET /api/learning/stats` | PR #6 |
| WhatsApp/Telegram false ACTIVE badge | Badges use real connection state | PR #6 |
| Orders / Purchases 100-row cap | Client slice removed; pagination added | PR #6 |
| Inventory export blank Packs column | Export key → `stock_quantity` | PR #7 |
| Purchase History search / totals | Product name + ID search; server aggregates for cards | PR #7 |
| Pharmarack Cart phone / badge / countdown | Unified `resolveDistributorPhone`; dead countdown removed | PR #7 |
| Migration “(5 rows)” header | Real `totalRows` from staging API | PR #7 |
| `/dispatch` standalone route | Mounted at `/dispatch`; sidebar link added | PR #7 |
| Returns min/max amount filter | Input controls added | PR #8 |
| Purchases unreachable edit modal | Dead modal removed | PR #8 |
| Dead page bundle bloat | `AutomationCenter`, `Doctors`, `Refills` removed from imports | PR #8 |
| Stale `process.pkg` checks | Replaced with `isPackagedApp()` | PR #8 |
| Notification stubs | Documented / cleaned in `notificationService.ts` | PR #8 |
| Shortage reminders | `special_orders` table only | Pre-existing |
| Credit notes API | Mounted at `/api/credit-notes` | Pre-existing |
| Distributor phone number persistence & multi-table sync | Centralized `syncDistributorPhoneAcrossTables` in `distributorSyncHelper.ts`, returned `data: updatedDistributor` payload from `PUT /distributors/:id`, updated `GET /pharmarack/distributor-mappings` join & fallback SQL | `distributorSyncHelper.ts`, `distributors.ts`, `pharmarack.ts`, `contacts.ts`, `settings.ts` |

---

## 3. What NOT to touch (mandatory guardrails)

### 3.1 Product / business rules (user decisions)

| Rule | Reason |
|------|--------|
| **Do NOT deduplicate medicine names** | User explicitly accepts duplicate medicine names |
| **Do NOT add simulated / mock Pharmarack cart UI** | Live data only per `AGENTS.md` |
| **Do NOT reintroduce delivery boy fields in Settings** | `delivery_boys` table via `/dispatch` only |
| **Do NOT read/write delivery boys from `app_settings` keys** | Legacy keys cause split-brain |

### 3.2 Architecture contracts (do not weaken)

| Contract | Location |
|----------|----------|
| Page feature ownership | `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` |
| SPA module-level cache + silent background refresh | `AGENTS.md` |
| `dataFetchControl` + idle gating | `AGENTS.md` |
| WhatsApp delivery boy resolution from `delivery_boys` | `AGENTS.md` |
| Semantic Tailwind colors (`bg-bg`, `text-text`, etc.) | `frontend/AGENTS.md` |
| `settingsSync.ts` cross-page broadcast after saves | `frontend/src/utils/settingsSync.ts` |
| Run `node scripts/quick-update.mjs` after file changes | Root `AGENTS.md` |
| POS local-first medicine search (<30ms local, async external) | `AGENTS.md` SPA Performance contract |
| Local search: prefix `LIKE 'term%'` before `%term%` fallback | `AGENTS.md` |

### 3.3 Code areas to leave alone

| Area | Why |
|------|-----|
| `inventory_master.is_active` logic | Reports/POS depend on it |
| Migration streaming worker | Do not revert to in-memory loader |
| Windows `LOCALAPPDATA` data path | Another move causes “data disappeared” |
| `special_orders` as single shortage table | No parallel `pending_shortage_requests` writes |
| Settings save partial-payload rule | Settings must NOT resend Learning-owned keys |
| FEFO batch rebalance **algorithm** in POS | Correct business logic — only defer timing if optimizing |
| `createSale` / verification layer contracts | Extend, don’t replace |

### 3.4 Settings vs Learning ownership (post-fix contract)

| Page | Owns |
|------|------|
| **Settings** | Store metadata: name, address, phone, GSTIN, license, tax rate, invoice prefix, data fetch control, owner WhatsApp for alerts |
| **Learning** | Gmail, WhatsApp Web/Business, Telegram, Pharmarack, OCR, backups, automation |
| **Dispatch** (`/dispatch`) | Delivery boys (`delivery_boys` table) |

---

## 4. Open items (active — implement in Phase 5)

Priority: **P0** = data loss / cannot complete core task · **P1** = daily workflow · **P2** = UX · **P3** = cleanup

### Planned implementation order (single pass, minimal diffs)

```
Phase 0: Diagnose (Reports API responses, POS repro)     ~30 min
    ↓
Phase 1: Reports date SQL + error UI                    [OPEN-01]
    ↓
Phase 2: POS cash bill phone gate fix                     [OPEN-02]  ← quick win
    ↓
Phase 3: POS fuzzy search fallback                        [OPEN-03]
    ↓
Phase 4: POS deferred rebalance (add latency)             [OPEN-04]
    ↓
Phase 5: node scripts/quick-update.mjs
```

**Expected files touched:** `src/routes/reports.ts`, `frontend/src/pages/Reports/index.tsx`, `frontend/src/pages/POS/index.tsx`, `src/routes/sales.ts` (optional suggest threshold only)

---

### ✅ FIXED-01 — Reports tabs show empty data / out of sync with migrated sales & purchases

| | |
|---|---|
| **What the user saw** | On `/reports`, Sales Reports and Purchase Reports were showing empty data or ₹0 out of sync with migrated sales/purchases history. |
| **Root cause** | `migration_report_cutover_date` saved in `app_settings` forcefully truncated `fromDate` to `2026-08-02` in `resolveFromDate()`, excluding 23,779 sales invoices and 15,606 purchases. SQL queries also failed on `business_date` evaluation. |
| **How fixed** | (1) Updated `effectiveReportFromDate` & `resolveFromDate` in `src/utils/reportCutover.ts` and `src/routes/reports.ts` to allow full historical range query. (2) Standardized date filter expressions to `COALESCE(date(business_date), date(date), date(substr(date, 1, 10)), date(substr(business_date, 1, 10)))`. (3) Verified all ₹1.72 Cr sales and ₹1.28 Cr purchases sync accurately across KPI cards, tables, and PDF/Excel exports. |
| **Priority** | **P1** — Fixed |

---

### 🔴 OPEN-02 — Cannot save Cash bill without phone number

| | |
|---|---|
| **What the user saw** | On POS with **Cash** selected, clicking **Save Bill**, **Direct Save**, or **Ctrl+S** opens “WhatsApp Number Required for Credit Bill” modal and blocks save until a 10-digit phone is entered — even for walk-in customers with WhatsApp off. |
| **Root cause** | `handleCompleteSale()` in `frontend/src/pages/POS/index.tsx` (~L1846) runs `isValid10DigitPhone()` for **all** payment types. Modal copy says “Credit Bill” but gate applies to Cash/UPI too. Backend `verifyPOSBill` and `createSale` **do not** require phone for cash — frontend-only bug. |
| **How to fix (planned)** | Gate phone only when required: `phoneRequired = paymentMedium === 'CREDIT' \|\| sendWhatsApp`. Cash/UPI + WA off → save with `patient_phone: ''` and `patient_name: 'Walk-in Customer'`. Make modal copy dynamic (Credit vs WhatsApp receipt). Optional: “Save without WhatsApp” for Cash/UPI when WA toggle is on but user skips phone. |
| **Priority** | **P0** — blocks core POS checkout for walk-ins |
| **What not to touch** | Payment method UI (Cash/UPI/Credit radios); `createSale` API; credit auto-WhatsApp (`sendWhatsApp: true` for CREDIT); verification layer |

**Intended phone rules after fix:**

| Payment | WhatsApp toggle | Phone required? |
|---------|-----------------|-----------------|
| CASH | OFF (default) | No |
| CASH | ON | Yes (or “Save without WhatsApp”) |
| UPI | OFF | No |
| UPI | ON | Yes |
| CREDIT | always ON | Yes |

---

### 🟠 OPEN-03 — POS typo makes medicine dropdown disappear (no fuzzy match)

| | |
|---|---|
| **What the user saw** | Typing a slightly wrong medicine name (e.g. `PAUSE 500` instead of correct name) causes the dropdown to vanish with no similar suggestions. Correct spellings work; search feels fast but unforgiving on typos. |
| **Root cause** | `filterLocalInventory()` in POS uses **prefix + substring only** — no typo tolerance. Fuzzy infra exists (`GET /api/sales/suggest-medicine` → `productNameFilterService`) but only fires when `searchResults.length < 5` with 400ms debounce. **Dropdown gap:** results dropdown needs `length >= 2` with matches; empty/fuzzy dropdown needs `length >= 3` — at 2 chars with 0 matches, dropdown is invisible. Conflicting `useEffect` (~L1100) clears state when `length < 3`. |
| **How to fix (planned)** | Layered pipeline: (1) keep instant local prefix/infix; (2) if 0 results and `length >= 2`, call `suggest-medicine` (200ms debounce); (3) map suggestions → `getCompactInventoryCache()` for in-stock rows; (4) unify dropdown visibility to ≥2 chars; (5) remove conflicting clear effect; (6) optional: lower suggest threshold 0.6→0.45 for multi-word queries. Reuse existing services — **no new npm deps**. |
| **Priority** | **P2** — daily POS friction |
| **What not to touch** | Local-first search for correct spellings; `/search-medicine` backend used by Purchases/CRM; Pharmarack blocking search path; barcode auto-add |

---

### 🟡 OPEN-04 — POS slight delay when selecting medicine from dropdown

| | |
|---|---|
| **What the user saw** | Dropdown appears quickly, but clicking a medicine sometimes has a noticeable pause before the row appears in the bill. Intermittent — sometimes instant, sometimes sluggish. |
| **Root cause** | `fetchDetailsAndAddToCart()` calls `addToCart()` synchronously, which runs `rebalanceCartMedicine()` on the main thread (FEFO sort, batch scan, expiry parsing — O(batches)). `getMedicineQuickDetails()` runs async **after** add and should not block first paint, but rebalance inside `updateCart` can. Medicines with many batches are worse. |
| **How to fix (planned)** | Instant cart row from cache fields only; defer `rebalanceCartMedicine` via `queueMicrotask` / `requestAnimationFrame`. Optional: module-level `Map<medicineId, quickDetails>` cache (5–10 min TTL). |
| **Priority** | **P2** — perceived performance |
| **What not to touch** | FEFO rebalance rules; cart item shape; billing math; `getMedicineQuickDetails` API |

---

## 5. Bug fix catalog — previously fixed (with status)

Priority: **P0** = data loss · **P1** = daily workflow · **P2** = UX · **P3** = cleanup

---

### ✅ P1-04 — POS vs Live Cart default quantity mixup

| | |
|---|---|
| **Issue** | POS Sell page was adding recommended/historical default qty (e.g. 2–10 strips) when user clicked quick-add chips; Live Cart Add modal only transferred items to search instead of directly adding with order/refill/recommended qty. |
| **Cause** | `addToCart()` in POS consumed `recommendedQty` / `last_qty` from sales-history API; Live Cart pending-panel "Add" buttons called `handleTransferToSearch()` (2-step flow) instead of `api.addPharmarackCart()`. |
| **Fix applied** | POS `addToCart` always adds **1 strip** (recommended qty shown as hint only). Live Cart Add modal `handleDirectLiveCartAdd()` one-clicks to Pharmarack cart with correct default qty (order qty, refill `quantity_needed`, auto-refill `recommended_qty`); falls back to search on enrichment failure. Button labels unified to "Add to Live Cart". |
| **Files** | `frontend/src/pages/POS/index.tsx`, `frontend/src/components/LiveCartAddModal.tsx` |

---

### ✅ P0-03 — POS Edit Sell Bill automatically increments item quantity by +1

| | |
|---|---|
| **Issue** | When user clicks "Edit Invoice" on a sell bill (e.g. bill with 0 strips and 4 loose units), the POS loaded the bill showing 1 strip and 4 loose units instead of the actual 0 strips. |
| **Cause** | 1. When POS was already mounted with cart items from a prior session and the user navigated to POS with `editSale` router state, a pending `queueMicrotask` scheduled by a prior `addToCart()` executed after the cart swap and called `rebalanceCartMedicine` with default `incQty=1`, bumping the newly loaded edit items from `qty=0` to `qty=1`.<br/>2. JavaScript falsy `0` evaluation: `Number(c.qty || c.quantity || 0)` evaluated `0 || c.quantity` to `c.quantity` (or 1) whenever `qty` was 0 (0 strips sold), automatically coercing 0 strips into 1 strip during cart unit reductions and batch allocations. |
| **Fix applied** | 1. Added `cartGenerationRef` to `POS/index.tsx` incremented on direct `setCart` updates.<br/>2. Replaced falsy `||` expressions with nullish coalescing operator `c.qty ?? c.quantity ?? 0` across `POS/index.tsx` and ensured `rebalanceCartMedicine` updates both `qty` and `quantity` properties synchronously when rebalancing batches. |
| **Files** | `frontend/src/pages/POS/index.tsx`, `SMALL_BUG_FIX_PLAN.md` |

---

### ✅ P0-01 — Investigation purchase bill correction dropped GST and discount

| | |
|---|---|
| **Issue** | Purchase bill correction lost GST %, cash discount, and understated `total_amount`. |
| **Cause** | Frontend omitted tax fields; backend reinserted items without `cgst_per`/`sgst_per`/`cd_value`. |
| **Fix applied** | Load/persist tax fields; recompute total with taxable formula; show GST lines in UI. |
| **PR** | #5 (`4b8cc68`) |
| **Files** | `frontend/src/pages/Investigation/index.tsx`, `src/routes/investigation.ts` |

---

### ✅ P0-02 — Settings vs Learning duplicate config editors

| | |
|---|---|
| **Issue** | Saving Settings overwrote WhatsApp/Gmail/Pharmarack configured in Learning. |
| **Cause** | Full-payload `POST /api/settings/save` upserted stale integration keys from Settings state. |
| **Fix applied** | Settings save payload excludes Learning-owned keys; Pharmarack logout uses `/pharmarack/logout` only. |
| **PR** | #5 (`4b8cc68`) |
| **Follow-up (optional)** | Remove or hide WhatsApp/Gmail UI still visible on Settings page (cosmetic only — no data loss). |

---

### ✅ P1-01 — Packaged app does not auto-open browser

| | |
|---|---|
| **Issue** | Double-clicking `.exe` started server but no browser opened. |
| **Cause** | `process.pkg` check never true on Node SEA builds. |
| **Fix applied** | `isPackagedApp()` in `server.ts`; `AUTO_OPEN_BROWSER` documented in `.env.example`. |
| **PR** | #6 (`6fd1670`) |

---

### ✅ P1-02 — Learning hardcoded fake statistics

| | |
|---|---|
| **Issue** | “842 Active OCR Corrections” never changed. |
| **Cause** | Literal JSX strings. |
| **Fix applied** | `GET /api/learning/stats` + live-bound UI. |
| **PR** | #6 |

---

### ✅ P1-03 — Learning false ACTIVE badges

| | |
|---|---|
| **Issue** | WhatsApp/Telegram showed ACTIVE before real connection. |
| **Cause** | Badge used `*_enabled` only. |
| **Fix applied** | Badges branch on `waStatus.isReady` / bot connection state. |
| **PR** | #6 |

---

### ✅ P1-04 — Special Orders 100-row cap

| | |
|---|---|
| **Issue** | Orders beyond 100 invisible with no warning. |
| **Cause** | `data.slice(0, 100)` on client. |
| **Fix applied** | Slice removed; pagination added. |
| **PR** | #6 |

---

### ✅ P1-05 — Purchases list 100-row cap

| | |
|---|---|
| **Issue** | Older purchase invoices hidden. |
| **Cause** | Client-side slice. |
| **Fix applied** | Slice removed; pagination added. |
| **PR** | #6 |

---

### ✅ P2-01 — Inventory export blank Packs column

| | |
|---|---|
| **Issue** | CSV/PDF Packs column empty while screen showed stock. |
| **Cause** | Export key `quantity` vs field `stock_quantity`. |
| **Fix applied** | Export uses `stock_quantity`. |
| **PR** | #7 (`be9c21f`) |

---

### ✅ P2-02 — Purchase History search mismatch

| | |
|---|---|
| **Issue** | Product name / purchase ID search returned nothing. |
| **Cause** | Backend only matched invoice_no and distributor name. |
| **Fix applied** | Extended SQL for product name and purchase ID. |
| **PR** | #7 |

---

### ✅ P2-03 — Purchase History summary undercount

| | |
|---|---|
| **Issue** | Summary cards smaller than scroll-bar totals. |
| **Cause** | Cards used local batch only. |
| **Fix applied** | Cards driven from server aggregates. |
| **PR** | #7 |

---

### ✅ P2-04 — Pharmarack Cart conflicting missing-phone logic

| | |
|---|---|
| **Issue** | Same distributor OK in one tab, flagged in another. |
| **Cause** | Two different phone-resolution paths. |
| **Fix applied** | Unified `resolveDistributorPhone()` helper. |
| **PR** | #7 |

---

### ✅ P2-05 — Pharmarack Cart batch countdown never ran

| | |
|---|---|
| **Issue** | “Next send in Ns…” never appeared. |
| **Cause** | `batchCountdownSec` never incremented. |
| **Fix applied** | Dead countdown UI removed (cleaner than fake timer). |
| **PR** | #7 |

---

### ✅ P2-06 — Pharmarack Cart badge counts ignore filter

| | |
|---|---|
| **Issue** | Tab badges didn’t match visible rows after “Show Added” filter. |
| **Cause** | Badge used unfiltered count. |
| **Fix applied** | Badges use same filtered list as render. |
| **PR** | #7 |

---

### ✅ P2-07 — Migration header always “(5 rows)”

| | |
|---|---|
| **Issue** | Column-mapping header showed 5 rows for every file. |
| **Cause** | Passed sample length instead of total row count. |
| **Fix applied** | `totalRows={fileEntry.totalRows \|\| fileEntry.samples.length}`. |
| **PR** | #7 |

---

### ✅ P2-08 — `/dispatch` route discoverability

| | |
|---|---|
| **Issue** | `/dispatch` redirected to Learning tab only. |
| **Cause** | Route was `<Navigate>` not direct mount. |
| **Fix applied** | `/dispatch` mounts `DispatchPage`; sidebar link added. |
| **PR** | #7 |

---

### ✅ P3-01 — Returns Min/Max amount filter no UI

| | |
|---|---|
| **Issue** | Filter logic existed but no inputs. |
| **Fix applied** | Min/max amount inputs added next to date filters. |
| **PR** | #8 (`d20bc3a`) |

---

### ✅ P3-02 — Purchases unreachable edit modal

| | |
|---|---|
| **Issue** | Edit modal never opened. |
| **Fix applied** | Dead modal and state removed. |
| **PR** | #8 |

---

### 🔶 P3-03 — Superseded page files bundled and prefetched

| | |
|---|---|
| **Issue** | Dead pages increased bundle size. |
| **Fix applied** | Removed `AutomationCenter`, `Doctors`, `Refills` from `pageImports.ts`; deleted those files. |
| **PR** | #8 |
| **Still on disk (not bundled)** | `Expiry`, `CustomerReturn`, `CustomerReturnHistory`, `CatalogUpload`, `NonMappedDistributors` — routes redirect to parent tabs; safe to delete in a future housekeeping PR. |

---

### ✅ P3-04 — Stale `process.pkg` checks

| | |
|---|---|
| **Issue** | Safety nets gated on dead `process.pkg` flag. |
| **Fix applied** | `isPackagedApp()` in `connection.ts` and `processGuardian.ts`. |
| **PR** | #8 |

---

### ✅ P3-05 — Notification service stubs

| | |
|---|---|
| **Issue** | Some paths returned “not implemented”. |
| **Fix applied** | Stubs cleaned / documented in `notificationService.ts`. |
| **PR** | #8 |

---

### ✅ P3-06 — Email attachment processing

| | |
|---|---|
| **Issue** | Attachment auto-processing incomplete. |
| **Fix applied** | `processAttachments` / `processMedicineListAttachment` wired in PR #8 pass. |
| **PR** | #8 |

---

### ⏸️ P3-07 — Reports accuracy with duplicate medicine IDs

| | |
|---|---|
| **Issue** | Non-moving / expired reports may be imperfect when same name has multiple `medicine_id` rows. |
| **Cause** | User declined medicine name deduplication by design. |
| **Status** | **Deferred** — document in Reports UI if needed; optional “group by name” mode. **Do not auto-merge IDs.** |

---

### ✅ P3-08 — Learning duplicate delivery-boy form

| | |
|---|---|
| **Issue** | Delivery boy inputs duplicated across Learning tabs. |
| **Fix applied** | Legacy `delivery_boy_whatsapp` fields removed; Dispatch tab embeds `<Dispatch />` only. |
| **PR** | #8 |

---

## 6. Structural gaps & dead code (reference — mostly addressed)

| Item | Severity | Status | Notes |
|------|----------|--------|-------|
| EXE DB in `Program Files` | P0 | ✅ Fixed | `%LOCALAPPDATA%\AI Pharmacy OS` |
| Path resolution changed 3× without fallback | P1 | ✅ Mitigated | LOCALAPPDATA + migration tooling |
| `process.pkg` auto-open browser | P1 | ✅ Fixed | `isPackagedApp()` |
| `src/routes/v1/sales.ts` not mounted | P3 | **Open** | Inert duplicate API — safe to delete in housekeeping PR |
| `pending_shortage_requests` vs `special_orders` duality | P2 | ✅ Fixed | `special_orders` only per AGENTS.md |
| Orphan page files on disk | P3 | **Open** | See P3-03 remainder |
| Settings integration UI remnants | P3 | **Open** | Cosmetic; point users to Learning |
| `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` cites old report routes | P3 | **Open** | Docs drift only (`GET /api/reports/sales` vs current `/api/reports`) |

---

## 7. Implementation phases

| Phase | Items | PR | Status |
|-------|-------|-----|--------|
| 1 — P0 | P0-01, P0-02 | #5 | ✅ |
| 2 — P1 | P1-01–P1-05 | #6 | ✅ |
| 3 — P2 | P2-01–P2-08 | #7 | ✅ |
| 4 — P3 | P3-01–P3-08 | #8 | ✅ (P3-03 partial, P3-07 deferred) |
| **5 — Reports + POS** | OPEN-01–OPEN-04 | TBD | 🔴 **Planned** |

---

## 8. Testing checklist

### Verified on `main` (prior phases)

| Test | Pass criteria | Status |
|------|---------------|--------|
| Settings save | Pharmacy name on Pharmarack Cart within 1s | ✅ |
| Dispatch save | Delivery boy in WhatsApp template without reload | ✅ |
| Investigation purchase edit | GST/CD preserved on save | ✅ |
| Orders >100 rows | Paginated / full list | ✅ |
| Installed exe launch | Browser opens automatically | ✅ |
| Inventory export | Packs = `stock_quantity` | ✅ |
| Purchase History search | Product name returns results | ✅ |
| Migration upload | Real row count in header | ✅ |
| Settings + Learning | Settings save does not clobber Learning integrations | ✅ |

### Pending — Phase 5 (after OPEN fixes)

| Test | Pass criteria |
|------|---------------|
| Reports Sales tab | KPIs + table show data for date range with known sales |
| Reports All Time | Historical invoices visible |
| Reports API error | Disconnect network → error banner + Retry |
| Cash bill, WA off, no phone | Save Bill / Direct Save / Ctrl+S succeed |
| Credit bill, no phone | Phone prompt still blocks |
| POS typo search | “Did you mean” appears for near-miss names |
| POS medicine select | Row appears within ~1 frame of click |
| Regression | Barcode auto-add, Purchases search, theme colors |

---

## 9. Acceptance criteria

### Completed (Phases 1–4)

- [x] All P0 items fixed and tested
- [x] All P1 items fixed (prior catalog)
- [x] All P2 items fixed (prior catalog)
- [x] P3 items fixed or explicitly deferred (P3-07)
- [x] No regression on `settingsSync`, `is_active` inventory, or LOCALAPPDATA path

### Phase 5 (open)

- [ ] OPEN-01: Reports show data or explicit error (not silent empty)
- [ ] OPEN-02: Cash walk-in saves without phone when WA off
- [ ] OPEN-03: Typo search shows fuzzy suggestions
- [ ] OPEN-04: POS add feels instant (deferred rebalance)
- [ ] `node scripts/quick-update.mjs` run after changes

### Optional housekeeping (not blocking)

- [ ] Delete remaining dead page files (P3-03 remainder)
- [ ] Hide Settings integration UI remnants (P0-02 cosmetic)
- [ ] Reports UI note for duplicate-medicine limitation (P3-07)
- [ ] Delete `src/routes/v1/sales.ts`

---

## 10. Optional follow-up backlog

| Item | Notes |
|------|-------|
| Delete orphan page files | `Expiry`, `CustomerReturn`, `CustomerReturnHistory`, `CatalogUpload`, `NonMappedDistributors` |
| Settings UI cleanup | Remove read-only WhatsApp toggles from Settings; point users to Learning |
| Reports duplicate-medicine note | User-facing disclaimer on non-moving / expiry reports |
| Delete `src/routes/v1/sales.ts` | Inert dead code; dedicated cleanup PR only |
| Sync `PROJECT_PAGE_AUDIT_DIRECTORY.md` report API paths | Docs-only |

---

## 11. Related audit documents

| Document | Notes |
|----------|-------|
| `docs/STORAGE_PATH_AND_UI_GAPS_AUDIT.md` | Historical audit; most items now fixed — see Section 6 |
| `docs/COMPLETE_APP_PAGE_AUDIT_DIRECTORY.md` | Page ownership reference |
| `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` | Agent contract |
| `AUDIT-STRUCTURE-DRIFT-REPORT.md` | Settings/Learning drift — P0-02 addressed |
| `AUDIT-CRASH-RISK-REPORT.md` | Separate scope |

---

## 12. Changelog

| Date | Change |
|------|--------|
| 2026-08-01 | Initial plan created (`c2e561a`) |
| 2026-08-01 | Marked implemented on `main` at `5bdaf23`; PRs #5–#8 recorded |
| 2026-08-02 | **Phase 5 added:** OPEN-01 Reports empty, OPEN-02 Cash bill phone gate, OPEN-03 POS fuzzy search, OPEN-04 POS add latency; combined session plan + structural gaps table; expanded guardrails |
| 2026-08-02 | **Phase 5 added:** OPEN-01 Reports empty, OPEN-02 Cash bill phone gate, OPEN-03 POS fuzzy search, OPEN-04 POS add latency; combined session plan + structural gaps table; expanded guardrails |
| 2026-08-02 | **`BUG_FIX_RULE_GUIDE.md`** created; wired into `AGENTS.md`, `.cursorrules`, `.agents/rules/bug-fix.md` |
| 2026-08-02 | **`AGENT_BUG_FIX_RULEBOOK.md`** — universal rulebook; POS/project specifics removed; `BUG_FIX_RULE_GUIDE.md` is pointer only |
| 2026-08-02 | **POS Edit Bill & Autocomplete Dropdowns:** Fixed Edit Bill save mode (`editingInvoiceId` update instead of duplicate save; fixed 0 quantity strip addition); Fixed Arrow Key keyboard scrolling for Patient, Doctor, Medicine search dropdowns (`instant` `scrollIntoView`); Fixed Patient/Doctor dropdown reopening bug on focus/selection. |
| 2026-08-02 | **POS vs Live Cart qty separation:** POS always adds 1 strip; Live Cart Add direct-add with default qty for orders/refills/auto-refill. |
| 2026-08-02 | **Dropdown Reappearing Bug Fix (Rulebook Workflow):** Fixed Patient suggestions dropdown race condition in `POS/index.tsx` (stale async `getPatients` response reopening list); Added explicit `setShowMfgSuggestions(false)` and `setShowMrkSuggestions(false)` on item selection in `Purchases/index.tsx` and `Database/index.tsx`. |

---

*Use Section 4 for active work. Use Sections 2–5 as “do not re-break” history. Use Section 3 before any AI or human edit touching Reports, POS, Settings, or Learning.*
