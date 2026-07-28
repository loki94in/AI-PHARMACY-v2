# Storage Path & UI Gaps Audit — AI Pharmacy v2

> **Read-only audit. No code was changed while producing this document.**
> Scope: (1) where the app's data actually lives on disk in dev vs. the packaged `.exe`, whether it can silently fall back to an old/stale location; (2) small UI "mixup" bugs — cases where a label, filter, or count is wired to the wrong field. Existing legacy-path risks already catalogued in `docs/COMPLETE_APP_PAGE_AUDIT_DIRECTORY.md` and `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` are cross-referenced, not repeated in full, plus one new item they missed.
>
> For every finding: **what a user would see**, and **the exact code cause**. Fix direction is stated but nothing has been implemented — this is the planning input for that next step.

---

## Executive Summary

| # | Area | Severity | Issue | User-visible effect |
|---|------|----------|-------|----------------------|
| 1 | EXE storage location | 🔴 Critical | Live database is installed and written **inside `C:\Program Files\...`** | Writes can silently fail or get redirected to a hidden per-user shadow copy depending on the Windows account running the app |
| 2 | EXE storage location | 🔴 Critical | `getAppDataDir()` path-resolution logic has changed **three times** in this project's history with no "check the old location too" migration step | Data saved under an older build's path resolution becomes invisible to a newer build — looks exactly like "migration failed" / "data disappeared" |
| 3 | EXE packaging | 🟠 High | Auto-open-browser check still tests `process.pkg`, a flag the project's *current* packaging method (Node SEA) never sets | Double-clicking the installed app does nothing visible — no window, no browser — looks like the app didn't start |
| 4 | Investigation page | 🔴 Critical (data loss) | Saving a corrected purchase bill silently strips GST% and cash-discount fields | Every purchase bill "corrected" through this screen permanently loses its tax breakdown |
| 5 | Learning page | 🟠 High | "Intelligent Suggestions" stats and WhatsApp/Telegram "ACTIVE" status are hardcoded / non-live | Dashboard-like numbers never change; a service can show "ACTIVE" while actually disconnected |
| 6 | PharmarackCart | 🟡 Medium | Two different "missing phone" checks disagree; a promised auto-retry countdown never renders | A distributor can be simultaneously "fine" and "flagged" depending which tab you're on |
| 7 | Returns page | 🟡 Medium | Min/Max Amount filter is fully wired end-to-end but has **no input control** | Filter logic, cache keys, and a "Clear filters" button all exist for a filter nobody can ever set |
| 8 | PurchaseHistory | 🟡 Medium | Search placeholder promises matches the query can't perform; summary cards undercount after scrolling | Searching by product name or purchase ID silently returns nothing; totals look smaller than reality |
| 9 | Orders, Inventory, Migration | 🟡 Medium | Silent 100-row cap, blank export column, fake row-count badge | Old requests vanish past #100; CSV/PDF export always has an empty "Packs" column; upload screen always claims "(5 rows)" |

---

## 1. EXE Storage Location (the main ask)

### 1.1 The live database is installed and written inside `Program Files`

