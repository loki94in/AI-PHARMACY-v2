# Backend Services and APIs (src/)

This directory contains the Express.js server logic, database interactions, routes, and background services.

## Scope & Responsibilities
- **API Endpoints**: Defined in `src/routes/`.
- **Database**: Defined in `src/database.ts` and `src/database/`.
- **Integrations**: WhatsApp (`src/whatsappClient.ts`) and Telegram (`src/telegramBot.ts`).
- **Services**: Business logic modules in `src/services/` (e.g. `backupService.ts`, `emailService.ts`).

## Schedule Drugs Hub API (added 2026-08)

- **`GET /api/schedule-drugs/summary`** and **`GET /api/schedule-drugs?type=H1|H|X&q=&stock=&page=`** (`routes/scheduleDrugs.ts`): READ-ONLY listing of master medicines classified under D&C Rules Schedules H/H1/X. `medicines.schedule_type` is written ONLY by `scripts/classifyDrugSchedules.ts` (official government lists via shared `src/utils/drugSchedules.ts`; whole-token match on name+generic_name; idempotent). Keep every schedule filter SARGABLE (`schedule_type IN ('H','H1','X','Schedule H1')`) — wrapping the column in UPPER()/TRIM() defeats `idx_medicines_schedule_type_name` and full-scans 291k rows.
- **Google-OCR research flow (added 2026-08, human-in-the-loop)**: `GET /unclassified` (review queue, newest-first), `GET /research?id=` (ONE search → ONE full-page SERP screenshot via headless Chrome + Tesseract word-boxes → filler words dropped AND logged → exact+fuzzy matches vs the schedule sets; Google bot-check auto-falls back to DuckDuckGo and the response labels the engine used) and `POST /classify {id, schedule_type:'H1'|'H'|'X'|'NONE', evidence}` — the ONLY write path, user-clicked only, storing evidence keywords into `medicines.metadata`. NEVER auto-classify from a worker/cron and never let `/research` write to the DB. Reference data single source: `src/utils/drugSchedules.ts` (script + service import it; do not fork the keyword lists).

## CRM /patients Enrichment Contract (added 2026-08)
- `GET /api/crm/patients` rows additionally carry `purchase_count`, `last_sale_date`, and `active_refill` (chunked ≤500-id indexed queries against `sales_invoices` / `patient_refills`). Enrichment failures degrade silently to unenriched rows — never drop the patient list. POS consumes these for the 🔁 Refill chip and returning-patient labels.

## Barcode Generation Surface (added 2026-08)

- **`GET /api/scan/resolve?text=`** (`routes/scan.ts`, registered 'hot'): read-only scanner resolver for the mobile Scan screen. Resolution order — (1) sale invoice by `invoice_no = left OR id = left` on the pre-`|` segment, (2) purchase bill by `invoice_no = left`, (3) medicine by exact `medicines.item_code` when the text is numeric, (4) medicine by name prefix + optional batch suffix. Returns discriminated `{ type: 'sale_invoice' | 'purchase_bill' | 'medicine' | 'not_found' }`. Keep it READ-ONLY and keep this order — bill labels always contain a `|date` suffix; EAN scans never do.

- **`GET /api/purchases/bill-barcode/:purchaseId`**: returns `{ billNo, barcodeText, qrDataUrl, code128DataUrl, pdfUrl }` for a purchase bill — QR + Code128 via shared `barcodeService.generateInvoiceBarcodeData(invoice_no, date)`, plus a printable 350x220 PDF label. Encodes the real distributor invoice number; when `invoice_no` is empty it falls back to the traceable row key `PURCHASE-<id>` (never an invented code). 404 on unknown id.
- **`POST /api/utilities/barcode`** (product labels): compact pharmacy STICKER grid (~51×27 mm, 24/page A4) — every label carries name+batch text, QR, and Code128 encoding the same real `NAME|BATCH` text (`barcodeService.generateProductBarcodeData`). No EAN fabrication; missing batch stays `N/A`. Sells history is invoice-level barcodes ONLY; product stickers belong to Purchase History.
- **`POST /api/scan/attach-barcode`** `{code, medicine_id}`: user-clicked action from the app scanner that stores a manufacturer-printed barcode/QR text into `medicines.item_code`. Rejects 409 when another medicine already owns the code. Never auto-run from workers; resolver (`GET /scan/resolve`) matches `item_code` EXACTLY for any scanned text before falling back to name-prefix, so attached codes reverse-identify instantly.
- Ownership: Sells history is invoice-level barcodes ONLY (per-product label UI was removed there). Product-label printing belongs to Purchase History.

