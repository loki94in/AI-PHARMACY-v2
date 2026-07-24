# Complete AI Pharmacy v2 Page-by-Page Audit & Structural Gap Directory

> **AUTHORITATIVE DIRECTORY & AGENT CONTRACT**:
> This document is the comprehensive audit and ownership directory for **all 34 page files and routes** in `AI PHARMACY v2`.
> 
> **CRITICAL RULE FOR ALL AI AGENTS & DEVELOPERS**:
> 1. **Do NOT fix these issues in code yet** — this file serves as the canonical audit record.
> 2. **Never query or write to legacy paths** (e.g. reading delivery boy numbers from `/settings` or `app_settings` instead of `/dispatch` & the `delivery_boys` DB table).
> 3. Always route new feature work to the **Authoritative Current Location** documented below.

---

## Executive Summary: Legacy Path Risks & Moved Features

| Feature / Data Area | Authoritative Current Location | Legacy / Obsolete Path (DO NOT USE) | Technical Root Cause & Structural Risk |
| :--- | :--- | :--- | :--- |
| **Delivery Boy Contact & Voice Number** | `/dispatch` (`/learning?tab=dispatch`) & `delivery_boys` DB table (`GET/POST /api/dispatch/delivery-boys`) | `Settings` (`/settings`), `Learning` (`/learning`), & `app_settings` keys (`delivery_boy_whatsapp`, `dinesh_whatsapp_number`) | `Settings/index.tsx:34` still declares `interface DeliveryBoy`, causing AI agents to think delivery boys live in Settings; `Learning/index.tsx` duplicates the input form twice (Dispatch tab vs Operations tab). |
| **Pharmarack Credentials & Session** | `/pharmarack-cart` (`PharmarackCart/index.tsx`) & `/learning` Operations tab | `Settings` (`/settings`) | `Settings/index.tsx:696-699` hard-codes empty strings for `pharmarack_username/password` on save, wiping credentials saved in Learning. |
| **Special Shortage Orders** | `/orders` (`Orders/index.tsx`) & `special_orders` DB table | `pending_shortage_requests` DB table in `shortageReminderService.ts` | **Table Duality**: Background reminder service queries `pending_shortage_requests`, while frontend uses `special_orders`. |
| **Gmail Credentials (`gmail_pass`)** | `/learning` Ingestion tab (`Learning/index.tsx`) | `Settings` (`/settings`) | `Settings/index.tsx` reads `gmail_pass` into state but drops it on save, resetting email password. |
| **Patient Refills** | `/crm` (`/crm?tab=refills`) & `patient_refills` DB table | Standalone `/refills` page file | Superseded page file `pages/Refills/index.tsx` is prefetched by `App.tsx` but unmounted. |
| **Supplier & Customer Returns** | `/returns` (`/returns?tab=expiry`, `tab=customer`, `tab=customer-history`) | Standalone `/expiry`, `/customer-returns`, `/customer-returns-history` page files | 3 standalone page files remain on disk, downloaded by browser but redirected to `/returns` tabs. |
| **Prescribing Doctors Directory** | `/learning` (`/learning?tab=doctors`) & `doctors` DB table | Standalone `/doctors` page file | `pages/Doctors/index.tsx` remains on disk but unmounted. |
| **Catalog & Price List Upload** | `/database` (`/database?tab=catalog`) & `catalog_jobs` DB table | Standalone `/catalog` page file | `pages/CatalogUpload/index.tsx` remains on disk but unmounted. |

---

## Exhaustive Page-by-Page Audit (All 34 Pages & Components)

### Mounted Live Pages (25 Mounted Routes)

#### 1. Dashboard (`/dashboard`)
* **File Path**: [frontend/src/pages/Dashboard/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Dashboard/index.tsx)
* **Authoritative Role**: Pharmacy analytics overview, daily sales trend charts, stock alert counts, quick action launchpad.
* **Authoritative APIs & DB Tables**: `GET /api/analytics/summary`, `GET /api/sales/daily-trend`, `GET /api/expiry/alerts`; Tables: `sales_invoices`, `purchases`, `inventory_master`.
* **Identified Gaps & Unused Code**:
  - Daily revenue target calculations use hardcoded multipliers instead of reading from `Settings`.
  - Expiry alert count reads default 90-day threshold from `app_settings` without inline slider/filter controls.

