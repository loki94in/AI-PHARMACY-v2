# 📄 Dashboard Page — KPI Summary

**File**: `frontend/src/pages/Dashboard/index.tsx`
**Route**: `/dashboard`
**Risk Level**: 🟢 LOW — read-only aggregates; no writes

---

## What This Page Does

Shows a real-time summary of pharmacy performance:
- Today revenue, units sold, purchase cost
- Low-stock alerts, expiry alerts
- Quick stats: total medicines, total patients
- Dismissible alert cards

---

## Data Flow

```
ON MOUNT
  React Query: ['dashboard']
    api.getDashboard()  →  GET /api/dashboard
  Returns: { sales_today, revenue_today, low_stock, expiry_alerts, ... }

USER DISMISSES ALERT
  api.dismissDashboardAlert(id)  →  DELETE /api/dashboard/alerts/:id
  Then: queryClient.invalidateQueries(['dashboard'])

AUTO REFRESH
  Triggered by invalidateAfterStockWrite() from other pages
  No timer polling needed — React Query handles it
```

---

## What Causes Dashboard to Refresh

Any page that calls `invalidateAfterStockWrite()` will cause this page to silently refetch if mounted.

| Trigger | From Page |
|---------|-----------|
| Sale created/deleted | POS, Sells |
| Purchase created/deleted | Purchases |
| Return processed | Returns |
| Inventory edited | Inventory |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/dashboard` | All KPI stats |
| DELETE | `/api/dashboard/alerts/:id` | Dismiss alert |

---

## ⚠️ Agent Notes

- This page is pure read-only. Do NOT add write operations here.
- The `['dashboard']` query key must stay in `cacheInvalidation.ts` so it refreshes after POS/Purchase writes.
- Do not add polling intervals here — use React Query `staleTime` instead.
