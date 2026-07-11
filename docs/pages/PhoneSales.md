# 📄 PhoneSales Page — Tele / WhatsApp Order Processing

**File**: `frontend/src/pages/PhoneSales/index.tsx`
**Route**: `/phone-sales`
**Risk Level**: 🟡 MED — creates sales via LiveCartAddModal (writes inventory + sales)

---

## What This Page Does

Processes orders that come in via phone or WhatsApp message:
- View incoming WhatsApp orders parsed by the message listener
- Review items, adjust quantities
- Confirm and bill via LiveCartAddModal (same as POS)
- Approve or reject staged (offline) sales from mobile devices

---

## Data Flow

```
ON MOUNT
  api.getStagedSales()        →  GET /api/sales/staged
  (pending orders from mobile / WhatsApp)

USER REVIEWS STAGED SALE
  Shows items, patient info, amounts

USER APPROVES STAGED SALE
  api.approveStagedSale(id, data)  →  POST /api/sales/staged/:id/approve
  Backend: creates real sale + deducts inventory
  On success: invalidateAfterStockWrite(queryClient)

USER REJECTS STAGED SALE
  api.rejectStagedSale(id)  →  POST /api/sales/staged/:id/reject

USER OPENS LIVE CART (manual WhatsApp order entry)
  liveCartAddEvent.triggerOpen()  →  dispatches 'app-open-live-cart-add'
  Layout.tsx catches event → opens LiveCartAddModal
  LiveCartAddModal works like POS mini-cart
  On bill finalize: creates sale + invalidateAfterStockWrite
```

---

## Cross-Page Connections

| Connection | Details |
|-----------|---------|
| **POS** | Same billing logic via LiveCartAddModal |
| **Sells** | Approved staged sales appear as invoices |
| **MessageListener** | Parsed messages feed into staged sales |
| **Layout** | LiveCartAddModal lives in Layout.tsx |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/sales/staged` | Staged sale list |
| POST | `/api/sales/staged/:id/approve` | Approve + create real sale |
| POST | `/api/sales/staged/:id/reject` | Reject staged sale |
| POST | `/api/sales` | (via LiveCartAddModal) Create sale |

---

## ⚠️ Agent Notes — Do NOT Break

- `liveCartAddEvent.triggerOpen()` fires a window event — Layout.tsx listens for it and opens the modal. Do not try to render LiveCartAddModal directly inside this page.
- Approving a staged sale must call the `/api/sales/staged/:id/approve` endpoint, NOT `/api/sales` directly — the backend handles deduplication.
- `invalidateAfterStockWrite` must be called after every approval so POS/Inventory/Dashboard refresh.
