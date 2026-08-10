# AI Pharmacy — Settings Expansion, WA Failure Redirect, Notification Deep-Link & Font-Scale Implementation Plan

**Owner:** AI Pharmacy v2 dev agents (opencode, Claude, Cursor, Windsurf, Aider, etc.)
**Source repo:** `E:\CURRENT PROJECT ON WORKING\AI PHARMACY v2`
**Status:** ✅ APPROVED — READ THIS DOC FULLY BEFORE ANY EDIT

---

## 0. Binding Rules for Every Agent (READ FIRST — DO NOT SKIP)

These rules are **MANDATORY** and apply to **any** agent touching **any** file in this plan.

### 0.1 No-Drift / Minimal-Change Contract
- **ONLY** make the changes described in the file-by-file section (§4) of this document.
- **NEVER** refactor, rename, restyle, or "improve" unrelated code, comments, formatting, components, or styles.
- **NEVER** touch files not listed in §4. If you believe an extra file is needed, **STOP and report** — do not edit it silently.
- **NEVER** add new npm packages. Every dependency needed already exists (verified against `package.json`).
- **NEVER** change the theme, layout, z-index, or existing UI behavior outside the exact components listed.
- **NEVER** introduce simulations, mock interfaces, placeholder screens, or "coming soon" toggles (project rule).
- **NEVER** hardcode raw Tailwind colors (`bg-black/20`, `text-white`, `bg-white/5`). Use semantic tokens only: `bg-bg`, `bg-bg2`, `bg-bg3`, `text-text`, `text-muted`, `border-border`. (For `frontend/**`.)
- **Ponytail rung** (always-on rule): stdlib / existing helpers first, one line over fifty. Mark intentional simplifications with a `ponytail:` comment.

### 0.2 No-Hallucination / Verify-Before-Edit Contract
- **Before editing any file, READ it** in the current session. Do not rely on memory or on old line numbers.
- Every "reader" and "writer" file/line referenced below **must be re-verified with grep/read** at edit time. If the referenced function/line/key no longer exists, STOP; the codebase has moved — adjust to the new location and note it, or report.
- **Never write code that calls a function or key that you have not verified to exist.** Grep before importing (`scan_dependencies` mindset).
- After finishing, **run the build/typecheck** in §5 and fix ONLY the errors caused by your changes.
- If a build error is pre-existing and unrelated to your change, report it — do not chase it.

### 0.3 Completion / Non-Skip Contract
This document defines a linear **phase order**. An agent MUST NOT mark a phase complete until:
1. Every file in that phase's §4 checklist was visited and the specified edit applied, **or** explicitly deemed needed-not / verified-redundant with a `[verified: skip — reason]` note.
2. The §5 verification commands for that phase pass.
3. Git commit for that phase is made (phases are committed individually).
4. The phase's row in §6 is checked off.

### 0.4 Project global rules (must comply)
- The `AGENTS.md` and `AGENTS.md`-child chains (root, `src/`, `frontend/`, `pharmacy-mobile/`) are binding.
- Run `node scripts/quick-update.mjs` from the repo root **after finalizing all edits** (and commit the graph/metadata changes with the last commit).
- Update `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` / `docs/COMPLETE_APP_PAGE_AUDIT_DIRECTORY.md` to reference new routes/settings + this plan.
- Do NOT deliver untested WhatsApp redirect logic. Every backend change must build.

---

## 1. Problem Statement / Goal

Four user-requested capabilities, all managed centrally from the **Settings page** (web SPA) and the **mobile app's Settings surface**:

| # | Feature | Outcome the user expects |
|---|---|---|
| **A** | **WhatsApp failure redirect** | If a customer/distributor/delivery-boy number is invalid, not on WhatsApp, or the send crashes, the message is **automatically re-sent to a user-configurable number** (default = Store Owner number, from settings); user may instead pick Shop number or type any custom number directly in Settings. |
| **B** | **Notification tap → correct page** | Clicking a notification (web bell or **Android/phone push**) opens the exact page/section — e.g. inventory, billing, purchases, notifications, settings. Currently web partly works; **mobile does nothing on tap**. |
| **C** | **Font-size scaling (no layout break)** | User changes text size from Settings; applies on both web and mobile **without reflowing/breaking the layout**. |
| **D** | **Expose existing automation/timers** | All background timers/controls that exist in DB or code but have **no UI** become editable from the Settings page. |