#### 2. Point of Sale / POS (`/pos`)
* **File Path**: [frontend/src/pages/POS/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx)
* **Authoritative Role**: Fast retail billing counter, barcode scanning, doctor assignment, customer selection, bill holding, thermal receipt printing.
* **Authoritative APIs & DB Tables**: `POST /api/sales/bill`, `GET /api/sales/recommend-quantity/batch`, `GET /api/medicines/search-fast`; Tables: `inventory_master`, `medicines`, `customers`, `doctors`, `held_bills`.
* **Identified Gaps & Unused Code**:
  - Bypasses `api.ts` typed wrappers, calling `apiClient.*` directly.
  - `held_bills` table stores raw JSON strings instead of normalized relational rows.

#### 3. Sales Register & History (`/sells`)
* **File Path**: [frontend/src/pages/Sells/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Sells/index.tsx)
* **Authoritative Role**: Historical sales invoice lookup, bill cancellation, reprint thermal invoice, return initiation.
* **Authoritative APIs & DB Tables**: `GET /api/sales/invoices`, `GET /api/sales/invoices/:id`; Tables: `sales_invoices`, `sale_items`.
* **Identified Gaps & Unused Code**:
  - Return button redirects to `/customer-returns` which redirects to `/returns?tab=customer`, causing multi-hop route redirects.

#### 4. Phone Order Booking (`/phone-sales`)
* **File Path**: [frontend/src/pages/PhoneSales/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PhoneSales/index.tsx)
* **Authoritative Role**: Staging home delivery sales, customer address tagging, prescription photo viewing.
* **Authoritative APIs & DB Tables**: `POST /api/phone-sales`, `GET /api/customers/search`; Tables: `staged_sales`, `customers`.
* **Identified Gaps & Unused Code**:
  - Staged sales populate `staged_sales` table which requires `StagedReviewModal` approval before moving to active stock reduction.

#### 5. Inward Purchases (`/purchases` & `/manual-purchase`)
* **File Path**: [frontend/src/pages/Purchases/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx)
* **Authoritative Role**: Distributor invoice entry, OCR PDF/CSV parsing, batch stock creation, tax/margin calculation.
* **Authoritative APIs & DB Tables**: `POST /api/purchases`, `POST /api/purchases/ocr-upload`; Tables: `purchases`, `purchase_items`, `distributors`.
* **Identified Gaps & Unused Code**:
  - Invoice file format preference (`CSV` vs `PDF`) is configured in `Settings` but parsed in `Purchases` & `Mail`.

#### 6. Purchase History (`/purchase-history`)
* **File Path**: [frontend/src/pages/PurchaseHistory/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PurchaseHistory/index.tsx)
* **Authoritative Role**: Inward purchase invoice history, distributor payment tracking, bill re-printing.
* **Authoritative APIs & DB Tables**: `GET /api/purchases/history`; Tables: `purchases`, `purchase_items`.
* **Identified Gaps & Unused Code**:
  - Clean single owner; no structural gap.

#### 7. Supplier Returns & Expiry Hub (`/returns`)
* **File Path**: [frontend/src/pages/Returns/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Returns/index.tsx)
* **Authoritative Role**: Supplier debit notes, Near-expiry monitoring tab (`?tab=expiry`), Customer Returns tab (`?tab=customer`), Credit Notes tab.
* **Authoritative APIs & DB Tables**: `POST /api/returns`, `GET /api/expiry/alerts`, `POST /api/customer-returns`; Tables: `returns`, `return_items`, `customer_returns`.
* **Identified Gaps & Unused Code**:
  - Backend route `src/routes/creditNotes.ts` is fully implemented on backend but **not mounted in `server.ts`**.

