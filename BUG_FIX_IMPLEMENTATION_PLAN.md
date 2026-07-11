# Bug Fix Implementation Plan — AI Pharmacy v2

**Scope:** Every independent bug found across the six subsystems (Backend API, Frontend SPA, Mobile Expo app, Desktop/Build layer, Integrations/Automation, Tests/Scripts/Data). Bugs are listed as *independent* (separate root causes) so they can be fixed in any order.

**Legend:** `P0` = ship-blocker (crash/build fail/data loss) · `P1` = major (save/edit/API failure, corruption) · `P2` = minor (UX/log/silent)

For every bug: **Where** (file:line) → **Bug** → **Cause** → **Effect** → **Fix** (concrete).

---

# 1. BACKEND API (Express / SQLite)

### 1.1 [P1] auto-enrich creates duplicate medicines — `src/routes/medicines.ts:388,401`
- **Bug:** Lookup uses `cleanName` but insert/update uses `adjustedName`; the two keys differ.
- **Cause:** `db.get('... WHERE LOWER(name)=LOWER(?)',[cleanName])` vs `INSERT ... VALUES(?,...)` with `adjustedName`. Different spellings that normalize to the same product both insert.
- **Effect:** Duplicate medicine rows → split inventory, wrong stock, duplicate suggestions.
- **Fix:** Make the lookup key and the stored value identical. Normalize once and use the same string for both SELECT and INSERT/UPDATE, e.g. `const key = adjustedName; const existing = db.get('... WHERE LOWER(name)=LOWER(?)',[key]);` then insert with `key`.

### 1.2 [P0] null deref on customer return → 500 — `src/routes/customerReturns.ts:93→108`
- **Bug:** `invInfo` can be `undefined` if `item.inventory_id` is invalid, but line 108 dereferences `invInfo.medicine_id` / `invInfo.batch_no`.
- **Cause:** No null check on `invInfo` (unlike `saleItem` at line 100 which is guarded).
- **Effect:** `TypeError` inside transaction → entire return API fails with HTTP 500, whole return rolled back.
- **Fix:** Guard before use: `if (!invInfo) { return res.status(400).json({error:'Invalid inventory_id'}); }` or skip that line item. Add a foreign-key existence check before the transaction.

### 1.3 [P1] legacy return numbers → `CR-2026-NaN` UNIQUE fail — `src/routes/customerReturns.ts:69`
- **Bug:** `generateReturnNo` does `parseInt(parts[2],10)+1`; legacy numbers (`CR-123`) lack the 3-segment pattern → `parts[2]` undefined → `NaN`.
- **Cause:** No array-length guard / NaN handling.
- **Effect:** Repeated `CR-2026-NaN` collisions → UNIQUE violation → return fails.
- **Fix:** Use a robust generator: `const max = db.get("SELECT MAX(CAST(SUBSTR(return_no,...) ...))")` or compute next number from `strftime('%Y')` + a `COUNT(*)+1`, and validate `Number.isFinite(next)`. Fall back to a year-prefixed counter regardless of legacy format.

### 1.4 [P1] undefined quantity silently sets stock to NULL — `src/routes/investigation.ts:735`
- **Bug:** `if (quantity<0 || loose_quantity<0)` passes when values are `undefined`; UPDATE binds `undefined` → `quantity=NULL`.
- **Cause:** No "field provided" check (`!==undefined`) before the negative check (`undefined<0` is `false`).
- **Effect:** Partial correction wipes inventory quantity to NULL → downstream numeric queries crash.
- **Fix:** Only include a field in the UPDATE when it was actually sent: `const sets=[]; const params=[]; if(quantity!==undefined){ if(quantity<0) throw...; sets.push('quantity=?'); params.push(quantity);} ...` then `UPDATE inventory_master SET ${sets.join(',')} WHERE ...`.

### 1.5 [P1] sales bill correction ignores loose_qty → stock corruption — `src/routes/investigation.ts:816,833`
- **Bug:** Revert/deduct only touches `inventory_master.quantity`, never `loose_qty`, yet `loose_qty` is re-inserted into `sale_items`.
- **Cause:** Reconciliation math omits loose units.
- **Effect:** Edited bills overstate inventory (loose units never returned) → perpetual mismatch.
- **Fix:** Factor loose units into the revert/deduct: add `inventory_master.loose_quantity` math mirroring `loose_qty` handling, or reverse the exact original `quantity`+`loose_qty` pair stored on the sale item.

### 1.6 [P0] invoice number → `S-2026-NaN` UNIQUE fail — `src/routes/sales.ts:75-83`
- **Bug:** `generateInvoiceNo` splits on `-` and `parseInt(parts[2])+1`; legacy/migrated numbers lacking `S-YYYY-NNNN` yield `NaN`.
- **Cause:** No array-length guard / NaN handling. Affects `/next-invoice`, `/hold`, `POST /`.
- **Effect:** Insert `S-2026-NaN`; next call collides → UNIQUE violation → sale creation 500.
- **Fix:** Replace with a format-agnostic generator. Prefer a monotonic `ROWID`/`MAX(id)+1` or `strftime('%Y')` + count, and `if(!Number.isFinite(n)) n = 1;`.

### 1.7 [P1] invoice-number race condition — `src/routes/sales.ts:72-84`
- **Bug:** `SELECT MAX` + `INSERT` is not atomic; two concurrent sales read same max.
- **Cause:** Read+insert not locked; second insert hits UNIQUE.
- **Effect:** One of two concurrent sales fails 500; user must retry.
- **Fix:** Use a dedicated `invoice_counter` table with `UPDATE ... SET n=n+1 RETURNING n` (atomic under WAL), or a `UNIQUE` retry loop, or DB-level `AUTOINCREMENT` surrogate + formatted display string.

### 1.8 [P1] cached substitutes always report stock 0 — `src/services/medicineAvailabilityEngine.ts:235-241`
- **Bug:** Returns `sub` from `substitutes JOIN medicines`; `substitutes` has no `quantity` column, so `sub.quantity` is `undefined` → `stock:0`, `inStock:false`.
- **Cause:** Stock lives in `inventory_master`, not joined here.
- **Effect:** Every cached substitute shows out-of-stock → availability/substitute feature defeated.
- **Fix:** JOIN `inventory_master` (or `SUM(quantity)` per medicine) and derive `stock`/`inStock` from real inventory: `LEFT JOIN inventory_master im ON im.medicine_id=m.id` and `stock = COALESCE(SUM(im.quantity),0)`.

