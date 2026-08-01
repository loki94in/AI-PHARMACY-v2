# AI Pharmacy v2 — Complete Small Bug Fix Plan (PRD)

> **Document type:** Product / engineering fix plan (PRD)  
> **Location:** repository root  
> **Last updated:** 2026-08-01  
> **Status:** Planning only — **no fixes in this document have been applied unless marked ✅ Fixed**  
> **Audience:** Developers, AI agents, and maintainers implementing the next cleanup pass

---

## 1. Purpose

This document lists **all known small-to-medium bugs, UI mixups, dead code, and structural gaps** still open in AI Pharmacy v2 after recent merges to `main` (settings sync, active inventory, migration safety, Windows storage path).

For every item it records:

1. **What the user sees** (the issue)
2. **Root cause** (why it happens in code)
3. **How to fix** (concrete implementation direction)
4. **Priority** (P0–P3)
5. **Files to touch**

It also defines **what must NOT be changed** during this pass so we do not reintroduce regressions.

---

## 2. Already fixed on `main` (do not re-break)

These were real bugs that are **already resolved**. Do not undo them while fixing items below.

| Area | Fix | Commit / PR reference |
|------|-----|----------------------|
| Settings / delivery boy numbers vanishing in UI | Cross-page `settingsSync.ts`, `useSettingsQuery`, Pharmarack Cart load order | PR #4, `9236d72` |
| Sold stock still appearing in POS / reports | `inventory_master.is_active`, backfill on migration finalize | PR #3, `f7b3b48` |
| Windows data written under Program Files | `getAppDataDir()` → `%LOCALAPPDATA%\AI Pharmacy OS`, legacy one-time migration | `src/config/index.ts`, `installer.iss` |
| Migration data loss / blind import | Staging review gate, stock rebuild, cutover date, streaming CSV | PR #1 |
| POS slow add-to-cart | Optimistic add from compact cache | PR #3 |
| Shortage reminder reading wrong table | `shortageReminderService.ts` now uses `special_orders` | Verified in `src/services/shortageReminderService.ts` |
| Credit notes API missing | `app.use('/api/credit-notes', …)` mounted in `server.ts` | Verified mounted |
| Settings normal save wiping Pharmarack creds | Save payload preserves `pharmarack_*` from server when local state empty | `Settings/index.tsx:718-721` |
| Settings save wiping Gmail password | Save preserves `gmail_pass` from server when field left blank | `Settings/index.tsx:669` |

---

## 3. What NOT to touch (mandatory guardrails)

### 3.1 Product / business rules (user decisions)

| Rule | Reason |
|------|--------|
| **Do NOT deduplicate medicine names** | User explicitly accepts duplicate medicine names; dedup would break existing stock mapping |
| **Do NOT add simulated / mock Pharmarack cart UI** | Live data only per `AGENTS.md` |
| **Do NOT reintroduce delivery boy fields in Settings** | Delivery boys are owned by `/dispatch` → `delivery_boys` table only |
| **Do NOT read/write delivery boys from `app_settings` keys** | Legacy keys cause split-brain; use `GET/POST /api/dispatch/delivery-boys` |

### 3.2 Architecture contracts (do not weaken)

| Contract | Location |
|----------|----------|
| Page feature ownership | `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` |
| SPA module-level cache + silent background refresh | `AGENTS.md` — SPA Performance contract |
| `dataFetchControl` + idle gating | `AGENTS.md` — Data Fetch Control contract |
| WhatsApp templates must resolve delivery boy from `delivery_boys` table | `AGENTS.md` — WhatsApp Order Template contract |
| Semantic Tailwind colors only (`bg-bg`, `text-text`, etc.) | `frontend/AGENTS.md` |
| Run `node scripts/quick-update.mjs` after file changes | Root `AGENTS.md` |

### 3.3 Code areas to leave alone unless a bug item explicitly requires them