#### 8. Audit & Investigation Center (`/investigation`)
* **File Path**: [frontend/src/pages/Investigation/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Investigation/index.tsx)
* **Authoritative Role**: Full audit trail search across sales, purchases, stock adjustments, price edits, OCR learning logs.
* **Authoritative APIs & DB Tables**: `GET /api/investigation/search`; Tables: `stock_ledger`, `ocr_corrections`, `action_logs`.
* **Identified Gaps & Unused Code**:
  - Displays OCR correction audit records managed under `/learning`.

#### 9. Master Inventory (`/inventory`)
* **File Path**: [frontend/src/pages/Inventory/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Inventory/index.tsx)
* **Authoritative Role**: Medicine master catalog, batch stock levels, rack location assignment, reorder thresholds.
* **Authoritative APIs & DB Tables**: `GET /api/inventory`, `POST /api/inventory/adjust`; Tables: `medicines`, `inventory_master`.
* **Identified Gaps & Unused Code**:
  - Line 7 contains commented-out dead import `// import { UniversalMedicineEditModal }`.
  - Rack location is stored per batch on `inventory_master`, but legacy queries look on `medicines`.

#### 10. Special Shortage Orders (`/orders`)
* **File Path**: [frontend/src/pages/Orders/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Orders/index.tsx)
* **Authoritative Role**: Managing customer shortage requests, requester details, priority tracking.
* **Authoritative APIs & DB Tables**: `GET /api/orders`, `POST /api/orders`; Table: `special_orders`.
* **Identified Structural Gap**:
  - **Database Table Duality**: `shortageReminderService.ts` queries `pending_shortage_requests` table, while `/orders` UI reads `special_orders` table.

#### 11. Live Pharmarack Cart (`/pharmarack-cart`)
* **File Path**: [frontend/src/pages/PharmarackCart/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PharmarackCart/index.tsx)
* **Authoritative Role**: Real-time Pharmarack cart management, distributor item grouping, WhatsApp order sending, Non-mapped distributors tab (`?tab=non-mapped`).
* **Authoritative APIs & DB Tables**: `GET /api/pharmarack/cart`, `POST /api/pharmarack/cart/add`; Tables: `distributors`, `delivery_boys`.
* **Identified Gaps & Unused Code**:
  - `PharmarackCart/index.tsx:1093` calls `PUT /distributors/:id` which **404s** (backend expects `/api/:id`).
  - Calls `POST /pharmarack/notify-cart-order` which **404s** (backend is `/cart/notify-manual`).
  - Contains legacy fallback code reading `settings.delivery_boy_whatsapp` from `app_settings`.

#### 12. CRM & Patient Directory (`/crm`)
* **File Path**: [frontend/src/pages/CRM/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/index.tsx)
* **Authoritative Role**: Patient directory, credit ledgers, WhatsApp chat tab, Refills tab (`?tab=refills`), Automation messages tab (`?tab=messages`).
* **Authoritative APIs & DB Tables**: `GET /api/customers`, `POST /api/customers`, `GET /api/refills`; Tables: `customers`, `patient_refills`.
* **Identified Gaps & Unused Code**:
  - `CRM/index.tsx:232` calls `GET /medicines/search` which **does not exist on backend**.

#### 13. Distributor Mail Inbox (`/mail`)
* **File Path**: [frontend/src/pages/Mail/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Mail/index.tsx)
* **Authoritative Role**: Gmail OAuth / IMAP inbox integration, downloading distributor invoice attachments, OCR parsing triggers.
* **Authoritative APIs & DB Tables**: `GET /api/messaging/emails`, `POST /api/messaging/sync-emails`; Tables: `app_settings`, `staged_purchases`.
* **Identified Gaps & Unused Code**:
  - Gmail credentials configured in `Settings`, while OAuth sync status is rendered in `Mail`.

