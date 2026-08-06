# Sell Price Feature — Complete Specification

## Feature Name
**Sell Price (Special Rate) with Auto-Discount**

## Summary
When a purchase bill is saved, a dedicated page/popup appears where the user can set a **sell price** per medicine. The app calculates the discount from the sell price and MRP. In POS, the discount auto-applies when the medicine is sold — the pharmacist does NOT need to type the discount manually.

---

## 1. DATABASE CHANGES

### 1.1 New Column: `sell_price` on `medicines` Table

```sql
ALTER TABLE medicines ADD COLUMN sell_price REAL DEFAULT NULL;
```

- **Type:** REAL (decimal number)
- **Default:** NULL (means no sell price set, sell at MRP)
- **Location:** `src/database.ts` — add near line 690 (with existing `max_stock_level` migration)

### 1.2 No Changes to Other Tables

| Table | What Stays the Same |
|-------|---------------------|
| `medicines.mrp` | MRP never changes by this feature |
| `medicines.rate` | Cost price never changes by this feature |
| `purchase_items` | No new columns needed |
| `inventory_master` | No new columns needed |
| `sale_items` | Uses existing `discount_per` column |

---

## 2. BACKEND CHANGES

### 2.1 Purchase Save Endpoint — Return Medicine IDs

**File:** `src/routes/purchases.ts`

After saving the purchase (line ~988), the response should include the list of saved medicine IDs so the frontend can show them on the sell price page.

**Current response:**
```json
{ "app_invoice_no": "INV-12345", "success": true }
```

**New response:**
```json
{
  "app_invoice_no": "INV-12345",
  "success": true,
  "saved_medicines": [
    { "medicine_id": 1, "name": "Paracetamol", "mrp": 150, "rate": 80, "sell_price": 120 },
    { "medicine_id": 2, "name": "Amoxicillin", "mrp": 120, "rate": 60, "sell_price": null }
  ]
}
```

- `sell_price` is the existing value from the database (pre-filled for next time)
- If `sell_price` is null, the input field will be empty

### 2.2 New Endpoint: Bulk Sell Price Update

**File:** `src/routes/purchases.ts` (or new file `src/routes/sellPrice.ts`)

```
POST /api/sell-price/bulk-update
Body: {
  items: [
    { medicine_id: 1, sell_price: 120 },
    { medicine_id: 2, sell_price: null }
  ]
}
```

**Logic:**
```javascript
for (const item of items) {
  if (item.sell_price !== null && item.sell_price !== undefined && item.sell_price > 0) {
    await db.run('UPDATE medicines SET sell_price = ? WHERE id = ?', [item.sell_price, item.medicine_id]);
  } else {
    await db.run('UPDATE medicines SET sell_price = NULL WHERE id = ?', [item.medicine_id]);
  }
}
```

**Validation:**
- `sell_price` must be ≥ 0
- `sell_price` must be ≤ `mrp` (if MRP is known). If sell_price > MRP, clamp to MRP and show warning.
- `sell_price` must be ≥ `rate` (cost price). If sell_price < rate, allow but log a warning.

### 2.3 Inventory API — Return sell_price

**File:** `src/routes/inventory.ts`

The compact inventory endpoint (used by POS search) should include `sell_price` in the response.

**Current SELECT (approximate):**
```sql
SELECT m.id, m.name, m.mrp, m.rate, m.cgst_per, m.sgst_per, ...
FROM medicines m
```

**Updated SELECT:**
```sql
SELECT m.id, m.name, m.mrp, m.rate, m.sell_price, m.cgst_per, m.sgst_per, ...
FROM medicines m
```

This ensures POS can read `sell_price` when adding medicines to cart.

### 2.4 Quick Edit Endpoint — Accept sell_price

**File:** `src/routes/inventory.ts` (line ~760)

The `PUT /api/inventory/medicines/:id/quick-edit` endpoint should accept `sell_price`:

```javascript
// Add to destructuring (line ~764):
const { ..., sell_price, ... } = req.body;

// Add to medicines update (near line ~812):
if (sell_price !== undefined) {
  updates.push('sell_price = ?');
  params.push(parseFloat(sell_price) || null);
}
```

---

## 3. FRONTEND CHANGES

### 3.1 BillItem Interface — Add sell_price

