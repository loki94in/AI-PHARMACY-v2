# 📄 PurchaseHistory Page — Purchase Ledger

**File**: `frontend/src/pages/PurchaseHistory/index.tsx`
**Route**: `/purchase-history`
**Risk Level**: 🟢 LOW — read-only list with PDF export

---

## What This Page Does

A read-only ledger of all supplier purchases with:
- Filter by date range, distributor, search term
- View each purchase invoice items
- Download purchase invoice PDF
- Reconciliation tab (check if emailed orders were received)

---

## Data Flow

```
ON MOUNT
  React Query: ['purchase-history', filters]
    api.getPurchases(params)  →  GET /api/purchases
  api.getEarliestPurchaseDate()  →  GET /api/purchases/earliest-date
  (sets the min date in date picker)

USER CLICKS PURCHASE
  api.getPurchase(id)  →  GET /api/purchases/:id
  Shows full invoice with items

USER DOWNLOADS PDF
  api.getPurchasePDF(id)  →  GET /api/purchases/:id/pdf  (blob)
  Browser download

RECONCILIATION TAB
  api.getReconciliationList()  →  GET /api/purchases/reconciliation
  api.reissueOrder(emailUid)   →  POST /api/purchases/reconciliation/reissue
  api.resolveOrderManually()   →  POST /api/purchases/reconciliation/resolve
```

---

## Cross-Page Connections

| Connection | Details |
|-----------|---------|
| **Purchases** | Writes create entries shown here |
| **Investigation** | Purchase bill can be corrected from Investigation |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/purchases` | Paginated purchase list |
| GET | `/api/purchases/:id` | Single purchase detail |
| GET | `/api/purchases/:id/pdf` | PDF invoice download |
| GET | `/api/purchases/earliest-date` | Oldest purchase date for filter |
| GET | `/api/purchases/reconciliation` | Reconciliation list |
| POST | `/api/purchases/reconciliation/reissue` | Reissue email order |
| POST | `/api/purchases/reconciliation/resolve` | Manual resolve |

---

## ⚠️ Agent Notes

- `['purchase-history']` and `['purchase-history-list']` are both in `cacheInvalidation.ts`. Keep both — they are used by different parts of the page.
- PDF download uses `responseType: 'blob'` in Axios. Do not change to text or JSON.
- This page does NOT allow editing purchases — that is done in the `Purchases` page. Redirect users there if they ask to edit.
