# CRM In-App WhatsApp Chat — Design

## Problem

The CRM page's "WhatsApp Business" tab (`WhatsAppSection` in `frontend/src/pages/CRM/index.tsx`) does not let staff read or send WhatsApp messages inside the app. It only offers two escape hatches: launch a separate Chrome window pointed at `web.whatsapp.com`, or open it in a new browser tab. This exists because `web.whatsapp.com` sends `X-Frame-Options`/CSP headers that block iframe embedding — a restriction enforced by the browser, not fixable from application code.

Meanwhile the backend already runs a fully authenticated `whatsapp-web.js` session (`src/whatsappClient.ts`) with working chat sync, message history, media, sending, and real-time SSE events (`wa_new_message`, `wa_chats_updated`, `wa_message_ack`, `auth_failure`) — none of which the CRM tab uses today.

## Goal

Replace the CRM WhatsApp tab with a real chat interface — chat list, message thread, composer — built with the app's own React components and wired directly to the existing backend session. This is the real WhatsApp connection (same account, same messages), not a reimplementation of Meta's web client and not an iframe/proxy of it. Also add an editable message-template system so staff can quick-send common messages (refill reminders, credit reminders, distributor updates, inquiry replies, etc.) from inside a chat, without hardcoding business logic per category.

## Non-goals

- Not embedding or reverse-proxying `web.whatsapp.com`. Rejected explicitly: fragile against WhatsApp's frequent client updates and risks ToS violation / number bans.
- Not building QR-code connect/reconnect UI in CRM — that already exists in Settings. The chat tab only shows a status banner and links there when disconnected.
- Not building dedicated per-category workflows (e.g. a bespoke "Credit Reminder" business-logic flow with its own due-amount lookups). Templates are generic, user-authored text — the mechanism is category-agnostic.
- Not touching the WhatsApp Business API routing path (`shouldRouteToBusiness`) — this tab always operates on the automated whatsapp-web.js session's cached data, consistent with how `/messaging/*` already behaves.

## Architecture

```
CRM (WhatsApp tab)
 ├─ ChatListPanel      GET /messaging/chats            (existing)
 ├─ ChatThreadPanel    GET /messaging/chats/:id/messages (existing)
 │                     GET /messaging/chats/:id/messages/:messageId/media (existing)
 ├─ Composer           POST /messaging/send             (existing)
 │   └─ TemplatePicker GET/POST/PUT/DELETE /messaging/templates (NEW)
 └─ live updates       EventSource → /notifications/stream (existing global SSE),
                        filtered for wa_new_message / wa_chats_updated / wa_message_ack / auth_failure
```

No changes to `whatsappClient.ts` sending/receiving logic, no changes to the SSE transport — only a new templates table + routes, and new frontend components.

## Components

### 1. Chat list panel

- Fetches `GET /messaging/chats` on mount; re-fetches (or patches in place) on `wa_chats_updated` SSE events.
- Search input filters the already-loaded list client-side by name/phone (existing `parseAllPhoneNumbers`-style normalization can be reused for matching).
- Each row: avatar-initial, name, last-message preview, relative timestamp (`formatTs`, already in this file), unread badge.
- Selecting a row sets `activeChatId`, loading its thread in the right panel. No new backend endpoint needed.

### 2. Message thread panel

- Fetches `GET /messaging/chats/:id/messages?limit=500` when `activeChatId` changes.
- On `wa_new_message` SSE events where `payload.chat_id === activeChatId`, append the message to state directly (no re-fetch) and auto-scroll to bottom if the user was already at the bottom.
- On `wa_message_ack` events, patch the matching message's ack/delivered state.
- Bubble rendering: right-aligned for `fromMe`, left-aligned otherwise. `hasMedia` messages lazy-fetch via the existing media endpoint and render image/document/audio appropriately by mimetype.
- Top banner: if `!isReady` (from `GET /messaging/qr`'s `isReady` field, polled once on mount and updated via `auth_failure` SSE), show "WhatsApp not connected — connect it in Settings" with a link to `/settings`. No QR code is rendered here; Settings already owns that flow.

### 3. Composer

- Text input + send button → `POST /messaging/send` with `{ number, message }` (existing endpoint), where `number` is the active chat's `resolvedNumber`.
- Attach-file button → same endpoint's existing `file: { mimetype, data, filename }` path (base64), reusing the existing multipart-to-base64 handling pattern already present elsewhere in the app (e.g. `QuickOrderModal` or wherever file-to-base64 is already implemented) rather than writing a new one.
- A **Templates** button opens a small popover listing saved templates grouped by category. Selecting one inserts its `body` text into the composer (not sent immediately) so the user can edit before hitting Send — satisfies "app creates the template, user can edit it."

### 4. Message templates (new)

**Table** (added to `src/database.ts` alongside the other `whatsapp_*` tables):

```sql
CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

**Routes** (added to `src/routes/messaging.ts`):
- `GET /messaging/templates` — list all, ordered by category then name.
- `POST /messaging/templates` — create `{ name, category, body }`.
- `PUT /messaging/templates/:id` — update any of the three fields.
- `DELETE /messaging/templates/:id` — remove.

**Seed data:** on first migration, insert a handful of starter templates (e.g. "Refill Reminder", "Credit/Dues Reminder", "Distributor Follow-up", "Medicine Availability Reply") with generic bodies containing `{{name}}`-style placeholders as plain text — no server-side placeholder substitution engine, since the user edits before sending anyway. Simplicity over a templating DSL.

**Template management UI:** a small modal (list + inline add/edit/delete form) reachable from the Composer's Templates popover via a "Manage templates" link. Plain CRUD form, matches the visual style of similar small admin modals elsewhere in the app (e.g. `QuickOrderModal`).

### 5. Automated workflow messages

No new work required: every existing automated send already goes through `sendMessage()` in `whatsappClient.ts`, which writes to `whatsapp_messages`/`whatsapp_chats` — so refill reminders, distributor notices, etc. already appear inline in the thread the moment this chat UI reads from that same table.

## Error handling

- `POST /messaging/send` failures (e.g. client not ready) already surface via the existing 202-then-fire-and-forget pattern with queueing in `whatsapp_send_queue`; the composer shows a toast on immediate validation errors only (empty message/number) and otherwise trusts the existing queue/retry behavior — no new error UI needed beyond an "queued, will retry" toast if the initial POST itself 5xxs.
- If `GET /messaging/chats` or the thread fetch fails, show the same inline empty/error state pattern already used by `RefillsSection`/`DistributorMessagesSection` in this file (`toastEvent.trigger(..., 'error', '/crm')`).
- Template CRUD failures: standard toast + no optimistic update rollback needed since these are simple admin operations.

## Testing

- Backend: new Jest tests for the four `/messaging/templates` routes (CRUD happy path + validation), following the existing mocking pattern used for other `messaging.ts` routes.
- Frontend: no new automated test infra is implied by the current codebase conventions (CRM page has no existing frontend test file); manual verification via the `run` skill / dev server is the validation path, consistent with how the existing WhatsApp Web client restoration (Task 2, per prior session) was manually verified end-to-end.

## Open items resolved during brainstorming

- Rejected reverse-proxying `web.whatsapp.com` (ToS/fragility risk) in favor of building on the existing whatsapp-web.js session — explicitly confirmed by user.
- Quick actions are the generic Templates mechanism, not per-category bespoke workflows — explicitly confirmed by user ("app only creates templates, user can also edit").
