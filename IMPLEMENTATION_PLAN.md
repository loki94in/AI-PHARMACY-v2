# Implementation Plan — API Call Optimization & Data Fetch Control

**Project:** AI Pharmacy v2
**Date:** 2026-07-12
**Status:** Approved for build
**Goal:** The app must never make unnecessary API calls when a page opens. The user opens POS and sells instantly; Pharmarack never auto-calls; requested data is always one visible "Load" click away; the idle app uses far less memory/CPU.

---

## 0. Goals & Guardrails

### Goals
1. **Zero unnecessary calls on page open.** Every mount-time / poll-time call is either kept (essential), deferred to Manual, or turned Off by default.
2. **Instant POS.** POS opens on the already-seeded compact inventory cache and lets the user start a sale with 0 network calls.
3. **Pharmarack skipped by default.** No auto-fetch of Pharmarack data on mount anywhere; only on explicit user action.
4. **Visible request control.** Manual-mode calls always show a visible "Load" affordance so the data is requestable on demand.
5. **Light idle footprint.** Backend background jobs run only when the app is idle or at off-peak hours.
6. **Silent Updates on Mutations.** Every purchase, sell, and return order (customer/distributor return) must trigger a silent background refresh of all client and backend caches (including the compact inventory cache, special orders, and combinations) to keep data fresh without blocking page transitions.

### Guardrails (DO NOT COMPROMISE)
- **Pharmarack route/service/login files stay untouched**: `src/routes/pharmarack.ts`, the Pharmarack methods in `frontend/src/services/api.ts`, and the Pharmarack *session/login* logic.
- **Only `src/services/tokenRefreshScheduler.ts` may be edited**, and only to make the refresh **expiry-driven** (refresh when the token nears expiry, not every 20 min). Session persistence must remain intact.
- All other behavior changes happen at the **page/call-site** level and via the **Data Fetch Control** settings layer.
- Do **not** introduce simulated/mock features (per DOX "No Simulated/Mock Features" rule).

### Deferred Scope
- **Pharmarack front-end auto-fetch gating** (`pharmarack.*` registry keys) is deferred per request — no edits to Pharmarack-related page code. These keys remain in the registry and the Settings panel so the user can set them to Off/Manual; the **expiry-driven token refresh (Phase 6)** is the only in-scope Pharmarack change.

### Problems We Are Solving
- The app fires many API calls automatically on page open and via continuous polling, making it feel sluggish and consuming memory/CPU even when idle.
- POS forces the user to wait on several mount-time fetches (special orders, doctors, recommend-quantity batch) before they can sell.
- Pharmarack data is fetched live on mount and a headless Chrome refresh runs every 20 minutes regardless of need.
- Mail pulls IMAP every 2 minutes; a global 5s enrichment poll runs on every page; CRM polls WhatsApp every 5s and hits a dead `/api/events` endpoint in a reconnect loop.
- Backend background jobs (messaging queues, IMAP, inventory cache, catalog worker) run continuously, keeping the idle app heavy.
- The "click → freeze + extra layer" overlay bug (z-index collisions, native alert/confirm) blocks the UI.

### Expected Outcomes After Implementation
- Opening any page makes ~0 unnecessary calls; the user starts selling on POS immediately using the cached inventory.
- Every deferrable call is user-controlled (Auto/Manual/Off) from one Settings panel; Manual calls stay visible via a "Load" button.
- Pharmarack token refresh only runs near expiry (no 20-min blind Chrome launches); session persistence stays intact.
- Continuous polls (enrichment 5s, CRM 5s, Mail 2-min IMAP, dead SSE) are stopped → far less background network and memory.
- Backend jobs idle-gate, so the idle app uses minimal CPU/memory.
- The overlay/stall bug is fixed (z-index unification, Universal Edit, QuickOrder overlay, native alert/confirm replaced).
- Fully reversible: any key flipped back to Auto restores today's behavior.

---

## 1. Architecture Overview

A single **Data Fetch Control** layer decides, per identifiable call, whether to:
- `auto` — fire automatically (current behavior)
- `manual` — do NOT auto-fire; render a visible "Load" button; fire only on click
- `off` — never fire unless explicitly triggered once

