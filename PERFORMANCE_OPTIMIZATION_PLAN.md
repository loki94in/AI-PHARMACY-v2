# AI Pharmacy v2 — Performance Optimization Plan

## Core Request
> *Cold boot → minimize startup time, RAM usage, unnecessary API calls, and make the PC + app run faster end-to-end*

## Design Principle
> **Inventory must be in memory before the user can start selling from POS.**
> All other optimizations serve this goal.

---

## 1. DESIGN / OUTPUT

### Target User Flow (Post-Optimization)

```
USER OPENS APP (cold boot)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  T+0    → App launches, HTTP server binds
  T+500ms→ Server ready, accepts requests
  T+1s   → Frontend loads → Layout mounts
  T+1.5s → Layout fires: /api/medicines/compact (background)
  T+2s   → User clicks POS (or it's default page)
  T+2.2s → POS hydrates from module cache (if /compact done)
           → User can start typing immediately
  T+3s   → Server services fully initialized (background)
           → Inventory index silently refreshes in background

USER TYPES IN POS SEARCH (after initial load)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Keystroke 1: "p" → too short, no action
  Keystroke 2: "pa" → still <3 chars, no action
  Keystroke 3: "par" → filter cachedInventoryIndex (<1ms, ZERO API calls)
  Keystroke 4: "para" → filter cachedInventoryIndex (<1ms, ZERO API calls)
  Keystroke 5: "parac" → filter cachedInventoryIndex (<1ms, ZERO API calls)
  User clicks "Paracetamol 500mg" → 1 API call for full details
  Total API calls for this flow: 1 (down from 5)
```

---

### Architecture: Inventory Preload System

```
┌─────────────────────────────────────────────────────────┐
│                   FRONTEND (Browser)                     │
│                                                          │
│  Module-level cache (persists across navigations):        │
│  ┌──────────────────────────────────────────────────┐   │
│  │  cachedInventoryIndex: CompactInventoryItem[]     │   │
│  │  cachedInventoryIndexVersion: number              │   │
│  │  lastInventoryFetch: timestamp                    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  POS Component:                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  useState → initialize from cachedInventoryIndex   │   │
│  │  Local search: name.startsWith(q) first            │   │
│  │              → name.includes(q) fallback            │   │
│  │              → batch_no/item_code match            │   │
│  │  Background: fetch /compact every 5 min            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                     HTTP GET /api/medicines/compact
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   BACKEND (Express)                      │
│                                                          │
│  New endpoint: GET /api/medicines/compact                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  SELECT                                          │   │
│  │    m.id AS medicine_id,                          │   │
│  │    m.name,                                       │   │
│  │    im.id AS inventory_id,                        │   │
│  │    im.batch_no,                                  │   │
│  │    im.expiry_date,                               │   │
│  │    COALESCE(im.mrp, m.mrp, 0) AS mrp,            │   │
│  │    im.quantity AS stock_qty,                     │   │
│  │    im.loose_quantity,                            │   │
│  │    im.unit_price,                                │   │
│  │    COALESCE(im.cost_price, 0) AS cost_price,     │   │
│  │    m.item_code,                                  │   │
│  │    m.manufacturer,                               │   │
│  │    m.packaging                                   │   │
│  │  FROM inventory_master im                        │   │
│  │  JOIN medicines m ON im.medicine_id = m.id       │   │
│  │  WHERE im.quantity > 0                           │   │
│  │    AND im.expiry_date >= date('now')             │   │
│  │  ORDER BY m.name ASC, im.expiry_date ASC         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  Compact response: ~200 bytes/item × 10k items = 2MB     │
│  + gzip transfer: ~400KB                                 │
└─────────────────────────────────────────────────────────┘
```

### Improved Data Flow Comparison

| Aspect | Before (Current) | After (Optimized) |
|--------|------------------|-------------------|
| POS search first-keystroke | API call → 3-5 SQL queries → 50-200ms | **<1ms local filter, 0 API calls** |
| POS search per typed character | 1 API call per keystroke (debounced to 300ms) | **0 API calls per keystroke** |
| Page re-visit delay | 10s staleTime → refetch | **Instant (module cache)** |
| Server CPU during POS use | High (CAST + JOIN + substitutes) | **Zero for search, only on item select** |
| Network data transfer | ~3KB per search × 50 searches/day = ~150KB | **2MB once + ~400 bytes per item select** |

---

## 2. EXECUTION PROGRESS

### Phase 0 — POS Inventory Preload (Foundation — DO FIRST)