## Strict Purchase Medicine Resolution (added 2026-08)

No purchase ingestion route may silently create `medicines` master rows. Master registration is user-driven only (POST `/medicines` via the Universal editor); inventory is created solely inside verified purchase transactions.

- **`POST /purchases/manual`**: per line, resolution order is explicit `medicine_id` → `resolveMedicineNameMultiTier` → `ocr_corrections`. A client-supplied `medicine_id` that validates against `medicines` SHORT-CIRCUITS the resolver entirely (verified-id fast path, added 2026-08-23: the multi-tier Tier-1 `LOWER(name)=?` full-scans 291k rows at ~45-85ms/line; skipping it for verified ids drops a 20-line bill body from ~1.7s to ~50ms). Resolver + OCR fallback run only for unlinked lines. If still unresolved, the line is collected and the whole transaction ROLLBACKs with `400 { unresolved_items: [{name}] }`. The former silent full-record auto-INSERT was removed. Do not reintroduce it.
- **`POST /staged/:id/approve`** and **`POST /reconciliation/reissue`**: same strict chain; the old alias → `%LIKE%` containment → bare `INSERT INTO medicines (name)` fallback was removed. Unresolved lines abort with ROLLBACK + `400 {unresolved_items}`. A client-supplied `item.medicine_id` always wins when it exists.
- **`POST /purchases/match-items`**: read-only batch resolver (`{names[], distributor_id}` → `{input, medicine_id, matched_name, confidence, match_type}`) used by StagedReviewModal and Purchase save verification. One round-trip, max 200 names, NEVER creates records. Use it instead of N per-line autocomplete calls.
- Email/telegram/mobile-sync ingestion only ever writes pending `staged_purchases`; approval remains a human-only UI action. Keep it that way.

## HSN Persistence & History Prefill (added 2026-08)
- All four `INSERT INTO purchase_items` sites in `routes/purchases.ts` now carry `hsn_code` from the parsed invoice/manual line when present (manual save, purchase edit, email reissue, staged approve). Missing values stay NULL — never invent one.
- `GET /purchases/last-purchase`, `/price-history` and `POST /batch-last-purchase` expose `hsn_code`; `GET /purchases/history-prefill?name=` returns the best single historical match (approved bills first, pending staged email invoices as fallback) with provenance — READ-ONLY, never creates records. Used by the Universal editor's "Found in past bills" confirm strip; keep it user-clicked Apply, no silent autofill.
- `GET /purchases/last-purchase` also accepts an optional `batch_no` param (`pi.batch_no COLLATE NOCASE = ?`) that narrows to the newest line of the SAME batch — powers the Purchases-page "same batch → same rate/MRP/GST" autofill. Keep it read-only.

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

## Investigation & Reports Speed Contracts (added 2026-08)

Measured on the live DB (291k medicines / 1M+ stock_ledger); do not regress any part:

- **GET /api/investigation/timeline** (`routes/investigation.ts`): filter-signature TTL cache (60 s, max 40 entries) serves EVERY page of an infinite-scroll session from ONE computation — `invalidateInvestigationTimelineCache()` is called by the three correction PUTs AND by the write interceptor in `database/connection.ts` on any transactional write. The 291k-medicines + 37k-inventory master loads are LAZY (only when adjustment logs exist). Date bounds are sargable bare-range comparisons (`sinv.date >= ?` / `< nextDay`) so `idx_sales_invoices_date` / `idx_purchases_date_dist` / `idx_returns_date` prune — measured 99.8 ms -> 1.1 ms per table vs the old `DATE(col) >= DATE(?)`. Never reintroduce unconditional master loads, DATE()-wrapped predicates, a second full sort (descending display = `.reverse()` of the ascending running-stock sort), or pagination-before-cache.
- **Non-Moving report** (`services/nonMovingReportService.ts`): READ-ONLY via plain `getConnection()` — NEVER wrap its triple-scan CTE in `dbManager.transaction()` again (BEGIN IMMEDIATE held the DB write lock for the whole multi-second scan and stalled POS saves). Results TTL-cached 5 min keyed by periodDays and shared by `/non-moving/data` plus ALL THREE export handlers; `invalidateNonMovingReportCache()` rides the same write interceptor.
- **Reports summary/data/exports** (`routes/reports.ts`): summary responses cached 60 s by type+range (`invalidateReportsSummaryCache()`, write interceptor). The COALESCE date expressions are backed by EXPRESSION indexes (`idx_sales_report_day`, `idx_purchases_report_day` in database.ts fast-boot block) — EXPLAIN confirms `USING INDEX idx_sales_report_day`; measured 12.8 ms -> 0.3 ms. If you change `SALES_DATE_EXPR`/`PURCHASES_DATE_EXPR` you MUST recreate matching expression indexes or every report reverts to full scans. Missing from-date resolves through the migration cutover clamp (`effectiveReportFromDate`), so UI "All time" no longer scans from 1970. Product-trace runs purchases+sales queries in parallel, prefix-first (`q%`) with `%q%` fallback.
- **New indexes** (database.ts fast-boot + DDL): `idx_return_items_return_id`, `idx_return_items_medicine_id` (return_items previously had ZERO), `idx_purchase_items_med_batch (medicine_id, batch_no)`.

## Purchases Dropdown & Batch-History Contract (added 2026-08)

Owner rule: ONE row per medicine NAME, and batch history follows the NAME.

- **GET /inventory/catalog-search** (owner dropdown contract, 2026-08): returns ONE name-ordered result run capped at ~50 rows inside a 100-300 ms budget. Pass 1 = indexed prefix on name+aliases LIMIT 40; Pass 2 = %term% containment fill ONLY when Pass 1 yields <15 rows (sparse-term completeness); the former Pass 3 (secondary-field OR scans) was REMOVED — it measured ~2.7 s on rare terms. Results collapse by ALPHANUMERIC-STRIPPED name key (`lower(name) minus all non-alphanumerics`; in-stock row wins, then lowest id) AFTER stock enrichment — hides both the 18 exact duplicate-name groups AND ~493 punctuation/spacing-variant twins found in the 2026-08 master-DB audit. Do NOT reintroduce stock-first grouping server-side or secondary-field scans. Consumers: Purchases page + StagedReviewModal only. The short-query seed branch returns 150 rows for the frontend module-cache pre-hydration.
- **GET /purchases/medicine-batches** expands resolved ids to sibling ids sharing the same alphanumeric-stripped name (raw-name-head LIKE prefix probe via idx_medicines_name + JS key equality, `expandSiblingIds`) BEFORE querying purchase_items/inventory_master, so batches/rates saved under either twin surface regardless of which id the user picked. Keep this expansion when editing the handler.
- Frontend mirrors the dedupe (`dedupeMedicinesByName` in pages/Purchases/index.tsx) over `getMergedCatalog()` and backend-response merges as defense-in-depth against stale module caches; selection/hover/batch-focus all share ONE module-cached single-flight history load (`loadMedicineHistory`) — never add a second fetch path for batch history.

## Expiry Return Review Scan & `expiry_month` Index (added 2026-08)

The expired-stock → pharmacist-gate pipeline is inventory-only and event-maintained. Do not regress:

- **`inventory_master.expiry_month`** (TEXT `YYYY-MM`): trigger-maintained shadow of the mixed-format `expiry_date` column (`trg_inventory_expiry_month_ins/_upd` in `database.ts`, normalization mirrors `routes/compliance.ts`; unparseable formats stay NULL). Backfill + `idx_inventory_expiry_month` run on schema apply (v43). NEVER write route-level code that recomputes it, and keep new expiry write paths trigger-compatible (plain INSERT/UPDATE of `expiry_date` is enough).
- **Scan scope contract** (`services/returnsService.ts scanAndCreateExpiryReviews`): reads ONLY in-stock rows (`quantity > 0 OR loose_quantity > 0`) via an indexed range on `expiry_month <= strftime('%Y-%m','now','localtime')` plus a NULL-bucket fallback verified by JS `isExpired()`. NO joins into purchases/orders/sales. Batches whose latest review is 'rejected' with unchanged quantity are never re-flagged; changed stock re-flags.
- **Distributor resolution belongs at approval time** (`routes/returns.ts` single + bulk approve): one indexed lookup (latest purchase line for medicine_id+batch_no). The scan stores NULL distributor — do not move purchase-history joins back into the scan.
- **Schedule**: every-N-days interval gate (`shouldRunScheduledExpiryReturnScan` / `last_expiry_return_scan_date` in `app_settings`, setting `trigger_expiry_return_interval_days`, default 15) checked by a daily 09:00 cron tick and the boot catch-up in `server.ts`. Off-day ticks cost ONE settings read. The old fixed days-of-month key `trigger_expiry_return_days` is retired.
- **`deactivateExpiredInventory`** (`utils/inventoryActive.ts`) flips ONLY `is_active = 0`; quantities are preserved so the pharmacist gate can return expired stock. Never reintroduce quantity zeroing here — POS safety comes from the `is_active` filter alone.

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

## Mobile Sale Sync Staging Contract (added 2026-08)

- **`POST /sales/sync` ALWAYS stages** — the former `adminMode` direct-commit branch was REMOVED by owner decision: phone-app bills are DRAFTS only (`staged_sales`, status `pending`), never auto-committed real invoices. Do not reintroduce any server-side path that turns a synced phone sale directly into a `sales_invoices` row; the human loop is mandatory.
- The real bill is created exclusively when the pharmacist opens the draft in POS (staged floating widget / Review-in-POS queue → `handleLoadStagedItemIntoPOS`) and saves via the normal POS flow. On save, POS calls **`POST /sales/staged/:id/consume`** which flips the draft to `status='converted'` and stores `converted_invoice_no` (lazily ensured column). Approve (server-side commit) and Reject endpoints remain for the StagedReviewModal flow.
- Idempotency: sync payloads may carry `client_ref`; refs recorded in `sync_client_refs` inside the same transaction make replays duplicate-safe.
- `GET /sales/staged` (no param) returns pending only; Phone Sales page and badge counts read it — keep converted/rejected rows out of that default filter.

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

## Multi-Medicine Inbound Extraction (added 2026-08)

Mixed conversational WhatsApp messages ("bhai kal aa raha hu, dolo 650 aur telma 40 chahiye") and multi-product photos now yield EVERY medicine, not one joined garbage query. Do not regress to single-name search:

- `extractMedicineCandidates()` (services/intentKeywords.ts) splits messages on punctuation/newlines then conjunction tokens (`aur/and/bhi/also/plus/or/ya/ani`), parses each segment with the SAME shared token parser as parseMessage (`parseTokenList`), validates every name via `isPlausibleMedicineName`, dedupes case-insensitively, caps at 8. `parseMessage` output is byte-compatible (refactor only).
- `handleInbound` (whatsappIntentService.ts) searches each candidate independently via `searchAndBroadcast`; legacy `parseMessage` single name remains as fallback when segmentation finds nothing; scispaCy contributes EVERY plausible CHEMICAL entity (was: first only).
- `handleOcrComplete` collects extras beyond the primary OCR name — DB fuzzy `matches[]`, generic/API names, caption candidates, plausible OCR lines — capped at 4, each passing its own V2 scan-gate decision + plausibility check before search.
- Wrong-entry protection is UNCHANGED: confidence gate (`passesGate` 0.60/0.72) per candidate, V2 Signal-Required gate per image candidate, unreadable images still escalate to admin with the photo. NOISE_WORDS gained Hinglish conversation verbs (`aa/raha/hu/jayega/mil/kar...`) — exact-token matches only so single-token brands never collide.
- Non-allopathic skip (owner rule, 2026-08): `detectNonAllopathicKind()` (intentKeywords.ts — reuses the single-source `COSMETIC_MARKERS` from utils/drugSchedules.ts plus conservative ayurvedic/homeopathy name markers) runs in `searchAndBroadcast` BEFORE the catalog/live Pharmarack searches. When a candidate is cosmetic / personal-care, ayurvedic or homeopathy AND it is not an EXACT registered local name that is physically IN STOCK, the pipeline skips ALL external searches and shortage tracking, broadcasting `wa_medicine_match { availability: 'NON_ALLOPATHIC', productKind }` so the Pharma Intelligence → WA Requests feed shows the request truthfully labeled instead of unmatched noise; `waAdminEscalationService.notifyAdminOfNonAllopathic()` sends the owner a SHORT one-line WhatsApp note (same toggle/admin-number/self-send/24h-dedupe guards) so no request is invisible. Do not reintroduce Pharmarack spend for these kinds; marker lists stay non-exhaustive by design.
- One-photo-one-result (owner rule, 2026-08): `handleOcrComplete` runs every V2-passing candidate through the gate as before, but ONLY the PRIMARY candidate calls `searchAndBroadcast` — the single possible live Pharmarack search per photo. Extra strip/caption medicines are resolved by `resolveRelatedMedicinesLocal()` (local fuzzy matcher + batched shelf-stock query ONLY — never catalog/live paths) and ride along as `relatedMedicines` on the primary broadcast AND in the owner's escalation message ("Also on this strip" lines). The saved inbound photo (`data/inbound_media/<msgId>.jpg`) is attached to the owner's message via `imagePath` and served to the UI read-only through `GET /api/messaging/wa-media/:msgId` (same id sanitization as the writer). Image arrivals that land while WhatsApp is NOT ready (boot restore window / idle-sleep wake) first join the single-flight restore via bounded `waitForWhatsAppReady(60s)` and retry the download 5 × 2 s — never burn the retry budget against a half-open session. Text messages KEEP per-candidate cards — do not consolidate those.

## Truthful Availability Classification (added 2026-08)

A medicines-master match is NOT shelf presence (291k imported reference rows). Every `wa_medicine_match` broadcast and admin escalation must carry the real state:

- `resolveInventoryStock()` (whatsappIntentService.ts): ONE batched indexed query per message — matched names → summed ACTIVE stock (`inventory_master.is_active=1`, quantity+loose_quantity), keys lowercased, capped at 10 names. Exported for unit testing.
- `classifyAvailability()`: `IN_STOCK` (match + stock > 0) | `REGISTERED_NO_STOCK` (master name, zero shelf) | `EXTERNAL_ONLY` (catalog/OCR only). Both fields (`availability`, `inventoryStock`) flow into the SSE payload AND `maybeEscalate`.
- Escalation messages must stay truthful: REGISTERED_NO_STOCK renders "Registered in DB but NOT in Physical Stock" with distributor options instead of the old false "✅ In Stock (local)" line. Do not regress that wording.
- REGISTERED_NO_STOCK also (a) triggers Pharmarack catalog/live search so the admin sees order options, and (b) feeds shortageReminderService tracking.

## Queue & Worker Consolidation (2026-08 refactor)