```
frontend/src/services/dataFetchControl.ts   <- registry (source of truth)
frontend/src/hooks/useFetchMode.ts           <- reads mode for a key
frontend/src/pages/Settings/index.tsx        <- "Data Fetch Control" UI panel
src/routes/settings.ts                        <- persists data_fetch_control in app_settings
src/services/activityTracker.ts               <- backend idle detection (new)
src/services/tokenRefreshScheduler.ts         <- expiry-driven refresh (edit)
src/server.ts                                 <- idle-gate existing crons
```

Persistence: a new `app_settings` row `data_fetch_control` holding a JSON blob `{ [key]: 'auto'|'manual'|'off' }`, seeded from registry defaults on first read. Saved via the existing `POST /settings/save`.

---

## 2. Phase 1 — Registry + Persistence + Hook

### 2.1 Registry — `frontend/src/services/dataFetchControl.ts` (NEW)
Defines every controllable call. Fields: `key`, `label`, `page`, `callSite` (file:line for reference), `defaultMode`, `external` (bool).

Frontend entries (defaults chosen to minimize background calls):

| key | label | callSite | defaultMode | external |
|---|---|---|---|---|
| `pos.specialOrders` | POS special orders | `POS/index.tsx:325` | manual | no |
| `pos.combinations` | POS combos + recommend-qty batch | `POS/index.tsx:330` | manual | no |
| `pos.doctors` | POS doctors list | `POS/index.tsx:604` | manual | no |
| `inv.list` | Inventory paged list | `Inventory/index.tsx:202` | auto | no |
| `inv.specialOrders` | Inventory special orders | `Inventory/index.tsx:164` | manual | no |
| `purch.distributors` | Purchases distributors | `Purchases/index.tsx:232` | auto | no |
| `purch.history` | Purchases history | `Purchases/index.tsx:237` | auto | no |
| `purch.pendingReturns` | Purchases pending returns | `Purchases/index.tsx:244` | auto | no |
| `crm.patients` | CRM patients | `CRM/index.tsx:166` | auto | no |
| `crm.waStatusPoll` | CRM WA status 5s poll | `CRM/index.tsx:440` | manual | no |
| `crm.waSse` | CRM SSE stream | `CRM/index.tsx:461` | off | no |
| `dash.stats` | Dashboard stats | `Dashboard/index.tsx:11` | auto | no |
| `pharmarack.cart` | Live Pharmarack cart | `PharmarackCart/index.tsx:392` | manual | yes |
| `pharmarack.pendingOrders` | Pharmarack pending orders | `PharmarackCart/index.tsx` | manual | yes |
| `pharmarack.refills` | Pharmarack refills | `PharmarackCart/index.tsx` | manual | yes |
| `pharmarack.priceHistory` | Pharmarack price history | `PharmarackCart/index.tsx` | manual | yes |
| `layout.enrichmentPoll` | Global enrichment 5s poll | `Layout.tsx:702` | off | no |
| `layout.hoverPrefetch` | Nav hover prefetch | `Layout.tsx:238` | off | no |
| `mail.inboxRefresh` | Mail inbox refresh | `Mail/index.tsx:286` | auto (visible only) | no |
| `mail.imapSync` | Mail IMAP 2-min sync | `Mail/index.tsx:289` | off | yes |
| `composition.statusPoll` | Enrichment status 3s poll | `CompositionQueue/index.tsx:237` | auto (when running) | no |
| `learning.qrPoll` | Learning QR 5s poll | `Learning/index.tsx:299` | auto (tab open) | no |
| `settings.backupList` | Settings backup list | `Settings/index.tsx:564` | manual | no |
| `settings.backupSchedule` | Settings backup schedule | `Settings/index.tsx:571` | manual | no |

Backend entries (consumed by `activityTracker` / scheduler):

| key | label | callSite | defaultMode |
|---|---|---|---|
| `bg.pharmarackTokenRefresh` | Pharmarack token refresh | `tokenRefreshScheduler.ts:108` | auto (expiry-driven) |
| `bg.nightlyBackup` | Nightly backup | `server.ts:455` | off-peak |
| `bg.dailyScans` | Daily low-stock/expiry scans | `server.ts:411,443` | off-peak |
| `bg.catalogSync` | 3AM catalog sync | `server.ts:468` | idle |
| `bg.emailImapPoll` | Email IMAP 5-min poll | `emailService.ts:1115` | idle |
| `bg.messagingQueues` | Messaging 30s queues | `messagingQueue.ts`/`whatsappQueue.ts` | idle-batch |
| `bg.inventoryCache` | 10-min inventory cache | `inventoryCache.ts:32` | keep (cheap, local) |
| `bg.catalogWorkerLoop` | Catalog worker loop | `catalogWorker.ts:1032` | throttle |