| # | Task | File(s) | Status | Details |
|---|------|---------|--------|---------|
| 0a | Add `GET /api/medicines/compact` endpoint | `src/routes/medicines.ts` | ⏳ Planned | Single query, no CAST, no pagination, gzip-able |
| 0b | Add `getCompactInventory()` to API service | `frontend/src/services/api.ts` | ⏳ Planned | Axios method calling new endpoint |
| 0c | Add module-level inventory cache in POS | `frontend/src/pages/POS/index.tsx` | ⏳ Planned | `cachedInventoryIndex`, `lastInventoryFetch` |
| 0d | Replace API-driven search with local filter | `frontend/src/pages/POS/index.tsx` | ⏳ Planned | Use `filterLocalInventory(query)` instead of `api.searchMedicine()` |
| 0e | Background refresh interval (5 min) | `frontend/src/pages/POS/index.tsx` | ⏳ Planned | Silent fetch → update cache → update state |
| 0f | On-demand full details on item select | `frontend/src/pages/POS/index.tsx` | ⏳ Planned | Single API call `GET /api/medicines/{id}/quick-details` |
| 0g | Preload on Layout mount (warm cache before user reaches POS) | `frontend/src/components/Layout.tsx` | ⏳ Planned | Kick off fetch early so POS finds cache ready |

### Phase 1 — Cold Boot

| # | Task | File(s) | Status | Details |
|---|------|---------|--------|---------|
| 1a | Flatten setTimeout pyramid → `Promise.allSettled` | `src/server.ts:248-447` | ⏳ Planned | Replace 12 nested callbacks with flat step array |
| 1b | Lazy-init `productNameFilterService` on first use | `src/server.ts:235-245` | ⏳ Planned | Don't load OCR model until first actual OCR request |
| 1c | Defer Telegram bot to T+8s | `src/server.ts:441` | ⏳ Planned | From 31s delay |
| 1d | Share single DB connection reference | `src/server.ts:248-447` | ⏳ Planned | All staggered blocks call `getConnection()` redundantly |
| 1e | Remove unused `better-sqlite3` | `package.json:21` | ⏳ Planned | Saves ~5MB native dep + build time |

### Phase 2 — Unnecessary API Calls

| # | Task | File(s) | Status | Details |
|---|------|---------|--------|---------|
| 2a | Add AbortController to all search calls | `POS/index.tsx`, `Investigation/`, `AutomationCenter/` | ⏳ Planned | Cancel in-flight on new keystroke |
| 2b | Batch camera 3 sequential searches into 1 | `POS/index.tsx:1063-1094` | ⏳ Planned | Combine batch/name/MRP into one query |
| 2c | Debounce batch-on-focus call | `POS/index.tsx:2118` | ⏳ Planned | Fires on every focus, no debounce |
| 2d | Reduce Layout polls (15s → 30s) | `Layout.tsx:1260-1279` | ⏳ Planned | Merge refill poll into 30s cycle |
| 2e | Lazy-render RefillControlSidebar per-page | `Layout.tsx:1493-1499` | ⏳ Planned | Only render on POS/CRM pages |

### Phase 3 — Database Optimization

| # | Task | File(s) | Status | Details |
|---|------|---------|--------|---------|
| 3a | Remove `CAST(col AS TEXT) LIKE` | `inventory.ts:80-96`, `sales.ts:802` | ⏳ Planned | Replace with `BETWEEN` or dedicated numeric params |
| 3b | Add missing indexes | `database.ts` | ⏳ Planned | `inventory_master(expiry_date)`, `inventory_master(quantity)`, `medicines(generic_name)`, `medicines(manufacturer)` |
| 3c | Cache session token in-memory | `middleware/auth.ts:19-29` | ⏳ Planned | 0 DB hits on auth per request |
| 3d | Reduce 5000-row default → 200 | `inventory.ts:49` | ⏳ Planned | Paginated UI doesn't need 5k rows |
| 3e | Merge substitutes + composition queries | `sales.ts:930-1009` | ⏳ Planned | 2 queries → 1 |
| 3f | LEFT JOIN → INNER JOIN | `inventory.ts:56` | ⏳ Planned | medicine_id is non-nullable FK |

### Phase 4 — RAM Optimization

| # | Task | File(s) | Status | Details |
|---|------|---------|--------|---------|
| 4a | Remove activityTracker busy-wait | `utils/activityTracker.ts:23-30` | ⏳ Planned | Polling loop wastes CPU |
| 4b | Hoist dynamic imports in write interceptor | `database/connection.ts:108,141` | ⏳ Planned | Dynamic `import()` on every write |
| 4c | Code-split jspdf 220KB into lazy chunk | `vite.config.ts` | ⏳ Planned | Not in main bundle |
| 4d | Eliminate dual caching | All pages with `cached*` | ⏳ Planned | Module cache OR React Query, not both |

### Phase 5 — Build/Package

| # | Task | File(s) | Status | Details |
|---|------|---------|--------|---------|
| 5a | Add rollup-plugin-visualizer | `vite.config.ts` | ⏳ Planned | Measure actual bundle composition |
| 5b | Add vendor chunk for jspdf | `vite.config.ts` | ⏳ Planned | Split into own lazy chunk |

