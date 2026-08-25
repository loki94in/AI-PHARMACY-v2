# Production Readiness Checklist — AI Pharmacy OS

> Scope: single-shop, single-PC Windows deployment. Auth/security review is tracked
> separately by owner request (explicitly OUT of scope here).
> Status legend: ☐ = do before go-live · ✅ = already in place (verified 2026-08-25)

## 1. Build & install
- ✅ One-command EXE build: `npm run build:exe` (clean client+server build → SEA bundle).
- ✅ Writable data under `%LOCALAPPDATA%\AI Pharmacy OS` (legacy installs auto-migrate on first run).
- ☐ Run the packaged `.exe` (not `npm run dev`) through this whole checklist once — dev and packaged modes differ (port 5174 vs 5175, `.env` beside exe).

## 2. Data safety & backup-restore drill (do at least once, for real)
- ✅ Scheduled backups exist (`backup_frequency` in app_settings; cron-based scheduler) + manual backup API/UI (`POST /api/utilities/backup`, Settings → Data & Backups).
- ✅ Crash-recovery snapshots dir `<backupDir>/snapshots` + fresh-DB detection on boot.
- ✅ Corrupt-DB self-healing: integrity check → WAL checkpoint → restore from newest backup (`database/connection.ts`), `DB_INTEGRITY_FAILURE` surfaced to user instead of silently continuing.
- ✅ **Restore drill is one command**: `npm run drill` (`scripts/backup-restore-drill.mjs`) — sandboxed snapshot → service-format .db.gz backup → post-backup writes → restore → integrity + canary + FTS verification. **PASSED 2026-08-25 on the live DB** (291,879 medicines, 106 MB backup, FTS intact).
- ☐ Run `npm run drill` once on the actual shop PC after install (validates THAT machine's disk + build).
- ☐ Confirm backup destination disk has ≥ several GB free and is NOT the same physical drive as the DB where possible.
- ☐ Verify the scheduled frequency matches shop hours (backup runs are idle-gated per the data-fetch contract).

## 3. Crash resilience / watchdog
- ✅ `processGuardian`: uncaught exceptions/rejections → crash_log table → exit(1).
- ✅ **Watchdog script exists**: `scripts/watchdog.mjs` (`npm run watchdog`) — restarts on exit code 1 with the WorkerSupervisor backoff (30 s stability reset, n×3 s delay, cap 5 fast crashes), logs to `<dataDir>/watchdog.log`; `--self-test` verified. Intentional stops are never restarted.
- ☐ Install the watchdog on the shop PC: desktop shortcut / startup entry running `node scripts/watchdog.mjs --exe "C:\...\AI Pharmacy.exe"` (or set `PHARMACY_EXE`). Without this step running once, crashes still mean a dead till until someone notices.
- ✅ Boot-time `last_clean_shutdown` check warns after dirty shutdown.
- ☐ Kill the process mid-sale once (Task Manager) → relaunch → confirm no data corruption toast and the sale can be re-entered.

## 4. Sessions & integrations
- ✅ Pharmarack REST heartbeat + single-flight browser restore (never-lose-credentials).
- ✅ WhatsApp idle-sleep with demand-driven wake; truthful SLEEPING status.
- ☐ Reconnect drill: reboot PC → confirm WhatsApp auto-restores from saved session (or one QR scan) and queued messages dispatch.
- ☐ Confirm distributor emails flow (email poller interval configured) and Telegram bot token set if used.

## 5. Data hygiene (completed 2026-08-25, keep periodic)
- ✅ `special_orders.phone` normalized to digits-only (one-shot `node scripts/normalizeSpecialOrderPhones.mjs`; re-runnable anytime, idempotent).
- ✅ Write-path guards: shortage pipeline + order PUT strip chat-id suffixes/formatting.
- ☐ Spot-check CRM special orders monthly for wrong-customer phones (data-entry errors still happen upstream of code).

## 6. Performance guardrails
- ✅ SSE event-driven refresh, cache-first pages, gated workers — enforced by `npm run guardrails` (blocking on changed lines).
- ☐ Run `npm run guardrails --all` once before release for an advisory full-tree pass.

## 7. Tests & regression baseline
- ✅ Honest baseline documented: see `docs/TEST_BASELINE.md` (which suites fail at baseline, why, and the isolation protocol).
- ☐ Before go-live: fix or explicitly accept the deterministic failing suites (dominant cause: stale `whatsappClient` mocks missing newer exports).

## 8. First-week operations watchlist
- ☐ Check `crash_log`, `action_logs` (`AUTOMATION_ALERT` entries) and console output daily.
- ☐ Watch WhatsApp Queue popover for failed customer messages; use Resend (fixed 2026-08-25) instead of retyping.
- ☐ Confirm Mark Ready arrival WhatsApp fires exactly once per order from BOTH Quick Assist and CRM edit paths (fix P1-08).
- ☐ Review backup folder actually growing on schedule.

## Known limitations (accepted for v1 production)
- Single-machine SQLite: no multi-terminal/multi-store concurrent use.
- Windows-only assumptions (paths, watchdog).
- WhatsApp automation carries inherent platform ban risk despite pacing/idle-sleep design.