Export:
- `DATA_FETCH_REGISTRY: FetchControlEntry[]`
- `DEFAULT_FETCH_MODES: Record<string, Mode>`
- `getRegistryByPage(): Record<string, FetchControlEntry[]>`
- `isExternal(key): boolean`

### 2.2 Persistence — `src/routes/settings.ts`
- On `GET /settings` (or a new `GET /settings/data-fetch-control`), merge stored `data_fetch_control` JSON over `DEFAULT_FETCH_MODES`, returning the effective map.
- On `POST /settings/save`, accept a `dataFetchControl` field and upsert the `data_fetch_control` key (existing `INSERT OR REPLACE INTO app_settings` pattern at `settings.ts:79`).

### 2.3 Hook — `frontend/src/hooks/useFetchMode.ts` (NEW)
```ts
type Mode = 'auto' | 'manual' | 'off';
// Reads effective modes from a tiny cached settings fetch + localStorage fallback.
// Returns: { mode, shouldFetch (auto), requestLoad(), loaded }
```
- On first call, fetch `/settings` once (cached) to get modes; also mirror to `localStorage` so pages read synchronously without a pre-fetch call.
- `shouldFetch` = `mode === 'auto'`.
- `requestLoad()` flips an internal flag so a Manual query enables and fetches once.

### 2.4 Unified Cache Invalidation — `frontend/src/utils/cacheInvalidation.ts` (MODIFY)
- Enhance `invalidateAfterStockWrite(queryClient)` to:
  1. Call `api.getCompactInventory()` silently in the background (using dynamic import to prevent circular dependencies) so that the compact inventory cache is updated.
  2. Force a silent background refetch of any active queries (such as `pos-special-orders`, `pos-common-combinations`) so that the frontend always displays fresh data after mutations (purchases, sells, returns).
- Ensure this is called on every completed purchase, sell, and return order (customer return and distributor return).

---

## 3. Phase 2 — Settings UI Panel

Add a **"Data Fetch Control"** section to `frontend/src/pages/Settings/index.tsx` (after the existing toggles):
- Grouped by page (POS, Inventory, Purchases, CRM, Dashboard, Pharmarack, Mail, AI/Enrichment, Backend).
- Each row: label + 3-way segmented control **Auto / Manual / Off** (reuse existing toggle styling; use semantic classes `bg-bg2 border-border text-text`).
- Backend rows show a note: "runs when app is idle / off-peak."
- On change, update local `settings.dataFetchControl` and persist via `POST /settings/save`; also write to `localStorage` immediately so the hook reads it without reload.
- Add `dataFetchControl: string` to the `SettingsData` interface (`Settings/index.tsx:37`) and initial state.

---

## 4. Phase 3 — POS Lazy Loading (instant sell)

Edit `frontend/src/pages/POS/index.tsx`:
- The page already hydrates from the module-level compact inventory cache. **Keep that; remove the mount-time network dependency for selling.**
- `pos-special-orders` (`getOrders`, `:325`): wrap with `useFetchMode('pos.specialOrders')`; when `manual`, render a small visible "Load special orders" button instead of `enabled:true`. Set query `enabled: mode === 'auto'`.
- `pos-common-combinations` (`getInventory(12)` + `/sales/recommend-quantity/batch`, `:330`): gate both behind `useFetchMode('pos.combinations')`; show "Load suggestions" button. Do NOT fetch on mount.
- `crm-doctors` (`getDoctors`, `:604`): gate behind `useFetchMode('pos.doctors')`; lazy-load on first doctor-field focus/use.
- Selling hot path (`searchMedicine` via cache + `createSale`) is untouched and instant.
- Vestigial `cachedDoctors`/`cachedCommonCombinations`/`cachedSpecialOrders` (`:93`) can stay as no-op caches; no network.

---

## 5. Phase 4 — Stop Auto Polls (CRM / Mail / AI Learning)