**Where:** `installer.iss:36` (`DefaultDirName={autopf}\{#MyAppName}` — `{autopf}` = `C:\Program Files`), `installer.iss:93` (seed `data\app.db` copied to `{app}\data`), `src/config/index.ts:93` (`dbPath` = `path.join(appDataDir, 'data', 'app.db')`), `src/config/index.ts:36` (`appDataDir` under a packaged exe = `path.dirname(process.execPath)`, i.e. the exe's own install folder).

**Cause:** The installer defaults to installing into `Program Files` and requests admin rights *for the install itself* (`installer.iss:50`, `PrivilegesRequired=admin`). But nothing in `[Icons]`/`[Registry]` requests elevation for *launching* the app afterward — the desktop shortcut, Start Menu entry, and the Windows-startup registry entry (`installer.iss:116-125`) all launch `PharmacyOS.exe` as a normal, non-elevated process. The `[Dirs]` section (`installer.iss:144-146`) creates `{app}\data` and `{app}\uploads` with no `Permissions:` override, so they keep the default restrictive Windows ACL on `Program Files` (standard users get read+execute, not write).

**Resulting error in the application:**
- The *very first* launch, immediately after install, runs with the installer's inherited elevated token (Inno Setup's `[Run]` "postinstall" entry), so it appears to work.
- Every subsequent launch — desktop icon, Start Menu, auto-start on boot — runs as a standard user token even on an admin account (this is exactly what UAC does for a non-manifested exe). Writes to `data\app.db`, its `-wal`/`-shm` files, `backup\snapshots\*.db.gz`, and `self_healing.log` (all resolved from the same `getAppDataDir()`, see `src/database/connection.ts:12,226,253` and `src/services/backupRecoveryService.ts:15`) either:
  - fail outright with a permission error the user never sees a clear message for, or
  - get silently redirected by Windows' legacy UAC folder virtualization to a **hidden per-user shadow copy** at `%LOCALAPPDATA%\VirtualStore\Program Files\AI Pharmacy OS\data\app.db` — invisible unless you know to look there.
- Because virtualization is **per Windows user account**, two different Windows logins on the same PC running the same installed app can end up looking at two completely different databases, with neither being the one sitting in the visible `Program Files` folder.
- On uninstall, `installer.iss:217-230` wipes `{app}\data` and `{app}\uploads` unconditionally. If the real data had drifted into a VirtualStore shadow copy, this delete misses it entirely (orphaned data survives uninstall); if writes were just failing outright, this delete is deleting nothing but the untouched seed database.

**This is very likely the underlying cause of the recurring "data disappeared after using the exe" / "migration succeeded but the table is empty" reports from earlier sessions** — those were investigated as backend/migration logic bugs; this finding suggests at least some of them may actually be a Windows file-permission/virtualization issue that has nothing to do with the migration code itself.

**Fix direction (not applied):** Store the live database, uploads, backups, and logs under a proper per-user-writable OS location — `%LOCALAPPDATA%\AI Pharmacy OS\` (via `process.env.LOCALAPPDATA`, which this codebase already reads elsewhere for locating Chrome/Edge, e.g. `src/routes/pharmarack.ts:27`) — decoupled entirely from wherever the `.exe` itself is installed. `getAppDataDir()` in `src/config/index.ts` is the single choke point that would need to change; everything else already reads through `config.dbPath` / `config.uploadDir` / `config.backupDir`, so callers wouldn't need to change.

### 1.2 Path resolution has changed shape three times, with no fallback to the old location

**Where:** `git log --follow -- src/config/index.ts` shows three distinct resolution strategies:
1. **Up to Jul 11:** `dbPath = path.join(__dirname, '..', 'data', 'app.db')` — relative to the compiled JS file only.
2. **Jul 11 onward:** introduced `getAppDataDir()`; packaged mode used `process.pkg`-based detection (the project's original packager, vercel/`pkg`); dev mode walked up from `__dirname` to the *first* folder containing any `package.json`.
3. **Latest commit (`config/index.ts`, "full POS system" commit):** added real Node SEA detection (`isNodeSea()` via `node:sea`, since the project switched packagers from `pkg` to SEA — see the comment at the top of `scripts/buildSea.cjs`), and tightened the dev-mode walk-up to require `package.json`'s `name` field to equal `"ai-pharmacy"` specifically (previously it would stop at *any* `package.json`, which could be wrong on some machines).

**Resulting error in the application:** None of these transitions include a "does data already exist at the *previous* resolution's path? If so, use/copy that" check. Anyone who ran a build from before the SEA-detection fix — including, plausibly, an earlier build of the installer produced earlier the same day this fix landed — could have data sitting under a path the *current* `getAppDataDir()` no longer resolves to, with no code anywhere that notices or migrates it. From the user's side this presents identically to a fresh, empty install.

**Fix direction (not applied):** Before treating a `getAppDataDir()`-resolved DB as "fresh" (i.e. the file doesn't exist yet), check one or two well-known previous candidate locations (e.g. relative to `process.cwd()`, or the SEA executable's directory computed the old way) and offer to import/copy from there if found, similar in spirit to the existing corrupt-DB self-healing already in `runSelfHealing()` (`src/database/connection.ts:218-330`).

### 1.3 Auto-open-browser never fires in the shipped exe

**Where:** `src/server.ts:312` — `if ((process as any).pkg || process.env.AUTO_OPEN_BROWSER === 'true') { ...open browser... }`.

**Cause:** Same packaging-migration leftover as above: `process.pkg` is a `pkg`-only global. The project no longer uses `pkg` (see `scripts/buildSea.cjs` header comment — SEA was adopted specifically because `pkg` can't run this codebase's dynamic imports). Node SEA never sets `process.pkg`, and `AUTO_OPEN_BROWSER` is not set anywhere in the repo — not in `.env.example`, not in `installer.iss`. Confirmed via repo-wide search: the only two references to `AUTO_OPEN_BROWSER` are this check and its bundled copy in `dist-pkg/server.cjs`.

**Resulting error in the application:** The condition is permanently `false` in the real, distributed app. Double-clicking the "AI Pharmacy OS" desktop icon or Start Menu entry (`installer.iss:116,119` — both point straight at `PharmacyOS.exe`, not the separate "Open in Browser" shortcut at line 117) starts the server with no visible window and no browser tab — from the user's perspective, nothing happens. The user must separately know to click the "Open in Browser" Start Menu item or manually type `http://localhost:5174`.