### 1.9 [P1] expiry filter broken by date-format mismatch — `src/services/medicineAvailabilityEngine.ts:147`
- **Bug:** Filters `expiry_date > datetime('now')` but `expiry_date` is stored in mixed formats (`12/2028`, `2028-12-31`, ...).
- **Cause:** No normalized date column; lexical compare with ISO string.
- **Effect:** Valid stock misclassified as expired (or vice-versa) → wrong in/out decisions.
- **Fix:** Add a normalized `expiry_iso` column (computed via `normalizeDate()` on write) and filter on it. Backfill existing rows in a migration.

### 1.10 [P2] `source:'mixed'` unreachable — `src/services/medicineAvailabilityEngine.ts:100`
- **Bug:** `source='mixed'` assignment sits inside `if(results.length===0 && query.length>=2)` where `results.length` is always 0.
- **Cause:** Logic placed in wrong scope.
- **Effect:** API always reports `source:'local'` → misleading client.
- **Fix:** Move the assignment outside to `if(results.length>0 && suggestions.length>0) source='mixed';`.

### 1.11 [P1] fuzzy match returns arbitrary medicines — `src/services/medicineAvailabilityEngine.ts:202-212`
- **Bug:** `findFuzzyMatches` scores every medicine at constant `0.5`, sorts (no reorder), returns first `limit` → unrelated medicines.
- **Cause:** Placeholder scoring never compares query to name.
- **Effect:** Garbage "alternatives"/substitutes shown → clinically misleading.
- **Fix:** Implement real similarity (e.g., Levenshtein/normalized token overlap) or remove the fuzzy branch until implemented; never return arbitrary rows.

### 1.12 [P1] Telegram invoice number collision — `src/telegramBot.ts:455`
- **Bug:** `rawInvoiceNo='TG-INV-'+Date.now().toString().slice(-4)`; last 4 digits repeat every 10 s.
- **Cause:** Truncating timestamp loses uniqueness.
- **Effect:** Two imports in same 10 s collide → UNIQUE → Telegram bill import fails, no inventory added.
- **Fix:** Use full `Date.now()` + a per-import random/sequence: `` `TG-INV-${Date.now()}-${Math.floor(Math.random()*1000)}` ``, or a DB counter.

### 1.13 [P0] unhandled rejection crashes whole server — `src/process/processGuardian.ts:61-67` + `src/whatsappClient.ts:19-32`
- **Bug:** `processGuardian` calls `process.exit(1)` on *every* unhandled rejection; `whatsappClient` also installs a handler to "suppress" Puppeteer rejections. In prod both run → server exits on benign rejection.
- **Cause:** Global handler treats all rejections as fatal; second handler masks inconsistently.
- **Effect:** Single benign rejection takes down entire API server.
- **Fix:** In `processGuardian`, log the rejection but only exit for non-benign ones, or `process.on('unhandledRejection', e => logger.error(e))` and let domains/express error handling manage. Remove the conflicting swallow in `whatsappClient` (or make it `logger.warn`, not silent). Coordinate a single handler.

### 1.14 [P2] empty `catch {}` swallows errors — `src/services/pharmarack.ts:598` (+ utilities.ts, orders.ts:37-61, migration.ts)
- **Bug:** Blank catch blocks hide failures (e.g. line 598 swallows token-scrape errors).
- **Cause:** Error suppression without logging.
- **Effect:** Silent feature failures with no log → unreproducible.
- **Fix:** Replace with `catch(e){ logger.warn('context', e); }` and, where the operation is important, surface to caller / metrics.

### 1.15 [P1] `POST /returns` missing `type` validation → CHECK fail — `src/routes/returns.ts:85-86`
- **Bug:** Validates `return_no`/`original_invoice_id` but not `type`; insert uses `type||null`; column has `CHECK(type IN ('sale','purchase'))`.
- **Cause:** No validation that `type` ∈ {sale,purchase}.
- **Effect:** Omitted `type` → NULL → SQLITE_CONSTRAINT → 500 on every such return.
- **Fix:** `if(!['sale','purchase'].includes(type)) return res.status(400)...` (and default sensibly from context).

### 1.16 [P0] partial `PUT /:id` wipes quantity/MRP/expiry → NULL — `src/routes/inventory.ts:255-260`
- **Bug:** UPDATE unconditionally sets `quantity, rack_location, batch_no, expiry_date, reorder_level, mrp, loose_quantity`; omitted fields default to `undefined` and bind as NULL.
- **Cause:** No "field provided" guard; `qtyVal`/`batchNoVal` fall back to `undefined` when omitted.
- **Effect:** Editing only `rack_location` nulls stock/MRP/expiry → severe inventory corruption.
- **Fix:** Build the SET clause only from provided fields (same pattern as fix 1.4). Never bind `undefined` for columns that already have a value.

### 1.17 [P1] new medicine defaults to 100 stock if quantity omitted — `src/routes/inventory.ts:362`
- **Bug:** `parseInt(quantity,10)||100` → missing/zero quantity yields phantom 100 stock.
- **Cause:** `||100` fallback applied to missing/zero value.
- **Effect:** Inflated starting inventory / distorted availability.
- **Fix:** `const qty = quantity===undefined ? 0 : parseInt(quantity,10); if(Number.isNaN(qty)) qty=0;` (no phantom default).

### 1.18 [P2] SQL + params logged in production hot path — `src/routes/medicines.ts:125,131`
- **Bug:** `console.log('COUNT QUERY:',countQuery,'PARAMS:',params)` on every `GET /medicines`.
- **Cause:** Debug logging left in.
- **Effect:** Log spam + potential param leakage; perf noise.
- **Fix:** Remove or gate behind `if(process.env.DEBUG_SQL)`. Use structured `logger.debug`.

