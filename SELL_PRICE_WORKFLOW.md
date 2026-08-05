# Sell Price (Special Rate) Workflow — AI Pharmacy v2

## Overview

When a user saves a purchase bill, a **dedicated page** appears where they can set the **sell price** for each medicine. The app auto-calculates the discount from the sell price and MRP. When that medicine is later sold in POS, the discount auto-applies — no manual input needed.

---

## Complete Workflow

### STEP 1: User Saves a Purchase Bill

User fills in the purchase bill (medicine names, batch, qty, rate, MRP) and clicks **Save**.

```
┌─────────────────────────────────────────────────┐
│  PURCHASES PAGE                                  │
│                                                  │
│  Distributor: ABC Pharma                         │
│  Invoice: INV-12345                              │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ # │ Medicine      │ Batch │ Qty │ Rate │ MRP│ │
│  │ 1 │ Paracetamol   │ B001  │ 10  │ ₹80  │150│ │
│  │ 2 │ Amoxicillin   │ B002  │ 5   │ ₹60  │120│ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│              [ 💾 SAVE PURCHASE ]                │
└─────────────────────────────────────────────────┘
```

---

### STEP 2: Redirect to Dedicated Sell Price Page

After the bill saves successfully, the user is **automatically redirected** to a new **Sell Price Configuration Page**.

```
┌──────────────────────────────────────────────────────────────┐
│  🏷️  SET SELL PRICES — Invoice: INV-12345                    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ #  │ Medicine        │ Rate │ MRP  │ Sell Price │ Disc │  │
│  │    │ (Cost Price)    │ (₹)  │ (₹)  │ (₹)        │ (%)  │  │
│  ├────┼─────────────────┼──────┼──────┼────────────┼──────┤  │
│  │ 1  │ Paracetamol     │  80  │ 150  │ [  120   ] │ 20%  │  │
│  │ 2  │ Amoxicillin     │  60  │ 120  │ [        ] │  --  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [  💾 Save All  ]    [  ⏭️ Skip / Done  ]                   │
└──────────────────────────────────────────────────────────────┘
```

**How it works:**
- Each row shows: Medicine Name, Rate (cost), MRP, editable Sell Price, auto-calculated Discount %
- **Sell Price is optional** — if left empty, medicine sells at MRP (no discount)
- As user types sell price, discount auto-calculates in real-time:
  ```
  Discount = (MRP - Sell Price) / MRP × 100
  Example:  (150 - 120) / 150 × 100 = 20%
  ```
- User can click **Skip / Done** to go back without saving any sell prices

---

### STEP 3: What Gets Saved to Database

When user clicks **Save All**, for each medicine:

```
DATABASE: medicines table
┌────┬────────────────┬─────┬────────┬───────────┐
│ id │ name           │ mrp │ rate   │ sell_price│
├────┼────────────────┼─────┼────────┼───────────┤
│ 1  │ Paracetamol    │ 150 │ 80     │ 120       │  ← NEW COLUMN
│ 2  │ Amoxicillin    │ 120 │ 60     │ NULL      │  ← no sell price set
└────┴────────────────┴─────┴────────┴───────────┘
```

- `sell_price` is stored on the `medicines` table (new column)
- Discount is **NOT stored** — it's calculated on-the-fly in POS
- `sell_price` persists across sessions

---

### STEP 4: Next Purchase — Pre-fill from Previous Values

When the **same medicine** appears in a new purchase bill and the user saves:

```
┌──────────────────────────────────────────────────────────────┐
│  🏷️  SET SELL PRICES — Invoice: INV-12400                    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ #  │ Medicine        │ Rate │ MRP  │ Sell Price │ Disc │  │
│  ├────┼─────────────────┼──────┼──────┼────────────┼──────┤  │
│  │ 1  │ Paracetamol     │  75  │ 150  │ [  120   ] │ 20%  │  │ ← PRE-FILLED
│  └────┴─────────────────┴──────┴──────┴────────────┴──────┘  │
│                                                              │
│  User can change to 130 → discount becomes 13.3%             │
│  Or leave as-is → discount stays 20%                         │
└──────────────────────────────────────────────────────────────┘
```

The sell price carries over from the previous purchase. User can override or skip.

---

### STEP 5: In POS — Discount Auto-Applies

When pharmacist searches for "Paracetamol" and adds it to cart:

```
┌──────────────────────────────────────────────────────────────┐
│  POS PAGE                                                    │
│                                                              │
│  Search: [ Paracetamol ]  ← user types and selects           │
│                                                              │
│  ┌────┬──────────────┬───────┬─────┬─────┬──────┬─────────┐ │
│  │ #  │ Medicine     │ Batch │ Qty │ Disc│ MRP  │ Total   │ │
│  │ 1  │ Paracetamol  │ B001  │ 1   │ 20% │ ₹150 │ ₹120    │ │
│  └────┴──────────────┴───────┴─────┴─────┴──────┴─────────┘ │
│                                                              │
│  💰 Grand Total: ₹120                                        │
│                                                              │
│  [ 💰 COMPLETE SALE ]                                        │
└──────────────────────────────────────────────────────────────┘
```