**Fix direction (not applied):** Either set `AUTO_OPEN_BROWSER=true` in `.env.example` (simplest — the check already supports it), or replace the `process.pkg` half of the condition with the same `isPackagedApp()` helper already exported from `src/config/index.ts`.

### 1.4 Other stale `process.pkg` checks (lower risk, verified not currently harmful)

**Where:** `src/database/connection.ts:105` and `src/process/processGuardian.ts:45` both compute `isProductionOrPkg = NODE_ENV === 'production' || typeof process.pkg !== 'undefined'`, gating (respectively) the background DB integrity self-check/auto-restore, and the crash-log-to-DB + clean-exit-on-uncaught-exception safety net.

**Verified:** `.env.example:2` sets `NODE_ENV=production`, and that file is copied to `.env` on first install (`installer.iss:90`, `onlyifdoesntexist`) and never overwritten again on updates. So today, both safety nets **are** active in the shipped app — the dead `process.pkg` half doesn't currently cause a live failure, because the `NODE_ENV` half already satisfies the condition. Flagging this only because: (a) it's the same root pattern as 1.3 above, worth fixing in the same pass, and (b) since `.env` is never rewritten on update (`onlyifdoesntexist`), any *future* change to this default won't reach already-installed machines — worth knowing before relying on changing `.env.example` again.

---

## 2. Legacy Path / Old-Storage Fallback Risks

The two existing audit files already document several live "app reads from an old/duplicate location" risks in detail. Verified still present in the current source, summarized here rather than repeated in full — see the linked files for complete detail:

| Feature | Authoritative location | Old/duplicate location still active | Source |
|---|---|---|---|
| Delivery boy WhatsApp number | `/dispatch` → `delivery_boys` table | `Learning/index.tsx` still renders inputs saving into `app_settings.delivery_boy_whatsapp`; `PharmarackCart` falls back to reading `app_settings.dinesh_whatsapp_number` | `PROJECT_PAGE_AUDIT_DIRECTORY.md` §13, §16 |
| Pharmarack credentials | Saved via `/learning` | `Settings/index.tsx:696-699` hard-codes empty strings for username/password on every Settings save, wiping whatever Learning had saved | `COMPLETE_APP_PAGE_AUDIT_DIRECTORY.md` §2 in table |
| Special shortage orders | `/orders` → `special_orders` table | `shortageReminderService.ts` background job reads a **different** table, `pending_shortage_requests` — two tables tracking the same concept, never reconciled | Both docs, "Table Duality" |
| Gmail app password | Set in `/learning` | `Settings/index.tsx` reads `gmail_pass` into local state and drops it when saving Settings | Both docs |