### 1.19 [P1] `JSON.parse(finalCartData)` can throw — `src/routes/sales.ts:404`
- **Bug:** `POST /hold` parses string cart without try/catch; malformed JSON throws inside handler.
- **Cause:** No input validation/guard.
- **Effect:** Hold request returns 500 instead of 400 → hold attempt lost.
- **Fix:** Wrap in try/catch → `return res.status(400).json({error:'Invalid cart payload'})`.

### 1.20 [P1] emergency-stock reorder always 0 when configured — `src/services/medicineAvailabilityEngine.ts:315-317`
- **Bug:** `suggestedReorder = stockConfig ? Math.max(0, reorder_level-current_stock) : 10`; `reorder_level` defaults to 0.
- **Cause:** Default `reorder_level=0` with no fallback when a config row exists.
- **Effect:** `GET /medicines/emergency-stock` reports 0 for configured meds → no procurement suggestion when depleted.
- **Fix:** When `reorder_level<=0`, derive a sensible default (e.g., safety-stock heuristic or a global setting) instead of 0.

---

# 2. FRONTEND SPA (React)

### 2.1 [P2] unstable React key `Math.random()` in dropdown — `frontend/src/pages/POS/index.tsx:2247`
- **Bug:** `key={item.inventory_id || `item_${item.medicine_id}_${Math.random()}`}` changes every render.
- **Cause:** `Math.random()` produces new key → React remounts rows, drops focus.
- **Effect:** Search highlight flickers/loses sync; key warnings; broken substitute dropdown.
- **Fix:** Use a stable key: `key={item.inventory_id ?? item.medicine_id ?? `m_${item.medicine_id}`}` (no random). If uniqueness needed, combine stable fields.

### 2.2 [P1] local autocomplete misses cache-ready dep → stale results — `frontend/src/pages/POS/index.tsx:965-1001`
- **Bug:** Search effect depends only on `[searchTerm]`, not on `inventoryIndexReady`; if user types before cache loads, effect runs on empty cache and never re-runs.
- **Cause:** Missing `inventoryIndexReady` in deps.
- **Effect:** First searches after load silently return empty until user re-types.
- **Fix:** Add `inventoryIndexReady` to the dependency array; when it flips true, re-run search if `searchTerm` present.

### 2.3 [P0] editing an invoice wipes its discount — `frontend/src/pages/Sells/index.tsx:240,260`
- **Bug:** `openEdit()` does `setEditDiscount(0)`; `handleSaveEdit()` sends `discount: editDiscount` (0), never reading `full.discount`.
- **Cause:** Original discount never captured into edit state.
- **Effect:** Every edited sale permanently loses its real discount → wrong totals / silent data loss.
- **Fix:** Initialize `setEditDiscount(full.discount ?? 0)` in `openEdit`, and send the edited value.

### 2.4 [P2] enrichment drawer never shows real data — `frontend/src/pages/Sells/index.tsx:135,1127-1181`
- **Bug:** Stores `setEnrichedData(data)` (full `{success,enrichment}`) but drawer reads `enrichedData.activeIngredients` etc., which live at `enrichedData.enrichment.*` (Inventory correctly does `setEnrichedData(res.enrichment)`).
- **Cause:** Inconsistent response unwrapping between Sells and Inventory for same endpoint.
- **Effect:** Medical-profile drawer always shows "Not available" even when enrichment exists.
- **Fix:** Normalize: `setEnrichedData(res.enrichment ?? res.data ?? res)` and read the unified shape in both pages.

### 2.5 [P1] CRM crash on malformed WhatsApp media — `frontend/src/pages/CRM/index.tsx:71`
- **Bug:** `media.mimetype.startsWith('image/')` — `media.mimetype` may be `undefined`.
- **Cause:** `media` null-checked but `media.mimetype` not.
- **Effect:** `Cannot read properties of undefined (reading 'startsWith')` → message thread render crashes.
- **Fix:** `const isImage = media?.mimetype?.startsWith('image/') ?? false;`

### 2.6 [P2] DB writes on every keystroke (race/thrash) — `frontend/src/pages/POS/index.tsx:1499,1505,1510`
- **Bug:** Editing `packSize`/`mrp`/`costPrice` immediately calls `api.updateMedicine` with no debounce.
- **Cause:** Mutation inside change handler.
- **Effect:** Overlapping `PUT /inventory/:id` → last-write-wins races, server load.
- **Fix:** Debounce (e.g. 400 ms) the update; or batch on blur.

### 2.7 [P1] universal-edit save re-opens drawer with STALE item — `frontend/src/pages/Inventory/index.tsx:896-903`
- **Bug:** On `onSave` calls `setPanelOpen(false)` then `setTimeout(()=>handleRowClick(selectedItem),300)`; `selectedItem` is the pre-edit closure.
- **Cause:** Stale closure; no refetch.
- **Effect:** Drawer re-opens showing old MRP/stock until user clicks another row.
- **Fix:** After save, refetch the record (`api.getMedicine(id)`) and reopen with the fresh object, or reopen via the updated list row.

### 2.8 [P2] two interdependent cart-mutation effects on `[cart]` — `frontend/src/pages/POS/index.tsx:414-454`
- **Bug:** One effect injects empty row when cart empty; second appends empty row when last filled; both depend on `[cart]` and both `setCart`.
- **Cause:** One logical transition split across two same-dep effects.
- **Effect:** On bill restore both fire → phantom empty row; fragile infinite-add risk.
- **Fix:** Merge into a single effect that computes the desired cart shape once; guard against duplicate empty rows.

### 2.9 [P2] dead state / unused module caches — `frontend/src/pages/POS/index.tsx:178,80-82`
- **Bug:** `patientId` never read; `cachedDoctors`/`cachedCommonCombinations`/`cachedSpecialOrders` unused (also dup in Inventory).
- **Cause:** Leftover scaffolding.
- **Effect:** Misleading; signals unwired copy-paste logic.
- **Fix:** Remove dead state/vars.

### 2.10 [P2] refill hydration bypasses typed API — `frontend/src/pages/POS/index.tsx:759`
- **Bug:** Calls `apiClient.get('/refills/panel')` directly while `api.getRefillsPanel()` exists.
- **Cause:** Inconsistent API access.
- **Effect:** Fragile coupling; latent breakage if response shape changes.
- **Fix:** Use `api.getRefillsPanel()` everywhere.

