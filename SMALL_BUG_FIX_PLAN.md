# Small Bug Fix Plan — Bug Register

> Project bug register per `AGENT_BUG_FIX_RULEBOOK.md` Section 8. New defects go here
> as `Open`; fixed entries move to `Fixed` with root cause and verification.

---

## Fixed

### [Fixed] P1-06 — Mobile app saves random/unwanted phantom bills on the PC after reconnect ("login")

| Field | Content |
|-------|---------|
| **What the user saw** | After opening/reconnecting the mobile app, unwanted "random" bills materialized on the PC (Sells history / staged Phone Sales) that nobody completed at the counter. |
| **Root cause** | Three compounding defects: (1) `createSale` in pharmacy-mobile/lib/api/sales.ts caught EVERY failure — including hard PC rejections like `API 400: Insufficient stock` — and queued the refused sale into `offline_sales_queue` anyway, deducting local stock, firing a WhatsApp fallback task, and returning a fabricated `TEMP-MOB-*` success invoice to the UI. On next reconnect the sync engine faithfully replayed those rejected bills onto the PC. (2) `POST /sales/sync` had zero idempotency: if the response was lost after the PC committed, the phone kept the queue and re-sent it → duplicate invoices. (3) The billing drawer's PENDING SYNC list offered no way to discard poisoned entries already stuck on the phone. |
| **How it was fixed** | Mobile `client.ts` now attaches `httpStatus` to thrown API errors; `createSale` re-throws all 4xx rejections immediately (real reason shown in Alert, nothing queued/fabricated) and keeps the offline path ONLY for network failures / 5xx ambiguity. Queued sales are stamped with a `client_ref` idempotency key; backend `/sales/sync` creates `sync_client_refs` table and skips already-seen refs inside the same transaction (replay-safe, rollback-safe). Billing drawer gained per-bill trash Discard + DISCARD ALL (with destructive confirm) so existing junk can be purged without syncing. |
| **Priority** | P1 |
| **What not to touch** | The offline-first queue design itself (NetInfo reconnect drain + 15s safety poll), admin direct-commit vs staged approval split in `/sales/sync`, WhatsApp fallback tasks for GENUINE offline sales, cart persistence contract. |
| **Verified by** | Backend `npx tsc --noEmit` clean; mobile `npx tsc --noEmit` clean; code-path review: 4xx now throws before any queue/local-stock/WA side effects; dedupe runs inside BEGIN/COMMIT so rolled-back batches leave no ref behind. |

### [Fixed] P1-05 — Printed/saved bill PDF is completely blank; saved filename always generic "AI PHARMACY OS"

| Field | Content |
|-------|---------|
| **What the user saw** | Clicking Print Bill (POS post-sale modal or Sells history view modal) and saving as PDF produced an empty `AI PHARMACY OS.pdf` with no invoice content, and the suggested filename never contained the patient name or invoice number. |
| **Root cause** | The `@media print` rules in frontend/src/index.css used the fragile visibility hack (`body * { visibility: hidden }` + absolute-positioned un-hide). The POS `#printable-bill` div lived INSIDE the modal card under a `fixed … backdrop-blur-md fade-in` overlay — backdrop-filter/transform ancestors change the abs-positioning containing block and overflow-hidden ancestors clip it, so nothing rendered on the printed page; printing while no printable div was mounted guaranteed a blank sheet too. Filename came from static `document.title` ("AI PHARMACY OS", frontend/index.html) which nothing updated before `window.print()`. |
| **How it was fixed** | New helper frontend/src/utils/printBill.ts (`printCurrentBill(fileNameBase)`): sanitizes and sets `document.title` (Chrome uses it as Save-as-PDF default), adds `printing-bill` class to `<body>`, prints, restores everything on `afterprint`. CSS rewritten to deterministic display-based hiding gated on that class: `body.printing-bill > *:not([data-print-root]) { display:none }` + `[data-print-root] { display:block; position:static }`. Both printable bills moved out of modal/page trees into their own `createPortal(…, document.body)` with `data-print-root` (POS/index.tsx, Sells/index.tsx). Print buttons now pass `Invoice-{no}-{patient}` (falls back to `Walk-in`). Side benefit: Compliance "Print Register" no longer prints blank (old CSS hid everything for it too); also fixed invalid `borderBottom: '1px border-dotted #ccc'` inline style on the POS bill row separator while relocating that block. |
| **Priority** | P1 |
| **What not to touch** | KeepAliveOutlet, SSE freshness mappings, barcode generation endpoints (server-side PDFs unaffected), Compliance page code, the pre-existing lint debt lines in POS/Sells (documented exempt in frontend/AGENTS.md). |
| **Verified by** | `tsc -b` clean after all edits; eslint on new util zero violations (POS/Sells pre-existing HEAD debt unchanged in kind — only relocated `(item: any)` line); portal structure confirmed via read-back (direct `<body>` children, correct JSX nesting). |

