# PharmarackCart Simplification & Pre-Calculated Reorder Metrics

## Context

`/pharmarack-cart` ([PharmarackCart/index.tsx](../../../frontend/src/pages/PharmarackCart/index.tsx)) has accumulated five top-level tabs (`cart`, `reorder`, `shortages`, `sent-history`, `non-mapped`) plus a sidebar of four sub-tabs inside the cart tab itself (`all` / `requests` / `refills` / `sales_suggestions` / `missing_phone`). The same medicine can appear independently under Sales Suggestions, Requests, and Shortages, and the sales-suggestion source recalculates 60 days of sales/purchase history from scratch on every page load (500ms–2s). This spec consolidates the page to 3 tabs and replaces the live recalculation with an incrementally-maintained metrics table.

This spec folds in and supersedes the standalone `Pre-Calculated Sales Metrics & Simplified Pharmarack Cart Card Plan.md` — its architecture is incorporated below rather than implemented separately.

## Goals

- Reduce the page to exactly 3 top-level tabs: **Supplier PO Grouping** (existing cart view, unchanged), **Sent History** (unchanged), **Reorder Hub** (new, replaces `reorder` + `shortages` + the 4 sidebar sub-tabs).
- Every reorder-relevant signal (sales-velocity, refills due, customer requests, "ordered last month") lives in one Reorder Hub screen, each item tagged with why it's suggested.
- Adding an item from the Reorder Hub always goes through the existing manual "search distributors → pick one → confirm" flow already used for Special Orders/Refills today. Nothing is ever auto-added to a cart.
- `/api/sales/reorder-suggestions` becomes a fast indexed read (2-5ms) instead of a live historical scan.
- The sales-velocity/lookback window (default 2 months) becomes configurable (2/4/6/8 months) from Settings, and the same window governs the "ordered last [window]" Sent History list.
- Remove Non-Mapped Distributors from this page entirely.
- Missing distributor phone number becomes an inline badge on the distributor's card instead of a dedicated tab.

## Non-goals

- No change to the Pharmarack live-cart fetch/session/token logic.
- No change to WhatsApp send/queue mechanics (already fixed separately: silent refresh, already-sent exclusion, duplicate listener removal — see git history 2026-08-19).
- No new page/route — everything stays inside the existing PharmarackCart component tree.

## Architecture

### 1. Database: `medicine_sales_metrics`

