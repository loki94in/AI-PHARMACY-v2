# Packaged EXE — 401 Errors, Migration Failure & Pages Not Loading

> **Document type:** Single implementation plan (PRD)  
> **Location:** repository root  
> **Last updated:** 2026-08-02  
> **Status:** Planning only — **no fixes applied in this document**  
> **Symptom (user report):** After building/installing the Windows executable, install succeeds but **Migration shows 401**, **many pages do not load**, while **~6 pages appear to work**.

---

## 1. Executive summary

The installed `.exe` is not one broken feature — it is **three overlapping failure modes**:

| # | Failure mode | User sees | Root cause area |
|---|--------------|-----------|-----------------|
| **A** | Session auth (401) | Migration/API calls fail with `Unauthorized`; blank or error states on data pages | `authenticateApiKey` + `bootstrap-token` + stale `localStorage` token |
| **B** | Boot timing | First 30–90s after launch: random 401/500, then pages start working | Server listens before DB schema + auth token are ready |
| **C** | Packaged path split | Data “missing” after install; migration writes but pages read empty DB | Installer seeds DB beside exe; runtime uses `%LOCALAPPDATA%`; some routes still use `__dirname` DB paths |

**Why ~6 pages “work”:** Those pages either use **public APIs** (no auth), **render UI without waiting for API** (shell + cache), or **tolerate empty/failed fetch** (POS unlocks search even on 401). Heavy pages (Reports, Mail, Learning, CRM, Migration review) need auth + DB + lazy route modules and fail visibly.

---

## 2. How auth works in the packaged app (must understand before fixing)

### 2.1 Request flow

```
Browser SPA (localhost:5174)
    │
    ├─► GET /api/auth/bootstrap-token     ← PUBLIC (no auth header needed)
    │       returns license_session_token OR legacy API_KEY (default Pass@123)
    │
    ├─► Stores token in localStorage (session_token)
    │
    └─► All other /api/* calls
            Header: x-session-token: <token>
            Middleware: authenticateApiKey (src/middleware/auth.ts)
            Validates against app_settings.license_session_token OR config.apiKey
```

### 2.2 What is public (no token required)

From `src/middleware/auth.ts`:

- `/api/license/*`
- `/api/migration/*` (all migration routes)
- `/api/medicines/compact` (POS search cache)
- `/api/health`
- `/api/auth/bootstrap-token`
- `/api/notifications/stream` and register-token
- `/api/security/admin/login`

**Important:** Migration UI also calls **non-migration** endpoints in some flows (settings, verification). Those **do** require auth and can show 401 even when `/api/migration/*` is public.

### 2.3 Why `SKIP_AUTH=true` in installer `.env` does NOT help

`packaging/portable.env` ships:

```
NODE_ENV=production
SKIP_AUTH=true
```

But `authenticateApiKey` **ignores** `SKIP_AUTH` when `NODE_ENV=production`:

```typescript
// auth.ts — bypass only when NODE_ENV !== 'production'
if ((SKIP_AUTH === 'true') && process.env.NODE_ENV !== 'production') { ... }
```

So the packaged app **always enforces real auth** in production. This is correct for security but confusing because the shipped `.env` suggests otherwise.

---

## 3. Page-by-page matrix (22 mounted routes)

**Legend:**  
🟢 Works without auth or degrades gracefully  
🟡 Needs auth; partial UI if 401  
🔴 Needs auth + heavy API/lazy modules; fails visibly on 401 or boot delay

