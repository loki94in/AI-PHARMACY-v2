# 📄 Inventory Page — Stock Management

**File**: `frontend/src/pages/Inventory/index.tsx`
**Route**: `/inventory`
**Risk Level**: 🟡 MED — reads inventory; direct edits affect POS + Dashboard

---

## What This Page Does

Shows the full stock ledger — every batch of every medicine in the pharmacy.
The pharmacist can:
1. Search/filter by medicine name, batch, expiry, rack, MRP
2. View per-batch details (packs, loose, MRP, rack location)
3. Quick-edit any medicine's master record via UniversalMedicineEditModal
4. Add new inventory batches directly
5. See total stock per medicine (aggregated)

---

## Data Flow

```
ON MOUNT
  React Query: ['inventory-list', page, filters]
    api.getInventory(params)  →  GET /api/inventory
  Infinite scroll for large stock lists

USER SEARCHES
  Updates query params → React Query refetches with new params
  Results include: medicine name, batch, expiry, packs, loose, MRP, rack

USER CLICKS "QUICK EDIT MEDICINE"
  Opens: UniversalMedicineEditModal (medicineId)
  Modal loads: GET /api/inventory/medicines/:id/quick-edit
  User edits: name, generic, manufacturer, packaging, quantity, rack
  On save:
    PUT /api/inventory/medicines/:id/quick-edit
    invalidateAfterStockWrite(queryClient)
    api.getCompactInventory()  →  rebuilds POS autocomplete

USER ADDS NEW BATCH
  api.addMedicine(data)  →  POST /api/inventory
  On success: invalidateAfterStockWrite(queryClient)

USER DIRECTLY EDITS STOCK QUANTITY
  api.updateMedicine(id, data)  →  PUT /api/inventory/:id
  On success: invalidateAfterStockWrite(queryClient)
```

---

## What Other Pages See After a Stock Edit Here

| Page | Effect |
|------|--------|
| **POS** | Updated quantities in autocomplete |
| **Dashboard** | Stock value changes |
| **Returns** | Updated expiry/batch data |
| **Investigation** | Audit log entry |

---

## Key State & Query Variables

| Variable | Purpose |
|----------|---------|
| `['inventory-list', search, filters...]` | React Query key for the list |
| `showQuickEdit` / `quickEditMedicineId` | Controls UniversalMedicineEditModal |
| `filters` | { medicine, batch, expiry, rack, mrp, packs, loose } |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/inventory` | Paginated stock list |
| POST | `/api/inventory` | Add new batch |
| PUT | `/api/inventory/:id` | Update batch quantity/details |
| GET | `/api/inventory/medicines/:id/quick-edit` | Load medicine for modal |
| PUT | `/api/inventory/medicines/:id/quick-edit` | Save medicine edits |

---

## Shared Components Used

- `UniversalMedicineEditModal` — central medicine editor

---

## ⚠️ Agent Notes — Do NOT Break

- `getInventory` uses column-specific filter params (packs, loose, mrp, rack). If you add a new filter, pass it as a query param — do NOT filter on the frontend for large datasets.
- `updateQuickEditMedicine` saves to BOTH the `medicines` table (name, generic, etc.) AND the `inventory` table (quantity, rack). This is a dual-write — do not split it.
- After any edit here, `api.getCompactInventory()` must be called to rebuild the POS search cache, otherwise POS users see old names/quantities.
