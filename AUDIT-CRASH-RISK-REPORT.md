# AI PHARMACY v2 — Complete Crash-Risk & Audit-Logging Report

Read-only diagnostic audit. No files were modified to produce this report. All findings are evidence-based (file:line), pulled from the live codebase.

---

## 1. Executive Summary — Top Risks, Ranked

| # | Risk | Why it matters | Severity |
|---|---|---|---|
| 1 | No global `uncaughtException`/`unhandledRejection` handler in dev mode | `processGuardian.ts` only registers process-level crash handlers when `NODE_ENV==='production'` or packaged. In normal dev/staging runs, **any** uncaught error in a timer callback kills the whole Node process instantly, taking down every open request. | Critical |
| 2 | ~7 background timers have no `.catch()` on their async call | `emailService.ts:1139`, `imageArchiveService.ts:34/40`, `messagingQueue.ts:25`, `orderFulfillmentService.ts:27`, `telegramPrescriptionService.ts:73`, `tokenRefreshScheduler.ts:114`, `backupRecoveryService.ts:38`. Combined with #1, these are live process-crash triggers, not just failed features. | Critical |
| 3 | Cross-process SQLite write contention, no shared write queue | 3 forked worker processes (catalog, stock calculator, substitute cache) + multiple in-process 10s/30s/hourly timers all write to one SQLite file. Only 2 files in the entire codebase handle `SQLITE_BUSY`. Under real concurrent usage (e.g. bulk catalog import running while POS is selling), expect intermittent "database is locked" failures. | High |
| 4 | Schema init has ALTER-before-CREATE ordering bugs | `src/database.ts` — several `ALTER TABLE ... ADD COLUMN` statements run before the `CREATE TABLE` for that same table, wrapped in a try/catch that also silently swallows "no such table" errors. Certain columns may never actually get added on fresh installs, causing later `no such column` runtime errors in unrelated features. | High |
| 5 | No Multer error-handling middleware on upload routes | `upload.ts`, `migration.ts` — an oversized or invalid file (a real user attaching a huge PDF or wrong file type) bypasses the app's structured JSON error handler and returns a raw Express default error instead. Confusing failure, not a crash, but breaks the "every error is logged/handled the same way" expectation. | Medium |
| 6 | Fire-and-forget catalog parsing after HTTP response sent | `upload.ts:91-95` — malformed CSV/PDF/Excel errors during background parsing are only `console.error`'d; the uploading user sees a false "success" and never learns the import failed. | Medium |
| 7 | WhatsApp/Puppeteer session loss requires manual reconnect | Graceful (no crash), but on `disconnected`/`auth_failure` the client does not auto-recover — WhatsApp-dependent features (refill reminders, invoices, OCR intents, CRM chat) silently stop working until someone re-scans the QR code. | Medium (operational, not a crash) |
| 8 | Orphaned/dead route files | `src/routes/v1/sales.ts` and `src/routes/creditNotes.ts` are not mounted in `server.ts`. Not a runtime risk, but a maintenance trap — future devs may edit dead code expecting it to be live. | Low |

---

## 2. Page-by-Page Failure Mode Table

Every page under `frontend/src/pages/**`, its backend dependency, and what can go wrong for a real user.

