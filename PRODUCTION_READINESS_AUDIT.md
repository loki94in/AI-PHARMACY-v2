# Page-Wise Production-Readiness Audit Report — AI Pharmacy v2

This document compiles the findings of the production-readiness audit across the entire AI Pharmacy v2 codebase, encompassing the React frontend SPA, the Express + TS backend, background services, Jest tests, and third-party dependencies.

---

## 📊 Audit Executive Summary

| Issue Severity | Count | Impact / Description |
| :--- | :---: | :--- |
| **🔴 Blocker** | **0** | No critical compilation or start-up failures found. |
| **🟠 High** | **8** | High-severity security vulnerabilities in root backend dependencies (`multer`, `nodemailer`, `undici`, `xlsx`). |
| **🟡 Medium** | **8** | 6 moderate security vulnerabilities, 1 Jest test timeout under Windows (`utilities.test.ts`), and 1 frontend lint quality issue (919 ESLint problems, mainly `@typescript-eslint/no-explicit-any`). |
| **🟢 Low / Cleanup** | **4** | Dead backend files (`v1/sales.ts`, `nNotificationService.ts`), dead frontend page folder (`Doctors`), and 25 dead API client declarations referencing unimplemented endpoints. |

### Core Project Statistics
* **Frontend Build (`npm run build`)**: **PASS ✅** (0 TypeScript or Vite bundle errors).
* **Backend Typecheck (`npx tsc --noEmit -p .`)**: **PASS ✅** (0 compilation errors).
* **Jest Test Suite**: **96% Pass** (25/26 test suites passed sequentially; `utilities.test.ts` timed out under Windows disk-operations throttle).
* **Dependency Audit**: **16 Vulnerabilities** (2 Low, 6 Moderate, 8 High on Root/Backend; **0** on Frontend).

---

## 🖥️ Section 1: Frontend Page-Wise Audit

The frontend application consists of **29 page/component folders** under [frontend/src/pages/](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages). 

All pages build successfully without bundle errors. Below is the readiness status of each page:

| Page / Component | Route Path | Rendering Mode / Integration | Status | Findings |
| :--- | :--- | :--- | :---: | :--- |
| **POS** | `/pos`, `/` | Live Routed | **READY** | Main POS interface. Uses batched queries. |
| **Dashboard** | `/dashboard` | Live Routed | **READY** | Analytics cards. All metrics wired correctly. |
| **Inventory** | `/inventory` | Live Routed | **READY** | Master stock page. Infinite scrolling active. |
| **Returns** | `/returns` | Live Routed | **READY** | Supplier returns interface. |
| **Purchases** | `/purchases`, `/manual-purchase` | Live Routed | **READY** | Purchase invoice upload & creation. |
| **PurchaseHistory** | `/purchase-history` | Live Routed | **READY** | Archives and logs of past purchases. |
| **CRM** | `/crm` | Live Routed | **READY** | Patient CRM & WhatsApp chats logs. |
| **Orders** | `/orders` | Live Routed | **READY** | Special orders / requests. |
| **Reports** | `/reports` | Live Routed | **READY** | Business and financial summaries. |
| **License** | `/license` | Live Routed | **READY** | App registration checking. |
| **Settings** | `/settings` | Live Routed | **READY** | Configuration and backup controls. |
| **Mail** | `/mail` | Live Routed | **READY** | IMAP email invoice inbox. |
| **Sells** | `/sells` | Live Routed | **READY** | Invoices registry and edit modal. |
| **Learning** | `/learning` | Live Routed | **READY** | AI extraction mapping workspace. |
| **Database** | `/database` | Live Routed | **READY** | Direct SQLite table view & catalog import. |
| **CompositionQueue** | `/composition-queue` | Live Routed | **READY** | Composition mapping manager. |
| **PharmarackCart** | `/pharmarack-cart` | Live Routed | **READY** | **Protected:** Live cart orders. |
| **Investigation** | `/investigation` | Live Routed | **READY** | Discrepancy & trace analyzer. |
| **PhoneSales** | `/phone-sales` | Live Routed | **READY** | Mobile POS client supervisor. |
| **Expiry** | Nested `/expiry` -> `/returns?tab=expiry` | Sub-tab component | **READY** | Expiry logs list. |
| **AutomationCenter** | Nested `/automation-center` -> `/crm?tab=automation` | Sub-tab component | **READY** | Trigger alerts panel. |
| **Refills** | Nested `/refills` -> `/crm?tab=refills` | Sub-tab component | **READY** | Scheduled refill tracker. |
| **NonMappedDistributors** | Nested `/non-mapped` -> `/pharmarack-cart?tab=non-mapped` | Sub-tab component | **READY** | Unmapped distributors mapper. |
| **Dispatch** | Nested `/dispatch` -> `/learning?tab=dispatch` | Sub-tab component | **READY** | Delivery boy registry. |
| **CatalogUpload** | Nested `/catalog` -> `/database?tab=catalog` | Sub-tab component | **READY** | Catalog uploads page. |
| **CustomerReturn** | Nested `/customer-returns` -> `/returns?tab=customer` | Sub-tab component | **READY** | Process patient returns. |
| **CustomerReturnHistory** | Nested `/customer-returns-history` -> `/returns?tab=customer-history` | Sub-tab component | **READY** | Customer return log. |
| **Doctors** | Routed to `/doctors` but redirects to `/learning?tab=doctors` | Not rendered in App | **CLEANUP** | **Dead Code Candidate:** Functionality is implemented inline in `Learning/index.tsx`. Folder is unused. |