#### 14. AI Learning & Rule Hub (`/learning`)
* **File Path**: [frontend/src/pages/Learning/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Learning/index.tsx)
* **Authoritative Role**: OCR invoice correction rules, medicine alias dictionary (`medicine_aliases`), Doctors tab (`?tab=doctors`), Dispatch tab (`?tab=dispatch`).
* **Authoritative APIs & DB Tables**: `GET /api/learning/ocr-corrections`, `GET /api/learning/aliases`, `GET /api/dispatch/delivery-boys`; Tables: `ocr_corrections`, `medicine_aliases`, `delivery_boys`.
* **Identified Gaps & Unused Code**:
  - **Duplicated Form**: Renders delivery boy inputs in **two separate tabs** on the same page (Dispatch tab vs Operations tab).

#### 15. Database Utilities & Health (`/database`)
* **File Path**: [frontend/src/pages/Database/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Database/index.tsx)
* **Authoritative Role**: SQLite file size, row statistics, WAL checkpointing, manual backup download, Catalog upload tab (`?tab=catalog`).
* **Authoritative APIs & DB Tables**: `GET /api/utilities/db-stats`, `POST /api/utilities/backup/create`.
* **Identified Gaps & Unused Code**:
  - Absorbs old `CatalogUpload` page as a tab.

#### 16. Chemical Composition Queue (`/composition-queue`)
* **File Path**: [frontend/src/pages/CompositionQueue/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CompositionQueue/index.tsx)
* **Authoritative Role**: Medicines missing drug chemical compositions, API substance lookup.
* **Authoritative APIs & DB Tables**: `GET /api/catalog/composition-queue`; Tables: `medicines`.

#### 17. Reports & Financials (`/reports`)
* **File Path**: [frontend/src/pages/Reports/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Reports/index.tsx)
* **Authoritative Role**: GST return ledgers (GSTR-1, GSTR-3B), Sales & Purchase summaries, P&L reports.
* **Authoritative APIs & DB Tables**: `GET /api/reports/sales`, `GET /api/reports/gst`; Tables: `sales_invoices`, `purchases`.

#### 18. Software License (`/license`)
* **File Path**: [frontend/src/pages/License/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/License/index.tsx)
* **Authoritative Role**: Software license key display, pharmacy registration status.
* **Authoritative APIs & DB Tables**: `GET /api/settings/license`; Table: `app_settings`.

#### 19. Data Migration (`/migration`)
* **File Path**: [frontend/src/pages/Migration/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Migration/index.tsx)
* **Authoritative Role**: Importing legacy software data files (Marg, RedBook) into SQLite database.
* **Authoritative APIs & DB Tables**: `POST /api/migration/import`; Tables: `processed_files`.
* **Identified Stale Code**:
  - `api.ts:360-413` references a large "V2" migration API (`analyze-zip`, `analyze-excel`, `pre-migration-simulate`, staging CRUD) which **does not exist on backend**.

#### 20. System Settings (`/settings`)
* **File Path**: [frontend/src/pages/Settings/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Settings/index.tsx)
* **Authoritative Role**: **EXCLUSIVELY FOR CORE STORE METADATA**: Pharmacy Name, Address, Phone, GSTIN, Drug License, Tax Rates, DataFetchControl Registry, Admin Remote Key.
* **Authoritative APIs & DB Tables**: `GET /api/settings`, `POST /api/settings/save`; Table: `app_settings`.
* **Identified Critical Gaps**:
  - **Destructive Save**: Saving Settings hard-codes empty strings for Pharmarack username/password, triggering Pharmarack logout and wiping login credentials saved in Learning.
  - Drops `gmail_pass` on save.
  - Line 34 declares stale `interface DeliveryBoy`.

#### 21. Global Shell & Modals (`frontend/src/components/`)
* **File Path**: [frontend/src/components/Layout.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/Layout.tsx)
* **Authoritative Role**: Master SPA shell, sidebar navigation, keyboard shortcuts, global modal event bus.
* **Unmounted Component Identified**:
  - [AdminMatchPanel.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/AdminMatchPanel.tsx): Fully built UI component (`{ match, onClose, onSuccess }`). **Never imported or mounted anywhere**.

