# Performance & UX Improvement Plan

Goal: fix the three felt problems without slowing or breaking the app.

1. **Slow data fetch** — data re-fetched from the server on every visit.
2. **Slow scrolling** — big lists keep growing in the DOM; scroll gets heavier the more you scroll.
3. **Page switch takes 1–2s** — pages paint a blank/loading screen while they re-fetch.

Everything here is **local** work only. See the "DO NOT TOUCH" list at the bottom.

---

## Root causes (the "wrappers" and shared code that cause the issue)

These are the shared pieces to understand before touching pages. Most of the lag comes from *how pages fetch*, not from the network or the router.

| # | Where | Problem | Effect |
|---|-------|---------|--------|
| A | `frontend/src/main.tsx` + `frontend/src/lib/queryClient.ts` | React Query is installed and wraps the app (`QueryClientProvider`), with good defaults (`staleTime: 30s`, `refetchOnMount: false`, `gcTime: 5min`) — **but ~22 of 28 pages never use it.** | The cache exists but is bypassed. Every page fetches fresh on mount. |
| B | `frontend/src/hooks/useApiQuery.ts` | The correct wrapper to use (`useApiQuery` / `useApiMutation`). Already built, under-used. | This is the fix — route page fetches through it. |
| C | `useDeferredEffect` + raw `useEffect(() => { api.xxx().then(setState) }, [])` in ~22 pages | Uncached fetch on every mount, no dedup, no shared cache. | The 1–2s blank-then-load on each page switch. |
| D | Ad-hoc module-level caches (e.g. `cachedMedicines` in Database, `cachedItems` in Inventory, `cachedSpecialOrders`/`cachedCommonCombinations` in POS), plus `globalModuleCache` in `hooks/useInfiniteScroll.ts` and `cachedStagedSalesCount` in `App.tsx` | Hand-rolled caching layered on top of an unused React Query. Inconsistent and duplicated. | Works, but should be replaced by React Query so behavior is uniform. Pages that have these already paint instantly — they are lower priority. |
| E | `App.tsx` `Layout` (~lines 1456–1808) | Polling intervals (refills every 15s, staged counts, devices/jobs every 30s) + SSE stream run globally. | Steady background load that can delay a freshly-mounting page's fetches. Leave as-is for now; revisit only if still slow after A–C. |
| F | Big non-virtualized lists rendered all at once (`.map` over thousands of rows) | DOM grows unbounded on infinite scroll. | Slow scroll / rows take time to appear. |
| G | Full-resolution `<img>` in list rows (POS scan previews, CRM WhatsApp media) with no `loading="lazy"` | Images decode at full size during scroll. | Scroll jank. |

---

## Already done (verified: `tsc` + `vite build` both pass)

- **Database scroll** — `frontend/src/pages/Database/index.tsx`
  - Added native `content-visibility: auto` + `contain-intrinsic-size` to each row (browser skips off-screen rows automatically — no library, no layout change).
  - Replaced `selectedIds` array with a `Set` (removes an O(n²) `.includes()` per row).
- **Images** — `POS/index.tsx` (scan previews) and `CRM/index.tsx` (feed media): added `loading="lazy"` + `decoding="async"`.
- **Dashboard caching (pattern reference)** — `frontend/src/pages/Dashboard/index.tsx`: converted raw `useEffect` fetch → `useApiQuery`. Alert dismiss now updates the cache via `queryClient.setQueryData`. **Use this file as the template for every migration below.**

---

## The migration pattern (copy from Dashboard)

**Before:**
```tsx
const [data, setData] = useState<T | null>(null);
const [loading, setLoading] = useState(true);
useEffect(() => { api.getThing().then(d => { setData(d); setLoading(false); }); }, []);
```

**After:**
```tsx
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query'; // only if you mutate the cache

const { data, isLoading: loading, error } = useApiQuery<T>('thing', () => api.getThing());
```

**For writes** that used to do `setData(...)` locally, update the cache instead so the UI stays in sync:
```tsx
const queryClient = useQueryClient();
await api.saveThing(payload);
queryClient.invalidateQueries({ queryKey: ['thing'] });        // simplest: refetch
// or queryClient.setQueryData<T>(['thing'], prev => ...);      // optimistic, no refetch
```