| Area | Why |
|------|-----|
| `inventory_master.is_active` logic and partial index | Recently shipped; reports/POS depend on it |
| `frontend/src/utils/settingsSync.ts` | Recently shipped cross-page sync |
| Migration staging worker streaming path | Do not revert to in-memory `results[]` loader |
| `src/routes/v1/sales.ts` | Dead code but inert; delete only in a dedicated cleanup PR, not mixed with UI fixes |
| POS optimistic add-to-cart flow | Performance-critical |
| Windows `LOCALAPPDATA` data path | Changing again would cause another “data disappeared” wave |
| `special_orders` as the single shortage-order table | Do not add parallel `pending_shortage_requests` writes |

### 3.4 Settings save behavior — partial payload rule

`POST /api/settings/save` upserts **every key in the JSON body**. When fixing Settings/Learning overlap:

- **Never** send empty strings for keys owned by another page unless intentionally clearing.
- Prefer **field-scoped save endpoints** or **merge-only patches** over full-object saves from multiple pages.

---

## 4. Bug fix catalog

Priority key: **P0** = data loss / money wrong · **P1** = daily workflow broken · **P2** = confusing UX · **P3** = cleanup / cosmetic

---

### P0-01 — Investigation purchase bill correction drops GST and discount

| | |
|---|---|
| **Issue** | User corrects a purchase bill on `/investigation`. After save, GST %, cash discount %, and tax-adjusted total are wrong or missing. Financial audit trail is incorrect. |
| **Cause** | Frontend `handleStartPurchaseBillEdit` (`Investigation/index.tsx:422-445`) maps items without `cgst_per`, `sgst_per`, `cd_per`, `cd_rs`. `calculateRecalculatedTotal` purchase branch (`:454-456`) sums `qty × cost_price` only. Backend save (`src/routes/investigation.ts:1074-1088`) reinserts `purchase_items` without tax/discount columns and sets `purchases.total_amount` to the tax-free sum. |
| **Fix** | 1) Include tax/discount fields when loading purchase items for edit. 2) Show GST/discount lines in purchase edit UI (mirror sales edit UI). 3) Recompute total with same formula as original purchase entry. 4) Persist `cgst_per`, `sgst_per`, `cd_per`, `cd_rs` (and any `purchase_items` tax columns) on save. 5) Add test: correct qty only → tax breakdown unchanged. |
| **Files** | `frontend/src/pages/Investigation/index.tsx`, `src/routes/investigation.ts`, optional `tests/investigationPurchaseCorrection.test.ts` |
| **Do not touch** | Sales bill correction path (already has 5% tax line); stock ledger reconciliation order |

---

### P0-02 — Settings vs Learning duplicate config editors (last save wins)

| | |
|---|---|
| **Issue** | User configures WhatsApp, Telegram, Gmail, or Pharmarack in Learning, then saves Settings (or vice versa). Config appears lost or reverted. |
| **Cause** | Both pages load all keys from `GET /api/settings` and save overlapping subsets via `POST /api/settings/save`, which blindly upserts every key in the payload (`src/routes/settings.ts:71-93`). No per-page field ownership enforcement. |
| **Fix** | **Option A (recommended):** Remove messaging/integration editors from Settings; keep only store metadata (name, address, GSTIN, tax rate, invoice prefix, data fetch control). **Option B:** Split save into scoped endpoints (`/settings/store`, `/settings/integrations`). **Option C:** Backend ignores keys not present in an allowlist per `source` header. Update `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md`. |
| **Files** | `frontend/src/pages/Settings/index.tsx`, `frontend/src/pages/Learning/index.tsx`, `src/routes/settings.ts`, docs |
| **Do not touch** | `settingsSync.ts` broadcast events; delivery_boys table ownership |

---

### P1-01 — Packaged app does not auto-open browser

| | |
|---|---|
| **Issue** | User double-clicks installed `PharmacyOS.exe`. Server starts but no browser window opens. User thinks app is broken. |
| **Cause** | `src/server.ts:336` checks `(process as any).pkg \|\| AUTO_OPEN_BROWSER`. Project now uses Node SEA, not `pkg`; `process.pkg` is never set. `AUTO_OPEN_BROWSER` is not set in installer or `.env.example`. |
| **Fix** | Replace `process.pkg` check with `isPackagedApp()` from `src/config/index.ts`. Set `AUTO_OPEN_BROWSER=true` in `.env.example` and installer seed `.env` (`onlyifdoesntexist`). Optionally open browser from installer post-install `[Run]` entry. |
| **Files** | `src/server.ts`, `.env.example`, `installer.iss` |
| **Do not touch** | `getAppDataDir()` LOCALAPPDATA path |

