# AI PHARMACY v2 — Structure / Drift / Dead-Code Audit

**Type:** Read-only audit. **Nothing in this report has been fixed** — every item is *documented only*.
**Date:** 2026-07-24
**Scope:** Which features are built but unused, which moved between pages (old-path vs new-path drift), broken wiring, and small structural gaps.
**Companion doc:** [`FEATURE-PAGE-REGISTRY.md`](./FEATURE-PAGE-REGISTRY.md) — the canonical "which page owns which feature *now*" source of truth.
**Not covered here:** crash / error-handling risks — see the existing `AUDIT-CRASH-RISK-REPORT.md`.

---

## How to read this

Each finding shows `file:line` evidence, the **Current vs Old/Intended** state, and a severity:

- 🔴 **High** — active bug or data-loss / user confusion happening today.
- 🟠 **Medium** — real drift/dead-weight that will cause a wrong edit or wasted work.
- 🟡 **Low** — leftover / cosmetic / latent.

> **Root cause behind most of Parts B & D:** every config screen loads from `GET /api/settings` (which returns *all* keys) and saves through `POST /api/settings/save`, which blindly upserts every key it receives into the single `app_settings` table (`src/routes/settings.ts:71-80`). There is no per-field ownership, so **whichever screen saves last wins.**

---

## Part A — Page inventory & per-page gap (34 pages)

The app has 34 page folders under `frontend/src/pages/`, but the router (`frontend/src/App.tsx:82-121`) only mounts **25**; the other 9 are redirected into tabs (see Part C.1). High-signal gaps per page:

| Page (route) | Owns | Notable gap |
|---|---|---|
| POS (`/pos`) | Point-of-sale, cart, AI camera learn | Calls several `apiClient.*` directly, bypassing `api.ts` wrappers (feeds the dead-wrapper count, C.6) |
| Settings (`/settings`) | **Legacy config hub** | Holds *stale duplicates* of Learning's config; **destructively** clears Pharmarack creds on save (B.3); silently drops `gmail_pass` (D.3) |
| Learning (`/learning`) | **Current config hub** + AI learning | Delivery-boy contact form is **duplicated twice** inside this same page (B.4) |
| CRM (`/crm`) | Credit customers, WhatsApp chat, refills | Absorbs the old AutomationCenter + Refills pages as tabs |
| Returns (`/returns`) | Supplier returns | Absorbs Expiry + CustomerReturn + CustomerReturnHistory as tabs |
| Database (`/database`) | Medicine master | Absorbs CatalogUpload as a tab |
| PharmarackCart (`/pharmarack-cart`) | Pharmarack cart / notify | Absorbs NonMappedDistributors as a tab; calls `PUT /distributors/:id` which 404s (E.1) |
| Migration (`/migration`) | Legacy data import | Large "V2" API surface referenced in `api.ts` doesn't exist on backend (E.3) |
| Dispatch, Doctors, Expiry, CatalogUpload, CustomerReturn, CustomerReturnHistory, NonMappedDistributors, AutomationCenter, Refills | (superseded) | **Files still exist and are still downloaded, but never mounted** — C.1 |

*(Remaining pages — Dashboard, Sells, Orders, PhoneSales, Purchases, PurchaseHistory, Inventory, Investigation, Mail, CompositionQueue, Reports, License — are wired normally with no structural gap of note.)*

---

## Part B — Moved features & page-path drift  *(the core concern)*

### B.1 🟠 Delivery-boy contact number — moved Settings → Learning, old stub still in Settings

- **Old location (dead leftover):** `frontend/src/pages/Settings/index.tsx:34` still declares `interface DeliveryBoy { … }`. It is the **only** delivery-boy reference left in Settings — no input, no save. *Verified:* no `delivery_boy_name` / `delivery_boy_whatsapp` anywhere else in that file.
- **Current location:** `frontend/src/pages/Learning/index.tsx` — inputs bound to `delivery_boy_name / _whatsapp / _name_2 / _whatsapp_2`.
- **Storage:** saved via `POST /settings/save`; the backend also mirrors into the `delivery_boys` table at `src/routes/settings.ts:84-141`.
- **Why it matters:** this is exactly the "app goes back to the old Settings page" symptom. The leftover stub makes it *look* like the field still lives there. → Registry row 1.

