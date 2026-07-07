# POS Medicine Section: Compact Batch/Expiry, Margin%, Substitutes Ticker

## Context

The user shared a reference pharmacy billing screenshot and wants three specific elements from it adopted into the existing POS cart table (`frontend/src/pages/POS/index.tsx`), without a full visual overhaul:

1. Compact inline batch/expiry tag (replacing two separate table columns)
2. A Margin% column
3. A substitutes ticker bar above the cart table

Explicitly out of scope: row color-coding (red/yellow highlighting) from the reference — declined by the user.

## Current State

The cart table (`index.tsx:2223-2599`) has these columns: Medicine | Batch | Expiry | Strip | Loose | Live Stock | Disc% | MRP | Total | (actions).

- Each cart item already carries `mrp` and `costPrice`, so margin% is a pure derived value — no backend change needed.
- The Batch column is an input that, on focus, fetches all batches for the medicine name (`api.searchMedicine`) and shows a switcher dropdown (`rowBatchesList`/`activeBatchRowId` state, `index.tsx:2369-2450`).
- The Expiry column is a read-only badge, amber-highlighted when within 90 days (`expBadgeClass` logic, `index.tsx:2242-2257`).
- `fetchDetailsAndAddToCart` (`index.tsx:1083-1116`) already fetches `details.alternatives` from `api.getMedicineQuickDetails` and passes it into `addToCart`, but `addToCart` (`index.tsx:942-1041`) never stores `alternatives` on the resulting cart item — it's discarded today.

## Design

### 1. Compact batch/expiry tag

Remove the standalone "Batch" and "Expiry" `<th>`/`<td>` columns. Under the medicine name in the Medicine column, add a small mono pill: `{batch} · {expiry}`, reusing the existing amber near-expiry threshold on the expiry portion only. Clicking the pill opens the same batch-switcher dropdown that exists today (same state, same fetch-on-open behavior, same "Switch Batch" list) — just anchored to the pill instead of a dedicated input. No behavior is removed, only repositioned, so the manual-entry lockout (`readOnly`, blocked paste/keys) carries over unchanged.

### 2. Margin% column

New read-only column inserted after "Live Stock" and before "Disc %" (matching the reference's column order). Computed inline per row:

```
marginPct = item.mrp > 0 ? ((item.mrp - (item.costPrice || 0)) / item.mrp) * 100 : 0
```

Displayed as `XX.XX%`, muted/bold text to match existing numeric columns. If `marginPct < 0` (selling below cost), render in the existing `text-red` token as a warning signal — this is a per-cell color, not the row-level highlighting the user declined. No new state or API calls.

### 3. Substitutes ticker bar (cart-scoped)

A horizontal scrollable strip inserted between the cart tab bar and the table's `<thead>`. Behavior:

- Cart items need to retain `alternatives` going forward: add `alternatives: med.alternatives || []` when constructing the new item object in `addToCart` (`index.tsx:1001-1016`), sourced from the same `med.alternatives` `fetchDetailsAndAddToCart` already passes in.
- The ticker aggregates, across all non-empty cart rows, every alternative with `alternatives.length > 0`, deduped by `medicine_id`.
- Each chip shows: name (truncated), `S:{stock}`, and the alternative's own margin% (same formula as above, computed from the alternative's `mrp`/`cost_price`).
- Clicking a chip swaps that specific cart row's medicine to the alternative, reusing the existing `changeRowMedicine`/`fetchDetailsAndChangeRowMedicine` flow (same as the row-level "Substitutes Available" list already used in the search dropdown, `index.tsx:2034-2041`) rather than introducing a new swap code path.
- If no cart row has any alternatives, the bar renders nothing (no empty state placeholder).

## Non-goals

- No row background color-coding (red/yellow) — explicitly declined.
- No POS backend/API changes — all three POS features derive from data already available on the client.
- No changes to the "Quick Add" / doctor-suggestion tickers already present below the search box; the new substitutes ticker is a separate bar tied to cart contents, placed above the table.

## Cross-page rollout: Inventory and Sells

The Margin% formula and compact batch/expiry tag should also apply outside POS, scoped per page based on what each page's data and UI already support:

### Inventory (`frontend/src/pages/Inventory/index.tsx`)

- Add Margin% as a **new toggleable column** in the existing column-visibility system (`COL_KEYS`, `visibleCols`, `inv-page-cols` localStorage key, `index.tsx:84-115`), alongside ID/Batch/Expiry/Packs/Loose/MRP/Rack — not forced on.
- `cost_price` is already returned by the list API via `SELECT im.*` (`src/routes/inventory.ts:121,141`) even though the frontend `InventoryItem`/`Medicine` type only declares `purchase_price` (`frontend/src/types/api.ts:24`). Add `cost_price?: number` to `Medicine` in `types/api.ts` so the field is typed instead of accessed as `any`.
- Batch and Expiry stay as separate, independently-toggleable columns — they are not merged into a compact tag here, since collapsing them would remove the existing per-column show/hide granularity that Inventory's column system is built around. This is a deliberate difference from POS and Sells.

### Sells (invoice edit table, `frontend/src/pages/Sells/index.tsx:722-736`)

- Batch and Expiry are two plain, non-toggleable columns here (no column-visibility system to preserve), so they collapse into the same compact `{batch} · {expiry}` tag used in POS, freeing table width.
- Margin% requires a small backend addition first: `GET /sales/:id` (`src/routes/sales.ts:1171-1180`) currently selects `im.batch_no`, `im.expiry_date`, `im.mrp` but not `im.cost_price`. Add `im.cost_price` to that SELECT, and add `cost_price?: number` to the local `SaleItem` interface (`Sells/index.tsx:16-30`).
- Once `cost_price` is present on each item, Margin% is computed the same way as POS: `((mrp - cost_price) / mrp) * 100`, added as a new column in the invoice items table (after Expiry tag, before CD%).

## Non-goals (cross-page)

- No changes to Inventory's or Sells' other data (purchase workflows, invoice totals, PDF/CSV export column sets) beyond adding the Margin% field where noted.
- No change to Inventory's Batch/Expiry column-toggle behavior.

## Testing

Manual verification in the running app (`npm run dev` in `frontend/`):
- Add a medicine with a known near-expiry batch → confirm the compact pill shows amber styling and the switcher dropdown still works.
- Add a medicine with `costPrice` above `mrp` → confirm margin% renders negative and in red.
- Add a medicine known to have alternatives in the DB → confirm it appears in the ticker with correct stock/margin, and clicking it swaps the row.
- Add a medicine with no alternatives → confirm the ticker doesn't render an empty chip for it, and if it's the only cart item, the whole bar is hidden.
- Inventory: toggle the new Margin% column on/off via the existing column menu and confirm values match `(mrp - cost_price) / mrp * 100` for known items; confirm Batch/Expiry toggles are unaffected.
- Sells: open an existing invoice for editing, confirm Batch/Expiry now render as one compact tag, and Margin% shows correct values sourced from the updated `GET /sales/:id` response.
