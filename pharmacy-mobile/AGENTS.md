# Expo Mobile Application (pharmacy-mobile/)

This directory contains the React Native Expo mobile application.

## Scope & Responsibilities
- **Expo Framework**: Versioned docs at https://docs.expo.dev/versions/v56.0.0/ should be read before writing code.
- **Mobile Pages & Components**: Located in `app/` and `components/`.

## Development Rules
- Run `node scripts/quick-update.mjs` at the project root after adding or updating mobile components.
- **Interactive Chat Feeds**: Search result list items are rendered vertically inside chat bubbles, featuring manual quantity steppers (input and +/- buttons) and a dedicated "Add" button to populate the `BillingScreen` cart via the `lib/cartEvents.ts` event bus.

## API Layer Architecture (refactored 2026-08)

`lib/api.ts` is a pure re-export BARREL over domain modules in `lib/api/`. Screens must keep importing from `'../../../lib/api'` only — never deep-import `lib/api/<module>`. Add new endpoints to the matching domain file:

| Module | Owns |
|---|---|
| `api/client.ts` | server URL store, `request()`, health tests, subnet auto-discovery |
| `api/inventory.ts` | inventory cache, `SearchMedicineResult`, `parsePackSize`, `/inventory` calls |
| `api/sales.ts` | search-medicine, sale queue, `createSale`, recent sales |
| `api/purchases.ts` | purchase list + offline purchase queue |
| `api/gmail.ts` | Google OAuth sync, Gmail REST, direct send, disconnect |
| `api/orders.ts` | special orders CRUD/list/status + order-status offline queue |
| `api/refills.ts` | full refill management endpoints |
| `api/scanBill.ts` | AI camera OCR + bill photo queue + scanned drafts |
| `api/admin.ts` | admin login/mode + stock override + stock queue |
| `api/notifications.ts` | push token, saved alerts, WhatsApp/email fallback tasks |
| `api/sync.ts` | `syncOfflineSalesAndRefresh()` engine ONLY |
| `api/misc.ts` | dashboard/reports/trace/backup/pharmarack/customers |

Shared non-API helpers live in `lib/helpers.ts` (`sanitizePhoneInput`, `formatDateIN`) — do not redefine them inside screens. Stock-status colors come from `lib/stock.ts`.

## Multi-Device Registry Contract (added 2026-08)

- **Stable identity**: every phone sends its SecureStore `admin_device_uuid` as `device_uuid` in `registerPushToken()` AND as the `x-device-id` header. The PC upserts `push_tokens` by `device_uuid` (column lazily ensured via PRAGMA in `src/routes/notifications.ts`), so Expo-token rotation no longer spawns duplicate devices.
- **Devices screen** (`app/devices/index.tsx`, linked from More): lists ALL registered devices for everyone — OS icon (logo-android/logo-apple), online dot (40s rule), "last seen" from `offline_seconds`, own-device chip; only YOUR row is renamable (`PATCH /notifications/devices/:token/rename`). Connection history from `/notifications/devices/logs` with clear action.
- **Block/Unblock**: any device row offers Block/Unblock (`PUT /notifications/devices/:token/block` → `is_blocked` flag on push_tokens, lazily ensured). Blocked uuids get **403 at registration** (throttled admin toast, 5-min map) and show a red BLOCKED chip; unblock allows the next ping through. SSE `device_block_change` fires toasts on all devices. Revoke (DELETE) is separate: permanent registry removal.
- **Live alerts**: root `_layout.tsx` SSE XHR parser consumes `device_status_change` frames → animated toast + saved to Notification History for BOTH connected and disconnected transitions of ANY device. Do not add polling for this — the single existing stream is the feed.
- Backend `bg.deviceMonitor` defaults to `auto` (10s active / 2min idle) to emit disconnect transitions after server restart.

## Offline-First & Auto-Sync Contract (added 2026-08)

1. **Instant reconnect drain**: `app/_layout.tsx` registers a single `@react-native-community/netinfo` listener. Any network reconnect triggers an immediate health-check + `syncOfflineSalesAndRefresh()` — do not add extra polling intervals elsewhere. The one 15s interval in root layout is the only safety-net poll.
2. **Queues replayed by sync** (all in `lib/api.ts`, AsyncStorage-backed): `offline_sales_queue` → POST /sales/sync, `offline_purchases_queue` → /purchases/sync, `offline_stock_updates` → /inventory/sync, `offline_special_orders_queue` → POST /orders, `offline_order_status_queue` → POST /orders/:id/status, `offline_bill_photos_queue` → OCR upload → saved as scanned drafts. Failed items stay queued with warnings surfaced via toast; never silently dropped.
3. **No invented business data**: offline temp invoices compute GST from each medicine's real `cgst_per`/`sgst_per` carried in the cached inventory (backend `/inventory` exposes them). Never hardcode tax rates, phone numbers, or item names.

## Billing Screen Contracts (added 2026-08)

- **Product List panel** (`components/ProductListPanel.tsx`): left slide-over with two segments. Products = shopping-list of grouped cached inventory with shared stock colors from `lib/stock.ts` (`stockLevel`: ≤0 red, <10 amber, <30 yellow, else green — same thresholds as desktop Inventory). Pending = active special orders (`ACTIVE_ORDER_STATUSES`) with status chips and a **Mark Ready** action that calls `updateOrderStatus(id,'Ready')`; the PC backend queues the arrival WhatsApp inside that same request when online (toast must reflect the real `whatsapp_queued` result) or replays it after reconnect when offline. Manual user click only — no background sender exists on the phone.
- **Cart persistence**: billing cart/mode/customer/discount auto-save to `billing_cart_state` guarded by `hydratedRef`; restored on mount so an app kill never loses a half-built bill.
- **Swipe-to-delete**: every cart row (collapsed strip & expanded card) is wrapped in `components/SwipeToDelete.tsx` — core PanResponder, horizontal-locked, NO native gesture-handler dependency (do not add react-native-gesture-handler just for this). Steppers are ≥40px touch targets with 16pt qty text for fast billing.
- **Credit sales require customer name + valid 10-digit phone** (validated before submit).
- **Refill Sell Now hand-off**: Refills tab writes `SearchMedicineResult[]` to the `billing_cart_add_queue` AsyncStorage key; Billing drains it in a `useFocusEffect`. Keep this key contract if either screen is refactored.

## Inventory Cache Contract

- `getInventory()` fetches `/inventory?limit=0` (full list) for cache building, tolerates both `{data:[...]}` and array responses, and maps MRP/GST/pack_size into `SearchMedicineResult`. The Product List panel, batch pickers, and offline search all read this cache — keep it complete and current.

## Purchase Bill Scanning Contract (added 2026-08)

- Purchases screen "Scan Paper Bill" captures a photo and uploads it to `POST /purchases/upload` (multipart FormData supported by `request()`); the backend's image branch runs real OCR and returns `{distributor_name, invoice_no, invoice_date, total_amount, data:[...]}`.
- Parsed results are ALWAYS stored as reviewable drafts (`scanned_bill_drafts`) and become a purchase only after the user edits/confirms in the Review modal → `queueOfflinePurchase` → PC staged approvals. No inventory record is ever created without that human step.
- Photos captured while the PC is off are copied into `FileSystem.cacheDirectory` and queued; `replayPendingBillPhotos()` runs as part of reconnect sync and notifies nothing automatically — drafts simply appear for review.
