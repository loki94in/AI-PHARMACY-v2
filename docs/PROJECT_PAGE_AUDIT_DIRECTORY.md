# Complete AI Pharmacy v2 Page Audit & Feature Ownership Directory

> **System Contract**: This document is the **single source of truth** for all 29 pages, feature locations, database tables, and API contracts in AI Pharmacy v2.
>
> **CRITICAL RULE FOR AI AGENTS & DEVELOPERS**: 
> When modifying code or adding features, **NEVER** introduce legacy fallbacks or query deprecated settings paths (e.g., fetching delivery boy numbers from `/settings` or `app_settings` instead of `/dispatch` & the `delivery_boys` DB table). Always use the **Authoritative New Path** specified for each page below.

---

## Executive Summary of Legacy Path Risks & Structural Discrepancies

| Feature Area | Authoritative New Location | Legacy / Obsolete Path (DO NOT USE) | Found Vulnerability / Risk |
| :--- | :--- | :--- | :--- |
| **Delivery Boy Management** | `/dispatch` (`Dispatch/index.tsx`) & `delivery_boys` DB table (`GET /api/dispatch/delivery-boys`) | `Settings` (`/settings`), `Learning` (`/learning`), & `app_settings` keys (`delivery_boy_whatsapp`, `dinesh_whatsapp_number`) | `Learning/index.tsx` still renders inputs saving to `settingsData.delivery_boy_whatsapp`; `PharmarackCart/index.tsx` and background services fall back to querying `app_settings` for `dinesh_whatsapp_number`. |
| **Special Shortage Orders** | `/orders` (`Orders/index.tsx`) & `special_orders` DB table | `pending_shortage_requests` DB table in `shortageReminderService.ts` | Dual database tables exist for shortage requests. Frontend uses `special_orders`, while background reminder service queries `pending_shortage_requests`. |
| **Patient Refills** | `/refills` (`Refills/index.tsx`) & `patient_refills` DB table | Hardcoded modal calls | Refill alerts and stock holds were previously split across `Layout.tsx` and `Refills`. Unified under `/refills` & `LiveCartAddModal`. |
| **Invoice File Format Config** | `/purchases` (`Purchases/index.tsx`) & `/mail` (`Mail/index.tsx`) | `distributor_invoice_file_format` in `Settings` | Format settings present in `Settings`, but parsing logic is in `Mail` and `Purchases`. |
| **WhatsApp System Config** | `Settings` (`/settings`) & `/messaging` APIs | Hardcoded WhatsApp Web extensions | Dual engines exist: Web extension `postMessage` vs. WhatsApp Business API (`wa_business_access_token`). |

---

## Page-by-Page Comprehensive Audit

---

### 1. Dashboard (`/dashboard`)
* **Component Path**: [pages/Dashboard/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Dashboard/index.tsx)
* **Authoritative Responsibilities**: Executive pharmacy overview, daily sales trend charts, stock alert counts, recent invoice feed, quick action launchpad.
* **Authoritative Data Sources**: `GET /api/analytics/summary`, `GET /api/sales/daily-trend`, `GET /api/expiry/alerts`.
* **Database Tables**: `sales_invoices`, `purchases`, `inventory_master`.
* **Identified Legacy Code / Small Gaps**:
  - Targets for sales & revenue metrics are calculated using hardcoded multipliers rather than configurable settings in `Settings`.
  - Expiry alert count reads default threshold of 90 days from `app_settings`, but doesn't allow inline threshold adjustment.

---

### 2. POS / Point of Sale (`/pos`)
* **Component Path**: [pages/POS/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx)
* **Authoritative Responsibilities**: Real-time sales counter, fast medicine autocomplete, barcode scanning, doctor selection, customer tagging, bill holding, thermal invoice printing.
* **Authoritative Data Sources**: `POST /api/sales/bill`, `GET /api/sales/recommend-quantity/batch`, `GET /api/medicines/search-fast`, `GET /api/doctors`.
* **Database Tables**: `inventory_master`, `medicines`, `customers`, `doctors`, `held_bills`.
* **Identified Legacy Code / Small Gaps**:
  - Uses module-level variable caching for zero layout shift (compliant with SPA contract).
  - Legacy `held_bills` table stores JSON strings instead of relational item references.

