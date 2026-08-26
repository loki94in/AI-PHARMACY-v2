# 🏗️ AI Pharmacy v2 — Master Architecture Document

> **For AI Agents**: Read this file FIRST before editing any page. It tells you exactly which pages share data, which query keys are shared, and what breaks when you touch something.

---

## 📁 Project Structure

```
AI PHARMACY v2/
├── frontend/src/
│   ├── App.tsx                     # SPA router — all 21 routes
│   ├── components/
│   │   ├── Layout.tsx              # Shell: sidebar, SSE, toast, held-bills, notifications
│   │   ├── UniversalMedicineEditModal.tsx  # Shared modal — opens from POS, Sells, Purchases
│   │   ├── LiveCartAddModal.tsx    # WhatsApp/phone order entry modal
│   │   ├── QuickOrderModal.tsx     # Quick re-order modal (distributor)
│   │   └── StagedReviewModal.tsx   # Mobile/offline sync review
│   ├── pages/                      # One folder per page
│   ├── services/
│   │   ├── api.ts                  # ALL HTTP calls — single source of truth
│   │   └── events.ts               # Global window event bus
│   └── utils/
│       └── cacheInvalidation.ts    # Shared React Query invalidation
└── docs/                           # You are here
    ├── ARCHITECTURE.md
    ├── LOGICAL_WORKFLOWS_AND_BATCH_PATIENT_SPEC.md # Multi-batch spillover, Purchases & Patient Refills
    ├── pages/                      # Per-page docs
    └── shared/                     # Cross-cutting concerns
```

---

## 🔄 How Data Flows (Summary)

```
User Action (e.g., sell a medicine)
    │
    ▼
Page Component  →  api.ts  →  POST /api/sales  →  Backend  →  SQLite DB
    │
    ▼
invalidateAfterStockWrite(queryClient)
  Invalidates: sells-list, inventory-list, dashboard,
               investigation-list, reports, purchase-history,
               pos-common-combinations, return-history,
               customer-returns-history-list
    │
    ▼
All mounted pages with those queries auto-refetch silently
```

---

## 🌐 Global Event Bus (window events)

| Event Name | Trigger | Listener |
|-----------|---------|----------|
| `app-show-toast` | `toastEvent.trigger()` | Layout.tsx |
| `app-open-quick-order` | `quickOrderEvent.triggerOpen()` | Layout.tsx |
| `app-open-live-cart-add` | `liveCartAddEvent.triggerOpen()` | Layout.tsx |
| `inventory-cache-ready` | `setCompactInventoryCache()` | POS / Purchases autocomplete |

---

## 🗄️ Shared Global In-Memory Cache

`api.ts` module-level variable `compactInventoryCache` (also on `window.__INVENTORY__`):

- Populated by `GET /api/medicines/compact`
- Used by: POS autocomplete, Purchases autocomplete, Returns lookup
- Refreshed after any stock write via `api.getCompactInventory()`
- **Never clear without rebuilding** — it is the source for instant search

---

## 🔑 Shared React Query Keys

All keys are defined in `utils/cacheInvalidation.ts`.
If you add a new query that reads inventory/sales/purchases, add its key there.

| Key | Used By |
|-----|---------|
| `sells-list` | Sells page |
| `inventory-list` | Inventory page |
| `dashboard` | Dashboard |
| `investigation-list` | Investigation |
| `reports` | Reports |
| `pos-common-combinations` | POS (doctor combos) |
| `purchase-history` | PurchaseHistory |
| `purchase-history-list` | PurchaseHistory |
| `return-history` | Returns |
| `customer-returns-history-list` | Returns (customer tab) |

---

## ⚠️ Agent Safety Rules

1. **`api.ts`** — check every page calling any method you change
2. **`cacheInvalidation.ts`** — removing a key causes stale data on that page
3. **`Layout.tsx`** — wraps every page; crash here = whole app broken
4. **`UniversalMedicineEditModal.tsx`** — used in POS, Sells, Purchases
5. **`medicines` table** — affects POS autocomplete, Inventory, Sells, Purchases, Investigation
6. **`inventory` table** — affects POS, Inventory, Dashboard, Reports, Returns, Investigation
7. **`sales` table** — affects Sells, Dashboard, Reports, CRM history, Investigation
8. **Settings writes** — reload-sensitive; do not reload page mid-session from elsewhere

---

## 📋 Page Risk Index

| Page | Route | Shared Data Risk |
|------|-------|-----------------|
| POS | `/pos` | 🔴 HIGH — writes inventory + sales |
| Purchases | `/purchases` | 🔴 HIGH — writes inventory + purchases |
| Migration | `/migration` | 🔴 HIGH — bulk writes all tables |
| Sells | `/sells` | 🟡 MED — reads/edits sales |
| Inventory | `/inventory` | 🟡 MED — reads/edits inventory |
| Returns | `/returns` | 🟡 MED — writes inventory |
| Settings | `/settings` | 🟡 MED — affects all pages indirectly |
| Database | `/database` | 🟡 MED — edits medicines master |
| AIEngineering (Pharma Intelligence) | `/ai-engineering` | 🟡 MED — edits medicines master (composition/schedules/compliance/WA tabs) |
| Investigation | `/investigation` | 🟡 MED — reads all tables |
| PhoneSales | `/phone-sales` | 🟡 MED — triggers sales |
| Dashboard | `/dashboard` | 🟢 LOW — read-only aggregates |
| CRM | `/crm` | 🟢 LOW — patients/refills only |
| Orders | `/orders` | 🟢 LOW — orders table only |
| Reports | `/reports` | 🟢 LOW — read-only |
| Mail | `/mail` | 🟢 LOW — email/attachments only |
| PharmarackCart | `/pharmarack-cart` | 🟢 LOW — external API |
| Learning | `/learning` | 🟢 LOW — doctors/dispatch |
| MessageListener | `/message-listener` | 🟢 LOW — read WhatsApp only |

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Routing | React Router v6 (lazy-loaded SPA) |
| State | React Query (@tanstack/react-query) |
| HTTP | Axios (retry + health-check interceptors) |
| CSS | Tailwind CSS (custom semantic tokens) |
| Backend | Node.js + Express |
| Database | SQLite (local file) |
| Desktop | Electron wrapper |
