# 📄 POS Page — Point of Sale

**File**: `frontend/src/pages/POS/index.tsx`
**Route**: `/pos` (default landing page)
**Risk Level**: 🔴 HIGH — writes to `inventory` and `sales` tables

---

## What This Page Does

The POS is the pharmacy's main billing screen. The pharmacist:
1. Searches for medicines using the autocomplete (powered by in-memory cache)
2. Adds items to a cart with quantity, discount, batch selection
3. Selects a patient (optional) and doctor (optional)
4. Finalises the bill → creates a sale invoice + deducts stock from inventory
5. Optionally prints the bill

---

## Data Flow

```
ON MOUNT
  api.getCompactInventory()  →  loads window.__INVENTORY__
  (module-level cache, shared with Purchases page)

USER TYPES in search box
  fuzzy.ts search over compactInventoryCache  →  instant results (no HTTP)
  if cache miss: api.searchMedicine(q)        →  GET /api/sales/search-medicine

USER ADDS MEDICINE
  api.getMedicineQuickDetails(id)  →  GET /api/medicines/:id/quick-details
  Shows batches, MRP, stock per batch

USER CLICKS "COMPLETE SALE"
  api.createSale(data)  →  POST /api/sales
  On success:
    invalidateAfterStockWrite(queryClient)  →  stale-marks 10 query keys
    api.getCompactInventory()               →  rebuilds in-memory search cache
    toastEvent.trigger("Sale complete")

USER CLICKS "HOLD BILL"
  api.holdBill(data)  →  POST /api/sales/hold
  (does NOT deduct stock — just stores cart state)

USER CLICKS "QUICK EDIT MEDICINE" (pencil icon on item)
  Opens: UniversalMedicineEditModal
  On save: invalidateAfterStockWrite + cache rebuild
```

---

## What Other Pages See After a Sale

| Page | Effect |
|------|--------|
| **Sells** | New invoice appears in list |
| **Dashboard** | Today's revenue, units sold updates |
| **Inventory** | Reduced stock quantities |
| **Investigation** | New audit trail entry for that batch |
| **Reports** | Sales totals change |
| **CRM** | If patient linked, history updates |

---

## Key State Variables

| Variable | Purpose |
|----------|---------|
| `cart` | Array of cart items being billed |
| `heldBills` | Bills on hold (fetched on mount) |
| `selectedPatient` | Linked CRM patient |
| `selectedDoctor` | Linked doctor (for combo tracking) |
| `showQuickEdit` / `quickEditId` | Controls UniversalMedicineEditModal |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Alt+E` / `F8` | Open Quick Edit Medicine for focused item |
| `X` | Open AI Camera |
| `F2` | Hold bill |
| `Enter` | Confirm/move to next field |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/medicines/compact` | Build autocomplete cache |
| GET | `/api/medicines/:id/quick-details` | Batch/MRP info per item |
| GET | `/api/sales/search-medicine?q=` | Fallback search |
| GET | `/api/sales/suggest-medicine?q=` | Fuzzy suggestions |
| GET | `/api/sales/hold` | Fetch held bills |
| POST | `/api/sales` | Create sale |
| POST | `/api/sales/hold` | Hold current bill |
| POST | `/api/sales/hold/:id/restore` | Restore held bill |

---

## Shared Components Used

- `UniversalMedicineEditModal` — quick-edit any medicine in the cart
- `AICamera` — scan a barcode/image to add medicine
- `HoverPriceIntelTable` — price intelligence popup
- `PriceIntelPanel` — full price comparison drawer

---

## ⚠️ Agent Notes — Do NOT Break

- The `compactInventoryCache` in `api.ts` is a module-level singleton. If you reset it without calling `getCompactInventory()`, the autocomplete goes blank for ALL pages.
- `createSale` debits `inventory.quantity`. If you change the payload shape, verify the backend SQL still runs correctly.
- Doctor–combination tracking: `pos-common-combinations` query key must remain in `cacheInvalidation.ts`.
- The POS has module-level caching variables outside React state — do NOT convert them to `useState` (causes remount lag).
