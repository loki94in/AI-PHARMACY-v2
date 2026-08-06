# SELL PRICE FEATURE — COMPLETE FIX PLAN

## Status: READY TO IMPLEMENT

---

## PART A: ROOT CAUSE — Discount Not Applying in POS

### Fix 1: Missing `sell_price` in POS Search SQL (PRIMARY FIX)
**File:** `src/routes/sales.ts:1293-1312`
**Problem:** The alphabetical prefix search — the first query tried when a pharmacist types a medicine name — does NOT include `m.sell_price` in its SELECT. So POS search results don't have `sell_price`, auto-discount can't calculate.
**Fix:** Add `m.sell_price,` to the SELECT columns (after line 1311).

### Fix 2: Batch Switching Doesn't Carry `sell_price`/`discount`
**File:** `frontend/src/pages/POS/index.tsx:3406-3418`
**Problem:** When switching batches, `sell_price` and `discount` are not copied to the new batch row.
**Fix:** Add `sell_price: b.sell_price || cItem.sell_price,` and `discount: cItem.discount,` to the cart update.

### Fix 3: Refill Autofill Missing `sell_price`
**File:** `frontend/src/pages/POS/index.tsx:261-273`
**Problem:** Refill auto-fill builds cart items with `discount: 0` and no `sell_price`.
**Fix:** Add `sell_price: matched.sell_price || null,` and auto-calculate discount from sell_price vs MRP.

### Fix 4: CRM Bill-Now Missing `sell_price`
**File:** `frontend/src/pages/POS/index.tsx:382-394`
**Problem:** CRM "Bill Now" builds cart items with `discount: 0` and no `sell_price`.
**Fix:** Add `sell_price: m.sell_price || null,` and auto-calculate discount.

### Fix 5: Refill Accept Missing `sell_price`
**File:** `frontend/src/pages/POS/index.tsx:1053-1065`
**Problem:** Refill accept builds cart items with `discount: 0` and no `sell_price`.
**Fix:** Add `sell_price: matched?.sell_price || null,` and auto-calculate discount.

---

## PART B: EDIT FLOW — Edit Save Not Returning `saved_medicines`

### Fix 6: `PUT /:id/full` Must Return `saved_medicines`
**File:** `src/routes/purchases.ts` (the `PUT /:id/full` endpoint)
**Problem:** When editing a purchase bill and saving, the update endpoint returns only `{ success, message }` — no `saved_medicines`, no `app_invoice_no`. The frontend falls back to client-side items which have no `sell_price` data. The sell-price-config page shows empty sell prices even if the medicines already have them in the database.
**Fix:**
1. After the items loop in `PUT /:id/full`, fetch `sell_price` from `medicines` for each saved medicine_id (same as the create endpoint does at lines 957-965).
2. Return `saved_medicines` and `app_invoice_no` in the response.

### Fix 7: Pass `editPurchaseId` to SellPriceConfig
**File:** `frontend/src/pages/Purchases/index.tsx:1726-1731`
**Problem:** The navigation to `/sell-price-config` does not pass `editPurchaseId`. The page has no way to know if this is a new bill or an edited bill.
**Fix:** Add `editPurchaseId` to the navigation state:
```typescript
navigate(`/sell-price-config?invoice=${encodeURIComponent(savedInvoiceNo)}`, {
  state: {
    invoiceNo: savedInvoiceNo,
    saved_medicines: savedMeds,
    isEdit: !!editPurchaseId  // NEW
  }
});
```

### Fix 8: SellPriceConfig — Handle Edit vs New
**File:** `frontend/src/pages/SellPriceConfig/index.tsx`
**Problem:** The page treats new and edit identically. It doesn't know about `isEdit`.
**Fix:**
1. Read `isEdit` from `location.state`.
2. Show different header text: "Edit Sell Prices" vs "Set Sell Prices".
3. Pre-fill from database (already does this via `api.getSellPriceMedicinesByInvoice`).
4. After save, navigate back correctly.

---

## PART C: DOUBLE REDIRECT BUG

### Fix 9: Remove Duplicate Navigation
**File:** `frontend/src/pages/Purchases/index.tsx:1749-1758`
**Problem:** Code navigates to `/sell-price-config` twice — once immediately (line 1726) and again 300ms later (line 1752). The second uses a different state key (`saved_items` vs `saved_medicines`), causing a race condition.
**Fix:** Delete the `setTimeout(() => { navigate('/sell-price-config', ...) }, 300)` block entirely (lines 1749-1758).

