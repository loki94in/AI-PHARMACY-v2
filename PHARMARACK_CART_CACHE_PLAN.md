# Pharmarack Cart — Calculate-Once Cache Implementation Plan

> Status: IMPLEMENTED
> Date: 2026-08-21
> Scope: `frontend/src/pages/PharmarackCart/index.tsx`, `src/routes/pharmarack.ts`

---

## 1. The Issue

Every time the Pharmarack Cart page was opened, the app re-downloaded the ENTIRE live cart
from Pharmarack's servers and recalculated everything — even when nothing had changed.
Adding or removing a single product triggered 2–3 full cart re-fetches plus per-item
price-history lookups.

### Root causes found

| # | Cause | Location |
|---|-------|----------|
| 1 | Mount effect unconditionally calls `fetchCart()` + `fetchLatestSentMap()` on every page visit — no freshness check | `PharmarackCart/index.tsx:2382-2385` |
| 2 | Window focus / tab visibility change triggers a full live re-fetch every time | `PharmarackCart/index.tsx:2789-2792` |
| 3 | After add/delete, BOTH an explicit `fetchCart()` AND the `refresh-pharmarack-cart` event fire → double full fetch | `PharmarackCart/index.tsx:2277-2279`, `2200-2201` |
| 4 | Backend `GET /api/pharmarack/cart` has no cache — every call = 1 live external call to Pharmarack (`GetUserCartDetails`) + snapshot diffing | `src/routes/pharmarack.ts:1250` |
| 5 | Module-level caches (`cachedDistributors`, `cachedPriceHistory`) are memory-only — a browser refresh (F5) wipes them | `PharmarackCart/index.tsx:141-151` |

---

## 2. Old Behavior vs New Behavior

### OLD (before)

```
Open cart page              → full live fetch (1 external Pharmarack call) + sent-map
                            + N price-history calls + batch-last-purchase
Switch away / back to app   → another full live fetch (every focus)
Add 1 item                  → POST add + FULL refetch #1 (explicit) + FULL refetch #2 (event)
Delete 1 item               → DELETE + FULL refetch #1 (event) + FULL refetch #2 (1.5s timer)
Browser F5 reload           → everything re-downloaded from scratch
Typical add flow total      → 4–6+ API calls, 2–3 of them full live cart downloads
```

### NEW (after)

```
Open cart page (cache exists)   → render from cache instantly, ZERO API calls
Open cart page (first ever)     → one live fetch, then cached forever
Add 1 item                      → calculate THAT item once locally (qty × ptr),
                                  merge into cache, 1 add-call,
                                  then ONE debounced background verify that only
                                  touches items that actually changed
Delete 1 item                   → remove locally, 1 delete-call, same single verify
Qty change                      → recalculate that line only (already optimistic)
New item detected in verify     → price history fetched for THAT name only
Browser F5 reload               → hydrate from localStorage instantly, 0 calls
Full manual re-sync             → ONLY via the existing refresh button (user action)
```

### API call reduction summary

| Action | Before | After |
|--------|--------|-------|
| Reopen page same day | 2+ calls (+N price history) | **0 calls** |
| Add 1 item | 4–6 calls (incl. 2 full cart fetches) | **2 calls** (add + 1 diffed verify) |
| Delete 1 item | 3–4 calls (incl. 2 full cart fetches) | **2 calls** (delete + 1 diffed verify) |
| Window focus spam | 1 live external call each time | **0 calls** |
| F5 reload | full re-download | **0 calls** (localStorage hydrate) |

---

## 3. How We Fix It

### Frontend — `frontend/src/pages/PharmarackCart/index.tsx`

1. **localStorage persistence** (`pharmarack_cart_cache_v1`)
   - New module helpers `loadPersistedCartCache()` / `persistCartCache()`.
   - Stores `{ distributors, priceHistory (capped at 200 names), savedAt }`.
   - Module caches hydrate from it on cold start; written after every successful sync.
   - Cleared by the existing `clear-sent-history` / `clear-app-cache` handler.

2. **Mount gate**
   - On mount: if module/localStorage cache has data → render it, make NO network call.
   - Network fetch happens ONLY when cache is completely empty (first-ever visit).
   - Removed auto-fetch on window focus / visibilitychange entirely.

3. **Debounced `scheduleCartSync()`** (~1.5 s)
   - Single shared verification sync for all mutations (add/delete/qty).
   - Bursts of changes collapse into ONE background refresh.
   - Replaces all double-fetch paths (explicit call + event + setTimeout combos).

4. **Incremental diff apply** (`applyCartDiff`)
   - When a verification sync returns, compare server list vs cache by
     `storeId + productCode/productId/productName`.
   - Only new / changed / removed items are merged; untouched items keep their
     cached objects (no re-render churn, no recalculation).

5. **Optimistic single-item calculation**
   - On add: compute `amount = qty × ptr` once client-side, merge item into the
     correct store group, update `lineTotal`. No immediate refetch.
   - Price history stays incremental (module-cached by product name).

6. **Manual refresh button** remains the only path to a forced full live sync.

### Backend — `src/routes/pharmarack.ts`

7. **30-second burst cache on `GET /cart`**
   - In-memory `cartCache: { distributors, totalItems, ts }`.
   - Fresh (<30 s) → served from memory, no upstream Pharmarack call.
   - Protects against multi-component bursts (e.g., Layout sidebar badge query).
   - Invalidated by successful `POST /cart/add` and `POST /delete-cart-item`.
   - Auto-notification snapshot diffing still runs on live fetches only.

8. **Removed duplicate route**: `/live-cart-summary` was registered twice
   (lines ~1471 and ~2325); second registration deleted.

---

## 4. Files Changed

| File | Change |
|------|--------|
| `frontend/src/pages/PharmarackCart/index.tsx` | Persistence helpers, mount gate, debounced sync, diff apply, optimistic add merge, removed focus/visibility auto-fetch |
| `src/routes/pharmarack.ts` | 30 s burst cache + invalidation; duplicate route removal |
| `PHARMARACK_CART_CACHE_PLAN.md` | This document |

---

## 5. Known Trade-off (by design)

Items added/removed **directly on the Pharmarack website** (outside this app) will not
appear until the user presses the manual refresh button. Within this app, every mutation
keeps the cache perfectly synchronized with zero unnecessary recalculation.

## 6. Verification

- `npx tsc --noEmit` in `frontend/` and backend compile check.
- `npx jest tests/pharmarackCartNotif.test.ts` must pass (notificationService untouched).
- Manual network-tab check: reopen page = 0 calls; add item = 1 POST + 1 diffed verify.
