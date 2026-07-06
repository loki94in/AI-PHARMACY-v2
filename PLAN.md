# POS Workflow Improvement Plan

## Focus Flow After Medicine Selection

After user selects a medicine → cursor moves to **Strips Qty** → Enter → **Loose Qty** → Enter → **Next Row's Medicine input**

### Changes

**1. POS — Focus strips qty after global search add**
- File: `frontend/src/pages/POS/index.tsx`
- After `fetchDetailsAndAddToCart`, find the just-added item's index and focus `#row-qty-input-{index}`
- Row-level search already focuses strips qty (line 1068) — no change needed

---

## Batch Input — No Manual Editing

Batch selectable via dropdown only, no typing/pasting.

### Changes

**2. POS — Block typing/paste on batch field**
- File: `frontend/src/pages/POS/index.tsx` (~line 2162)
- Add `onPaste={e => e.preventDefault()}`
- Add `onKeyDown` blocking printable characters (allow Tab/Enter/Escape navigation only)

---

## Increase Medicine Section Widths (+3px)

### Changes

**3. POS — Medicine column +3px**
- File: `frontend/src/pages/POS/index.tsx`
- `min-w-[160px]` → `min-w-[163px]` (line 2053)

**4. POS — Row-level dropdown +3px**
- File: `frontend/src/pages/POS/index.tsx`
- `w-64` → `w-[259px]` (line 2122)

---

## Tab Key for Selection (9 dropdowns, 5 files)

Add `e.key === 'Tab'` to select the highlighted item (same as Enter) with `e.preventDefault()`.

### Dropdowns with existing keyboard nav (add Tab only)

| # | File | Dropdown | Line |
|---|------|----------|------|
| 5 | `frontend/src/pages/POS/index.tsx` | Patient search | 1436 |
| 6 | `frontend/src/pages/POS/index.tsx` | Doctor search | 1538 |
| 7 | `frontend/src/pages/POS/index.tsx` | Main medicine search | 1634 |
| 8 | `frontend/src/pages/POS/index.tsx` | Row-level medicine change | 2097 |
| 9 | `frontend/src/components/LiveCartAddModal.tsx` | Pharmarack product search | 726 |
| 10 | `frontend/src/components/QuickOrderModal.tsx` | Medicine search | 502 |

### Dropdowns with NO keyboard nav (add full nav + Tab)

| # | File | Dropdown | Line |
|---|------|----------|------|
| 11 | `frontend/src/pages/Returns/index.tsx` | Medicine search | ~1375 |
| 12 | `frontend/src/pages/Purchases/index.tsx` | Medicine search | ~1950 |

For #11 and #12: add `searchHighlightIndex` state, highlight tracking, and full `onKeyDown` (ArrowDown/Up, Enter, Tab, Escape) matching the POS pattern.

---

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/pages/POS/index.tsx` | Focus flow, batch restriction, widths, Tab in 4 dropdowns |
| `frontend/src/pages/Returns/index.tsx` | Add full keyboard nav + Tab to medicine dropdown |
| `frontend/src/pages/Purchases/index.tsx` | Add full keyboard nav + Tab to medicine dropdown |
| `frontend/src/components/LiveCartAddModal.tsx` | Add Tab selection to existing keyboard nav |
| `frontend/src/components/QuickOrderModal.tsx` | Add Tab selection to existing keyboard nav |