- **CRM** (`CRM/index.tsx`):
  - `crm.waStatusPoll` (`:440` 5s `setInterval`): gate behind `useFetchMode('crm.waStatusPoll')` → Manual: replace the auto interval with a visible "Refresh WA status" button; if mode is `auto`, still pause the interval when the tab is hidden (`document.hidden`).
  - `crm.waSse` (`:461` `EventSource('/api/events')`): this endpoint **does not exist** (constant 404 reconnect loop). Set default `off`; either repoint to the valid `/api/notifications/stream` (`notifications.ts:51`) or remove the EventSource entirely. Prefer removing unless real-time WA is required.
- **Mail** (`Mail/index.tsx`):
  - `mail.imapSync` (`:289` 2-min `triggerEmailSync`): default `off` (Manual "Sync now" button).
  - `mail.inboxRefresh` (`:286` 30s): only run while the Mail tab is visible & focused; pause on blur.
- **CompositionQueue** (`CompositionQueue/index.tsx`): `composition.statusPoll` (`:237` 3s, `:278` 2s) — only poll **while an enrichment job is active**; stop the interval when the queue is empty/idle (no idle 3s loop).
- **Learning** (`Learning/index.tsx`): `learning.qrPoll` (`:299` 5s) — only poll while the messaging/QR tab is open; `checkPrHealth` (`:425` 3-min) → Manual.
- **Layout** (`Layout.tsx`):
  - `layout.enrichmentPoll` (`:702` global 5s `/enrichment/status`): **remove** the global interval; enrichment status is only relevant on CompositionQueue. Default `off`.
  - `layout.hoverPrefetch` (`:238` nav hover prefetch that wrongly calls `getDoctors` at `:265`): disable or limit to explicit intent; default `off`.

---

## 6. Phase 5 — Backend Idle-Gating (non-Pharmarack)

### 7.1 `src/services/activityTracker.ts` (NEW)
- `recordActivity()`: updates an in-memory + persisted `lastUserActivityAt` timestamp on every authenticated frontend request (hook into an Express middleware in `server.ts`).
- `isAppIdle(thresholdMin = 5): boolean`: true if `Date.now() - lastUserActivityAt > thresholdMin*60000`.
- SPA pings `POST /api/activity/ping` (~30s while visible); middleware also updates on any `/api/*` GET from the SPA.

### 7.2 Gate existing crons in `src/server.ts`
- `bg.nightlyBackup` (`:455`), `bg.dailyScans` (`:411`,`:443`), `bg.catalogSync` (`:468`): keep schedules but, at execution time, if `!isAppIdle()` and mode is idle/off-peak, **defer to next cycle** so they never compete with the user. Catalog sync already runs at 3AM (off-peak) — just confirm it checks mode.
- `bg.emailImapPoll` (`emailService.ts:1115`): stop the 5-min IMAP poll globally; only run when the Mail page signals active syncing (or Manual). Reduces constant external IMAP traffic.
- `bg.messagingQueues` (`messagingQueue.ts`, `whatsappQueue.ts` 30s): batch and idle-gate — if `!isAppIdle()`, increase interval or skip a tick. Keep message delivery functional but lighter.
- `bg.inventoryCache` (`inventoryCache.ts:32` 10-min): cheap local rebuild — keep, but it may also respect idle.
- `bg.catalogWorkerLoop` (`catalogWorker.ts:1032`): replace the ~1ms continuous tick with a real throttle (e.g., `setInterval(..., 30000)` gated by `isWorking` lock) so it is not a permanent busy loop.

---

## 7. Phase 6 — Expiry-Driven Pharmarack Token Refresh (EDIT `tokenRefreshScheduler.ts` ONLY)

Edit `src/services/tokenRefreshScheduler.ts` (the one allowed Pharmarack file):
- **Remove** the fixed `setInterval(20*60*1000)` (`:114`).
- **Add** expiry awareness: store `tokenIssuedAt` (or read `pharmarack_session_token` issue time from `app_settings`). Compute remaining life; only call `executeRefresh()` (`:150`) when `remaining < EXPIRY_THRESHOLD` (e.g., 10 min) OR no token exists.
- Keep a **light** scheduler: e.g., check every 5 min whether refresh is due (cheap, no Chrome unless due). `cleanProfileLockFiles()` (`:69`) and session-copy-back logic stay intact → **session persistence unchanged**.
- Respect `bg.pharmarackTokenRefresh` mode: `off` → never; `auto` → expiry-driven (above).
- The `automationEnabled`/login flow stays untouched.

---

## 8. Phase 7 (Secondary) — Overlay / Stall Fixes

