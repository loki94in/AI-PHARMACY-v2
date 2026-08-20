# Pre-Calculated Reorder Metrics (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live, full-catalog `/api/sales/reorder-suggestions` computation (scans the entire `medicines` table + 3 live aggregate subqueries on every request, 500ms-2s) with a pre-calculated `medicine_sales_metrics` table that is kept fresh by one same-day hook (sale completion) plus a nightly full reconcile, and make the sales-velocity lookback window configurable from Settings (2/4/6/8 months).

**Architecture:** A new standalone service module owns the metrics table, a pure formula function, a same-day delta hook, and a nightly reconcile job (registered via `node-cron` at module load — the existing `imageArchiveService.initJobs()` pattern was found to be dead code, never called anywhere, so this plan registers the cron job directly at import time instead of relying on an external init call). `sales.ts` calls the delta hook once, in the same transaction as its existing stock decrement. `purchases.ts` is not touched — purchase-side metrics are populated solely by the nightly reconcile (see spec §3 for why). The reorder-suggestions endpoint is rewritten to read the pre-calculated table via two narrow, indexed queries instead of a full-table scan.

**Tech Stack:** TypeScript, Express, `sqlite`/`sqlite3` (via existing `dbManager.getConnection()`), `node-cron` (already a dependency), Jest (`node --experimental-vm-modules`).

**Spec:** [docs/superpowers/specs/2026-08-19-pharmarack-cart-simplification-design.md](../specs/2026-08-19-pharmarack-cart-simplification-design.md) — sections 1-4 and 2 (this plan implements the backend half only; the Reorder Hub frontend is a separate plan).

## Global Constraints

- `current_stock` is never stored in `medicine_sales_metrics` — always fetched live, scoped to a narrow candidate list (spec §1). Do not add a `current_stock` column.
- Only `sales.ts` gets a same-day incremental hook. Do not add hooks to `purchases.ts` (spec §3).
- The weighting formula (70% purchases / 30% sales, hot-mover/low-stock-safety flags, suggestedQty branches) must match the existing live implementation exactly except for `windowMonths` replacing the hardcoded `/ 6` — this is a performance change, not a behavior change.
- `pharmarack_reorder_window_months` is one of `2 | 4 | 6 | 8`, default `2`.

---

### Task 1: Metrics service — schema, pure formula, and delta/reconcile functions

**Files:**
- Create: `src/services/medicineSalesMetricsService.ts`
- Test: `tests/medicineSalesMetricsService.test.ts`

**Interfaces:**
- Produces (consumed by Task 2 and Task 4):
  - `ensureMedicineSalesMetricsSchema(db: any): Promise<void>`
  - `applySaleDelta(db: any, medicineId: number, soldQty: number): Promise<void>`
  - `getReorderWindowMonths(dbInstance?: any): Promise<number>`
  - `reconcileAllMedicineSalesMetrics(db: any, windowMonths: number): Promise<void>`
  - `computeReorderSuggestion(metrics: { sales2dQty: number; salesWindowQty: number; purchasesWindowQty: number; currentStock: number }, windowMonths: number): { monthlyWeightedConsumption: number; isHotMover: boolean; isLowStockSafety: boolean; included: boolean; suggestedQty: number }`

- [ ] **Step 1: Write the failing tests for the pure formula function**

