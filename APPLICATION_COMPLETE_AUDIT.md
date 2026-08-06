# AI PHARMACY OS — Complete Application Audit

> **Generated**: 2026-08-06 15:30 IST  
> **Target PC**: Windows (i3 3rd Gen optimized)  
> **Runtime**: Node.js + Express 5 (backend) · Vite + React (frontend SPA)  
> **Database**: SQLite via `better-sqlite3`  
> **Port**: 5174 (backend & production SPA) · 5173 (Vite dev HMR)

---

## Table of Contents

1. [Authentication & Password Prompt Audit](#1-authentication--password-prompt-audit)
2. [Complete Application Structure](#2-complete-application-structure)
3. [API Endpoint Registry (435 endpoints)](#3-api-endpoint-registry)
4. [Background Processes, Cron Jobs & setInterval Timers](#4-background-processes-cron-jobs--setinterval-timers)
5. [Resource Usage Profile](#5-resource-usage-profile)
6. [Page-Wise Audit](#6-page-wise-audit)
7. [Feature Status Table (Working / Non-Working)](#7-feature-status-table)
8. [Frontend Hooks Registry](#8-frontend-hooks-registry)
9. [Frontend Event Bus & Trigger Points](#9-frontend-event-bus--trigger-points)
10. [Plugins & External Integrations](#10-plugins--external-integrations)
11. [Data Fetch Control Registry](#11-data-fetch-control-registry)
12. [Backup & Storage Contracts](#12-backup--storage-contracts)
13. [Database Schema & Tables](#13-database-schema--tables)
14. [Security & Middleware Stack](#14-security--middleware-stack)
15. [Worker Processes & Supervisors](#15-worker-processes--supervisors)

---

## 1. Authentication & Password Prompt Audit

### Where the Application Asks for Passwords / Auth Credentials

The application asks for passwords and credentials in **6 distinct locations** across the frontend and backend:

| # | Location | Password Type | Where in Code | How It's Stored | When It's Asked |
|---|----------|--------------|---------------|-----------------|-----------------|
| 1 | **Admin Remote Login** | `admin_password` | `src/routes/security.ts:30` → `POST /api/security/admin/login` | `app_settings` table (`key='admin_password'`, default: `admin123`) | When a mobile device connects to the PC via Admin Remote Operations Mode |
| 2 | **Admin Remote Password Setting** | `admin_password` | `frontend/src/pages/Settings/index.tsx:2032-2042` | `app_settings` table via `PUT /api/settings` | Settings page → "Admin Remote Password" field (type=password) |
| 3 | **Pharmarack Account Password** | `pharmarack_password` | `frontend/src/pages/Learning/index.tsx:2105-2111` | `app_settings` table (`key='pharmarack_password'`) | Learning page → Pharmarack Login section → "Account Password" |
| 4 | **Pharmarack Puppeteer Login** | `pharmarack_password` | `src/routes/pharmarack.ts:515-598` | Scraped from Puppeteer login form, saved to `app_settings` | During headless browser Pharmarack login flow (auto-detected from `input[type=password]`) |
| 5 | **Gmail App Password (IMAP)** | `gmail_pass` / `email_pass` | `frontend/src/pages/Learning/index.tsx:2277-2279` | `app_settings` table (`key='gmail_pass'`/`'email_pass'`) | Learning page → Email Invoice Ingestion → Configure Scanner → "Gmail App Password" |
| 6 | **Gmail OAuth vs App Password Toggle** | `gmail_auth_method` | `frontend/src/pages/Learning/index.tsx:2172-2223` | `app_settings` table (`key='gmail_auth_method'`, values: `'password'`/`'oauth'`) | Learning page → Email Scanner → Auth Method radio buttons |

### Additional Auth Credentials Stored (Not User-Prompted but Programmatic)

| Credential | Key in `app_settings` | Source |
|---|---|---|
| License Session Token | `license_session_token` | Set at license activation, rotated on license check |
| Admin Username | `admin_username` | Default: `admin` (Settings page) |
| Admin Unique Key | `admin_unique_key` | Default: `KEY-ADM-837261` (Settings page) |
| Login Password (legacy) | `login_password` | Default: `admin123` (seeded in `database.ts:1717`) |
| Master Password (legacy) | `master_password` | Default: `master999` (seeded in `database.ts:1718`) |
| Pharmarack Session Token | `pharmarack_session_token` | Captured from Puppeteer cookie jar during login |
| Pharmarack Username | `pharmarack_username` | Scraped from Puppeteer login form |
| WA Business Access Token | `wa_business_access_token` | Configured in Settings |

### Auth Flow Summary

```
LOCAL PC (Main User):
  1. App boots → /api/auth/bootstrap-token
     (fetches session token from DB, stores in localStorage)
  2. Every API call → x-session-token header via interceptor
     (src/middleware/auth.ts validates against DB token)
  3. DEV MODE: SKIP_AUTH=true bypasses ALL auth
     (mock user injected; BLOCKED in production)
  4. Public endpoints (NO auth needed):
     /api/license/*, /api/migration/*, /api/health,
     /api/auth/bootstrap-token, /api/security/admin/login,
     /api/notifications/stream, /api/notifications/register
     /api/medicines/compact

REMOTE MOBILE (Admin Remote Ops):
  1. POST /api/security/admin/login
     Body: { username, password, uniqueKey, deviceId }
     Validates against admin_username, admin_password,
     admin_unique_key in app_settings
     First device auto-registered; second device BLOCKED
     Returns: { sessionToken } for subsequent API calls
```

### Password Storage Concerns

> **WARNING**: All passwords are stored in **plaintext** in the SQLite `app_settings` table. There is no hashing (bcrypt/argon2). This is acceptable for a local desktop app but would be a critical vulnerability in a multi-user/cloud deployment.

---

## 2. Complete Application Structure

### Project Root Tree

```
AI PHARMACY v2/
├── frontend/                  # React SPA (Vite + TypeScript)
│   └── src/
│       ├── App.tsx            # Root router with 23 keep-alive routes
│       ├── components/        # 18 shared components + POS/
│       ├── hooks/             # 11 custom React hooks
│       ├── lib/               # keepAlive, pageImports, queryClient
│       ├── pages/             # 27 page directories (index.tsx each)
│       ├── services/          # api.ts (996L), dataFetchControl.ts, events.ts, stagedQueueService.ts
│       ├── types/             # TypeScript type definitions
│       └── utils/             # 10 utility modules
│
├── src/                       # Express backend (TypeScript via tsx runner)
│   ├── server.ts              # Main Express app + boot sequence (806 lines)
│   ├── bootstrap.ts           # Entry point
│   ├── database.ts            # Schema definition (2019 lines, schema v30)
│   ├── whatsappClient.ts      # WhatsApp Web.js client (44KB)
│   ├── telegramBot.ts         # Telegram Bot service (32KB)
│   ├── extractor.ts           # OCR text extraction
│   ├── config/                # App configuration (dotenv, paths)
│   ├── database/              # Connection manager, messageDAO, migrations
│   ├── license/               # License check, grace policy, machine ID, token store
│   ├── middleware/             # auth, validation, errorHandler, notFoundHandler, asyncHandler
│   ├── routes/                # 43 route files (435 total endpoints)
│   ├── services/              # 56 service files (business logic, background jobs)
│   ├── worker/                # 11 worker files + importers/ + parsers/
│   ├── plugins/               # Empty (reserved)
│   ├── process/               # processGuardian (crash handler)
│   ├── transport/             # Transport layer modules
│   ├── uploads/               # Upload handlers
│   ├── utils/                 # activityTracker, lazyPuppeteer, etc.
│   └── i18n/                  # Internationalization
│
├── data/                      # SQLite database (app.db) + pharmarack_profile/
├── backup/                    # Backup .db.gz files (max 20 retained)
├── uploads/                   # User uploads + temp/
├── scripts/                   # Build scripts, quick-update.mjs
├── tests/                     # Jest test files
├── electron/                  # Electron wrapper (optional)
├── packaging/                 # Inno Setup installer
├── python_scripts/            # SciSpacy medicine extraction
├── gas/                       # Google Apps Script (license server)
└── docs/                      # Documentation
```

### Key File Size Analysis

| File | Size | Lines | Responsibility |
|------|------|-------|---------------|
| `src/database.ts` | 94 KB | 2,019 | Full SQLite schema definition |
| `src/server.ts` | 39 KB | 806 | Express app + boot + cron |
| `src/routes/pharmarack.ts` | 113 KB | ~2,500+ | Pharmarack integration (Puppeteer) |
| `src/routes/purchases.ts` | 112 KB | ~2,400+ | Purchase management |
| `src/routes/sales.ts` | 102 KB | ~2,200+ | Sales/POS endpoints |
| `src/services/emailService.ts` | 134 KB | ~3,000+ | Email IMAP + Gmail integration |
| `src/worker/migrationWorker.ts` | 102 KB | ~2,200+ | Data migration engine |
| `frontend/src/pages/CRM/index.tsx` | 215 KB | ~5,500+ | CRM page (largest frontend page) |
| `frontend/src/pages/POS/index.tsx` | 212 KB | ~5,200+ | Point of Sale page |
| `frontend/src/pages/PharmarackCart/index.tsx` | 179 KB | ~4,400+ | Pharmarack Cart page |
| `frontend/src/pages/Purchases/index.tsx` | 153 KB | ~3,800+ | Purchases page |
| `frontend/src/pages/Learning/index.tsx` | 145 KB | ~3,500+ | Learning / Configuration page |
| `frontend/src/pages/Settings/index.tsx` | 118 KB | ~2,900+ | Settings page |
| `frontend/src/components/Layout.tsx` | 103 KB | ~2,500+ | Main layout (sidebar, topbar, modals) |
| `frontend/src/components/LiveCartAddModal.tsx` | 100 KB | ~2,500+ | Live Pharmarack Cart add modal |
| `frontend/src/services/api.ts` | 60 KB | 996 | Frontend API client (all API methods) |

---

## 3. API Endpoint Registry

**Total registered endpoints: 435** across 43 route files.

### Route Mount Points

| Mount Path | Route File | Category |
|---|---|---|
| `/api/sales` | `sales.ts` | Core — Sales/POS |
| `/api/inventory` | `inventory.ts` | Core — Stock Management |
| `/api/purchases` | `purchases.ts` | Core — Purchase Entry |
| `/api/dashboard` | `dashboard.ts` | Core — Dashboard Stats |
| `/api/returns` | `returns.ts` | Core — Distributor Returns |
| `/api/customer-returns` | `customerReturns.ts` | Core — Customer Returns |
| `/api/credit-notes` | `creditNotes.ts` | Core — Credit Notes |
| `/api/orders` | `orders.ts` | Core — Special Orders |
| `/api/expiry` | `expiry.ts` | Core — Expiry Management |
| `/api/sell-price` | `sellPrice.ts` | Core — Sell Price Config |
| `/api/reports` | `reports.ts` | Core — Reports |
| `/api/compliance` | `compliance.ts` | Core — Compliance/GST |
| `/api/crm` | `crm.ts` | CRM — Patients/Contacts |
| `/api/contacts` | `contacts.ts` | CRM — Contact Management |
| `/api/refills` | `refills.ts` | CRM — Patient Refills |
| `/api/messaging` | `messaging.ts` | Communication — Messages |
| `/api/whatsapp/queue` | `whatsappQueue.ts` | Communication — WA Queue |
| `/api/wa-business` | `whatsappBusiness.ts` | Communication — WA Business API |
| `/api/email` | `email.ts` | Communication — Email/IMAP |
| `/api/email-order-reviews` | `emailOrderReviews.ts` | Communication — Email Orders |
| `/api/telegram-prescription` | `telegramPrescription.ts` | Communication — Telegram |
| `/api/pharmarack` | `pharmarack.ts` | Integration — Pharmarack |
| `/api/settings` | `settings.ts` | Config — App Settings |
| `/api/learning` | `learning.ts` | Config — OCR/Alias Learning |
| `/api/dispatch` | `dispatch.ts` | Operations — Delivery Boys |
| `/api/archive` | `archive.ts` | Operations — Image Archive |
| `/api/migration` | `migration.ts` | Data — Migration/Import |
| `/api/investigation` | `investigation.ts` | Data — Investigation Center |
| `/api/security` | `security.ts` | Auth — Admin Login/Key Rotation |
| `/api/verification` | `verification.ts` | System — DB Health Check |
| `/api/license` | `license.ts` | System — License Management |
| `/api/automation` | `automation.ts` | System — Automation Toggle |
| `/api/system` | `serviceStatus.ts` | System — Service Status |
| `/api/aicamera` | `aiCamera.ts` | AI — Camera OCR |
| `/api/quick-assistant` | `quickAssistant.ts` | AI — Quick Assistant |
| `/api` (generic) | `upload.ts` | Generic — File Upload |
| `/api` (generic) | `catalog.ts` | Generic — Catalog |
| `/api` (generic) | `medicines.ts` | Generic — Medicines |
| `/api` (generic) | `enrichment.ts` | Generic — Data Enrichment |
| `/api` (generic) | `distributors.ts` | Generic — Distributors |
| `/api` (generic) | `notifications.ts` | Generic — SSE/Push |
| `/api` (generic) | `medicineAvailability.ts` | Generic — Availability |

### Key Public (No Auth) Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness check |
| `/api/health/ready` | GET | Schema readiness (503 until ready) |
| `/api/auth/bootstrap-token` | GET | Fetch session token for SPA |
| `/api/license/*` | ALL | License activation/check |
| `/api/migration/*` | ALL | Data import on fresh installs |
| `/api/security/admin/login` | POST | Remote admin login |
| `/api/notifications/stream` | GET | SSE event stream |
| `/api/notifications/register-token` | POST | Push notification token registration |
| `/api/medicines/compact` | GET | Compact medicine list (mobile) |
| `/api/wa-business/webhook` | ALL | WhatsApp Business webhook (public) |

---

## 4. Background Processes, Cron Jobs & setInterval Timers

### Cron Jobs (node-cron)

| Schedule | Service | Description | Idle-Gated | Fetch Control Key |
|---|---|---|---|---|
| `0 9 * * *` | server.ts → refillService, creditNoteService, returnsService, bouncedAlertService | Daily 9AM check: refills, credit notes, bounced products, expiry returns (18th-20th) | Yes | `bg.dailyScans` |
| `0 9 1,16 * *` | server.ts → expiryAlertService | Near-expiry scan & WhatsApp alerts every 15 days at 9AM | Yes | `bg.dailyScans` |
| `30 21 * * *` | server.ts → backupService | Nightly 9:30 PM auto-backup | Yes | `bg.nightlyBackup` |
| `*/15 * * * *` | server.ts → pharmarackCatalogCache | Pharmarack catalog sync every 15 min | Yes | `bg.catalogSync` |
| `* 11 * * *` | server.ts → pharmarackDailyDispatchService | Pharmarack daily batch dispatch (every minute during 11AM hour) | No | — |
| `0 1 * * *` | imageArchiveService | Nightly 1AM image retention cleanup | No | — |
| `0 2 1 * *` | imageArchiveService | Monthly 2AM deep archive cleanup | No | — |
| configurable | backupService | User-configured backup schedule from Settings | No | `settings.backupSchedule` |

### setInterval Timers

| Interval | Service | Description | Fetch Control Key |
|---|---|---|---|
| Every 1 hour | shortageReminderService | Check shortage requests & notify admin | — |
| Every 1 hour | monthlyReportService | Check for 1st/15th month report dispatch | — |
| Every 1 hour | telegramPrescriptionService | Cleanup expired prescription carts | — |
| Every 1 hour | backupRecoveryService | Retry pending cloud backup uploads | — |
| Every 20 min | tokenRefreshScheduler | Pharmarack session token refresh (Puppeteer) | `bg.pharmarackTokenRefresh` |
| Every 15 min | autoMatchWorker | Special order → inventory auto-matching | — |
| Every 10 min | inventoryCache | Rebuild compact inventory cache | `bg.inventoryCache` |
| Every 10 sec | notifications | Device connection heartbeat check | — |
| Every 5 min | emailService | IMAP inbox poll | `bg.emailImapPoll` |
| Every 30 sec | messagingQueue | Process queued WhatsApp/Telegram messages | `bg.messagingQueues` |
| Every 30 sec | whatsappQueue | Process WhatsApp message queue | `bg.messagingQueues` |
| Every 30 sec | orderFulfillmentService | Process order fulfillment queue | — |
| Configurable | catalogWorker | Catalog enrichment pipeline loop | `bg.catalogWorkerLoop` |
| Configurable | stockCalculatorWorker | Stock calculation background worker | — |
| Configurable | substituteCacheWorker | Substitute medicine cache refresh | — |
| Every 5 sec | workerSupervisor | Worker health check | — |
| Configurable | doctorReportingService | Doctor prescription reports scheduler | — |

### Idle Behavior (When App is Idle > 30 min)

When `activityTracker.isIdle()` returns `true` (no API request for 30 minutes, excluding status polls/SSE):

1. **Cron jobs with `mode='manual'`**: SKIP execution entirely
2. **Pharmarack token refresh**: Continues (to prevent session expiry)
3. **Message queues**: Continue processing (messages may arrive anytime)
4. **Device heartbeat**: Continues (10-sec interval)
5. **Backup**: Skipped if mode=manual and idle
6. **Catalog sync**: Skipped if mode=manual and idle

---

## 5. Resource Usage Profile

### Memory (RAM) Estimates

| Component | Estimated RAM Usage | Notes |
|---|---|---|
| **Node.js base** | 60–80 MB | V8 heap baseline |
| **SQLite in-memory cache** | 20–50 MB | Depends on DB size; page cache |
| **Inventory compact cache** | 10–30 MB | All medicines + stock in memory |
| **Medicine FTS5 index** | 5–15 MB | Full-text search trigram index |
| **Puppeteer (Chrome)** | 150–400 MB | Only when Pharmarack browser active |
| **WhatsApp Web.js** | 100–200 MB | Only when WA session active |
| **Telegram Bot** | 5–10 MB | Lightweight polling |
| **Worker Supervisor forks** | 50–100 MB each | catalogWorker, emailPoller (forked processes) |
| **Frontend SPA (browser)** | 80–150 MB | React + all page chunks loaded |
| **IDLE total (no Puppeteer/WA)** | ~150–250 MB | Backend only |
| **ACTIVE total (all services)** | ~500–1000 MB | With Chrome + WA + workers |

### API Call Frequency Profile

| Activity State | Calls/Minute | Calls/Hour | Sources |
|---|---|---|---|
| **Cold boot** | 30–50 burst | — | Schema init, cache warm, prefetch |
| **Active POS use** | 10–30 | 600–1,800 | Medicine search, stock check, invoice save |
| **Background idle** | 2–5 | 120–300 | Device heartbeat (6/min), notification SSE, queue processors |
| **Page navigation** | 3–8 per switch | — | Settings load, page data fetch |
| **Pharmarack session** | 5–15 | 300–900 | Token refresh, catalog sync, cart operations |

### Storage Usage

| Asset | Size | Location |
|---|---|---|
| SQLite database (`app.db`) | 10 MB – 2 GB | `data/app.db` |
| Medicines CSV (reference) | 120 MB | `medicines.csv` |
| Backup files | 5–100 MB each x 20 max | `backup/` |
| Pharmarack Chrome profile | 50–200 MB | `data/pharmarack_profile/` |
| WhatsApp auth session | 10–50 MB | `.wwebjs_auth/` |
| OCR trained data | 5 MB | `eng.traineddata` |
| Upload files | Variable | `uploads/` |
| Node modules | ~400–800 MB | `node_modules/` |
| Frontend build | 5–15 MB | `frontend/dist/` |
| **Estimated total disk** | **1–3 GB** typical | — |

---

## 6. Page-Wise Audit

### All 27 Frontend Pages

| # | Page | Route | File Size (KB) | API Calls on Mount | Caching Strategy | Key Features |
|---|------|-------|---------------:|---------------------|------------------|-------------|
| 1 | **POS** | `/pos` | 207 | 2–4 (settings, inventory compact, combos, special orders) | Module-level cache | Sale billing, medicine search, barcode scan, patient link, invoice print, GST calc, sell price rules |
| 2 | **Dashboard** | `/dashboard` | 17 | 1 (dashboard stats) | React Query (5min stale) | Today's stats, sales chart, quick metrics |
| 3 | **Inventory** | `/inventory` | 47 | 2 (inventory page, special orders) | Infinite scroll + module cache | Stock list, add/edit medicine, batch management, expiry tracking, bulk update |
| 4 | **Purchases** | `/purchases` | 149 | 3 (distributors, history, pending returns) | Module-level cache | OCR scan invoice, manual entry, distributor mapping, purchase bill creation |
| 5 | **Purchase History** | `/purchase-history` | 52 | 1–2 (paginated history) | Infinite scroll | Historical purchase invoices, filter/search |
| 6 | **CRM** | `/crm` | 210 | 3–5 (patients, WA status, contacts) | Module-level cache | Patient management, WhatsApp chat, refills, special orders, messages |
| 7 | **Sells** | `/sells` | 69 | 1–2 (sales history) | Infinite scroll | Sales invoice history, filter, export |
| 8 | **Phone Sales** | `/phone-sales` | 38 | 1–2 | Module-level cache | Phone-based sales entry |
| 9 | **Returns** | `/returns` | 76 | 2 | Module-level cache | Distributor returns, customer returns, expiry returns (tabbed) |
| 10 | **Reports** | `/reports` | 78 | 2 (summary + data) | React Query (5min stale) | Sales/purchase/inventory/doctor reports, charts, export |
| 11 | **Pharmarack Cart** | `/pharmarack-cart` | 175 | 3–5 (cart, pending orders, refills, price history) | Module-level cache | Live Pharmarack cart, order placement, price comparison |
| 12 | **Learning** | `/learning` | 142 | 2–4 (settings, OCR corrections, aliases) | Module-level cache | OCR correction, medicine aliases, email scanner, Telegram bot config, Pharmarack login |
| 13 | **Settings** | `/settings` | 115 | 2 (settings, backup list) | On-mount fetch | Store metadata, tax rate, admin password, data fetch control, backup schedule |
| 14 | **Mail** | `/mail` | 44 | 1–2 (inbox, sync trigger) | On-mount fetch | Email invoice viewer, IMAP sync, invoice processing |
| 15 | **Dispatch** | `/dispatch` | 44 | 1–2 (delivery boys) | On-mount fetch | Delivery boy management, assignment, tracking |
| 16 | **Investigation** | `/investigation` | 93 | 2–3 | Module-level cache | Medicine investigation, composition analysis, substitute finder |
| 17 | **Database** | `/database` | 60 | 1–2 | On-mount fetch | Direct database browser, catalog management |
| 18 | **Compliance** | `/compliance` | 19 | 1 | On-mount fetch | GST compliance reports, drug license |
| 19 | **Migration** | `/migration` | 5 | 0 (upload-driven) | None | Data import from other pharmacy software |
| 20 | **License** | `/license` | 11 | 1 (license status) | On-mount fetch | License activation, status display |
| 21 | **Catalog Upload** | — | 98 | 1–2 | On-mount fetch | Bulk catalog upload with OCR |
| 22 | **Composition Queue** | `/composition-queue` | 30 | 1–2 (enrichment status) | 3s polling when active | API composition enrichment queue monitor |
| 23 | **Sell Price Config** | `/sell-price-config` | 18 | 1 | On-mount fetch | Sell price rules configuration |
| 24 | **Expiry** | redirects to `/returns?tab=expiry` | 34 | — | — | Redirect only |
| 25 | **Customer Return** | legacy (not routed) | 13 | — | — | Legacy; replaced by Returns page tab |
| 26 | **Customer Return History** | legacy (not routed) | 11 | — | — | Legacy; replaced by Returns page tab |
| 27 | **Non-Mapped Distributors** | redirects to `/learning?tab=distributors` | 26 | — | — | Redirect only |

### Route Redirects (Legacy to Current)

| Old Route | Redirects To |
|---|---|
| `/` | `/pos` |
| `/expiry` | `/returns?tab=expiry` |
| `/automation-center` | `/crm?tab=messages` |
| `/refills` | `/crm?tab=refills` |
| `/message-listener` | `/dashboard` |
| `/non-mapped-distributors` | `/learning?tab=distributors` |
| `/doctors` | `/learning?tab=doctors` |
| `/catalog` | `/database?tab=catalog` |
| `/customer-returns` | `/returns?tab=customer` |
| `/customer-returns-history` | `/returns?tab=customer-history` |

---

## 7. Feature Status Table

### WORKING Features (45)

| # | Feature | Page | How It Works | API Endpoints Used |
|---|---------|------|-------------|-------------------|
| 1 | **Medicine Search** | POS | FTS5 trigram search on `medicines` table; prefix + fallback middle-word match | `GET /api/medicines/search` |
| 2 | **Sales Billing / Invoice** | POS | Cart items → `sale_items` + `sales_invoices` insert; stock decrement; GST calc | `POST /api/sales/invoice` |
| 3 | **Sell Price Rules** | POS, Sell Price Config | Configurable margin rules per category/medicine applied at billing time | `GET/POST /api/sell-price/*` |
| 4 | **Barcode Scanning** | POS | JsBarcode rendering + camera scan via AI Camera | `POST /api/aicamera/scan` |
| 5 | **Invoice PDF Generation** | POS, Sells | PDFKit-generated invoice with store branding | `GET /api/sales/invoice/:id/pdf` |
| 6 | **Inventory Management** | Inventory | CRUD on `inventory_master` + batch tracking | `GET/POST/PUT/DELETE /api/inventory/*` |
| 7 | **Purchase Entry (Manual)** | Purchases | Manual bill entry with distributor, items, amounts | `POST /api/purchases` |
| 8 | **Purchase OCR Scan** | Purchases | Tesseract/ONNX OCR on uploaded invoice images | `POST /api/purchases/scan` |
| 9 | **Dashboard Stats** | Dashboard | Aggregation queries on sales, inventory, expiry | `GET /api/dashboard/stats` |
| 10 | **Patient CRM** | CRM | Patient records with prescription history, refill tracking | `GET/POST/PUT /api/crm/*` |
| 11 | **WhatsApp Web.js Integration** | CRM | Direct WhatsApp messaging via whatsapp-web.js library | `GET/POST /api/messaging/*` |
| 12 | **Telegram Bot** | Learning | Prescription photo processing via Telegram | Telegram Bot API |
| 13 | **Special Orders** | CRM, Inventory, POS | Order management for out-of-stock items | `GET/POST/PUT/DELETE /api/orders` |
| 14 | **Distributor Returns** | Returns | Return bill creation against distributors | `GET/POST /api/returns/*` |
| 15 | **Customer Returns** | Returns | Customer return processing with credit notes | `GET/POST /api/customer-returns/*` |
| 16 | **Reports** | Reports | Sales/purchase/inventory/doctor reports with date range | `GET /api/reports/*` |
| 17 | **Backup System** | Settings | SQLite backup → gzip, scheduled + manual + shutdown | `GET/POST /api/settings/backup*` |
| 18 | **Data Migration/Import** | Migration | CSV/Excel import from other pharmacy software | `POST /api/migration/*` |
| 19 | **License System** | License | GAS-based license activation with machine fingerprint | `GET/POST /api/license/*` |
| 20 | **Near-Expiry Alerts** | Returns/Expiry | Automated scan + WhatsApp/Telegram notification | `GET /api/expiry/*` |
| 21 | **Delivery Boy Management** | Dispatch | CRUD on `delivery_boys` table | `GET/POST/PUT/DELETE /api/dispatch/delivery-boys` |
| 22 | **Data Fetch Control** | Settings | Per-feature auto/manual/off toggle for API calls | `GET/PUT /api/settings` |
| 23 | **SSE Notification Stream** | Layout (global) | Server-Sent Events for real-time notifications | `GET /api/notifications/stream` |
| 24 | **Push Notifications** | Layout (global) | Firebase-style push notification registration | `POST /api/notifications/register-token` |
| 25 | **Theme Toggle (Dark/Light)** | Layout (global) | CSS class toggle on `documentElement` | Client-side only |
| 26 | **Keep-Alive Page Caching** | All pages | Visited pages stay mounted in DOM for instant revisit | `KeepAliveOutlet` component |
| 27 | **Lazy Route Loading** | All API routes | Backend routes lazy-loaded on first request (cold boot optimization) | `lazyRoute()` wrapper |
| 28 | **Rate Limiting** | All API routes | 300 req/15min per IP (production) | `express-rate-limit` middleware |
| 29 | **Activity Tracking** | Global | Records last API activity timestamp for idle detection | `activityTracker.recordActivity()` |
| 30 | **Graceful Shutdown** | Global | Auto-backup on SIGINT/SIGTERM + clean shutdown flag | `process.on('SIGINT/SIGTERM')` |
| 31 | **Email Invoice Ingestion** | Mail, Learning | IMAP polling + OCR extraction from email attachments | `GET /api/email/*` |
| 32 | **Investigation Center** | Investigation | Medicine composition analysis, substitute finder, Google search | `GET /api/investigation/*` |
| 33 | **Quick Order Modal** | Layout (global) | Global shortcut for quick special order creation | `QuickOrderModal` component |
| 34 | **Live Cart Add Modal** | Layout (global) | Add items to live Pharmarack cart from any page | `LiveCartAddModal` component |
| 35 | **Medicine Edit Modal** | Layout (global) | Universal inline medicine editor | `UniversalMedicineEditModal` component |
| 36 | **Connected Devices Footer** | Layout (global) | Shows connected mobile/WA devices | `ConnectedDevicesFooterBar` component |
| 37 | **WhatsApp Queue Popover** | Layout (global) | View and manage queued WA messages | `WhatsAppQueuePopover` component |
| 38 | **Refill Tracking** | CRM | Patient medication refill due date tracking | `GET/POST /api/refills/*` |
| 39 | **Credit Notes** | Returns | Auto-generated credit notes for returns | `GET/POST /api/credit-notes/*` |
| 40 | **GST Compliance** | Compliance | GSTIN-based tax reports | `GET /api/compliance/*` |
| 41 | **Mobile App Connection** | Settings | React Native app via relay-server + local network | `MobileConnectionModal` component |
| 42 | **Pharmarack Token Refresh** | Background | 20-min headless Chrome session keepalive | `tokenRefreshScheduler` service |
| 43 | **Admin Remote Operations** | Mobile App | Remote login + device registration | `POST /api/security/admin/login` |
| 44 | **Doctor Reporting** | Learning | Doctor-wise prescription analytics | `doctorReportingService` |
| 45 | **Price Intelligence** | POS, Inventory | Hover tooltip showing price history / market comparison | `HoverPriceIntelTable` component |

### PARTIALLY WORKING / DEGRADED Features (6)

| # | Feature | Issue | Why |
|---|---------|-------|-----|
| 1 | **Pharmarack Cart (Live)** | Session can expire if Chrome profile lock is not cleaned | Chrome `SingletonLock` file conflicts during background refresh |
| 2 | **WhatsApp Web.js** | Requires QR scan on first use; session can go stale | Library limitation; needs manual re-auth when session expires |
| 3 | **Gmail OAuth** | Requires Google Cloud Console setup with client ID/secret | `.env` has placeholder values; OAuth flow not fully self-service |
| 4 | **SciSpacy NER** | Requires Python venv + scispacy model download | Python dependency not auto-installed; needs manual `pip install` |
| 5 | **AI Camera OCR** | ONNX model path must be correct | Model file needs to be placed manually |
| 6 | **Cloud Backup (S3)** | AWS credentials needed | `aws-sdk` dependency present but S3 config not in `.env` |

### NON-WORKING / PLACEHOLDER Features (8)

| # | Feature | Page | Why It Does Not Work |
|---|---------|------|-------------------|
| 1 | **Encryption Key Rotation** | Security | `POST /api/security/rotate-key` is a **placeholder** — only logs to `action_logs`, performs no actual encryption |
| 2 | **WhatsApp Business API** | CRM | Webhook endpoints exist but `wa_business_access_token` and `WHATSAPP_PHONE_NUMBER_ID` are not configured; business API mode is non-functional without Meta Business verification |
| 3 | **PWA Install** | Layout | `usePWAInstall` hook exists but no `manifest.json` or service worker is configured |
| 4 | **Electron Wrapper** | N/A | `electron/` directory exists but no working main process file or build config |
| 5 | **Plugins System** | N/A | `src/plugins/` and root `plugins/` directories are empty — no plugin architecture implemented |
| 6 | **i18n / Localization** | N/A | `src/i18n/` directory exists but no translation files or runtime integration |
| 7 | **SciSpacy Sidecar** | Background | `startScispacySidecar()` called at boot but depends on Python venv that is not part of the install |
| 8 | **OpenFDA API Integration** | Investigation | `OPENFDA_API_KEY` env var defined but not set; fallback to Google Search |

---

## 8. Frontend Hooks Registry

| Hook | File | Purpose | Used By |
|------|------|---------|---------|
| `useApiQuery` | `useApiQuery.ts` | Generic React Query wrapper with error handling | Multiple pages |
| `useContacts` | `useContacts.ts` | Fetch and cache unified contact list | CRM |
| `useDeferredEffect` | `useDeferredEffect.ts` | useEffect with configurable delay | Performance optimization |
| `useFetchMode` | `useFetchMode.ts` | Data fetch control mode reader + override | Pages with manual/auto toggle |
| `useInfiniteScroll` | `useInfiniteScroll.ts` | Paginated infinite scroll with IntersectionObserver | Inventory, Sells, Purchase History |
| `useOnClickOutside` | `useOnClickOutside.ts` | Click-outside handler for dropdowns/modals | Dropdowns, modals |
| `usePageCache` | `usePageCache.ts` | Module-level variable cache for page data | POS, CRM, Purchases |
| `usePersistedDateRange` | `usePersistedDateRange.ts` | LocalStorage-persisted date range filter | Reports, Sells, Purchase History |
| `usePWAInstall` | `usePWAInstall.ts` | Progressive Web App install prompt handler | Layout (non-functional) |
| `useSettingsQuery` | `useSettingsQuery.ts` | Fetch app settings with React Query | Multiple pages |
| `useVirtualizer` | `useVirtualizer.ts` | DOM virtualization for large lists | Tables with 1000+ rows |

---

## 9. Frontend Event Bus & Trigger Points

### Custom Window Events

| Event Name | Trigger Function | Subscriber | Purpose |
|---|---|---|---|
| `app-show-toast` | `toastEvent.trigger()` | `Layout.tsx` | Global toast notification |
| `app-open-quick-order` | `quickOrderEvent.triggerOpen()` | `Layout.tsx` → `QuickOrderModal` | Open quick order modal from any page |
| `app-open-live-cart-add` | `liveCartAddEvent.triggerOpen()` | `Layout.tsx` → `LiveCartAddModal` | Add to Pharmarack cart from any page |
| `refresh-refills` | `refillEvent.triggerRefresh()` | CRM refills tab | Refresh refill data after mutation |
| `app-refills-updated` | `refillEvent.triggerRefresh()` | PharmarackCart | Sync refill status cross-page |
| `app-special-orders-updated` | `specialOrdersEvent.triggerUpdated()` | PharmarackCart | Invalidate special orders cache |

### Backend Event Service

| Event | Emitter | Listener | Purpose |
|---|---|---|---|
| `server_event` (type: `ocr_scan_complete`) | OCR Scan Queue | `whatsappIntentService.handleOcrComplete()` | Route OCR result to WhatsApp intent handler |

---

## 10. Plugins & External Integrations

### Active External Integrations

| Integration | Library / Method | Where Configured | Status |
|---|---|---|---|
| **Pharmarack** | `puppeteer-core` (headless Chrome) | `data/pharmarack_profile/` | Working |
| **WhatsApp Web** | `whatsapp-web.js` | `.wwebjs_auth/` | Working (needs QR) |
| **WhatsApp Business API** | REST API (axios) | `.env` (tokens) | Not configured |
| **Telegram Bot** | `node-telegram-bot-api` | `app_settings` (telegram_token) | Working |
| **Gmail IMAP** | `imap-simple` | `app_settings` (gmail_pass) | Working |
| **Gmail OAuth** | Google OAuth2 | `.env` (client ID/secret) | Placeholder credentials |
| **Google Apps Script** | HTTPS fetch | `LICENSE_SERVER_URL` env | Working |
| **Tesseract OCR** | `tesseract.js` | `eng.traineddata` | Working |
| **ONNX OCR** | `onnxruntime-node` | Model file path | Model not verified |
| **SciSpacy NER** | Python subprocess | `python_scripts/` | Needs manual setup |
| **AWS S3** | `aws-sdk` | `.env` (AWS keys) | Not configured |
| **OpenFDA** | REST API | `OPENFDA_API_KEY` env | Not configured |
| **PaddleOCR** | `paddleocr` npm | In code | Installed, usage unclear |
| **PDF Generation** | `pdfkit` + `pdfjs-dist` | In code | Working |
| **Barcode** | `jsbarcode` + `qrcode` | In code | Working |
| **Excel** | `xlsx` | In code | Working |

### Internal Plugin System

- `src/plugins/` — **Empty directory**
- `plugins/` — **Empty directory**
- No plugin architecture or plugin loading mechanism exists

---

## 11. Data Fetch Control Registry

The app has a centralized fetch control system with 30 registered entries:

| Key | Label | Page | Default Mode | External |
|---|---|---|---|---|
| `pos.specialOrders` | POS Special Orders | POS | manual | No |
| `pos.combinations` | POS Combos & Quantity Batch | POS | manual | No |
| `pos.doctors` | POS Doctors List | POS | manual | No |
| `inv.list` | Inventory Paged List | Inventory | auto | No |
| `inv.specialOrders` | Inventory Special Orders | Inventory | manual | No |
| `purch.distributors` | Purchases Distributors | Purchases | auto | No |
| `purch.history` | Purchases History | Purchases | auto | No |
| `purch.pendingReturns` | Purchases Pending Returns | Purchases | auto | No |
| `crm.patients` | CRM Patients | CRM | auto | No |
| `crm.waStatusPoll` | CRM WhatsApp Status 5s Poll | CRM | manual | No |
| `crm.waSse` | CRM SSE Stream | CRM | off | No |
| `dash.stats` | Dashboard Stats | Dashboard | auto | No |
| `pharmarack.cart` | Live Pharmarack Cart | Pharmarack | manual | Yes |
| `pharmarack.pendingOrders` | Pharmarack Pending Orders | Pharmarack | manual | Yes |
| `pharmarack.refills` | Pharmarack Refills | Pharmarack | manual | Yes |
| `pharmarack.priceHistory` | Pharmarack Price History | Pharmarack | manual | Yes |
| `layout.enrichmentPoll` | Global Enrichment 5s Poll | Layout | off | No |
| `layout.hoverPrefetch` | Nav Hover Prefetch | Layout | off | No |
| `mail.inboxRefresh` | Mail Inbox Refresh | Mail | auto | No |
| `mail.imapSync` | Mail IMAP 2-min Sync | Mail | off | Yes |
| `composition.statusPoll` | Enrichment Status 3s Poll | Composition | auto | No |
| `learning.qrPoll` | Learning QR 5s Poll | Learning | auto | No |
| `settings.backupList` | Settings Backup List | Settings | manual | No |
| `settings.backupSchedule` | Settings Backup Schedule | Settings | manual | No |
| `bg.pharmarackTokenRefresh` | Pharmarack Token Refresh | Backend | auto | Yes |
| `bg.nightlyBackup` | Nightly Backup | Backend | off | No |
| `bg.dailyScans` | Daily Stock/Expiry Scans | Backend | off | No |
| `bg.catalogSync` | 3AM Catalog Sync | Backend | off | No |
| `bg.emailImapPoll` | Email IMAP 5-min Poll | Backend | off | Yes |
| `bg.messagingQueues` | Messaging 30s Queues | Backend | auto | No |
| `bg.inventoryCache` | 10-min Inventory Cache Rebuild | Backend | auto | No |
| `bg.catalogWorkerLoop` | Catalog Worker Loop | Backend | auto | No |

---

## 12. Backup & Storage Contracts

### Backup Mechanisms

| Type | Trigger | Schedule | Max Retained | Format |
|---|---|---|---|---|
| Manual backup | User clicks "Create Backup" in Settings | On demand | 20 | `.db.gz` |
| Nightly backup | Cron `30 21 * * *` | 9:30 PM daily | 20 | `.db.gz` |
| Scheduled backup | User-configured cron expression | Configurable | 20 | `.db.gz` |
| Shutdown backup | SIGINT / SIGTERM signal | Every clean shutdown | 20 | `.db.gz` |
| Cloud backup | S3 upload (Recovery Service) | Hourly retry | — | `.db.gz` to S3 |

### Backup Process

1. Use `better-sqlite3` native `.backup()` API (safe checkpoint of WAL)
2. Compress with Node.js stdlib `zlib.createGzip()`
3. Enforce 20-file retention (oldest deleted)
4. Log to `action_logs` table

### Data Storage Locations

| Data | Path (Dev) | Path (Packaged) |
|---|---|---|
| Database | `data/app.db` | `%LOCALAPPDATA%/AI Pharmacy OS/data/app.db` |
| Backups | `backup/` | `%LOCALAPPDATA%/AI Pharmacy OS/backup/` |
| Uploads | `uploads/` | `%LOCALAPPDATA%/AI Pharmacy OS/uploads/` |
| Pharmarack Profile | `data/pharmarack_profile/` | `%LOCALAPPDATA%/AI Pharmacy OS/data/pharmarack_profile/` |
| WhatsApp Auth | `.wwebjs_auth/` | `%LOCALAPPDATA%/AI Pharmacy OS/.wwebjs_auth/` |

---

## 13. Database Schema & Tables

**Schema Version**: 30
**Engine**: SQLite via `better-sqlite3`
**Key Tables** (verified in `verificationService.ts` and `database.ts`):

| Table | Purpose |
|---|---|
| `medicines` | Master medicine catalog (name, composition, MRP, etc.) |
| `inventory_master` | Stock with batch, expiry, quantity, sell price |
| `sales_invoices` | Sale invoice headers |
| `sale_items` | Sale invoice line items |
| `customers` | Patient/customer records |
| `doctors` | Doctor records for prescriptions |
| `app_settings` | Key-value configuration store (passwords, tokens, flags) |
| `action_logs` | Audit trail of all system actions |
| `purchases` | Purchase bill headers |
| `purchase_items` | Purchase bill line items |
| `special_orders` | Special/shortage order requests |
| `delivery_boys` | Delivery personnel |
| `ocr_corrections` | OCR correction learning data |
| `medicine_aliases` | Medicine name alias mapping |
| `refills` | Patient refill schedule tracking |
| `credit_notes` | Credit notes for returns |
| `returns` | Distributor return records |
| `customer_returns` | Customer return records |
| `distributor_mapping` | Distributor name mapping |
| `contacts` | Unified contact directory |
| `messages` | WhatsApp/Telegram message store |
| `medicine_reference` | API identity reference dictionary |
| `medicines_fts` | FTS5 full-text search index (virtual table) |

---

## 14. Security & Middleware Stack

### Middleware Pipeline (Order)

1. **compression** — Gzip response compression
2. **Activity Tracker** — Record last API activity time
3. **helmet** — Security headers (CSP disabled for SPA)
4. **CORS** — Whitelist localhost + private network IPs
5. **Rate Limiter** — 300 req/15min/IP (production; skipped for dev, migration, notifications)
6. **JSON Parser** — 15MB body limit
7. **Static Files** — `/uploads`, `/data/search_screenshots`
8. **Schema Ready Gate** — 503 until `ensureSchema()` completes
9. **Bootstrap Token** — `GET /api/auth/bootstrap-token` (public)
10. **Auth Middleware** — `authenticateApiKey()` for all other `/api` routes
11. **Route Handlers** — 43 lazy-loaded route modules
12. **SPA Fallback** — Serve `index.html` for client-side routes
13. **404 Handler** — `notFoundHandler`
14. **Error Handler** — `errorHandler`

### Security Observations

| Item | Status |
|---|---|
| Passwords hashed | No — Plaintext in `app_settings` |
| Rate limiting | Yes — 300/15min (production) |
| Helmet headers | Yes — Enabled (CSP off for SPA) |
| CORS | Yes — Whitelist-based |
| CSRF protection | No — Not implemented (acceptable for desktop SPA) |
| Session token rotation | Yes — Rotated on license check |
| Input validation middleware | Yes — `validation.ts` available (not universally applied) |
| SQL injection prevention | Mostly — Parameterized queries used in most places |
| Auth bypass safeguard | Yes — `SKIP_AUTH=true` blocked in production |

---

## 15. Worker Processes & Supervisors

### Worker Supervisor Architecture

The `workerSupervisor.ts` manages child processes with health checks:

| Worker | File | Type | Interval | Purpose |
|---|---|---|---|---|
| **Catalog Worker** | `catalogWorker.ts` (47KB) | Forked process | Configurable | Medicine enrichment pipeline (composition, API lookup) |
| **Email Poller** | `emailPoller.ts` | Forked process | 5 min | Background IMAP email polling |
| **Stock Calculator** | `stockCalculatorWorker.ts` | In-process | Configurable | Inventory stock aggregation |
| **Substitute Cache** | `substituteCacheWorker.ts` | In-process | Configurable | Substitute medicine pre-computation |
| **Auto Match** | `autoMatchWorker.ts` | In-process | 15 min | Special order to inventory matching |
| **Composition Enricher** | `compositionEnricher.ts` | In-process | On-demand | API composition data enrichment |
| **Migration Worker** | `migrationWorker.ts` (102KB) | On-demand | — | Bulk data import processor |
| **Security Worker** | `securityWorker.ts` | On-demand | — | Security-related background tasks |

### Worker Supervisor Features

- **Health check interval**: 5 seconds
- **Auto-restart**: Yes (on unexpected exit)
- **Graceful stop**: Kills all workers on SIGINT/SIGTERM
- **Self-healing**: Enabled by default (`DISABLE_SELF_HEALING_WORKERS=false`)

---

## Summary Statistics

| Metric | Value |
|---|---|
| Total frontend pages | 27 (23 active routes + 4 redirects) |
| Total API endpoints | 435 |
| Total backend route files | 43 |
| Total backend service files | 56 |
| Total backend worker files | 11 |
| Total frontend hooks | 11 |
| Total frontend components | 18+ |
| Total cron jobs | 8 |
| Total setInterval timers | 17+ |
| Total data fetch control entries | 30 |
| Total npm dependencies | 38 production + 29 dev |
| Database schema version | 30 |
| Database tables | 23+ |
| Password/auth prompt points | 6 |
| Plaintext passwords stored | 5 types |
| External integrations | 15 |
| Working features | 45 |
| Partially working features | 6 |
| Non-working/placeholder features | 8 |

---

*This audit document is a point-in-time snapshot. Run `node scripts/quick-update.mjs` after any code changes to keep the knowledge graph synchronized.*