### [Fixed] P2-02 — POS cart scan thumbnails blank in list view; load only after minutes or on click/hover

| Field | Content |
|-------|---------|
| **What the user saw** | On the deployed website, AI-Camera scan thumbnails next to cart medicines rendered empty and only appeared minutes later (or instantly when opened/quick-viewed via the zoom modal). |
| **Root cause** | Two compounding issues: (1) `loading="lazy"` on the POS cart thumbnail `<img>`s (frontend/src/pages/POS/index.tsx) — the ONLY lazy images in the app. KeepAliveOutlet keeps every visited page mounted but hidden with `display:none`; Chromium never fetches lazy images inside hidden subtrees, so they loaded only on a later scroll/layout pass (minutes later). Base64 data URLs gain nothing from lazy loading anyway (no network request to defer). The zoom modal showed instantly because it had no `loading="lazy"`. (2) Deployed-site aggravators: legacy `frontend/public/sw.js` still shipped into `dist/` with a cache-first rule over every same-origin GET including `/uploads/*` images, while `main.tsx` unregistered workers WITHOUT clearing Cache Storage (`ai-pharmacy-v1`) — stale/poisoned entries served blanks then background-revalidated. Also `express.static(frontendDist, { maxAge: '1d' })` cached `index.html` for up to a day, so post-deploy clients could run a stale shell referencing pruned hashed chunks. |
| **How it was fixed** | Removed `loading="lazy"` from both cart thumbnail `<img>`s (kept `decoding="async"`). Deleted `frontend/public/sw.js` so it stops deploying; extended the main.tsx unregister block to also purge all Cache Storage entries (heals already-deployed clients). server.ts static mount + SPA fallback now send `Cache-Control: no-cache` for `.html` while hashed assets keep `immutable` 1-year caching. |
| **Priority** | P2 |
| **What not to touch** | KeepAliveOutlet display:none mechanism itself (binding SPA contract), zoom modal, hover-preview markup, `/uploads` static serving, AICamera capture pipeline (base64 size hardening deliberately deferred as YAGNI until quota errors are observed). |
| **Verified by** | Frontend build clean (`tsc -b && vite build`, 4.97 s); zero `loading="lazy"` remaining in frontend/src; rebuilt `dist/` contains NO `sw.js`; backend `tsc --noEmit` clean; eslint on touched files clean except pre-existing HEAD debt (POS 3893/3895 verified identical at HEAD); isolated Express harness replicating the exact static+fallback code paths against real `frontend/dist`: `/sw.js`→404, `/`→200 no-cache, `/pos`→200 no-cache, `/missing.png`→404 Asset not found, `/assets/*` chunk→immutable 1y. |

### [Fixed] P2-01 — Bulk expiry-return approval always fails with ReferenceError (`distributorId` undefined)