---

### P1-02 — Learning page shows hardcoded fake statistics

| | |
|---|---|
| **Issue** | “Intelligent Suggestions” card always shows “842 Active OCR Corrections”, “157 Learned Rx Combos”, fixed retrain time — never changes. |
| **Cause** | Literal JSX strings in `Learning/index.tsx` (~`:1012-1020`), not bound to API counts. |
| **Fix** | Add `GET /api/learning/stats` (or extend existing learning routes) returning live counts from `ocr_corrections`, `medicine_aliases`, last training timestamp. Bind UI to query; show skeleton while loading. |
| **Files** | `frontend/src/pages/Learning/index.tsx`, `src/routes/learning.ts` (or new stats route) |
| **Do not touch** | OCR correction save logic; alias learning tables |

---

### P1-03 — Learning WhatsApp/Telegram “ACTIVE” badge before real connection

| | |
|---|---|
| **Issue** | Toggling “Enable WhatsApp” or Telegram shows green ACTIVE / BOT LISTENING before QR scan or token validation. |
| **Cause** | Badge derived from `*_enabled` boolean only, not `waStatus.isReady` / bot connection state. Gmail panel in same file already does this correctly. |
| **Fix** | Branch badge on real connection state (`waStatus.isReady`, `waStatus.qrUrl`, Telegram bot ping). Show “Connecting…” / “Scan QR” when enabled but not ready. |
| **Files** | `frontend/src/pages/Learning/index.tsx` |
| **Do not touch** | `whatsappClient.js` init flow; Pharmarack session scheduler |

---

### P1-04 — Special Orders silently capped at 100 rows

| | |
|---|---|
| **Issue** | Pharmacy with >100 shortage requests: older orders vanish from list, filters, and “Total Requests” count with no warning. |
| **Cause** | `Orders/index.tsx:50` — `data.slice(0, 100)` on client after full API response. Backend returns all rows (`src/routes/orders.ts`). |
| **Fix** | Remove client slice. Add server pagination (`?limit=&offset=` or cursor) + “Load more” / proper pager. Show total count from API. |
| **Files** | `frontend/src/pages/Orders/index.tsx`, `src/routes/orders.ts` |
| **Do not touch** | `special_orders` schema; CRM `SpecialOrdersSection` unless aligning pagination API |

---

### P1-05 — Purchases list also capped at 100 rows

| | |
|---|---|
| **Issue** | Purchase history on Purchases page may hide older invoices beyond 100. |
| **Cause** | `Purchases/index.tsx:388` — `api.getPurchases().then(res => res.slice(0, 100))`. |
| **Fix** | Same as P1-04: server pagination or infinite scroll; remove arbitrary slice. |
| **Files** | `frontend/src/pages/Purchases/index.tsx`, `src/routes/purchases.ts` |
| **Do not touch** | OCR upload and purchase save flows |

---

### P2-01 — Inventory export “Packs” column always blank

| | |
|---|---|
| **Issue** | On-screen stock quantity is correct; exported CSV/PDF has empty Packs column. |
| **Cause** | Export uses `{ key: 'quantity', label: 'Packs' }` but `InventoryItem` field is `stock_quantity` (`Inventory/index.tsx:119` vs `:572`). Export util reads `item[c.key]` directly. |
| **Fix** | Change export column key to `stock_quantity`, or add export mapper in `export.ts`. |
| **Files** | `frontend/src/pages/Inventory/index.tsx`, optionally `frontend/src/utils/export.ts` |
| **Do not touch** | `is_active` filtering in inventory queries |

---

### P2-02 — Purchase History search promises fields backend cannot match