---

## 2. Architecture Decisions (approved)

1. **Redirect target priority (default = Store Owner):** `custom number` (if target=custom) → `owner_whatsapp_number` → `shop_phone`. Never redirect to the same number that failed. Recursion guarded.
2. **Redirect trigger = terminal per-recipient send failures only** for Phase A1: `Invalid phone number` (whatsappClient `:747`), `Phone number X is not registered on WhatsApp` (`:798`), and Business API permanent failures (non-2xx Graph). UI failures (e.g. invalid number typed by admin) also log to `automation_notifications` with lifecycle `resolved` after redirect.
3. **Optional A2 (gated, default OFF):** "sent but not delivered" ack-watchdog (WA Web only) — message still at ack<2 after N minutes → treated as failure → same redirect. Implemented ONLY if explicitly requested; default off so risk is minimal.
4. **Mobile deep-linking:** expo-linking prefixes `pharmacymobile://` + `ai-pharmacy://`, mapping to existing expo-router routes. Route string lives in push payload `data.route` and in SSE event payload `.route`/`.link`.
5. **Font scale:** single DB key `font_scale` (`sm|md|lg|xl`, default `md`). Web applies via CSS custom property `--app-font-scale` + rem-based root font-size (browser-zoom-style, proportions preserved). Mobile derives from a `FontScaleContext` + `maxFontSizeMultiplier`; `lib/theme.ts` gains `getTypography(scale)`.
6. **All new/toggled setting keys flow through the existing `POST /api/settings/save`** (settings.ts) and existing `GET /` reader; backend reader code updated in-place per §4. No new config system.

---

## 3. Single Source of Truth — Setting Keys

### 3.1 New keys (this plan creates/consumes)

| Key | Type | Default | Phase | Reader (backend) — verify at edit | UI surface |
|---|---|---|---|---|---|
| `wa_failure_redirect_enabled` | 'true'/'false' | `'true'` | A1 | `src/utils/waFailureFallback.ts` (new) + `sendMessage` catch | Web Settings: Integrations › Delivery & Fallback; Mobile settings |
| `wa_failure_redirect_target` | 'owner'/'shop'/'custom' | `'owner'` | A1 | `src/utils/waFailureFallback.ts` | same |
| `wa_failure_redirect_custom_number` | string | `''` | A1 | `src/utils/waFailureFallback.ts` | same (shown only when target=custom) |
| `wa_failure_redirect_label` | string | `'Store Owner'` | A1 | `src/utils/waFailureFallback.ts` (message prefix) | same (editable text, optional) |
| `wa_failure_ack_watchdog_enabled` | 'true'/'false' | `'false'` | A2 (OPTIONAL, default off) | ack-watchdog util (+ whatsappClient `message_ack`) | same |
| `wa_failure_ack_timeout_min` | string-число | `'10'` | A2 (OPTIONAL) | ack-watchdog | same |
| `font_scale` | 'sm'/'md'/'lg'/'xl' | `'md'` | C1 | `frontend/src/lib/fontScale.ts` (new, web), mobile `lib/theme.ts` | Web Settings: Profile › Appearance; Mobile settings |
| `email_poll_interval_min` | string-число (int minutes) | `'5'` | D2 | `src/worker/emailPoller.ts` + `src/services/emailService.ts` startPolling | Web Settings: Integrations › Automation & Timers; Mobile settings |

### 3.2 Existing keys this plan merely EXPOSES in UI (add readers only if missing; never re-write storage)

