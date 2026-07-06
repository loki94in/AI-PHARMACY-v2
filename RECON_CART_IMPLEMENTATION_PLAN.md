# Reconciliation Cart Enhancement — Implementation Plan

**Date:** 2026-07-06
**Status:** Approved — Pending Implementation

---

## Overview

Enhance `LiveCartAddModal` to allow manual addition of medicines from reconciliation items (missing distributor email orders) to the Pharmarack cart within 24-30 hours.

---

## Problem Statement

- `LiveCartAddModal` shows recon items with "Recon" badge and "Missing" status
- **No way to add medicines from recon items to the cart**
- User needs to manually order medicines from distributor emails that haven't been booked to inventory yet

---

## Current State

| Component | File | Line |
|-----------|------|------|
| Recon items UI | `frontend/src/components/LiveCartAddModal.tsx` | 943-963 |
| Recon API endpoint | `src/routes/purchases.ts` | 1619-1731 |
| Recon list fetch | `frontend/src/services/api.ts` | 451 |
| Similar pattern (orders) | `frontend/src/components/LiveCartAddModal.tsx` | 816-822 |
| Pharmarack search | `frontend/src/components/LiveCartAddModal.tsx` | 300-334 |
| Add to cart API | `frontend/src/components/LiveCartAddModal.tsx` | 672-717 |

---

## Files to Modify

1. **`frontend/src/components/LiveCartAddModal.tsx`** — Main UI changes

---

## Implementation Steps

### Step 1: Add State Variables

```typescript
// Distributor Picker for Recon Items
const [distributorPickerReconIdx, setDistributorPickerReconIdx] = useState<number | null>(null);
const [distributorPickerReconMedicine, setDistributorPickerReconMedicine] = useState<string>('');
const [addedReconMedicines, setAddedReconMedicines] = useState<Record<number, string[]>>({});
```

### Step 2: Add "Add" Button for Recon Items

Replace the static "Missing" badge (line 959-961) with an interactive button:

```tsx
<td className="py-2 px-1 text-right">
  {addedReconMedicines[recon.email_uid]?.length === recon.medicine_names?.length ? (
    <span className="text-[8px] font-bold text-emerald-400">✓ All Added</span>
  ) : distributorPickerReconIdx === idx ? (
    <button type="button" onClick={() => { setDistributorPickerReconIdx(null); setDistributorPickerReconMedicine(''); }}
      className="text-[9px] text-muted hover:text-text transition-colors">✕</button>
  ) : (
    <button type="button"
      onClick={() => setDistributorPickerReconIdx(idx)}
      className="text-[9px] font-bold text-purple-400 hover:text-purple-300 transition-colors">
      Add
    </button>
  )}
</td>
```

### Step 3: Medicine Selection Dropdown

After the recon row, add a dropdown to select which medicine to order:

```tsx
{distributorPickerReconIdx === idx && (
  <tr>
    <td colSpan={4} className="pb-2 px-1">
      <div className="animate-in fade-in slide-in-from-top-1 duration-200 bg-purple-500/5 border border-purple-500/20 rounded-lg p-2 space-y-1">
        <p className="text-[10px] text-muted font-bold uppercase mb-1">Select Medicine to Order:</p>
        {recon.medicine_names?.map((medName: string, medIdx: number) => {
          const isAdded = addedReconMedicines[recon.email_uid]?.includes(medName);
          return (
            <button key={medIdx} type="button"
              onClick={() => handleReconMedicineSelect(recon, medName)}
              disabled={isAdded}
              className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] transition-all ${
                isAdded
                  ? 'bg-emerald-500/5 text-emerald-400 line-through opacity-60 cursor-default'
                  : 'bg-bg3/50 hover:bg-purple-500/10 border border-border hover:border-purple-500/40 text-text'
              }`}>
              {isAdded && <span className="mr-1">✓</span>}
              {medName}
            </button>
          );
        })}
      </div>
    </td>
  </tr>
)}
```

### Step 4: Pharmarack Distributor Search

When a medicine is selected, search Pharmarack and show distributor options:

```typescript
const handleReconMedicineSelect = async (recon: any, medName: string) => {
  setDistributorPickerReconMedicine(medName);
  setDistributorPickerLoading(true);
  try {
    const searchResults = await api.searchPharmarack(medName);
    // Map results to SuggestionMedicine format (same as handleSearchDistributorsForOrder)
    const mapped: SuggestionMedicine[] = (searchResults as any[]).map((item) => ({
      medicine_name: item.name,
      mrp: item.mrp,
      isPharmarack: true,
      distributor: item.distributor,
      rate: item.rate,
      mapped: item.mapped,
      packaging: item.packaging,
      stock: item.stock,
      scheme: item.scheme,
      productId: item.productId,
      storeId: item.storeId,
      productCode: item.productCode,
      company: item.company
    }));
    setDistributorPickerResults(mapped);
  } catch (err: any) {
    toastEvent.trigger(err?.response?.data?.error || 'Failed to search distributors', 'error');
  } finally {
    setDistributorPickerLoading(false);
  }
};
```

### Step 5: Add to Cart Handler

```typescript
const handleConfirmReconDistributor = async (recon: any, medName: string, picked: SuggestionMedicine) => {
  setAddingOrderId(recon.email_uid); // reuse loading state
  try {
    const payload = [{
      productId: picked.productId!,
      storeId: picked.storeId!,
      qty: 1,
      productCode: picked.productCode,
      productName: picked.medicine_name,
      company: picked.company,
      packaging: picked.packaging,
      rate: picked.rate || 0,
      mrp: picked.mrp || 0,
      storeName: picked.distributor,
      mapped: picked.mapped
    }];
    const res = await api.addPharmarackCart(payload);
    if (res && res.success) {
      toastEvent.trigger(`Added "${medName}" to Pharmarack cart!`, 'success');
      // Track added medicine
      setAddedReconMedicines(prev => ({
        ...prev,
        [recon.email_uid]: [...(prev[recon.email_uid] || []), medName]
      }));
      setDistributorPickerReconIdx(null);
      setDistributorPickerReconMedicine('');
      setDistributorPickerResults([]);
      await fetchCart();
      window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
    } else {
      toastEvent.trigger(res?.error || 'Failed to add item to cart', 'error');
    }
  } catch (err: any) {
    toastEvent.trigger(err?.response?.data?.error || 'Failed to add item to cart', 'error');
  } finally {
    setAddingOrderId(null);
  }
};
```

### Step 6: 24-30 Hour Visual Indicator

Add timestamp display and age-based styling to recon rows:

```tsx
// Helper function
const getReconAgeStyle = (dateStr: string): string => {
  const reconDate = new Date(dateStr);
  const now = new Date();
  const hoursDiff = (now.getTime() - reconDate.getTime()) / (1000 * 60 * 60);
  
  if (hoursDiff > 30) return 'bg-red-500/10 border-red-500/20'; // Urgent
  if (hoursDiff > 24) return 'bg-amber-500/10 border-amber-500/20'; // Warning
  return ''; // Normal
};

// In recon row
<tr key={`recon-${recon.email_uid || idx}`} 
    className={`hover:bg-bg3/40 transition-colors ${getReconAgeStyle(recon.date)}`}>
```

---

## UI Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ LiveCartAddModal — Left Column: Pending Table                    │
├─────────────────────────────────────────────────────────────────┤
│ [Ord] [Product Name        ] [Qty] [Add]                        │
│ [Refill] [Medicine Name    ] [1]  [Add]                         │
│ [Recon] [Distributor Name  ] [—]  [Add]  ← NEW BUTTON          │
│                                                                 │
│ When "Add" clicked on Recon:                                    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Select Medicine to Order:                                   │ │
│ │ [✓] Paracetamol 500mg    (already added)                   │ │
│ │ [ ] Amoxicillin 250mg    (click to search Pharmarack)      │ │
│ │ [ ] Ibuprofen 400mg      (click to search Pharmarack)      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ When medicine selected:                                         │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Pharmarack Distributor Picker:                              │ │
│ │ [Distributor A] ₹45.00  [Best]                             │ │
│ │ [Distributor B] ₹48.50                                      │ │
│ │ [Distributor C] ₹50.00  [Mapped]                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ After adding:                                                   │
│ [Recon] [Distributor Name  ] [—]  [✓ All Added]                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Age-Based Styling

| Hours Since Email | Badge Color | Row Background |
|-------------------|-------------|----------------|
| 0-24 hours | Purple (normal) | Default |
| 24-30 hours | Amber | `bg-amber-500/10` |
| 30+ hours | Red | `bg-red-500/10` |

---

## Testing Checklist

- [ ] Recon items show "Add" button
- [ ] Clicking "Add" shows medicine dropdown
- [ ] Selecting medicine triggers Pharmarack search
- [ ] Distributor picker shows with rates/schemes
- [ ] Adding to cart shows success toast
- [ ] Added medicine shows checkmark/strikethrough
- [ ] "All Added" badge when all medicines added
- [ ] 24-30h age indicator shows correct styling
- [ ] Cart refreshes after adding item

---

## Notes

- Reuses existing patterns from pending orders/refills
- No backend changes required (existing API supports this)
- `addedReconMedicines` state is local (resets on modal close)
- Could persist to localStorage if needed for session persistence
