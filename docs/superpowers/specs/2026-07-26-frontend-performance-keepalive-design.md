# Frontend Performance & Persistent Page State — Design

## Context

Lighthouse against `/pos` scored 32–40 across two runs, both measured against the raw `vite dev` server (`localhost:5173`) — unminified, unbundled, React dev-mode checks on — and one run was additionally contaminated by Chrome extension interference (Lighthouse flagged this explicitly). Separately, routing (`react-router` `<Routes>`/`<Route>` in `frontend/src/App.tsx`) fully unmounts each page on navigation and remounts it from scratch on return; only cart data survives, via `localStorage`. Scroll position, search text, open modals, and tab state do not.

This design covers two independent tracks that were conflated in the original ask but need separate fixes:

- **Track A**: get a real, trustworthy Lighthouse/performance number and fix genuine first-load bottlenecks. Lighthouse measures one fresh navigation to a URL — it never sees client-side route switches, so Track B does not move this number.
- **Track B**: make pages stay mounted across in-app navigation, so switching feels instant, preserves state, and background pages silently receive fresh data. This is a felt-speed/statefulness improvement for daily use, not a Lighthouse-score change.

Both were confirmed with the user as wanted, both to proceed as one implementation effort.

## Goals

- Track A: correct benchmarking (real production build, Incognito, no extensions) and fix concrete first-load bottlenecks in `Layout.tsx` and POS's initial data fetch.
- Track B: once a page is visited, it never unmounts for the rest of the session. Scroll/search/modal/tab state survives navigation away and back. Background (hidden) pages silently receive fresh data after a sale/purchase, via the existing React Query cache. Per-page polling pauses while hidden and resumes on return, so total background network/CPU load stays equivalent to "one active page," not proportional to how many pages have ever been visited this session.

## Non-goals

- Changing the WhatsApp automation backend. Verified independent of frontend page/mount state — see "Verified non-interactions" below. No backend automation code changes as part of this work.
- Adding a frontend test framework. None exists today (no vitest/jest/testing-library in `frontend/package.json`); not introducing one here.
- Restructuring the ~24-route table, switching to a data router, or adding route loaders.
- Replacing `vite dev` for local development — Track A adds a new way to *benchmark* against a production-like build; it does not change the day-to-day dev workflow.

## Track A — Real performance fixes

1. **Correct benchmarking target.** Add `express.static` serving of `frontend/dist` (with SPA fallback to `index.html` for client-side routes) to `src/server.ts`, so there's a real production-like URL to point Lighthouse at. This is additive — `npm run dev` / `vite` on 5173 keeps working exactly as today for development. `compression()` is already globally applied (`src/server.ts:67`), so this inherits gzip/brotli for free — no separate compression work needed. This also doubles as the first real step toward the future headless/SaaS hosting the user described.
2. **Benchmark procedure.** `cd frontend && npm run build`, then hit the Express-served build in Incognito with no extensions. This becomes the trustworthy number going forward; the raw dev-server number is no longer treated as signal.
3. **Defer `Layout.tsx` polling.** The enrichment poll (`frontend/src/components/Layout.tsx` ~line 719, 5s interval) and services-status poll (~line 804) currently start immediately on mount, landing inside Lighthouse's trace window and competing with LCP. Delay their first run until after first paint (short startup delay or `requestIdleCallback`).
4. **POS initial fetch.** Confirm `getCompactInventoryCache` / `isCompactInventoryCacheReady` (`frontend/src/services/api.ts`) don't block POS's first paint; if they do, render the POS shell immediately and stream data in.
5. Re-measure (Incognito, Express-served prod build) after each change, to attribute gains correctly.

## Track B — Keep-alive architecture

### Routing mechanism

Replace direct `<Routes>` rendering in `frontend/src/App.tsx` with a `KeepAliveOutlet`:

- Maintains an ordered list of visited page keys — pathnames that matched a real page component, not a `<Navigate>` redirect route.
- Renders every visited page's lazy component in its own wrapper `div`; exactly one is shown (the current route), the rest are hidden (`display: none`), never unmounted.
- Pure-redirect routes (`/expiry`, `/refills`, `/doctors`, `/dispatch`, `/catalog`, `/customer-returns`, `/customer-returns-history`, `/automation-center`, `/message-listener`, `/non-mapped-distributors`) resolve exactly as today, before reaching the keep-alive layer — they hold no state and don't participate.
- A `PageActiveContext` gives each page a `usePageActive(): boolean`, true only for the currently visible page.
- Each wrapper carries its own error boundary, so a runtime error in a hidden page can't blank the page the user is actually looking at.
- On logout, the visited-pages list is cleared (full unmount of everything) — required so the next login on a shared terminal doesn't inherit the previous user's half-typed search box, open cart, or open modal.