---

### 3. Sells / Sales Bills History (`/sells`)
* **Component Path**: [pages/Sells/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Sells/index.tsx)
* **Authoritative Responsibilities**: Sales invoice register, bill searching by invoice number/customer, reprint invoice, sales cancellation, customer return initiation.
* **Authoritative Data Sources**: `GET /api/sales/invoices`, `GET /api/sales/invoices/:id`.
* **Database Tables**: `sales_invoices`, `sale_items`, `customers`.
* **Identified Legacy Code / Small Gaps**:
  - Return button on `/sells` redirects to `/customer-return`, but `/returns` (supplier returns) has a similar name causing route confusion for new developers.

---

### 4. Phone Sales (`/phone-sales`)
* **Component Path**: [pages/PhoneSales/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PhoneSales/index.tsx)
* **Authoritative Responsibilities**: Booking phone orders for delivery, prescription photo viewing, customer delivery address tagging, staging sales for dispatch.
* **Authoritative Data Sources**: `POST /api/phone-sales`, `GET /api/customers/search`.
* **Database Tables**: `customers`, `staged_sales`.
* **Identified Legacy Code / Small Gaps**:
  - Staged phone sales create records in `staged_sales` table which must then be approved in `StagedReviewModal`.

---

### 5. Investigation Center (`/investigation`)
* **Component Path**: [pages/Investigation/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Investigation/index.tsx)
* **Authoritative Responsibilities**: Full audit log search across sales, purchases, stock movements, price changes, and OCR correction logs.
* **Authoritative Data Sources**: `GET /api/investigation/search`, `GET /api/investigation/details`.
* **Database Tables**: `stock_ledger`, `sales_invoices`, `purchase_items`, `ocr_corrections`, `action_logs`.
* **Identified Legacy Code / Small Gaps**:
  - Displays OCR correction audit records that are also managed under `/learning`. Should link to `/learning` for rule edits.

---

### 6. Inventory (`/inventory`)
* **Component Path**: [pages/Inventory/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Inventory/index.tsx)
* **Authoritative Responsibilities**: Master medicine catalog, batch stock view, rack location assignment, manual stock adjustment, reorder level setup.
* **Authoritative Data Sources**: `GET /api/inventory`, `POST /api/inventory/adjust`, `POST /api/inventory/batch-update`.
* **Database Tables**: `medicines`, `inventory_master`.
* **Identified Legacy Code / Small Gaps**:
  - Rack location is stored on `inventory_master` per batch, but some legacy search queries look for `rack_location` on `medicines` table.

---

### 7. Purchases / Inward Bills (`/purchases`)
* **Component Path**: [pages/Purchases/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx)
* **Authoritative Responsibilities**: Inward purchase invoice entry, distributor bill parsing, tax/margin calculation, barcode generation.
* **Authoritative Data Sources**: `POST /api/purchases`, `POST /api/purchases/ocr-upload`.
* **Database Tables**: `purchases`, `purchase_items`, `distributors`.
* **Identified Legacy Code / Small Gaps**:
  - Invoice file format preference (`CSV File Format` vs `PDF`) is configured in `Settings`, but parsed inside `Purchases` and `Mail`.

---

### 8. Purchase History (`/purchase-history`)
* **Component Path**: [pages/PurchaseHistory/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PurchaseHistory/index.tsx)
* **Authoritative Responsibilities**: Historical purchase register, distributor payment tracking, purchase invoice re-printing.
* **Authoritative Data Sources**: `GET /api/purchases/history`.
* **Database Tables**: `purchases`, `purchase_items`, `distributors`.

---

