# Fix Investigation ↔ Sells sync + app-wide cache invalidation gaps

## Context

**What the Investigation page is:** an audit/forensics console over the whole stock ledger. Its backend (`src/routes/investigation.ts`, `GET /api/investigation/timeline`) merges POS sales, purchases, customer/supplier returns, and manual adjustments into one timeline, computes running opening/closing stock per batch and per medicine, and lets you directly correct inventory, sales bills, and purchase bills with audit logging. It exists to answer "why is this stock number wrong and which transaction caused it."

**Why it doesn't match the Sells page (root cause found):**
`usePersistedDateRange` ([usePersistedDateRange.ts:34-46](frontend/src/hooks/usePersistedDateRange.ts#L34-L46)) restores the saved `from`/`to` dates verbatim from localStorage. Investigation defaults to "last 15 days → today" and persists that under `investigation-date-range` — so the `to` date **freezes at whatever day you last set it**. Every sale made after that date is silently filtered out on Investigation, while Sells defaults to All Dates and shows everything. Same latent bug on Purchase History.

**Similar data-sharing/cache errors found elsewhere (the user asked to check):**
1. **Supplier returns never invalidate the server inventory cache.** `src/routes/returns.ts` mutates `inventory_master` (line ~363) but never calls `inventoryCache.invalidate()` — POS keeps selling from a stale compact-inventory snapshot for up to 10 minutes, so POS can sell stock that was already returned (violates the strict inventory-only-sales rule).
2. **Investigation's three correction endpoints** (`PUT /inventory/:id`, `PUT /sales/:id`, `PUT /purchases/:id`) also never invalidate the server inventory cache.
3. **Frontend cache invalidation is hand-rolled per page and inconsistent:** POS misses `pos-common-combinations`; Returns misses `sells-list` in some handlers; every page keeps its own drifting copy of the invalidation list.
4. **Minor:** Sells computes `todayStr` in UTC ([Sells/index.tsx:124](frontend/src/pages/Sells/index.tsx#L124)) while everything else uses local dates — off-by-one near midnight IST.

## Step 1 — Backend: server inventory-cache invalidation (highest severity)

Copy the existing pattern from `src/routes/sales.ts:6` (`import { inventoryCache } from '../services/inventoryCache.js';`) and `sales.ts:318-319` (call immediately after `await db.run('COMMIT');`):

- **`src/routes/returns.ts`**: add import; add `inventoryCache.invalidate();` right after the COMMIT (~line 367) in `POST /process-returns`. (`PUT /:id` / `DELETE /:id` don't mutate stock — leave alone.)
- **`src/routes/investigation.ts`**: add import; add `inventoryCache.invalidate();` after COMMIT in all three PUT handlers (~lines 780, 876, 966). Only after COMMIT, never in the catch/rollback path.

## Step 2 — Fix the frozen date window in `usePersistedDateRange` (the sync bug)

All changes in [usePersistedDateRange.ts](frontend/src/hooks/usePersistedDateRange.ts). No consumer changes — Investigation, PurchaseHistory, Sells, Inventory, CustomerReturnHistory, Expiry, and `DateRangeFilter.tsx` inherit it.

**New persisted shape** (same storage keys; old readers ignore extra fields):
`{ from, to, savedOn: <local date at save>, manualTo: <bool>, isDefault: <from===defaultFrom && to===defaultTo> }`
Save effect deps become `[dateRange, manualToDate, storageKey]`.

**Restore rules** (extract pure `restorePersistedRange(storageKey, { defaultFrom, defaultTo, futurePresets, today })`, used by both `useState` initializers), in priority order:
1. Nothing stored / parse error → defaults, `manualTo: false`.
2. `futurePresets === true` (Expiry page) → restore verbatim, never roll.
3. `parsed.to === ''` (explicit All Dates — Sells/Inventory/CustomerReturnHistory) → keep `''`. Distinguish `''` (intentional) from `undefined` (fall back to default) — replaces today's `parsed.to || defaultTo` conflation.
4. `parsed.isDefault === true` → discard stored values, return fresh defaults (Investigation stays exactly "last 15 days").
5. `parsed.manualTo === true` → restore verbatim (user pinned a historical upper bound).
6. Otherwise: if `parsed.to >= parsed.savedOn` (window reached "today" when saved) and `parsed.to < today` → roll `to = today`, keep `from`. If `parsed.to < parsed.savedOn` → deliberate historical view, keep.
7. **Legacy migration** (no `savedOn` field — all existing installs; this heals the live bug on first load): if `to` non-empty and `to < today` → roll `to = today`, `manualTo: false`.
8. Clock-skew guard: `parsed.savedOn > today` → restore verbatim.

**Cross-tab `storage` handler** (lines 57-67): spread only `{ from, to }` into state (don't leak new fields), set `manualToDate` from `parsed.manualTo`; no re-rolling.

## Step 3 — Shared frontend cache-invalidation helper

**New file `frontend/src/utils/cacheInvalidation.ts`:** one function `invalidateAfterStockWrite(queryClient)` that invalidates the union of query keys — `sells-list, inventory-list, dashboard, investigation-list, reports, pos-common-combinations, purchase-history, purchase-history-list, return-history, customer-returns-history-list` — then calls `clearInfiniteScrollCache()` **with no argument** (verified: no-arg clears ALL module caches and broadcasts, [useInfiniteScroll.ts:16-29](frontend/src/hooks/useInfiniteScroll.ts#L16-L29)). Over-invalidation is cheap: react-query refetches only mounted queries.

**Replace the hand-rolled blocks** with one helper call (drop now-unused imports):
- `frontend/src/pages/POS/index.tsx` ~1739-1751 (keep separate `crm-doctors` invalidation at ~1809)
- `frontend/src/pages/Sells/index.tsx` 281-291, 311-321
- `frontend/src/pages/CustomerReturn/index.tsx` 90-104
- `frontend/src/pages/Returns/index.tsx` 210-221, 244-255, 727-738
- `frontend/src/pages/Investigation/index.tsx` 378-392, 574-588
- `frontend/src/pages/Purchases/index.tsx` 1332-1345
- `frontend/src/components/UniversalMedicineEditModal.tsx` 117-132

Behavior change to note in commit: after a write, the active page's infinite-scroll list refetches from page 1 (scroll resets) — correct, since the edited row may have moved.

## Step 4 — Sells UTC date fix

[Sells/index.tsx:124](frontend/src/pages/Sells/index.tsx#L124): replace `new Date().toISOString().split('T')[0]` with the file's own local `getTodayString()` (already defined at line 53).

## Verification

- Backend: `npx tsc --noEmit`; run only jest suites touching returns/investigation/sales/inventoryCache (~16 suites fail pre-existing on main with "no such table" — judge by related suites only, run via `node --experimental-vm-modules`).
- Frontend: `cd frontend && npx tsc --noEmit && npm run build`.
- Manual flows:
  1. Seed `localStorage.setItem('investigation-date-range', '{"from":"2026-06-01","to":"2026-06-20"}')`, reload Investigation → To must show today (legacy migration). Manually pin To to a past date, reload → stays pinned. Sells All-Dates (`''/''`) survives reload; Expiry's future To survives untouched.
  2. **Original complaint:** create a sale in POS → open Investigation without hard refresh → sale visible, matches Sells.
  3. Supplier return on Returns page → POS compact inventory (`GET /api/medicines/compact`) reflects the decrement immediately, not after 10 min; Sells/Inventory pages refresh without reload.

## Out of scope (noted, not changed)

- `src/routes/v1/sales.ts` contains an unmounted duplicate `/list` route — dead code, a divergence trap; recommend deleting in a separate cleanup.
- Investigation row granularity (per sale-item) intentionally differs from Sells (per invoice) — an explanation matter, not a bug.
- `frontend/CLAUDE.md` contains a pasted claude.ai consumer system prompt (~30KB) that gets injected into every Claude Code session as project instructions — recommend deleting it (separate decision, it's not code).