**File:** `frontend/src/pages/Purchases/index.tsx`

```typescript
interface BillItem {
  // ... existing fields ...
  sell_price?: number | string;  // NEW
}
```

### 3.2 Sell Price Configuration Page

**New file:** `frontend/src/pages/SellPriceConfig/index.tsx`

This is a **full page** (not a modal) that appears after saving a purchase bill.

#### Page Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ← Back to Purchases                                        │
│                                                              │
│  🏷️  SET SELL PRICES                                         │
│  Invoice: INV-12345 | Date: 2026-08-05 | 2 medicines        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  #  │ Medicine        │ Cost  │ MRP  │ Sell Price │ Disc│  │
│  ├─────┼─────────────────┼───────┼──────┼────────────┼─────┤  │
│  │  1  │ Paracetamol     │ ₹80   │ ₹150 │ [  120   ] │ 20% │  │
│  │  2  │ Amoxicillin     │ ₹60   │ ₹120 │ [        ] │  -- │  │
│  └─────┴─────────────────┴───────┴──────┴────────────┴─────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  💡 Sell Price is optional. If left empty, the       │    │
│  │  medicine sells at MRP with no discount.             │    │
│  │                                                      │    │
│  │  Discount auto-calculates: (MRP - Sell Price) / MRP │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  [  💾 Save All  ]    [  ⏭️ Skip / Done  ]                   │
└──────────────────────────────────────────────────────────────┘
```

#### Page Behavior

1. **On mount:** Fetch saved medicines from the API using invoice number
2. **Pre-fill:** If `sell_price` already exists in DB, show it in the input
3. **Real-time discount:** As user types sell price, discount % updates instantly
4. **Save:** Calls `POST /api/sell-price/bulk-update` then redirects to `/purchases`
5. **Skip:** Redirects to `/purchases` without saving

#### Discount Calculation (Real-time)

```typescript
const calculateDiscount = (mrp: number, sellPrice: number): number => {
  if (!mrp || !sellPrice || sellPrice <= 0 || mrp <= 0) return 0;
  if (sellPrice >= mrp) return 0;  // No discount if sell price >= MRP
  return Math.round(((mrp - sellPrice) / mrp) * 100 * 100) / 100;  // 2 decimal places
};
```

#### Validation Rules

| Rule | Behavior |
|------|----------|
| Sell price > MRP | Clamp to MRP, show warning: "Sell price cannot exceed MRP" |
| Sell price < cost (rate) | Show warning: "Sell price is below cost price. You will make a loss." |
| Sell price = 0 | Treat as empty (no discount) |
| Sell price = MRP | Discount = 0%, same as no sell price |
| Non-numeric input | Reject, only allow numbers and decimal point |

### 3.3 Route Configuration

**File:** `frontend/src/App.tsx`

Add route for the new page:

```tsx
<Route path="/sell-price-config" element={<SellPriceConfig />} />
```

### 3.4 Redirect After Purchase Save

**File:** `frontend/src/pages/Purchases/index.tsx`

After successful save (line ~1688), instead of showing barcode modal, redirect to sell price page:

```typescript
// Store the saved medicines data
setLastSavedInvoiceNo(savedInvoiceNo);
setLastSavedMedicines(response.saved_medicines || []);

// Redirect to sell price config page
navigate(`/sell-price-config?invoice=${savedInvoiceNo}`);
```

Or show barcode modal first, then redirect. User's choice. Based on workflow doc, the sell price page replaces the barcode modal.

### 3.5 POS — Auto-Apply Discount on Add-to-Cart

**File:** `frontend/src/pages/POS/index.tsx`

#### In `addToCart` function (line ~1518):

When building a new cart item, check if `sell_price` exists and calculate discount:

```typescript
// After setting initialMrp and initialUnitPrice:
const sellPrice = med.sell_price || null;
const autoDiscount = sellPrice && sellPrice > 0 && initialMrp > 0 && sellPrice < initialMrp
  ? Math.round(((initialMrp - sellPrice) / initialMrp) * 100 * 100) / 100
  : 0;

