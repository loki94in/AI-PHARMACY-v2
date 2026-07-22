# Restore WhatsApp Web (whatsapp-web.js) Client

## Context

The app has two WhatsApp integrations:

1. **WhatsApp Business Cloud API** (`whatsappBusinessService.ts`, `routes/whatsappBusiness.ts`) — official Meta API, currently the only working path. Requires template approval for messages outside the 24-hour customer-service window.
2. **`whatsapp-web.js` headless client** (`whatsappClient.ts`) — automates a real WhatsApp Web session via Puppeteer/Chrome, using the same QR-code login as `web.whatsapp.com`. This was fully implemented (777 lines) in an earlier commit, then stubbed out to no-ops in commit `f208f220` ("Headless client wrapper disabled at user request") when the Business API was introduced.

The frontend Settings page (`frontend/src/pages/Settings/index.tsx`) already has a working QR-code panel (polls `GET /messaging/qr`, renders `waStatus.qrUrl`, shows connect/reconnect state) built for path 2. It has been idle since the stub-out — `GET /messaging/qr` currently only returns a real QR if `shouldRouteToBusiness()` is false, but `initClient()` does nothing, so no QR is ever produced.

The inbound message pipeline (`whatsappIntentService.handleInbound`) that scans customer messages, matches medicines against the local DB and Pharmarack catalog, and escalates to the admin — is fully built and already expects to be called from a `message_create` handler on the WhatsApp Web client. It currently has no messages to process because no client is running.

## Goal

Re-enable the real `whatsapp-web.js` client so:
- The existing Settings page QR panel shows a real, scannable QR (identical experience to `web.whatsapp.com`).
- Once scanned, inbound and outbound messages flow through the real session.
- Every inbound customer message is fed into the existing `whatsappIntentService.handleInbound` pipeline, unchanged.
- The Business API path continues to work as an alternate option via the existing `whatsapp_preferred_system` setting — this is a restore, not a removal of path 1.

Explicitly out of scope (already covered by a separate design, not part of this change): the distributor "live cart to WhatsApp" feature discussed earlier in this session. That remains a possible follow-up but is not part of this revert.

## Design

### `src/whatsappClient.ts`

Restore to the pre-`f208f220` implementation, layered onto the current file's structure:

- Import `Client`, `LocalAuth` from `whatsapp-web.js` (already in `package.json`, no install needed).
- `initClient()`: launches Puppeteer with a detected local Chrome/Edge executable (falls back to bundled Chromium), `headless: true`, sandbox-disabling args consistent with the prior implementation. Registers:
  - `qr` → stores `currentQr`, starts a 30s expiry timeout that destroys the client if not scanned (prevents a stale QR hanging around).
  - `ready` → sets `isReady = true`, clears QR state, kicks off background chat/message sync.
  - `disconnected` → clears state, broadcasts `auth_failure` over SSE so the UI can prompt reconnect.
  - `auth_failure` → same broadcast, rejects the init promise.
  - `message_create` → for every message (in or out): upserts into `whatsapp_messages`/`whatsapp_chats` (existing schema, existing ignore-list check via `ignored_whatsapp_numbers`), broadcasts `wa_new_message` over SSE, and — for inbound (`!msg.fromMe`) — calls `whatsappIntentService.handleInbound(msg)` exactly as the service already expects.
  - `message_ack` → broadcasts `wa_message_ack`.
  - Stale profile-lock cleanup (`cleanupProfileLocks`) before launch, ported as-is — kills orphaned Chrome processes holding the `.wwebjs_auth` session lock from a prior crash, and removes lock files, so restarts don't hang.
- `destroyClient()` / `forceReconnect()`: restored to actually tear down / relaunch the Puppeteer client instead of being no-ops.
- `sendMessage()`: keep the existing `shouldRouteToBusiness()` branch at the top (unchanged routing logic — reads `whatsapp_preferred_system` / `wa_business_enabled` from `app_settings`). When it resolves to non-business, call `client.sendMessage(...)` on the live session instead of only logging; the SQLite-write/broadcast tail of the function (already present, added after the original implementation) stays as-is since it already handles both branches.
- `getChats()`, `getChatMessages()`, `getMessageMedia()` — untouched; these already read from the local SQLite cache and don't depend on which client is active.

### Frontend

No changes. `Settings/index.tsx` already polls `/messaging/qr` every 15s while `whatsappEnabled` is true and not ready, and already renders the QR image / status message / reconnect button.

### Backend routes

No changes to `routes/messaging.ts` — `/qr`, `/login-window`, `/reconnect` already call into `initClient`/`forceReconnect`/`destroyClient`, which will now do real work instead of no-ops.

### Data

No schema changes. `whatsapp_messages`, `whatsapp_chats`, `ignored_whatsapp_numbers` tables already exist and are already used by both the current stub and the restored implementation identically.

### Error handling

Ported as-is from the original implementation:
- Puppeteer/whatsapp-web.js internal rejections (`detached Frame`, `Execution context was destroyed`, `Session closed`, `Target closed`) are caught at the process level and logged as warnings rather than crashing the server — these are known noisy internals of headless Chrome automation, not real failures.
- QR expires after 30s with no scan; client is destroyed and a fresh `initClient()` call (triggered by the next `/qr` poll) generates a new one.
- `disconnected` and `auth_failure` both broadcast an SSE event so the Settings page can surface a "please reconnect" state instead of silently failing.

### Testing

Manual UAT only (this is infra/session automation, not unit-testable business logic):
1. Enable WhatsApp in Settings → confirm a real QR renders.
2. Scan with a test WhatsApp account → confirm `isReady` flips and the QR clears.
3. Send a text message to the connected number from another phone → confirm it appears in `whatsapp_messages`/`whatsapp_chats` and, if it looks like a medicine request, triggers the existing `wa_medicine_match` broadcast (verify via existing UI that consumes it, or server logs).
4. Send a message from the app (existing send UI) → confirm it's delivered on the real WhatsApp session.
5. Kill and restart the server → confirm the session resumes from `LocalAuth` without a fresh QR scan (existing session persistence behavior).
6. Toggle `whatsapp_preferred_system` to `official` → confirm sends route through the Business API instead, unaffected by this change.
