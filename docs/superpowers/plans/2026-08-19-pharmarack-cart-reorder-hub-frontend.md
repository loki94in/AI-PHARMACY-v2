# PharmarackCart Reorder Hub Consolidation (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate PharmarackCart's 5 top-level tabs (Reorder Cart, Supplier PO Grouping, Demands & Shortages, Sent PO History, Distributor Catalogs) plus a duplicate in-cart sidebar down to exactly 3 (Supplier PO Grouping, Reorder Hub, Sent PO History), merging four overlapping "things to reorder" data sources into one Reorder Hub screen with reason-tagged sub-tabs, and add the "ordered in the last N months" source that doesn't exist yet.

**Architecture:** Investigation found that most of this consolidation is deletion, not new construction — the tab currently labeled "Demands & Shortages" (`currentTab === 'shortages'`) already merges Special Requests + Refills Due + Sales Restock into one screen with sub-tabs; it just isn't the tab the "Reorder Hub" nav button actually points to (that button currently opens a *different*, older tab — `currentTab === 'reorder'` — built around stale live-cart items). This plan: (1) adds a new backend endpoint for "ordered in the last N months" sourced from `pharmarack_placed_orders`, (2) adds it as a 4th sub-tab to the existing shortages screen, (3) renames that screen's internal tab id from `'shortages'` to `'reorder'` so the existing, already-correctly-labeled "Reorder Hub" nav button opens it, (4) deletes the old `'reorder'` tab's content wholesale (relocating its one useful action — bulk-select stale cart items — into the Supplier PO Grouping tab's header), (5) deletes the Non-Mapped Distributors tab, (6) deletes the duplicate sidebar inside the Supplier PO Grouping tab, (7) adds an inline missing-phone badge to distributor cards, replacing the sidebar's phone-collection sub-tab.

**Tech Stack:** React, TypeScript, existing `apiClient`/`api` service layer, Tailwind classes matching existing page conventions.

**Spec:** [docs/superpowers/specs/2026-08-19-pharmarack-cart-simplification-design.md](../specs/2026-08-19-pharmarack-cart-simplification-design.md) — sections 5 and 6. This plan also implements a corrected, more-grounded version of section 5's mechanism than the spec describes (repurposing the existing "Demands & Shortages" screen rather than building a new one from scratch) — the *outcome* (3 tabs, one Reorder Hub, 4 reason-groups, manual-only add) is unchanged from the spec.