### Polling pause/resume

Seven files currently start `setInterval` unconditionally in a mount `useEffect`:

- `frontend/src/pages/CRM/index.tsx` — `pollId` (~1205), `msgPollId` (~1254)
- `frontend/src/pages/PharmarackCart/index.tsx` — `syncQueueStatus` interval (~273)
- `frontend/src/pages/CompositionQueue/index.tsx` (~242, ~281)
- `frontend/src/pages/Settings/index.tsx` (~632, ~777)
- `frontend/src/pages/Mail/index.tsx` (~292, ~298)
- `frontend/src/pages/Learning/index.tsx` (~382, ~463, ~533)
- `frontend/src/pages/PhoneSales/index.tsx` (~122)

Each gets the same change: gate the interval's lifecycle on `usePageActive()` — clear it when the page goes inactive, restart it (with one immediate poll) when it becomes active again. Existing `clearInterval` cleanup in each effect is reused, not duplicated.

**Verified safe:** all of the above are read-only status/list refreshes (confirmed by reading CRM and PharmarackCart in full) — none trigger a send. Actual WhatsApp delivery runs entirely server-side and independent of frontend mount state:
- `src/services/whatsappQueueWorker.ts` starts its own processing loop in its constructor, at server boot.
- `src/services/pharmarackDailyDispatchService.ts`'s daily delivery-boy batch is driven by a cron job (`src/server.ts:578`, `cron.schedule('* 11 * * *', ...)`), independent of any page ever being visited, with its own two-layer dedup (`hasSentTodaysBatch()` daily flag + per-order `batch_sent` column) across all three of its trigger paths (cron, cart-page-load fallback, cart-empty auto-detection). No changes needed or made to any of this.

### Data freshness

No changes needed to `frontend/src/lib/queryClient.ts` or `frontend/src/utils/cacheInvalidation.ts`. They're already configured for this (`gcTime: 8h`, targeted `invalidateQueries`/`refetchQueries` in `invalidateAfterStockWrite`). The only reason background pages don't already auto-update today is that an unmounted page is not an "active" query observer. Once pages stay mounted (hidden, not gone), React Query's existing invalidation logic reaches them automatically — this is a side effect of Track B's routing change, not new query-layer work.

## Error handling & edge cases

- Background query refetch failures fail silently and retry on next invalidation — no toast for a page the user isn't looking at.
- A runtime error in a hidden page is caught by that page's own error boundary; it doesn't affect the visible page.
- Logout resets the keep-alive registry (full unmount), so no state leaks between users on a shared terminal.
- Query-param-driven tabs within a page (e.g. `/returns?tab=expiry`) continue to work unchanged — the page component isn't remounted, it just re-renders on new `useSearchParams`/`useLocation` values, same as any normal client-side update.
- Known, accepted simplification: if a WhatsApp QR-login flow (Settings/Learning) is mid-scan and the user navigates away, its polling pauses like every other page's and resumes (with an immediate poll) when they look at it again — it won't silently complete in the background. Consistent with the one simple rule everywhere else; can special-case later if this proves annoying in practice.

## Verification

No frontend test framework exists today, so verification is:

1. `cd frontend && npx tsc -b` — must be clean, no new errors.
2. Manual QA: visit ~6 pages (POS, Inventory, CRM, PharmarackCart, Settings, Mail), confirm scroll position/search text/cart tabs survive switching away and back.
3. Trigger a sale in POS, confirm Inventory/Dashboard reflect the change while sitting hidden in the background (switch to them without a manual refresh).
4. DevTools Network tab: confirm each of the 7 polling pages' requests stop while hidden and resume on return.
5. Re-run Lighthouse (Incognito, Express-served prod build) and record the before/after score.

## Out of scope / explicitly not changed

- WhatsApp queue worker, Pharmarack daily-dispatch cron, and their dedup logic — verified correct and independent; not touched.
- Any backend route/service files, beyond adding the one `express.static` block for the frontend build.
- Adding a frontend test framework.
- React's experimental `<Activity>`/Offscreen API — not stable in the React 19 version in use here; a hand-rolled visibility context is used instead.