From the earlier diagnosis, these cause the "click → freeze + extra layer" bug. Address after API work:

1. **Unify z-index** (`tailwind.config.js:50-58`): demote `Inventory/index.tsx:602` drawer `z-[999999]` → `z-drawer`; `CRM/index.tsx:1401` lightbox and `Database/index.tsx:782,873` `z-[99999]` → `z-modal`/`z-global-modal`. Reserve `z-global-modal` (10000) as the single top layer.
2. **Inventory "Universal Edit" opens behind drawer**: in `Inventory/index.tsx:663` onClick, call `setPanelOpen(false)` before opening `UniversalMedicineEditModal` (or raise its z above the drawer).
3. **QuickOrderModal duplicate overlay** (`QuickOrderModal.tsx:1166` `absolute inset-0 z-[99999] bg-black/80`): scope to the modal content container, not the full-viewport `fixed` parent, so it does not dim/block the whole screen.
4. **Replace native `alert()`/`confirm()`** in `POS/index.tsx` (`:1702,1756,1762,3401,3405,3422,3426`) and ~10 other files with the existing non-blocking `toastEvent` / a styled confirm modal.
5. **Fix dead `EventSource('/api/events')`** (covered in Phase 4).

---

## 9. Verification

1. **Default = all defaults above** → POS opens instantly on cached inventory; Network tab shows 0 calls on POS open (selling works).
2. Pharmarack: token refresh is expiry-driven (Phase 6) — no Chrome launch every 20 min; front-end Pharmarack auto-fetch is deferred to Settings control (registry keys `pharmarack.*`, default Off/Manual).
3. `crm.waStatusPoll` = Manual: open CRM → no 5s poll; no `/api/events` 404 loop.
4. `mail.imapSync` = Off: Mail open 2+ min → no IMAP traffic.
5. `layout.enrichmentPoll` = Off: navigate all pages → no 5s `/enrichment/status`.
6. Token refresh: observe logs — no Chrome launch every 20 min; only near token expiry.
7. `bg.catalogWorkerLoop`: no permanent busy loop (CPU idle when app idle).
8. Flip any key back to `auto` in Settings → behavior returns to today's.

---

## 10. DOX Update

- Update **root `AGENTS.md`**: add a "Data Fetch Control" section documenting Auto/Manual/Off modes, the idle-gating rule, and the expiry-driven Pharmarack refresh; note the guardrail that Pharmarack route/service/login files are not edited.
- Update **`frontend/AGENTS.md`**: add the z-index unification rule (reserve `z-global-modal` as single top layer) and the "no native alert/confirm" rule.
- Run `node scripts/quick-update.mjs` after all changes to refresh `.understand-anything/knowledge-graph.json` and `PROJECT_AUDIT.md`.

---

## Build Order

1. Phase 1 (registry + persistence + hook)
2. Phase 3 (POS lazy) — biggest user win
3. Phase 2 (Settings UI)
4. Phase 4 (stop auto polls)
5. Phase 5 (backend idle-gating) + Phase 6 (scheduler expiry)
6. Phase 7 (overlay/stall fixes)
7. Phase 10 (DOX + quick-update)

---

## 11. API Call Comparison — Baseline (Current vs Planned)

This is the **before → after** baseline captured before implementation. It is the reference the post-implementation agent must mirror.

### Frontend — on page open / polling
| Call | CURRENT | AFTER (mode) |
|---|---|---|
| POS special orders | auto on mount | **Manual** (Load button) |
| POS combos + recommend-qty batch | auto double-fetch on mount | **Manual** |
| POS doctors | auto on mount | **Manual** (lazy on focus) |
| Inventory paged list | auto on mount | **Auto** (cached) |
| Inventory special orders | auto on mount | **Manual** |
| Purchases distributors/history/returns | auto on mount | **Auto** (kept) |
| CRM patients | auto on mount | **Auto** (kept) |
| CRM WA status poll | every 5s | **Manual** / pause when hidden |
| CRM `EventSource('/api/events')` | broken 404 loop | **Off / removed** |
| Dashboard stats | auto on mount | **Auto** (kept) |
| Pharmarack cart/orders/refills/price | live on mount (3 calls) | **Off/Manual** (Settings-controlled) |
| Layout enrichment poll | every 5s, all pages | **Off** (removed) |
| Layout hover prefetch | on nav hover | **Off** |
| Mail inbox refresh | every 30s | **Auto** (only when tab visible) |
| Mail IMAP sync | every 2 min (external) | **Off** (Manual "Sync now") |
| Composition status poll | every 3s idle loop | **Auto only while job active** |
| Learning QR poll | every 5s | **Auto** (only tab open) |
| Learning health check | every 3 min | **Manual** |
| Settings backup list/schedule | auto on mount | **Manual** |