**Depends on:** [2026-08-19-pharmarack-reorder-metrics-backend.md](2026-08-19-pharmarack-reorder-metrics-backend.md) (Task 3 of that plan changes the `/reorder-suggestions` response's field semantics — `sixMonthTotalSales`/`sixMonthTotalPurchases` now reflect the configured window, not a fixed 6 months). Run that plan first.

## Global Constraints

- No auto-add path may exist anywhere in the Reorder Hub — every "+ Add" click opens an existing manual flow (distributor picker for requests/refills, or the LiveCartAddModal search box via `liveCartAddEvent.triggerOpen` for sales-restock/ordered-recently items). Do not invent a new add mechanism.
- Preserve each reason-group's existing add mechanism as-is; only consolidate the tab/navigation container around them.
- The tab id string `'shortages'` becomes `'reorder'`; do not leave both strings referring to different things.

---

### Task 1: Backend — "ordered in the last N months" endpoint

**Files:**
- Modify: `src/routes/pharmarack.ts` (add a new route near the existing `router.get('/sent-orders', ...)` at line 2176)

**Interfaces:**
- Produces: `GET /api/pharmarack/reorder-recent?months=N` → `{ success: true, items: [{ medicineName, lastOrderedDate, lastQty, lastDistributorName }] }`
- Consumes (Task 3 of this plan calls it): reuses `getReorderWindowMonths` from `src/services/medicineSalesMetricsService.ts` (backend plan Task 1) for the default `months` value when the query param is omitted.

- [ ] **Step 1: Add the route**

In `src/routes/pharmarack.ts`, add after the existing `router.get('/sent-orders/latest-map', ...)` handler (which starts at line 2220 — insert this new route after that handler's closing `});`):

```typescript
/**
 * GET /api/pharmarack/reorder-recent
 * Query param: ?months=2|4|6|8 (defaults to the configured reorder window setting)
 * Returns one entry per distinct medicine name sent to any distributor within the window,
 * keeping only the most recent occurrence per medicine. Powers the Reorder Hub's
 * "Ordered last [window]" group — a convenience list to quickly repeat a past order,
 * distinct from the sales-velocity-based low-stock suggestions.
 */
router.get('/reorder-recent', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { getReorderWindowMonths } = await import('../services/medicineSalesMetricsService.js');
    const queryMonths = parseInt((req.query.months as string) || '', 10);
    const months = [2, 4, 6, 8].includes(queryMonths) ? queryMonths : await getReorderWindowMonths(db);
    const windowDays = months * 30;

    const rows = await db.all(
      `SELECT * FROM pharmarack_placed_orders
       WHERE order_date >= DATE('now', ?)
       ORDER BY placed_at DESC`,
      [`-${windowDays} days`]
    );

    const byMedicine = new Map<string, { medicineName: string; lastOrderedDate: string; lastQty: number; lastDistributorName: string }>();
    for (const row of rows) {
      let items: any[] = [];
      try { items = JSON.parse(row.items_json || '[]'); } catch (_) { continue; }
      for (const item of items) {
        const name = (item.productName || item.name || '').trim();
        if (!name || byMedicine.has(name)) continue; // rows are already newest-first, keep first hit
        byMedicine.set(name, {
          medicineName: name,
          lastOrderedDate: row.order_date,
          lastQty: Number(item.qty || item.quantity || 1),
          lastDistributorName: row.store_name || ''
        });
      }
    }

    res.json({ success: true, items: Array.from(byMedicine.values()) });
  } catch (err: any) {
    console.error('Error fetching recently reordered medicines:', err);
    res.status(500).json({ error: 'Failed to fetch recently reordered medicines: ' + err.message });
  }
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual API test**

```bash
curl "http://localhost:5174/api/pharmarack/reorder-recent?months=2"
```
Expected: `{"success":true,"items":[{"medicineName":"...","lastOrderedDate":"...","lastQty":...,"lastDistributorName":"..."}]}`, one entry per distinct medicine name.

- [ ] **Step 4: Commit**

```bash
git add src/routes/pharmarack.ts
git commit -m "feat: add reorder-recent endpoint for the Reorder Hub's ordered-last-window group"
```

---

### Task 2: Frontend — add the API client method

**Files:**
- Modify: `frontend/src/services/api.ts` (add alongside the existing `searchPharmarack`/`getPharmarackCart` methods)

**Interfaces:**
- Produces: `api.getPharmarackReorderRecent(months?: number): Promise<{ success: boolean; items: { medicineName: string; lastOrderedDate: string; lastQty: number; lastDistributorName: string }[] }>`

- [ ] **Step 1: Add the method**

Find the existing method for `GET /pharmarack/sent-orders/latest-map` in `frontend/src/services/api.ts` (it will look like `getPharmarackLatestSentMap: async () => (await apiClient.get('/pharmarack/sent-orders/latest-map')).data,` or similar) and add immediately after it:

```typescript
  getPharmarackReorderRecent: async (months?: number) =>
    (await apiClient.get('/pharmarack/reorder-recent', { params: months ? { months } : {} })).data,
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: add getPharmarackReorderRecent API client method"
```

---

### Task 3: Frontend — add the 4th reason-group and rename the tab

**Files:**
- Modify: `frontend/src/pages/PharmarackCart/index.tsx`

**Interfaces:**
- Consumes: `api.getPharmarackReorderRecent()` from Task 2.

- [ ] **Step 1: Widen the sub-tab type and add state**

Find (around line 212):

```typescript
  const [shortagesSubTab, setShortagesSubTab] = useState<'requests' | 'refills' | 'sales_suggestions'>('requests');
```

Replace with:

```typescript
  const [shortagesSubTab, setShortagesSubTab] = useState<'requests' | 'refills' | 'sales_suggestions' | 'ordered_recently'>('requests');
  const [reorderRecentItems, setReorderRecentItems] = useState<{ medicineName: string; lastOrderedDate: string; lastQty: number; lastDistributorName: string }[]>([]);
```

- [ ] **Step 2: Add the fetch function**

Find the existing `fetchReorderSuggestions` function (used by the Sales Restock sub-tab — locate it by searching for `const fetchReorderSuggestions`) and add a sibling function right after it:

```typescript
  const fetchReorderRecentItems = async () => {
    try {
      const res = await api.getPharmarackReorderRecent();
      if (res && res.success && Array.isArray(res.items)) {
        setReorderRecentItems(res.items);
      }
    } catch (err) {
      console.error('Failed to fetch recently reordered medicines:', err);
    }
  };
```

Find where `fetchReorderSuggestions()` is called on mount (in a `useEffect`) and add `fetchReorderRecentItems();` alongside it in the same effect.

- [ ] **Step 3: Add the 4th sub-tab button**

In the "Demands & Shortages" tab block, find the "Sales Restock" sub-tab button (around line 3504-3515):

```tsx
              <button
                type="button"
                onClick={() => setShortagesSubTab('sales_suggestions')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  shortagesSubTab === 'sales_suggestions'
                    ? 'bg-emerald-500/20 text-emerald-400 font-black shadow-xs border border-emerald-500/30'
                    : 'text-muted hover:text-text hover:bg-bg3'
                }`}
              >
                <TrendingUp size={12} />
                <span>Sales Restock ({reorderSuggestions.length})</span>
              </button>
            </div>
          </div>
```

Add a new button between the last two lines (before the closing `</div></div>`):

```tsx
              <button
                type="button"
                onClick={() => setShortagesSubTab('sales_suggestions')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  shortagesSubTab === 'sales_suggestions'
                    ? 'bg-emerald-500/20 text-emerald-400 font-black shadow-xs border border-emerald-500/30'
                    : 'text-muted hover:text-text hover:bg-bg3'
                }`}
              >
                <TrendingUp size={12} />
                <span>Sales Restock ({reorderSuggestions.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShortagesSubTab('ordered_recently')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  shortagesSubTab === 'ordered_recently'
                    ? 'bg-violet-500/20 text-violet-400 font-black shadow-xs border border-violet-500/30'
                    : 'text-muted hover:text-text hover:bg-bg3'
                }`}
              >
                <RotateCw size={12} />
                <span>Ordered Recently ({reorderRecentItems.length})</span>
              </button>
            </div>
          </div>
```

- [ ] **Step 4: Add the sub-tab content**

Find the "Smart Sales Restock" content block (starts around line 3615 with `{/* Smart Sales Restock */}`) and its closing (around line 3666, right before the tab's own closing `</div></div>`). Add a new block immediately after that content block's closing `)}`:

```tsx
            {/* Ordered Recently */}
            {shortagesSubTab === 'ordered_recently' && (
              reorderRecentItems.length === 0 ? (
                <div className="text-center py-16 text-xs text-muted italic">
                  No medicines ordered in the configured lookback window.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {reorderRecentItems.map((item) => (
                    <div key={item.medicineName} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                      <div className="space-y-2">
                        <span className="font-extrabold text-xs text-text">{item.medicineName}</span>
                        <div className="text-xs text-muted space-y-1">
                          <div>Last ordered: <strong className="text-text">{item.lastOrderedDate}</strong> from <strong className="text-text">{item.lastDistributorName || 'Unknown'}</strong></div>
                          <div>Last quantity: <strong className="text-violet-400 font-mono">{item.lastQty}</strong></div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => liveCartAddEvent.triggerOpen(item.medicineName, item.lastQty)}
                        className="w-full py-1.5 px-3 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-xs"
                      >
                        <ShoppingCart size={12} />
                        <span>Reorder (x{item.lastQty})</span>
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
```

- [ ] **Step 5: Rename the tab id from `'shortages'` to `'reorder'`**

Two changes, both in `frontend/src/pages/PharmarackCart/index.tsx`:

a) The tab header comment and condition (around line 3454-3455):
```tsx
      ) : currentTab === 'shortages' ? (
        /* ── Shortages & Restock Hub View ── */
```
becomes:
```tsx
      ) : currentTab === 'reorder' ? (
        /* ── Reorder Hub View ── */
```

b) The header title text and subtitle (around line 3465-3472):
```tsx
                  Shortages & Restock Hub
                  <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-sky-500/10 text-sky-400 border-sky-500/30 font-mono">
                    {visiblePendingOrders.length + visiblePendingRefills.length + reorderSuggestions.length} Demands
                  </span>
                </h3>
                <p className="text-[10px] text-muted tracking-wider mt-1">
                  Patient shortages, refill reminders, and sales-weighted inventory replenishment.
                </p>
```
becomes:
```tsx
                  Reorder Hub
                  <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-sky-500/10 text-sky-400 border-sky-500/30 font-mono">
                    {visiblePendingOrders.length + visiblePendingRefills.length + reorderSuggestions.length + reorderRecentItems.length} Items
                  </span>
                </h3>
                <p className="text-[10px] text-muted tracking-wider mt-1">
                  Customer requests, refill reminders, sales-weighted restock suggestions, and recently ordered medicines.
                </p>
```

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/PharmarackCart/index.tsx
git commit -m "feat: add ordered-recently reason-group and rename shortages tab to Reorder Hub"
```

---

### Task 4: Frontend — delete the old Reorder Cart tab, relocate its bulk-select button

**Files:**
- Modify: `frontend/src/pages/PharmarackCart/index.tsx`

- [ ] **Step 1: Delete the old tab's entire content block**

The old `currentTab === 'reorder'` block (the "REORDER CART / Restocking Workspace" view built around `previousOrderItemsInfo`) runs from the line `) : currentTab === 'reorder' ? (` with the comment `/* ── REORDER CART & RESTOCKING WORKSPACE MASTER VIEW ── */` through its matching closing `)` immediately before `} : currentTab === 'shortages' ? (` — that second condition was already renamed to `'reorder'` in Task 3, so at this point in the file there are (temporarily) two `currentTab === 'reorder'` branches; delete the **first** one (the old workspace), not the one just renamed in Task 3.

Delete everything from:
```tsx
      ) : currentTab === 'reorder' ? (
        /* ── REORDER CART & RESTOCKING WORKSPACE MASTER VIEW ── */
```
through the line immediately before the (renamed) Reorder Hub's own `) : currentTab === 'reorder' ? (` — i.e. delete the entire old tab's JSX, leaving the ternary chain as:
```tsx
      ) : currentTab === 'sent-history' ? (
        /* ── Split-Pane Sent Orders History Master-Detail View ── */
        ...
      ) : currentTab === 'reorder' ? (
        /* ── Reorder Hub View ── */
        ...
```
(i.e. `sent-history` now falls through directly to the renamed Reorder Hub block from Task 3, with the old ~470-line workspace view removed entirely between them.)

- [ ] **Step 2: Relocate the "Reorder All for Today" button into the Supplier PO Grouping header**

The deleted block contained this button (do not lose this functionality):
```tsx
                <button
                  type="button"
                  onClick={() => handleToggleAllPreviousItems(true)}
                  disabled={previousOrderItemsInfo.length === 0 || previousOrderItemsInfo.every(x => x.isChecked)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold transition-all active:scale-95 text-xs disabled:opacity-40 shadow-sm cursor-pointer"
                  title="Select all previous medicines to include in today's active dispatch"
                >
                  <Check size={13} />
                  <span>Reorder All for Today</span>
                </button>
```

In the default (Supplier PO Grouping / "Pharmarack Cart") tab's header, find the existing refresh/send button group (around what was line 3692-3710 before Task 3's edits, identifiable by the `handleManualRefresh` and `handleSendAllWhatsAppOrders` buttons):
```tsx
            <div className="flex items-center gap-2">
              <button
                onClick={handleManualRefresh}
                ...
              </button>

              <button
                onClick={() => handleSendAllWhatsAppOrders()}
                ...
```

Add the relocated button as the first child of that `<div className="flex items-center gap-2">`:
```tsx
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleToggleAllPreviousItems(true)}
                disabled={previousOrderItemsInfo.length === 0 || previousOrderItemsInfo.every(x => x.isChecked)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold transition-all active:scale-95 text-xs disabled:opacity-40 shadow-sm cursor-pointer"
                title="Select all previous medicines to include in today's active dispatch"
              >
                <Check size={13} />
                <span>Reorder All ({previousOrderItemsInfo.length})</span>
              </button>

              <button
                onClick={handleManualRefresh}
                ...
              </button>
              ...
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no new errors. In particular, confirm there are no remaining references to the deleted block's now-orphaned local variables (this block did not define any state/handlers used elsewhere — `previousOrderItemsInfo` and `handleToggleAllPreviousItems` are defined at the top of the component and are used by both the deleted block and elsewhere, so they must NOT be deleted, only the JSX block that rendered them as a full tab).

- [ ] **Step 4: Manual UI test**

Navigate to `/pharmarack-cart`, confirm there is no more "Reorder Cart" workspace with the "Educational Restocking Lifecycle Progression Bar"; confirm the Supplier PO Grouping tab's header now shows a "Reorder All" button that bulk-checks stale previous-day cart items.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PharmarackCart/index.tsx
git commit -m "refactor: remove old Reorder Cart workspace tab, relocate bulk-select button to Supplier PO Grouping"
```

---

### Task 5: Frontend — remove the Non-Mapped Distributors tab

**Files:**
- Modify: `frontend/src/pages/PharmarackCart/index.tsx`

- [ ] **Step 1: Remove the import**

Delete:
```typescript
import NonMappedDistributors from '../NonMappedDistributors';
```

- [ ] **Step 2: Remove the tab block**

Delete:
```tsx
      {currentTab === 'non-mapped' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-glass-bg border border-glass-border rounded-3xl p-6">
          <NonMappedDistributors />
        </div>
      ) : currentTab === 'sent-history' ? (
```
Replace with just:
```tsx
      {currentTab === 'sent-history' ? (
```
(i.e. the ternary chain's first branch is now `sent-history` — the outermost `{` and the rest of the chain are unaffected.)

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PharmarackCart/index.tsx
git commit -m "refactor: remove Non-Mapped Distributors tab from PharmarackCart"
```

---

### Task 6: Frontend — update the top navigation bar (PharmarackCartCalendar)

**Files:**
- Modify: `frontend/src/components/PharmarackCartCalendar.tsx`
- Modify: `frontend/src/pages/PharmarackCart/index.tsx` (the component's usage site)

**Interfaces:**
- `PharmarackCartCalendarProps` loses `shortageCount`; `reorderCount` now carries the merged Reorder Hub total.

- [ ] **Step 1: Simplify the props interface**

In `frontend/src/components/PharmarackCartCalendar.tsx`, change:
```typescript
interface PharmarackCartCalendarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  hasUnreadSentHistory?: boolean;
  activeCount?: number;
  reorderCount?: number;
  shortageCount?: number;
}
```
to:
```typescript
interface PharmarackCartCalendarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  hasUnreadSentHistory?: boolean;
  activeCount?: number;
  reorderCount?: number;
}
```
and update the destructured props (remove `shortageCount = 0,`):
```typescript
export const PharmarackCartCalendar: React.FC<PharmarackCartCalendarProps> = ({
  currentTab,
  onTabChange,
  hasUnreadSentHistory = false,
  activeCount = 0,
  reorderCount = 0,
}) => {
```

- [ ] **Step 2: Fix the Reorder Hub tab button's badge/title and delete the Demands & Shortages tab**

Replace the "Tab 1: Reorder Hub" button:
```tsx
          {/* Tab 1: Reorder Hub */}
          <button
            type="button"
            onClick={() => onTabChange('reorder')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'reorder' || (!currentTab && activeCount === 0)
                ? 'bg-amber-500/20 text-amber-400 font-black shadow-xs border border-amber-500/40'
                : reorderCount > 0
                  ? 'text-amber-400 hover:bg-amber-500/10'
                  : 'text-muted hover:text-text hover:bg-bg3'
            }`}
            title="Review medicines requiring reorder with previous purchase history"
          >
            <Clock size={13} className={currentTab === 'reorder' || reorderCount > 0 ? 'text-amber-400' : 'text-muted'} />
            <span>Reorder Hub</span>
            {reorderCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/40 font-mono font-bold">
                {reorderCount}
              </span>
            )}
          </button>
```
with:
```tsx
          {/* Tab 1: Reorder Hub */}
          <button
            type="button"
            onClick={() => onTabChange('reorder')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'reorder'
                ? 'bg-amber-500/20 text-amber-400 font-black shadow-xs border border-amber-500/40'
                : reorderCount > 0
                  ? 'text-amber-400 hover:bg-amber-500/10'
                  : 'text-muted hover:text-text hover:bg-bg3'
            }`}
            title="Customer requests, refills due, sales-weighted restock suggestions, and recently ordered medicines"
          >
            <Clock size={13} className={currentTab === 'reorder' || reorderCount > 0 ? 'text-amber-400' : 'text-muted'} />
            <span>Reorder Hub</span>
            {reorderCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/40 font-mono font-bold">
                {reorderCount}
              </span>
            )}
          </button>
```

Then delete the entire "Tab 3: Restock & Shortages" button block:
```tsx
          {/* Tab 3: Restock & Shortages */}
          <button
            type="button"
            onClick={() => onTabChange('shortages')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'shortages'
                ? 'bg-bg2 text-primary font-black shadow-xs border border-border'
                : 'text-muted hover:text-text hover:bg-bg3'
            }`}
            title="Special Patient Shortage Requests, Refills Due, and Sales Restock Suggestions"
          >
            <Building2 size={13} className={currentTab === 'shortages' ? 'text-primary' : 'text-muted'} />
            <span>Demands & Shortages</span>
            {shortageCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-sky-500/15 text-sky-400 border border-sky-500/20 font-mono font-bold">
                {shortageCount}
              </span>
            )}
          </button>
```

And delete the entire "Tab 5: Non-Mapped Distributors" button block:
```tsx
          {/* Tab 5: Non-Mapped Distributors */}
          <button
            type="button"
            onClick={() => onTabChange('non-mapped')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'non-mapped'
                ? 'bg-bg2 text-primary font-black shadow-xs border border-border'
                : 'text-muted hover:text-text hover:bg-bg3'
            }`}
          >
            <Building2 size={13} className={currentTab === 'non-mapped' ? 'text-primary' : 'text-muted'} />
            <span>Distributor Catalogs</span>
          </button>
```

- [ ] **Step 3: Update the usage site to stop passing `shortageCount` and merge the count into `reorderCount`**

In `frontend/src/pages/PharmarackCart/index.tsx`, find:
```tsx
      <PharmarackCartCalendar
        currentTab={currentTab}
        onTabChange={(tab) => {
          setSearchParams({ tab });
          if (tab === 'sent-history') setHasUnreadSentHistory(false);
        }}
        hasUnreadSentHistory={hasUnreadSentHistory}
        activeCount={distributors.reduce((acc, d) => acc + (d.items || []).filter(i => isItemIncludedInDispatch(i, d) && !isItemAlreadySent(i, d)).length, 0)}
        reorderCount={previousOrderItemsInfo.length}
        shortageCount={visiblePendingOrders.length + visiblePendingRefills.length + reorderSuggestions.length}
      />
```
replace with:
```tsx
      <PharmarackCartCalendar
        currentTab={currentTab}
        onTabChange={(tab) => {
          setSearchParams({ tab });
          if (tab === 'sent-history') setHasUnreadSentHistory(false);
        }}
        hasUnreadSentHistory={hasUnreadSentHistory}
        activeCount={distributors.reduce((acc, d) => acc + (d.items || []).filter(i => isItemIncludedInDispatch(i, d) && !isItemAlreadySent(i, d)).length, 0)}
        reorderCount={visiblePendingOrders.length + visiblePendingRefills.length + reorderSuggestions.length + reorderRecentItems.length}
      />
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 5: Manual UI test**

Confirm the top nav bar now shows exactly 3 tabs: Reorder Hub, Supplier PO Grouping, Sent PO History — with Reorder Hub's badge reflecting the combined count and opening the merged 4-sub-tab screen.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PharmarackCartCalendar.tsx frontend/src/pages/PharmarackCart/index.tsx
git commit -m "refactor: reduce PharmarackCart nav to 3 tabs, merge reorder/shortage counts"
```

---

### Task 7: Frontend — remove the duplicate sidebar, add inline missing-phone badge

**Files:**
- Modify: `frontend/src/pages/PharmarackCart/index.tsx`

- [ ] **Step 1: Delete the sidebar block**

In the default (Supplier PO Grouping) tab's render, delete the entire left-sidebar block — from the comment `{/* Left Sidebar: Add Pending Order panel */}` through its matching closing `)}`:

```tsx
            {/* Left Sidebar: Add Pending Order panel */}
            {!loading && !error && (
              <div className="w-80 border-r border-glass-border/40 bg-bg2/25 flex flex-col shrink-0 overflow-hidden">
                ... (sidebar tab buttons for all/requests/refills/sales_suggestions/missing_phone,
                     and their panel content, including the phone-number collection form) ...
              </div>
            )}
```

This block's content (the exact text between the opening comment and its matching `)}`) implements the `sidebarTab` state and its 5 sub-views — it is being deleted in full since Requests/Refills/Sales Suggestions now live only in the Reorder Hub tab (Task 3), and the missing-phone collection form is replaced by an inline badge in Step 2 below. After deletion, the "Right Panel: Main live cart contents" div (the very next sibling) becomes the sole child of its parent flex container and will naturally expand to full width.

Also remove the now-unused `sidebarTab` state declaration and its setter (`const [sidebarTab, setSidebarTab] = useState(...)`) — search for its declaration near the top of the component, alongside `pendingFilterTab`-style state.

- [ ] **Step 2: Add an inline missing-phone badge to each distributor card**

Find the distributor card header in the main cards list (inside the `{/* ── Scrollable Distributor Cards Panel ── */}` section, where each distributor's `storeName` is rendered as the card title — search for `dist.storeName` near the top of the per-distributor `.map()` block). Add a badge immediately after the store name that only renders when the phone number is missing:

```tsx
{!getDistributorPhoneNumber(dist) && (
  <button
    type="button"
    onClick={() => handleOpenEditModal(dist)}
    className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all cursor-pointer"
    title="Missing WhatsApp number — click to add"
  >
    <Phone size={9} />
    <span>No Phone</span>
  </button>
)}
```

(`getDistributorPhoneNumber` and `handleOpenEditModal` already exist in this component — Phone icon is already imported at the top of the file.)

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no new errors — in particular confirm no remaining references to `sidebarTab`, `setSidebarTab`, `pendingFilterTab` (if it was only used inside the deleted sidebar), or `customDistributorPhones`/`setCustomDistributorPhones` (if the deleted phone-collection form was their only consumer; if `customDistributorPhones` is still referenced elsewhere, keep its declaration).

- [ ] **Step 4: Manual UI test**

Navigate to the Supplier PO Grouping tab, confirm the left sidebar is gone and the distributor cards use the full width; confirm a distributor with no saved phone number shows the "No Phone" badge next to its name, and clicking it opens the existing edit modal.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PharmarackCart/index.tsx
git commit -m "refactor: remove duplicate sidebar from Supplier PO Grouping, add inline missing-phone badge"
```

---

### Task 8: Frontend — update Sales Restock cards to the simplified template and configured window

**Files:**
- Modify: `frontend/src/pages/PharmarackCart/index.tsx`

**Interfaces:**
- Consumes: the reorder-suggestions response shape from the backend plan's Task 3 (`sixMonthTotalSales`, `sixMonthTotalPurchases`, `currentStock`, `suggestedQty`, `isHotMover`, `isLowStockSafety`, `monthlyWeightedConsumption` — field names unchanged from before, only their meaning now reflects the configured window).

- [ ] **Step 1: Fetch and display the configured window label**

Near the top of the component, add a small piece of state and fetch it once on mount:

```typescript
  const [reorderWindowMonths, setReorderWindowMonths] = useState(2);
```

In the same `useEffect` that already fetches `storeInfo`/settings on mount, add:
```typescript
    apiClient.get('/settings').then(res => {
      const val = parseInt(res.data?.pharmarack_reorder_window_months || '2', 10);
      if ([2, 4, 6, 8].includes(val)) setReorderWindowMonths(val);
    }).catch(() => {});
```
(If the existing settings fetch already returns the full settings object under a different variable, read `pharmarack_reorder_window_months` from that object instead of issuing a second request — check the existing `storeInfo`-loading effect first and reuse its response if present.)

- [ ] **Step 2: Simplify the card template**

Replace the existing Sales Restock card body:
```tsx
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-xs text-text">{sug.medicineName}</span>
                          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {sug.isHotMover ? '🔥 Hot Mover' : '⚠️ Low Stock'}
                          </span>
                        </div>

                        <div className="text-xs text-muted space-y-1">
                          {sug.company && <div>Company: <strong className="text-text">{sug.company}</strong></div>}
                          <div>Current Stock: <strong className="text-rose-400 font-mono">{sug.currentStock}</strong> | Monthly Avg: <strong className="text-text font-mono">{sug.monthlyWeightedConsumption}</strong></div>
                          <div>Suggested Top-up: <strong className="text-emerald-400 font-mono font-bold">{sug.suggestedQty}</strong></div>
                        </div>
                      </div>
```
with:
```tsx
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-xs text-text">{sug.medicineName}</span>
                          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {sug.isHotMover ? '🔥 Hot Mover' : '⚠️ Low Stock'}
                          </span>
                        </div>

                        <div className="text-xs text-muted space-y-1">
                          <div>📊 Past {reorderWindowMonths} {reorderWindowMonths === 1 ? 'Month' : 'Months'} Sold: <strong className="text-text font-mono">{sug.sixMonthTotalSales}</strong> units</div>
                          <div>📦 Current Stock: <strong className="text-rose-400 font-mono">{sug.currentStock}</strong> strips</div>
                          <div>Need: <strong className="text-emerald-400 font-mono font-bold">{sug.suggestedQty}</strong> qty</div>
                        </div>
                      </div>
```

- [ ] **Step 3: Upgrade the snooze control from a single 7-day button to 7d/30d/permanent**

Replace:
```tsx
                        <button
                          type="button"
                          onClick={async () => {
                            await api.snoozeReorderSuggestion(sug.medicineId, 7, '7_days');
                            fetchReorderSuggestions();
                            toastEvent.trigger(`Snoozed ${sug.medicineName} for 7 days`, 'info');
                          }}
                          className="p-1.5 rounded-xl bg-bg2 hover:bg-bg3 border border-glass-border text-muted hover:text-text text-xs transition-all cursor-pointer"
                          title="Snooze for 7 days"
                        >
                          7d
                        </button>
```
with:
```tsx
                        <select
                          onChange={async (e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const [days, type] = val === '7' ? [7, '7_days'] : val === '30' ? [30, '30_days'] : [3650, 'permanent'];
                            await api.snoozeReorderSuggestion(sug.medicineId, days as number, type as string);
                            fetchReorderSuggestions();
                            toastEvent.trigger(`Snoozed ${sug.medicineName}${type === 'permanent' ? ' permanently' : ` for ${days} days`}`, 'info');
                            e.target.value = '';
                          }}
                          defaultValue=""
                          className="p-1.5 rounded-xl bg-bg2 hover:bg-bg3 border border-glass-border text-muted hover:text-text text-[10px] transition-all cursor-pointer"
                          title="Ignore this suggestion"
                        >
                          <option value="" disabled>Ignore…</option>
                          <option value="7">7 days</option>
                          <option value="30">30 days</option>
                          <option value="permanent">Permanently</option>
                        </select>
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 5: Manual UI test**

Open the Reorder Hub's Sales Restock sub-tab, confirm cards show "Past N Months Sold", "Current Stock", "Need" in the simplified layout, and the Ignore dropdown offers 7 days / 30 days / Permanently.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/PharmarackCart/index.tsx
git commit -m "refactor: simplify Sales Restock card template and add 7d/30d/permanent snooze"
```

---

## Post-plan verification

- [ ] `cd frontend && npx tsc --noEmit -p .` clean.
- [ ] Manual: `/pharmarack-cart` shows exactly 3 top-level tabs (Supplier PO Grouping, Reorder Hub, Sent PO History).
- [ ] Manual: Reorder Hub shows 4 sub-tabs (Special Requests, Refills Due, Sales Restock, Ordered Recently) with correct counts, and every card's add action opens a manual picker/search — never auto-adds.
- [ ] Manual: Supplier PO Grouping tab has no left sidebar; distributor cards use full width; a distributor with no phone shows the inline "No Phone" badge.
- [ ] Manual: adding a medicine via any Reorder Hub group, then checking the Supplier PO Grouping tab, confirms the item landed in the correct distributor's card.
- [ ] Per project memory on this repo's test suite: judge overall health by the areas touched here plus `tsc`, not by pre-existing unrelated jest failures.
