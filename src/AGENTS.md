# Backend Services and APIs (src/)

This directory contains the Express.js server logic, database interactions, routes, and background services.

## Scope & Responsibilities
- **API Endpoints**: Defined in `src/routes/`.
- **Database**: Defined in `src/database.ts` and `src/database/`.
- **Integrations**: WhatsApp (`src/whatsappClient.ts`) and Telegram (`src/telegramBot.ts`).
- **Services**: Business logic modules in `src/services/` (e.g. `backupService.ts`, `emailService.ts`).

## CRM /patients Enrichment Contract (added 2026-08)
- `GET /api/crm/patients` rows additionally carry `purchase_count`, `last_sale_date`, and `active_refill` (chunked ≤500-id indexed queries against `sales_invoices` / `patient_refills`). Enrichment failures degrade silently to unenriched rows — never drop the patient list. POS consumes these for the 🔁 Refill chip and returning-patient labels.

## Strict Purchase Medicine Resolution (added 2026-08)
No purchase ingestion route may silently create `medicines` master rows. Master registration is user-driven only (POST `/medicines` via the Universal editor); inventory is created solely inside verified purchase transactions.

- **`POST /purchases/manual`**: per line, resolution order is explicit `medicine_id` → `resolveMedicineNameMultiTier` → `ocr_corrections`. If still unresolved, the line is collected and the whole transaction ROLLBACKs with `400 { unresolved_items: [{name}] }`. The former silent full-record auto-INSERT was removed. Do not reintroduce it.
- **`POST /staged/:id/approve`** and **`POST /reconciliation/reissue`**: same strict chain; the old alias → `%LIKE%` containment → bare `INSERT INTO medicines (name)` fallback was removed. Unresolved lines abort with ROLLBACK + `400 {unresolved_items}`. A client-supplied `item.medicine_id` always wins when it exists.
- **`POST /purchases/match-items`**: read-only batch resolver (`{names[], distributor_id}` → `{input, medicine_id, matched_name, confidence, match_type}`) used by StagedReviewModal and Purchase save verification. One round-trip, max 200 names, NEVER creates records. Use it instead of N per-line autocomplete calls.
- Email/telegram/mobile-sync ingestion only ever writes pending `staged_purchases`; approval remains a human-only UI action. Keep it that way.

## Rules & Constraints
- Keep database operations secure, avoiding direct raw query concatenation.
- All new dependencies must be scanned using `scan_dependencies` before import.
- Run `node scripts/quick-update.mjs` after any updates to backend files.

## Hot-Path Query Performance Contracts (added 2026-08)

Page-switch latency rules — verified against the live DB (251 MB, 37k inventory rows) with EXPLAIN QUERY PLAN. Do not regress these:

- **GET /refills/panel** (`routes/refills.ts`): two-pass design — cheap `patient_refills×medicines×customers` base query first (two plain LEFT JOINs for language, never an OR-join), then ONE chunked (≤500 ids) window-function pass over `inventory_master` restricted to `medicine_id IN (...)`. NEVER reintroduce whole-table GROUP BY + ROW_NUMBER subqueries over `inventory_master`; they cost 170-250ms/request vs ~4ms now.
- **GET /api/inventory** (`routes/inventory.ts`): `COUNT(*)` over the joined set (~380ms/request) is served from a filter-keyed module cache (`INVENTORY_COUNT_TTL_MS` = 60 s). `invalidateInventoryCountCache()` is called by the write interceptor in `database/connection.ts` on any `inventory_master` write — keep that wiring when touching either file.
- **Indexes** (`database.ts`, fast-boot block): `idx_dispatch_orders_created (created_at DESC)` and `idx_special_orders_date (date DESC)` back bare-ORDER-BY list endpoints; new list endpoints must get a matching index or a status-prefixed composite that the actual ORDER BY can use.
- **Purchases date filters** (`routes/purchases.ts` GET `/`): exact `date(p.date,'localtime') BETWEEN ...` expressions are ALWAYS paired with sargable superset bounds (`p.date >= datetime(?,'-1 day')` / `< datetime(?,'+2 days')`) so `idx_purchases_date_dist` prunes first. Preserve both when editing filters.
- Axios GET transient-error retry (frontend `services/api.ts`) uses short exponential backoff (300/600/1200 ms); do not restore long flat waits.

## Self-Healing Crash Recovery (added 2026-06)

The following subsystem implements `self-healing-spec.md`. Do not duplicate or replace any part of it:

### `src/process/processGuardian.ts` (NEW)
- Registers `uncaughtException` and `unhandledRejection` handlers.
- On catch: logs to `crash_log` table then calls `process.exit(1)` so the OS watchdog can restart.
- Do **not** merge with `WorkerSupervisor` — they are separate mechanisms (see spec Section 4).

