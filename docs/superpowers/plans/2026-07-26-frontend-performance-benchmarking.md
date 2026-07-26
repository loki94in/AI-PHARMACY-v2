# Frontend Performance Benchmarking (Track A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Lighthouse (and staff) a real production-representative build to measure and use, and remove two concrete first-paint bottlenecks in `Layout.tsx`.

**Architecture:** Add an additive `express.static` + SPA-fallback block to the existing Express server so `frontend/dist` can be served for realistic benchmarking, and delay two of `Layout.tsx`'s `setInterval`-based background polls until the browser is idle instead of starting them immediately on mount.

**Tech Stack:** Express 5 (`src/server.ts`), React 19 + Vite 8 (`frontend/`), no new dependencies.

## Global Constraints

- No new npm dependencies (backend or frontend) — implemented with what's already installed.
- `npm run dev` (Vite dev server on 5173) is not changed or removed — this work is additive only.
- No frontend test framework is introduced; verification is `tsc -b` plus documented manual checks.
- `src/services/whatsappQueueWorker.ts` and `src/services/pharmarackDailyDispatchService.ts` are not touched.
- Spec reference: `docs/superpowers/specs/2026-07-26-frontend-performance-keepalive-design.md`.

---

### Task 1: Serve the production frontend build from Express

**Files:**
- Modify: `src/server.ts:191-201`

**Interfaces:**
- Consumes: nothing from other tasks (first task in this plan).
- Produces: `http://localhost:<PORT>/<any-client-route>` now serves `frontend/dist/index.html` (SPA fallback) once `frontend/dist` has been built; `/api/*` is untouched. Later manual Lighthouse runs should target this URL instead of `localhost:5173`.

There is no existing `supertest`/HTTP-route test in this codebase (`src/server.ts` defines `app` and calls `app.listen()` in the same module with no exported, listen-free `app`), and separating them would be an out-of-scope refactor of a large, already-working bootstrap file. Verification here is a manual boot + curl check instead of an automated test — documented explicitly rather than skipped silently.

- [ ] **Step 1: Add the static-serving + SPA-fallback block**

In `src/server.ts`, find this exact block (the last API route registration, four blank lines, then the "Initialize services" comment and the error-handling middleware):

```typescript
app.use('/api', lazyRoute('./routes/medicineAvailability.js'));




// Initialize services that need startup logic
// These would be initialized via dependency injection in a complete refactor

// Error handling middleware - should be last
app.use(notFoundHandler);
app.use(errorHandler);
```

Replace it with:

```typescript
app.use('/api', lazyRoute('./routes/medicineAvailability.js'));

// Serve the built frontend (frontend/dist) for production-style deployments.
// Local development is unaffected — `npm run dev` still runs the Vite dev server on 5173.
const frontendDist = path.resolve(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.use((req, res, next) => {
  // Let unmatched /api/* requests fall through to notFoundHandler below instead of
  // being swallowed by the SPA fallback.
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Initialize services that need startup logic
// These would be initialized via dependency injection in a complete refactor

// Error handling middleware - should be last
app.use(notFoundHandler);
app.use(errorHandler);
```

`express.static` and `path`/`__dirname` are already used elsewhere in this file (`src/server.ts:132`), so no new imports are needed. `compression()` is already applied globally at `src/server.ts:67`, so the served build inherits gzip/brotli automatically.

Note: this repo is on Express 5, where a bare `app.get('*', ...)` wildcard route is no longer valid path-to-regexp syntax. Using `app.use((req, res, next) => {...})` with no path pattern avoids that entirely and works the same on Express 4 or 5.

- [ ] **Step 2: Build the frontend**

Run: `cd frontend && npm run build`
Expected: completes with a `frontend/dist/index.html` and hashed asset files present, no TypeScript errors from `tsc -b`.

- [ ] **Step 3: Boot the server and verify manually**

Run: `npm start` (from the repo root)
Expected console output: `Server is running on http://localhost:3000/test` (or your configured `PORT`).

Then, in a second terminal:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:3000/pos
```
Expected: `200 text/html; charset=UTF-8` — a client-side route with no matching file falls back to `index.html`.

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:3000/api/license
```
Expected: NOT `text/html` — confirms `/api/*` still reaches the real API routes and isn't swallowed by the SPA fallback.

```bash
curl -sI http://localhost:3000/pos | grep -i content-encoding
```
Expected: `content-encoding: gzip` (or `br`), confirming compression is applied to the served build.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: serve built frontend from Express for production-representative benchmarking"
```

---

### Task 2: Defer Layout.tsx's background polling until after first paint

**Files:**
- Modify: `frontend/src/components/Layout.tsx:67-69` (insert helper), `:708-722` (enrichment poll), `:799-806` (services status poll)

**Interfaces:**
- Consumes: nothing from Task 1 (independent change).
- Produces: `deferUntilIdle(fn: () => void): () => void`, a module-level helper in `Layout.tsx`, used by both polling effects in this same file. Not exported — only used within this file.

Both intervals currently call their fetch function and start `setInterval` synchronously the instant `Layout` mounts, which lands inside Lighthouse's LCP measurement window on every page (Layout wraps every route). This task delays the first call (and interval start) until the browser reports idle, or after 2s if `requestIdleCallback` isn't supported.

- [ ] **Step 1: Add the `deferUntilIdle` helper**

In `frontend/src/components/Layout.tsx`, find:

```typescript
import { useFetchMode } from '../hooks/useFetchMode';

