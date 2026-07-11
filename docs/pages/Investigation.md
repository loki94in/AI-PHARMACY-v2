# 📄 Investigation Page — Audit Trail Per Batch

**File**: `frontend/src/pages/Investigation/index.tsx`
**Route**: `/investigation`
**Risk Level**: 🟡 MED — can directly edit inventory, sale, purchase records

---

## What This Page Does

A forensic audit tool. For any medicine/batch, shows:
- Full timeline: purchased → sold → returned
- Every transaction touching a batch
- Ability to correct errors directly (edit quantity, fix invoice)
- Audit log of who changed what and when

---

## Data Flow

```
USER SEARCHES MEDICINE / BATCH
  api.searchInvestigation(params)  →  GET /api/investigation/search
  Returns matching inventory records with summary stats

USER CLICKS A BATCH
  api.getInvestigationDetails(inventoryId)  →  GET /api/investigation/details/:id
  Returns: purchase bill, all sales, all returns for that batch

USER VIEWS TIMELINE
  api.getInvestigationTimeline(params)  →  GET /api/investigation/timeline

USER EDITS INVENTORY QUANTITY (direct correction)
  api.updateInvestigationInventory(inventoryId, data)
    →  PUT /api/investigation/inventory/:id
  invalidateAfterStockWrite(queryClient)

USER EDITS A SALE BILL
  api.updateInvestigationSaleBill(invoiceId, data)
    →  PUT /api/investigation/sales/:id
  invalidateAfterStockWrite(queryClient)

USER EDITS A PURCHASE BILL
  api.updateInvestigationPurchaseBill(purchaseId, data)
    →  PUT /api/investigation/purchases/:id
  invalidateAfterStockWrite(queryClient)

USER VIEWS AUDIT LOG
  api.getInvestigationAuditLogs(inventoryId)  →  GET /api/investigation/audit-logs/:id
```

---

## Cross-Page Connections

| Effect Of | Visible Here |
|-----------|-------------|
| POS sale | Timeline shows debit |
| Purchase entry | Timeline shows credit |
| Return processed | Timeline shows credit |
| Direct edit here | Reflected in Sells / PurchaseHistory |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/investigation/search` | Search batches |
| GET | `/api/investigation/timeline` | Timeline of events |
| GET | `/api/investigation/details/:id` | Full batch detail |
| PUT | `/api/investigation/inventory/:id` | Correct stock qty |
| PUT | `/api/investigation/sales/:id` | Correct sale bill |
| PUT | `/api/investigation/purchases/:id` | Correct purchase bill |
| GET | `/api/investigation/audit-logs/:id` | Audit history |

---

## ⚠️ Agent Notes — Do NOT Break

- Edits here are "correction" operations — they bypass normal validation. Use extreme care when changing the PUT endpoint handlers.
- `['investigation-list']` key is in `cacheInvalidation.ts` — all writes from POS/Purchases/Returns cause this page to refresh.
- Audit logs are append-only on the backend. Do not add delete functionality to audit logs.
