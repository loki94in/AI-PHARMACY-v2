# POS & Server Performance Optimization Plan: Instant Cold Boot, Local Cache & 0 Polling

## Context
This implementation plan covers the system-wide performance optimization of the AI Pharmacy OS application, aiming to minimize server startup times, reduce RAM consumption, eliminate unnecessary API polling, and deliver sub-millisecond search latencies on the POS screen.

> [!IMPORTANT]
> **Strict Isolation Constraint**: As explicitly requested by the user, **no files, routers, schedulers, or endpoints in the Pharmarack application and cart logic will be modified, deleted, or changed in any way.** All Pharmarack code and connections (including `src/routes/pharmarack.ts` and `src/services/tokenRefreshScheduler.ts`) remain untouched.

---

## User Review Required

> [!WARNING]
> - **In-Memory Cache TTL**: The compact inventory index is cached client-side for 5 minutes and server-side for 10 minutes. While mutational actions (saving a sale, adding inventory) trigger instant invalidations via a local Event Bus, external database changes made outside the app's UI might take up to 10 minutes to reflect in the POS search unless refreshed manually.
> - **Preloaded Inventory Size**: The compact inventory payload contains essential fields (id, name, batch, stock, price, item code) for all active, in-stock medicines. At 10,000 items, the uncompressed payload is ~2MB (gzipped to ~400KB), which downloads in <100ms on a local network and loads into browser memory (~10MB overhead).

---

## Open Questions

> [!IMPORTANT]
> - Should we include a manual "Sync Inventory" button in the POS header to let pharmacists manually force-refresh the local cache in case of external inventory updates?
> - Confirm if there are any custom background scripts that modify SQLite database files directly without going through the Express API. If so, they will not trigger the cache invalidation event bus, and we should consider adding a periodic poll for cache versioning or a shorter TTL (e.g. 2 minutes).

---

## Proposed Changes

### Database Layer

#### [MODIFY] [database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts)
- Add missing database indexes inside the startup schema checking routine:
  - `idx_inventory_master_quantity` on `inventory_master(quantity)`
  - `idx_inventory_master_expiry` on `inventory_master(expiry_date)`
  - `idx_medicines_generic_name` on `medicines(generic_name)`
  - `idx_medicines_manufacturer` on `medicines(manufacturer)`

#### [MODIFY] [package.json](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/package.json)
- Remove unused dependency `better-sqlite3` to reduce package size, native compilation overhead, and memory footprint.

---

### Backend Services & Middleware

#### [NEW] [inventoryCache.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/inventoryCache.ts)
- Implement a server-side singleton class `InventoryCache` that holds a compact array of all in-stock and unexpired medicines in memory.
- Provide a `rebuild()` method to query the DB and build the cache in ~50ms.
- Automatically set up a 10-minute refresh scheduler, and expose a method to invalidate/rebuild the cache on-demand.

#### [MODIFY] [auth.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/middleware/auth.ts)
- Cache validated API tokens in-memory (with a 5-minute expiry) to eliminate database read operations on every incoming API request.

---

### Backend API Routes

#### [MODIFY] [server.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/server.ts)
- Move `app.listen()` to the top of the startup chain so that the Express server accepts requests immediately (within <20ms).
- Execute database schema verification (`ensureSchema()`) and initial cache warm-up asynchronously in the background.
- Flatten the staggered `setTimeout` initialization pyramid into a flat, readable sequence of `Promise.allSettled` executions.
- Defer non-critical startup tasks (like loading the Telegram bot, checking overdue credit notes, or launching background workers) until after the server is listening.
- Delay the initialization of `productNameFilterService` (which loads the OCR models) to when it's first needed.
- **Maintain Pharmarack Isolation**: Keep the router import (`import pharmarackRouter from './routes/pharmarack.js'`) and the route mounting (`app.use('/api/pharmarack', pharmarackRouter)`) completely unchanged.

#### [MODIFY] [medicines.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/medicines.ts)
- Add `GET /api/medicines/compact` to return the server-side compact inventory cache instantly.
- Add `GET /api/medicines/:id/quick-details` to fetch generic name, composition, and alternatives on-demand when an item is selected.

#### [MODIFY] [sales.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/sales.ts)
- Remove `CAST` queries on numeric columns (like MRP or quantity) to prevent SQLite from running full-table scans.

#### [MODIFY] [inventory.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/inventory.ts)
- Remove `CAST` queries on numeric columns.
- Change the default row limit from 5000 to 200 for paginated lists to optimize payload size and JSON serialization overhead.

---

### Frontend Layer

#### [NEW] [usePageCache.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/hooks/usePageCache.ts)
- Implement a React hook that caches page state (like dashboard stats, sells, inventory rows) in module-level variables.
- Support Stale-While-Revalidate logic: render cached data instantly, trigger silent network refetch, and update state when data returns.
- Add an event listener for `cache-invalidate` custom window events to mark specific cache keys as stale.

#### [MODIFY] [api.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/api.ts)
- Add API endpoints: `getCompactInventory()` and `getMedicineQuickDetails(id)`.

#### [MODIFY] [Layout.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/Layout.tsx)
- Remove the server-sent events (SSE) connection and the 6 background timers that poll the server every 15-30 seconds.
- Trigger `getCompactInventory()` in the background on mount to warm up the frontend cache before the user clicks on the POS tab.

#### [MODIFY] [POS index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx)
- Hydrate the POS search screen instantly from the local module-level cache.
- Filter the local inventory in memory (`filterLocalInventory`) which takes <1ms and performs zero network requests.
- Fall back to an API search only if the local query returns fewer than 15 results.
- Call `getMedicineQuickDetails(id)` on item selection to add it to the cart with full details.
- Persist the full draft cart state to `localStorage` on every change so it survives page reloads or cold boots.

---

## Verification Plan

### Automated Tests
- Run `npm test` to verify database schema, routing, and APIs.
- Write unit tests in `tests/inventoryCache.test.ts` to verify the cache builds and updates correctly on mutational queries.

### Manual Verification
- Measure cold boot timing via `curl` to ensure response is received in <1 second.
- Verify in the browser console that there are 0 active intervals on layout mount and no SSE connections are open.
- Inspect the Network tab in DevTools when typing in the POS search bar and verify that zero network requests are fired until an item is clicked.
- Test saving a bill in POS, navigate to Inventory, and verify that the inventory page displays updated stock amounts seamlessly.
- Verify that all Pharmarack routes and features (distributors list, cart addition) remain fully functional.
