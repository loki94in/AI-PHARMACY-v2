# 🧩 Shared Components

> Components used by MULTIPLE pages. Changing any of these affects every page that uses them.

---

## UniversalMedicineEditModal

**File**: `frontend/src/components/UniversalMedicineEditModal.tsx`
**Used By**: POS, Sells, Purchases, Inventory, Database

### What It Does
A full-screen modal for editing a medicine's master record + primary batch quantity.

### Fields Editable
| Field | DB Column | Table |
|-------|-----------|-------|
| Medicine Name | `medicines.name` | medicines |
| Generic Name | `medicines.generic_name` | medicines |
| Manufacturer | `medicines.manufacturer` | medicines |
| Marketed By | `medicines.marketed_by` | medicines |
| Pack Size | `medicines.packaging` | medicines |
| Pack Unit | `medicines.pack_unit` | medicines |
| Barcode / Item Code | `medicines.item_code` | medicines |
| Category | `medicines.category` | medicines |
| Notes / Composition | `medicines.api_reference` | medicines |
| Primary Batch Qty | `inventory.quantity` | inventory |
| Rack Location | `inventory.rack_location` | inventory |

### API Used
- `GET /api/inventory/medicines/:id/quick-edit` — load data
- `PUT /api/inventory/medicines/:id/quick-edit` — save (dual-write)

### On Save
```
invalidateAfterStockWrite(queryClient)
api.getCompactInventory()  →  rebuild POS cache
onSave()  →  callback to parent page
onClose() →  close modal
```

### Props
```typescript
interface Props {
  medicineId: number;  // which medicine to edit
  onClose: () => void; // close the modal
  onSave: () => void;  // called after successful save
}
```

### ⚠️ Agent Notes
- Do NOT add sale/purchase fields here. This modal edits medicine MASTER only.
- Autocomplete for Manufacturer and Marketed By uses `api.getManufacturers()` and `api.getMarketedBy()` — do not remove the suggestion dropdowns.
- After any save here, BOTH React Query invalidation AND `getCompactInventory()` must run — do not remove either.

---

## Layout.tsx

**File**: `frontend/src/components/Layout.tsx`
**Role**: Shell wrapper for the entire app

### What It Contains
- Sidebar navigation
- Toast notification system (listens for `app-show-toast`)
- QuickOrderModal (listens for `app-open-quick-order`)
- LiveCartAddModal (listens for `app-open-live-cart-add`)
- StagedReviewModal (for mobile sync review)
- SSE connection (Server-Sent Events for real-time updates)
- WhatsApp status badge
- Admin remote mode banner
- Notification/alert badges

### ⚠️ Agent Notes
- A crash in Layout.tsx breaks the ENTIRE app — test any change here thoroughly.
- Toast system is window-event-based. Do NOT render toasts inside individual pages.
- SSE is connected once in Layout — do not open additional SSE connections in child pages.
- LiveCartAddModal and QuickOrderModal are rendered here, not inside pages — they are global modals.

---

## LiveCartAddModal

**File**: `frontend/src/components/LiveCartAddModal.tsx`
**Used By**: Layout.tsx (triggered from PhoneSales, MessageListener)

### What It Does
A mini-POS cart for processing phone/WhatsApp orders without navigating to POS.

### ⚠️ Agent Notes
- On sale completion: calls `invalidateAfterStockWrite(queryClient)` + `api.getCompactInventory()`
- Same billing logic as POS — keep in sync if POS billing logic changes.

---

## QuickOrderModal

**File**: `frontend/src/components/QuickOrderModal.tsx`
**Used By**: Layout.tsx (triggered from Purchases page button)

### What It Does
Quick-access distributor reorder from any page without going to Purchases.

---

## StagedReviewModal

**File**: `frontend/src/components/StagedReviewModal.tsx`
**Used By**: Layout.tsx

### What It Does
Reviews sales/purchases submitted from mobile devices in offline mode, before they are committed to the live DB.

---

## DateRangeFilter

**File**: `frontend/src/components/DateRangeFilter.tsx`
**Used By**: Sells, Returns, Reports, PurchaseHistory

### What It Does
A reusable date range picker that emits `{ from, to }` to the parent.

### ⚠️ Agent Notes
- Format: `YYYY-MM-DD` strings. Do not change to timestamps or Date objects.
- Used across multiple pages — changes here affect all of them.

---

## InfiniteScrollStatus

**File**: `frontend/src/components/InfiniteScrollStatus.tsx`
**Used By**: Sells, Inventory, PurchaseHistory, Investigation

### What It Does
Shows "Loading more...", "End of list", or error states at the bottom of infinite scroll lists.