| | |
|---|---|
| **Issue** | Placeholder says “Search by order ID, invoice number, or product name…” but search by product name or numeric purchase ID returns nothing. |
| **Cause** | Backend `purchases.ts:627` only matches `invoice_no` and distributor `name` — no join on `purchase_items` / product name, no `p.id` filter. |
| **Fix** | Either update placeholder to match reality, or extend SQL: `OR p.id = ?` for numeric search; `EXISTS (SELECT 1 FROM purchase_items pi JOIN medicines m … WHERE m.name LIKE ?)` for product name. |
| **Files** | `frontend/src/pages/PurchaseHistory/index.tsx`, `src/routes/purchases.ts` |
| **Do not touch** | Purchase entry OCR pipeline |

---

### P2-03 — Purchase History summary cards undercount after scroll

| | |
|---|---|
| **Issue** | Summary totals at top show smaller numbers than the scroll status bar below after loading more rows or clearing filters. |
| **Cause** | Cards computed from client-loaded `items` array only; scroll bar uses server `totalItems`. |
| **Fix** | Drive summary cards from server aggregates (`totalItems`, `sum(total_amount)` from API) not local batch. |
| **Files** | `frontend/src/pages/PurchaseHistory/index.tsx`, `src/routes/purchases.ts` |
| **Do not touch** | Infinite scroll cache keys unless necessary |

---

### P2-04 — Pharmarack Cart conflicting “missing phone” logic

| | |
|---|---|
| **Issue** | Same distributor appears fine in sticky cart filter but flagged in “Missing Contact Numbers” sidebar tab (or vice versa). |
| **Cause** | Sidebar (`:2539+`) checks `customDistributorPhones` + strict validation. Sticky filter (`:620-645`) checks `distributorMappings` with looser rules. Two different resolution functions. |
| **Fix** | Extract single `resolveDistributorPhone(dist)` helper used by sidebar, sticky tabs, and send flow. One source of truth: mappings → saved distributors → custom override. |
| **Files** | `frontend/src/pages/PharmarackCart/index.tsx` |
| **Do not touch** | `buildDistributorOrderMessage` delivery boy resolution; `settingsSync` events |

---

### P2-05 — Pharmarack Cart batch send countdown never runs

| | |
|---|---|
| **Issue** | Button tooltip promises “Next send in Ns…” but countdown never appears. |
| **Cause** | `batchCountdownSec` declared (`:537`) but only ever set to `null` (`:1431`). No interval decrements it. |
| **Fix** | Either implement countdown timer between batch sends (read delay from settings `whatsapp_delay_distributor`), or remove dead UI text/tooltip. |
| **Files** | `frontend/src/pages/PharmarackCart/index.tsx` |
| **Do not touch** | WhatsApp queue backend (`whatsappQueue.ts`) |

---

### P2-06 — Pharmarack Cart Quick Assist tab badge counts ignore filter

| | |
|---|---|
| **Issue** | “Req (N)” / “Refills (N)” badge counts full list while “Show Added” toggle hides matched rows — badge ≠ visible rows. |
| **Cause** | Badge uses unfiltered array length; list applies `Show Added` filter separately. |
| **Fix** | Compute badge from the same filtered list used for rendering, or label badge “Total” vs “Visible”. |
| **Files** | `frontend/src/pages/PharmarackCart/index.tsx` |
| **Do not touch** | Refill panel API |

---

### P2-07 — Migration column-mapping header shows “(5 rows)” for every file

| | |
|---|---|
| **Issue** | Upload screen always shows “(5 rows)” regardless of file size. |
| **Cause** | `ReviewModal.tsx:358` passes `totalRows={fileEntry.samples.length}` with comment “placeholder”; backend caps samples at 5 (`migration.ts`). |
| **Fix** | Pass real `importStats.totalRows` or staging summary row count from API; keep 5-row preview separate from total. |
| **Files** | `frontend/src/pages/Migration/components/ReviewModal.tsx`, `src/routes/migration.ts` (if exposing count) |
| **Do not touch** | Streaming import worker; staging commit gate |

---

### P2-08 — `/dispatch` route redirects to Learning tab (discoverability)

