# Implementation Plan — Auto-WhatsApp Notification on New Mail Arrival

> **Status:** IMPLEMENTED
> **Created:** 2026-08-21
> **Priority:** P1 (daily workflow broken — distributor invoice alerts delayed by hours)
> **Rulebook:** `AGENT_BUG_FIX_RULEBOOK.md` workflow applies (bug-fix session)

---

## 1. Problem Statement

When a new distributor invoice email arrives, the app does **not** notify the owner/pharmacy
unless someone manually opens the Mail page and clicks Refresh. WhatsApp notifications only
fire in bursts at manual-refresh moments (hours late). The user wants:

- New mail → instant WhatsApp to Owner + Store, even when the app is idle, minimized,
  or the Mail page was never opened.
- The existing Settings toggle must let the user turn polling ON/OFF from inside the app
  without restarting.
- Background pulling ON by default.

## 2. Root Cause Diagnosis (verified against live DB `data/app.db` on 2026-08-21)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | Background poller worker IS running every 2 min | `automation_enabled=true`, `trigger_email_poller_enabled=true`, `trigger_email_poller_interval_min=2` |
| 2 | Gmail credentials OK, OAuth connected | `gmail_user=tanmaymedical637@gmail.com`, `gmail_auth_status=connected` |
| 3 | **Every poll tick returns immediately** — `pollInbox()` reads `getBackendFetchMode('bg.emailImapPoll', 'off')`; the `data_fetch_control` key is MISSING from `app_settings`, so default `'off'` wins | `src/services/emailService.ts:1162-1165`, `src/services/dataFetchControl.ts:3-21` |
| 4 | Only sync trigger that works = manual Refresh button (`POST /api/email/sync` bypasses the gate) | `src/routes/email.ts:110-119` |
| 5 | WhatsApp send pipeline works perfectly headlessly | 182 rows in `automation_notifications`, all `status='sent'`, zero errors, to owner `8080888041` + store `9130558910` |
| 6 | Settings toggle "Email PDF Invoice Poller" (`trigger_email_poller_enabled`) is read ONLY at boot, so toggling it requires an app restart | `src/worker/emailPoller.ts:30-34` (gater runs once at startup) |
| 7 | In-app toast/SSE for new mail is dead code (no frontend listener handles `email_update`; `notificationManager.addClient()` never called) — OUT OF SCOPE for this fix | `frontend/src/pages/CRM/index.tsx:2673` handles other event types only |

**Conclusion:** the *send* side works; the *pull* side is disabled by a default-off gate.
Fix the gate default + make the toggle live-readable per tick.

## 3. Target Behavior (after fix)

```
Server running (any state: idle, minimized, Mail page never opened)
  └─ every N min (Settings interval, currently 2): pollInbox()
       ├─ CHECK: trigger_email_poller_enabled === 'false'? ── yes → skip (live toggle)
       ├─ data_fetch_control bg.emailImapPoll missing → defaults 'auto' → proceed
       └─ IMAP delta sync (UID > last stored) → new mail found
            └─ notifyMailArrival() → WhatsApp instantly to Owner + Store
               (dedup via automation_notifications.reference_id = email_uid_<uid>[_<phone>])
```

## 4. Changes (3 files, minimal diffs)

### Change 1 — `src/services/emailService.ts:1162` (ROOT CAUSE FIX)

```ts
// BEFORE:
const mode = await getBackendFetchMode('bg.emailImapPoll', 'off');
// AFTER:
const mode = await getBackendFetchMode('bg.emailImapPoll', 'auto');
```

Effect: background pull becomes live by default whenever the server process runs.
An explicit `data_fetch_control` override (if ever written) still wins.

### Change 2 — `src/services/emailService.ts` → `pollInbox()` (~line 1154) — LIVE TOGGLE

Add a per-tick check so the existing Settings toggle takes effect within one poll cycle,
no restart needed (same pattern as `tokenRefreshScheduler.ts:228` which re-reads its
enabled flag each tick):

```ts
// Inside pollInbox(), before syncing:
const gateRow = await db.get(
  "SELECT value FROM app_settings WHERE key = 'trigger_email_poller_enabled'"
);
if (gateRow && gateRow.value === 'false') {
  return; // User turned Email PDF Invoice Poller OFF in Settings -> Triggers
}
```

Notes:
- Use the same DB access pattern already used inside `emailService.ts` (check how
  `buildImapConfig` / other methods read `app_settings` and mirror it).
- Keep it cheap: single indexed PK lookup on `app_settings`, negligible per 2-min tick.
- Do NOT touch the boot-time gater in `src/worker/emailPoller.ts` — it stays as-is.

### Change 3 — `frontend/src/services/dataFetchControl.ts:249-256` — REGISTRY CONSISTENCY

```ts
{
  key: 'bg.emailImapPoll',
  label: 'Background Email Poll',        // was 'Email IMAP 5-min Poll'
  page: 'Backend',
  callSite: 'emailService.ts:1162',      // was stale 'emailService.ts:1115'
  defaultMode: 'auto',                   // was 'off'
  external: true
}
```

## 5. Explicitly Out of Scope (do NOT do in this task)

- No Telegram setup (`telegram_bot_token` not configured — separate decision).
- No in-app toast / SSE `email_update` frontend listener (user did not select Fix 2).
- No seeding of `data_fetch_control` in DB — backend default change covers it.
- No changes to WhatsApp send pipeline, notification dedup, UID delta-sync logic,
  retention pruning, or `notificationManager`.
- No removal of stale registry entry `mail.imapSync` (avoid while-we're-here refactors).

## 6. Verification Checklist

1. Restart server → confirm log `[EmailPoller] Email poller worker started with interval: 2 minutes.`
2. Send a test invoice email to `tanmaymedical637@gmail.com` from a distributor-style address.
3. Wait ≤ 2 minutes WITHOUT opening the Mail page → verify:
   - New row in `emails` table (uid > previous max)
   - Two new rows in `automation_notifications` (`status='sent'`, ref `email_uid_<uid>_8080888041` and `_9130558910`)
   - WhatsApp message received on owner phone
4. Toggle OFF: Settings → Triggers → uncheck "Email PDF Invoice Poller" → Save → wait one
   cycle → confirm no IMAP activity / no new pulls.
5. Toggle ON again → confirm polling resumes within one cycle.
6. Manual Mail-page Refresh still works (bypass path unchanged).
7. Run typecheck/lint for backend and frontend (project commands).
8. Confirm no new errors in server console/logs.

## 7. Housekeeping (mandatory per AGENTS.md)

- [x] Implemented in `src/services/emailService.ts` and `frontend/src/services/dataFetchControl.ts`.
- [x] Run `node scripts/quick-update.mjs` after all edits.
- [x] Conclude task response with the 8-point Audit Summary (Strict Legitimate Data contract).

## 8. Risk Notes

- `manual` mode semantics unchanged: if a user later sets `bg.emailImapPoll=manual` via
  data_fetch_control, idle-gating (>30 min inactivity) pauses polling — acceptable; default
  is now `auto` precisely to avoid this for time-critical invoice alerts.
- Interval changes (`trigger_email_poller_interval_min`) still require restart to apply —
  accepted (toggle ON/OFF is the primary control and is now live).