### 9. Distributor Mail / Inbox (`/mail`)
* **Component Path**: [pages/Mail/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Mail/index.tsx)
* **Authoritative Responsibilities**: Distributor email inbox integration (Gmail OAuth/IMAP), auto-downloading invoice attachments, background OCR parser triggering.
* **Authoritative Data Sources**: `GET /api/messaging/emails`, `POST /api/messaging/sync-emails`, `GET /api/reconciliation/list`.
* **Database Tables**: `app_settings` (Gmail credentials), `staged_purchases`.
* **Identified Legacy Code / Small Gaps**:
  - Gmail credentials (`gmail_user`, `gmail_pass`, `google_client_id`) are stored in `Settings`, but OAuth token status is displayed in `Mail`.

---

### 10. Supplier Returns (`/returns`)
* **Component Path**: [pages/Returns/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Returns/index.tsx)
* **Authoritative Responsibilities**: Debit note generation for returning expired, damaged, or overstocked items back to distributors.
* **Authoritative Data Sources**: `POST /api/returns`, `GET /api/returns/history`.
* **Database Tables**: `returns`, `return_items`, `distributors`.

---

### 11. Customer Return & CustomerReturnHistory (`/customer-return` & `/customer-return-history`)
* **Component Path**: [pages/CustomerReturn/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CustomerReturn/index.tsx) & [pages/CustomerReturnHistory/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CustomerReturnHistory/index.tsx)
* **Authoritative Responsibilities**: Processing medicine returns from retail customers, calculating refund amounts, restocking inventory, credit note history.
* **Authoritative Data Sources**: `POST /api/customer-returns`, `GET /api/customer-returns/history`.
* **Database Tables**: `sales_invoices`, `customer_returns`.
* **Identified Legacy Code / Small Gaps**:
  - Split across two separate page routes (`/customer-return` and `/customer-return-history`) while supplier returns are consolidated in a single page (`/returns`).

---

### 12. Special Orders & Requests (`/orders`)
* **Component Path**: [pages/Orders/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Orders/index.tsx)
* **Authoritative Responsibilities**: Customer special shortage requests, requester contact info, priority status (`Pending`, `Ordered`, `Fulfilled`).
* **Authoritative Data Sources**: `GET /api/orders`, `POST /api/orders`, `PUT /api/orders/:id`.
* **Database Tables**: `special_orders`.
* **Verified Status**:
  - **Single Source of Truth**: Backend `shortageReminderService.ts` and frontend `/orders` are fully unified on `special_orders` table.

---

### 13. Pharmarack Cart (`/pharmarack-cart`)
* **Component Path**: [pages/PharmarackCart/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PharmarackCart/index.tsx)
* **Authoritative Responsibilities**: Live Pharmarack order placement, cart item grouping by distributor, batch WhatsApp order sending, left sidebar pending requests & refills launchpad.
* **Authoritative Data Sources**: `GET /api/pharmarack/cart`, `POST /api/pharmarack/cart/add`, `GET /api/dispatch/delivery-boys`.
* **Database Tables**: `distributors`, `delivery_boys`.
* **Verified Status**:
  - **Single Source of Truth**: Resolves delivery boys strictly from `delivery_boys` DB table via `/api/dispatch/delivery-boys`.

---

### 14. Chronic Patient Refills (`/refills`)
* **Component Path**: [pages/Refills/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Refills/index.tsx)
* **Authoritative Responsibilities**: Managing chronic patient medicine refills, calculating next due dates, holding stock, triggering Pharmarack live cart search via `LiveCartAddModal`.
* **Authoritative Data Sources**: `GET /api/refills`, `POST /api/refills`, `PUT /api/refills/:id`.
* **Database Tables**: `patient_refills`.

---

