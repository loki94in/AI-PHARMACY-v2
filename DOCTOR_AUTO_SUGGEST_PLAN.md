# Doctor Auto-Suggestion in POS — Implementation Plan

## Goal
When user selects a doctor in POS, auto-show that doctor's most-prescribed medicines + common combinations with last-prescribed qty. Every new bill auto-feeds the data.

---

## Steps

### 1. `src/database.ts` — Add index
After line 184, add:
```sql
CREATE INDEX IF NOT EXISTS idx_sales_invoices_doctor_date ON sales_invoices (doctor_id, date);
```

### 2. `src/routes/sales.ts` — Fix doctor ID on bill save
Lines ~174-176: Before INSERT, if `doctor_name` exists but no `doctor_id`, resolve via:
```sql
SELECT id FROM doctors WHERE LOWER(name) = LOWER(?) LIMIT 1
```
Use resolved ID in INSERT.

### 3. `src/routes/crm.ts` — Two endpoints

**3a. Replace** `/doctors/:id/suggestions` (lines 197-220):
```sql
SELECT m.id, m.name, COUNT(*) as frequency,
  (SELECT si.quantity FROM sale_items si
   JOIN inventory_master im2 ON si.inventory_id = im2.id
   WHERE im2.medicine_id = m.id
     AND si.invoice_id IN (SELECT id FROM sales_invoices WHERE doctor_id = ?)
   ORDER BY si.id DESC LIMIT 1) as last_qty
FROM sale_items si
JOIN sales_invoices s ON si.invoice_id = s.id
JOIN inventory_master im ON si.inventory_id = im.id
JOIN medicines m ON im.medicine_id = m.id
WHERE s.doctor_id = ?
GROUP BY m.id ORDER BY frequency DESC LIMIT ?
```
Accept `?limit=` query param (default 25).

**3b. Add** `/doctors/:id/combinations/:medicineId`:
```sql
SELECT m.id, m.name, COUNT(*) as co_count,
  (SELECT si2.quantity FROM sale_items si2
   JOIN inventory_master im3 ON si2.inventory_id = im3.id
   WHERE im3.medicine_id = m.id
     AND si2.invoice_id IN (SELECT s2.id FROM sales_invoices s2 WHERE s2.doctor_id = ?)
   ORDER BY si2.id DESC LIMIT 1) as last_qty
FROM sale_items a
JOIN sale_items b ON a.invoice_id = b.invoice_id AND a.inventory_id != b.inventory_id
JOIN sales_invoices s ON s.id = a.invoice_id
JOIN inventory_master im ON im.id = b.inventory_id
JOIN medicines m ON m.id = im.medicine_id
JOIN inventory_master im_a ON im_a.id = a.inventory_id
WHERE s.doctor_id = ? AND im_a.medicine_id = ?
GROUP BY m.id ORDER BY co_count DESC LIMIT 10
```

### 4. `frontend/src/services/api.ts` — Add 2 functions
```ts
getDoctorSuggestions: (id: number, limit = 25) =>
  apiClient.get(`/crm/doctors/${id}/suggestions`, { params: { limit } }).then(r => r.data),
getDoctorCombinations: (id: number, medicineId: number) =>
  apiClient.get(`/crm/doctors/${id}/combinations/${medicineId}`).then(r => r.data),
```

### 5. `frontend/src/pages/POS/index.tsx` — POS UI

**New state** (after line 265):
- `selectedDoctorId: number | null`
- `doctorSuggestions: any[]`
- `doctorComboSuggestions: any[]`

**Track doctor ID**: In dropdown `onMouseDown` (line 1592), store `doc.id`. Free-text sets null.

**Effect**: When `selectedDoctorId` changes, fetch `getDoctorSuggestions(id)`.

**Replace Quick Add** (lines 1954-1980):
- If `doctorSuggestions.length > 0` → "Dr. [Name]'s Prescriptions" with pills (name + freq + last_qty)
- Else → existing "Quick Add (Frequently Sold)"

**Combination panel**: After `addToCart`, fetch `getDoctorCombinations(id, medId)`. Render below search bar: "Together with:" + pills.

**Auto-qty**: Pre-fill cart qty with `last_qty` from suggestion data instead of default 1.

---

## Files Changed (5 total)

| File | Change |
|------|--------|
| `src/database.ts` | +1 line (index) |
| `src/routes/sales.ts` | ~5 lines (doctor resolve) |
| `src/routes/crm.ts` | ~50 lines (2 endpoints) |
| `frontend/src/services/api.ts` | ~6 lines (2 functions) |
| `frontend/src/pages/POS/index.tsx` | ~80 lines (state + effects + UI) |
