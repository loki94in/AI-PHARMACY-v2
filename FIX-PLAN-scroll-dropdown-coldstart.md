# Fix POS/Inventory scroll, dropdown auto-close, and cold-start slowness

## Context

Three user-reported problems in the pharmacy app:

1. **Touch scrolling** works smoothly on the Master **Database** page but is janky/broken on the **Inventory/Expiry**, **Doctors**, and **POS** table pages.
2. **Cold start is slow** — after starting the server, the POS/Sell pages take 10-15s to appear.
3. **Dropdowns don't auto-close** — the POS product-search and cart-row search suggestion lists stay open when the user clicks elsewhere on the page.

Root causes were confirmed by code exploration. The scroll difference is a missing CSS height constraint (`min-h-0`), not a touch-CSS issue. The cold start is server-side boot work (full DB integrity scan + loading the whole medicine-name list) blocking before requests are served. The dropdowns simply have no outside-click handler. A fourth (optional, larger) fix targets slow per-keystroke search SQL.

Chosen startup approach: **non-blocking + `quick_check`** — load POS instantly, run the integrity scan in the background, and lazy-load the name list.

---

## Fix 1 — Table scroll (make Inventory/Expiry, Doctors, POS scroll like Database)

Working pages (`Database`, `CRM`) thread a definite collapsed height down to the `overflow-auto` box. Broken pages have a grid **item** that scrolls but lacks `min-h-0`, so it grows to full table height and never clips.

- `frontend/src/pages/Expiry/index.tsx` — grid item ~L367 (`xl:col-span-3 glass-panel flex flex-col overflow-hidden …`): add `min-h-0`.
- `frontend/src/pages/Doctors/index.tsx` — grid item ~L221 (`md:col-span-2 glass-panel flex flex-col overflow-hidden`): add `min-h-0`.
- `frontend/src/pages/POS/index.tsx` — cart panel ~L1718: it stacks `flex-1`, `h-full`, and `min-h-0` together, giving the inner scroll box (~L1768) an ambiguous height. Drop the redundant `h-full`, keep `flex-1 … min-h-0` to match the working pages.

Pattern reference (already correct): CRM scroll ancestor carries `min-h-0` at `frontend/src/pages/CRM/index.tsx` ~L991.

No touch-CSS changes are needed. The `scrollbar-thin`/`custom-scrollbar` classes in the JSX are undefined no-ops and can be left as-is.

---

## Fix 2 — Dropdown auto-close on outside click

No shared click-outside hook exists; the codebase repeats an inline `useRef` + `document.addEventListener('mousedown', …)` pattern in 5 places (e.g. `frontend/src/pages/Investigation/index.tsx` L166-176, which dismisses a medicine-search list — the closest analog).

**Add a shared hook** `frontend/src/hooks/useOnClickOutside.ts` (`ref`, `handler`) alongside the existing hooks in `frontend/src/hooks/`, then use it in POS:

- **Product-search dropdown** (state `searchResults`, input ~L1365, panels ~L1407 & ~L1491): wrap the input + dropdown panels in one container `ref`; on outside `mousedown` call `setSearchResults([])`.
- **Cart-row "change medicine" dropdown** (state `rowSearchResults`/`activeRowSearchIndex`, input ~L1828, panel ~L1868): wrap in a `ref`; on outside `mousedown` call `setRowSearchResults([])` and `setActiveRowSearchIndex(null)`.
- **Patient autocomplete** (~L1171) already closes via its `onBlur` timeout — leave as-is, or optionally migrate for consistency.

Use **`mousedown`** (not `click`/`blur`) so item selection — including the async `apiClient.post('/medicines/learn-correction')` on the fuzzy item at ~L1502 — still registers before the list closes.

---

## Fix 3 — Cold-start speedup (non-blocking + quick_check + lazy name-list)

Two boot blockers, both to be moved off the critical path:

- `src/database/connection.ts` L48-64 — currently runs `PRAGMA integrity_check` (full-file scan) inline on first connection in production before returning the connection. Change to:
  - Use `PRAGMA quick_check` instead of `integrity_check` (dramatically faster, still catches most corruption).
  - Run it **detached** after the connection is returned (e.g. schedule via `setImmediate`/an un-awaited async), so `getConnection()` resolves immediately. On failure, invoke the **existing** self-heal routine (the `needsHeal` / backup-restore block further down, L73+) — keep that heal logic intact, just triggered from the background check rather than blocking boot.
- `src/server.ts` ~L234 — stop `await`ing `productNameFilterService.initialize()` at boot. The service is already lazy (`if (this.initialized) return` at `src/services/productNameFilterService.ts:248`) and callers (e.g. `/sales/suggest-medicine`) call `initialize()` before use, so make the boot call fire-and-forget (or remove it) to warm the cache without blocking `app.listen`.

---

## Fix 4 — Per-keystroke search speed (targeted, lower-risk subset)

The medicine search runs full scans on every keystroke. Full sub-second infix search would require SQLite FTS5 (out of scope). Apply these lower-risk wins in `src/routes/sales.ts` and mirror in `src/routes/v1/sales.ts`:

- **`/sales/search-medicine`** (`sales.ts` L744-961): the infix fallback `LIKE '%q%'` (L824-854) and numeric `CAST(... mrp ...) LIKE` (L784) are unavoidable leading-wildcard scans — gate them so they only fire for longer terms (raise the min length before the infix fallback runs) to cut how often the master is scanned. Add an index on `medicines.item_code` if missing (prefix `item_code LIKE 'q%'` searches can then use it).
- **`date(im.expiry_date) >= date('now')`** (L787/L818/L850) wraps the column in `date()`, defeating any index and evaluating row-by-row over mixed date formats. Preserve behavior but make it sargable where possible (compare against a precomputed `now` string / normalize the stored format), or apply the expiry filter in JS on the already-limited result set. Confirm the exact stored format before changing — flag for careful testing.
- **`/sales/recommend-quantity/batch`** (`sales.ts` L478-598, called on POS mount): the per-name `LIKE 'name%'` then `LIKE '%name%'` fallbacks (L514-524) run one query per quick-add name. Batch the exact-match `IN (...)` first (already present) and only fall back per-name for misses; cap the fallback.
- **`/sales/suggest-medicine`** O(N) Levenshtein/soundex loop over the whole name list (`productNameFilterService.ts` L360-364): on the POS frontend, only call it when the primary search returns few/no results and keep it debounced, so the CPU-heavy fuzzy pass doesn't run on every keystroke.

If any of the SQL changes prove risky against the real data formats, prefer the frontend gating (min-length, debounce, fuzzy-only-on-empty) which is safe and already cuts most of the load.

---

## Verification

- **Scroll**: `cd frontend && npm run dev`, open Inventory/Expiry, Doctors, and POS on a touch device (or Chrome DevTools device mode). Confirm the table body scrolls internally with momentum while the header stays sticky and the page itself doesn't overflow — matching the Database page.
- **Dropdowns**: On POS, type ≥3 chars to open the product-search list, then click empty page area → list closes. Repeat for the cart-row "change medicine" search. Confirm clicking an item still adds it (selection not swallowed by the close).
- **Cold start**: Start the packaged/production server (`NODE_ENV=production`) with a large `app.db`; confirm POS/Sell render in ~1-2s instead of 10-15s. Corrupt-DB safety: verify the background `quick_check` still logs and the self-heal path still triggers on a known-bad DB.
- **Search speed**: In POS, type a medicine name and confirm results appear without multi-second lag per keystroke. Run `npm test` (`tests/automation.test.ts`) to catch regressions in the sales routes.
