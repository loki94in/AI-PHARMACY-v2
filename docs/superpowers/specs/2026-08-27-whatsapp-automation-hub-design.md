# WhatsApp Automation Hub — Design Spec

Date: 2026-08-27
Status: Approved for planning

## Problem

The app already runs a real, automated WhatsApp send pipeline (via `whatsapp-web.js`,
not `wa.me` links) with ~20 distinct automations scattered across routes and services
(dispatch reminders, distributor collection, refill reminders, doctor reports, expiry
alerts, credit reminders, etc.). Send status tracking, retry, and pacing already exist
(`whatsapp_send_queue` table + `whatsappQueueWorker`), and a cross-channel audit log
(`automation_notifications`) also exists — but this is split across a Settings tab
(`TriggerSchedulesTab`), a floating queue popover (`WhatsAppQueuePopover`), and a
sidebar (`QuickAssistSidebar`) that nobody looking at the header would find. There is
no single place to see "what WhatsApp automations exist, are they on, and did the last
message actually go out."

Separately, current pacing presets (`turbo`: 100–300ms, `fast`: 1–3s) allow sends far
faster than is safe, contradicting the requirement that the app never blasts messages.

## Goals

1. One consolidated view — the **Automation Hub** — listing every WhatsApp automation
   type, its on/off state, and live/recent send status with failure reasons that are
   impossible to miss.
2. A small, low-noise entry point in the existing header icon cluster (not a new page/
   route) that opens the Hub and reflects at-a-glance state (sending / recent failure).
3. A hard, unbypassable floor of 10–15 seconds between any two outgoing WhatsApp sends,
   app-wide, replacing the current faster presets.
4. No silent sends: every send's outcome (sent/failed) must be visible somewhere the
   user can find without digging, and failures must show *why*.

## Non-goals

- No new database tables — reuse `whatsapp_send_queue` and `automation_notifications`.
- No new top-level route/page — the Hub is a popover/modal, same pattern as
  `WhatsAppQueuePopover`.
- Not touching the WhatsApp Business Cloud API direct-send routes' external behavior
  (only bringing them under the same pacing floor if they can loop/batch).
- Not redesigning the existing `WhatsAppQueuePopover` — the Hub complements it; the
  popover remains for low-level queue operations (edit, resend, flush).

## Existing infrastructure this builds on

- `src/services/whatsappQueueWorker.ts` — canonical send queue + worker loop, pacing
  presets (`setPacingPreset`), per-category delay timers, retry/backoff, dedup guard.
- `whatsapp_send_queue` table (`src/database.ts:867-882`) — per-message status
  (`pending|sending|waiting|sent|failed_offline|failed_perm|cancelled|review_required`),
  `error_message`, `retry_count`.
- `automation_notifications` table (`src/database.ts:884-896`) — cross-channel audit
  log with `type`, `status`, `error_message`, `lifecycle_status`, written by several
  services (doctor reports, bounced alerts, shortage reminders, etc.).
- `frontend/src/components/WhatsAppQueuePopover.tsx` — live queue UI, including
  `getFormattedFailureReason()` (already classifies invalid number / session lost /
  network timeout / not-on-WhatsApp) and SSE-driven refresh (`sse-wa-queue-updated`,
  `whatsappQueueEvent` pub/sub).
- `frontend/src/pages/Settings/index.tsx` `TriggerSchedulesTab` (~line 1603) —
  existing per-automation toggle-card convention (pill switch, `app_settings`
  key/value string storage, `rawSettings.key !== 'false'` default-on read pattern).
- `frontend/src/components/Layout.tsx` — header (`Topbar`, line 1532), right-side
  icon cluster (line 1608), existing bell/`NotificationPanel` (line 1747) with its
  badge-dot convention (line 1767-1772) to copy for the new entry point.

## Design

### 1. Automation catalog (backend)

