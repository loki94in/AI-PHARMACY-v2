# 📄 Purchases Page — Supplier Invoice Entry

**File**: `frontend/src/pages/Purchases/index.tsx`
**Route**: `/purchases` (also `/manual-purchase`)
**Risk Level**: 🔴 HIGH — writes to `inventory` and `purchases` tables

---

## What This Page Does

Allows the pharmacist to enter supplier invoices (goods received). This:
1. Creates purchase records with distributor, invoice number, date
2. Adds medicines with batch, expiry, MRP, quantity, rate
3. **Increases inventory stock** for each line item
4. Supports editing and deleting past purchases

Also serves `/manual-purchase` (same component, alternate entry mode).

---

## Data Flow

```
ON MOUNT
  api.getCompactInventory()  →  loads window.__INVENTORY__ (shared with POS)
  api.getDistributors()      →  GET /api/distributors (autocomplete)
  api.getPurchases(params)   →  GET /api/purchases (infinite scroll list)

USER TYPES MEDICINE NAME
  Searches compactInventoryCache locally (instant)
  Falls back to api.catalogSearch(q) → GET /api/inventory/catalog-search

USER ENTERS NEW MEDICINE NOT IN DB
  api.createMedicine(data)  →  POST /api/medicines
  Then re-fetches compact inventory cache

USER SAVES PURCHASE
  api.createPurchase(data)  →  POST /api/purchases
  Backend: inserts purchase + adds inventory rows
  On success:
    invalidateAfterStockWrite(queryClient)
    api.getCompactInventory()  →  rebuilds search cache
    toastEvent.trigger("Purchase saved")

USER EDITS PURCHASE
  api.updatePurchase(id, data)  →  PUT /api/purchases/:id/full
  On success: invalidateAfterStockWrite(queryClient)

USER DELETES PURCHASE
  api.deletePurchase(id)  →  DELETE /api/purchases/:id
  Backend: removes inventory rows added by that purchase

USER CLICKS "QUICK EDIT MEDICINE"
  Opens: UniversalMedicineEditModal
  On save: invalidateAfterStockWrite + cache rebuild
```

---

## What Other Pages See After a Purchase

| Page | Effect |
|------|--------|
| **POS** | More stock available in search |
| **Inventory** | New/increased stock rows |
| **Dashboard** | Purchase cost totals update |
| **Returns** | New batches available for return |
| **Investigation** | New batch audit trail entries |
| **PurchaseHistory** | New entry in ledger |
| **PharmarackCart** | Cart items may resolve against new stock |

---

## Key State & Query Variables

| Variable | Purpose |
|----------|---------|
| `['purchase-history-list', ...]` | React Query key for purchase list |
| `currentInvoice` | Items being entered for current purchase |
| `selectedDistributor` | Current supplier being billed from |
| `showQuickEdit` / `quickEditId` | Controls UniversalMedicineEditModal |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/medicines/compact` | Autocomplete cache |
| GET | `/api/distributors` | Supplier list |
| GET | `/api/purchases` | Paginated purchase list |
| GET | `/api/purchases/:id` | Single purchase detail |
| POST | `/api/purchases` | Create purchase |
| POST | `/api/purchases/manual` | Manual purchase (no invoice) |
| PUT | `/api/purchases/:id/full` | Update full purchase |
| DELETE | `/api/purchases/:id` | Delete purchase |
| GET | `/api/inventory/catalog-search?q=` | Medicine DB search fallback |
| POST | `/api/medicines` | Create new medicine if not found |
| GET | `/api/purchases/last-purchase` | Price intelligence (last buy price) |

---

## Shared Components Used

- `UniversalMedicineEditModal` — edit medicine master mid-entry
- `StagedReviewModal` — review mobile-submitted purchases
- `QuickOrderModal` — quick Pharmarack reorder

---

## ⚠️ Agent Notes — Do NOT Break

- `api.getCompactInventory()` is called after every purchase save — this is mandatory to keep POS autocomplete fresh.
- The `createPurchase` payload includes line items with `inventory_id` references. If you change the schema, update both frontend payload and backend route.
- `/manual-purchase` renders the **same component** as `/purchases` — do not add route-specific logic without checking both routes.
- `batchLastPurchase` is called in bulk on page mount for price intelligence — it is a single batched request, not N individual calls (performance rule).