**Notice:** Discount column shows **20% automatically** — pharmacist did NOT type it. It came from the sell_price saved in Step 3.

The pharmacist can still manually change the discount if needed (e.g., override to 15% for a loyal customer).

---

### STEP 6: Edit Sell Price Later (From Inventory or POS)

If the pharmacist wants to change the sell price later, they can edit it from:

**A. Universal Medicine Editor (Inventory / POS):**
```
┌──────────────────────────────────────────┐
│  Universal Medicine Editor                │
│                                          │
│  Name: Paracetamol 500mg                 │
│  MRP: ₹150                              │
│  Rate (Cost): ₹80                        │
│  Sell Price: [ 130 ]  ← EDITABLE HERE   │
│  Min Reorder: [ 10 ]                     │
│  Max Stock: [ 500 ]                      │
│                                          │
│  [ Save ]  [ Cancel ]                    │
└──────────────────────────────────────────┘
```

**B. POS Cart (inline edit):**
- User can manually change the discount column in the cart
- This does NOT update the stored sell_price — it's a per-sale override

---

## Complete Flow Diagram

```
 PURCHASE SAVE
      │
      ▼
 ┌─────────────────────────┐
 │ Success Toast + Redirect│
 └────────────┬────────────┘
              │
              ▼
 ┌─────────────────────────┐
 │ DEDICATED PAGE:         │
 │ Sell Price Config       │
 │                         │
 │ Medicine │ MRP │ Sell $ │
 │ Para     │ 150 │ [120]  │
 │ Amox     │ 120 │ [    ] │
 │                         │
 │ [Save All] [Skip]       │
 └────────────┬────────────┘
              │
        ┌─────┴─────┐
        │           │
        ▼           ▼
     [Skip]    [Save All]
                    │
                    ▼
     ┌───────────────────────┐
     │ medicines.sell_price  │
     │ = 120 (Para)          │
     │ = NULL (Amox)         │
     └───────────┬───────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
 ┌─────────────┐  ┌─────────────┐
 │ NEXT        │  │ POS PAGE    │
 │ PURCHASE    │  │             │
 │             │  │ Add Para    │
 │ Pre-filled: │  │ Discount =  │
 │ ₹120        │  │ 20% auto    │
 │ (can edit)  │  │             │
 └─────────────┘  └─────────────┘
```

---

## Database Changes Required

### New Column on `medicines` Table

```sql
ALTER TABLE medicines ADD COLUMN sell_price REAL DEFAULT NULL;
```

### Existing Columns Used

| Column | Table | Purpose |
|--------|-------|---------|
| `mrp` | medicines | Maximum Retail Price (selling reference) |
| `rate` | medicines | Cost price (purchase rate) |
| `sell_price` | medicines | **NEW** — Target selling price |
| `reorder_level` | inventory_master | Min stock level (already exists) |
| `max_stock_level` | medicines | Max stock ceiling (already exists) |

---

## Files to Modify

| # | File | Change |
|---|------|--------|
| 1 | `src/database.ts` | Add `sell_price` migration to medicines table |
| 2 | `src/routes/purchases.ts` | Return saved medicine IDs after purchase save |
| 3 | `frontend/src/pages/Purchases/index.tsx` | Redirect to sell price page after save |
| 4 | `frontend/src/pages/SellPriceConfig/index.tsx` | **NEW** — Dedicated sell price configuration page |
| 5 | `frontend/src/App.tsx` | Add route for sell price config page |
| 6 | `frontend/src/pages/POS/index.tsx` | Read sell_price, auto-calculate discount on add-to-cart |
| 7 | `frontend/src/components/UniversalMedicineEditModal.tsx` | Add sell_price field |
| 8 | `src/routes/inventory.ts` | Return sell_price in inventory queries |
| 9 | `frontend/src/services/api.ts` | Add API call for bulk sell price update |

---

## User Interactions Summary

| Action | Result |
|--------|--------|
| Save purchase bill | Redirects to sell price config page |
| Enter sell price for a medicine | Discount auto-calculates in real-time |
| Click "Save All" | Saves sell prices to database, redirects back to purchases |
| Click "Skip / Done" | Goes back without saving any sell prices |
| Next purchase with same medicine | Sell price pre-filled from previous save |
| Add medicine in POS | Discount auto-applies from stored sell price |
| Edit sell price in Inventory | Updates the stored sell price for future sales |
| Manually change discount in POS | Per-sale override only, does not change stored sell_price |

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Sell price > MRP | Not allowed — show warning, clamp to MRP |
| Sell price = MRP | Discount = 0%, sells at MRP (same as no sell price) |
| Sell price < cost (rate) | Show warning "Sell price is below cost price!" but allow it |
| Sell price = 0 or empty | No discount, sells at MRP |
| Medicine has no sell price set | Sells at MRP in POS (discount = 0%) |
| User changes MRP after setting sell price | Sell price stays, discount recalculates with new MRP |
| User deletes a medicine | Sell price is deleted with the medicine record |