### 15. Dispatch & Delivery Boy Management (`/dispatch`)
* **Component Path**: [pages/Dispatch/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Dispatch/index.tsx)
* **Authoritative Responsibilities**: **EXCLUSIVELY AUTHORITATIVE** home for **Delivery Boy Management** (`delivery_boys` DB table), home delivery assignment, delivery boy WhatsApp numbers, delivery route status.
* **Authoritative Data Sources**: `GET /api/dispatch/delivery-boys`, `POST /api/dispatch/delivery-boys`, `GET /api/dispatch/orders`.
* **Database Tables**: `delivery_boys`, `dispatch_orders`.
* **CRITICAL ARCHITECTURAL CONTRACT**:
  - **Delivery Boy data MUST ONLY be managed on `/dispatch`**.
  - No inputs for Delivery Boys should exist in `Settings` or `Learning`.

---

### 16. AI Learning & OCR Rule Management (`/learning`)
* **Component Path**: [pages/Learning/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Learning/index.tsx)
* **Authoritative Responsibilities**: OCR invoice correction learning rules, medicine name alias mapping (`medicine_aliases`), AI prompt tuning parameters, Telegram Bot configuration (`telegram_enabled`, `telegram_token`, `telegram_chat_id`), WhatsApp Web & Business API configuration, automation toggles, backup channel settings.
* **Authoritative Data Sources**: `GET /api/learning/ocr-corrections`, `GET /api/learning/aliases`, `GET /api/settings`, `POST /api/settings/save`.
* **Database Tables**: `ocr_corrections`, `medicine_aliases`, `ocr_audit_queue`, `app_settings` (for messaging integrations).
* **Identified Legacy Contamination**:
  - **Legacy Field Contamination**: `Learning/index.tsx` still contains legacy input fields editing `settingsData.delivery_boy_name` / `settingsData.delivery_boy_whatsapp` in `app_settings`! These fields belong exclusively to `Dispatch/index.tsx` (`delivery_boys` DB table).

---

### 17. System Settings (`/settings`)
* **Component Path**: [pages/Settings/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Settings/index.tsx)
* **Authoritative Responsibilities**: Pharmacy core metadata (Shop Name, Address, Phone, GSTIN, Drug License), Default Tax Rates, Invoice Prefixes, Backup Frequency, DataFetchControl Registry, Admin Remote Key, Pharmarack Session Credentials, Monthly Report configuration, Notification toggles.
* **Authoritative Data Sources**: `GET /api/settings`, `POST /api/settings/save`.
* **Database Tables**: `app_settings` key-value store.
* **Identified Legacy Field Rot**:
  - `Settings/index.tsx` contains unused state fields (`dineshWhatsappNumber`, `deliveryBoy` interfaces) from before Delivery Boys were moved to `/dispatch`.
* **Scope Note**: Telegram Bot, WhatsApp, and WhatsApp Business API configurations are managed exclusively in Learning (`/learning`), not here.

---

### 18. Customer Relationship Management / CRM (`/crm`)
* **Component Path**: [pages/CRM/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/index.tsx)
* **Authoritative Responsibilities**: Patient & customer directory, phone numbers, total purchase history, pending credit balances, customer WhatsApp communications.
* **Authoritative Data Sources**: `GET /api/customers`, `POST /api/customers`, `GET /api/customers/:id/history`.
* **Database Tables**: `customers`, `sales_invoices`.

---

### 19. Prescribing Doctors Directory (`/doctors`)
* **Component Path**: [pages/Doctors/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Doctors/index.tsx)
* **Authoritative Responsibilities**: Doctor directory, medical council registration numbers, clinic details, prescribing volume analytics.
* **Authoritative Data Sources**: `GET /api/doctors`, `POST /api/doctors`.
* **Database Tables**: `doctors`.

---

### 20. Near-Expiry & Expired Stock (`/expiry`)
* **Component Path**: [pages/Expiry/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Expiry/index.tsx)
* **Authoritative Responsibilities**: Near-expiry medicine monitoring (30/60/90 days), automated discount suggestions, return note creation.
* **Authoritative Data Sources**: `GET /api/expiry/alerts`.
* **Database Tables**: `inventory_master`, `medicines`.

