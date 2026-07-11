# 📄 Returns Page — Supplier Returns + Expiry + Customer Returns

**File**: `frontend/src/pages/Returns/index.tsx`
**Route**: `/returns`
**Tabs**: Supplier Returns | Expiry Monitor | Customer Returns | Customer History
**Risk Level**: 🟡 MED — writes to inventory (stock restored/removed)

---

## What This Page Does

A tabbed page handling three types of returns:

### Tab 1: Supplier Returns
Return expired/damaged stock back to the distributor.
- Select medicine + batch → select quantity to return
- Creates a return record, REMOVES stock from inventory

### Tab 2: Expiry Monitor
See medicines expiring within N months.
- Filter by date range
- One-click "Create Return" for expiring items
- Export PDF/CSV of expiry report

### Tab 3: Customer Returns
Process returns FROM customers (wrong medicine / unused).
- Search by invoice number → see original sale
- Select items to return → RESTORES stock to inventory

### Tab 4: Customer Return History
View all past customer return records.

---

## Data Flow

```
TAB: Supplier Returns
  api.getReturns(params)         →  GET /api/returns
  api.createReturn(data)         →  POST /api/returns
  api.processReturns(items)      →  POST /api/returns/process-returns
  api.lookupPurchases(name)      →  GET /api/returns/lookup-purchases
  On save: invalidateAfterStockWrite(queryClient)

TAB: Expiry Monitor
  api.getNearExpiry(months)      →  GET /api/returns/near-expiry
  api.createReturnFromExpiry()   →  POST /api/expiry/create-return
  api.exportExpiryReport(params) →  GET /api/expiry/export (blob)
  On return: invalidateAfterStockWrite(queryClient)

TAB: Customer Returns
  api.searchInvoiceForReturn()   →  GET /api/customer-returns/search-invoice
  api.createCustomerReturn(data) →  POST /api/customer-returns
  On save: invalidateAfterStockWrite(queryClient)

TAB: Customer History
  React Query: ['customer-returns-history-list', ...]
  api.getCustomerReturnsHistory() → GET /api/customer-returns/history
```

---

## What Other Pages See After a Return

| Page | Effect |
|------|--------|
| **Inventory** | Stock quantity changes |
| **Dashboard** | Stock value changes |
| **Investigation** | Audit trail for the batch |
| **Reports** | Return amounts show in financials |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/returns` | Supplier returns list |
| POST | `/api/returns` | Create supplier return |
| PUT | `/api/returns/:id` | Update return |
| DELETE | `/api/returns/:id` | Delete return |
| GET | `/api/returns/near-expiry` | Expiry list |
| POST | `/api/returns/process-returns` | Process batch of returns |
| GET | `/api/returns/lookup-purchases` | Find purchase by medicine/batch |
| POST | `/api/expiry/create-return` | Return from expiry tab |
| GET | `/api/expiry/export` | Export expiry PDF/CSV |
| GET | `/api/customer-returns/search-invoice` | Find sale for customer return |
| POST | `/api/customer-returns` | Create customer return |
| GET | `/api/customer-returns/history` | Customer return history |

---

## ⚠️ Agent Notes — Do NOT Break

- Tab state is driven by URL query param `?tab=`. Use `useSearchParams` — do not use internal state for tab switching.
- Routes `/expiry`, `/customer-returns`, `/customer-returns-history` are all redirects to `/returns?tab=...`. Changing the tab param names breaks those redirects.
- `processReturns` is a batch endpoint — do NOT replace it with individual per-item calls (performance rule).
- Customer returns RESTORE stock; supplier returns REMOVE stock. Logic is in backend — do not add frontend stock math.