**Rules per page:**
- Give each query a **stable, unique key**. If a fetch depends on filters/search, put those in the key: `['purchases', { search, dateFrom, dateTo }]` — React Query re-fetches automatically when the key changes (this replaces the manual "re-run effect on filter change").
- Do **not** delete a page's module-level cache variable in the same commit — leave it, migrate the fetch, verify, then remove the dead cache in a follow-up.
- Keep debounced-search inputs; only the fetch call moves into `useApiQuery`.
- Preserve SSE streams and polling intervals as-is.

---

## Remaining work — page by page

Migrate one small group at a time, **with the app running**, and click-test after each (see Verification). Ordered easiest/highest-traffic first.

### Batch 1 — simple, load-once pages (low risk)
- [x] `pages/Doctors/index.tsx`
- [x] `pages/Reports/index.tsx`
- [x] `pages/Expiry/index.tsx`
- [x] `pages/Orders/index.tsx` (already client-paginated; just cache the fetch)

### Batch 2 — medium (multiple fetches, some writes)
- [x] `pages/CRM/index.tsx` (13 calls) — keep WhatsApp SSE stream as-is; cache the list fetches only
- [x] `pages/Returns/index.tsx` (10 calls)
- [x] `pages/AutomationCenter/index.tsx` (12 calls) — keep any polling as-is
- [x] `pages/CatalogUpload/index.tsx` (15–18 calls) — keep its SSE stream as-is

### Batch 3 — heavy pages (most fetches; migrate carefully, one per commit)
- [x] `pages/Settings/index.tsx` (18 calls, 0 memoization)
- [x] `pages/Purchases/index.tsx` (22–27 calls) — heavy inline fuzzy-match loops (`utils/fuzzy` `calculateSimilarity`); wrap those results in `useMemo` while here
- [x] `pages/Learning/index.tsx` (32 calls, 2361 lines, 0 memoization)

### Lower priority — already have instant-paint module caches
These already paint from a hand-rolled cache, so the win is smaller. Migrate only after Batches 1–3, mainly to unify the caching approach:
- [x] `pages/POS/index.tsx` (partially on React Query already)
- [x] `pages/Inventory/index.tsx` (already virtualized + cached)
- [x] `pages/Database/index.tsx` (already cached; scroll already fixed)

### Scroll — remaining lists
- [x] Apply the same `content-visibility: auto` + `contain-intrinsic-size` to any remaining big non-virtualized list rows found in Learning / Reports (only where rows are a simple repeated element with a roughly-known height).
- [x] Pages already using `hooks/useVirtualizer.ts` (Inventory, Sells, PurchaseHistory, Investigation, CustomerReturnHistory) need nothing.

### Optional bundle trim (initial load, not page switch)
- [x] `App.tsx` is ~1885 lines and lands in the main eager bundle. Not required, but moving `Layout`/`Topbar` polling + SSE wiring into their own module would shrink the startup chunk. Do this last, only if startup still feels slow.

---

## Verification (run after every page or batch — do not skip)

1. `cd frontend && npx tsc --noEmit -p tsconfig.app.json` → must be clean.
2. `cd frontend && npm run build` → must succeed.
3. With backend on `:3000` and `npm run dev`, in the browser:
   - Open the migrated page → data loads.
   - Navigate away and back within ~30s → it should paint **instantly** from cache (no blank/loading flash).
   - Do a write on that page (save/add/delete/dismiss) → the list updates without a manual refresh.
   - For pages with search/filters → typing still re-queries correctly.
   - **POS/billing especially:** add items, complete a sale, confirm totals and the saved invoice are correct.

Commit one page (or one small batch) at a time so any regression is easy to roll back.

---

## DO NOT TOUCH — Pharmarack files (leave completely alone)

- `frontend/src/pages/PharmarackCart/` (whole folder, incl. `index.tsx`)
- `src/routes/pharmarack.ts`
- `data/pharmarack_profile/`
- `scratch/inspect_pharmarack.cjs`, `scratch/test_pharmarack_endpoints.cjs`
- `tests/pharmarackCartNotif.test.ts`
- `frontend/dist/assets/PharmarackCart-*.js` (build output)

These files **reference** pharmarack internally — you may edit *non-pharmarack* logic in them, but do not change any pharmarack-related code paths:
`frontend/src/App.tsx`, `components/LiveCartAddModal.tsx`, `components/QuickOrderModal.tsx`, `pages/Learning/index.tsx`, `pages/NonMappedDistributors/index.tsx`, `pages/Orders/index.tsx`, `pages/Settings/index.tsx`, `services/api.ts`, `types/api.ts`.