### B.2 🔴 Two full config editors over identical keys (Settings vs Learning)

Settings and Learning both render editors for **Telegram, WhatsApp Web, WhatsApp Business, Gmail/IMAP, and automation**, all writing the same `app_settings` keys through the same `/settings/save` firehose. There is **no single source of truth** — last save wins.

- Settings save payloads: `Settings/index.tsx:506-568` and `651-701`
- Learning saves: `Learning/index.tsx:281, 361, 433, 542, 681, 1890`

### B.3 🔴 Pharmarack credentials — Settings **destroys** what Learning sets

- **Current editor:** `Learning/index.tsx:2189-2216` (real username / password / session / mode inputs).
- **Conflict:** Settings' save payload **hard-codes** `pharmarack_username/password/session_token` to blanks + mode `'Live'` (`Settings/index.tsx:696-699`) and calls Pharmarack **logout** immediately after (`:705`).
- **Effect:** pressing **Save in Settings wipes the Pharmarack login the user entered in Learning.** Two UIs, one key, mutually destructive. → Registry row 3.

### B.4 🟠 Delivery-boy form duplicated *within* Learning itself

The same four keys are rendered by **two separate forms on the same page**:

- Dispatch tab — `Learning/index.tsx:1048-1083`
- Operations tab — `Learning/index.tsx:2064-2099`

Editing one does not update the other in the DOM until reload; both post identical keys. Confusing, and easy to edit the "wrong" one.

### B.5 🟡 Naming trap: `dinesh_whatsapp_number` looks like the delivery number

Settings still has a "Bounced Alerts WhatsApp Number (Dinesh)" field (`Settings/index.tsx:1162-1173`, key `dinesh_whatsapp_number`). It sits where the delivery-boy number used to be and reads like it, but it is a **different** notification-recipient number. Easy to mistake for the moved field.

---

## Part C — Built but not wired into the workflow (dead / unused)

### C.1 🟠 Nine page files exist, are downloaded, but never mounted

Their routes are `Navigate` redirects to tabs in a parent page (`frontend/src/App.tsx`). The standalone files are dead — yet **`App.tsx:63-75` prefetches *every* page chunk on a timer**, so all nine dead bundles are still shipped to the browser.

| Dead page file | Route redirect | Superseded by |
|---|---|---|
| `pages/Expiry/index.tsx` | `App.tsx:87` | `/returns?tab=expiry` |
| `pages/CustomerReturn/index.tsx` | `:113` | `/returns?tab=customer` |
| `pages/CustomerReturnHistory/index.tsx` | `:114` | `/returns?tab=customer-history` |
| `pages/Doctors/index.tsx` | `:103` | `/learning?tab=doctors` |
| `pages/Dispatch/index.tsx` | `:104` | `/learning?tab=dispatch` |
| `pages/CatalogUpload/index.tsx` | `:109` | `/database?tab=catalog` |
| `pages/AutomationCenter/index.tsx` | `:97` | `/crm?tab=messages` |
| `pages/Refills/index.tsx` | `:98` | `/crm?tab=refills` |
| `pages/NonMappedDistributors/index.tsx` | `:101` | `/pharmarack-cart?tab=non-mapped` |

→ Full map in Registry, Table 2.

### C.2 🟡 `AdminMatchPanel.tsx` — finished component, never mounted

`frontend/src/components/AdminMatchPanel.tsx:34` — a complete panel (`{ match, onClose, onSuccess }`). *Verified:* the name appears **only inside its own file**. Built-but-not-wired.

### C.3 🟠 Two backend routers defined but never mounted

*Verified:* neither is referenced anywhere in `src/server.ts`.

- `src/routes/creditNotes.ts` — full credit-note CRUD (`GET /`, `GET /pending/:distributorId`, `POST /`, `POST /apply`, `DELETE /:id`). Unreachable.
- `src/routes/v1/sales.ts` — a newer/parallel copy of the entire sales API (15 endpoints). Never wired; `server.ts:168` mounts `routes/sales.ts` instead.

### C.4 🟠 Two orphan services (zero importers)