- `src/services/whatsappQueue.ts` is now a thin compatibility facade over `whatsappQueueWorker`. Its duplicate ungated 30s setInterval (which double-drained `whatsapp_send_queue`) was removed; do NOT reintroduce a second processor for that table. The canonical worker self-gates: `isWhatsAppExplicitlyDisabled()` per tick, 10 s active / 30 s offline / 15 min when `activityTracker.isIdle()`.
- WhatsApp init/restore lifecycle (added 2026-08): every `launchClientInstance()` exit path MUST settle the init promise — `auth_failure` rejects, and the three QR exits (unsolicited-QR suppression, 120 s QR timeout, 5-QR max refresh) now reject too. Never add an early-return that leaves `initPromise` pending; a pending initPromise deadlocks sendMessage/boot auto-init/Settings connect until app restart. The queue worker treats `!isReady` as offline regardless of `initializing` (dispatching mid-restore burns retries toward `failed_perm`), and self-heals a transiently-failed boot restore via a 60 s-cooldown silent `initClient()` retry when `hasSavedSession()` is true.
- Background WhatsApp senders MUST be boot-window safe (added 2026-08): anything that can fire automatically at/near boot (emailService mail-arrival + distributor-invoice alerts) must `await waitForWhatsAppReady()` (whatsappClient.ts, bounded 90 s single-flight-aware wait) before a direct `sendMessage()` call. User-clicked routes keep immediate lazy-init semantics. Frontend failure toasts for queue/recent items carry a 15-minute freshness guard in Layout.tsx — do not remove it or persisted failure rows will re-toast every UI session.
- Pharmarack live-cart loading: GET `/api/pharmarack/cart` and the boot warm-up share one loader, `loadLiveCartCore()` in `src/routes/pharmarack.ts`. The boot warm-up (`warmupStartupCart`, wired in server.ts via `tokenRefreshScheduler.onFirstRefreshComplete()` + T+50s fallback) populates `serverCartCache` and resolves `startupSyncCoordinator` from real data — success marks loaded; no token configured marks loaded immediately; genuine session/network failure deliberately leaves sync pending so the UI startup toast stays truthful. Do not bypass the coordinator or re-add route-local cart parsing.
- Gated background loops (idle-skip added 2026-08): `distributorDispatchReminderWorker` (5 min), `doctorReportingService` (hourly, internal daily dedupe guard prevents lost runs), `orderFulfillmentService` (hourly refill check, idle-gated 2026-08-23) and `autoMatchWorker` (15-min scan, idle-gated 2026-08-23 + one-reconcile-per-order guard: its query excludes orders that already have an `order_overlaps` row, so a case is calculated exactly once — never reprocessed). Keep new workers following this P3 pattern.
- Medicine sales metrics NO-RECALC rule (owner decision 2026-08-23): `medicine_sales_metrics` is kept fresh ONLY by the live per-line hooks (`applySaleDelta` in routes/sales.ts, `applyPurchaseDelta` in routes/purchases.ts). The former nightly 03:00 DELETE-all+recompute cron was REMOVED. Full reconcile (`reconcileAllMedicineSalesMetrics`) runs exclusively on (a) the one-time initial backfill when the table is empty, deferred to T+60s so it never touches the boot-critical path, or (b) an explicit user click in Settings. Do NOT reintroduce any scheduled full recalculation.
- Lazy / credential-gated background workers (owner rule 2026-08-23: a feature that was never configured must run ZERO timers):
  - `whatsappQueueWorker` loop is LAZY — no constructor auto-start. It boots on first `enqueue()` / `forceNext()` / `triggerProcessing()` / facade `startWorker()`, and delayed sends arm their own one-shot timer. Boot runs only `cleanupOldSentItems()` for crash recovery. Never reintroduce an always-on constructor loop.
  - `messagingQueue` poll starts on first pending `queueMessage()` / `retryMessage()` — server.ts no longer calls `messagingQueue.start()` at T+2s.
  - Pharmarack catalog-sync cron (35 min) is registered ONLY while `pharmarack_session_token` is set (`ensureCatalogSyncCron` / `stopCatalogSyncCron` in pharmarackCatalogCache.ts). Token save sites (routes/pharmarack.ts ×3, tokenRefreshScheduler) arm it; logout/clear sites disarm it.
  - Doctor-reporting scheduler and distributor dispatch-reminder worker are registered at boot ONLY when their `trigger_*_enabled` setting is 'true' (triggerSchedulerService keeps live start/stop ownership after boot).
  - Catalog job poller stretches to 60s while `catalog_jobs` has never held any job; upload/requeue nudges via `nudgeCatalogJobPoller()` (in-process only).