---

### 21. Automation Center (`/automation`)
* **Component Path**: [pages/AutomationCenter/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/AutomationCenter/index.tsx)
* **Authoritative Responsibilities**: Background automation job logs, WhatsApp/Telegram alert logs, automated task execution status.
* **Authoritative Data Sources**: `GET /api/automation/logs`, `GET /api/automation/notifications`.
* **Database Tables**: `automation_notifications`, `action_logs`.

---

### 22. Chemical Composition Queue (`/composition-queue`)
* **Component Path**: [pages/CompositionQueue/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CompositionQueue/index.tsx)
* **Authoritative Responsibilities**: Medicines missing drug chemical compositions, automated API substance lookup queue.
* **Authoritative Data Sources**: `GET /api/catalog/composition-queue`.
* **Database Tables**: `medicines`, `api_substances`.

---

### 23. Catalog & Price List Upload (`/catalog-upload`)
* **Component Path**: [pages/CatalogUpload/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CatalogUpload/index.tsx)
* **Authoritative Responsibilities**: Bulk Excel/CSV distributor catalog importer, column mapping wizard.
* **Authoritative Data Sources**: `POST /api/catalog/upload`, `POST /api/catalog/map`.
* **Database Tables**: `catalog_jobs`, `catalog_mappings`.

---

### 24. Database Utilities & Health (`/database`)
* **Component Path**: [pages/Database/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Database/index.tsx)
* **Authoritative Responsibilities**: SQLite database file size, table row statistics, WAL checkpointing, manual backup download.
* **Authoritative Data Sources**: `GET /api/utilities/db-stats`, `POST /api/utilities/backup/create`.

---

### 25. Software License Status (`/license`)
* **Component Path**: [pages/License/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/License/index.tsx)
* **Authoritative Responsibilities**: AI Pharmacy software license verification, pharmacy registration keys.
* **Authoritative Data Sources**: `GET /api/settings/license`.
* **Database Tables**: `app_settings`.

---

### 26. Software Data Migration (`/migration`)
* **Component Path**: [pages/Migration/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Migration/index.tsx)
* **Authoritative Responsibilities**: Importing legacy software data files (Marg, RedBook) into AI Pharmacy schema.
* **Authoritative Data Sources**: `POST /api/migration/import`.
* **Database Tables**: `processed_files`, `migration_errors`.

---

### 27. Non-Mapped Distributors (`/non-mapped-distributors`)
* **Component Path**: [pages/NonMappedDistributors/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/NonMappedDistributors/index.tsx)
* **Authoritative Responsibilities**: View live Pharmarack cart distributors that lack saved phone numbers or mapped local distributor records.
* **Authoritative Data Sources**: `GET /api/pharmarack/distributors`, `GET /api/distributors`.
* **Database Tables**: `distributors`.

---

### 28. Business Reports & Financials (`/reports`)
* **Component Path**: [pages/Reports/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Reports/index.tsx)
* **Authoritative Responsibilities**: GST returns (GSTR-1, GSTR-3B), Sales & Purchase ledgers, P&L reports, Monthly summary generation.
* **Authoritative Data Sources**: `GET /api/reports/sales`, `GET /api/reports/gst`.
* **Database Tables**: `sales_invoices`, `purchases`.

---

### 29. Global Components & SPA Shell (`frontend/src/components/`)
* **Core Components**:
  - `Layout.tsx`: SPA master shell, sidebar navigation, keyboard shortcuts (Alt+O, Alt+L), modal event bus subscribers.
  - `LiveCartAddModal.tsx`: Global Pharmarack live search and cart addition modal. Supports pre-filled search, quantity, and automatic source order/refill status updating.
  - `QuickOrderModal.tsx`: Rapid barcode / quick order entry modal.
  - `StagedReviewModal.tsx`: Review modal for approving parsed distributor OCR bills into active purchases.
  - `BackupCenterModal.tsx`: Backup creation and restoration center modal.