- `src/services/customerService.ts` — `class CustomerService` + singleton; no references anywhere.
- `src/services/nNotificationService.ts` — abandoned **duplicate** of the live `src/services/notificationService.ts` (same exported singleton name `notificationService`). The real one is imported by `dispatch.ts`, `purchases.ts`, `pharmarack.ts`, `shortageReminderService.ts`; the `nN…` copy by nothing.

### C.5 🟠 Three routers mounted but never called by the web frontend

Registered in `server.ts`, but no `apiClient` / `fetch` caller exists in `frontend/src`:

- `src/routes/archive.ts` → `/api/archive` (`POST /purge`, `GET /preview`, `POST /sweep`) — image-archive maintenance, no UI.
- `src/routes/compliance.ts` → `/api/compliance` (Schedule H1 register: `GET /`, `POST /add`, `POST /add-schedule-h1`, `GET /h1-register`) — a **fully built regulatory feature with no UI surface at all.**
- `src/routes/telegramPrescription.ts` → `/api/telegram-prescription` (cart / bill flow) — likely intended for an external Telegram bot. **Verify the bot actually calls it**; if not, it is dead.

### C.6 🟡 ~78 unused wrapper methods on the `api` object

`frontend/src/services/api.ts` exports ~246 methods on `export const api`; **~78 are never called** (the object is never destructured, and each name has zero `api.<name>` references). Pages call `apiClient.*` directly instead, leaving these wrappers dead.

Representative examples: `createReturn`, `saveSettings`, `getWhatsappMessages`, `holdBill`, `triggerManualScan`, `importCatalog`, `getSalesHistory`, `getRefillsPanel`, `verifyHealth`.

*Caveat:* a handful correspond to features that exist but are hit directly; a few (snapshots, staging-conflicts, migration-rollback) may be unbuilt UI. Glance per-method before any deletion.

### C.7 🟡 Minor leftovers

- `frontend/src/lib/pageImports.ts:31` — `/message-listener` maps to `pages/Refills`, but `App.tsx:100` redirects `/message-listener` → `/dashboard`. Doubly dead (the MessageListener page was deleted).
- `frontend/src/pages/Inventory/index.tsx:7` — commented-out `// import { UniversalMedicineEditModal }`.
- `frontend/src/services/dataFetchControl.ts:298` — `export const isExternal` never used (its siblings are).

---

## Part D — Config (`app_settings`) drift & single-source-of-truth violations

### D.1 🟠 The firehose save + read-all pattern

- `GET /api/settings` returns **every** key to **every** screen (`settings.ts:17-35`).
- `POST /api/settings/save` blindly upserts every key in the body (`settings.ts:71-80`).

No screen "owns" a key → this produces the multi-owner drift in B.2 / B.3.

### D.2 🔴 `POST /api/settings` writes to the WRONG table

`src/routes/settings.ts:62` executes `INSERT OR REPLACE INTO settings (…)` — table **`settings`** — while the entire rest of the app uses **`app_settings`**. This single-key endpoint is currently unused by the frontend, so it is a **latent bug**: anything that ever calls it writes into a phantom table nothing reads.

### D.3 🔴 `gmail_pass` — Learning owns it; Settings silently drops it

- Learning is the **only** writer: input at `Learning/index.tsx:1845-1846`, saved via `/settings/save` (`:1890`).
- Settings **reads** the password into state (`Settings/index.tsx:429`) but **neither renders nor writes it back** — both save payloads include only `gmail_user` + `gmail_auth_method` (`:514,518` and `:659,662`), never `gmail_pass`.
- **Effect:** editing email config from Settings cannot set or change the password; the two screens disagree on ownership. → Registry row 2.

### D.4 🟠 Multi-owner key summary (drift surface)

| Key(s) | Written by | Drift |
|---|---|---|
| `gmail_user`, `gmail_auth_method` | Settings + Learning + `email.ts` OAuth + `/google/disconnect` | 4 writers |
| `gmail_pass` | Learning only (Settings drops it) | ownership mismatch |
| `pharmarack_*` | Learning (real) + Settings (blanks / logout) | **destructive** |
| `whatsapp_preferred_system` | Settings + `messaging.ts:143` auto-set | 2 writers |
| `admin_authorized_device_*` | Settings + `security.ts` | 2 writers |
| `telegram_*`, `wa_business_*`, `whatsapp_enabled` | Settings + Learning | last-writer-wins |