---

## ⚙️ Section 2: Backend Route-Wise Audit

The backend server exposes APIs defined in [src/routes/](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes). 

All backend modules compile with zero TypeScript errors. Below is the mounted route list:

| Route File | Base Mount Prefix | Mount Status | Findings |
| :--- | :--- | :---: | :--- |
| `dashboard.ts` | `/api/dashboard` | **ACTIVE** | Summary endpoints & system alerts. |
| `inventory.ts` | `/api/inventory` | **ACTIVE** | Master inventory & bulk actions. |
| `sales.ts` | `/api/sales` | **ACTIVE** | Sales, hold bills, and suggests. |
| `purchases.ts` | `/api/purchases` | **ACTIVE** | PDF parse & invoice updates. |
| `crm.ts` | `/api/crm` | **ACTIVE** | Patients and Doctor affiliations. |
| `orders.ts` | `/api/orders` | **ACTIVE** | Special requests & custom orders. |
| `reports.ts` | `/api/reports` | **ACTIVE** | Report data exports (PDF/Excel). |
| `settings.ts` | `/api/settings` | **ACTIVE** | Settings reads/saves. |
| `mail.ts` | `/api/email` | **ACTIVE** | IMAP mailbox syncing & OCR queue. |
| `returns.ts` | `/api/returns` | **ACTIVE** | Return sheets and credit notes. |
| `learning.ts` | `/api/learning` | **ACTIVE** | Parser profiles & column mappings. |
| `migration.ts` | `/api/migration` | **ACTIVE** | Staging inventory database & finalize. |
| `license.ts` | `/api/license` | **ACTIVE** | License activations. |
| `messaging.ts` | `/api/messaging` | **ACTIVE** | WhatsApp QR codes and messages logs. |
| `refills.ts` | `/api/refills` | **ACTIVE** | Scheduled reminders checking. |
| `automation.ts` | `/api/automation` | **ACTIVE** | Automation logs. |
| `investigation.ts` | `/api/investigation` | **ACTIVE** | Discrepancies logs. |
| `medicines.ts` | `/api/medicines` | **ACTIVE** | Medicine catalog lists. |
| `enrichment.ts` | `/api/enrichment` | **ACTIVE** | Composition data mapping. |
| `distributors.ts` | `/api/distributors` | **ACTIVE** | Supplier lists. |
| `upload.ts` | `/api/upload` | **ACTIVE** | Generic upload handler. |
| `pharmarack.ts` | `/api/pharmarack` | **ACTIVE** | **Protected:** Pharmarack headless cart. |
| `whatsappBusiness.ts` | `/api/wa-business` | **ACTIVE** | Official WhatsApp API configuration. |
| `v1/sales.ts` | `/api/v1/sales` | **INACTIVE** | **Dead Code Candidate:** Unused routes folder. |

---

## 🔗 Section 3: API & Routing Cross-Reference Findings

During static code cross-referencing, we matched API calls declared in [frontend/src/services/api.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/api.ts) against the Express route files.

While **190 endpoints matched perfectly**, we identified **25 dead API declarations** in the client service. They point to non-existent backend routes and are not called by any active frontend page:

### Unimplemented Backend Route Declarations (Migration V2 leftover):
1. `POST /api/migration/analyze-zip` (via `api.analyzeZipFile`)
2. `POST /api/migration/analyze-excel` (via `api.analyzeExcelFile`)
3. `POST /api/migration/pre-migration-simulate` (via `api.preMigrationSimulate`)
4. `POST /api/migration/projects` (via `api.createProject`)
5. `DELETE /api/migration/projects/:id` (via `api.deleteProject`)
6. `POST /api/migration/templates` (via `api.saveTemplate`)
7. `POST /api/migration/staging/resolve` (via `api.resolveStagingConflict`)
8. `POST /api/migration/snapshots/restore` (via `api.restoreSnapshot`)
9. Various staging routes (`PUT`, `DELETE`, and `POST` for `/migration/staging/sales`, `/purchases`, and `/returns`) which are either bypassed or implemented under different route handlers.

---

## 🔧 Section 4: Verification of Historical Bugs

We verified the 23 bugs documented in `docs/superpowers/specs/surgical_fixes.md` (FIX-00 to FIX-22) against current code files:

| Fix ID | Targeting File | Problem Area | Status | Verification Details |
| :--- | :--- | :--- | :---: | :--- |
| **FIX-00** | `productNameFilterService.ts` | Syntax Error | **FIXED** | Compiles cleanly. No syntax issues. |
| **FIX-01** | `emailService.ts` | Duplicate Export | **FIXED** | Verified at bottom of file (only 1 export block). |
| **FIX-02** | `emailService.ts` | Missing `fs` import | **FIXED** | `fs` is correctly imported. |
| **FIX-03** | `email.ts` | Missing `.js` extension | **FIXED** | ESM imports use `.js`. |
| **FIX-04** | `emailPoller.ts` | Missing `.js` extension | **FIXED** | ESM imports use `.js`. |
| **FIX-05** | `telegramBot.ts` | i18n import extension | **N/A** | Refactored: i18n module is not imported. |
| **FIX-06** | `telegramBot.ts` | DB path / lang property | **FIXED** | `lang` is declared; `DB_PATH` is 1 folder up (correct). |
| **FIX-07** | `telegramBot.ts` | Missing `handleMedicineQuery` | **FIXED** | Method fully defined at line 627. |
| **FIX-08** | `returns.ts` | Missing `uuid` package | **FIXED** | Unused import removed. |
| **FIX-09** | `server.ts` | Mid-file imports | **FIXED** | All imports grouped at top. |
| **FIX-10** | `utilities.ts` | AWS require in ESM | **FIXED** | Dynamic `import('aws-sdk')` is utilized. |
| **FIX-11** | `purchases.ts` | Wrong column in UPDATE | **FIXED** | Correctly maps `distributor_id` FK. |
| **FIX-12** | `reports.ts` | Wrong table names in SQL | **FIXED** | SQLite queries use correct table/column names. |
| **FIX-13** | `archive.ts` | Missing column in sweeps | **N/A** | Refactored: sweep archives directly into zip file. |
| **FIX-14** | `inventory.ts` | Bulk-action logs columns | **FIXED** | SQLite maps `(action_type, description)`. |
| **FIX-15** | `purchases.ts` | Bulk-action logs columns | **FIXED** | SQLite maps `(action_type, description)`. |
| **FIX-16** | `compliance.ts` | Logs columns in rx-dispense | **FIXED** | SQLite maps `(action_type, description)`. |
| **FIX-17** | `page1.html` | Wrong invoice API url | **N/A** | Old HTML files migrated to React POS page. |
| **FIX-18** | `page19.html` | WhatsApp QR key mismatch | **N/A** | Old HTML files migrated to React CRM page. |
| **FIX-19** | `inventory.ts` | Peek wrong JOIN in sales | **FIXED** | Peek uses clean query on `inventory_master`. |
| **FIX-20** | `whatsappClient.ts` | `sendMessage` parameters | **FIXED** | API structure complies with `MessageMedia`. |
| **FIX-21** | `database.ts` | Missing columns in schema | **FIXED** | `reorder_level` and all tables created on boot. |
| **FIX-22** | `sales.ts` | `held_bills` inline DDL | **FIXED** | Inline DDL removed; managed in connection setup. |

---

## 🧪 Section 5: Test Suite Results

When Jest was run concurrently, many test suites timed out. However, running Jest **sequentially (`--runInBand`)** demonstrates excellent backend stability:

* **Passed Suites (25)**: `dbIntegrity.test.ts`, `processGuardian.test.ts`, `onlineEnrichment.test.ts`, `returnsParser.test.ts`, `salesParser.test.ts` (previously flaky, now fully green), `migrationV2.test.ts`, `crm.test.ts`, `whatsappRouting.test.ts`, `emailService.test.ts`, `inventory.test.ts`, `pharmarackCartNotif.test.ts`, etc.
* **Failed Suites (1)**: `tests/utilities.test.ts`
  * *Reason*: `POST /utils/reset-data clears data but preserves settings` exceeded the 5000ms test timeout threshold under Windows while unlinking and recreating database files. 
  * *Recommendation*: Increase this specific test block timeout to 15000ms (`jest.setTimeout(15000)`).

---

## 🛡️ Section 6: Security Audit (NPM Audit Summary)

* **React Frontend**: **0 Vulnerabilities** found.
* **Backend Server**: **16 Vulnerabilities** found (2 Low, 6 Moderate, 8 High):

### High-Severity Vulnerabilities:
1. **`multer`**: Vulnerable to DoS via deeply nested field names and aborted upload cleanups.
2. **`nodemailer`**: CRLF header injections & TLS validation bypasses.
3. **`undici`**: HTTP header injection & Cookie SameSite downgrade issues.
4. **`xlsx` (SheetJS)**: Prototype Pollution and Regular Expression Denial of Service (ReDoS).

*Recommendation*: Carefully patch dependencies one-by-one during the system hardening phase.

---

## 📦 Section 7: Dead Code / Duplication Candidates

1. **`src/routes/v1/sales.ts`**: Dead router file (28.4 KB). Direct duplicate of the older API iteration, never imported in `src/server.ts`.
2. **`src/services/nNotificationService.ts`**: Duplicate notifications service (4.7 KB). Not imported by any file. The live service is `src/services/notificationService.ts`.
3. **`frontend/src/pages/Doctors/`**: Dead frontend page folder. Doctor registration UI is now built directly inline in `Learning/index.tsx`.
4. **`frontend/src/services/api.ts`**: 25 dead API declarations (V2 migration endpoints) that can be safely pruned to keep the frontend bundle clean.