| Page | Backend routes used | Real-world failure scenario |
|---|---|---|
| Dashboard | `/api/dashboard` | Aggregation query spans multiple tables; if a background worker holds a write lock during the daily cron windows (see systemic risk #3), the dashboard load can hang or return a locked-DB error to the user right when they open the app. |
| POS | `/api/sales`, `/api/inventory` | Highest-frequency write path in the app. Directly contends with `catalogWorker`/`stockCalculatorWorker` background writes (risk #3) — a sale during a catalog sync window is the single most likely real-world "database is locked" user complaint. |
| Sells | `/api/sales` | Same contention profile as POS; also depends on `sales.ts` quantity-recommendation endpoints which call inventory calculations — no visible caching, so slow on large catalogs. |
| PhoneSales | `/api/sales`, `/api/crm` | Combines sales writes with CRM patient lookups in one flow — two write-heavy subsystems in a single user action increases lock-contention surface. |
| Purchases | `/api/purchases` (incl. `/upload`) | PDF/CSV upload for purchase bills goes through Multer with no dedicated error middleware (risk #5) and background parsing that can silently fail (risk #6) — a user uploading a slightly malformed distributor invoice may see a false success. |
| PurchaseHistory | `/api/purchases` | Read-heavy; risk is mostly the shared write-lock contention during nightly backup/catalog crons. |
| Inventory | `/api/inventory`, `/api/medicines` | Bulk-action endpoint (`POST /bulk-action`) performs many row updates in one request — a mid-batch crash (risk #1/#2 territory if it touches a timer-triggered cache rebuild) could leave inventory partially updated with no rollback confirmation visible in the route. |
| Expiry | `/api/expiry` | `POST /create-return` chains into `returnsService.ts`; depends on `expiryAlertService.ts`, one of the services confirmed to have `.catch()` on its timer — lower risk than others in this table. |
| Returns | `/api/returns` | `/ai-camera/process` depends on `aiCameraService.ts` (external model call) — no timeout evidence gathered for this specific call; a hang here blocks the return flow for the user waiting at the counter. |
| CustomerReturn / CustomerReturnHistory | `/api/customer-returns` | Straightforward CRUD; main exposure is the general DB contention risk, not anything unique to this page. |
| Orders | `/api/orders` | `POST /convert-to-refill` bridges two subsystems (orders → refills); a failure partway through could leave an order marked converted without a corresponding refill record — worth confirming transactional wrapping. |
| Refills | `/api/refills` | Multiple state-changing actions (`send`, `acknowledge`, `skip`, `fulfill`) each independently mutate state; depends on `refillService.ts` and WhatsApp send — if WhatsApp session is down (risk #7), refill sends silently no-op or error without a clear user-facing signal. |
| Dispatch | `/api/dispatch` | Depends on `pharmarackDailyDispatchService.ts`, an 11 AM daily cron — if that cron's own DB writes collide with a user manually creating a dispatch order at the same time, expect a lock conflict during that specific hour window. |
| PharmarackCart | `/api/pharmarack` | Relies on a scraping/login-window session against a third-party distributor portal (Pharmarack) — inherently fragile to that external site changing; failures here are outside this app's control but currently only console-logged per the general pattern seen elsewhere. |
| NonMappedDistributors | `/api/distributors` | Low risk, simple CRUD. |
| Doctors | `/api/crm` (doctors CRUD) | Low risk, simple CRUD. |
| CRM | `/api/crm` (patients, credit-customers, ledger) | `POST /ledger/pay` is a financial write — no evidence of transactional safety was verified in this pass; worth a closer follow-up given it affects money records. |
| Reports | `/api/reports` | Export endpoints (`/export-pdf`, `/export-excel`) and monthly scheduled report send depend on `monthlyReportService.ts` and PDF/Excel generation — large datasets could cause slow synchronous generation blocking the request thread. |
| Migration | `/api/migration` | Highest-blast-radius page in the app: uploads (Multer, risk #5), staged review/finalize/rollback of bulk data. A user aborting mid-migration or uploading a corrupt file exercises the least-tested code paths in the audit. |
| CatalogUpload | `/api/catalog` (generic `/api`) | Background job-based import (`catalogWorker.ts`, a separate forked process) — the single biggest contributor to risk #3 (cross-process SQLite contention) since it's explicitly a long-running bulk writer. |
| CompositionQueue / Investigation | `/api/investigation` | Read/audit-focused; lower risk, but depends on `audit_logs` table population being complete (see Section 4 for gaps). |
| AutomationCenter | `/api/automation` | Retries/cancels queued notifications — depends on `automation_notifications` table, one of the tables flagged in the ALTER-before-CREATE ordering issue (risk #4); if that column never landed on a given install, this page's actions could throw `no such column`. |
| Database | `/api/utilities` (backup/restore, reset-data, db/unlock) | This page directly exposes the most destructive backend operations in the app — `POST /reset-data` and `db/unlock`. A user (or admin) triggering these during any of the above lock-contention windows is the worst-case real-world crash scenario in the entire app. |
| Learning | `/api/learning` | Mapping/model-adjustment CRUD; low direct crash risk, but bad learned mappings can propagate into future migrations/enrichments. |
| Mail | `/api/email` | Depends on `emailService.ts`, one of the confirmed no-`.catch()` timer services (risk #2) — an IMAP/Gmail sync failure while this page's poller runs is a genuine process-crash vector, not just a page error. |
| License | `/api/license` | Heartbeat/activation calls to a licensing backend — if this endpoint is on a synchronous path with a long timeout and the licensing server is unreachable, could stall app startup or feature-gating checks. |
| Settings | `/api/settings` (incl. Google OAuth, distributor config) | `POST /google/disconnect` and stamp/signature uploads are simple CRUD; low direct risk, but this page is where Gmail credentials live (see prior memory note) — misconfiguration here silently degrades the Mail page poller rather than erroring visibly. |

---

## 3. Route & Service Crash-Risk Table (Systemic, Not Page-Specific)

| Component | Failure scenario | Root cause (evidence) | Severity |
|---|---|---|---|
| `src/server.ts` process lifecycle | Entire app crashes on any uncaught error in a timer callback, even outside business hours | `processGuardian.ts` only registers `uncaughtException`/`unhandledRejection` in prod/packaged mode; dev/staging runs have zero safety net | Critical |
| `src/services/emailService.ts:1139` | Mail polling silently crashes the app if IMAP/Gmail API throws | `setInterval(... this.pollInbox() ...)` with no `.catch()` | Critical |
| `src/services/imageArchiveService.ts:34,40` | Daily cleanup / monthly archive cron can crash the app | `cron.schedule` callbacks call `this.cleanTemporaryImages(180)` / `this.zipMonthlyImportantImages()` directly, no try/catch | Critical |
| `src/services/messagingQueue.ts:25` | Message queue processing crash on any send failure | `setInterval(... this.processQueue() ...)`, no `.catch()` | Critical |
| `src/services/orderFulfillmentService.ts:27` | Hourly refill/order check crash | `setInterval(... this.checkRefillsAndGenerateOrders() ...)`, no `.catch()` | Critical |
| `src/services/telegramPrescriptionService.ts:73` | Hourly Telegram cart check crash | `setInterval`, no `.catch()` on the call | Critical |
| `src/services/tokenRefreshScheduler.ts:114` | OAuth token refresh crash if refresh call throws | `setInterval(... this.refreshIfNeeded() ...)`, 20 min interval, no `.catch()` | Critical |
| `src/services/backupRecoveryService.ts:38` | Hourly backup retry crash | `setInterval(... this.retryPendingUploads() ...)`, no visible `.catch()` on the call itself | High |
| Cross-process SQLite writers | Intermittent "database is locked" errors under real concurrent load | 3 forked workers (`catalogWorker.ts`, `stockCalculatorWorker.ts`, `substituteCacheWorker.ts`) each hold independent connections to the same SQLite file; plus 6+ in-process timers writing every 10s–60min; only `sales.ts` and `catalogWorker.ts` reference `SQLITE_BUSY` anywhere | High |
| `src/database.ts` schema init | Certain columns may never be added on fresh installs, causing later `no such column` errors in unrelated features (e.g. `push_tokens`, `return_items`, `emails`, `special_orders`, `automation_notifications`, `stock_ledger`, `whatsapp_chats`, `staged_medicine_reviews`) | `ALTER TABLE` statements for these tables appear in the function before the corresponding `CREATE TABLE IF NOT EXISTS`, inside a try/catch that also swallows "no such table" | High |
| `src/routes/upload.ts`, `migration.ts` | Oversized/invalid uploads return a raw Express default error instead of the app's structured JSON error | No Multer-specific error-handling middleware (`MulterError` never caught) | Medium |
| `src/routes/upload.ts:91-95` | User sees false "upload succeeded" even when the file is malformed | Catalog analysis kicked off via fire-and-forget dynamic import *after* the HTTP response is already sent; parse errors are `console.error` only | Medium |
| `src/whatsappClient.ts` (disconnected/auth_failure handlers) | WhatsApp-dependent features (refill sends, invoices, OCR intents) silently stop working until manual QR re-scan | No automatic reconnect loop on `disconnected`/`auth_failure` — degrades gracefully (no crash) but with no self-healing | Medium (availability, not crash) |
| `src/routes/v1/sales.ts`, `src/routes/creditNotes.ts` | Dead code confusion for future maintainers | Neither file is mounted via `app.use(...)` in `server.ts` | Low |
| `src/services/googleSearchService.ts:239` | A request-path call using this service could stall up to 60s | `timeout: 60000` on one call path — needs confirmation of which callers are synchronous vs. background | Low-Medium (unconfirmed) |
| `src/worker/catalogWorker.ts:1032` | Possible uncaught exception in its own polling `setInterval` | `async () => {...}` timer callback; internal error handling not fully verified in this pass | Needs follow-up |

---

## 4. Database Audit-Logging Coverage (Current State)

This section documents what is logged today — it does not add or change any logging.

| Log/audit surface | Table(s) | What's covered | Gaps observed |
|---|---|---|---|
| Process crashes | `crash_log` | Populated only by `processGuardian.ts`, and only when it's active (prod/packaged) — see risk #1 | Dev-mode crashes are not recorded anywhere since the handler that would write to `crash_log` isn't registered |
| Inventory/investigation changes | `audit_logs` (per `investigation.ts` — `GET /audit-logs/:inventoryId`) | Inventory-specific edit history is queryable | Coverage for *other* entities (sales edits, purchase edits, CRM patient edits) was not confirmed to funnel into the same table — likely each domain logs independently or not at all |
| Notification/device activity | `notifications.ts` — device logs, action logs, chat logs (with clear endpoints) | Device connections, admin actions, WhatsApp chat activity | Existence of a `DELETE .../clear` endpoint for each log type means these logs are user-purgeable, which weakens their value as a tamper-evident audit trail |
| WhatsApp intent handling | Console-only (`whatsappIntentService.ts` failures are `.catch(err => console.log(...))`) | Nothing persisted to DB when an inbound WhatsApp intent fails to process | A failed prescription/order parsed from WhatsApp has no DB record of the failure — silent data loss risk |
| File uploads (Migration/Purchases/CatalogUpload) | Job/staging tables (`staged_medicine_reviews`, migration staging tables) | Successful job status is tracked | Parse *failures* during fire-and-forget background analysis are console-only (risk #6) — not written to any queryable table |
| Database self-healing / corruption recovery | Implied by `runSelfHealing()` in `connection.ts`, console-logged | Corruption detection and backup restoration happen | Not confirmed whether a restore event itself is written to a persistent table the Database admin page (`Database/index.tsx`) can display — worth a follow-up read of that page's data source |
| Financial actions (CRM ledger pay, credit notes) | Not confirmed | — | No dedicated audit table for financial CRUD actions (`POST /ledger/pay`, credit note operations) was found in this pass — flagged as the highest-value gap to close given it's money-adjacent, though this report does not recommend implementation details, only flags the gap |

**Bottom line on "every user action logged":** partial. Inventory changes and notification/device/chat activity have queryable logs (some purgeable by users, which weakens tamper-evidence). Sales, purchases, CRM financial actions, and WhatsApp-intent failures do not have confirmed persistent audit trails — those actions currently rely on `console.log`/`console.error`, which is lost on process restart and invisible to the Database admin page.

---

## 5. Appendix — Full Inventory

### 5.1 Frontend Pages (33)
License, NonMappedDistributors, Migration, Doctors, Dashboard, Returns, Expiry, CustomerReturn, CustomerReturnHistory, Orders, Sells, Mail, CompositionQueue, Inventory, Investigation, AutomationCenter, PurchaseHistory, Purchases, PhoneSales, Refills, Database, CatalogUpload, Learning, PharmarackCart, POS, CRM, Reports, Settings, Dispatch — all under `frontend/src/pages/<Name>/index.tsx`.

### 5.2 Backend Route Files (mounted, per `src/server.ts`)
`whatsappBusiness.ts`, `aiCamera.ts`, `compliance.ts`, `messaging.ts`, `crm.ts`, `verification.ts`, `migration.ts`, `settings.ts`, `pharmarack.ts`, `dispatch.ts`, `archive.ts`, `learning.ts`, `telegramPrescription.ts`, `refills.ts`, `automation.ts`, `sales.ts`, `inventory.ts`, `dashboard.ts`, `purchases.ts`, `returns.ts`, `customerReturns.ts`, `orders.ts`, `expiry.ts`, `reports.ts`, `license.ts`, `upload.ts`, `catalog.ts`, `medicines.ts`, `enrichment.ts`, `distributors.ts`, `notifications.ts`, `investigation.ts`, `medicineAvailability.ts`, `email.ts`, `security.ts`, `utilities.ts`.

**Not mounted (dead code):** `v1/sales.ts`, `creditNotes.ts`.

### 5.3 Backend Services (55)
`bouncedAlertService`, `cacheService`, `creditNoteService`, `customerService`, `dataMerger`, `doctorReportingService`, `eventService`, `imageArchiveService`, `inventoryService`, `messagingQueue`, `nNotificationService`, `onnxOcrService`, `pushNotificationService`, `returnsService`, `medicineAvailabilityEngine`, `expiryAlertService`, `refillService`, `orderFulfillmentService`, `onlineDataEnricher`, `verificationService`, `inventoryCache`, `googleSearchService`, `intentKeywords`, `aiCameraService`, `medicineService`, `waAdminEscalationService`, `scispacyClient`, `dataFetchControl`, `activityTracker`, `emailService`, `backupService`, `pharmarackCatalogCache`, `tokenRefreshScheduler`, `whatsappBusinessService`, `pdfInvoiceService`, `nonMovingReportService`, `telegramPrescriptionService`, `backupRecoveryService`, `shortageReminderService`, `notificationService`, `searchCache`, `productNameFilterService`, `invoiceService`, `whatsappInvoiceService`, `monthlyReportService`, `whatsappQueue`, `whatsappIntentService`, `ocrScanQueue`, `pharmarackDailyDispatchService`, plus `apiClients/baseApiClient`, `apiClients/openFdaClient`, `apiClients/rxNormClient`.

### 5.4 Database Setup
- Engine: SQLite (`sqlite3` + `sqlite` wrapper), single shared connection (not a pool), file at `data/app.db`.
- `busy_timeout`: 30000ms (prod) / 5000ms (test).
- Self-healing: corrupt DB is renamed `.corrupt` and restored from `data/app.db.bak_*` or `backup/snapshots/snapshot_*.db.gz`; throws `DB_INTEGRITY_FAILURE` (crashes boot) if no backup exists.
- Write interceptor triggers background snapshot + debounced cache rebuilds on every INSERT/UPDATE/DELETE.
- Transactions use `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` with no automatic retry-on-busy loop.
- Schema version tracked in `app_settings` (currently 14); ALTER-before-CREATE ordering issue noted in Section 3.

### 5.5 Items Flagged for Follow-Up (not fully verified in this pass)
- `src/worker/catalogWorker.ts:1032` — internal error handling of its own polling timer not confirmed.
- Whether `runSelfHealing()` restore events are persisted to a table the Database admin page can display.
- Whether CRM `POST /ledger/pay` and credit note operations run inside a DB transaction.
- Which callers hit `googleSearchService.ts:239`'s 60s-timeout code path synchronously vs. in the background.
- `aiCameraService.ts` external call timeout configuration (not sampled in the API-timeout pass).