### 2.11–2.15 [P2] Theming violations (break light mode) — see files below
Hardcoded `bg-black/*`, `bg-white/*`, `text-white`, `bg-[#hex]`, Tailwind-default `red-500`/`green-500` instead of semantic tokens `bg-bg`,`bg-bg2`,`bg-bg3`,`bg-glass-bg`,`text-text`,`text-muted`,`border-border`,`red`,`green`.
- `Inventory/index.tsx:573,602,606,614,637,656,675,701,714,758,778,791,805,847,857,867`
- `components/VirtualRow.tsx:13`
- `components/Layout.tsx:135,149,171,448,460,475,818,848,903,943,956,966,992,999`
- `AICamera.tsx:76,78,102,111`; `QuickOrderModal.tsx:715,1166`; `LiveCartAddModal.tsx:818,1420`; `UniversalMedicineEditModal.tsx:174,281,284,310,313`
- `Dashboard/index.tsx:68` (`bg-sky-bg` invalid class), `:149,159,199,200,201,202`
- **Fix:** Replace all raw colors with semantic tokens; remove invalid `bg-sky-bg` (use `bg-bg2`/`bg-glass-bg`). Add an ESLint rule / grep gate to block hardcoded color classes.

---

# 3. MOBILE (Expo / React Native)

### 3.1 [P0] missing `/backup` route → broken navigation — `_layout.tsx:366`, `more/index.tsx:13`, `(tabs)/index.tsx:295`, `DrawerMenu.tsx:55`
- **Bug:** `/backup` registered in Stack and linked from menus, but no `app/backup/index.tsx` exists.
- **Cause:** Backup screen never implemented.
- **Effect:** Tapping Backup navigates to `+not-found`; with `typedRoutes:true` it fails to compile.
- **Fix:** Implement `app/backup/index.tsx` (DB export/share via `expo-sharing` + `FileSystem`), or remove the route + all links.

### 3.2 [P0] `DevSettings.reload()` crashes prod logout — `components/DrawerMenu.tsx:69`
- **Bug:** `handleAdminLogout` calls `DevSettings.reload()` unguarded.
- **Cause:** `DevSettings` is dev-only; `undefined` in release builds.
- **Effect:** `TypeError: Cannot read property 'reload' of undefined` → logout crash.
- **Fix:** `if(__DEV__ && DevSettings) DevSettings.reload(); else { /* navigate to login / reset state */ }`.

### 3.3 [P1] SSE notification stream never reconnects — `_layout.tsx:279-316`
- **Bug:** SSE `notifications/stream` opened once in push-setup effect; early-returns `if(!url) return` and never re-runs after `autoDiscoverServer()`.
- **Cause:** Effect deps `[fontsLoaded,fontError]` don't include server URL.
- **Effect:** If app starts before server URL known, live notifications never arrive.
- **Fix:** Re-run SSE setup when the discovered `serverUrl` changes; add a retry/reconnect with backoff on stream error/close.

### 3.4 [P1] Gmail token expiry becomes `NaN` → never refreshes — `lib/api.ts:209`
- **Bug:** `Date.now()+(data.expires_in*1000)` → if `expires_in` missing → `NaN` stored.
- **Cause:** No validation of `expires_in`.
- **Effect:** `Date.now()+60000>=NaN` is false → token never refreshed → Gmail API permanently fails.
- **Fix:** `const exp = Number(data.expires_in); newExpiry = Number.isFinite(exp) ? Date.now()+exp*1000 : Date.now()+3600*1000;`

### 3.5 [P2] `res.json()` on non-JSON/error bodies throws — `lib/api.ts:70`
- **Bug:** `request()` always `return res.json()`.
- **Cause:** No content-type/body check.
- **Effect:** Server-down/HTML error → `Unexpected end of JSON` masks real error.
- **Fix:** `const text=await res.text(); if(!res.ok) throw new Error(text.slice(0,200)); try{return JSON.parse(text)}catch{throw new Error('Non-JSON response: '+text.slice(0,200))}`.

### 3.6 [P2] WhatsApp fallback needs Android `<queries>` — `lib/api.ts:1059-1091` + `app.json:20-24`
- **Bug:** `Linking.canOpenURL('whatsapp://')` on Android 11+ returns false without `<queries>` intent filter.
- **Cause:** Expo doesn't auto-add custom-scheme queries.
- **Effect:** Offline WhatsApp fallback silently fails on Android 11+.
- **Fix:** Add `plugins:[['expo-intent-filters',{'queries':[{'action':'android.intent.action.VIEW','data':[{'scheme':'whatsapp'}]}]}]]` or patch `AndroidManifest`.

### 3.7 [P2] cart total ignores tax → discrepancy — `billing/index.tsx:67` vs `lib/api.ts:484-487`
- **Bug:** Display sums `qty*(mrp||unit_price)` (no tax); `createSale` adds 5% GST.
- **Cause:** Tax only applied server-side.
- **Effect:** User sees one total, invoice shows +5% → looks like overcharge.
- **Fix:** Compute display total with the same tax logic (factor GST into the on-screen total or show "incl. tax" breakdown).

### 3.8 [P2] admin gating disabled → automation center visible to all — `notifications/index.tsx:32,47`
- **Bug:** `setIsAdmin(true)` unconditionally ("bypass").
- **Cause:** Admin gating intentionally disabled.
- **Effect:** Server-side notification internals exposed to non-admins.
- **Fix:** Use real `isAdminMode()` value; gate the automation center UI.

### 3.9–3.16 [P2] lower-severity mobile defects
- `inbox/index.tsx:682` copy says "2 days" but `filterLastWeek()` is 7 days → fix text or filter.
- `MedicineRow.tsx:17` `new Date(expiry)` on bad string → `Invalid Date` suppresses warning → validate date, default to not-expiring only when truly absent.
- `inbox/index.tsx:457` `toLocaleDateString()||fallback` always truthy → use `Number.isNaN(date.getTime())` check.
- `lib/api.ts:193` `expiry===0` always refreshes → treat `0` as "unknown", not "expired"; only refresh when `now>=expiry`.
- `(tabs)/index.tsx:219-321` `setTimeout` no unmount guard → clear timer on unmount.
- `(tabs)/index.tsx:562` clear chat uses closure `messages[0]` → use a stable seed constant.
- `(tabs)/index.tsx:484` redundant dynamic `import('../../lib/api')` → remove; use static import.
- `lib/api.ts:484-487` offline total rounds away paise → keep consistent rounding with server.