```typescript
// tests/medicineSalesMetricsService.test.ts
import { computeReorderSuggestion } from '../src/services/medicineSalesMetricsService.js';

describe('computeReorderSuggestion', () => {
  it('flags a 2-day sales burst as included with qty = 2x the burst', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 5, salesWindowQty: 5, purchasesWindowQty: 0, currentStock: 3 },
      2
    );
    expect(result.included).toBe(true);
    expect(result.isHotMover).toBe(true);
    expect(result.suggestedQty).toBe(10);
  });

  it('flags low-stock-safety when stock is <=2 and there is purchase/sale history', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 0, salesWindowQty: 8, purchasesWindowQty: 0, currentStock: 2 },
      2
    );
    expect(result.included).toBe(true);
    expect(result.isLowStockSafety).toBe(true);
    expect(result.suggestedQty).toBe(8); // 10 - currentStock(2)
  });

  it('uses purchase-weighted monthly consumption when stock is below it', () => {
    // 70% * 20 purchased + 30% * 10 sold = 17, / 2 months = 8.5 -> round = 9
    const result = computeReorderSuggestion(
      { sales2dQty: 0, salesWindowQty: 10, purchasesWindowQty: 20, currentStock: 3 },
      2
    );
    expect(result.monthlyWeightedConsumption).toBe(9);
    expect(result.included).toBe(true);
    expect(result.suggestedQty).toBe(6); // ceil(9 - 3)
  });

  it('excludes a medicine with no recent activity and healthy stock', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 0, salesWindowQty: 0, purchasesWindowQty: 0, currentStock: 50 },
      2
    );
    expect(result.included).toBe(false);
  });

  it('respects a wider configured window in the denominator', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 0, salesWindowQty: 10, purchasesWindowQty: 20, currentStock: 3 },
      8
    );
    // 17 / 8 months = 2.125 -> round = 2; stock(3) > consumption(2) and no other trigger -> excluded
    expect(result.monthlyWeightedConsumption).toBe(2);
    expect(result.included).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/medicineSalesMetricsService.test.ts`
Expected: FAIL — `Cannot find module '../src/services/medicineSalesMetricsService.js'`

- [ ] **Step 3: Create the service file**