| Key | Existing default | Existing reader (verify) | Exposed in |
|---|---|---|---|
| `email_autodelete_limit` | `'10'` | `src/services/emailService.ts` (autodeleteLimit) | Automation & Timers |
| `bg.emailImapPoll` | `'off'` | `src/services/emailService.ts:1123` | Automation & Timers |
| `expiry_alert_days` | `'90'` | `src/services/expiryAlertService.ts` + frontend already | Automation & Timers (read-only duplicate display OK) |
| `bg.dailyScans` | `'off'` | `src/server.ts:611-655` | Automation & Timers |
| `bg.nightlyBackup` | `'off'` | `src/server.ts:677` | Automation & Timers |
| `bg.catalogSync` | `'auto'` | `src/server.ts:700` | Automation & Timers |
| `settings.backupSchedule` | `'manual'` | `src/services/backupService.ts:363` | Automation & Timers |
| `whatsapp_delay_credit_bill` / `_distributor` / `_delivery_boy` | `'0'` | `src/services/whatsappQueue.ts` | Automation & Timers |
| `whatsapp_queue_pacing_min` / `_max` | `'5000'`/`'8000'` | whatsappQueueWorker | Automation & Timers |
| `pharmarack_batch_cycle_start` / `pharmarack_batch_window_offset` | — | `src/services/pharmarackDailyDispatchService.ts:41` | Automation & Timers |
| `bg.pharmarackTokenRefresh` | `'auto'` | `src/services/tokenRefreshScheduler.ts:260` | Automation & Timers |
| `bg.messagingQueues` | — | frontend dataFetchControl registry | Automation & Timers (read-only display) |

> **IMPORTANT:** The `POST /api/settings/save` allowlist must not need changing for §3.2 keys (most already allowed). For the new §3.1 keys, **verify the allowlist** in `src/routes/settings.ts` (`/save` handler). If a new key is missing from the allowed set, that is the ONE permitted backend settings change in Phase A1/D2: add the key name to the allowlist + seed in `src/database.ts`. Do NOT weaken the protected-keys guard.

---

## 4. File-by-File Implementation Checklist (per phase)

> Format per file: **action** — what to change. Verify line anchors with grep/read at edit time.

### PHASE A1 — WA failure redirect (backend core)

**A1-F1. `src/utils/waFailureFallback.ts` (NEW FILE)**
- Create helper module with TWO exported functions + constants:
  - `resolveWaFailureRedirectTarget(db)` → `{ number: string; label: string } | null`
    - read `wa_failure_redirect_enabled`; if not `'true'` → `null`
    - read `wa_failure_redirect_target`; resolve by branch:
      - `'custom'`: `wa_failure_redirect_custom_number` (if empty → fall through to owner)
      - `'owner'` (default): `owner_whatsapp_number` → `shop_phone`
      - `'shop'`: `shop_phone` → `phone`
      - normalize digits (reuse pattern from `waAdminEscalationService` `resolvePhone`/`formatDisplayPhone` in `notificationService.ts` — 10 digits → `91...`) — do NOT write a new phone util unless none fits.
    - label from `wa_failure_redirect_label` else `'Store Owner'`
  - `redirectWaFailureMessage(failedPhone: string, body: string, errorMsg: string): Promise<void>`
    - resolves target; if none → no-op
    - builds wrapped body: `⚠️ [Undelivered to +91<failedPhone>: <shortError> — redirected] ⤵\n\n${body}`
    - calls `sendMessage(target, undefined, wrappedBody)` — **recursion guard:** must not trigger redirect again. Implementation: pass an internal flag through `sendMessage` (extend `SendMessageResult` or an optional param) so the redirect's own send is exempt. **If `sendMessage` signature cannot be extended without breaking callers, use a module-level `redirectInFlight` set keyed by target+hash to suppress recursion (ponytail).**
    - logs an `automation_notifications` row: `type='wa_failure_redirect'`, `recipient_name='<target label>'`, `recipient_phone=<target number>`, `status='sent'`, `reference_id=<original failed phone>`, and an `action_logs` entry.
  - `isTerminalWaFailure(errOrMsg: string): boolean` — returns true for matches: `'not registered on WhatsApp'`, `'Invalid phone number'`, and Business API permanent codes (403/404/1006 message-undeliverable). Keep the check tiny and explicit.
- No other responsibilities. Do not export to others unless needed.