### Backend — scheduled / continuous
| Job | CURRENT | AFTER |
|---|---|---|
| Pharmarack token refresh | every 20 min (headless Chrome) | **expiry-driven** (only near expiry) |
| Nightly backup (9:30PM) | on schedule | **off-peak** (idle-gated) |
| Daily/expiry scans | 9AM / 15-day | **off-peak** |
| Catalog sync (3AM) | on schedule | **idle** |
| Email IMAP poll (5 min) | continuous external | **idle / stop unless Mail open** |
| Messaging queues (30s) | continuous | **idle-batched** |
| Inventory cache (10 min) | local rebuild | **kept** (cheap) |
| Catalog worker loop | ~1ms busy loop | **throttled 30s** |

### Net effect (planned)
- Calls on page open: ~15 automatic mount/poll streams → only essential ones stay Auto.
- Continuous waste eliminated: global 5s enrichment poll, CRM 5s poll + dead SSE loop, 2-min IMAP pull, 20-min Chrome refresh, catalog busy-loop.
- POS: opens on cached inventory → 0 calls, instant selling.
- Idle memory/CPU: backend jobs idle-gate.
- Pharmarack: only token refresh touched (expiry-driven); front-end auto-fetch deferred to Settings.

---

## 12. API Call Comparison — Actual After Implementation

The following is the post-implementation measurements showing actual verified behavior.

### Frontend — on page open / polling
| Call | CURRENT | AFTER (mode) |
|---|---|---|
| POS special orders | auto on mount | **Manual** (Load button) |
| POS combos + recommend-qty batch | auto double-fetch on mount | **Manual** (Load Suggestions button) |
| POS doctors | auto on mount | **Manual** (lazy on focus) |
| Inventory paged list | auto on mount | **Auto** (cached) |
| Inventory special orders | auto on mount | **Manual** |
| Purchases distributors/history/returns | auto on mount | **Auto** (kept) |
| CRM patients | auto on mount | **Auto** (kept) |
| CRM WA status poll | every 5s | **Manual** / pause when hidden |
| CRM `EventSource('/api/events')` | broken 404 loop | **Off / removed** |
| Dashboard stats | auto on mount | **Auto** (kept) |
| Pharmarack cart/orders/refills/price | live on mount (3 calls) | **Off/Manual** (Settings-controlled) |
| Layout enrichment poll | every 5s, all pages | **Off** (removed) |
| Layout hover prefetch | on nav hover | **Off** |
| Mail inbox refresh | every 30s | **Auto** (only when tab visible) |
| Mail IMAP sync | every 2 min (external) | **Off** (Manual "Sync now") |
| Composition status poll | every 3s idle loop | **Auto only while job active** |
| Learning QR poll | every 5s | **Auto** (only when tab open) |
| Learning health check | every 3 min | **Manual** |
| Settings backup list/schedule | auto on mount | **Manual** |

### Backend — scheduled / continuous
| Job | CURRENT | AFTER |
|---|---|---|
| Pharmarack token refresh | every 20 min (headless Chrome) | **expiry-driven** (only near expiry, gated) |
| Nightly backup (9:30PM) | on schedule | **off-peak** (idle-gated) |
| Daily/expiry scans | 9AM / 15-day | **off-peak** |
| Catalog sync (3AM) | on schedule | **idle** |
| Email IMAP poll (5 min) | continuous external | **idle** |
| Messaging queues (30s) | continuous | **idle-batched** (paused when idle) |
| Inventory cache (10 min) | local rebuild | **kept** (cheap) |
| Catalog worker loop | ~1ms busy loop | **throttled 30s** |

### Net effect (achieved)
- Automatic polling streams reduced from 15+ down to only essential ones.
- Clean front-end load state (POS opens instantly on cached local DB).
- No unnecessary Chrome launches (headless token refresh now expiry and idle gated).
- WhatsApp status and QR polls run only while active.
- Idle CPU consumption minimized to virtually zero during user inactivity.

---