A single static catalog module, `src/services/automationCatalog.ts`, listing all ~20
known WhatsApp automation types found during exploration (dispatch reminder,
distributor collection, pharmarack batch, single distributor order, credit reminder,
payment receipt, doctor daily summary, expiry report, bounced products alert, shortage
notice, refill reminder ×4 variants, monthly report, admin escalation, invoice PDF,
POS bill, WhatsApp Business direct send). Each entry: `{ id, label, description,
appSettingsKey, defaultEnabled }`.

This is the single source of truth for "what automations exist" — the Hub UI renders
from it, and the toggle read/write logic keys off `appSettingsKey`, reusing the exact
`app_settings` string-boolean convention already in use (no new settings-storage
mechanism). Where an automation doesn't yet have a toggle key (some are unconditional
today), a new `app_settings` key is added following the existing naming convention
(`trigger_<name>_enabled`), defaulting to enabled so behavior doesn't change until a
user explicitly opts out.

### 2. Status feed (backend)

New read endpoint, `GET /api/automation/hub-summary`, that:
- Joins/merges recent rows from `whatsapp_send_queue` (last N, or last X minutes) and
  `automation_notifications` (`type='whatsapp'` and related types) into one
  chronological list: `{ automationType, targetName, status, errorMessage, sentAt }`.
- Computes a single `headline` state for the badge: `'sending' | 'failed' |
  'idle'` — `sending` if anything is currently `pending/sending/waiting`, `failed` if
  the most recent terminal item is `failed_offline/failed_perm`, else `idle`.
- No new table; this is a query-composition endpoint over existing data.

Reuses the existing SSE event (`sse-wa-queue-updated`) plus a new lightweight one
(`sse-automation-hub-updated`, fired wherever `automation_notifications` rows are
written) so the header badge and open Hub popover update live, consistent with the
"events not timers" pattern already used by `WhatsAppQueuePopover`.

### 3. Header entry point (frontend)