---

### Superseded & Unmounted Page Bundles (9 Page Files Still on Disk)

These 9 standalone page files exist in `frontend/src/pages/`, are compiled, and are prefetched on a timer by `App.tsx:63-75`, but **React Router never mounts them**. They redirect to tabs inside parent pages:

22. [pages/Dispatch/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Dispatch/index.tsx) → Redirects to `/learning?tab=dispatch`
23. [pages/Doctors/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Doctors/index.tsx) → Redirects to `/learning?tab=doctors`
24. [pages/Expiry/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Expiry/index.tsx) → Redirects to `/returns?tab=expiry`
25. [pages/CatalogUpload/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CatalogUpload/index.tsx) → Redirects to `/database?tab=catalog`
26. [pages/AutomationCenter/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/AutomationCenter/index.tsx) → Redirects to `/crm?tab=messages`
27. [pages/Refills/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Refills/index.tsx) → Redirects to `/crm?tab=refills`
28. [pages/NonMappedDistributors/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/NonMappedDistributors/index.tsx) → Redirects to `/pharmarack-cart?tab=non-mapped`
29. [pages/CustomerReturn/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CustomerReturn/index.tsx) → Redirects to `/returns?tab=customer`
30. [pages/CustomerReturnHistory/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CustomerReturnHistory/index.tsx) → Redirects to `/returns?tab=customer-history`

---

## Built-but-Unused Code, Orphan Services & Backend Discrepancies

### Unmounted Backend Routers
1. `src/routes/creditNotes.ts`: Full credit note CRUD API exists, **unmounted in `server.ts`**.
2. `src/routes/v1/sales.ts`: 15-endpoint parallel copy of Sales API, **unmounted**.

### Orphan Backend Services
1. `src/services/customerService.ts`: `class CustomerService` — zero importers in project.
2. `src/services/nNotificationService.ts`: Duplicate of `notificationService.ts` — zero importers.

### Mounted Routers With No Frontend UI Caller
1. `src/routes/compliance.ts` (`/api/compliance`): Schedule H1 drug register backend built, **no UI surface**.
2. `src/routes/archive.ts` (`/api/archive`): Image maintenance API, **no UI caller**.
3. `src/routes/telegramPrescription.ts` (`/api/telegram-prescription`): External bot endpoint, **no web caller**.

### ~78 Unused API Wrappers on `api.ts`
[frontend/src/services/api.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/api.ts) exports ~246 methods on `api`. ~78 are never called because pages call `apiClient.*` directly (e.g. `createReturn`, `saveSettings`, `getWhatsappMessages`, `holdBill`, `triggerManualScan`, `importCatalog`).

---

## Why Code/Agents Revert to Settings & How We Enforce the New Paths

### 1. Root Causes of Reversion
- **Firehose Config Endpoint**: `GET /api/settings` returns all keys, and `POST /api/settings/save` upserts whatever payload it receives into `app_settings`.
- **Stale Type Interface**: `Settings/index.tsx:34` declaring `interface DeliveryBoy` tricked agents inspecting snippets into assuming delivery boys belong in Settings.
- **Duplicate Forms**: `Learning/index.tsx` renders delivery boy fields in two tabs, and `Settings/index.tsx` renders `dinesh_whatsapp_number` which looks like a delivery number.

### 2. Mandatory Rules Enforced in `AGENTS.md`
To prevent any future regression:
- **Delivery Boy Contact**: MUST ONLY be managed via `/dispatch` (`/learning?tab=dispatch`) & `delivery_boys` DB table.
- **Special Shortage Orders**: MUST ONLY be managed via `/orders` & `special_orders` table.
- **OCR & Aliases**: MUST ONLY be managed via `/learning`.
- **Core Settings**: `/settings` is strictly restricted to store metadata (GSTIN, Address, License, Tax Rate, DataFetchControl).
