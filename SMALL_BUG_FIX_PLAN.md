# Small Bug Fix Plan — Bug Register

> Project bug register per `AGENT_BUG_FIX_RULEBOOK.md` Section 8. New defects go here
> as `Open`; fixed entries move to `Fixed` with root cause and verification.

---

## Fixed

### [Fixed] P1-03 — Boot-window distributor WhatsApp alerts failing permanently ("WhatsApp session is not connected")

| Field | Content |
|-------|---------|
| **What the user saw** | "❌ WhatsApp message to A.S DISTRIBUTOR failed: WhatsApp session is not connected. Please scan the QR code…" toasts on/shortly after app boot, repeating on every new UI session even days later. |
| **Root cause** | Two gaps beyond P1-02: (1) `emailService` mail-arrival and distributor-invoice alerts call personal-WA `sendMessage()` DIRECTLY (bypassing `whatsapp_send_queue`). The email poller starts at boot, so new distributor invoices fire while the WA session is still restoring → instant throw → permanent `automation_notifications` status='failed' row with that error message. (2) Layout's queue-status poller toasts ANY of the last-200 recent items mapped `failed_perm`, with only a per-browser-session dedupe — persisted historical rows re-toast on every reload. |
| **How it was fixed** | New exported `waitForWhatsAppReady(timeoutMs=90s)` in `src/whatsappClient.ts`: bounded readiness wait that joins/kicks the single-flight init when a saved session exists, returns false fast for disabled/QR-less/business-routed setups, re-kicks at most every 20 s. Wired before both direct sends in `src/services/emailService.ts`. Layout.tsx failure toast now has a 15-minute freshness guard (`created_at`) so stale rows never re-toast. |
| **Priority** | P1 |
| **What not to touch** | User-clicked send paths (orders/refills/messaging routes) intentionally keep immediate lazy-init + fast-clear-error semantics; do not add waits there. Existing 'failed' rows remain in DB until user clears/retries via Queue UI. |
| **Verified by** | `tsc --noEmit` clean (backend + frontend); boot with saved session + pending invoice email → alert dispatches after restore instead of failing; no historical-failure toast spam on reload. |

### [Fixed] P1-01 — False "Pharmarack cart sync pending" toast on first boot

| Field | Content |
|-------|---------|
| **What the user saw** | On every app boot, Activity panel shows "⚠️ Pharmarack cart sync pending — Session may need refresh from Learning page." even when the Pharmarack session was healthy. |
| **Root cause** | `startupSyncCoordinator.markCartLoaded()` was only called at the end of a successful `GET /api/pharmarack/cart` request. Nothing fetched the live cart at boot — the T+2s token refresh scheduler refreshes only the auth token. Frontend checked `/api/pharmarack/startup-sync-status` once after 46 s; with no UI visit yet, `timedOut && !cartLoaded` always fired the toast. |
| **How it was fixed** | Extracted shared loader `loadLiveCartCore()` in `src/routes/pharmarack.ts` (used by GET /cart AND new exported `warmupStartupCart()`). server.ts chains the warm-up on `tokenRefreshScheduler.onFirstRefreshComplete()` (new hook) with a T+50s fallback; warm-up populates `serverCartCache`, marks loaded on success, marks loaded immediately when no token is configured (non-users never nagged), and deliberately leaves sync pending on real session/network failures so the toast stays truthful. Layout.tsx re-checks at 110 s (toast fires at most once). |
| **Priority** | P2 |
| **What not to touch** | GET /cart snapshot auto-notification transitions (`notifyDistributorCartOrder`) remain UI-visit-only semantics; do not run them from the boot warm-up. |
| **Verified by** | `tsc --noEmit` clean (backend + frontend); boot log shows `[StartupSync] Boot cart warm-up complete` or a truthful skip; no false toast within 46–110 s window on healthy-token boots. |

### [Fixed] P1-02 — First-boot WhatsApp send failures ("WhatsApp session is not connected")

| Field | Content |
|-------|---------|
| **What the user saw** | Distributor WhatsApp notifications failed shortly after boot: "WhatsApp session is not connected. Please scan the QR code in Settings or click 'Open Live Chrome Window' to log in." Some queue items burned retries to permanent failure while other sends hung forever until restart. |
| **Root cause** | Two compounding gaps: (1) In `launchClientInstance()` (src/whatsappClient.ts), the three QR exit paths — unsolicited-QR suppression, 120 s QR-scan timeout, 5-QR max-refresh stop — returned without settling the promise, leaving `initPromise` pending forever so every later caller joined a dead flight (deadlock). (2) The queue worker's per-item check skipped dispatching only when `!initializing`, so items were marked `sending` during an in-flight restore and each attempt incremented `retry_count` toward `failed_perm` within ~3 minutes of boot. |
| **How it was fixed** | whatsappClient.ts: all three QR exits now call `reject(...)` with clear user-facing messages (initClient catch/finally already resets flags and clears `initPromise`). whatsappQueueWorker.ts: offline gate breaks whenever `!isReady` regardless of `initializing` (items stay pending through boot restore), plus a self-heal that silently retries `initClient()` on a 60 s cooldown when `hasSavedSession()` is true — no unsolicited QR, no retry burn. |
| **Priority** | P1 |
| **What not to touch** | `auth_failure` handler already rejected correctly — unchanged. Manual `retryAllFailed()` remains the revival path for already-burned `failed_perm` items. |
| **Verified by** | `tsc --noEmit` clean; simulated QR-timeout now fails sends fast with actionable error instead of hanging; queued items created pre-restore stay `pending` and dispatch once the client reports ready. |

---

## Open

(none)
