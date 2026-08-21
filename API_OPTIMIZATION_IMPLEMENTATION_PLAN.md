# API OPTIMIZATION & SESSION STABILITY — MASTER IMPLEMENTATION PLAN

> **Status:** ✅ IMPLEMENTED (2026-08-21) — Phases 1–4 complete; Phase 5 runtime verification (DevTools idle audit, overnight session test) pending on a live machine.
> **Created:** 2026-08-21
> **Scope:** Whole app (frontend SPA + backend services/workers + session persistence)
> **Rule for agents:** Read this plan fully before touching any file listed here. Do not deviate from the phases. After each phase, verify with the checklist in Section 8.

---

## 1. WHAT WE ARE DOING

Converting the app from **timer-driven** (ask the server every N seconds forever, even when nothing changed and nobody is using it) to **event-driven + cache-first** (server pushes an update only when data actually changes; pages paint instantly from cache), while guaranteeing saved logins (**Pharmarack, WhatsApp, Gmail, Telegram**) are never forgotten unless a real expiry or user-initiated logout happens.

## 2. WHY WE ARE DOING THIS

Measured today with zero user activity:

- Frontend alone makes **~1,700+ HTTP calls/hour (~28/min)**: Special Orders every 15 s (`Layout.tsx:3184,3193`), action-logs every 5 s (`Layout.tsx:468`), WA queue every 15 s (`Layout.tsx:1123`), services-status 30 s, upcoming triggers 30 s, Mail inbox 15 s (`Mail/index.tsx:412`), QueuePopover 2 s when mounted (`WhatsAppQueuePopover.tsx:108`), plus ungated Expiry/Returns/PhoneSales/Dispatch/Settings polls.
- Backend adds **~1,200 DB loop-ticks/hour**: WhatsApp/messaging queues 30 s, device monitor 10 s (`notifications.ts:503`), catalogWorker poll 10 s, inventoryCache rebuild 10 min, etc.
- Consequences: wasted CPU/network, SQLite contention → lag spikes during sales, battery drain on laptop PCs.
- Pharmarack token refresh hard-skips when user idle >30 min (`tokenRefreshScheduler.ts:334`) → session dies overnight → morning OTP re-login.
- `POST /api/messaging/reconnect` (`messaging.ts:325`) misleadingly **deletes** the WhatsApp session via `forceReconnect()` → `rmSync .wwebjs_auth`.
- Two auto-paths blank the Pharmarack token on transient failures (`tokenRefreshScheduler.ts:443`, `pharmarack.ts:137`) even though Chrome cookies are still valid.
- Session folders (`.wwebjs_auth`, `data/pharmarack_profile`) are **not included in any backup** — reinstall/disk failure loses logins forever.

## 3. HOW WE ARE DOING THIS — 4 PRINCIPLES

| # | Principle | Rule |
|---|---|---|
| P1 | **Events, not timers** | Backend emits SSE at every write point via existing `eventService` (`src/services/eventService.ts`) → existing stream `/api/notifications/stream`. Frontend has ONE global listener mapping events → `queryClient.invalidateQueries()`. No interval re-reads unchanged data. |
| P2 | **Cache-first paint** | Pages hydrate instantly from module-level caches on mount (existing SPA contract). Network refresh only on SSE event or first focus. Page switching is never blocked on network. |
| P3 | **Gated workers** | Every background loop reads `dataFetchControl` registry (`getBackendFetchMode`) + respects `activityTracker.isIdle()`. Idle >30 min → messaging queues tick once per 15 min; monitors back off ×6. Necessary jobs keep running: email pull at user-set interval, Pharmarack token refresh ~20 min (also when idle). |
| P4 | **Credentials are sacred** | No code path deletes `.wwebjs_auth` or `data/pharmarack_profile` except explicit user Logout / Factory Reset. Transient auth failures mark status `stale` and retry next cycle — never blank tokens. |

## 4. OUTCOME — HOW THE APP WILL WORK ON THE PC