### `src/database/connection.ts` — integrity check on cold start
- Runs `PRAGMA integrity_check` before the write-interceptor wires up.
- On failure: attempts `PRAGMA wal_checkpoint(TRUNCATE)` then re-checks.
- If still failing: throws `Error('DB_INTEGRITY_FAILURE')` — caller must surface to user, NOT auto-restore.
- Skipped in `NODE_ENV=test` to avoid test-DB overhead.

### `src/database.ts` — schema additions
- `crash_log` table: stores crash telemetry written by processGuardian.
- `app_settings` keys: `last_clean_shutdown` (bool string) and `app_version` (string).

### `src/server.ts` — boot + shutdown tracking
- On boot: reads `last_clean_shutdown`; warns if `'false'`; writes `'false'` immediately.
- On graceful shutdown: writes `last_clean_shutdown = 'true'` before backup/cleanup.
- Catches `DB_INTEGRITY_FAILURE` separately from generic errors with a user-facing message.

### `src/worker/catalogWorker.ts` — header-mismatch guard
- In `runCatalogImport`, before applying `mapping_config`, checks that every mapped CSV column exists in the file's actual headers.
- On mismatch: sets job status to `waiting_for_mapping` (existing status, existing UI) and returns early. Does NOT throw. Does NOT silently import.

### OS-level watchdog (outside this directory)
- Not in `src/` — see `self-healing-spec.md` Section 3 for launcher/installer notes.
- Restarts the Node process on exit code 1 with backoff matching `WorkerSupervisor` pattern.

## Unified Medicine Availability Engine (added 2026-07)

The engine provides a single, unified approach to medicine availability and alternative finding across all touchpoints (POS, Catalog, Telegram).

### Core Files
| File | Purpose |
|------|---------|
| `src/services/medicineAvailabilityEngine.ts` | Core service: availability checks, substitute finding, stock levels, learning |
| `src/worker/stockCalculatorWorker.ts` | Background worker: recalculates stock_config from sale_items daily |
| `src/worker/substituteCacheWorker.ts` | No-op stub: exports only `precomputeSubstitutes()` (dynamic composition-match lookup replaced precomputation; its weekly scheduler was removed 2026-08 as dead code) |
| `src/routes/medicineAvailability.ts` | API endpoints for availability, substitutes, emergency stock, learning |

### Database Tables (added to `src/database.ts`)
- `stock_config`: per-medicine avg_daily_sales, lead_time, safety_factor, min/max/reorder levels
- `substitutes`: pre-computed substitute relationships (composition, category, fuzzy, manual)
- `pharmacist_corrections`: learns from pharmacist corrections for progressive improvement

### API Endpoints
- `GET /api/medicines/availability?query=&mode=&includeOutOfStock=` — main search with fallbacks
- `GET /api/medicines/search-full?query=&category=` — full search including out-of-stock
- `GET /api/medicines/substitutes/:medicineId?mode=&maxDistance=` — get substitutes for a medicine
- `GET /api/medicines/emergency-stock?categories=` — critical medicine stock check
- `POST /api/medicines/learn-correction` — learn from pharmacist correction
- `POST /api/medicines/recalculate-stock` — manually trigger stock recalculation
- `POST /api/medicines/rebuild-substitutes` — manually rebuild substitute cache

### Background Workers (started on boot in `src/server.ts`)
- `startStockCalculatorWorker()` — runs daily (86400000ms), recalculates stock limits from sales
- `startSubstituteCacheWorker()` — runs weekly (604800000ms), pre-computes substitute relationships

### Integration Points
- `src/telegramBot.ts`: uses engine for out-of-stock alternative suggestions
- `src/routes/sales.ts`: existing batched alternatives approach preserved (compatible)
- `src/routes/catalog.ts`: catalog enrichment pipeline preserved (compatible)

## Special Order Arrival & Fulfillment Flow (added 2026-08)

- src/utils/orderNameMatcher.ts is the single arrival-matching scorer (exact + High-tier fuzzy, ARRIVAL_MATCH_THRESHOLD = 75). All special-order matching paths MUST use it: overlapDetectionService.detectOverlap, orderFulfillmentService.reconcileIncomingInventory, and sale-time fulfillment in outes/sales.ts.
- Candidate scoping contract: matching runs ONLY against active in-app statuses (CREATED/PENDING/IN_TRANSIT/OVERLAP_DETECTED/POTENTIAL_ARRIVAL/Pending/Ordered, plus Ready at sale time). Fulfilled/Cancelled/stale orders must never match; strength-variant siblings (base vs Plus/DS) are rejected by the extra-token cap.
- POST|PUT /api/orders/:id/status: when status becomes Ready, the handler queues the localized arrival WhatsApp inside the SAME user-clicked request via shared helper enqueueArrivalWhatsApp (also used by /:id/notify-arrival). Idempotent on 
otified===0; missing phone skips silently; response carries whatsapp_queued. This preserves the Strict Manual-Only Patient Messaging Contract: no worker or background job may ever dispatch it.
- Arrival detection still only flips status to Ready/ARRIVED with 
otified = 0; real match_type/match_confidence are stored in order_overlaps.
## Instant WhatsApp Dispatch & Resend (added 2026-08)