| | |
|---|---|
| **Issue** | Users and docs say “go to Dispatch”; URL `/dispatch` redirects to `/learning?tab=dispatch`. No sidebar link to standalone Dispatch. |
| **Cause** | `App.tsx:151` — `<Navigate to="/learning?tab=dispatch" />`. Dispatch component embedded in Learning (`Learning/index.tsx:1230`). |
| **Fix** | Mount `Dispatch` at `/dispatch` directly (restore route). Keep Learning tab as embed or link. Add sidebar nav item “Dispatch”. |
| **Files** | `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` |
| **Do not touch** | `delivery_boys` API; `settingsSync` |

---

### P3-01 — Returns Min/Max amount filter has no UI input

| | |
|---|---|
| **Issue** | No user-visible effect — filter state exists but cannot be set. |
| **Cause** | `minAmount` / `maxAmount` state wired to API and “Clear filters” (`Returns/index.tsx:374-375, :913`) but no `<input>` calls `setMinAmount` / `setMaxAmount`. |
| **Fix** | Add min/max amount inputs next to date filters, or remove dead state/API params. |
| **Files** | `frontend/src/pages/Returns/index.tsx`, `src/routes/returns.ts` (if removing) |
| **Do not touch** | Return stock reconciliation logic |

---

### P3-02 — Purchases “Edit Purchase” modal is unreachable

| | |
|---|---|
| **Issue** | Edit modal UI exists but never opens. |
| **Cause** | `editingPurchase` state (`Purchases/index.tsx:802`) — `setEditingPurchase(non-null)` never called in file. |
| **Fix** | Wire “Edit” action on purchase row to open modal, or delete modal + `PUT` handler if edit not wanted. |
| **Files** | `frontend/src/pages/Purchases/index.tsx` |
| **Do not touch** | Purchase OCR and inventory merge on new purchase save |

---

### P3-03 — Nine superseded page files still bundled and prefetched

| | |
|---|---|
| **Issue** | Larger download; confusion for developers about which page is authoritative. |
| **Cause** | `App.tsx` redirects old routes to tabs but `pageImports.ts` still imports dead pages; prefetch timer loads all chunks. |
| **Fix** | Remove dead page files OR stop prefetching them; update `pageImports.ts` and redirects only. |
| **Dead pages** | `Expiry`, `CustomerReturn`, `CustomerReturnHistory`, `Doctors`, `CatalogUpload`, `AutomationCenter`, `Refills`, `NonMappedDistributors` (Dispatch is live via Learning embed) |
| **Files** | `frontend/src/App.tsx`, `frontend/src/lib/pageImports.ts`, dead `frontend/src/pages/*/index.tsx` |
| **Do not touch** | Parent tab pages that absorbed these features |

---

### P3-04 — Stale `process.pkg` checks in DB guardian / process guardian

| | |
|---|---|
| **Issue** | No user-visible bug today (`NODE_ENV=production` satisfies guard). Future `.env` change could disable safety nets silently. |
| **Cause** | `connection.ts` and `processGuardian.ts` use `typeof process.pkg !== 'undefined'` — dead on Node SEA builds. |
| **Fix** | Replace with `isPackagedApp()` from `src/config/index.ts` (same pass as P1-01). |
| **Files** | `src/database/connection.ts`, `src/process/processGuardian.ts` |
| **Do not touch** | WAL self-healing logic |

---

### P3-05 — `notificationService.ts` stub returns “not implemented”

| | |
|---|---|
| **Issue** | Some notification channel calls no-op or return not implemented. |
| **Cause** | Explicit stub at `notificationService.ts:116` (and similar in `nNotificationService.ts`). |
| **Fix** | Document which channels are live vs planned; implement or remove from UI toggles. |
| **Files** | `src/services/notificationService.ts`, related frontend toggles |
| **Do not touch** | Working WhatsApp queue and email service paths |

---

### P3-06 — Email attachment processing TODO

| | |
|---|---|
| **Issue** | Some email attachments may not auto-process into purchases. |
| **Cause** | `emailService.ts:1713` — `// TODO: Implement actual attachment processing logic here` |
| **Fix** | Implement or document manual workflow; link from Mail page help text. |
| **Files** | `src/services/emailService.ts`, `frontend/src/pages/Mail/index.tsx` |
| **Do not touch** | Gmail OAuth flow in Learning |

---

### P3-07 — Reports accuracy with duplicate medicine IDs