The **existing** `GET /api/sales/reorder-suggestions` ([sales.ts:2584-2744](../../../src/routes/sales.ts#L2584)) is more sophisticated than the standalone plan doc assumed: it computes `monthlyWeightedConsumption = (0.70 * purchased_in_window + 0.30 * sold_in_window) / windowMonths`, flags `isHotMover` (high consumption or a 2-day sales burst) and `isLowStockSafety` (low stock with purchase/sale history), and currently does this by scanning the **entire** `medicines` table (LEFT JOIN `inventory_master`, `GROUP BY m.id` — hundreds of thousands of rows) plus 3 live aggregate subqueries, on every request. This table pre-computes exactly those inputs — it does not replace the formula, it makes its inputs O(1) to read:

```sql
CREATE TABLE IF NOT EXISTS medicine_sales_metrics (
  medicine_id INTEGER PRIMARY KEY,
  sales_2d_qty REAL NOT NULL DEFAULT 0,        -- rolling 2-day sales (burst detection, window-independent)
  sales_window_qty REAL NOT NULL DEFAULT 0,    -- sales within the configured lookback window (was: live 180-day scan)
  purchases_window_qty REAL NOT NULL DEFAULT 0, -- purchases within the configured lookback window (was: live 180-day scan)
  last_sold_date TEXT,
  last_purchase_date TEXT,
  last_purchase_ptr REAL DEFAULT 0,
  last_distributor_id INTEGER,
  last_distributor_name TEXT,
  updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
  FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);

CREATE INDEX IF NOT EXISTS idx_msm_activity
ON medicine_sales_metrics(sales_window_qty, purchases_window_qty, sales_2d_qty);
```

`sales_window_qty` / `purchases_window_qty` always reflect the *currently configured* lookback window (see Setting below) — replacing the hardcoded 180-day scan, not the weighting formula itself.

**`current_stock` is deliberately NOT stored here.** `inventory_master` (the real stock source) is written to from 70+ call sites across the codebase (sales, purchases, returns, adjustments, migrations, corrections) — incrementally mirroring it into this table would require hooking all of them and would silently drift the moment one was missed, the same class of bug as the earlier stock-ledger phantom-stock issue. Instead, the fast endpoint fetches live stock with a second, cheap query scoped only to the small set of candidate medicine_ids the pre-calculated sales/purchase columns already narrowed down (see §4) — never a full-catalog scan.

**Correctness model**: two clean creation events (sale completed, purchase saved) increment `sales_window_qty`/`purchases_window_qty`/`sales_2d_qty` for same-day freshness (§3). A nightly full recompute (§3) is the actual correctness backstop — it fully re-derives every row from `sale_items`/`purchase_items` for the configured window, silently fixing any drift from edits, deletions, or returns that weren't individually hooked. This bounds the implementation to 2 hook points instead of chasing down dozens of `inventory_master` mutation sites.

### 2. Configurable lookback window (Settings)

New `app_settings` key: `pharmarack_reorder_window_months`, one of `2 | 4 | 6 | 8`, default `2`. Added to the existing "Pharmarack B2B Live Ordering Credentials" section in [Settings/index.tsx](../../../frontend/src/pages/Settings/index.tsx#L1100) as a simple select.

Both consumers read this one setting:
- The sales-velocity metric (`sales_window_qty` / "Past X Months Sold").
- The "Ordered last X months" Reorder Hub group (queries Sent History, not the metrics table).

Changing the setting triggers a one-time backfill recompute of `sales_window_qty` for all medicines (bounded, admin-triggered, not on the hot path — acceptable to take a few seconds since it only runs when the setting changes, not on every page load).

### 3. Event-driven updates + nightly reconcile

- **On POS sale invoice complete** ([sales.ts:428](../../../src/routes/sales.ts#L428), same transaction as the existing `inventory_master` decrement): increment `sales_window_qty` and `sales_2d_qty` by the sold strip quantity, update `last_sold_date`. This is the only same-day hook — a fast-selling item needs to surface as "needs reorder" the same day it starts moving.
- **Purchases are not hooked at all.** `purchases.ts` has 4+ separate places that add stock (create, edit-revert-then-readd, bulk actions) — chasing all of them for a same-day increment isn't worth it, because a purchase you just made doesn't create same-day reorder urgency (you just restocked). `purchases_window_qty` and `last_purchase_date`/`last_purchase_ptr`/`last_distributor_name` are populated solely by the nightly reconcile below, which is simpler and just as correct within a day's lag.
- **Nightly full reconcile** (idle-period job): re-derives `sales_window_qty`, `purchases_window_qty`, `sales_2d_qty`, and the `last_purchase_*` fields for every medicine directly from `sale_items`/`purchase_items` filtered to the configured window — this is the correctness backstop that fixes drift from sale edits/deletions/returns without needing to hook those paths individually. Also runs once immediately whenever the window setting changes.
- Table auto-initializes and backfills (via the same reconcile routine) from existing sales/purchases on first startup if empty.

### 4. Fast reorder-suggestions endpoint

`GET /api/sales/reorder-suggestions` replaces the full-catalog scan (`medicines` LEFT JOIN `inventory_master`, `GROUP BY m.id` across the whole table) with two narrow queries, then applies the **same existing weighting formula** in-process:

```sql
-- Query 1: candidates with any recent activity (indexed, no full-table scan)
SELECT m.id as medicine_id, m.name as medicine_name, m.manufacturer as company,
       m.packaging, m.mrp, msm.sales_2d_qty, msm.sales_window_qty,
       msm.purchases_window_qty, msm.last_purchase_date, msm.last_purchase_ptr,
       msm.last_distributor_name
FROM medicine_sales_metrics msm
JOIN medicines m ON m.id = msm.medicine_id
WHERE msm.sales_2d_qty > 0 OR msm.sales_window_qty > 0 OR msm.purchases_window_qty > 0
ORDER BY msm.sales_window_qty DESC
LIMIT 500;

-- Query 2: live stock, scoped only to the candidate medicine_ids from Query 1 (small IN-list, indexed)
SELECT medicine_id, COALESCE(SUM(quantity), 0) as current_stock
FROM inventory_master
WHERE medicine_id IN (...)
GROUP BY medicine_id;
```

Then, per candidate row (identical math to the current live implementation, just fed by pre-computed sales/purchase columns instead of live 180-day aggregates):

```
monthlyWeightedConsumption = round((0.70 * purchases_window_qty + 0.30 * sales_window_qty) / windowMonths)
isHotMover = monthlyWeightedConsumption >= 10 OR sales_2d_qty >= 5
isLowStockSafety = current_stock <= 2 AND (purchases_window_qty >= 6 OR sales_window_qty >= 6)
include if: sales_2d_qty > 0 OR isLowStockSafety OR (monthlyWeightedConsumption > 0 AND current_stock <= monthlyWeightedConsumption)
suggestedQty = monthlyWeightedConsumption > 0 ? max(1, ceil(monthlyWeightedConsumption - current_stock))
             : sales_2d_qty > 0 ? max(1, sales_2d_qty * 2)
             : isLowStockSafety ? max(1, 10 - current_stock)
             : 1
```

`windowMonths` comes from the `pharmarack_reorder_window_months` setting (default 2), replacing the current hardcoded `/ 6`. Existing snooze mechanism (`inventory_reorder_snooze`, 7d/30d/6mo/permanent — already implemented) is reused unchanged for "Ignore."

### 5. Reorder Hub (frontend)

Single screen, replacing `currentTab === 'reorder'`, `currentTab === 'shortages'`, and the cart tab's `sidebarTab` sub-tabs (`requests` / `refills` / `sales_suggestions` / `missing_phone`). Items render in one list, each carrying a reason tag:

| Reason tag | Source | Existing data already fetched on this page |
|---|---|---|
| Low stock — selling fast | `medicine_sales_metrics` (new fast query) | replaces `reorderSuggestions` state |
| Patient refill due | `pendingRefills` | unchanged source |
| Customer requested | `pendingOrders` (special orders) | unchanged source |
| Ordered last [window] | **new**: query Sent History for medicines sent to any distributor within the configured window | new query against sent-orders/Sent History data |

Card template (applied consistently across all four reason groups, with 1-2 data lines swapped per reason):

```
Medicine Name                              [packaging badge]
📊 Past {window} Sold: {qty} units   (sales-velocity cards only)
📦 Current Stock: {qty} strips
Need: {suggestedQty} qty        [Ignore ▾]   [+ Add]
```

Refill cards swap in "Patient: {name}, Due: {date}"; request cards swap in "Requested by: {requester}"; "ordered last [window]" cards swap in "Last ordered: {date} from {distributor}". Clicking **+ Add** on any card opens the same distributor-search-and-confirm flow already used for Special Orders (`handleSearchDistributorsForOrder` → `handleConfirmOrderDistributor` pattern) — generalized to accept any reason-group's item shape. No auto-add path exists for any reason group.

### 6. Removed / relocated

- **Non-Mapped Distributors tab**: deleted (component, route param, nav entry).
- **Missing-phone sidebar tab**: deleted. A small warning badge is added directly on a distributor's card in the Supplier PO Grouping view when `getDistributorPhoneNumber(dist)` resolves empty.
- **"Educational Restocking Lifecycle" progress bar** and other decorative-only chrome tied to the old `reorder`/`shortages` tabs: deleted along with those tabs.

## Data flow summary

```
POS sale invoice ──┐
Purchase verified ─┼─> medicine_sales_metrics (incremental) ─> GET /reorder-suggestions (2-5ms) ─┐
Settings: window ──┘                                                                              │
                                                                                                     ├─> Reorder Hub (one screen, 4 reason-groups)
pendingRefills (existing fetch) ───────────────────────────────────────────────────────────────────┤
pendingOrders (existing fetch) ─────────────────────────────────────────────────────────────────────┤
Sent History (new query, same window setting) ──────────────────────────────────────────────────────┘
                                                                        │
                                                          user clicks + Add on any card
                                                                        │
                                                        existing search-distributor-confirm flow
                                                                        │
                                                          item added to that distributor's card
                                                              in Supplier PO Grouping tab
```

## Testing

- Backend: table creation + backfill; `/reorder-suggestions` returns `windowSales`/`currentStock`/`suggestedQty`; sale invoice increments `sales_window_qty`; purchase invoice updates `current_stock`; changing the Settings window triggers recompute.
- Frontend: Reorder Hub renders all 4 reason-groups with correct counts; +Add opens distributor picker (never auto-adds); Ignore snoozes via existing table; Non-Mapped tab and old sidebar sub-tabs no longer reachable; missing-phone badge appears on affected distributor cards.
- Manual: navigate to `/pharmarack-cart`, confirm exactly 3 tabs; change reorder window in Settings 2→6 months and confirm Reorder Hub numbers update after recompute.