---

## PART D: DEAD CODE CLEANUP

### Fix 10: Remove Dead Barcode Modal
**File:** `frontend/src/pages/Purchases/index.tsx`
**Problem:** `showBarcodeModal` is initialized to `false` and never set to `true`. The entire barcode modal portal (70+ lines at lines 3260-3332) is unreachable dead code.
**Fix:**
1. Delete the `showBarcodeModal` state variable (line 862).
2. Delete the entire `{showBarcodeModal && createPortal(...)}` block (lines 3260-3332).
3. Delete the `setShowBarcodeModal(false)` calls in Escape handler (line 778).

---

## PART E: Z-INDEX CONFLICTS

### Fix 11: Fix Z-Index Token Conflicts
**File:** `frontend/src/index.css:6,9`
**Problem:** CSS overrides Tailwind tokens with `!important`:
- `z-dropdown`: Tailwind=999, CSS=9999 — dropdowns end up at same level as modals
- `z-toast`: Tailwind=10020, CSS=99999
**Fix:**
- Line 9: Change `--z-dropdown: 9999` to `--z-dropdown: 999`
- Line 6: Change `--z-toast: 99999` to `--z-toast: 10020`

---

## PART F: INVENTORY PAGE — Show `sell_price`

### Fix 12: Add `sell_price` Column to Inventory Table
**File:** `frontend/src/pages/Inventory/index.tsx`
**Problem:** The inventory table does not display `sell_price`. Users can only see/edit it via the Universal Medicine Editor modal.
**Fix:**
1. Add `{ key: 'sell_price', label: 'Sell Price' }` to `COL_KEYS` (line ~80).
2. Add a `sell_price` column in the table body.
3. Allow inline editing. On edit, call `api.updateMedicine(id, { sell_price: value })`.

---

## FIXES SUMMARY TABLE

| # | File | What | Why |
|---|------|------|-----|
| 1 | `src/routes/sales.ts:1293` | Add `m.sell_price` to SELECT | Root cause: POS search missing sell_price |
| 2 | `POS/index.tsx:3406` | Add sell_price/discount to batch switch | Discount resets on batch switch |
| 3 | `POS/index.tsx:261` | Add sell_price to refill autofill | Refill skips discount |
| 4 | `POS/index.tsx:382` | Add sell_price to CRM bill-now | CRM skips discount |
| 5 | `POS/index.tsx:1053` | Add sell_price to refill accept | Refill accept skips discount |
| 6 | `purchases.ts` PUT endpoint | Return saved_medicines in update response | Edit flow shows empty sell prices |
| 7 | `Purchases/index.tsx:1726` | Pass editPurchaseId to sell-price-config | Page doesn't know edit vs new |
| 8 | `SellPriceConfig/index.tsx` | Handle isEdit state | Show correct header/pre-fill |
| 9 | `Purchases/index.tsx:1749-1758` | Remove duplicate navigation | Race condition from double redirect |
| 10 | `Purchases/index.tsx:3260-3332` | Remove dead barcode modal | 70+ lines of unreachable code |
| 11 | `index.css:6,9` | Fix z-index token values | Dropdowns fight with modals |
| 12 | `Inventory/index.tsx` | Add sell_price column | Users can't see sell_price in inventory |

---

## AUTO-DISCOUNT FORMULA (used in all POS fixes)

```typescript
const sellPrice = Number(med.sell_price || 0);
const mrp = Number(med.mrp || 0);
const discount = (sellPrice > 0 && mrp > 0 && sellPrice < mrp)
  ? parseFloat((((mrp - sellPrice) / mrp) * 100).toFixed(2))
  : 0;
```

---

## FILE CHANGE MAP

```
src/routes/sales.ts                    ← Fix 1: add sell_price to SELECT
src/routes/purchases.ts                ← Fix 6: return saved_medicines in PUT
frontend/src/pages/POS/index.tsx       ← Fixes 2,3,4,5: add sell_price to 4 cart paths
frontend/src/pages/Purchases/index.tsx ← Fixes 7,9,10: pass editPurchaseId, remove double nav, remove dead modal
frontend/src/pages/SellPriceConfig/index.tsx ← Fix 8: handle isEdit
frontend/src/pages/Inventory/index.tsx ← Fix 12: add sell_price column
frontend/src/index.css                 ← Fix 11: fix z-index tokens
```