---

# 4. DESKTOP / BUILD LAYER (pkg + Inno Setup)

> Note: there is **no Electron code**; the desktop layer is a `pkg` Windows exe + `installer.iss`. All findings are real defects in that layer.

### 4.1 [P0] `installer.iss:25` references nonexistent `.env.example` — build fail
- **Fix:** Either create `.env.example`, or change source to `.env` and flag `onlyifdoesntexist`.

### 4.2 [P0] `installer.iss:31` references nonexistent `bin\redis\*` — build fail
- **Fix:** Create the `bin\redis` dir with `redis-server.exe` + conf, or remove the entry (app uses SQLite, not Redis).

### 4.3 [P2] `installer.iss:40-41,47-48,50` dead Redis service logic — `installer.iss`
- **Bug:** Installs/starts Redis service on 16379 though app doesn't use Redis.
- **Effect:** Wasted/misleading steps; would fail anyway (no redis binary).
- **Fix:** Remove all Redis install/start/firewall entries (confirm no Redis dependency).

### 4.4 [P1] `installer.iss:25` `onlyifdestfileexists` inverted for fresh install
- **Bug:** Flag means "install only if destination already exists" → fresh machine gets no `.env`.
- **Effect:** App runs on hardcoded dev defaults (e.g. `API_KEY=Pass@123`).
- **Fix:** Use `onlyifdoesntexist`.

### 4.5 [P0] `package.json:79-84` pkg embeds `data/**`/`backup/**` read-only
- **Bug:** pkg bundles DB into read-only snapshot; app writes schema + WAL.
- **Effect:** SQLite opens embedded DB read-only → launch crash / silent no-persist.
- **Fix:** Do NOT embed the live DB. Ship `data/` externally (copied by installer to a writable `{app}\data`) and exclude it from `pkg.assets`. Resolve data path at runtime via `process.execPath`/`app.getPath('userData')`.

### 4.6 [P0] `src/server.ts:19` / `src/config/index.ts:40-42` `__dirname` wrong under pkg
- **Bug:** `path.resolve(__dirname,'..','data','app.db')` → under pkg `__dirname` is the in-memory `/snapshot/...`.
- **Effect:** App crash on launch (cannot open/write `app.db`). Same pattern in connection.ts, backupService, emailService, cacheService, whatsapp*.ts, etc.
- **Fix:** Resolve via `process.execPath`: `const base = path.dirname(process.execPath); const dbPath = path.join(base,'data','app.db');` (or `app.getPath('userData')` for Electron-like). Apply consistently to every persistence path.

### 4.7 [P1] split-brain path strategy (`process.cwd()` vs `__dirname`) — `aiCameraService.ts:108,398,464`, `productNameFilterService.ts:209`, `whatsappClient.ts:71`, `i18n/getMessage.ts:6`, `nonMovingReportService.ts:151`
- **Bug:** Some services use `process.cwd()`, server uses `__dirname`.
- **Effect:** Files written by one subsystem unseen by another → data loss / "file not found".
- **Fix:** Centralize a `getAppDataDir()` helper in `src/config` returning a single resolved dir; use it everywhere.

### 4.8 [P0] native `.node` addons not shipped — `package.json:15` + deps `better-sqlite3`,`sqlite3`,`canvas`,`onnxruntime-node`,`paddleocr`,`tesseract.js`
- **Bug:** `pkg` can't embed native modules; installer never copies `node_modules`.
- **Effect:** `Could not locate the bindings file` → crash on launch.
- **Fix:** Either (a) ship `node_modules` next to the exe and don't bundle native deps in `pkg.assets`, or (b) build via `nexe`/installer that includes the full native runtime, or run the server via `node dist/server.js` (post `tsc`) rather than a single exe.

