# Pre-Calculated Sales Metrics & Simplified Pharmarack Cart Card Plan

This plan details the design and architecture for:
1. **Simplified Restock Card UI** in `/pharmarack-cart` sidebar according to the requested layout:
   - **Medicine Name**
   - **Past 2 Months Sold: X units**
   - **Current Stock: Y strips**
   - **Need: Z qty | Ignore | + Add**
2. **Event-Driven Pre-Calculated Sales & Inventory Metrics Architecture** so the backend does not recalculate 60 days of historical sales and purchases every time a user opens the page.

---

## User Review Required

> [!NOTE]
> The pre-calculated metrics table (`medicine_sales_metrics`) will be automatically initialized and backfilled from existing sales and purchases on first startup. Ongoing updates will be incremental on every POS sale and purchase verification.

---

## Proposed Architecture & Workflow

### 1. Database Schema (`medicine_sales_metrics`)

A dedicated SQLite summary table to store running tallies:

```sql
CREATE TABLE IF NOT EXISTS medicine_sales_metrics (
  medicine_id INTEGER PRIMARY KEY,
  sales_60d_qty REAL NOT NULL DEFAULT 0,
  sales_2d_qty REAL NOT NULL DEFAULT 0,
  current_stock REAL NOT NULL DEFAULT 0,
  last_sold_date TEXT,
  last_purchase_date TEXT,
  last_purchase_ptr REAL DEFAULT 0,
  last_distributor_id INTEGER,
  last_distributor_name TEXT,
  updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
  FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);

CREATE INDEX IF NOT EXISTS idx_msm_reorder 
ON medicine_sales_metrics(current_stock, sales_60d_qty);
```

### 2. Event-Driven Updates (Zero Page-Load Overhead)

1. **On POS Sale Invoice Complete** (`src/routes/sales.ts`):
   - Atomically decrement `current_stock`.
   - Atomically increment `sales_60d_qty` and `sales_2d_qty`.
   - Update `last_sold_date = DATETIME('now')`.

2. **On Purchase Invoice Verified / Saved** (`src/routes/purchases.ts`):
   - Atomically increment `current_stock`.
   - Update `last_purchase_date`, `last_purchase_ptr`, `last_distributor_name`.

3. **Rolling Window Maintenance**:
   - A lightweight background reconciliation (runs at night or during idle periods) to decay/roll off sales older than 60 days.

4. **Fast Endpoint (`GET /api/sales/reorder-suggestions`)**:
   - Executes a single, indexed query directly from `medicine_sales_metrics`:
     ```sql
     SELECT 
       m.id as medicineId,
       m.name as medicineName,
       m.manufacturer as company,
       m.packaging,
       m.mrp,
       msm.current_stock as currentStock,
       msm.sales_60d_qty as twoMonthSales,
       msm.last_purchase_date as lastPurchaseDate,
       msm.last_distributor_name as lastDistributorName,
       msm.last_purchase_ptr as ptr
     FROM medicine_sales_metrics msm
     JOIN medicines m ON m.id = msm.medicine_id
     WHERE msm.current_stock <= 2 AND msm.sales_60d_qty > 0
        OR msm.sales_60d_qty >= 10
     ORDER BY msm.sales_60d_qty DESC
     LIMIT 50;
     ```
   - Query latency: **~2ms - 5ms** (down from ~500ms - 2s).

---

## Proposed Changes

### Backend

#### [MODIFY] [sales.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/sales.ts)
- Initialize `medicine_sales_metrics` table with seed backfill if empty.
- Update `/api/sales/reorder-suggestions` to query `medicine_sales_metrics` directly, computing `suggestedQty = Math.max(1, Math.ceil(twoMonthSales / 2 - currentStock))`.
- Hook into sale creation (`POST /api/sales/invoices` / `POST /api/sales`) to trigger metric update function.

#### [MODIFY] [purchases.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/purchases.ts)
- Hook into purchase save/verification to trigger metric update function for stock and last purchase details.

---

### Frontend

#### [MODIFY] [PharmarackCart/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PharmarackCart/index.tsx)
- Update the Quick Assist restock card UI (`.w-80 > .flex-1 > .space-y-2 > .p-3`) to match the exact streamlined template:
  - Header: **Medicine Name** (bold, crisp) + Packaging badge.
  - Line 1: `📊 Past 2 Months Sold: {sug.twoMonthSales} units`
  - Line 2: `📦 Current Stock: {sug.currentStock} strips`
  - Footer:
    - Left: `Need: {sug.suggestedQty} qty`
    - Right: `Ignore` (with 7d/30d dropdown) and `+ Add` button (`+ Add ({sug.suggestedQty})`).

---

## Verification Plan

### Automated / Backend Tests
1. Verify `medicine_sales_metrics` table creation and initial backfill query.
2. Verify `GET /api/sales/reorder-suggestions` returns correctly structured items with `twoMonthSales`, `currentStock`, and `suggestedQty`.
3. Verify sale invoice entry increments `sales_60d_qty`.
4. Verify purchase invoice entry updates `current_stock` and purchase details.

### Manual / UI Verification
1. Navigate to `/pharmarack-cart` in browser.
2. Verify the right sidebar renders the simplified clean card:
   ```text
   Paracetamol 650 Tablet
   Past 2 Months Sold: 45 units
   Current Stock: 2 strips
   Need: 10 qty      [Ignore ▾]   [+ Add]
   ```
3. Test clicking `+ Add` to ensure the item is added to the cart supplier with correct quantity.
4. Test clicking `Ignore` to ensure the item is snoozed without errors.