**New item neither existing doc calls out explicitly:** `src/routes/v1/sales.ts` (a full parallel 15-endpoint copy of the sales API) is **confirmed not mounted** — verified directly against every `app.use('/api/...')` line in `src/server.ts` (lines 146-200): there is no `/api/v1` or `routes/v1` mount anywhere. This one is genuinely inert dead code, not a live "collects data from the wrong place" risk — safe to delete whenever convenient, no functional urgency.

---

## 3. Small UI Mixup Gaps

Same "label/filter says one thing, code does another" class of bug as the Sells-page Bill Amount / Final Amount mixup already fixed this session. Found by full-file review of every page component.

### 3.1 Investigation — purchase-bill correction silently strips GST and discount (data loss)
**Where:** `frontend/src/pages/Investigation/index.tsx:422-445` (`handleStartPurchaseBillEdit`), `:454-456` (`calculateRecalculatedTotal`, purchase branch) vs. `src/routes/investigation.ts:1074-1088` (save handler).
**Symptom:** The "Correcting Purchase Bill" workspace shows no GST line and its "Net Amount" is numerically identical to "Subtotal" — unlike the parallel "Correcting Sales Invoice" workspace a few hundred lines away, which correctly shows a "GST / Taxes (5%)" line.
**Cause:** `handleStartPurchaseBillEdit` never copies `cgst_per`/`sgst_per`/`cd_per`/`cd_rs` onto the editable item state, and the recompute function's purchase branch never adds tax back in. This isn't just a missing display line — the backend save handler deletes and reinserts `purchase_items` without those fields and overwrites `purchases.total_amount` with the tax-free sum. **Every purchase bill corrected through this screen permanently loses its GST and discount breakdown on save.**

### 3.2 Learning — hardcoded fake statistics and premature connection status
**Where:** `frontend/src/pages/Learning/index.tsx:956-978` (stats card), `:1519-1522` and `:1618-1621` (WhatsApp Web / Telegram status) vs. `:1829-1844` (Gmail, done correctly).
**Symptom:** The "Intelligent Suggestions Statistics" card always shows "842 Active OCR Corrections", "157 Learned Rx Combos", and "Last Model Retraining Date: Today, 21:40" — for every pharmacy, forever. Separately, flipping the WhatsApp Web or Telegram "Enable" toggle immediately shows a green "ACTIVE"/"BOT LISTENING" badge even before the QR code is scanned or while actually disconnected.
**Cause:** The stats are literal hardcoded JSX strings, not bound to any query. The status badges are derived from the `*_enabled` boolean alone rather than the real connection state (`waStatus.isReady`/`waStatus.qrUrl`), unlike the Gmail panel in the same file which correctly branches on real auth status.

### 3.3 PharmarackCart — three separate mixups
1. **Conflicting "missing phone" logic** (sidebar tab, `:2415-2423` vs. sticky cart-filter tab, `:659-661`/`:620-645`): the sidebar checks `customDistributorPhones` → saved-match only, with strict phone-format validation; the sticky bar checks `distributorMappings` first and accepts any non-empty string. A distributor can show as "fine" in one and "flagged" in the other simultaneously.
2. **Dead retry countdown**: the WhatsApp batch-send button's tooltip and label (`:2012`, `:2020-2021`) promise "Next send in Ns…" pacing, but `batchCountdownSec` (declared `:523`) is only ever set to `null` — never to an actual number — so that branch can never render.
3. **Tab badges ignore the active filter** (`:2061,2071`): "Req (N)" / "Refills (N)" counts the full list, while the "Show Added" toggle (default off) hides already-cart-matched rows underneath — so the badge count and visible row count routinely disagree.

### 3.4 Returns — Min/Max Amount filter is fully wired but has no way to trigger it
**Where:** state at `:374-375`, sent to backend `:385-386`, used in cache key `:378`, referenced by "Clear filters" visibility `:913`, applied to the list `:927-938` — but a full read of the 1614-line file found **no `<input>` anywhere** that calls `setMinAmount`/`setMaxAmount`. Only date-range inputs and a distributor `<select>` exist next to "Clear filters".
**Symptom:** None visible — this is inert, not actively wrong, but represents either a removed input that left its plumbing behind, or a control that was never finished.