```typescript
// src/services/medicineSalesMetricsService.ts
import cron from 'node-cron';
import { dbManager } from '../database/connection.js';

let schemaEnsured = false;

export async function ensureMedicineSalesMetricsSchema(db: any): Promise<void> {
  if (schemaEnsured) return;
  await db.run(`
    CREATE TABLE IF NOT EXISTS medicine_sales_metrics (
      medicine_id INTEGER PRIMARY KEY,
      sales_2d_qty REAL NOT NULL DEFAULT 0,
      sales_window_qty REAL NOT NULL DEFAULT 0,
      purchases_window_qty REAL NOT NULL DEFAULT 0,
      last_sold_date TEXT,
      last_purchase_date TEXT,
      last_purchase_ptr REAL DEFAULT 0,
      last_distributor_id INTEGER,
      last_distributor_name TEXT,
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      FOREIGN KEY (medicine_id) REFERENCES medicines(id)
    )
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_msm_activity
    ON medicine_sales_metrics(sales_window_qty, purchases_window_qty, sales_2d_qty)
  `);
  schemaEnsured = true;
}

/**
 * Same-day freshness hook: call once per sold line item, in the same transaction
 * as the existing inventory_master decrement. Does NOT touch current_stock.
 */
export async function applySaleDelta(db: any, medicineId: number, soldQty: number): Promise<void> {
  if (!medicineId || !soldQty) return;
  await ensureMedicineSalesMetricsSchema(db);
  await db.run(
    `INSERT INTO medicine_sales_metrics (medicine_id, sales_2d_qty, sales_window_qty, last_sold_date, updated_at)
     VALUES (?, ?, ?, DATETIME('now'), DATETIME('now'))
     ON CONFLICT(medicine_id) DO UPDATE SET
       sales_2d_qty = sales_2d_qty + excluded.sales_2d_qty,
       sales_window_qty = sales_window_qty + excluded.sales_window_qty,
       last_sold_date = excluded.last_sold_date,
       updated_at = excluded.updated_at`,
    [medicineId, soldQty, soldQty]
  );
}

export async function getReorderWindowMonths(dbInstance?: any): Promise<number> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_reorder_window_months'");
    const val = row && row.value ? parseInt(row.value, 10) : NaN;
    if ([2, 4, 6, 8].includes(val)) return val;
  } catch (err) {
    console.warn('[MedicineSalesMetrics] Error resolving reorder window months:', err);
  }
  return 2;
}

/** Pure function — no DB access. Mirrors the existing live-scan formula exactly, parameterized by windowMonths. */
export function computeReorderSuggestion(
  metrics: { sales2dQty: number; salesWindowQty: number; purchasesWindowQty: number; currentStock: number },
  windowMonths: number
): { monthlyWeightedConsumption: number; isHotMover: boolean; isLowStockSafety: boolean; included: boolean; suggestedQty: number } {
  const { sales2dQty, salesWindowQty, purchasesWindowQty, currentStock } = metrics;
  const monthlyWeightedConsumption = Math.round((0.70 * purchasesWindowQty + 0.30 * salesWindowQty) / windowMonths);
  const isHotMover = monthlyWeightedConsumption >= 10 || sales2dQty >= 5;
  const isLowStockSafety = currentStock <= 2 && (purchasesWindowQty >= 6 || salesWindowQty >= 6);
  const included = sales2dQty > 0 || isLowStockSafety || (monthlyWeightedConsumption > 0 && currentStock <= monthlyWeightedConsumption);

  let suggestedQty = 1;
  if (monthlyWeightedConsumption > 0) {
    suggestedQty = Math.max(1, Math.ceil(monthlyWeightedConsumption - currentStock));
  } else if (sales2dQty > 0) {
    suggestedQty = Math.max(1, sales2dQty * 2);
  } else if (isLowStockSafety) {
    suggestedQty = Math.max(1, 10 - currentStock);
  }

  return { monthlyWeightedConsumption, isHotMover, isLowStockSafety, included, suggestedQty };
}

/**
 * Correctness backstop: fully re-derives sales_window_qty, purchases_window_qty, sales_2d_qty,
 * and last_purchase_* for every medicine with any activity in the window, directly from
 * sale_items/purchase_items. Fixes drift from edits/deletes/returns that weren't individually hooked.
 */
export async function reconcileAllMedicineSalesMetrics(db: any, windowMonths: number): Promise<void> {
  await ensureMedicineSalesMetricsSchema(db);
  const windowDays = windowMonths * 30;

  const salesRows = await db.all(
    `SELECT im.medicine_id, SUM(si.quantity) as window_qty, MAX(inv.date) as last_sold_date
     FROM sale_items si
     JOIN sales_invoices inv ON si.invoice_id = inv.id
     JOIN inventory_master im ON si.inventory_id = im.id
     WHERE inv.date >= DATETIME('now', ?)
     GROUP BY im.medicine_id`,
    [`-${windowDays} days`]
  );
  const twoDayRows = await db.all(
    `SELECT im.medicine_id, SUM(si.quantity) as two_day_qty
     FROM sale_items si
     JOIN sales_invoices inv ON si.invoice_id = inv.id
     JOIN inventory_master im ON si.inventory_id = im.id
     WHERE inv.date >= DATETIME('now', '-2 days')
     GROUP BY im.medicine_id`
  );
  const purchaseRows = await db.all(
    `SELECT pi.medicine_id, SUM(pi.quantity) as window_qty, MAX(p.date) as last_purchase_date
     FROM purchase_items pi
     JOIN purchases p ON pi.purchase_id = p.id
     WHERE p.date >= DATETIME('now', ?)
     GROUP BY pi.medicine_id`,
    [`-${windowDays} days`]
  );
  const lastPurchaseDetailRows = await db.all(
    `SELECT pi.medicine_id, pi.cost_price as ptr, p.distributor_id, d.name as distributor_name, p.date
     FROM purchase_items pi
     JOIN purchases p ON pi.purchase_id = p.id
     LEFT JOIN distributors d ON d.id = p.distributor_id
     WHERE p.date >= DATETIME('now', ?)
     ORDER BY p.date DESC`,
    [`-${windowDays} days`]
  );
  const lastPurchaseDetailByMed: Record<number, any> = {};
  for (const row of lastPurchaseDetailRows) {
    if (!lastPurchaseDetailByMed[row.medicine_id]) lastPurchaseDetailByMed[row.medicine_id] = row;
  }

  const medicineIds = new Set<number>();
  for (const r of salesRows) medicineIds.add(r.medicine_id);
  for (const r of twoDayRows) medicineIds.add(r.medicine_id);
  for (const r of purchaseRows) medicineIds.add(r.medicine_id);

  const salesByMed = Object.fromEntries(salesRows.map((r: any) => [r.medicine_id, r]));
  const twoDayByMed = Object.fromEntries(twoDayRows.map((r: any) => [r.medicine_id, r]));
  const purchaseByMed = Object.fromEntries(purchaseRows.map((r: any) => [r.medicine_id, r]));

  await db.run('BEGIN IMMEDIATE TRANSACTION');
  try {
    await db.run('DELETE FROM medicine_sales_metrics');
    for (const medId of medicineIds) {
      const sales = salesByMed[medId];
      const twoDay = twoDayByMed[medId];
      const purchase = purchaseByMed[medId];
      const lastPurchase = lastPurchaseDetailByMed[medId];
      await db.run(
        `INSERT INTO medicine_sales_metrics
           (medicine_id, sales_2d_qty, sales_window_qty, purchases_window_qty,
            last_sold_date, last_purchase_date, last_purchase_ptr, last_distributor_id, last_distributor_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now'))`,
        [
          medId,
          Number(twoDay?.two_day_qty || 0),
          Number(sales?.window_qty || 0),
          Number(purchase?.window_qty || 0),
          sales?.last_sold_date || null,
          lastPurchase?.date || null,
          Number(lastPurchase?.ptr || 0),
          lastPurchase?.distributor_id || null,
          lastPurchase?.distributor_name || null
        ]
      );
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    throw err;
  }
}