| Field | Content |
|-------|---------|
| **What the user saw** | `POST /api/returns/expiry-reviews/bulk-approve` returned 500 and rolled back whenever any selected review passed the stock check — bulk "Approve All" from the Expiry Return Review page could never complete. |
| **Root cause** | `bulk-approve` handler (src/routes/returns.ts) referenced an undeclared variable `distributorId` in its `INSERT INTO returns ... VALUES (?, 'purchase', ?, ?, ..., ?)` parameter list. TypeScript would flag it as `Cannot find name`, but the route file reached runtime via tsx without full type enforcement; at runtime it threw `ReferenceError: distributorId is not defined` inside the transaction, triggering ROLLBACK + generic 500. |
| **How it was fixed** | The loop now resolves the distributor explicitly via the same lazy lookup as single approve (latest purchase line for medicine_id+batch_no → distributor), uses that value for the return record, credit-note tracking (`trackExpiryReturn`) and persists it onto the review row. |
| **Priority** | P2 |
| **What not to touch** | Single-review `/expiry-reviews/:id/approve` flow unchanged beyond sharing the identical lazy-resolution query; scan deliberately stays join-free — distributor resolution belongs at approval time only. |
| **Verified by** | `tests/returnLossIntegrity.test.ts` test 6 (bulk-approve custom percentage → 200 + exact credit note) and `tests/expiryReturnReview.test.ts` test 5 both pass; backend `tsc --noEmit` clean. |

### [Fixed] P1-04 — Duplicate WhatsApp messages delivered (same queue item sent twice within seconds)

| Field | Content |
|-------|---------|
| **What the user saw** | Customers received identical WhatsApp messages twice within seconds: special-order arrival WA to shilpa chickne delivered 2× at 10:18:42 (two distinct real WhatsApp IDs, one queue item #185), and refill-collection WA to CHANDRAANT SUTAR delivered 2× at ~15:55 (confirmed visually on WhatsApp Web; outbox table only recorded one). Audit also found same-second double-sends for 3 email-arrival alerts and 1 distributor-invoice alert. |
| **Root cause** | Two races of the same class — guard state registered only AFTER an awaited operation completed: (1) `processQueueInternal()` (src/services/whatsappQueueWorker.ts) checked `isProcessing`, then `await isWhatsAppExplicitlyDisabled()` (DB read), THEN set `isProcessing=true`. Two concurrent entry points (`forceNext()` fired fire-and-forget by two rapid `enqueueArrivalWhatsApp` calls when both orders were marked Ready in one request, plus the 10 s scheduler tick) both passed the stale check during that await gap and ran parallel send loops over the same pending items → same item physically transmitted twice before either pass marked it 'sent'. (2) `sendMessage()` (src/whatsappClient.ts) registered `recentSendsCache` only after the awaited dispatch succeeded, so near-simultaneous duplicate calls both passed the 30 s suppression check. |
| **How it was fixed** | (1) The single-flight lock is now claimed synchronously immediately after the check, BEFORE any await; the disabled-check moved inside the existing try/finally so every early return still resets the lock. Parallel processor passes are now impossible. (2) `recentSendsCache.set(sendKey, nowTs)` now happens in-flight BEFORE dispatching; the pre-existing catch already deletes the key on failure so legitimate retries remain unblocked; post-send re-set on the WA-Web path kept as harmless refresh. |
| **Priority** | P1 |
| **What not to touch** | Queue-level same-day dedupe + `skipDedupe` resend semantics unchanged; outbox verification / crash-recovery paths untouched; direct-sender call sites (emailService etc.) untouched — they are protected by fix (2). Outbox-capture gaps (delivered-but-unrecorded twins) are a separate recording issue, intentionally not addressed here. |
| **Verified by** | `tsc --noEmit` clean (backend); DB evidence matched root cause exactly (queue had ONE SOFIRASH item yet TWO delivered IDs same second; lock await-gap present at the time); code review confirms no remaining await between lock check and set and cache registration precedes all dispatch paths (WA-Web line ~1057 refresh, Business line ~1134, catch-delete ~1138 preserved). |

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