### 3.5 Orders — silent 100-row cap with no indication older requests exist
**Where:** `frontend/src/pages/Orders/index.tsx:46-52` (`api.getOrders().then(data => data.slice(0, 100))`) vs. `:998-1001,1051` (pager text, "Total Requests" footer) vs. `src/routes/orders.ts:88` (backend returns the full unfiltered set).
**Symptom:** Search, status tabs, date filters, the pager, and the "Total Requests" footer all silently operate on only the 100 most-recent special orders once that threshold is crossed, with nothing telling the user older records are being excluded.

### 3.6 Inventory — CSV/PDF export always has a blank "Packs" column
**Where:** export column defined as `{ key: 'quantity', label: 'Packs' }` (`:119`) vs. the on-screen cell correctly reading `item.stock_quantity` (`:572-574`) — `InventoryItem` has no `quantity` field (`frontend/src/types/api.ts:53`), and the export util reads `item[c.key]` directly (`frontend/src/utils/export.ts:17-18,58-59`).
**Symptom:** The on-screen table shows correct stock counts; every exported CSV/PDF has that column permanently empty.

### 3.7 PurchaseHistory — search promises fields it can't match; totals undercount after clearing filters
**Where:** placeholder "Search by order ID, invoice number, or product name..." (`:367`) vs. backend query only matching `invoice_no`/distributor name (`src/routes/purchases.ts:623-627`) — no purchase ID, no product-name join at all. Separately, the summary cards (`:281-283,349-358`) compute from only the client-loaded batch (`items.length`/`items.reduce`) rather than the server-reported `totalItems` that the scroll-status bar directly below already uses correctly (`:616`).
**Symptom:** Searching by product name or a numeric order ID — both explicitly invited by the placeholder — returns nothing even when matches exist. After clearing the date filter, the three summary cards can show noticeably smaller totals than the real numbers shown just below them.

### 3.8 Migration — upload screen always claims "(5 rows)"
**Where:** `frontend/src/pages/Migration/components/ReviewModal.tsx:292` passes `totalRows={fileEntry.samples.length} // placeholder total rows` (comment is the developer's own admission) vs. `src/routes/migration.ts:175` hard-capping `samples: samples.slice(0, 5)`.
**Symptom:** The column-mapping screen header (e.g. "🛒 Purchases (N rows)") shows "(5 rows)" regardless of the uploaded file's actual size — it's reporting the preview-sample cap, not the real row count.

### 3.9 Purchases — dead "Edit Purchase" modal
**Where:** `frontend/src/pages/Purchases/index.tsx:802,3033-3099` — a fully built modal wired to `PUT /purchases/:id` that can never open because `setEditingPurchase` is never called with a non-null value anywhere in the file.

### Pages checked with no findings of this class
Dashboard, CustomerReturnHistory, POS, Reports, CRM, Mail, Settings, License, Dispatch, CompositionQueue, PhoneSales, Database, NonMappedDistributors — each fully read; table headers, export column lists, filter bindings, and status badges all matched the fields they claim to show.

---

## Suggested Priority Order For The Implementation Pass

1. **§1.1/1.2 — storage location.** Highest blast radius: affects every table, every backup, every day the app runs as the packaged exe. Move `getAppDataDir()` off `Program Files` entirely.
2. **§3.1 — Investigation GST/discount loss.** Active data-loss bug, not just a display glitch.
3. **§1.3 — auto-open-browser.** One-line fix, directly explains "app doesn't seem to start."
4. **§3.2, 3.3, 3.6, 3.7, 3.8 — UI mixups**, roughly in the order listed (fake stats and mismatched missing-phone logic before cosmetic export/label issues).
5. **§3.4, 3.9 — dead code cleanup** (unused filter plumbing, unreachable modal) — low urgency, safe to batch with whatever else touches those files.
6. **§2 / v1 route deletion** — no functional urgency, housekeeping only.
