# Test Baseline — all suites green (2026-08-25)

> Current state: `npm test` → **72/72 suites, 433/433 tests PASS** in full parallel mode.
> This file documents how that was achieved, what each historical failure was, and the
> residual flake risks. Any NEW failure is a regression by definition.

## Commands

```bash
npm test                    # full parallel run (~60-90 s) — the default & target state
# Deterministic fallback under heavy native-module contention:
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit
```

## What was broken and how it was fixed (2026-08-25 sweep)

| Category | Suites | Fix |
|---|---|---|
| Stale `whatsappClient` mocks missing newer exports (`hasSavedSession`, `waitForWhatsAppReady`, `getWhatsAppStatus`, …) — ESM link errors killed whole files | automation, refills, legitimateDataWorkflow, emailPurchaseDateIntegrity, pharmarackCartItemVisibility, refillPharmacyName, waAdminEscalation, whatsappIntentGate, emailPurchaseDistributorIntegrity | Factories now stub the FULL export surface; keep per-file `sendMessage` behavior |
| Queue-worker dispatch contract: sends go through `whatsappQueueWorker.enqueue` → 4-arg `sendMessage(number, mediaUrl, message, file)` + worker needs `getWhatsAppStatus().isReady:true` in mocks | automation | Mocks updated to 4-arg assertions + `isReady:true` + `{sent:true}` result shape |
| Escalations dispatch via queue worker, not direct send | waAdminEscalation | Suite now mocks `whatsappQueueWorker` and asserts on `enqueue` calls; display phone format `+91 XXXXX XXXXX` |
| Strict purchase-resolution contract (no auto-created medicines) | legitimateDataWorkflow, emailPurchaseDateIntegrity, emailPurchaseDistributorIntegrity | Tests register master medicines before staged approval (mirrors real workflow) |
| Strict migration contract: unknown legacy medicine ids are skipped+audited | inventoryParser | Fixtures seed the medicines ids they reference |
| Boot-defer guard on backups (`uptime < 60 s`) | restoreBackup | Tests call `createBackup('Manual')` which bypasses the guard by design |
| Pooled-unit stock math with loose quantities (app CORRECT, tests stale) | investigation | Expectations updated to unit-pool arithmetic (120 strips + 5 loose − 3 net = 122) |
| Live-network / sidecar leakage in unit tests | whatsappPipeline | `pharmarackCatalogCache` + `scispacyClient` mocked; isolated `WWEBJS_AUTH_DIR`; pipeline tests carry 60 s timeouts (first-call warm-up cost) |
| Dev machine's REAL WhatsApp session reachable from tests (Chrome launch risk!) | whatsappRouting, whatsappPipeline | **App seam:** `WWEBJS_AUTH_DIR` env override in `whatsappClient.ts`; suites point it at an empty temp dir |
| Async drain races under parallel CPU load | automation | Fixed sleeps replaced with poll-until-called (5 s deadline) |

## Real app bugs found BY this sweep

1. **`catalog_jobs` missing 12 columns** (P1): base CREATE only had id/file_path/status/created_at,
   while worker + routes read/write `original_filename, extracted_data, mapping_config,
   data_filters, error_log, progress, total_count, processed_count, new_count,
   existing_count, duplicate_count, matched_previous_job_id, newly_detected_columns`.
   EVERY fresh install (and the live dev DB!) crashed any catalog upload/review with
   `SQLITE_ERROR: no such column`. Fixed via guarded ALTERs in `ensureSchema`
   (`src/database.ts`, same pattern as the earlier stock_ledger fix). Idempotent on boot.
2. **WhatsApp auth-dir env seam** (`WWEBJS_AUTH_DIR`): tests could previously load/launch
   against the developer's live session. Now overridable; default behavior unchanged.

## Residual flake risk

- Native-module contention (`better-sqlite3` ERR_DLOPEN / puppeteer protocol noise) can
  still flake ONE suite when many workers start simultaneously on a loaded machine.
  Observed rotating across runs (telegramBot/processGuardian once; crm/investigation in
  another) — each always passes isolated and the next full run is green. Re-run `npm test`
  once before treating a failure as real.
- Do NOT switch the default test script to `--runInBand`: with Node 24 + jest ESM, a
  shared-process puppeteer import crashes the runner itself (puppeteer Debug.js TypeError).
  Parallel mode is the supported path.

## Regression protocol

1. A suite fails → re-run `npm test` once (contention flakes rotate between runs).
2. Still failing → run that suite ALONE with the runInBand command above.
3. Passes alone → contention; note it and move on.
4. Fails alone → compare against the fix table; anything not covered there is a real
   regression introduced by recent changes.
5. Adding exports to `src/whatsappClient.ts`? Update the mock factories in tests that
   stub it — ESM link errors otherwise fail entire files at import time.