### 4.9 [P0] `package.json:5,15` pkg entry is `.ts` source — build produces broken exe
- **Bug:** `"bin":"src/server.ts"` and `build:exe` runs `pkg .` on TS with no `tsc` step.
- **Effect:** `build:exe` yields non-executable bundle (pkg can't run TS).
- **Fix:** Add `"build":"tsc -p tsconfig.json"` and point `bin`/pkg at `dist/server.js`. Ensure `tsconfig` emits to `dist/`.

### 4.10 [P2] `installer.iss:40` Redis conf relative path wrong — fix to absolute `{app}\bin\redis\redis.windows.conf` (or remove per 4.3).

### 4.11 [P1] no OS watchdog/service — `installer.iss:43` + `AGENTS.md` self-healing
- **Bug:** `processGuardian` exits on crash expecting external watchdog; installer only `Run ... nowait` with no service/restart loop.
- **Effect:** After any crash app stays dead.
- **Fix:** Install as a Windows Service (e.g. `node-windows` / `nssm`) or Scheduled Task that restarts on exit; wire the self-healing contract.

### 4.12 [P1] `eng.traineddata` not shipped — `installer.iss:21-32`
- **Bug:** tesseract needs `eng.traineddata` (~20 MB) at `process.cwd()`; installer omits it.
- **Effect:** Offline OCR fails / forces network download.
- **Fix:** Add `Source: "eng.traineddata"; DestDir: "{app}"` to `[Files]`.

### 4.13 [P2] build-output path mismatch `dist/PharmacyOS.exe` vs `dist\PharmacyOS.exe` — add an orchestration script (`scripts/build-desktop.ps1`) that runs `tsc` + `pkg` + validates the exe exists before `iscc`.

### 4.14 [P2] duplicate/contradictory data handling (pkg read-only embed vs installer writable copy) — resolved by 4.5/4.6 (single writable external `data/`).

---

# 5. INTEGRATIONS & AUTOMATION

### 5.1 [P0] `dbManager.close()` on shared singleton — `src/services/googleSearchService.ts:57,75`
- **Bug:** `logSearch()`/`checkDailyLimit()` call `await dbManager.close()` on the process-wide singleton.
- **Cause:** Closing the shared connection mid-flight affects every other query.
- **Effect:** Other requests/workers throw "database closed"/SQLITE_MISUSE → spurious save failures.
- **Fix:** Never close the singleton from a request path. Remove those `close()` calls (or use a dedicated read-only connection for logging). Same hazard anywhere else `dbManager.close()` appears in route/request handlers.

### 5.2 [P1] WhatsApp QR-expiry leaves `initializing=true` forever — `src/whatsappClient.ts:185-190`
- **Bug:** `client.destroy()` on QR timeout doesn't reset module `initializing=false`.
- **Cause:** Only `disconnected`/auth-failure reset it; pre-auth destroy may not emit those.
- **Effect:** After unscanned QR, `initClient()` hangs in wait-loop → WhatsApp never re-init without restart.
- **Fix:** In the QR-timeout handler set `initializing=false` before/after `client.destroy()`.

### 5.3 [P1] wait-for-init has no timeout — `src/whatsappClient.ts:104-111`
- **Bug:** Wait promise only resolves on `clientInstance` or rejects on `!initializing`; if init never completes it hangs.
- **Cause:** No upper bound.
- **Effect:** Senders hang forever, no error.
- **Fix:** Add a timeout (e.g. 60 s) that rejects with a clear error.

### 5.4 [P2] `isGroupOrBroadcast` over-broad — `src/whatsappClient.ts:250`
- **Bug:** Any `chatId.includes('-')` treated as group/broadcast.
- **Fix:** Validate against `@g.us`/`@broadcast` suffixes, not hyphen presence.

### 5.5 [P2] N+1 LID resolution in sync — `src/whatsappClient.ts:559-597`
- **Bug:** `getContactLidAndPhone` per LID chat inside loop.
- **Fix:** Batch-resolve LIDs or cache results; cap per-run work.

### 5.6 [P1] Pharmarack cookie copy-back gated on token — `src/services/tokenRefreshScheduler.ts:241-258`
- **Bug:** Copy-back to main profile only `if(holder.token)`; on fallback temp-profile with failed token capture, temp is deleted and main never refreshed.
- **Cause:** Preservation gated on token capture, not on "profile used for navigation".
- **Effect:** Session loss / recurring OTP re-auth loops.
- **Fix:** Copy temp-profile cookies back to main whenever the temp profile was actually navigated (regardless of token capture), then clean temp.

### 5.7 [P1] `browser.pages()` may be empty — `src/services/tokenRefreshScheduler.ts:192`
- **Bug:** `const [page]=await browser.pages()` assumes ≥1 page; `page` can be `undefined`.
- **Effect:** `page.on(...)` throws → caught → refresh silently fails after lock files already cleaned.
- **Fix:** `const pages = await browser.pages(); const page = pages[0] ?? await browser.newPage();`

### 5.8 [P2] single 10 s token capture window, no retry — `tokenRefreshScheduler.ts:209-218`
- **Fix:** Poll for the `Authorization` header for a longer window with a couple of retries/backoff.

### 5.9 [P1] CAPTCHA recovery launches headed Chrome — `src/services/googleSearchService.ts:205`
- **Bug:** `headless:false` on a headless server → `puppeteer.launch` throws.
- **Effect:** Medicine enrichment via Google silently fails.
- **Fix:** Use `headless:'new'`; if human interaction is truly required, document/route to an interactive mode, don't fail silently.

### 5.10 [P1] unbounded Chrome spawning in enrichment — `src/services/googleSearchService.ts:212-311`
- **Bug:** Each `discoverMedicineInfo` launches a full Chrome; catalog worker enqueues many → parallel launches, no pool.
- **Effect:** Memory/CPU exhaustion, instance leak, worker crash.
- **Fix:** Use a semaphore/pool (e.g. `p-limit`) capping concurrent browsers; reuse a single browser where possible.

### 5.11 [P0] Telegram import writes hard-coded fake prices — `src/telegramBot.ts:426,466-490`
- **Bug:** Inserts `total_amount=100*len`, `cost_price=10`, `mrp=15`, `reorder_level=10`, qty `||10`.
- **Cause:** No real OCR-extracted values used.
- **Effect:** Wrong stock valuation, distorted totals → corrupt financial/inventory data.
- **Fix:** Extract price/qty via OCR/parser before insert; if unparseable, mark the item `needs_review` and insert with `NULL`/0 rather than fake values. Alert the user.

### 5.12 [P2] Telegram medicine lookup wrong match — `src/telegramBot.ts:472`
- **Bug:** `WHERE name LIKE ?` with `%${item.name}%`, picks first match.
- **Fix:** Use exact/normalized name match with a confidence threshold; on ambiguity, queue for review.

### 5.13 [P1] Telegram temp file write without dir ensure — `src/telegramBot.ts:401-402`
- **Bug:** `fs.writeFileSync(tempFilePath,buffer)` into `uploads/temp` without `mkdirSync(recursive)`.
- **Effect:** `ENOENT` on fresh install → "Error processing prescription image" though download succeeded.
- **Fix:** `fs.mkdirSync(path.dirname(tempFilePath),{recursive:true})` before write.

### 5.14 [P1] IMAP delta sync loses mail on UID renumber — `src/services/emailService.ts:2851-2880`
- **Bug:** Sync keyed on `MAX(uid)`; no `UIDVALIDITY` check / `Message-ID` dedup.
- **Cause:** IMAP UIDs only valid under stable `UIDVALIDITY`.
- **Effect:** After server renumbers, stored max exceeds all UIDs → `${max+1}:*` returns nothing → all future mail silently skipped.
- **Fix:** Store `UIDVALIDITY`; on mismatch, full re-sync. Add `Message-ID` dedup table to avoid duplicates during re-sync.

### 5.15 [P1] IMAP full-message in-memory parse → OOM — `src/services/emailService.ts:2899,2892`
- **Bug:** `bodies:['']` + `simpleParser` buffers every attachment; no size limit.
- **Effect:** Large PDFs OOM the email worker; combined with restart cap → permanent ingestion outage.
- **Fix:** Fetch `BODY.PEEK[]` headers + structured parts; stream/limit attachment size; parse lazily.

### 5.16 [P2] IMAP `attributes.flags` may be undefined — `src/services/emailService.ts:2900`
- **Bug:** `msg.attributes.flags.includes('\\Seen')` assumes `attributes.flags` exists.
- **Effect:** TypeError inside per-uid try → that email silently skipped.
- **Fix:** `msg.attributes?.flags?.includes('\\Seen') ?? false`.

### 5.17 [P2] IMAP OAuth returns stale token when refresh missing — `src/services/emailService.ts:1058-1084`
- **Bug:** If `refresh_token` missing, returns old (possibly expired) `access_token`.
- **Effect:** IMAP auth fails → `auth_failure` broadcast every 5 min → spam loop.
- **Fix:** If no refresh token and token expired → clear credentials, prompt re-connect; don't return a dead token.

### 5.18 [P2] `downloadAttachmentsForUid` unconditional overwrite — `emailService.ts:3078`
- **Fix:** Add `existsSync` guard / atomic write (temp + rename) consistent with sync path.

### 5.19 [P1] worker SIGKILL after 45 s includes startup — `src/worker/workerSupervisor.ts:147-158`
- **Bug:** Health check kills worker after 45 s no PONG; `lastPongTime` only set at spawn + PONG; slow startup (DB lock / stuck reset) gets killed.
- **Effect:** Restart storm; after 5 restarts worker abandoned.
- **Fix:** Exclude an initial grace period (e.g. first 2 min) from the heartbeat deadline; set `lastPongTime` after first successful startup.

### 5.20 [P1] worker permanently abandoned after 5 failures — `workerSupervisor.ts:109-118`
- **Bug:** After 5 consecutive failures, never restarts (console.error only).
- **Effect:** If transient failure clears, worker stays dead until app restart.
- **Fix:** Add exponential backoff with a cap + eventual retry; escalate to alert/health endpoint; don't give up silently.

### 5.21 [P1] Pharmarack catalog sync not paginated — `src/services/pharmarackCatalogCache.ts:104-121`
- **Bug:** Requests `Count:200, SkipCount:0` per store, never loops over `SkipCount`.
- **Effect:** Distributors with >200 products truncated → incomplete offline catalog.
- **Fix:** Loop `SkipCount += 200` until returned count < 200.

### 5.22 [P2] catalog sync aborts on first malformed response — `pharmarackCatalogCache.ts:83-92`
- **Fix:** Retry with backoff; continue other stores on single failure; log structured error.

### 5.23 [P2] AI camera audit queue unbounded — `src/services/aiCameraService.ts:337-343`
- **Bug:** Every unmatched scan (incl. noisy OCR) written to `audit_images/` + `audit_queue.json` rewritten in full each insert.
- **Effect:** Disk growth / slow writes / storage bloat.
- **Fix:** Add OCR-confidence/length threshold before audit logging; cap queue size; append rather than rewrite.

---

# 6. TESTS / SCRIPTS / DATA & SCHEMA

### 6.1 [P0] `special_orders.source_refill_id` column never created — `src/database.ts:343` + `src/routes/orders.ts:15` + `src/services/refillService.ts:85`
- **Bug:** `ensureSchema` ALTERs `special_orders ADD COLUMN source_refill_id` *before* the table is created (table created lazily in `orders.ts` without that column); ALTER throws "no such table", silently caught → real table lacks column.
- **Effect:** `refillService` INSERT → `SQLITE_ERROR: no column named source_refill_id` → refill auto-ordering fails every time; `ordering_triggered` never set.
- **Fix:** Create the column in `initOrdersTable` CREATE statement (or ALTER *after* the table exists with a proper existence guard that logs). Run a one-time migration to add it to existing DBs.

### 6.2 [P2] ALTER-before-CREATE + silent catch-all — `src/database.ts:332-359`
- **Bug:** `alterStatements` run before second `db.exec` block creates the tables; blanket try/catch swallows ALL errors ("Column already exists").
- **Effect:** Genuinely broken ALTERs (type conflict) hidden → invisible schema drift.
- **Fix:** Move ALTERs to *after* all CREATEs; log each swallowed error (or only ignore the specific "duplicate column" SQLite code `SQLITE_ERROR` with message match). Never blanket-swallow.

### 6.3 [P1] failed import leaves job `processing` (lost failed status) — `src/worker/catalogWorker.ts:701-819,979-985`
- **Bug:** `insertBatch` opens transaction but never ROLLBACK on error; outer catch runs `UPDATE ... status='failed'` inside the still-open transaction, then `db.close()` rolls it back.
- **Effect:** Job stuck `processing`; next start resets to `pending` → re-import/duplicates.
- **Fix:** Wrap `insertBatch` in `try{ BEGIN; ... COMMIT }catch(e){ ROLLBACK; throw e }`; write the `failed` status in a *separate* connection/transaction after the import transaction is closed.

### 6.4 [P2] header-presence guard only for CSV — `src/worker/catalogWorker.ts:561-574`
- **Bug:** Mapped-column guard only runs for `.csv`, not `.xlsx`/`.xls`/`.pdf`.
- **Effect:** Stale mapping silently mis-imports Excel/PDF (empty values).
- **Fix:** Apply the same guard (verify mapped headers exist in the parsed sheet/PDF table) for all formats; otherwise route to `waiting_for_mapping`.

### 6.5 [P1] dead migrations directory — `src/database/migrations/002_message_tables.sql`, `003_license_settings.sql`
- **Bug:** Numbered migrations never executed; app relies solely on `ensureSchema` inline DDL. `CURRENT_SCHEMA_VERSION=6` inconsistent with only 002/003.
- **Effect:** License settings defaults absent until activation; schema-drift risk; migration system is dead code.
- **Fix:** Either wire a real migration runner (run `migrations/*.sql` in order, track version) or delete the directory and document that `ensureSchema` is the single source of truth. Seed license defaults in `ensureSchema`.

### 6.6 [P2] CSV read stream not always destroyed on error — `catalogWorker.ts:875-921`
- **Fix:** Add `finally` that destroys `readStream`/`csvStream` on all exit paths to avoid Windows `EBUSY` on file move/delete.

### 6.7 [P2] migration summary miscounts customers as patients — `src/worker/migrationWorker.ts:733`
- **Bug:** `'customer'` handler calls `importCustomer` but `stats.patients++`.
- **Fix:** Use a dedicated `stats.customers++` counter.

### 6.8 [P1] `scripts/fixDb.ts` CHECK too restrictive → breaks pipeline — `scripts/fixDb.ts:18-25`
- **Bug:** Creates `catalog_jobs` with `CHECK(status IN ('pending','processing','done','failed'))`; real app uses many more statuses; `ensureSchema` even drops such tables on boot.
- **Effect:** If used to repair, later status writes throw CHECK → pipeline broken until next boot self-heals.
- **Fix:** Align the CHECK with the real status set, or remove the CHECK, or document "run fixDb then reboot immediately".

### 6.9 [P2] `scripts/migrate.js` cwd-relative DB paths — `scripts/migrate.js:24-27`
- **Bug:** `DB_PATH='app.db'` relative to cwd, while app uses `data/app.db`.
- **Effect:** Can back up/swap the WRONG db.
- **Fix:** Default to `path.resolve(__dirname,'..','data','app.db')` and require explicit override.

### 6.10 [P1] `seedMockData` orphans referencing tables — `src/cli/seedMockData.ts:150-163`
- **Bug:** DELETEs only some tables; `substitutes`,`stock_config`,`stock_ledger`,`medicine_aliases`,`pharmacist_corrections` (FK `medicine_id`) left pointing at deleted meds.
- **Effect:** Stale stock/phantom substitutes/wrong availability after reseed.
- **Fix:** Also clear those child tables in the same reseed transaction (or enable FK + cascade).

### 6.11 [P1] `seedRealMeds` assumes IDs 1–43 + no ensureSchema — `src/scripts/seedRealMeds.ts:8,324-328`
- **Bug:** `DELETE FROM medicines WHERE id>43` assumes synthetic occupy 1–43; no schema bootstrap.
- **Effect:** On mock-seeded DB, 57 meds deleted but 43 mock remain mixed; on schema-less DB, INSERT fails.
- **Fix:** Don't assume IDs; clear by a `source`/`is_synthetic` flag; call `ensureSchema()` first; clean child tables (see 6.10).

### 6.12 [P2] ALTERs for push_tokens/return_items/emails/whatsapp_chats/staged_medicine_reviews run before CREATE — `src/database.ts:332-351`
- **Bug:** Same root as 6.2; harmless today only because later CREATEs include the columns.
- **Effect:** Fragile; removing a column from a CREATE while keeping the ALTER silently drops creation.
- **Fix:** Covered by 6.2 fix (reorder + log).

### 6.13 [P2] per-row snapshot trigger on every inventory write — `src/database/connection.ts:107-124`
- **Bug:** `triggerSnapshot()` fired synchronously per inventory write during import/migration.
- **Effect:** Performance collapse / overlapping snapshots on large imports (unless internally debounced).
- **Fix:** Debounce `triggerSnapshot` (e.g. trailing 2 s, coalesced) so bulk imports trigger at most one snapshot.

### 6.14 [P2] CSV row double-parse for count — `catalogWorker.ts:654-674`
- **Fix:** Count via `fs.stat` size estimate or a single streaming pass that both counts and imports; avoid re-reading the file.

### 6.15 [P2] concurrent connections in analysis — `catalogWorker.ts:276` vs `runCatalogAnalysis`
- **Bug:** `preScanCsv` uses `dbManager.getConnection()` while `runCatalogAnalysis` uses a different `open()`; progress `db.run` not awaited.
- **Effect:** Potential `SQLITE_BUSY`/interleaved writes.
- **Fix:** Use one connection for the whole analysis; `await` progress writes.

### 6.16 [P2] discount parse drops non-strict values — `migrationWorker.ts:1471` + `validateAndCleanCSVRow`
- **Bug:** `parseFloat("Rs.10")` → `NaN` → `0` silently.
- **Fix:** Strip currency symbols/`%` before parse; if still NaN, flag row for review instead of zeroing.

### 6.17 [P2] `seedRealMeds` doesn't clear aliases/substitutes/stock_config — `seedRealMeds.ts:329,391-392`
- **Fix:** Same as 6.10/6.11 child-table cleanup.

### 6.18 [P1] inventory `expiry_date` defaults to `'2028-12-31'` un-normalized — `catalogWorker.ts:805`
- **Bug:** `const expiry = item.expiry_date || '2028-12-31'` stored raw.
- **Effect:** Mixed expiry formats → inconsistent sorting / expiry-alert false negatives (compounds 1.9).
- **Fix:** Run `normalizeDate(expiry)` (as `migrationWorker` does) and store ISO; backfill existing rows.

---

# Fix Sequencing (recommended)

**Phase A — P0 (do first; crashes/build/data-loss):** 1.2, 1.3, 1.6, 1.13, 1.16, 2.3, 3.1, 3.2, 4.1, 4.2, 4.5, 4.6, 4.8, 4.9, 5.1, 5.11, 6.1.

**Phase B — P1 (save/edit/API failure, corruption):** 1.1, 1.4, 1.5, 1.7, 1.8, 1.9, 1.11, 1.12, 1.15, 1.17, 1.19, 1.20, 2.2, 2.5, 2.7, 3.3, 3.4, 3.7, 4.4, 4.7, 4.11, 4.12, 5.2, 5.3, 5.6, 5.7, 5.9, 5.10, 5.13, 5.14, 5.15, 5.19, 5.20, 5.21, 6.3, 6.5, 6.8, 6.10, 6.11, 6.18.

**Phase C — P2 (UX/log/silent):** all remaining items + theming section 2.11–2.15.

After fixes, run `node scripts/quick-update.mjs` to refresh the knowledge graph, and add CI guards: ESLint rule blocking hardcoded color classes, and a startup self-test that asserts all referenced DB columns exist.
