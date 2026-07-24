# AI PHARMACY v2 — Feature → Page Registry (Canonical)

> **This file is the single source of truth for where each feature lives *right now*.**
>
> **Before editing any feature listed below, edit it in its _Current page_ only.**
> The **Old location** column lists deprecated leftovers. Code may still exist there — that does **not** mean it is the active path. Do not add, wire, or "restore" features into an Old location.

**Date:** 2026-07-24 (Updated after fix pass)
**Companion doc:** [`AUDIT-STRUCTURE-DRIFT-REPORT.md`](./AUDIT-STRUCTURE-DRIFT-REPORT.md) — the evidence and severity behind every row here.
**Status:** documentation only. No code has been changed.

---

## Table 1 — Feature ownership

Legend for **Drift**: 🔴 active conflict · 🟠 duplicate/stale path present · 🟢 clean single owner

| # | Feature | ✅ Current page (route) | ⛔ Old / legacy location(s) | Storage key(s) | Backend route | Drift |
|---|---|---|---|---|---|---|
| 1 | **Delivery-boy contact (name + WhatsApp number)** — *the "delivery voice number"* | **Dispatch** `/dispatch` → `Dispatch/index.tsx` | **Learning** & **Settings** & **PharmarackCart** legacy fallbacks removed; 100% routed to `/dispatch` | `delivery_boys` table | `GET/POST /api/dispatch/delivery-boys` | 🟢 |
| 2 | **Gmail credentials (user + password)** | **Learning** `/learning` Ingestion tab → `Learning/index.tsx:1811-1850` | **Settings** reads `gmail_pass` into state (`Settings/index.tsx:429`) but **never saves it** — password silently dropped | `gmail_user`, `gmail_pass`, `gmail_auth_method` | `POST /api/settings/save`; OAuth writes in `email.ts:362-378`; wipe in `settings.ts:304-325` | 🔴 |
| 3 | **Pharmarack credentials / mode** | **Pharmarack Cart** `/pharmarack-cart` & **Learning** Operations tab | **Settings** state hydration fixed & protected from empty overwrite | `pharmarack_username`, `pharmarack_password`, `pharmarack_session_token`, `pharmarack_mode` | `POST /api/settings/save`; `src/routes/pharmarack.ts` | 🟢 |
| 4 | **IMAP host / port / TLS** | **Learning** Ingestion tab | *(none — never lived in Settings)* | `imap_host`, `imap_port`, `imap_tls` | `POST /api/settings/save` | 🟢 |
| 5 | **WhatsApp auto-share to admin** | **Learning** `Learning/index.tsx:2108-2114` | *(none)* | `wa_auto_share_admin` | `POST /api/settings/save` | 🟢 |
| 6 | **Telegram bot config** | **Learning** `Learning/index.tsx` | **Settings** edits same keys | `telegram_enabled`, `telegram_token`, `telegram_chat_id` | `POST /api/settings/save` → hot-reload `settings.ts:145-153` | 🟠 |
| 7 | **WhatsApp Business API config** | **Settings** & **Learning** | Both save synced with credential protection | `wa_business_enabled`, `wa_business_phone_number_id`, `wa_business_access_token`, `wa_business_waba_id`, `wa_business_webhook_verify_token` | `POST /api/settings/save`; `/api/wa-business` | 🟢 |
| 8 | **WhatsApp enable / preferred system** | **Ambiguous** | Settings (`:552,560`) + Learning; also auto-set by `messaging.ts:143` | `whatsapp_enabled`, `whatsapp_preferred_system` | `POST /api/settings/save` → hot-reload `settings.ts:154+` | 🔴 |
| 9 | **Automation master toggle** | **Ambiguous** | Settings checkbox (`:521`) + Learning toggle | `automation_enabled` | `POST /api/settings/save`; read by `server.ts:273,494,536,558` | 🟠 |
| 10 | **Bounced-alerts WhatsApp number ("Dinesh")** — *not the delivery number* | **Settings** `Settings/index.tsx:1162-1173` | *(none)* | `dinesh_whatsapp_number` | `POST /api/settings/save` | 🟢 |
| 11 | **Google API client credentials** | **Settings** (`:515-516`) | *(none)* — env fallback injected at `settings.ts:28-33` | `google_client_id`, `google_client_secret` | `POST /api/settings/save` | 🟢 |
| 12 | **Admin device authorization** | **Settings** (`:526-527`) | *(none)* — also written by `security.ts:70-71,94-95` | `admin_authorized_device_id`, `admin_authorized_device_name` | `/api/security/*` | 🟠 |
| 13 | **Data-fetch control modes** | **Settings** (`:567,594-597`) | *(none)* — mirrored to `localStorage` | `data_fetch_control` | `POST /api/settings/save` | 🟢 |
| 14 | **Refill notice window** | **CRM** `/crm?tab=refills` (written from the old AutomationCenter code, `AutomationCenter/index.tsx:60`) | *(page superseded — see Table 2)* | `refill_notice_days` | `POST /api/settings/save`; read `refills.ts:246` | 🟢 |
| 15 | **Delivery-boy CRUD (full records)** | **Learning** `/learning?tab=dispatch` | Standalone `pages/Dispatch/index.tsx` — **never mounted** | `delivery_boys` table | `/api/dispatch/delivery-boys` | 🟠 |