// Register the nightly reconcile at module load — imageArchiveService's initJobs()
// pattern was found to never actually be called anywhere in this codebase, so this
// registers directly instead of depending on an external init call that might not happen.
cron.schedule('0 3 * * *', async () => {
  try {
    const db = await dbManager.getConnection();
    const windowMonths = await getReorderWindowMonths(db);
    await reconcileAllMedicineSalesMetrics(db, windowMonths);
    console.log('[MedicineSalesMetrics] Nightly reconcile complete.');
  } catch (err) {
    console.error('[MedicineSalesMetrics] Nightly reconcile failed:', err);
  }
});

// Startup backfill: populate immediately on first run instead of waiting for 3am.
(async () => {
  try {
    const db = await dbManager.getConnection();
    await ensureMedicineSalesMetricsSchema(db);
    const row = await db.get('SELECT COUNT(*) as c FROM medicine_sales_metrics');
    if (!row || Number(row.c) === 0) {
      const windowMonths = await getReorderWindowMonths(db);
      await reconcileAllMedicineSalesMetrics(db, windowMonths);
      console.log('[MedicineSalesMetrics] Initial backfill complete.');
    }
  } catch (err) {
    console.error('[MedicineSalesMetrics] Initial backfill failed:', err);
  }
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/medicineSalesMetricsService.test.ts`
Expected: PASS (5 tests) — these are pure-function tests, no DB required, so they are not affected by the pre-existing "no such table" jest setup issues documented for other suites in this repo.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/medicineSalesMetricsService.ts tests/medicineSalesMetricsService.test.ts
git commit -m "feat: add pre-calculated medicine sales metrics service with nightly reconcile"
```

---

### Task 2: Hook sale completion into the existing sale-invoice transaction

**Files:**
- Modify: `src/routes/sales.ts:439-443` (inside the existing per-item loop in `POST /`, right after the existing `recordStockLedger` call)

**Interfaces:**
- Consumes: `applySaleDelta(db, medicineId, soldQty)` from Task 1.

- [ ] **Step 1: Add the import**

At the top of `src/routes/sales.ts`, alongside the other local imports:

```typescript
import { applySaleDelta } from '../services/medicineSalesMetricsService.js';
```

- [ ] **Step 2: Call the hook right after the existing stock-ledger record**

In `src/routes/sales.ts`, the per-item loop inside `router.post('/', ...)` currently reads (around line 439):

```typescript
      await recordStockLedger(db, {
        medicine_id: currentStock.medicine_id, batch_no: currentStock.batch_no,
        quantity: -soldQty, loose_quantity: -soldLoose,
        transaction_type: 'sale', transaction_id: invoiceId
      });
```

Add the metrics hook immediately after it, still inside the same `for (const item of items)` loop and the same open transaction:

```typescript
      await recordStockLedger(db, {
        medicine_id: currentStock.medicine_id, batch_no: currentStock.batch_no,
        quantity: -soldQty, loose_quantity: -soldLoose,
        transaction_type: 'sale', transaction_id: invoiceId
      });
      await applySaleDelta(db, currentStock.medicine_id, soldQty);
```

- [ ] **Step 3: Write an integration test for the hook**

```typescript
// tests/medicineSalesMetricsService.test.ts — add to the existing describe block, or a new one:
import { applySaleDelta, ensureMedicineSalesMetricsSchema } from '../src/services/medicineSalesMetricsService.js';

describe('applySaleDelta', () => {
  it('increments sales_window_qty and sales_2d_qty on repeated calls for the same medicine', async () => {
    const rows: Record<number, any> = {};
    const fakeDb = {
      run: jest.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return;
        if (sql.includes('INSERT INTO medicine_sales_metrics')) {
          const [medicineId, sales2d, salesWindow] = params;
          const existing = rows[medicineId] || { sales_2d_qty: 0, sales_window_qty: 0 };
          rows[medicineId] = {
            sales_2d_qty: existing.sales_2d_qty + sales2d,
            sales_window_qty: existing.sales_window_qty + salesWindow
          };
        }
      })
    };
    await applySaleDelta(fakeDb, 42, 3);
    await applySaleDelta(fakeDb, 42, 2);
    expect(rows[42]).toEqual({ sales_2d_qty: 5, sales_window_qty: 5 });
  });
});
```

- [ ] **Step 4: Run the test**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/medicineSalesMetricsService.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual smoke test**

Start the dev server, complete one POS sale for any medicine, then run:
```bash
sqlite3 <path-to-db> "SELECT * FROM medicine_sales_metrics WHERE medicine_id = <the medicine's id>;"
```
Expected: a row with `sales_window_qty` and `sales_2d_qty` incremented by the sold quantity, `updated_at` just now.

- [ ] **Step 7: Commit**

```bash
git add src/routes/sales.ts tests/medicineSalesMetricsService.test.ts
git commit -m "feat: hook sale completion into medicine sales metrics for same-day freshness"
```

---

### Task 3: Rewrite `GET /api/sales/reorder-suggestions` to read the pre-calculated table

**Files:**
- Modify: `src/routes/sales.ts:2584-2744` (the existing `router.get('/reorder-suggestions', ...)` handler — full replacement of its body, keeping the same route path, the existing snooze-table setup/check at the top, and the same response shape)
- Test: `tests/medicineSalesMetricsService.test.ts` (add reorder-suggestions-shape coverage against `computeReorderSuggestion`, already covered in Task 1 — this task's own test is the manual/API check below since the route itself is thin glue code)

**Interfaces:**
- Consumes: `getReorderWindowMonths(db)` and `computeReorderSuggestion(metrics, windowMonths)` from Task 1.

- [ ] **Step 1: Add the import**

At the top of `src/routes/sales.ts`:

```typescript
import { getReorderWindowMonths, computeReorderSuggestion } from '../services/medicineSalesMetricsService.js';
```

- [ ] **Step 2: Replace the query section of the handler**

In `src/routes/sales.ts`, inside `router.get('/reorder-suggestions', ...)`, the existing snoozed-medicine lookup (lines 2601-2606) stays unchanged. Replace everything from the `// Query 2-Day sales per medicine` comment (line 2608) through the `items.sort(...)` block (line 2737) with:

```typescript
    const windowMonths = await getReorderWindowMonths(db);

    const candidates = await db.all(`
      SELECT m.id as medicine_id, m.name as medicine_name, m.manufacturer as company,
             m.packaging, m.mrp, msm.sales_2d_qty, msm.sales_window_qty, msm.purchases_window_qty
      FROM medicine_sales_metrics msm
      JOIN medicines m ON m.id = msm.medicine_id
      WHERE msm.sales_2d_qty > 0 OR msm.sales_window_qty > 0 OR msm.purchases_window_qty > 0
      ORDER BY msm.sales_window_qty DESC
      LIMIT 500
    `);

    const candidateIds = candidates.map((c: any) => c.medicine_id);
    const stockByMed: Record<number, number> = {};
    if (candidateIds.length > 0) {
      const placeholders = candidateIds.map(() => '?').join(',');
      const stockRows = await db.all(
        `SELECT medicine_id, COALESCE(SUM(quantity), 0) as current_stock
         FROM inventory_master
         WHERE medicine_id IN (${placeholders})
         GROUP BY medicine_id`,
        candidateIds
      );
      for (const row of stockRows) stockByMed[row.medicine_id] = Number(row.current_stock || 0);
    }

    const ptrRows = candidateIds.length > 0
      ? await db.all(
          `SELECT medicine_id, COALESCE(MAX(cost_price), 0) as ptr
           FROM inventory_master WHERE medicine_id IN (${candidateIds.map(() => '?').join(',')})
           GROUP BY medicine_id`,
          candidateIds
        )
      : [];
    const ptrByMed: Record<number, number> = Object.fromEntries(ptrRows.map((r: any) => [r.medicine_id, Number(r.ptr || 0)]));

    const items: any[] = [];
    for (const row of candidates) {
      const medId = Number(row.medicine_id);
      if (snoozedSet.has(medId)) continue;

      const currentStock = Math.max(0, stockByMed[medId] || 0);
      const result = computeReorderSuggestion(
        {
          sales2dQty: Number(row.sales_2d_qty || 0),
          salesWindowQty: Number(row.sales_window_qty || 0),
          purchasesWindowQty: Number(row.purchases_window_qty || 0),
          currentStock
        },
        windowMonths
      );

      if (!result.included) continue;

      items.push({
        medicineId: medId,
        medicineName: row.medicine_name,
        company: row.company || '',
        packaging: row.packaging || '',
        ptr: ptrByMed[medId] || 0,
        mrp: Number(row.mrp || 0),
        twoDaySales: Number(row.sales_2d_qty || 0),
        sixMonthTotalSales: Number(row.sales_window_qty || 0),
        sixMonthTotalPurchases: Number(row.purchases_window_qty || 0),
        monthlyWeightedConsumption: result.monthlyWeightedConsumption,
        currentStock,
        suggestedQty: result.suggestedQty,
        isHotMover: result.isHotMover,
        isLowStockSafety: result.isLowStockSafety
      });
    }

    items.sort((a, b) => {
      if (a.isLowStockSafety !== b.isLowStockSafety) return a.isLowStockSafety ? -1 : 1;
      if (a.isHotMover !== b.isHotMover) return a.isHotMover ? -1 : 1;
      return b.suggestedQty - a.suggestedQty;
    });
```

The remaining `res.json({ success: true, count: items.length, items })` and the `catch` block below it stay unchanged — they already reference the same `items` variable name.

Note: `sixMonthTotalSales`/`sixMonthTotalPurchases` field names are kept as-is for response-shape compatibility with any existing frontend code reading them, even though they now represent the *configured* window rather than a fixed 6 months; the Reorder Hub frontend plan renames these on the way in.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual API test**

With the dev server running:
```bash
curl http://localhost:5174/api/sales/reorder-suggestions
```
Expected: `{"success":true,"count":N,"items":[...]}` with the same field names as before, returning in well under 100ms (compare against the pre-change response time, which should have been in the hundreds of ms to low seconds).

- [ ] **Step 5: Commit**

```bash
git add src/routes/sales.ts
git commit -m "perf: rewrite reorder-suggestions to read pre-calculated metrics instead of scanning all medicines"
```

---

### Task 4: Configurable reorder window setting (backend)

**Files:**
- Modify: `src/routes/settings.ts:54-83` (the existing `router.post('/', ...)` handler)

**Interfaces:**
- Consumes: `reconcileAllMedicineSalesMetrics(db, windowMonths)` from Task 1.

- [ ] **Step 1: Add the import**

At the top of `src/routes/settings.ts`:

```typescript
import { reconcileAllMedicineSalesMetrics } from '../services/medicineSalesMetricsService.js';
```

- [ ] **Step 2: Trigger a reconcile when the window setting changes**

In `src/routes/settings.ts`, the existing handler body is:

```typescript
router.post('/', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    const db = await dbManager.getConnection();
    const saveValue = key === 'pharmarack_mode' ? 'Live' : (value ?? '');
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, saveValue]);
    // ... existing alias-key sync blocks unchanged ...
    res.json({ success: true, key, value: saveValue });
  } catch (error) {
    console.error('Settings save error:', error);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});
```

Add a check right after the `INSERT OR REPLACE` line and before the alias-key sync blocks:

```typescript
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, saveValue]);

    if (key === 'pharmarack_reorder_window_months') {
      const windowMonths = [2, 4, 6, 8].includes(parseInt(saveValue, 10)) ? parseInt(saveValue, 10) : 2;
      // Fire-and-forget: don't block the settings save response on a full recompute.
      reconcileAllMedicineSalesMetrics(db, windowMonths).catch((err) => {
        console.error('[Settings] Reorder window reconcile failed:', err);
      });
    }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual test**

```bash
curl -X POST http://localhost:5174/api/settings -H "Content-Type: application/json" -d '{"key":"pharmarack_reorder_window_months","value":"6"}'
```
Expected: `{"success":true,"key":"pharmarack_reorder_window_months","value":"6"}` immediately, and within a few seconds the server log shows `[MedicineSalesMetrics] Nightly reconcile complete.` is NOT what prints (that's the cron log) — instead confirm via `sqlite3 <db> "SELECT COUNT(*) FROM medicine_sales_metrics;"` that rows were refreshed (check `updated_at` timestamps are current).

- [ ] **Step 5: Commit**

```bash
git add src/routes/settings.ts
git commit -m "feat: recompute reorder metrics when the reorder window setting changes"
```

---

### Task 5: Settings page UI — reorder window dropdown

**Files:**
- Modify: `frontend/src/pages/Settings/index.tsx` (near the existing "Pharmarack B2B Live Ordering Credentials" section, ~line 1100)

**Interfaces:**
- Consumes: existing `apiClient.post('/settings', { key, value })` pattern already used by every other setting on this page (e.g. `pharmarack_username` save).

- [ ] **Step 1: Add state, initialized from `rawSettings`**

Near the existing `const [pharmarackUser, setPharmarackUser] = useState(rawSettings.pharmarack_username || '');` (around line 793), add:

```typescript
  const [reorderWindowMonths, setReorderWindowMonths] = useState(rawSettings.pharmarack_reorder_window_months || '2');
```

And in the existing effect that resyncs these fields when `rawSettings` changes (around line 833, alongside `setPharmarackUser(rawSettings.pharmarack_username || '')`), add:

```typescript
    setReorderWindowMonths(rawSettings.pharmarack_reorder_window_months || '2');
```

- [ ] **Step 2: Add the save handler**

Add a small dedicated handler near `handleTriggerPharmarackRefresh` (around line 870):

```typescript
  const handleReorderWindowChange = async (months: string) => {
    setReorderWindowMonths(months);
    try {
      await apiClient.post('/settings', { key: 'pharmarack_reorder_window_months', value: months });
      toastEvent.trigger(`Reorder lookback window set to ${months} months`, 'success');
    } catch (err: any) {
      toastEvent.trigger('Failed to save reorder window: ' + err.message, 'error');
    }
  };
```

- [ ] **Step 3: Add the dropdown to the Pharmarack section**

In `frontend/src/pages/Settings/index.tsx`, inside the `{/* Pharmarack B2B */}` block (starting ~line 1100), after the existing username/password fields, add:

```tsx
          <div className="mt-4">
            <label className="block text-xs font-semibold text-text mb-1">Reorder Suggestions Lookback Window</label>
            <select
              value={reorderWindowMonths}
              onChange={(e) => handleReorderWindowChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-bg2 border border-glass-border text-sm text-text"
            >
              <option value="2">2 months</option>
              <option value="4">4 months</option>
              <option value="6">6 months</option>
              <option value="8">8 months</option>
            </select>
            <p className="text-[11px] text-muted mt-1">
              How far back sales/purchase history is weighed for restock suggestions and the "Ordered last" list in the Reorder Hub. Changing this recomputes suggestions in the background.
            </p>
          </div>
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 5: Manual UI test**

Start the dev server, open Settings → Integrations & Credentials, confirm the dropdown shows under the Pharmarack section with the current value selected, change it, and confirm the success toast appears.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Settings/index.tsx
git commit -m "feat: add reorder lookback window setting to Settings page"
```

---

## Post-plan verification

- [ ] `npx tsc --noEmit` (backend) and `cd frontend && npx tsc --noEmit -p .` both clean.
- [ ] `node --experimental-vm-modules node_modules/.bin/jest tests/medicineSalesMetricsService.test.ts` passes.
- [ ] Manual: complete a POS sale, confirm `medicine_sales_metrics` row updates immediately; call `/api/sales/reorder-suggestions` and confirm fast response with correct shape; change the Settings window and confirm a reconcile runs.
- [ ] Per project memory on this repo's test suite: judge overall health by the suites touched here plus `tsc`, not by pre-existing unrelated jest failures ("no such table" setup errors in ~16 other suites are a known, separate issue).