| # | Route | Page | Primary APIs on load | Auth required? | Typical packaged behavior if auth/boot fails |
|---|-------|------|----------------------|----------------|---------------------------------------------|
| 1 | `/pos` | POS | `/medicines/compact` (public), then sales/inventory/doctors | Partial | 🟢 **Shell + search often work** (Layout marks cache loaded even on 401) |
| 2 | `/license` | License | `/api/license/status` | No | 🟢 **Works** |
| 3 | `/settings` | Settings | `/api/settings` | Yes | 🟡 Form empty / save blocked until hydrated |
| 4 | `/migration` | Migration | `/api/migration/*` (public) + staging/review APIs | Mixed | 🟡 Upload may work; **Review/finalize may 401** if calling protected routes |
| 5 | `/dashboard` | Dashboard | `/api/analytics/summary` | Yes | 🔴 Loading spinner or error |
| 6 | `/inventory` | Inventory | `/api/inventory` | Yes | 🔴 Empty / error |
| 7 | `/purchases` | Purchases | `/api/purchases`, OCR | Yes | 🔴 Empty / error |
| 8 | `/purchase-history` | Purchase History | `/api/purchases/history` | Yes | 🔴 Empty / error |
| 9 | `/sells` | Sales history | `/api/sales/invoices` | Yes | 🔴 Empty / error |
| 10 | `/returns` | Returns (+ Expiry/Customer tabs) | `/api/returns`, expiry, customer-returns | Yes | 🔴 Tabs fail to load data |
| 11 | `/crm` | CRM | customers, refills, messages | Yes | 🔴 Empty / error |
| 12 | `/orders` | Orders (redirects to CRM special orders) | `/api/orders` | Yes | 🔴 Empty / error |
| 13 | `/reports` | Reports | `/api/reports/*` (heavy) | Yes | 🔴 **Worst case** — large lazy bundle + many APIs |
| 14 | `/mail` | Mail | `/api/messaging/emails` | Yes | 🔴 Empty / error |
| 15 | `/learning` | Learning | `/api/settings`, learning stats, integrations | Yes | 🔴 Empty / error |
| 16 | `/database` | Database | `/api/utilities/db-stats`, catalog | Yes | 🔴 Empty / error |
| 17 | `/pharmarack-cart` | Pharmarack Cart | pharmarack, settings, delivery-boys | Yes | 🔴 Cart empty / session errors |
| 18 | `/dispatch` | Dispatch | `/api/dispatch/*` | Yes | 🔴 Empty / error |
| 19 | `/investigation` | Investigation | `/api/investigation/search` | Yes | 🔴 Empty / error |
| 20 | `/phone-sales` | Phone sales | staged sales APIs | Yes | 🔴 Empty / error |
| 21 | `/composition-queue` | Composition queue | `/api/catalog/composition-queue` | Yes | 🔴 Empty / error |
| 22 | `/manual-purchase` | Purchases (alias) | Same as Purchases | Yes | 🔴 Same as Purchases |

### 3.1 The “~6 pages that work” (most likely)

Based on architecture, the six that **most often appear functional** on a broken install:

| Page | Why it still “works” |
|------|----------------------|
| **POS** | Public compact inventory route; UI unlocks even when fetch fails |
| **License** | Fully public API |
| **Settings** | Page renders; may show empty fields (not obvious failure) |
| **Migration (upload step)** | `/api/migration/upload` is public |
| **Returns / Inventory shell** | React route loads; user may not notice empty tables immediately |
| **Default landing `/pos`** | App redirects `/` → `/pos` |

Pages that **fail obviously**: Reports, Mail, Learning, CRM, Pharmarack Cart, Dashboard, Investigation.

---

## 4. Root causes (gaps) — issue, cause, fix

### GAP-01 — Stale or missing session token (401 on most pages)

| | |
|---|---|
| **Issue** | Browser shows `401 Unauthorized: Missing/Invalid session token` in Network tab; pages stuck loading or empty. |
| **Cause** | 1) `localStorage.session_token` from old install ≠ `license_session_token` in new DB. 2) `ensureAuthToken()` fails if bootstrap runs before DB ready → no header sent. 3) After license activation, client still holds legacy `Pass@123` until cache cleared. |
| **Fix** | 1) On app boot, call bootstrap **before** any page fetch; block Layout until token resolved. 2) On 401, clear storage and re-bootstrap (partially exists — strengthen). 3) On license activate success, call `clearAuthTokenCache()` + immediate re-bootstrap. 4) Show user-visible “Connecting to server…” banner until auth ready. |
| **Files** | `frontend/src/services/api.ts`, `frontend/src/components/Layout.tsx`, `frontend/src/pages/License/index.tsx` |
| **Do not touch** | Public migration whitelist; do not re-enable `SKIP_AUTH` in production |

