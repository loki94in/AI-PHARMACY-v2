# 📄 CRM Page — Patients, Refills & Automation

**File**: `frontend/src/pages/CRM/index.tsx`
**Route**: `/crm`
**Tabs**: Patients | Refills | Automation
**Risk Level**: 🟢 LOW — isolated patient/refill tables; no inventory impact

---

## What This Page Does

Manages patient relationships and automated reminders:

### Tab 1: Patients
- Add/edit/delete patients (name, phone, address)
- View full purchase history per patient
- Link patients to POS billing

### Tab 2: Refills
- Set up recurring medicine reminders per patient
- Send WhatsApp refill reminder manually
- Skip / fulfill / acknowledge refill entries
- Convert special orders to refills

### Tab 3: Automation Logs
- See all sent notifications (WhatsApp, email)
- Retry failed notifications
- Cancel pending notifications

---

## Data Flow

```
TAB: Patients
  api.getPatients(params)        →  GET /api/crm/patients
  api.addPatient(data)           →  POST /api/crm/patients
  api.updatePatient(id, data)    →  PUT /api/crm/patients/:id
  api.deletePatient(id)          →  DELETE /api/crm/patients/:id
  api.getPatientHistory(id)      →  GET /api/crm/:id/history

TAB: Refills
  api.getRefillsPanel()          →  GET /api/refills/panel
  api.sendRefillNow(id)          →  POST /api/refills/:id/send
  api.acknowledgeRefill(id)      →  POST /api/refills/:id/acknowledge
  api.skipRefill(id)             →  POST /api/refills/:id/skip
  api.fulfillRefill(id)          →  POST /api/refills/:id/fulfill
  api.toggleRefillOverride(id)   →  POST /api/refills/:id/toggle-override
  api.deleteRefill(id)           →  DELETE /api/refills/:id

TAB: Automation
  api.getAutomationNotifications(params)  →  GET /api/automation/notifications
  api.retryNotification(id)              →  POST /api/automation/notifications/:id/retry
  api.cancelNotification(id)             →  POST /api/automation/notifications/:id/cancel
```

---

## Cross-Page Connections

| Connection | Direction | Details |
|-----------|-----------|---------|
| **POS** | POS → CRM | POS links a patient to a sale; history shows in CRM |
| **Sells** | Sells → CRM | Patient-linked invoices visible in history |
| **Orders** | Orders → CRM | Special orders can be converted to refills |
| **Layout** | CRM → Layout | Automation notifications shown in Layout badge |

---

## Route Redirects

- `/automation-center` → `/crm?tab=automation`
- `/refills` → `/crm?tab=refills`

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/crm/patients` | Patient list |
| POST | `/api/crm/patients` | Add patient |
| PUT | `/api/crm/patients/:id` | Update patient |
| DELETE | `/api/crm/patients/:id` | Delete patient |
| GET | `/api/crm/:id/history` | Patient purchase history |
| GET | `/api/refills/panel` | Refill dashboard |
| POST | `/api/refills/:id/send` | Send reminder now |
| GET | `/api/automation/notifications` | Automation log |
| POST | `/api/automation/notifications/:id/retry` | Retry failed |

---

## ⚠️ Agent Notes — Do NOT Break

- Tab switching uses `?tab=` URL param. Do not replace with internal state.
- The `/refills` and `/automation-center` redirect routes must continue pointing to this page.
- Refill scheduling runs in the **backend** (cron job) — the frontend only displays and triggers manually. Do not add any timer-based sending logic to the frontend.
- Patient phone numbers are used by WhatsApp automation — format must match `+91XXXXXXXXXX`. Do not strip leading `+91` from stored values.