A new small button in `Layout.tsx`'s right-side icon cluster, adjacent to the existing
bell (around line 1745-1747), following the exact same `relative p-2 rounded-xl ...
group` button + absolute-positioned badge-dot pattern as the bell. States:
- Default: neutral icon (e.g. `MessageSquareText` or similar from lucide-react,
  distinct from the bell's `Bell`/`BellRing`), no dot.
- `sending`: small pulsing blue dot (mirrors the bell's `animate-ping` treatment).
- `failed`: small red dot, persists until the user opens the Hub and acknowledges
  (viewing the Hub marks the current failed state as seen — no separate "mark read"
  action needed).
- Clicking opens the Automation Hub popover (new component, `AutomationHubPopover.tsx`,
  same modal-mount pattern as `WhatsAppQueuePopover` — conditionally rendered in
  `Layout`, triggered via a new `automationHubEvent` pub/sub mirroring
  `whatsappQueueEvent`).

Per your instruction, this does **not** touch the bell/Activity panel's own contents or
add a new full page/route — it's a new, separate small entry point sitting next to it.

### 4. Automation Hub popover (frontend)

`frontend/src/components/AutomationHubPopover.tsx`, structured as two sections:

**a. Automations list** — one card per catalog entry (from `automationCatalog.ts` via
a new `GET /api/automation/catalog` endpoint or bundled into `hub-summary`), each
showing: label, one-line description, pill toggle (same visual as
`TriggerSchedulesTab`) wired to its `appSettingsKey` via the existing
`api.saveSettings()` call. Toggling here and toggling in Settings → Trigger Schedules
read/write the same underlying keys, so they stay in sync automatically — no dual
state to reconcile.

**b. Recent activity** — reverse-chronological list from `hub-summary`, each row:
automation type, target (name/number, masked appropriately), status pill
(Sent/green, Failed/red, Pending/amber), and — for failures — the formatted reason
inline in a visible red-tinted banner directly under the row (reusing
`getFormattedFailureReason()`, extracted from `WhatsAppQueuePopover.tsx` into a shared
util so both components use identical failure-reason text). No expand-to-see click
required; the reason is always visible when a row is failed.

A "View full queue" link/button at the bottom opens the existing
`WhatsAppQueuePopover` (via `whatsappQueueEvent.triggerOpen()`) for users who want the
lower-level retry/edit/resend controls — the Hub doesn't duplicate those controls.

### 5. Hard 10–15s pacing floor (backend)

In `whatsappQueueWorker.ts`:
- Remove the `'turbo'` and `'fast'` preset options entirely (both from the worker's
  `setPacingPreset` switch and the frontend preset buttons in
  `WhatsAppQueuePopover.tsx`).
- `'safe'` becomes the only named preset and is redefined as 10–15s (currently 10-12s
  — widened to match the requirement exactly).
- `'custom'` pacing remains selectable, but the value is clamped server-side wherever
  `app_settings.whatsapp_queue_pacing_min/_max` is read (not just at write time, so a
  stale or directly-edited `app_settings` row can't bypass the floor):
  `minMs = Math.max(10000, requestedMinMs)`, then
  `maxMs = Math.max(minMs + 1000, requestedMaxMs)` (ensures max is always at least
  1s above min, preventing a degenerate zero-width or inverted range).
- This is a single choke point (the worker's per-send delay calculation) so it applies
  to every automation that enqueues through `whatsappQueueWorker.enqueue()` — i.e. all
  ~19 of the 20 mapped automations. The one exception is the WhatsApp Business Cloud
  API direct-send routes (`POST /whatsapp-business/send`, `/send-template`), which
  bypass the queue entirely today; these are out of scope for pacing (non-goal above)
  unless a future caller starts looping them, in which case they should be routed
  through the queue instead of given their own pacing logic.

### 6. Failure visibility (backend + frontend)

No silent failures: every `whatsapp_send_queue` write to a terminal `failed_*` status
must already carry a non-null `error_message` (spot-check during implementation;
add a fallback generic message if any code path sets a failed status without one).
The Hub surfaces this per point 4b above. No new "silent success" paths are
introduced — this spec doesn't add any new bypass around the queue's existing
status/error tracking.

## Data flow summary

```
Automation trigger (route/service)
        │
        ▼
whatsappQueueWorker.enqueue()  ──────────────►  whatsapp_send_queue row (pending)
        │                                              │
        ▼ (worker loop, paced ≥10-15s)                 │ status updates
whatsapp-web.js sendMessage()                           │ (sending→sent/failed_*)
        │                                              │
        └──────────────► automation_notifications  ◄───┘  (some services also
                          (audit trail, some                write directly here)
                          services write directly)
                                    │
                                    ▼
                  GET /api/automation/hub-summary (merges both)
                                    │
                       ┌────────────┴────────────┐
                       ▼                          ▼
              Header dot (sending/failed)   AutomationHubPopover
                                             (catalog + activity list)
```

## Testing

- Unit tests for the pacing-floor clamp (`whatsappQueueWorker.ts`): custom values
  below 10000ms are raised to the floor; values above are left alone; `min >= max`
  is corrected.
- Unit test for `hub-summary` headline computation (`sending`/`failed`/`idle` given
  various queue/notification row combinations).
- Manual UI verification (per project convention — no browser automation in this
  repo's test suite): open the Hub, confirm all catalog entries render, toggle one
  off and confirm it persists via Settings → Trigger Schedules showing the same
  state, trigger a failed send (e.g. invalid number) and confirm the reason shows
  inline without an extra click.

## Open questions resolved during brainstorming

- Header badge: **yes**, small dot next to the bell, not a duplicate of the bell.
- Pacing floor: **yes**, hard 10-15s minimum, remove faster presets.
- Auto-hide: the *badge* clears back to neutral once the current send/failure is
  acknowledged (Hub opened) or a new successful send completes after a failure —
  the Hub *popover* itself just closes normally on click-away/close, like
  `WhatsAppQueuePopover`; it does not need special auto-close logic beyond that.
- Per-automation enable/disable: **yes**, included (section 4a).
- No new full page/route: **confirmed**, popover only, entry point folded into the
  header icon cluster next to the existing bell.
