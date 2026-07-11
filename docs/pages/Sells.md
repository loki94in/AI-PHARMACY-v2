# 📄 Sells Page — Invoice History & Editing

**File**: `frontend/src/pages/Sells/index.tsx`
**Route**: `/sells`
**Risk Level**: 🟡 MED — reads sales table; edits affect inventory + dashboard

---

## What This Page Does

Shows the complete list of all sale invoices (past billing). The pharmacist can:
1. Search/filter by date range, medicine name, batch, invoice number
2. View full invoice details (items, patient, doctor, amounts)
3. Edit an invoice (change quantity, discount, delete items)
4. Delete an invoice entirely (reverses stock)
5. Quick-edit any medicine from the invoice using UniversalMedicineEditModal

---

## Data Flow

```
ON MOUNT
  React Query: ['sells-list', page, filters]
    api.listSales(params)  →  GET /api/sales/list
  Infinite scroll: loads more pages as user scrolls

USER OPENS INVOICE
  api.getSale(id)  →  GET /api/sales/:id
  Renders full item table with editable fields

USER EDITS INVOICE
  api.updateSale(id, data)  →  PUT /api/sales/:id
  On success:
    invalidateAfterStockWrite(queryClient)
    toastEvent.trigger("Invoice updated")

USER DELETES INVOICE
  api.deleteSale(id)  →  DELETE /api/sales/:id
  On success:
    invalidateAfterStockWrite(queryClient)
    Stock is RESTORED for deleted items

USER CLICKS "QUICK EDIT MEDICINE" on an item
  Opens: UniversalMedicineEditModal (medicineId)
  On modal save:
    invalidateAfterStockWrite(queryClient)
```

---

## What Other Pages See After an Edit Here

| Page | Effect |
|------|--------|
| **Dashboard** | Revenue totals change |
| **Reports** | Sales figures change |
| **Inventory** | Stock restored if invoice deleted |
| **Investigation** | Audit trail updated |
| **CRM** | Patient history updated |

---

## Key State & Query Variables

| Variable | Purpose |
|----------|---------|
| `['sells-list', ...]` | React Query key for infinite list |
| `selectedSale` | Currently open invoice detail |
| `editMode` | Whether the open invoice is being edited |
| `showQuickEdit` / `quickEditId` | Controls UniversalMedicineEditModal |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/sales/list` | Paginated invoice list |
| GET | `/api/sales/:id` | Single invoice detail |
| PUT | `/api/sales/:id` | Update invoice |
| DELETE | `/api/sales/:id` | Delete invoice (reverses stock) |

---

## Shared Components Used

- `UniversalMedicineEditModal` — edit medicine master from invoice view
- `DateRangeFilter` — date picker for filtering
- `InfiniteScrollStatus` — shows loading/end of list

---

## ⚠️ Agent Notes — Do NOT Break

- The query key is `['sells-list', search, dateFrom, dateTo, batch]`. If you change filter params, update the key to include them — otherwise stale data.
- Deleting a sale RESTORES inventory on the backend. Do not remove stock-reversal logic.
- The `include_items` param on `listSales` controls whether line items are embedded in list response. Keep it consistent with how the component uses the data.
- `UniversalMedicineEditModal` here edits the **medicine master** (name, packaging, etc.) — NOT the sale line item. These are two different things.