| Scenario | Before | After |
|---|---|---|
| App open, nobody touching it | ~28–48 calls/min | **~0.13/min** (email pull per setting + token refresh ~3/hr + 15-min queue tick) |
| User makes a sale / saves invoice | Other pages stale up to 15 s | Dashboard/Reports/Inventory update <1 s via push |
| Add/edit Special Order or Refill | Polled every 15 s forever | Zero polling; badge updates on actual edit event |
| Overnight idle | Token dies → morning OTP | Token refreshed all night → no re-login |
| WA disconnect/crash/restart | Session can be wiped by buggy "reconnect" | Session survives; QR only after real logout |
| New email arrives | Inbox list polled too | IMAP checks at configured interval → owner notified only when mail arrives → page updates via push |
| Disk failure / reinstall | All logins lost | Sessions included in backups → restore and continue |
| Future new feature added by any agent | Risk of reintroducing polling waste | Governed by Section 7 standard — event-driven by default |

---

## 5. CURRENT STATE AUDIT (verified file:line references)

### 5.1 Frontend polls to DELETE or convert (all become SSE-driven)
| Location | Interval | Endpoint | Action |
|---|---|---|---|
| `frontend/src/components/Layout.tsx:468-472` | 5 s | `/api/notifications/action-logs?limit=150` | DELETE timer → SSE `activity_logged` (already emitted by `activityLogger.ts:53`) |
| `Layout.tsx:1100-1121` | 30 s | `/api/system/services-status` | Keep as single fallback poll at 120 s, gated `layout.servicesStatus` default `manual`, pause when hidden |
| `Layout.tsx:1123-1144` | 15 s (3 s active) | `/api/whatsapp/queue/status` | DELETE timer → SSE `wa_status_changed`; keep poll ONLY while queue popover/modal open |
| `Layout.tsx:1215-1219` | 30 s | `/api/triggers/upcoming` | DELETE timer → invalidate on trigger CRUD events |
| `Layout.tsx:3184-3191` | 15 s refetchInterval | `/api/orders` | DELETE → SSE `order_updated` |
| `Layout.tsx:3193-3200` | 15 s refetchInterval | `/api/refills` | DELETE → SSE `refill_updated` |
| `pages/Mail/index.tsx:412-423` | 15 s | `/api/email/inbox` | DELETE → SSE `email_new`; page-active only |
| `pages/Expiry/index.tsx:79-97` | 15 s visible-refetch | expiry list | Gate with `useFetchMode` + only on `expiry_list_changed` |
| `pages/Returns/index.tsx:452-471` | 10 s | returns history | Only on `return_created` |
| `pages/PhoneSales/index.tsx:133-143` | 8 s | staged sales + device | Poll ONLY while a device session is actually connected; else zero calls |
| `pages/Dispatch/index.tsx:476-485` | 45 s | reminders | Only on `dispatch_updated` (time triggers already come from Settings) |
| `pages/PharmarackCart/index.tsx:700-769` | 185 s | queue status | Convert to `wa_status_changed` SSE |
| `pages/Settings/index.tsx:803-815` | 5 s | `/api/whatsapp/status` | 30 s visible-only OR SSE `wa_status_changed` |
| `components/ConnectedDevicesFooterBar.tsx:50-59` | 120 s / 520 s | devices, QR | Share query key with Layout (dedupe); pause hidden |
| `components/WhatsAppQueuePopover.tsx:108-116` | 2 s | queue status | Reuse shared react-query key (dedupe with Layout's modal-open poll) |
| `pages/CRM/index.tsx:2593-2673` | polls + SSE | statuses/messages | Drop remaining status/message polls → `wa_status_changed`; keep 2 s only while a modal is open |

### 5.2 Backend jobs — gating changes
| Job | Location | Today | Change |
|---|---|---|---|
| WA queue worker | `services/whatsappQueue.ts:50-52`, `whatsappQueueWorker.ts:418-435` | 30 s / 10 s loop | Active user: unchanged. Idle >30 min AND queue empty: tick once per 15 min |
| Messaging queue | `services/messagingQueue.ts:25-27` | 30 s | Same idle policy |
| Device monitor | `routes/notifications.ts:503` | 10 s setInterval | Registry gate `bg.deviceMonitor` (new key, default manual) + ×6 idle backoff |
| catalogWorker poll | `worker/catalogWorker.ts:1065-1141` | 10 s | Wire documented-but-unread key `bg.catalogWorkerLoop`; ×6 idle backoff |
| inventoryCache rebuild | `services/inventoryCache.ts:34-36` | 10 min | Wire documented-but-unread key `bg.inventoryCache` (already in registry) |
| orderFulfillment refill evaluator | `services/orderFulfillmentService.ts:26-28` | 1 h | Add idle gate (skip when idle; catch-up on wake) |
| autoMatch worker | `worker/autoMatchWorker.ts:18-20` | 15 min | Add idle gate |
| doctorReporting check | `services/doctorReportingService.ts:130-132` | hourly | Registry gate + idle skip |
| medicineSalesMetrics reconcile | `services/medicineSalesMetricsService.ts:206-215` | nightly 03:00 | Leave (nightly, cheap) |
| Email IMAP pull | `services/emailService.ts:1154-1227` | user-set (default 5 min) | UNCHANGED — necessary. Emits `email_new` when mail arrives |
| Pharmarack token refresh | `services/tokenRefreshScheduler.ts:244-497` | 20 min ± jitter | REMOVE idle hard-skip (:334-341) → runs also when idle (keeps session alive overnight). Keep mode gate `bg.pharmarackTokenRefresh` |
| Catalog sync cron / daily scans / nightly backup | `server.ts:659-687`, `triggerSchedulerService.ts` | off/manual-idle | UNCHANGED (already correct) |

### 5.3 Credential/session facts
| Item | Detail |
|---|---|
| WhatsApp store | `%LOCALAPPDATA%\AI Pharmacy OS\.wwebjs_auth` — `whatsappClient.ts:23`, LocalAuth `:360` |
| WA wipe paths today | `forceReconnect()` `whatsappClient.ts:777-785` ← called by `POST /api/messaging/reconnect` (`messaging.ts:325-336`) ⚠️ rename semantics; Factory reset `utilities.ts:833-853` (keep) |
| Pharmarack profile | `<appData>/data/pharmarack_profile`; temp copies `pharmarack_profile_temp_*` always copied back before delete (`tokenRefreshScheduler.ts:478-495`, `pharmarack.ts:740-755`) — main dir never touched on failure ✔ |
| Pharmarack token blanks (fix) | login-page redirect `tokenRefreshScheduler.ts:443-447`; failed silent refresh `pharmarack.ts:137-143` |
| Token readers | `fetchPharmarack()` `pharmarack.ts:103-148`; keys `pharmarack_session_token/_username/_password/_mode` |
| Gmail OAuth | proactive refresh `emailService.ts:1097-1137`; protected keys ✔ leave as-is |
| Telegram | keys protected against empty overwrite ✔ leave as-is |
| Backups gap | No backup references `.wwebjs_auth` / `pharmarack_profile` — must add |

---

## 6. IMPLEMENTATION PHASES

### Phase 1 — Credential stability (small, isolated)
1. `messaging.ts:325` `/reconnect`: destroy client → clean locks → `initClient()`. Remove `rmSync(.wwebjs_auth)` from this path. Deletion remains ONLY on explicit `/logout` + Factory Reset.
2. `whatsappClient.ts`: add real `logout` event handler → set UI state "Re-login required" (genuine remote logout detection).
3. `tokenRefreshScheduler.ts`: stop writing `''` on login-redirect; set `pharmarack_session_status='stale'` instead. Same in `pharmarack.ts:137-143` failed silent-refresh path. Retry next cycle with live cookies.
4. Remove idle hard-skip in `executeRefresh` (`tokenRefreshScheduler.ts:334-341`) so refresh keeps the session alive overnight.
5. Backup manifest: include `.wwebjs_auth` (exclude `.wwebjs_cache`) + `data/pharmarack_profile` (exclude Cache/Code Cache/GPUCache) in scheduled backups + restore path.

### Phase 2 — Backend push events
Emit via `eventService.broadcast(type, payload)` (one line each) at write points:
`sale_created` · `invoice_saved` · `return_created` · `order_updated` · `refill_updated` · `expiry_list_changed` · `inventory_changed` · `email_new` · `wa_status_changed` · `dispatch_updated` · `catalog_job_done`.
Files: `routes/sales.ts`, `routes/orders.ts`, `routes/refills*`, `routes/returns.ts`, purchases/invoice save handler, inventory edit handlers, `emailService.ts` (after new-mail sync), `whatsappClient.ts` (status transitions), dispatch handlers.

### Phase 3 — Frontend global listener replaces timers
6. One `EventSource` subscriber (Layout scope): map each event type → `queryClient.invalidateQueries([key])`.
7. Delete/convert all timers listed in §5.1 exactly as specified.
8. Dashboard/Reports: refresh only on `sale_created`/`invoice_saved`/`return_created` + manual 🔄 button; skip refetch if cache <5 min old.
9. PhoneSales: device-connected check gates its poll; zero calls otherwise.

### Phase 4 — Worker gating & registry cleanup
10. Apply §5.2 idle policies (15-min queue ticks, ×6 monitor backoffs).
11. Wire unread registry keys `bg.inventoryCache`, `bg.catalogWorkerLoop`; add `bg.deviceMonitor`.
12. Remove stale registry entries: `crm.waStatusPoll`, `learning.qrPoll`, `layout.enrichmentPoll`; add `layout.*` keys default `off`.

### Phase 5 — Verify, document, lock the standard
13. Run verification checklist (Section 8).
14. Update root `AGENTS.md`: replace/augment "Data Fetch Control & Idle Gating Contract" with the **API Efficiency Standard** (Section 7 below).
15. Regenerate docs: `node scripts/quick-update.mjs`.

---

## 7. PERMANENT RULE FOR ALL FUTURE FEATURES (to be copied into AGENTS.md)

> **API Efficiency Standard — binding for every agent adding any feature/page/worker:**
>
> 1. **No `setInterval` / `refetchInterval` by default.** Data refreshes ONLY via:
>    (a) SSE event emitted at its backend write point,
>    (b) explicit user action (button/save),
>    (c) a deliberately registered time trigger (cron / Settings-saved schedule).
> 2. Register EVERY call site in `DATA_FETCH_REGISTRY` (`frontend/src/services/dataFetchControl.ts`) with `defaultMode: 'manual'` or `'off'`. Backend jobs must call `getBackendFetchMode(key, ...)` and skip under `off` / manual+idle.
> 3. Mount = paint from module-level cache first; silent network refresh afterwards. Never block render on fetch.
> 4. Every background loop must respect `activityTracker.isIdle()` backoff and pause when tab/page hidden (`usePageActive()` / `document.visibilityState`).
> 5. Never delete session/credential stores (`.wwebjs_auth`, `data/pharmarack_profile`, oauth tokens). Transient auth failures set status `stale`; never blank tokens.
> 6. Reviewer checklist for any PR: grep new code for `setInterval|refetchInterval|poll` → each hit needs a registry key + written justification.

This makes the optimization self-enforcing: future features cannot reintroduce idle-call waste.

---

## 8. VERIFICATION CHECKLIST

- [ ] DevTools Network tab, app open + untouched 10 min: **≈0 UI-originated calls** (only email-pull/token-refresh backend side effects absent from browser).
- [ ] Make a sale → Dashboard/Reports/Inventory badge update within ~1 s without manual refresh.
- [ ] Create/edit/complete Special Order → list + badge update instantly; zero periodic `/api/orders` traffic in Network tab.
- [ ] New test email arrives → owner gets WA notification per template; Mail page updates without polling.
- [ ] Kill server-side WA connection (simulate disconnect) → client restores session automatically; QR appears only after explicit Logout click.
- [ ] `/api/messaging/reconnect` called twice → session still valid afterwards (no wipe).
- [ ] PC left idle overnight → morning: Pharmarack search/cart works with no OTP re-login; `session_refresh_logs` shows overnight refresh rows.
- [ ] Scheduled backup archive contains `.wwebjs_auth` + `pharmarack_profile` entries; test-restore on temp dir succeeds.
- [ ] All pages still switch instantly (cache-first) — spot-check POS→Inventory→CRM→Reports.
- [ ] `node scripts/quick-update.mjs` run after final change.

## 9. ROLLBACK SAFETY

- Every frontend timer removal is independent — restore any single timer without affecting others.
- Worker gating is config-driven (`data_fetch_control` in `app_settings`) — modes can be flipped back to previous behavior from Settings UI without code changes.
- Token-refresh behavior change is behind existing keys `bg.pharmarackTokenRefresh` + `trigger_pharmarack_refresh_enabled`.
- Git: implement phase-by-phase with one commit per phase for surgical revert.

---
*End of plan. Implementation must follow phases 1→5 in order.*
