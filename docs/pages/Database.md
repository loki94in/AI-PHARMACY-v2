# 📄 Database Page — Medicine Master Database

**File**: `frontend/src/pages/Database/index.tsx`
**Route**: `/database`
**Tabs**: All Medicines | Catalog Upload
**Risk Level**: 🟡 MED — edits medicines master; affects POS autocomplete + Inventory

---

## What This Page Does

Manages the master medicine catalog (not stock — just the medicine definition):
- Browse/search all medicines in the DB
- Edit medicine name, generic, manufacturer, packaging, category
- Delete medicines (only if no inventory stock)
- Bulk delete with filters
- Upload a catalog CSV/Excel to bulk-import medicines

---

## Data Flow

```
ON MOUNT
  api.getMedicines(page, limit, search, ...)
    →  GET /api/medicines
  Paginated medicine list with filters

USER SEARCHES
  Updates page to 1, re-fetches with new search param

USER EDITS MEDICINE (inline or modal)
  UniversalMedicineEditModal or inline form
  api.updateQuickEditMedicine(id, data)
    →  PUT /api/inventory/medicines/:id/quick-edit
  On save:
    api.getCompactInventory()  →  rebuild POS cache
    queryClient.invalidateQueries(['inventory-list'])

USER DELETES MEDICINE
  api.deleteMedicine(id)  →  DELETE /api/medicines/:id
  On success: refetch medicines list

USER BULK DELETES
  api.bulkDeleteMedicines(data)  →  POST /api/medicines/bulk-delete
  On success: refetch medicines list

TAB: Catalog Upload
  api.uploadCatalogFile(file)  →  POST /api/upload (multipart)
  api.getCatalogJobs()         →  GET /api/jobs
  api.importCatalogJob(id)     →  POST /api/catalog/import-job/:id
  api.pauseCatalogJob(id)      →  POST /api/catalog/job/:id/pause
  api.resumeCatalogJob(id)     →  POST /api/catalog/job/:id/resume
```

---

## What Other Pages See After a Medicine Edit Here

| Page | Effect |
|------|--------|
| **POS** | Updated medicine name in autocomplete |
| **Inventory** | Updated medicine name in stock list |
| **Sells** | Updated medicine name in invoice view |
| **Purchases** | Updated medicine name in purchase list |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/medicines` | Paginated medicine list |
| POST | `/api/medicines` | Create new medicine |
| DELETE | `/api/medicines/:id` | Delete medicine |
| POST | `/api/medicines/bulk-delete` | Bulk delete |
| PUT | `/api/inventory/medicines/:id/quick-edit` | Edit medicine |
| POST | `/api/upload` | Upload catalog file |
| GET | `/api/jobs` | Catalog import job list |
| POST | `/api/catalog/import-job/:id` | Start import |

---

## ⚠️ Agent Notes — Do NOT Break

- `/catalog` route redirects to `/database?tab=catalog`. Tab param must stay `catalog`.
- After editing medicine name/packaging here, `api.getCompactInventory()` MUST be called to keep POS autocomplete current.
- `deleteMedicine` will fail (400/409) if the medicine has active inventory stock. Do not suppress this error — show it to the user.
- Bulk delete filters (search, productName, mrpFilter, etc.) must exactly match what `getMedicines` uses, since the backend applies them identically.
- Catalog upload is a background job — use polling on `getCatalogJobs()` to show progress, not a blocking await.
