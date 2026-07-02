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