- User-clicked send paths (/whatsapp/queue/enqueue-single, refill reminder sends in 
outes/refills.ts, arrival helper enqueueArrivalWhatsApp in 
outes/orders.ts) call whatsappQueueWorker.forceNext() after enqueue so dispatch skips the pacing countdown and the queue UI flips Pending -> Sent immediately. Background/bulk enqueues keep normal pacing via plain 	riggerProcessing().
- POST /api/whatsapp/queue/items/:id/resend re-enqueues any sent/failed/pending item as a NEW queue item and force-dispatches it. It relies on enqueue(..., { skipDedupe: true }) because the default same-day number+message dedupe would otherwise silently suppress an identical resend.

## Queue & Worker Consolidation (2026-08 refactor)

- `src/services/whatsappQueue.ts` is now a thin compatibility facade over `whatsappQueueWorker`. Its duplicate ungated 30s setInterval (which double-drained `whatsapp_send_queue`) was removed; do NOT reintroduce a second processor for that table. The canonical worker self-gates: `isWhatsAppExplicitlyDisabled()` per tick, 10 s active / 30 s offline / 15 min when `activityTracker.isIdle()`.
- WhatsApp init/restore lifecycle (added 2026-08): every `launchClientInstance()` exit path MUST settle the init promise — `auth_failure` rejects, and the three QR exits (unsolicited-QR suppression, 120 s QR timeout, 5-QR max refresh) now reject too. Never add an early-return that leaves `initPromise` pending; a pending initPromise deadlocks sendMessage/boot auto-init/Settings connect until app restart. The queue worker treats `!isReady` as offline regardless of `initializing` (dispatching mid-restore burns retries toward `failed_perm`), and self-heals a transiently-failed boot restore via a 60 s-cooldown silent `initClient()` retry when `hasSavedSession()` is true.
- Background WhatsApp senders MUST be boot-window safe (added 2026-08): anything that can fire automatically at/near boot (emailService mail-arrival + distributor-invoice alerts) must `await waitForWhatsAppReady()` (whatsappClient.ts, bounded 90 s single-flight-aware wait) before a direct `sendMessage()` call. User-clicked routes keep immediate lazy-init semantics. Frontend failure toasts for queue/recent items carry a 15-minute freshness guard in Layout.tsx — do not remove it or persisted failure rows will re-toast every UI session.
- Pharmarack live-cart loading: GET `/api/pharmarack/cart` and the boot warm-up share one loader, `loadLiveCartCore()` in `src/routes/pharmarack.ts`. The boot warm-up (`warmupStartupCart`, wired in server.ts via `tokenRefreshScheduler.onFirstRefreshComplete()` + T+50s fallback) populates `serverCartCache` and resolves `startupSyncCoordinator` from real data — success marks loaded; no token configured marks loaded immediately; genuine session/network failure deliberately leaves sync pending so the UI startup toast stays truthful. Do not bypass the coordinator or re-add route-local cart parsing.
- Gated background loops (idle-skip added 2026-08): `distributorDispatchReminderWorker` (5 min) and `doctorReportingService` (hourly, internal daily dedupe guard prevents lost runs). Keep new workers following this P3 pattern.
- `src/middleware/validation.ts` was deleted (zero importers). Do not recreate validation middleware without wiring it into routes.
- `src/utils/whatsappTemplateBuilder.ts` `resolveActiveDeliveryBoy` is the contract-mandated resolver and reads the `delivery_boys.whatsapp_number` column (NOT `phone`, which does not exist on that table). Existing hand-rolled resolution sites in notificationService/pharmarackDailyDispatchService intentionally remain as-is (multi-boy lists, phone-splitting semantics); changing them requires explicit regression testing of WhatsApp order notifications.
- `src/utils/chromeBrowser.ts` is the single source for `findChromePath({ includeEdge? })` and `copyProfileFolder(src, dest, logPrefix)`. Pharmarack cart flows pass `{ includeEdge: true }`; tokenRefreshScheduler keeps Chrome-only lookup. Do not re-implement these helpers locally. Note: the three Levenshtein scorers (orderNameMatcher / sales.ts / productNameFilterService) intentionally remain separate — they use different normalization and substring shortcuts, so unifying them would change live matching behavior.
- Test-suite note: several jest suites (backupRecovery, pharmarackCartNotif, whatsappPipeline, etc.) fail intermittently at baseline due to better-sqlite3 ERR_DLOPEN_FAILED native-module contention between parallel workers and shared DB fixtures. Verify suspected regressions by running the suite in isolation AND comparing against a stashed baseline before attributing to code changes.