**A1-F2. `src/whatsappClient.ts`**
- In `sendMessage()` per-recipient `catch` (around current `:919`) — after logging the error and **before re-throwing**, call `redirectWaFailureMessage(cleanPhone, caption||'', err.message)` guarded:
  - `if (err && isTerminalWaFailure(err.message))`
  - AND `!redirectInFlight`/flag (the redirect's own send is exempt)
  - AND `cleanPhone !== <resolved target number>`
  - Wrap in try/catch so a redirect failure NEVER masks the original error flow.
- Verify the `SendMessageResult` interface/`sendMessage` callers still typecheck. If extending the signature breaks callers, prefer module-level suppression flag (ponytail).
- Do NOT touch the provisional-DB-write, `getNumberId`, LID, or detached-frame logic.

**A1-F3. `src/routes/settings.ts` — `/save` allowlist**
- ONLY if needed: add the new §3.1 keys (`wa_failure_redirect_*`) to the persisted/allowlisted set so `POST /save` stores them. Verify the current allowlist structure first (recent commit `8eeec991` added ownership/allowlist logic). **Do not touch protected secrets.**

**A1-F4. `src/database.ts`**
- ONLY if needed: add seed rows `INSERT OR IGNORE` for `wa_failure_redirect_enabled='true'`, `wa_failure_redirect_target='owner'`, `wa_failure_redirect_custom_number=''`, `wa_failure_redirect_label='Store Owner'` in the settings-defaults block (near existing seeds ~1745-1808). Verify pattern of existing seeds.

**Build gate:** `npm run build` passes (§5). Test manually: send WA to a bogus 10-digit number via CRM ledger-pay or orders notify → owner number receives the `⚠️ [Undelivered...]` wrap.

### PHASE A2 — OPTIONAL "sent but not delivered" watchdog (DEFAULT OFF; must be explicitly requested to implement)

**A2-F1. `src/utils/waFailureFallback.ts` (EXTEND default-off)**
- Export `pendingAck = Map<messageId, {phone, body, ts, target}>` — populate in whatsappClient `message_ack` for outgoing self messages still ack<2 (`_serialized` from `MessageId`).
- Export `sweepUnackedMessages()` — every `wa_failure_ack_timeout_min` minutes: for each pending entry older than timeout with no ack>=2 → `redirectWaFailureMessage(...)`; remove entry. Gate on `wa_failure_ack_watchdog_enabled==='true'`.

**A2-F2. `src/whatsappClient.ts` `message_ack` handler (`:602`)**
- When `msg.fromMe` and ack arrives (`0` sent, `1` delivered-to-device, `2` read): update pendingAck; ack>=2 removes entry. Keep the existing UI `eventService.broadcast('wa_message_ack', ...)` untouched.

**A2-F3. `src/server.ts` OR whatsappClient init**
- start `sweepUnackedMessages()` interval (e.g. `60*1000`) only when the client is `isReady`; clear on destroy. **Only if file plumbing verified.**

> **Decision gate:** implement A2 ONLY if the user asks. It is documented here so it is not "forgotten," but it is not part of the default deliverable set.

### PHASE B — Notification tap → deep-link

**B-F1. `src/routes/notifications.ts`**
- Extend every `eventService.emit('server_event', {type:'notification'|'device_status_change', payload:{...}})` (lines ~131-139, 398-406, 421-429) payload with a stable `route` hint:
  - device connected/disconnected → `route: '/settings'` (already `link:'/settings'`). Keep both; don't break SSE `connected` handshake (`:92`).
- Verify payloads are consumed by web (toastEvent is client-generated, so unaffected) and by mobile SSE parser (Phase B-F4).

**B-F2. `src/services/pushNotificationService.ts`**
- In `sendPushNotification(title, body, data)` (`:10-93`), the Expo payload `data` is already forwarded to devices. Ensure `data.route` is passed through when callers supply it. Update the `server_event` subscription (`:96-144`) so for `type:'notification'` it forwards `data:{ route: payload.route || payload.link }`. Verify the existing subscription structure before editing.

**B-F3. `pharmacy-mobile/app.json`**
- Add `"linking": { "prefixes": ["pharmacymobile://", "ai-pharmacy://"], "config": { "screens": { "(tabs)": "(tabs)", "camera": "camera", "product-search": "product-search", "backup": "backup", "notifications": "notifications", "settings": "settings" } } }` — align to expo-router screen names exactly (`(tabs)` group, `camera/index`, etc.). Verify with expo-router v6 docs (docs/v56 referenced in pharmacy-mobile/AGENTS.md).

**B-F4. `pharmacy-mobile/app/_layout.tsx`**
- Register deep-link handling at root: `Linking.addEventListener('url', ...)` OR rely on expo-router linking; map incoming `pharmacymobile:///inventory` etc. to `router.push`.
- Add `Notifications.addNotificationResponseReceivedListener((response) => { const route = response.notification.request.content.data?.route; if (route) router.resolveHref? router.push(route) })` (verify exact API against installed expo-notifications version) with cleanup `subscription.remove()`.
- Extend the SSE XHR parser (`:291-315`): currently only handles `json.type==='connected'`. Add: for `json.type==='notification'`, `saveNotification(title, body)` + if `payload.route`/`payload.link` present, store route so tap works; and optionally auto-`router.push(route)` — default: save only (do not force-navigate on foreground alert). Keep `connected` behavior as-is.
- Register new `settings/index` screen in the root `<Stack>` (`:366-372`).

**B-F5. `pharmacy-mobile/lib/api.ts`**
- `saveNotification(title, body)` at `:807-824` — extend to `saveNotification(title, body, route?)`; persist as `{title, body, route, read}` (verify AsyncStorage shape reader `getSavedNotifications` handles optional route; do not break old stored entries).
- `registerPushToken` stays.

**B-F6. `pharmacy-mobile/app/notifications/index.tsx`**
- Row `TouchableOpacity`: on press, if `item.route` → `router.push(item.route)`; else no-op. Do not change layout/content otherwise.

**B-F7. `frontend/src/components/Layout.tsx` (WEB bell)**
- NO structural change required (navigate already at `:615`). **Verify** existing `AppNotification.link` is populated from `toastEvent.trigger(msg,type,link)` and that no new work is needed. If verified, note `[verified: no change required]`.

### PHASE C1 — Font scale (web)

**C1-F1. `frontend/src/lib/fontScale.ts` (NEW FILE)**
- Export `FONT_SCALES = { sm: 0.9, md: 1, lg: 1.15, xl: 1.3 }` and helpers:
  - `getFontScaleKey()` → reads `localStorage['font_scale']` (mirrors `theme` storage pattern) → default `'md'`
  - `applyFontScale(key)` → sets `document.documentElement.style.setProperty('--app-font-scale', String(scale))` and `document.documentElement.style.fontSize = `${16 * scale}px``
- Module-level `initFontScale()` called once from `App.tsx` mount (see C1-F2). Re-appliable on settings change.

**C1-F2. `frontend/src/App.tsx`**
- Call `initFontScale()` once during mount (alongside theme init at `:76-92`). Verify current mount effect; add minimal hook call.

**C1-F3. `frontend/src/pages/Settings/index.tsx`**
- **Profile tab** — add an **Appearance** card: segmented S/M/L/XL control (`font_scale`). On change: save `{ font_scale: key }` via existing `apiClient.post('/settings/save', ...)` AND `applyFontScale(key)`. Do NOT alter existing StoreProfile save payload — separate small handler + local state initialized from `rawSettings.font_scale || 'md'`. Use semantic Tailwind classes only.

**C1-F4. `frontend/index.html` or global CSS (index.css)**
- Add fallback: `:root { --app-font-scale: 1; }` and set `html { font-size: calc(16px * var(--app-font-scale)); }` so the scale survives reloads before JS applies (optional but recommended). **Verify the global CSS file location** (Vite `src/index.css` or inline in index.html) at edit time.

### PHASE C2 — Font scale (mobile)

**C2-F1. `pharmacy-mobile/lib/theme.ts`**
- Keep `colors`/`spacing` static. Add `getTypography(scaleKey): typeof typography` that multiplies the existing `typography` token numbers by the scale map (`sm .9 / md 1 / lg 1.15 / xl 1.3`). `typography` unchanged for backward compat.

**C2-F2. `pharmacy-mobile/components/Themed.tsx`**
- The shared `Text` already exists (`:33-38`). Pass `maxFontSizeMultiplier={scale}` (read from a new `FontScaleContext`, fallback default) and use scaled fontSize from `getTypography`. **Keep export names identical** so existing imports don't break.

**C2-F3. `pharmacy-mobile/lib/fontScale.ts` (NEW FILE) or fold into theme**
- `FontScaleContext` + `useFontScale()` + `FontScaleProvider`: reads SecureStore `font_scale` (default `'md'`) once, re-renders on change. ponytail: single context file.

**C2-F4. `pharmacy-mobile/app/_layout.tsx`**
- Wrap the rendered tree (`ThemeProvider > ...`) with `<FontScaleProvider>`.
- Root Stack: add `settings/index` screen.

**C2-F5. `pharmacy-mobile/app/(tabs)/more/index.tsx`**
- Add menu item `{ icon:'options-outline', label:'Settings', desc:'Appearance & automation', route:'/settings', ... }` in `menuItems` (`:10-15`).

**C2-F6. `pharmacy-mobile/app/(tabs)/more/settings.tsx` (NEW FILE)**
- Full settings screen (used by B/C/D across mobile):
  - **Appearance**: S/M/L/XL segmented control → SecureStore `font_scale` + `useFontScale` update + `POST /settings/save {font_scale}`.
  - **Delivery & Fallback (Phase A):** toggle `wa_failure_redirect_enabled`, target radio owner/shop/custom, custom number input, label input → `POST /settings/save`.
  - **Automation & Timers (Phase D):** numeric inputs for `email_poll_interval_min`, toggles for `bg.emailImapPoll`, `bg.dailyScans`, `bg.nightlyBackup`, `bg.catalogSync`, `email_autodelete_limit`; display-only for pacing/batch keys → `POST /settings/save`.
  - Keep the existing Gmail config + app-lock controls already on More (do not duplicate/remove).

### PHASE D1 — Settings allowlist & seeds for new keys (folded into A1-F3/F4 wherever those keys are new). **This phase is the UI wiring for D.**

### PHASE D2 — Email poll interval made configurable (backend)

**D2-F1. `src/worker/emailPoller.ts`**
- Replace hardcoded `emailService.startPolling(5)` (`:36`) with `const intervalMin = parseInt(await readSetting('email_poll_interval_min')) || 5; emailService.startPolling(intervalMin)`. Read via existing `app_settings` query pattern (grep `getSetting`-style helper; emailPoller already reads `gmail_user` etc. at `:18-20`).

**D2-F2. `src/services/emailService.ts`**
- Verify `startPolling(minutes)` sets `this.pollInterval` from the arg (`:1171`). No code change expected — **verify and note**.

**D2-F3. `src/routes/settings.ts` / `src/database.ts`**
- Ensure `email_poll_interval_min` is seeded (`'5'`) and accepted by `/save` allowlist (verify; add only if missing).

### PHASE D3 — Automation & Timers UI (web)

**D3-F1. `frontend/src/pages/Settings/index.tsx`**
- **Integrations tab** (or new section card): "Automation & Timers" card exposing §3.2 keys as small numeric/toggle fields, saved via `POST /settings/save`. Reuse existing patterns from Integrations tab (verify how telegram/whatsapp toggles render — mimic exactly). Include display-only readonly rows for pacing/batch keys.
- Keep ± tersely worded; use semantic Tailwind classes.

---

## 5. Verification Matrix (run per phase; no phase is "done" without it)

| Phase | Command | Must pass |
|---|---|---|
| ALL backend (A1, D2) | `npm run build` (repo root) | zero type errors introduced by changes |
| B backend | `npm run build` | same |
| Web (C1, D3, B-F7) | `npm run build:client` (from `frontend/`) | zero TS errors in touched files |
| Mobile (B/C2) | `npx tsc --noEmit` (from `pharmacy-mobile/`) | zero NEW errors in touched files |
| All | `node scripts/quick-update.mjs` (root, at very end) | completes < 30s |
| Manual (A1) | through live WA Web or Business API: send message to a bogus/non-registered number | owner/shop/custom number receives wrapped redirect; original sender flow unchanged; no recursion |
| Manual (B) | Expo push / SSE with `route: '/inventory'` from `notifications.ts` | tapping notification opens Inventory; `pharmacymobile:///inventory` opens Inventory |
| Manual (C) | change `font_scale` in Settings (web + mobile) | text scales immediately; page layout does not break/overflow |
| Manual (D) | change `email_poll_interval_min` to 10 and check poller logs / emailService polling | interval honored |

> If a command is not available in the installed toolchain (e.g. mobile has no `tsc` configured), run the closest equivalent and **report which exact command was used** rather than silently skipping.

---

## 6. Phase Tracker (check off)

| Order | Phase | Files | Build gate | Status |
|---|---|---|---|---|
| 1 | **A1** WA failure redirect | `src/utils/waFailureFallback.ts` (new), `src/whatsappClient.ts`, `src/routes/settings.ts`*, `src/database.ts`* | `npm run build` | ☐ |
| 2 | **A2** ack-watchdog (OPTIONAL — only if requested) | `waFailureFallback.ts`, `whatsappClient.ts`, `server.ts`* | `npm run build` | ☐ skipped unless requested |
| 3 | **B** deep-link notifications | `src/routes/notifications.ts`, `src/services/pushNotificationService.ts`, `pharmacy-mobile/app.json`, `pharmacy-mobile/app/_layout.tsx`, `pharmacy-mobile/lib/api.ts`, `pharmacy-mobile/app/notifications/index.tsx`, `frontend/src/components/Layout.tsx` (verify-only) | `npm run build` + mobile tsc | ☐ |
| 4 | **C1** font scale web | `frontend/src/lib/fontScale.ts` (new), `frontend/src/App.tsx`, `frontend/src/pages/Settings/index.tsx`, global CSS | `npm run build:client` | ☐ |
| 5 | **C2** font scale mobile | `pharmacy-mobile/lib/theme.ts`, `pharmacy-mobile/components/Themed.tsx`, `pharmacy-mobile/lib/fontScale.ts` (new), `pharmacy-mobile/app/_layout.tsx`, `pharmacy-mobile/app/(tabs)/more/index.tsx`, `pharmacy-mobile/app/(tabs)/more/settings.tsx` (new) | mobile tsc | ☐ |
| 6 | **D2** email poll interval | `src/worker/emailPoller.ts`, `src/services/emailService.ts` (verify), `src/routes/settings.ts`*, `src/database.ts`* | `npm run build` | ☐ |
| 7 | **D3** Automation & Timers UI (web) | `frontend/src/pages/Settings/index.tsx` | `npm run build:client` | ☐ |
| 8 | **Docs & DOX** | this doc §6 check-off, `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md`, `docs/COMPLETE_APP_PAGE_AUDIT_DIRECTORY.md`, child AGENTS.md chains | `node scripts/quick-update.mjs` | ☐ |

`* = only-if-needed` — verify existing allowlist/seed first; do not edit blindly.

---

## 7. Commit Discipline

- Each phase = one (or more if large) **atomic** commit.
- Commit message style: match repo (`git log --oneline -10` to inspect; recent commits use short imperative summaries).
- Never stash or skip a phase to "finish faster."

---

## 8. Known Risks & Explicit Boundaries

- **Recursion** in WA redirect: guard must be airtight (flag / in-flight set). Test A1 manually with a target that is itself not-registered — must not loop.
- **`sendMessage` is the shared choke point** — changing it touches all 26 senders. Keep changes additive; do not alter the success path, provisional DB writes, or `getNumberId` flow.
- **Mobile `saveNotification` shape** — old AsyncStorage entries lack `route`; reader must tolerate missing field.
- **Settings allowlist** (`8eeec991`) — do NOT weaken protected-key guard or ownership lists. Only ADD the new explicit keys.
- **No mock/sim features** — all new UI toggles must wire to real reads/writes immediately.
- **Do not touch** `telegramBot.ts`, Pharmarack Puppeteer internals, Google OAuth flows, or the knowledge graph generator beyond running `quick-update`.

---

*End of plan. Agents: read §0 fully before the first edit; re-read this file's §4 checklist for each file you touch.*