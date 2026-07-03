# Backend Services and APIs (src/)

This directory contains the Express.js server logic, database interactions, routes, and background services.

## Scope & Responsibilities
- **API Endpoints**: Defined in `src/routes/`.
- **Database**: Defined in `src/database.ts` and `src/database/`.
- **Integrations**: WhatsApp (`src/whatsappClient.ts`) and Telegram (`src/telegramBot.ts`).
- **Services**: Business logic modules in `src/services/` (e.g. `backupService.ts`, `emailService.ts`).

## Rules & Constraints
- Keep database operations secure, avoiding direct raw query concatenation.
- All new dependencies must be scanned using `scan_dependencies` before import.
- Run `node scripts/quick-update.mjs` after any updates to backend files.

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
| `src/worker/substituteCacheWorker.ts` | Background worker: pre-computes substitute relationships weekly |
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