- `src/middleware/validation.ts` was deleted (zero importers). Do not recreate validation middleware without wiring it into routes.
- `src/utils/whatsappTemplateBuilder.ts` `resolveActiveDeliveryBoy` is the contract-mandated resolver and reads the `delivery_boys.whatsapp_number` column (NOT `phone`, which does not exist on that table). Existing hand-rolled resolution sites in notificationService/pharmarackDailyDispatchService intentionally remain as-is (multi-boy lists, phone-splitting semantics); changing them requires explicit regression testing of WhatsApp order notifications.
- `src/utils/chromeBrowser.ts` is the single source for `findChromePath({ includeEdge? })` and `copyProfileFolder(src, dest, logPrefix)`. Pharmarack cart flows pass `{ includeEdge: true }`; tokenRefreshScheduler keeps Chrome-only lookup. `copyProfileFolder` is ASYNC (fs.promises walk) — always `await` it; never revert to sync `fs.copyFileSync` walking (it blocked the event loop during lock-fallback copies). Do not re-implement these helpers locally. Note: the three Levenshtein scorers (orderNameMatcher / sales.ts / productNameFilterService) intentionally remain separate — they use different normalization and substring shortcuts, so unifying them would change live matching behavior.
- Pharmarack session keep-alive is a REST heartbeat (owner zero-ban-risk decision 2026-08): the scheduler tick runs `runSessionHeartbeat()` (one authenticated `GetUserCartDetails` probe per interval, P4-exempt from idle gating) and launches headless Chrome ONLY on probe 401/403, profile-without-token capture, or user-clicked manual re-auth. `executeRefresh()` is single-flight (mutex promise) — cron/401-retry/catalog-cache callers share one restore. Do NOT reintroduce a periodic browser refresh loop or bypass the mutex. The scheduler `start()` fires right after boot Phase 1/2 (DB ready), NOT in the Phase-4 T+2s stagger, so token validation and any needed browser restore begin before the first user search can hit a mid-typing 401.
- Pharmarack search cache is disk-persistent with stale-while-revalidate (added 2026-08): `src/services/searchCache.ts` loads/saves its ≤100 entries to `<appDataDir>/data/search-cache.json` (2 s debounced write + flush-on-exit; entries older than 7 days pruned). `GET /api/pharmarack/search` serves fresh AND expired-but-present entries instantly via `searchCache.lookup()` (`{ items, stale }`); stale hits fire ONE background single-flight revalidation per key (`revalidateStaleSearch` → shared `performPharmarackSearch` core) so the dropdown never waits on a cold network or an in-flight Chrome session restore — response codes (200/401 NEED_LOGIN/503 CONNECTION_ERROR) and only-cache-non-empty semantics are unchanged. Do not revert `lookup()` back to fresh-only `get()`, do not delete stale entries on read, and keep the request-path/revalidation logic sharing the single `performPharmarackSearch` core.
- WhatsApp idle-sleep (RAM diet, owner decision 2026-08): while a client is resident, a ~60 s evaluator destroys it after `whatsapp_idle_sleep_min` (default 15; 0 = off) of inactivity — never during init/QR/sync flows — broadcasting `wa_status_changed {status:'sleeping'}`. Wakes are demand-driven only (`sendMessage`/`getChats` auto-init, queue-worker silent restore, explicit Connect); `GET /messaging/qr` must NOT auto-restore a sleeping client. Activity sites call `markWhatsAppActivity()`. Same ban profile as before — do not add poll-based wakes or change how WhatsApp is driven.
- Test-suite note: several jest suites (backupRecovery, pharmarackCartNotif, whatsappPipeline, etc.) fail intermittently at baseline due to better-sqlite3 ERR_DLOPEN_FAILED native-module contention between parallel workers and shared DB fixtures. Verify suspected regressions by running the suite in isolation AND comparing against a stashed baseline before attributing to code changes.