---

### GAP-02 — Boot race: API accepts requests before DB is ready

| | |
|---|---|
| **Issue** | First minute after exe launch: random 401/500, then self-heals; user thinks install is broken. |
| **Cause** | `server.ts` calls `app.listen()` immediately; `ensureSchema()` runs **async afterward**. `bootstrap-token` queries DB — fails or returns wrong value if DB locked/empty. |
| **Fix** | 1) Add `GET /api/health/ready` that returns 503 until schema + DB connection OK. 2) Frontend gates all authenticated requests behind ready check. 3) Show splash “Starting database…” on packaged app until ready. |
| **Files** | `src/server.ts`, `frontend/src/components/Layout.tsx`, `frontend/src/services/api.ts` |
| **Do not touch** | Lazy route loading pattern (keep it; fix readiness gate only) |

---

### GAP-03 — Installer DB path vs runtime DB path (split brain)

| | |
|---|---|
| **Issue** | Fresh install: seed data in `{install}\data\app.db` but app reads `%LOCALAPPDATA%\AI Pharmacy OS\data\app.db`. Migration “succeeds” but POS/Settings show empty pharmacy. |
| **Cause** | `installer.iss` seeds `data\app.db` beside exe. `getAppDataDir()` uses LOCALAPPDATA. One-time `migrateLegacyPackagedDataIfNeeded()` only runs if LOCALAPPDATA DB **does not exist**. Re-install or partial copy can skip migration. |
| **Fix** | 1) Installer writes seed **directly** to `%LOCALAPPDATA%\AI Pharmacy OS\data\` (or run migration helper on first boot with logging). 2) Log resolved `config.dbPath` on every startup (console + `/api/health`). 3) Settings UI: “Database location: …” for support. |
| **Files** | `installer.iss`, `src/config/index.ts`, `src/server.ts` |
| **Do not touch** | Do not move DB back under Program Files / exe folder |

---

### GAP-04 — `.env` loaded from wrong working directory

| | |
|---|---|
| **Issue** | Startup from Windows Run key or double-click without `WorkingDir` → `dotenv` does not load `{app}\.env` → `NODE_ENV`, `API_KEY`, `LICENSE_SERVER_URL` unset. |
| **Cause** | `dotenvConfig()` in `config/index.ts` uses **process cwd**, not `path.dirname(process.execPath)`. Shortcuts set `WorkingDir: {app}` but registry auto-start may not. |
| **Fix** | Load `.env` explicitly from `path.join(path.dirname(process.execPath), '.env')` when `isPackagedApp()`. |
| **Files** | `src/config/index.ts`, `installer.iss` (verify all shortcuts use `WorkingDir`) |
| **Do not touch** | Dev `.env` in project root for source runs |

---

### GAP-05 — Migration 401 on non-migration sub-requests

| | |
|---|---|
| **Issue** | User reports “Migration 401” while upload works. |
| **Cause** | Migration **routes** are public, but `ReviewModal` / finalize may call protected endpoints (settings, utilities, verification) or staging calls fail auth if path whitelist regresses. Secondary: user confuses **403 license** or **500 DB** with 401. |
| **Fix** | 1) Audit all Migration frontend calls; ensure review/finalize use only `/api/migration/*` OR attach token. 2) Add Migration page-level auth gate: wait for `ensureAuthToken()` before review modal. 3) Surface exact HTTP status in Migration UI (not generic “failed”). |
| **Files** | `frontend/src/pages/Migration/**`, `src/routes/migration.ts`, `src/middleware/auth.ts` |
| **Do not touch** | Staging streaming worker; stock rebuild on finalize |

---

### GAP-06 — Legacy `DB_PATH` constants in some routes (wrong DB in packaged build)

| | |
|---|---|
| **Issue** | Some pages read/write a different SQLite file than `dbManager` (empty or old data). |
| **Cause** | Many route files still define `const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db')` instead of `config.dbPath`. In Node SEA, `__dirname` does not point at install folder. Migration was fixed; **purchases, settings, sales routes, etc. may not be.** |
| **Fix** | Repo-wide replace: all DB access via `dbManager.getConnection()` or `config.dbPath` only. Add lint/check script blocking `path.resolve(__dirname, 'data', 'app.db')` in `src/routes`. |
| **Files** | `src/routes/*.ts`, `src/services/*.ts` (grep for `__dirname.*data.*app.db`) |
| **Do not touch** | `src/database/connection.ts` singleton pattern |

---

### GAP-07 — Production lazy route first-hit delay / failure

| | |
|---|---|
| **Issue** | First visit to Reports/Mail/Learning: long blank screen or “Coming Soon”; user thinks page broken. |
| **Cause** | `lazyRoute()` in `server.ts` loads heavy modules on first API hit in production. Large SEA bundle + puppeteer/whatsapp deps can timeout on slow PCs. |
| **Fix** | 1) Pre-warm critical routers after DB ready (settings, sales, inventory, migration). 2) Frontend: show “Loading module…” with timeout message. 3) Log lazy load errors to `crash_log`. |
| **Files** | `src/server.ts`, `frontend` page error boundaries |
| **Do not touch** | Do not remove lazy loading entirely (boot time would explode) |

---

### GAP-08 — Missing `LICENSE_SERVER_URL` in portable.env

| | |
|---|---|
| **Issue** | License activate returns 503; user cannot get `license_session_token`. |
| **Cause** | `packaging/portable.env` has no `LICENSE_SERVER_URL`. `POST /api/license/activate` fails with 503. App may still run on legacy `Pass@123` until token mismatch. |
| **Fix** | Add `LICENSE_SERVER_URL` to portable.env template; document offline grace mode; ensure activate writes token and frontend refreshes auth cache. |
| **Files** | `packaging/portable.env`, `installer.iss`, `src/routes/license.ts` |
| **Do not touch** | License gate bypass (currently disabled for testing) until product decision |

---

### GAP-09 — No global “API unavailable” UX

| | |
|---|---|
| **Issue** | Silent failures; user cannot tell 401 vs server down vs still booting. |
| **Cause** | Pages each handle errors locally; no top-level auth/health banner in Layout. |
| **Fix** | Layout-level `AuthReadyProvider`: states `booting | ready | unauthorized | offline`. Show actionable message (“Restart app”, “Activate license”, “Wait for database”). |
| **Files** | `frontend/src/components/Layout.tsx`, new `frontend/src/contexts/AuthReadyContext.tsx` |
| **Do not touch** | Per-page toast patterns |

---

### GAP-10 — Frontend `fetch('/api/auth/bootstrap-token')` bypasses axios retry

| | |
|---|---|
| **Issue** | Bootstrap fails once on boot race; token never attached. |
| **Cause** | `ensureAuthToken` uses raw `fetch`, not `apiClient` interceptors (no 503 retry). |
| **Fix** | Retry bootstrap 5× with backoff; use same base URL helper; on success persist token. |
| **Files** | `frontend/src/services/api.ts` |
| **Do not touch** | x-session-token header name (backend expects it) |

---

## 5. What NOT to touch during this fix pass

| Rule | Reason |
|------|--------|
| Do not set `SKIP_AUTH=true` for production packaged builds | Security; masks real 401 bugs |
| Do not move database back beside `.exe` | Recreates Program Files / VirtualStore data loss |
| Do not remove `/api/migration` auth whitelist | Migration must work on fresh install before license |
| Do not deduplicate medicine names | User business rule |
| Do not remove lazy route loading without measuring boot time | Cold start already optimized |
| Do not break `settingsSync.ts` / cross-page settings broadcast | Recently fixed |
| Do not change `inventory_master.is_active` report logic | Reports depend on it |

---

## 6. Implementation phases (single plan, ordered)

### Phase 1 — Stop 401 for normal use (P0, 1 PR)

| Task | Gap |
|------|-----|
| Load `.env` from exe directory in packaged mode | GAP-04 |
| `/api/health/ready` + frontend boot gate | GAP-02 |
| Strengthen bootstrap retry + Layout auth-ready gate | GAP-01, GAP-10 |
| Clear auth cache on license activate | GAP-01 |
| Log `dbPath` on server start | GAP-03 |

**Exit criteria:** Fresh install → open browser → all pages load data within 60s without manual localStorage clear.

---

### Phase 2 — Migration & DB path correctness (P0, 1 PR)

| Task | Gap |
|------|-----|
| Installer seed DB into LOCALAPPDATA (or verified first-boot copy) | GAP-03 |
| Audit Migration frontend for non-public API calls | GAP-05 |
| Replace all `__dirname` DB_PATH in routes with `config.dbPath` / dbManager | GAP-06 |
| Migration UI shows HTTP status + “auth not ready” message | GAP-05 |

**Exit criteria:** Migration upload → analyze → staging → finalize works on clean Windows install; POS shows same data after finalize.

---

### Phase 3 — Packaged UX & resilience (P1, 1 PR)

| Task | Gap |
|------|-----|
| Global AuthReady / server status banner in Layout | GAP-09 |
| Pre-warm lazy routes: settings, migration, sales, inventory | GAP-07 |
| Add `LICENSE_SERVER_URL` to portable.env + docs | GAP-08 |
| Remove misleading `SKIP_AUTH=true` from portable.env OR document “ignored in production” | GAP-01 |

**Exit criteria:** User always sees why a page failed; Reports/Mail first open < 10s on target PC.

---

### Phase 4 — Verification on real installed PC (required)

| Step | Action |
|------|--------|
| 1 | Clean uninstall; delete `%LOCALAPPDATA%\AI Pharmacy OS` |
| 2 | Install portable setup; launch via desktop shortcut **and** via auto-start path |
| 3 | DevTools → Network: confirm `bootstrap-token` 200 before any 401 |
| 4 | Visit all 22 routes; record pass/fail |
| 5 | Run full migration CSV; verify POS inventory + Settings pharmacy name |
| 6 | Activate license; confirm no 401 after activation |

---

## 7. Quick diagnostic checklist (for support / user on installed PC)

Run these in browser DevTools → Network while app is open:

| Check | Expected | If wrong |
|-------|----------|----------|
| `GET /api/health` | 200 `ok` | Server not running — restart exe |
| `GET /api/health/ready` | 200 when implemented | Wait or DB corrupt |
| `GET /api/auth/bootstrap-token` | 200 + `{ token, source }` | DB not ready (GAP-02) or DB path wrong (GAP-03) |
| `GET /api/settings` with token | 200 | 401 → GAP-01; clear site data for localhost:5174 |
| `GET /api/migration/status` | 200 (no token needed) | Auth whitelist regression |
| `GET /api/medicines/compact` | 200 | DB empty but auth OK |

**User workaround (until fix shipped):**  
1) Fully quit app. 2) Clear browser site data for `http://localhost:5174`. 3) Restart app. 4) Wait 30 seconds before opening Migration or Reports.

---

## 8. Acceptance criteria (definition of done)

- [ ] Zero persistent 401 on `/api/settings` and `/api/migration/*` after fresh install (no manual localStorage clear)
- [ ] All 22 mounted routes load data or show explicit error (not infinite spinner)
- [ ] Migration end-to-end works on packaged Windows build
- [ ] Single database path logged and consistent (`config.dbPath` everywhere)
- [ ] `.env` loaded correctly regardless of shortcut/working directory
- [ ] Support doc updated with database location and auth troubleshooting

---

## 9. Related documents

| Document | Use |
|----------|-----|
| `SMALL_BUG_FIX_PLAN.md` | UI/logic bugs (mostly fixed) |
| `docs/STORAGE_PATH_AND_UI_GAPS_AUDIT.md` | Historical storage audit |
| `packaging/portable.env` | Shipped production env |
| `installer.iss` | Portable installer layout |
| `src/middleware/auth.ts` | Auth whitelist + session rules |
| `frontend/src/services/api.ts` | Bootstrap token client logic |

---

## 10. Changelog

| Date | Change |
|------|--------|
| 2026-08-02 | Initial packaged EXE 401 / pages implementation plan |

---

*End of plan. Implement Phase 1 first — it fixes the majority of “401 + only 6 pages work” reports without risky refactors.*