### D.5 🟡 Legacy key aliases still accepted

`src/routes/settings.ts:85-86,114` still reads the legacy aliases `delivery_boy_1_name`, `delivery_boy_phone`, `delivery_boy_2_name` — remnants of an earlier rename of the same field. Any old UI still posting them will silently diverge.

---

## Part E — Broken / stale endpoint calls (frontend → nonexistent backend)

### E.1 🔴 Prefix-drift 404s (router mounted at bare `/api`, path defined without its prefix)

| Frontend call | Backend actually serves | Result |
|---|---|---|
| `GET /medicines/online-search` (`api.ts:691`) | `/api/online-search` (`medicines.ts:359`) | 404 |
| `POST /medicines/auto-enrich` (`api.ts:692`) | `/api/auto-enrich` (`medicines.ts:388`) | 404 |
| `POST /enrichment/reference/import` (`api.ts:526`) | `/api/reference/import` (`enrichment.ts:119`) | 404 |
| `PUT /distributors/:id` (`PharmarackCart/index.tsx:1093`) | `/api/:id` (`distributors.ts:51`) | 404 |
| `GET /distributors/:id/pending-returns` (`api.ts:331`) | `/api/:id/pending-returns` (`distributors.ts:108`) | 404 |

*Inconsistency:* `GET/POST /distributors` in the same file **do** carry the prefix and work — so some calls in the same feature succeed while others 404.

### E.2 🟠 Missing endpoints (feature referenced, never implemented)

| Frontend call | Reality |
|---|---|
| `GET /sales/history` (`api.ts:295`) | no `/history` route in `sales.ts` |
| `POST /sales/hold/:id/restore` (`api.ts:299`) | no `/restore` route |
| `POST /pharmarack/notify-cart-order` (`PharmarackCart/index.tsx:874,988`) | backend has `/cart/notify-manual`, not this |
| `GET /medicines/search` (`CRM/index.tsx:232`) | no such route |

### E.3 🟡 Migration "V2" surface is stale

`api.ts` (≈ lines 360-413) references a large migration API — `analyze-zip`, `analyze-excel`, `pre-migration-simulate`, per-row staging edit/delete, staging sub-item CRUD, projects / templates / snapshots / conflicts — **none of which exist** in `src/routes/migration.ts`. Either unfinished or fully stale.

---

## Part F — Small structural gaps (quick list)

- 🔴 `settings.ts:62` — writes to table `settings`, not `app_settings` (D.2).
- 🟠 `App.tsx:63-75` — prefetches all page chunks, including the 9 dead ones (C.1).
- 🟠 `whatsappBusiness` router is double-mounted: `/api/wa-business/webhook` (`server.ts:138`) and `/api/wa-business` (`:165`) — intentional (pre-auth webhook), but worth knowing.
- 🟡 `settings.ts:85-86,114` — legacy delivery-boy key aliases (D.5).
- 🟡 `pageImports.ts:31` — dead `/message-listener` mapping (C.7).
- 🟡 `Inventory/index.tsx:7` commented import; `dataFetchControl.ts:298` unused export (C.7).

---

## Summary counts

| Category | Count |
|---|---|
| Pages that exist but are never mounted | 9 |
| Backend routers defined but unmounted | 2 (`creditNotes`, `v1/sales`) |
| Backend routers mounted but no web caller | 3 (`archive`, `compliance`, `telegram-prescription`) |
| Orphan services | 2 (`customerService`, `nNotificationService`) |
| Unused `api.ts` wrapper methods | ~78 |
| Broken / 404 frontend calls | 5 prefix-drift + 4 missing |
| Config keys with >1 writer (drift) | 6 groups (1 destructive) |
| Finished components never mounted | 1 (`AdminMatchPanel`) |

---

**Reminder:** nothing above has been changed. Before making any edit, consult [`FEATURE-PAGE-REGISTRY.md`](./FEATURE-PAGE-REGISTRY.md) to confirm the *current* home of the feature.
