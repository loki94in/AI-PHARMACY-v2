# 📄 Orders Page — Special / Advance Orders

**File**: `frontend/src/pages/Orders/index.tsx`
**Route**: `/orders`
**Risk Level**: 🟢 LOW — isolated orders table; no inventory impact

---

## What This Page Does

Tracks special orders placed on behalf of customers:
- Customer asks for a medicine not in stock
- Pharmacist creates an order → medicine is procured and kept aside
- When collected, order is marked fulfilled
- Can convert to a recurring refill

---

## Data Flow

```
ON MOUNT
  api.getOrders()           →  GET /api/orders
  api.getUncollectedAlerts()  →  GET /api/orders/uncollected-alerts
  (shows alerts for uncollected orders past due date)

USER CREATES ORDER
  api.createOrder(data)     →  POST /api/orders

USER UPDATES ORDER STATUS
  api.updateOrder(id, data) →  PUT /api/orders/:id

USER DELETES ORDER
  api.deleteOrder(id)       →  DELETE /api/orders/:id

USER CONVERTS TO REFILL
  api.convertToRefill(orderId, refillIntervalDays)
    →  POST /api/orders/convert-to-refill
  Creates a refill entry in CRM
```

---

## Cross-Page Connections

| Connection | Details |
|-----------|---------|
| **CRM** | Converted orders become refill entries |
| **Layout** | Uncollected order alerts shown in sidebar badge |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/orders` | All special orders |
| POST | `/api/orders` | Create order |
| PUT | `/api/orders/:id` | Update status |
| DELETE | `/api/orders/:id` | Delete |
| GET | `/api/orders/uncollected-alerts` | Past-due uncollected |
| POST | `/api/orders/convert-to-refill` | Convert to CRM refill |

---

## ⚠️ Agent Notes

- Orders do NOT deduct inventory. Stock is only deducted at POS when the customer collects.
- `convertToRefill` creates an entry in the `refills` table — ensure CRM refill tab will show it correctly.
- Uncollected alerts are loaded by Layout.tsx too for the sidebar badge. Ensure badge count stays in sync.