// ──────────────────────────────────────────────
// Notification Types
// ──────────────────────────────────────────────
```

Replace with:

```typescript
import { useFetchMode } from '../hooks/useFetchMode';

// Defer non-critical startup work until the browser is idle (falls back to a 2s
// timeout where requestIdleCallback isn't available, e.g. Safari), so it doesn't
// compete with first paint / LCP. Returns a cancel function for effect cleanup.
function deferUntilIdle(fn: () => void): () => void {
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') {
    const handle = ric(fn, { timeout: 3000 });
    return () => (window as any).cancelIdleCallback?.(handle);
  }
  const timeoutId = setTimeout(fn, 2000);
  return () => clearTimeout(timeoutId);
}

// ──────────────────────────────────────────────
// Notification Types
// ──────────────────────────────────────────────
```

- [ ] **Step 2: Defer the enrichment status poll**

Find:

```typescript
    // Poll enrichment status to show/hide the header pill
    const pollEnrichment = async () => {
      try {
        const { data } = await apiClient.get('/enrichment/status');
        setEnrichmentRunning(!!data?.isRunning);
      } catch {
        // silently ignore — don't surface a UI error just for the header pill
      }
    };
    if (enrichmentPollControl.shouldFetch) {
      pollEnrichment();
      const enrichmentPollInterval = setInterval(pollEnrichment, 5000);
      return () => clearInterval(enrichmentPollInterval);
    }
  }, [enrichmentPollControl.shouldFetch]);
```

Replace with:

```typescript
    // Poll enrichment status to show/hide the header pill
    const pollEnrichment = async () => {
      try {
        const { data } = await apiClient.get('/enrichment/status');
        setEnrichmentRunning(!!data?.isRunning);
      } catch {
        // silently ignore — don't surface a UI error just for the header pill
      }
    };
    if (enrichmentPollControl.shouldFetch) {
      let enrichmentPollInterval: ReturnType<typeof setInterval> | undefined;
      const cancelDefer = deferUntilIdle(() => {
        pollEnrichment();
        enrichmentPollInterval = setInterval(pollEnrichment, 5000);
      });
      return () => {
        cancelDefer();
        clearInterval(enrichmentPollInterval);
      };
    }
  }, [enrichmentPollControl.shouldFetch]);
```

- [ ] **Step 3: Defer the services status poll**

Find:

```typescript
  useEffect(() => {
    fetchServicesStatus();
    // Poll faster (every 3s) when queue has pending/sending items, otherwise 8s
    const activeQueue = (waQueueDetail?.counts?.pending || 0) > 0 || waQueueDetail?.isProcessing;
    const intervalMs = activeQueue ? 3000 : 8000;
    const interval = setInterval(fetchServicesStatus, intervalMs);
    return () => clearInterval(interval);
  }, [fetchServicesStatus, waQueueDetail?.counts?.pending, waQueueDetail?.isProcessing]);
```

Replace with:

```typescript
  useEffect(() => {
    // Poll faster (every 3s) when queue has pending/sending items, otherwise 8s
    const activeQueue = (waQueueDetail?.counts?.pending || 0) > 0 || waQueueDetail?.isProcessing;
    const intervalMs = activeQueue ? 3000 : 8000;
    let interval: ReturnType<typeof setInterval> | undefined;
    const cancelDefer = deferUntilIdle(() => {
      fetchServicesStatus();
      interval = setInterval(fetchServicesStatus, intervalMs);
    });
    return () => {
      cancelDefer();
      clearInterval(interval);
    };
  }, [fetchServicesStatus, waQueueDetail?.counts?.pending, waQueueDetail?.isProcessing]);
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Run: `cd frontend && npm run dev`, open `http://localhost:5173/pos` with DevTools open on the Network tab, check "Preserve log", reload.
Expected: no request to `/api/enrichment/status` or `/api/notifications/devices` in roughly the first 2 seconds of the waterfall; both appear shortly after (idle callback or 2s fallback), not at time 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "perf: defer Layout background polling until browser idle"
```

---

## Notes (investigated, no task needed)

- **POS initial data fetch**: `getCompactInventoryCache`/`isCompactInventoryCacheReady` (`frontend/src/services/api.ts:149-158`) are populated by `Layout.tsx`'s own `useEffect` (`frontend/src/components/Layout.tsx:846-856`), which is already a fire-and-forget `useEffect` with no render-blocking `await`. POS only reads whatever's already cached and reacts to an `inventory-cache-ready` event. Confirmed already non-blocking — no change made.
- After both tasks land, re-run Lighthouse against the Express-served build from Task 1 (Incognito, no extensions) and record the before/after score in the spec or a follow-up note.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-26-frontend-performance-benchmarking.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