---

## 3. PROJECT CONTEXT

### Current Architecture (Baseline)

```
BOOT TIMELINE (current)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  T+0    → registerProcessGuardian, Express app, middleware, 30+ route mounts
  T+0    → ensureSchema — creates all tables, indexes, ALTER TABLE migrations
  T+0    → app.listen()
  T+1s   → setTimeout: check automation_enabled, start 12-level nested init
  T+3s   → productNameFilterService.initialize() — loads ALL medicine names into RAM
  T+6s   → WhatsApp Web Puppeteer client (conditional)
  T+9s   → stockCalculatorWorker + substituteCacheWorker start
  T+11s  → Expiry scan catch-up
  T+13s  → tokenRefreshScheduler, messagingQueue, orderFulfillmentService
  T+16s  → Daily check catch-up (refills, credit notes)
  T+19s  → doctorReportingScheduler
  T+21s  → initBackupScheduler
  T+23s  → workerSupervisor.start()
  T+31s  → telegramBotService.initializeOrReloadBot
  TOTAL: ~31 seconds to full readiness

POS SEARCH FLOW (current per keystroke)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Keystroke → useEffect setTimeout 300ms → api.searchMedicine(q)
  → Express: authenticateApiKey (DB query for session token)
  → Express route handler:
    1. Determine if numeric
    2. If numeric >= 3 chars: 1 query with CAST(mrp AS TEXT) LIKE (FULL TABLE SCAN)
    3. If alpha: prefix query (uses index) + fallback infix query (if < 15 results)
    4. Lookup substitutes: 1 query on substitutes table
    5. Lookup substitute inventory: 1 query on inventory_master + medicines
    6. Composition fallback: 1 more query (if alternatives empty)
    TOTAL: 3-5 sequential SQL queries, including full table scans

LAYOUT POLLING (current, always active)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - Refill data: every 15s
  - Staged counts: every 30s (cached)
  - Order alerts: every 30s
  - Catalog jobs: every 30s
  - Device list: every 30s
  - SSE: continuous connection
```

### Key Constraints (from AGENTS.md)

- **No simulated/mock features** — only live data
- **Module-level variable caching** must be preserved (SPA Performance Contract)
- **SPA pages must hydrate instantly** from module cache on mount
- **Network requests must run silently in background** without disrupting user focus
- **Local search must resolve in <30ms** — third-party results stream in asynchronously
- **Always use semantic Tailwind variables** (no raw colors)
- **Must run `node scripts/quick-update.mjs`** after any file change

### Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| 2MB inventory payload could slow first page load on slow networks | Low | gzip reduces to ~400KB; preload on Layout (before user reaches POS) |
| Stale cache shows medicine as in-stock when it just sold out | Low | 5-min TTL is acceptable; stock verified on add-to-cart |
| Large inventory (50k+ items) could cause memory pressure | Low | 50k × 200 bytes = 10MB; still acceptable on desktop; add pagination if needed |
| Flattening setTimeout breaks init order | Medium | Audit dependencies — most are independent |
| Removing CAST LIKE changes numeric search UX | Medium | Use `BETWEEN` ranges or separate numeric param |

---

## 4. VALIDATION

### Success Criteria

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| POS search latency (first keystroke after cache) | 50-200ms (network) | **<1ms** (local) | `performance.now()` in POS search handler |
| API calls per POS search session (10 keystrokes) | ~10 | **0** (until item select) | Chrome DevTools Network tab |
| Server first-request time | ~3s | **<1s** | `curl -w "%{time_total}" http://localhost:3000/api/health` |
| Full service init complete | ~31s | **<8s** | Server console log timestamps |
| DB queries with full table scan (CAST) | 4 query patterns | **0** | `EXPLAIN QUERY PLAN` on search queries |
| Auth DB hits per API call | 1 | **0** | Middleware counter on auth.ts |
| Layout polling intervals | 6 concurrent | **2-3** | DevTools Performance > Timings |
| App baseline RAM (process) | ~400-600MB | **250-350MB** | `ps aux --sort=-%mem` or Task Manager |
| Frontend bundle (jspdf) | ~220KB in main chunk | **in lazy chunk** | `rollup-plugin-visualizer` report |

### Test Commands

