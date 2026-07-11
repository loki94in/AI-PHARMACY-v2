# 📄 Learning Page — Doctors & Dispatch

**File**: `frontend/src/pages/Learning/index.tsx`
**Route**: `/learning`
**Tabs**: Doctors | Dispatch
**Risk Level**: 🟢 LOW — isolated doctors/dispatch tables

---

## What This Page Does

### Tab 1: Doctors
- Add/edit/delete doctor profiles (name, phone, specialty)
- View medicine combination suggestions per doctor (based on past prescriptions)
- Send daily prescription reports to doctors via WhatsApp

### Tab 2: Dispatch
- Manage delivery boys (name, WhatsApp, Telegram)
- View dispatch orders assigned to delivery personnel
- Track delivery status

---

## Data Flow

```
TAB: Doctors
  api.getDoctors()              →  GET /api/crm/doctors
  api.addDoctor(data)           →  POST /api/crm/doctors
  api.updateDoctor(id, data)    →  PUT /api/crm/doctors/:id
  api.deleteDoctor(id)          →  DELETE /api/crm/doctors/:id
  api.getDoctorSuggestions(id)  →  GET /api/crm/doctors/:id/suggestions
  api.sendDailyDoctorReports()  →  POST /api/crm/doctors/send-daily-reports

TAB: Dispatch
  api.getDispatchOrders()       →  GET /api/dispatch/orders
  api.createDispatchOrder(data) →  POST /api/dispatch/orders
  api.updateDispatchOrder(id)   →  PUT /api/dispatch/orders/:id
  api.deleteDispatchOrder(id)   →  DELETE /api/dispatch/orders/:id
  api.getDeliveryBoys()         →  GET /api/dispatch/delivery-boys
  api.addDeliveryBoy(data)      →  POST /api/dispatch/delivery-boys
  api.updateDeliveryBoy(id)     →  PUT /api/dispatch/delivery-boys/:id
  api.deleteDeliveryBoy(id)     →  DELETE /api/dispatch/delivery-boys/:id
```

---

## Route Redirects

- `/doctors` → `/learning?tab=doctors`
- `/dispatch` → `/learning?tab=dispatch`

---

## Cross-Page Connections

| Connection | Details |
|-----------|---------|
| **POS** | POS links bills to doctors; `pos-common-combinations` tracks doctor+medicine pairs |
| **PharmarackCart** | Delivery boys may be notified of cart orders |

---

## ⚠️ Agent Notes

- Doctor combination suggestions are ML-derived from POS billing history. They are read-only here — do not add a way to manually edit combinations.
- Dispatch orders are created from POS (when a delivery is needed) and managed here. Do not duplicate order creation logic.
- `/doctors` and `/dispatch` are redirect routes — do not create new separate page components for them.