const newItem = {
  // ... existing fields ...
  mrp: initialMrp,
  unitPrice: sellPrice || initialUnitPrice,  // Use sell_price as unitPrice if set
  discount: autoDiscount,  // Auto-calculated discount
  // ...
};
```

#### In `fetchDetailsAndAddToCart` function (line ~1614):

Pass `sell_price` from search results:

```typescript
const basePayload = {
  // ... existing fields ...
  sell_price: item.sell_price,  // NEW — pass sell price from inventory
};
addToCart(basePayload);
```

#### In subtotal calculation (line ~1941):

Already uses `item.discount` — no changes needed. The auto-discount flows through existing logic.

#### In sale save payload (line ~2040):

Already saves `discount_per` — no changes needed.

### 3.6 Universal Medicine Editor — Add sell_price Field

**File:** `frontend/src/components/UniversalMedicineEditModal.tsx`

#### Add to form state (line ~330):

```typescript
sell_price: med.sell_price ?? null,
```

#### Add UI field (near line ~956, after max_stock_level):

```tsx
<div>
  <label className="block text-xs font-semibold text-muted mb-1.5">Sell Price (₹)</label>
  <input
    type="number"
    name="sell_price"
    value={form.sell_price ?? ''}
    onChange={handleChange}
    placeholder="Leave empty to sell at MRP"
    className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold focus:border-primary focus:outline-none"
  />
  {form.sell_price && form.mrp && form.sell_price < form.mrp && (
    <p className="text-[10px] text-emerald-400 mt-1">
      Discount: {Math.round(((form.mrp - form.sell_price) / form.mrp) * 100)}%
    </p>
  )}
  {form.sell_price && form.rate && form.sell_price < form.rate && (
    <p className="text-[10px] text-red-400 mt-1">
      ⚠️ Below cost price — you will make a loss
    </p>
  )}
</div>
```

#### Add to save payload (line ~423):

```typescript
await api.updateQuickEditMedicine(medicineId, {
  ...form,
  sell_price: form.sell_price || null,  // Include sell_price
  inventory_id: inventoryId,
  metadata: JSON.stringify(metadataObj)
});
```

### 3.7 API Service — Add sell_price to Types

**File:** `frontend/src/services/api.ts` (or `frontend/src/types/api.ts`)

```typescript
interface Medicine {
  // ... existing fields ...
  sell_price?: number | null;  // NEW
}
```

### 3.8 POS Search Results — Include sell_price

The POS search/autocomplete already queries the compact inventory. Since we're adding `sell_price` to the inventory SQL query (section 2.3), the search results will automatically include it. No frontend change needed for search — just ensure `sell_price` is passed through in `fetchDetailsAndAddToCart`.

---

## 4. UI STYLING

### 4.1 Sell Price Config Page

Follow existing page styling patterns:
- Background: `bg-bg`
- Card: `bg-bg2 border border-glass-border rounded-2xl`
- Table headers: `text-xs font-bold uppercase tracking-wider text-muted`
- Inputs: `bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold`
- Primary button: `bg-primary hover:bg-primary/90 text-white`
- Skip button: `bg-white/5 border border-white/10 text-muted`

### 4.2 Discount Badge

```
Discount shown as colored badge:
- 0%: gray badge "No discount"
- 1-10%: yellow badge "5%"
- 11-25%: green badge "20%"
- 26%+: red badge "30%" (deep discount warning)
```

### 4.3 Warning Messages

```
Sell price > MRP:  "Sell price cannot exceed MRP. Clamped to MRP."
Sell price < cost: "Sell price is below cost price (₹80). You will make a loss on each sale."
Sell price = 0:    "Empty sell price means no discount — sells at MRP."
```

---

## 5. EDGE CASES

| Scenario | Behavior |
|----------|----------|
| Sell price > MRP | Clamp to MRP, show warning |
| Sell price < cost (rate) | Allow but show red warning |
| Sell price = 0 or empty | No discount, sell at MRP |
| Sell price = MRP | Discount = 0% |
| MRP changes after sell price set | Discount recalculates with new MRP at POS time |
| Medicine deleted | sell_price deleted with the record |
| Purchase bill edited | Sell price page shows updated medicine list |
| Multiple batches of same medicine | Sell price is per-medicine, not per-batch |
| User navigates away from sell price page | Nothing saved, sell prices remain as before |
| API error during save | Show error toast, remain on page |
| Medicine has no MRP (MRP = 0) | Disable sell price input, show "Set MRP first" |
| User sets sell price for some medicines, skips others | Only saved medicines get sell_price, others stay NULL |

---

## 6. WORKFLOW DIAGRAMS

### 6.1 Complete Flow

```
USER SAVES PURCHASE BILL
         │
         ▼