```bash
# 1. POS search latency (browser console)
performance.mark('search-start');
const results = filterLocalInventory('paracetamol');
performance.mark('search-end');
performance.measure('pos-search', 'search-start', 'search-end');
console.log(performance.getEntriesByName('pos-search')[0].duration + 'ms');

# 2. Boot time
curl -w "%{time_total}" http://localhost:3000/api/health

# 3. DB query plan (before/after)
sqlite3 data/app.db "EXPLAIN QUERY PLAN SELECT ... FROM inventory_master ..."

# 4. Compact endpoint payload size
curl -s -o /dev/null -w "%{size_download}" http://localhost:3000/api/medicines/compact

# 5. Bundle analysis
npx vite build --config frontend/vite.config.ts && ls -la frontend/dist/

# 6. Memory snapshot
curl http://localhost:3000/api/health
node -e "const u = process.memoryUsage(); console.log('RSS:', Math.round(u.rss/1024/1024)+'MB', 'Heap:', Math.round(u.heapUsed/1024/1024)+'MB')"
```

---

## 5. LIVE STATUS

```
══════════════════════════════════════════════════════════════
  STATUS:  PLAN DESIGNED — ready to implement
  PHASE:   Phase 0 (POS Inventory Preload) is the foundation
  ORDER:   0 → 3 → 2 → 1 → 4 → 5
           (preload first, then DB, then API cleanup, then boot, then RAM, then build)
══════════════════════════════════════════════════════════════
```

### Implementation Order Rationale

1. **Phase 0 (POS Inventory Preload)** — Biggest UX win. Users feel it instantly.
2. **Phase 3 (Database)** — Session token cache + remove CAST = immediate server-side speedup across all requests.
3. **Phase 2 (API Reduction)** — AbortController + poll merging = fewer network requests.
4. **Phase 1 (Cold Boot)** — Flatten boot sequence = faster startup.
5. **Phase 4 (RAM)** — Memory savings across the board.
6. **Phase 5 (Build)** — Bundle optimization for distribution.

### Phase 0 Detailed Steps

```
Step 1: Backend — Add compact endpoint
  └─ src/routes/medicines.ts → add GET /medicines/compact
  └─ Returns: [{medicine_id, inventory_id, name, batch_no, expiry_date, mrp, stock_qty, loose_quantity, unit_price, cost_price, item_code, manufacturer, packaging}]
  └─ No pagination, no CAST, no substitutes, simple JOIN

Step 2: Frontend API — Add method
  └─ frontend/src/services/api.ts → getCompactInventory()
  └─ apiClient.get('/medicines/compact').then(res => res.data)

Step 3: POS — Add module cache
  └─ frontend/src/pages/POS/index.tsx → at module level (line ~74):
  └─   let cachedInventoryIndex: any[] | null = null;
  └─   let lastInventoryFetch = 0;
  └─   const CACHE_TTL = 5 * 60 * 1000;

Step 4: POS — Add local search function
  └─ function filterLocalInventory(query: string): any[] {
  └─   if (!query || query.trim().length < 3) return [];
  └─   const q = query.trim().toLowerCase();
  └─   let results = (cachedInventoryIndex || []).filter(item =>
  └─     item.name.toLowerCase().startsWith(q)
  └─   );
  └─   if (results.length < 15 && q.length >= 3) {
  └─     results = (cachedInventoryIndex || []).filter(item =>
  └─       item.name.toLowerCase().includes(q) ||
  └─       (item.item_code && item.item_code.toLowerCase().includes(q)) ||
  └─       (item.batch_no && item.batch_no.toLowerCase().includes(q))
  └─     );
  └─   }
  └─   return results.slice(0, 30).map(item => ({
  └─     ...item,
  └─     medicine_name: item.name,
  └─     quantity: item.stock_qty,
  └─     alternatives: []
  └─   }));
  └─ }

Step 5: POS — Replace search hooks
  └─ Remove useApiQuery(['medicine-search', ...], () => api.searchMedicine(...))
  └─ Replace with: const searchResults = filterLocalInventory(searchTerm);
  └─ Keep suggestMedicine as fallback for when cache returns < 3 results

Step 6: POS — Background refresh on mount
  └─ useEffect(() => {
  └─   const fetch = async () => {
  └─     const data = await api.getCompactInventory();
  └─     cachedInventoryIndex = data;
  └─     lastInventoryFetch = Date.now();
  └─     setForceRender(prev => prev + 1); // trigger re-render if needed
  └─   };
  └─   if (!cachedInventoryIndex || Date.now() - lastInventoryFetch > CACHE_TTL) fetch();
  └─ }, []);

Step 7: Layout side-effect (pre-warm)
  └─ frontend/src/components/Layout.tsx → on mount, kick off:
  └─   import('./services/api').then(m => m.api.getCompactInventory().then(data => {
  └─     // write to same module cache that POS reads
  └─   }));
```

---

### Rollback Plan

If any phase causes issues:
- **Phase 0**: Revert the POS search to use `api.searchMedicine()` — keep the endpoint but don't use it client-side
- **Phase 1**: Comment out the Promise.allSettled and restore setTimeout chain
- **Phase 3**: Remove added indexes, restore CAST LIKE, restore DB auth check
