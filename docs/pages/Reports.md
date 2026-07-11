# 📄 Reports Page — Financial Reports

**File**: `frontend/src/pages/Reports/index.tsx`
**Route**: `/reports`
**Risk Level**: 🟢 LOW — read-only; no writes

---

## What This Page Does

Generates financial and operational reports over a date range:
- Sales summary (revenue, units, discounts)
- Purchase summary (cost, distributors)
- GST report (tax collected/paid)
- Profit & Loss estimate
- Top medicines by quantity / revenue
- Export PDF / Excel

---

## Data Flow

```
ON MOUNT / DATE CHANGE
  React Query: ['reports', fromDate, toDate]
    api.getReportsSummary(params)  →  GET /api/reports
  Returns summary cards

USER CLICKS A REPORT TYPE
  api.getReportsData({ type, fromDate, toDate })  →  GET /api/reports/data
  Renders detailed table / chart

USER EXPORTS PDF
  api.exportReportsPDF(params)  →  GET /api/reports/export-pdf  (blob)
  Triggers browser download

USER EXPORTS EXCEL
  api.exportReportsExcel(params)  →  GET /api/reports/export-excel  (blob)
  Triggers browser download
```

---

## What Causes Reports to Refresh

`invalidateAfterStockWrite()` includes the `reports` key — so any sale, purchase, or return will cause this page to silently refetch if mounted.

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/reports` | Summary stats |
| GET | `/api/reports/data` | Detailed report by type |
| GET | `/api/reports/export-pdf` | PDF download (blob) |
| GET | `/api/reports/export-excel` | Excel download (blob) |

---

## ⚠️ Agent Notes

- All report data is computed server-side. Do not add frontend aggregation logic.
- `['reports']` key is in `cacheInvalidation.ts` — keep it there.
- Blob downloads: use `URL.createObjectURL()` + anchor click — do not open in new tab (breaks in Electron).