| | |
|---|---|
| **Issue** | Non-moving / expired reports may still double-count or miss stock when same medicine name has multiple `medicine_id` rows. |
| **Cause** | Reports operate at medicine-name or medicine-id level inconsistently; user declined name deduplication. |
| **Fix** | Document limitation in Reports UI; optional report mode “group by medicine name”. **Do not auto-merge IDs.** |
| **Files** | `src/services/nonMovingReportService.ts`, `frontend/src/pages/Reports/index.tsx` |
| **Do not touch** | Medicine master data; dedup migrations |

---

### P3-08 — Learning delivery-boy form duplicated inside same page

| | |
|---|---|
| **Issue** | Two tabs on Learning both show delivery-boy inputs; editing one does not update the other until reload. |
| **Cause** | Dispatch tab embeds `<Dispatch />` but Operations tab may still have legacy fields (verify on fix). |
| **Fix** | Single delivery boy UI: Dispatch tab only. Remove duplicate Operations-tab fields if any remain. |
| **Files** | `frontend/src/pages/Learning/index.tsx` |
| **Do not touch** | `delivery_boys` table; Dispatch API |

---

## 5. Suggested implementation phases

### Phase 1 — Data integrity (P0) — ~1 PR
- P0-01 Investigation purchase GST/discount
- P0-02 Settings vs Learning config ownership (minimal: strip integrations from Settings save payload)

### Phase 2 — Installed app & daily workflow (P1) — ~1–2 PRs
- P1-01 Auto-open browser
- P1-04 / P1-05 Remove 100-row caps + pagination
- P1-02 / P1-03 Learning live stats and connection badges

### Phase 3 — UI mixups (P2) — ~1–2 PRs
- P2-01 Inventory export column
- P2-02 / P2-03 Purchase History search and totals
- P2-04 / P2-05 / P2-06 Pharmarack Cart consistency
- P2-07 Migration row count display
- P2-08 Dispatch route in sidebar

### Phase 4 — Cleanup (P3) — optional batch PR
- P3-01 through P3-08 dead code, stubs, docs

---

## 6. Testing checklist (per phase)

| Test | Pass criteria |
|------|---------------|
| Settings save | Pharmacy name visible on Pharmarack Cart within 1s; no false “missing number” |
| Dispatch save | Delivery boy appears in WhatsApp template without page reload |
| Investigation purchase edit | Save preserves GST % and CD %; total matches original formula |
| Orders >100 rows | All orders visible or paginated; total count correct |
| Installed exe launch | Browser opens to `http://localhost:5174` automatically |
| Inventory export | Packs column matches on-screen `stock_quantity` |
| Purchase History search | Product name search returns expected invoices |
| Migration upload | Header shows real row count, preview still 5 rows |
| Settings + Learning | Saving Settings does not clear WhatsApp/Gmail/Pharmarack from Learning |

---

## 7. Acceptance criteria (definition of done)

- [ ] All P0 items fixed and tested
- [ ] All P1 items fixed or explicitly deferred with user approval
- [ ] No regression on `settingsSync`, `is_active` inventory, or LOCALAPPDATA path
- [ ] `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` updated if page ownership changes
- [ ] `node scripts/quick-update.mjs` run after code changes
- [ ] No new hardcoded Tailwind raw colors in touched UI files

---

## 8. Related audit documents (reference)

| Document | Use |
|----------|-----|
| `docs/STORAGE_PATH_AND_UI_GAPS_AUDIT.md` | Detailed storage + UI gap analysis (some items fixed since write) |
| `docs/COMPLETE_APP_PAGE_AUDIT_DIRECTORY.md` | Page ownership — authoritative |
| `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` | Agent contract for feature paths |
| `AUDIT-STRUCTURE-DRIFT-REPORT.md` | Settings vs Learning drift |
| `AUDIT-CRASH-RISK-REPORT.md` | Separate crash/error scope — not covered here |

---

## 9. Changelog for this document

| Date | Change |
|------|--------|
| 2026-08-01 | Initial complete small bug fix plan created at repo root |

---

*End of plan. Implement fixes in separate PRs per phase; do not mix P0 data fixes with P3 dead-code deletion in the same PR.*