---

## Table 2 — Route consolidation map (old route → current home)

These 9 standalone pages were folded into tabs. **The old page files still exist on disk but are no longer imported or prefetched** — `pageImports.ts` was cleaned to include only the 20 mounted pages. Always work in the *Current home* column.

| ⛔ Old route | ✅ Current home | Redirect defined at | Dead file still on disk |
|---|---|---|---|
| `/expiry` | `/returns?tab=expiry` | `App.tsx:87` | `pages/Expiry/index.tsx` |
| `/customer-returns` | `/returns?tab=customer` | `App.tsx:113` | `pages/CustomerReturn/index.tsx` |
| `/customer-returns-history` | `/returns?tab=customer-history` | `App.tsx:114` | `pages/CustomerReturnHistory/index.tsx` |
| `/doctors` | `/learning?tab=doctors` | `App.tsx:103` | `pages/Doctors/index.tsx` |
| `/dispatch` | `/learning?tab=dispatch` | `App.tsx:104` | `pages/Dispatch/index.tsx` |
| `/catalog` | `/database?tab=catalog` | `App.tsx:109` | `pages/CatalogUpload/index.tsx` |
| `/automation-center` | `/crm?tab=messages` | `App.tsx:97` | `pages/AutomationCenter/index.tsx` |
| `/refills` | `/crm?tab=refills` | `App.tsx:98` | `pages/Refills/index.tsx` |
| `/non-mapped-distributors` | `/pharmarack-cart?tab=non-mapped` | `App.tsx:101` | `pages/NonMappedDistributors/index.tsx` |
| `/message-listener` | `/dashboard` (feature removed) | `App.tsx:100` | *page deleted; stale mapping at `pageImports.ts:31`* |

---

## Table 3 — Pages that are the real, mounted homes

The 25 routes React Router actually mounts (`App.tsx:82-121`). Anything not on this list is not a live page.

`/dashboard` · `/inventory` · `/returns` · `/pos` · `/sells` · `/phone-sales` · `/investigation` · `/purchases` · `/manual-purchase` · `/purchase-history` · `/crm` · `/orders` · `/pharmarack-cart` · `/migration` · `/reports` · `/license` · `/settings` · `/mail` · `/learning` · `/database` · `/composition-queue` *(plus `/` → `/pos`)*

---

## Rules of thumb for future work

1. **Config fields belong to the Learning page**, not Settings — Settings is the legacy hub. The only config that genuinely still lives in Settings is rows 10-13 above.
2. **Never re-add a moved field to its Old location** just because a type/interface/state variable is still sitting there (e.g. `interface DeliveryBoy` in Settings). Leftover declarations are not ownership.
3. **All config flows through one firehose** — `POST /api/settings/save` upserts every key it is handed into `app_settings` (`settings.ts:71-80`), and `GET /api/settings` hands every key to every screen. Adding a field to a second screen therefore creates an immediate last-writer-wins conflict.
4. **Do not use `POST /api/settings`** (single-key) — it writes to a nonexistent `settings` table (`settings.ts:62`). Use `/settings/save`.
5. **Before adding a "new" page**, check Table 2 — the feature may already exist as a tab.