┌─────────────────────┐
│ API: POST           │
│ /purchases/manual   │
│                     │
│ Returns:            │
│ - invoice_no        │
│ - saved_medicines[] │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ REDIRECT TO         │
│ /sell-price-config  │
│ ?invoice=INV-12345  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ SELL PRICE PAGE     │
│                     │
│ Fetch medicines     │
│ Pre-fill sell_price │
│ Show editable table │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 [Skip]    [Save All]
               │
               ▼
┌─────────────────────┐
│ API: POST           │
│ /sell-price/        │
│ bulk-update         │
│                     │
│ Saves sell_price    │
│ to medicines table  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ REDIRECT TO         │
│ /purchases          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ LATER: POS PAGE     │
│                     │
│ User searches       │
│ "Paracetamol"       │
│                     │
│ addToCart reads:    │
│ - mrp: 150          │
│ - sell_price: 120   │
│ - discount: 20%     │
│                     │
│ Cart shows:         │
│ MRP ₹150, 20% off  │
│ Total: ₹120         │
└─────────────────────┘
```

### 6.2 Discount Calculation Flow

```
sell_price = 120
mrp = 150

discount = (mrp - sell_price) / mrp × 100
         = (150 - 120) / 150 × 100
         = 30 / 150 × 100
         = 20%

POS cart item:
  mrp: 150
  discount: 20%
  itemTotal = 150 × (1 - 20/100) = 150 × 0.8 = 120
  customer pays: ₹120
```

### 6.3 Pre-fill Flow (Next Purchase)

```
FIRST PURCHASE:
  Paracetamol sell_price = 120 (user sets)
  Saved to medicines.sell_price

SECOND PURCHASE (same medicine):
  Sell Price Config Page loads:
    Paracetamol sell_price = 120 (pre-filled from DB)
    User can change or skip

THIRD PURCHASE (same medicine):
  Same behavior — pre-filled from last saved value
```

---

## 7. TESTING CHECKLIST

- [ ] Save purchase bill → sell price page appears with correct medicines
- [ ] Enter sell price → discount calculates in real-time
- [ ] Save sell prices → redirect to purchases
- [ ] Next purchase with same medicine → sell price pre-filled
- [ ] Skip sell prices → no discount in POS
- [ ] POS: add medicine with sell price → discount auto-applies
- [ ] POS: add medicine without sell price → no discount
- [ ] POS: manually override discount → works (per-sale override)
- [ ] Inventory editor: sell price field visible and editable
- [ ] Sell price > MRP → warning shown, clamped to MRP
- [ ] Sell price < cost → warning shown, still allowed
- [ ] Sell price = empty → no discount
- [ ] MRP changes → discount recalculates at POS time
- [ ] Multiple medicines in one bill → each gets its own sell price
- [ ] Barcode modal still works (if kept alongside sell price page)

---

## 8. FILES SUMMARY

| # | File | Type | Change |
|---|------|------|--------|
| 1 | `src/database.ts` | Backend | Add `sell_price` migration |
| 2 | `src/routes/purchases.ts` | Backend | Return saved_medicines in response |
| 3 | `src/routes/purchases.ts` | Backend | New: bulk sell price update endpoint |
| 4 | `src/routes/inventory.ts` | Backend | Include sell_price in inventory queries |
| 5 | `src/routes/inventory.ts` | Backend | Accept sell_price in quick-edit |
| 6 | `frontend/src/pages/SellPriceConfig/index.tsx` | Frontend | **NEW** — Sell price config page |
| 7 | `frontend/src/App.tsx` | Frontend | Add route for sell price config |
| 8 | `frontend/src/pages/Purchases/index.tsx` | Frontend | Redirect to sell price page after save |
| 9 | `frontend/src/pages/POS/index.tsx` | Frontend | Auto-apply discount from sell_price |
| 10 | `frontend/src/components/UniversalMedicineEditModal.tsx` | Frontend | Add sell_price field |
| 11 | `frontend/src/services/api.ts` | Frontend | Add sell_price to types + API calls |
