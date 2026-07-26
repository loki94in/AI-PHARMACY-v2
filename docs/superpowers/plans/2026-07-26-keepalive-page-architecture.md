# Keep-Alive Page Architecture (Track B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a page is visited, it stays mounted for the rest of the session instead of unmounting on navigation — scroll position, search text, cart tabs, and open modals survive switching pages, and background pages silently pick up fresh data via the existing React Query cache.

**Architecture:** A `KeepAliveOutlet` renders every visited page simultaneously (one visible, the rest `display:none`, never unmounted) behind a `PageActiveContext` that each page can read via `usePageActive()`. Seven pages with their own `setInterval` polling are updated to pause while hidden and resume (with an immediate poll) when shown again, so total background network/CPU load stays equivalent to "one active page" regardless of how many pages have been visited this session.

**Tech Stack:** React 19, react-router-dom v7 (`frontend/`), no new dependencies.

## Global Constraints

- No new npm dependencies.
- React's experimental `<Activity>`/Offscreen API is not used — not stable in the React 19 version installed here. A hand-rolled `display:none` + context approach is used instead.
- No frontend test framework is introduced; verification is `tsc -b` plus documented manual DevTools checks.
- `src/services/whatsappQueueWorker.ts` and `src/services/pharmarackDailyDispatchService.ts` are not touched — confirmed independent of frontend mount state.
- No logout/reset flow is added — see "Notes" at the end of this plan.
- Spec reference: `docs/superpowers/specs/2026-07-26-frontend-performance-keepalive-design.md`.

---

### Task 1: Create the keep-alive primitives

**Files:**
- Create: `frontend/src/lib/keepAlive/PageActiveContext.tsx`
- Create: `frontend/src/lib/keepAlive/PageErrorBoundary.tsx`
- Create: `frontend/src/lib/keepAlive/KeepAliveOutlet.tsx`

**Interfaces:**
- Consumes: nothing from other tasks (first task in this plan).
- Produces: `usePageActive(): boolean` (from `PageActiveContext.tsx`), `KeepAliveOutlet({ routes: KeepAliveRoute[], notFoundElement: ReactNode })` and the `KeepAliveRoute` type (from `KeepAliveOutlet.tsx`). Task 2 imports both from `KeepAliveOutlet.tsx` (which re-exports nothing extra — `KeepAliveRoute` is exported directly from it) and pages in Tasks 3-9 import `usePageActive` from `PageActiveContext.tsx`.

No consumer exists yet, so this task is verified by type-checking only; real behavior is observable once Task 2 wires it into `App.tsx`.

- [ ] **Step 1: Create the page-active context**

Create `frontend/src/lib/keepAlive/PageActiveContext.tsx`:

```tsx
import { createContext, useContext } from 'react';

const PageActiveContext = createContext(true);

export const PageActiveProvider = PageActiveContext.Provider;

/** True only while the calling page is the one currently visible inside KeepAliveOutlet. */
export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}
```

- [ ] **Step 2: Create the per-page error boundary**

Create `frontend/src/lib/keepAlive/PageErrorBoundary.tsx`:

```tsx
import { Component, type ReactNode } from 'react';

interface Props {
  pagePath: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Isolates a runtime crash to one kept-alive page so it can't blank the page the user is looking at. */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[KeepAlive] Page crashed: ${this.props.pagePath}`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center h-full text-muted text-sm">
          This page hit an error. Switch away and back to reload it.
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 3: Create the outlet**

Create `frontend/src/lib/keepAlive/KeepAliveOutlet.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PageActiveProvider } from './PageActiveContext';
import { PageErrorBoundary } from './PageErrorBoundary';

export interface KeepAliveRoute {
  path: string;
  element: ReactNode;
}

interface Props {
  routes: KeepAliveRoute[];
  notFoundElement: ReactNode;
}

/**
 * Renders every page visited this session simultaneously, hiding all but the current
 * one with display:none instead of unmounting them. Scroll position, form state, and
 * open modals survive navigation; hidden pages stay mounted so React Query's cache
 * invalidation keeps refreshing them in the background.
 */
export function KeepAliveOutlet({ routes, notFoundElement }: Props) {
  const location = useLocation();
  const matched = routes.find(r => r.path === location.pathname);
  const currentPath = matched ? matched.path : null;

  const [visited, setVisited] = useState<string[]>(() => (currentPath ? [currentPath] : []));

  useEffect(() => {
    if (currentPath && !visited.includes(currentPath)) {
      setVisited(prev => [...prev, currentPath]);
    }
  }, [currentPath, visited]);

  if (!matched) {
    return <>{notFoundElement}</>;
  }

  return (
    <>
      {visited.map(path => {
        const route = routes.find(r => r.path === path);
        if (!route) return null;
        const isActive = path === currentPath;
        return (
          <div key={path} style={{ display: isActive ? 'contents' : 'none' }}>
            <PageActiveProvider value={isActive}>
              <PageErrorBoundary pagePath={path}>
                {route.element}
              </PageErrorBoundary>
            </PageActiveProvider>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no errors (these files aren't imported anywhere yet, so this just confirms they're individually valid).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/keepAlive
git commit -m "feat: add keep-alive routing primitives (unwired)"
```

---

### Task 2: Wire KeepAliveOutlet into App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `KeepAliveOutlet`, `KeepAliveRoute` from `./lib/keepAlive/KeepAliveOutlet` (Task 1).
- Produces: every real page route now renders through `KeepAliveOutlet` and stays mounted across navigation. Redirect-only routes (`<Navigate>`) are untouched and continue to be handled directly by `<Routes>`.

- [ ] **Step 1: Import KeepAliveOutlet**

Find:

```tsx
import { pageImports } from './lib/pageImports';
```

Replace with:

```tsx
import { pageImports } from './lib/pageImports';
import { KeepAliveOutlet, type KeepAliveRoute } from './lib/keepAlive/KeepAliveOutlet';
```

- [ ] **Step 2: Build the page-routes table**

Find:

```tsx
const NonMappedDistributorsPage = lazy(pageImports['/non-mapped-distributors']);
```

Replace with:

```tsx
const NonMappedDistributorsPage = lazy(pageImports['/non-mapped-distributors']);

// Real pages rendered through KeepAliveOutlet — every path here stays mounted once visited.
// NOTE: /non-mapped-distributors redirects to /learning?tab=distributors (see Routes below),
// so NonMappedDistributorsPage above is intentionally not included here — it wasn't rendered
// by the old route table either.
const pageRoutes: KeepAliveRoute[] = [
  { path: '/dashboard', element: <Dashboard /> },
  { path: '/inventory', element: <Inventory /> },
  { path: '/returns', element: <Returns /> },
  { path: '/pos', element: <POS /> },
  { path: '/sells', element: <Sells /> },
  { path: '/phone-sales', element: <PhoneSales /> },
  { path: '/investigation', element: <InvestigationCenter /> },
  { path: '/purchases', element: <Purchases /> },
  { path: '/manual-purchase', element: <Purchases /> },
  { path: '/purchase-history', element: <PurchaseHistory /> },
  { path: '/crm', element: <CRM /> },
  { path: '/orders', element: <Orders /> },
  { path: '/pharmarack-cart', element: <PharmarackCart /> },
  { path: '/migration', element: <Migration /> },
  { path: '/reports', element: <Reports /> },
  { path: '/license', element: <License /> },
  { path: '/settings', element: <Settings /> },
  { path: '/mail', element: <Mail /> },
  { path: '/learning', element: <Learning /> },
  { path: '/database', element: <DatabasePage /> },
  { path: '/composition-queue', element: <CompositionQueue /> },
];
```

- [ ] **Step 3: Replace the real-page routes with the KeepAliveOutlet wildcard**

Find (the full `<Routes>` block):

```tsx
            <Routes>
              <Route path="/" element={<Navigate to="/pos" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/returns" element={<Returns />} />
              <Route path="/expiry" element={<Navigate to="/returns?tab=expiry" replace />} />
              <Route path="/pos" element={<POS />} />
              <Route path="/sells" element={<Sells />} />
              <Route path="/phone-sales" element={<PhoneSales />} />
              <Route path="/investigation" element={<InvestigationCenter />} />
              <Route path="/purchases" element={<Purchases />} />
              <Route path="/manual-purchase" element={<Purchases />} />
              <Route path="/purchase-history" element={<PurchaseHistory />} />
              <Route path="/crm" element={<CRM />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/automation-center" element={<Navigate to="/crm?tab=messages" replace />} />
              <Route path="/refills" element={<Navigate to="/crm?tab=refills" replace />} />
              <Route path="/pharmarack-cart" element={<PharmarackCart />} />
              <Route path="/message-listener" element={<Navigate to="/dashboard" replace />} />
              <Route path="/non-mapped-distributors" element={<Navigate to="/learning?tab=distributors" replace />} />
              <Route path="/migration" element={<Migration />} />
              <Route path="/doctors" element={<Navigate to="/learning?tab=doctors" replace />} />
              <Route path="/dispatch" element={<Navigate to="/learning?tab=dispatch" replace />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/license" element={<License />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/mail" element={<Mail />} />
              <Route path="/catalog" element={<Navigate to="/database?tab=catalog" replace />} />
              <Route path="/learning" element={<Learning />} />
              <Route path="/database" element={<DatabasePage />} />
              <Route path="/composition-queue" element={<CompositionQueue />} />
              <Route path="/customer-returns" element={<Navigate to="/returns?tab=customer" replace />} />
              <Route path="/customer-returns-history" element={<Navigate to="/returns?tab=customer-history" replace />} />
              <Route path="*" element={
                <div className="flex flex-col items-center justify-center h-full text-muted">
                  <h1 className="text-2xl font-bold mb-2">Coming Soon</h1>
                  <p>This module is currently being migrated to React.</p>
                </div>
              } />
            </Routes>
```

Replace with:

```tsx
            <Routes>
              <Route path="/" element={<Navigate to="/pos" replace />} />
              <Route path="/expiry" element={<Navigate to="/returns?tab=expiry" replace />} />
              <Route path="/automation-center" element={<Navigate to="/crm?tab=messages" replace />} />
              <Route path="/refills" element={<Navigate to="/crm?tab=refills" replace />} />
              <Route path="/message-listener" element={<Navigate to="/dashboard" replace />} />
              <Route path="/non-mapped-distributors" element={<Navigate to="/learning?tab=distributors" replace />} />
              <Route path="/doctors" element={<Navigate to="/learning?tab=doctors" replace />} />
              <Route path="/dispatch" element={<Navigate to="/learning?tab=dispatch" replace />} />
              <Route path="/catalog" element={<Navigate to="/database?tab=catalog" replace />} />
              <Route path="/customer-returns" element={<Navigate to="/returns?tab=customer" replace />} />
              <Route path="/customer-returns-history" element={<Navigate to="/returns?tab=customer-history" replace />} />
              <Route path="*" element={
                <KeepAliveOutlet
                  routes={pageRoutes}
                  notFoundElement={
                    <div className="flex flex-col items-center justify-center h-full text-muted">
                      <h1 className="text-2xl font-bold mb-2">Coming Soon</h1>
                      <p>This module is currently being migrated to React.</p>
                    </div>
                  }
                />
              } />
            </Routes>
```

All 11 redirect routes keep their exact existing behavior (still matched and handled by `<Routes>` directly). Everything else falls through to the wildcard, which is where `KeepAliveOutlet` takes over using the same 21 path→component mappings that used to be individual `<Route>` elements.

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Run: `cd frontend && npm run dev`, open `http://localhost:5173/pos`.
1. Type something into the medicine search box, navigate to Inventory via the sidebar, then navigate back to POS.
   Expected: the search box still has your typed text (today it would be empty — this is the behavior change).
2. Scroll down on a long page (e.g. Inventory's list), navigate away, navigate back.
   Expected: scroll position is preserved.
3. Confirm all 11 redirects still work: visit `/expiry`, `/refills`, `/doctors`, `/dispatch`, `/catalog`, `/automation-center`, `/customer-returns`, `/customer-returns-history`, `/message-listener`, `/non-mapped-distributors`, and `/` — each should still land on its documented target URL.
4. Visit a nonsense path like `/this-does-not-exist`.
   Expected: still shows the "Coming Soon" message.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: route real pages through KeepAliveOutlet so they stay mounted"
```

---

### Task 3: Pause CRM's polling while hidden

**Files:**
- Modify: `frontend/src/pages/CRM/index.tsx`

**Interfaces:**
- Consumes: `usePageActive` from `../../lib/keepAlive/PageActiveContext` (Task 1).
- Produces: no new exports; internal behavior change only.

Verified read-only: this file's two intervals only call `checkStatus()`, `loadChats()` (`GET /messaging/chats`), and `loadMessages()` (`GET /messaging/chats/:id/messages`) — never a send.

- [ ] **Step 1: Import the hook**

Find:

```tsx
import { toastEvent } from '../../services/events';
```

Replace with:

```tsx
import { toastEvent } from '../../services/events';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
```

- [ ] **Step 2: Gate the status/chat-list poll**

Find:

```tsx
  useEffect(() => {
    checkStatus();
    loadChats();
    loadTemplates();

    // Poll status every 5s when not ready (for QR), every 30s when ready (for chat list)
    const pollId = setInterval(() => {
      checkStatus();
      if (isReady) loadChats();
    }, 5_000);
    return () => clearInterval(pollId);
  }, [checkStatus, loadChats, loadTemplates, isReady]);
```

Replace with:

```tsx
  const statusPollActive = usePageActive();

  useEffect(() => {
    checkStatus();
    loadChats();
    loadTemplates();

    // Poll status every 5s when not ready (for QR), every 30s when ready (for chat list) —
    // paused while this page isn't the one visible (keep-alive keeps it mounted in the background).
    if (!statusPollActive) return;
    const pollId = setInterval(() => {
      checkStatus();
      if (isReady) loadChats();
    }, 5_000);
    return () => clearInterval(pollId);
  }, [checkStatus, loadChats, loadTemplates, isReady, statusPollActive]);
```

- [ ] **Step 3: Gate the message-thread poll**

Find:

```tsx
  // Load Thread Messages when activeChat changes
  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      setOcrResults({});
      return;
    }

    const loadMessages = (isInitial = false) => {
      if (isInitial) setLoadingMessages(true);
      apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChat.id)}/messages?limit=500`)
        .then(res => {
          const msgs = Array.isArray(res.data) ? res.data : [];
          setMessages(prev => {
            const optimisticMsgs = prev.filter(m => m.id.startsWith('optimistic_'));
            if (optimisticMsgs.length === 0) return msgs;

            const fetchedBodies = new Set(msgs.map(m => m.body));
            const pendingOptimistic = optimisticMsgs.filter(m => !fetchedBodies.has(m.body));
            return [...msgs, ...pendingOptimistic];
          });
          // Populate ocrResults map from pre-existing DB scans
          const preloaded: Record<string, string> = {};
          for (const msg of msgs) {
            if (msg.scannedResult) {
              try {
                const parsed = JSON.parse(msg.scannedResult);
                const label = parsed?.items?.map((i: any) => i.name || i.medicine_name || i.text).filter(Boolean).join(', ')
                  || parsed?.text?.substring(0, 120);
                if (label) preloaded[msg.id] = label;
              } catch { /* ignore malformed JSON */ }
            }
          }
          setOcrResults(preloaded);
          if (isInitial) setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        })
        .catch(() => { if (isInitial) toastEvent.trigger('Failed to load message history', 'error', '/crm'); })
        .finally(() => { if (isInitial) setLoadingMessages(false); });
    };

    loadMessages(true);
    // Live polling: refresh messages every 10 s when a chat is open
    const msgPollId = setInterval(() => loadMessages(false), 10_000);
    return () => clearInterval(msgPollId);
  }, [activeChat]);
```

Replace with:

```tsx
  const messagePollActive = usePageActive();

  // Load Thread Messages when activeChat changes
  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      setOcrResults({});
      return;
    }

    const loadMessages = (isInitial = false) => {
      if (isInitial) setLoadingMessages(true);
      apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChat.id)}/messages?limit=500`)
        .then(res => {
          const msgs = Array.isArray(res.data) ? res.data : [];
          setMessages(prev => {
            const optimisticMsgs = prev.filter(m => m.id.startsWith('optimistic_'));
            if (optimisticMsgs.length === 0) return msgs;

            const fetchedBodies = new Set(msgs.map(m => m.body));
            const pendingOptimistic = optimisticMsgs.filter(m => !fetchedBodies.has(m.body));
            return [...msgs, ...pendingOptimistic];
          });
          // Populate ocrResults map from pre-existing DB scans
          const preloaded: Record<string, string> = {};
          for (const msg of msgs) {
            if (msg.scannedResult) {
              try {
                const parsed = JSON.parse(msg.scannedResult);
                const label = parsed?.items?.map((i: any) => i.name || i.medicine_name || i.text).filter(Boolean).join(', ')
                  || parsed?.text?.substring(0, 120);
                if (label) preloaded[msg.id] = label;
              } catch { /* ignore malformed JSON */ }
            }
          }
          setOcrResults(preloaded);
          if (isInitial) setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        })
        .catch(() => { if (isInitial) toastEvent.trigger('Failed to load message history', 'error', '/crm'); })
        .finally(() => { if (isInitial) setLoadingMessages(false); });
    };

    loadMessages(true);
    // Live polling: refresh messages every 10s when a chat is open — paused while hidden.
    if (!messagePollActive) return;
    const msgPollId = setInterval(() => loadMessages(false), 10_000);
    return () => clearInterval(msgPollId);
  }, [activeChat, messagePollActive]);
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

With the app running (Task 2 must be done first for this to be observable), open DevTools Network tab, filter on `messaging`, navigate to `/crm`.
Expected: requests to `/api/messaging/chats` roughly every 5s.
Navigate to `/pos`.
Expected: no more `/api/messaging/*` requests appear.
Navigate back to `/crm`.
Expected: an immediate request fires, then polling resumes every 5s.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CRM/index.tsx
git commit -m "perf: pause CRM polling while page is hidden"
```

---

### Task 4: Pause PharmarackCart's queue-status polling while hidden

**Files:**
- Modify: `frontend/src/pages/PharmarackCart/index.tsx`

**Interfaces:**
- Consumes: `usePageActive` from `../../lib/keepAlive/PageActiveContext` (Task 1).
- Produces: no new exports; internal behavior change only.

Verified read-only: `syncQueueStatus` only calls `api.getWhatsAppQueueStatus()` to update on-screen badges (`sentWaStatusMap`) — never sends a message. Real sending/dispatch is entirely backend-driven (`src/services/whatsappQueueWorker.ts`, `src/services/pharmarackDailyDispatchService.ts`), unaffected by this change.

- [ ] **Step 1: Import the hook**

Find:

```tsx
import NonMappedDistributors from '../NonMappedDistributors';
```

Replace with:

```tsx
import NonMappedDistributors from '../NonMappedDistributors';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
```

- [ ] **Step 2: Gate the queue-status poll**

Find:

```tsx
  // Poll WhatsApp queue status to dynamically sync distributor order badges (queued -> sending -> success / error)
  useEffect(() => {
    let isMounted = true;
```

Replace with:

```tsx
  const pageActive = usePageActive();

  // Poll WhatsApp queue status to dynamically sync distributor order badges (queued -> sending -> success / error)
  useEffect(() => {
    if (!pageActive) return;
    let isMounted = true;
```

Then find:

```tsx
    syncQueueStatus();
    const interval = setInterval(syncQueueStatus, 3500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [distributors, sentWaStatusMap]);
```

Replace with:

```tsx
    syncQueueStatus();
    const interval = setInterval(syncQueueStatus, 3500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [distributors, sentWaStatusMap, pageActive]);
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

DevTools Network tab, filter on `whatsapp/queue` (or `getWhatsAppQueueStatus`'s endpoint), navigate to `/pharmarack-cart`.
Expected: a request roughly every 3.5s.
Navigate away, confirm it stops; navigate back, confirm it resumes immediately.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PharmarackCart/index.tsx
git commit -m "perf: pause PharmarackCart queue-status polling while page is hidden"
```

---

### Task 5: Pause CompositionQueue's status polling while hidden

**Files:**
- Modify: `frontend/src/pages/CompositionQueue/index.tsx`

**Interfaces:**
- Consumes: `usePageActive` from `../../lib/keepAlive/PageActiveContext` (Task 1).
- Produces: no new exports; internal behavior change only.

The second interval in this file (inside `handleStopEnrichment`, ~line 281) is a short-lived, user-initiated poll that self-terminates once the backend confirms enrichment stopped (or the component would unmount, which no longer happens — see the note at the end of this task). It's intentionally left as-is; only the unconditional background status poll is gated here.

- [ ] **Step 1: Import the hook**

Find:

```tsx
import { useFetchMode } from '../../hooks/useFetchMode';
```

Replace with:

```tsx
import { useFetchMode } from '../../hooks/useFetchMode';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
```

- [ ] **Step 2: Gate the status poll**

Find:

```tsx
  useEffect(() => {
    if (!status?.isRunning || !statusPollControl.shouldFetch) return;
    const timer = setInterval(loadStatus, 3000);
    return () => clearInterval(timer);
  }, [status?.isRunning, loadStatus, statusPollControl.shouldFetch]);
```

Replace with:

```tsx
  const pageActive = usePageActive();

  useEffect(() => {
    if (!status?.isRunning || !statusPollControl.shouldFetch || !pageActive) return;
    const timer = setInterval(loadStatus, 3000);
    return () => clearInterval(timer);
  }, [status?.isRunning, loadStatus, statusPollControl.shouldFetch, pageActive]);
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Start an enrichment run on `/composition-queue` so `status.isRunning` is true. DevTools Network tab, confirm `loadStatus`'s endpoint (`/enrichment/status` or similar — check the Network tab for the exact path this build uses) polls every 3s. Navigate away, confirm it stops. Navigate back, confirm it resumes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CompositionQueue/index.tsx
git commit -m "perf: pause CompositionQueue status polling while page is hidden"
```

---

### Task 6: Pause Settings' WhatsApp QR polling while hidden

**Files:**
- Modify: `frontend/src/pages/Settings/index.tsx`

**Interfaces:**
- Consumes: `usePageActive` from `../../lib/keepAlive/PageActiveContext` (Task 1).
- Produces: no new exports; internal behavior change only.

The second interval in this file (inside `handleOpenLoginWindow`, ~line 777) polls for up to 3 minutes waiting for a Pharmarack login completed in a separate Chrome window, then self-terminates. It's intentionally left ungated for the same reason as CompositionQueue's stop-poll — see the note at the end of this plan.

- [ ] **Step 1: Import the hook**

Find:

```tsx
import { useQueryClient } from '@tanstack/react-query';
```

Replace with:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
```

- [ ] **Step 2: Gate the QR poll**

Find:

```tsx
  useEffect(() => {
    let timer: any;
    if (whatsappEnabled && !waStatus.isReady) {
      const fetchQR = async () => {
        if (document.visibilityState !== 'visible') return;
        try {
          const { data } = await apiClient.get('/messaging/qr');
          setWaStatus(data);
        } catch (error) {
          console.error("Failed to fetch WhatsApp QR", error);
        }
      };

      fetchQR(); // Initial fetch
      timer = setInterval(fetchQR, 15000); // Poll every 15s (optimized from 5s)

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          fetchQR();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [whatsappEnabled, waStatus.isReady]);
```

Replace with:

```tsx
  const pageActive = usePageActive();

  useEffect(() => {
    let timer: any;
    if (whatsappEnabled && !waStatus.isReady && pageActive) {
      const fetchQR = async () => {
        if (document.visibilityState !== 'visible') return;
        try {
          const { data } = await apiClient.get('/messaging/qr');
          setWaStatus(data);
        } catch (error) {
          console.error("Failed to fetch WhatsApp QR", error);
        }
      };

      fetchQR(); // Initial fetch
      timer = setInterval(fetchQR, 15000); // Poll every 15s (optimized from 5s)

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          fetchQR();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [whatsappEnabled, waStatus.isReady, pageActive]);
```

This composes with the existing `document.visibilityState` check rather than replacing it: polling now pauses if either the SPA page isn't active *or* the OS/browser tab isn't visible.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

With WhatsApp not yet connected, open `/settings`, DevTools Network tab, confirm `/api/messaging/qr` polls every 15s. Navigate away, confirm it stops. Navigate back, confirm an immediate request fires and polling resumes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Settings/index.tsx
git commit -m "perf: pause Settings WhatsApp QR polling while page is hidden"
```

---

### Task 7: Pause Mail's background refresh intervals while hidden

**Files:**
- Modify: `frontend/src/pages/Mail/index.tsx`

**Interfaces:**
- Consumes: `usePageActive` from `../../lib/keepAlive/PageActiveContext` (Task 1).
- Produces: no new exports; internal behavior change only.

The one-time cold-cache sync (`syncDelay`) is left as-is — it only fires once per mount, not on a recurring basis.

- [ ] **Step 1: Import the hook**

Find:

```tsx
import { useNavigate, useLocation } from 'react-router-dom';
```

Replace with:

```tsx
import { useNavigate, useLocation } from 'react-router-dom';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
```

- [ ] **Step 2: Gate the two recurring intervals**

Find:

```tsx
  useDeferredEffect(() => {
    // Only do an immediate IMAP sync on first visit (cold cache).
    // On subsequent visits the page shows cached data instantly with no flicker.
    let syncDelay: ReturnType<typeof setTimeout> | undefined;
    if (cachedEmails.length === 0 && imapSyncControl.shouldFetch) {
      syncDelay = setTimeout(() => triggerSync(), 1500);
    }

    // Periodic background refresh: re-read local DB every 30s (silent, no loading indicator).
    let refreshInterval: ReturnType<typeof setInterval> | undefined;
    if (inboxRefreshControl.shouldFetch) {
      refreshInterval = setInterval(() => silentRefreshLocal(), 30000);
    }

    // Periodic IMAP sync every 2 minutes.
    let syncInterval: ReturnType<typeof setInterval> | undefined;
    if (imapSyncControl.shouldFetch) {
      syncInterval = setInterval(() => triggerSync(), 120000);
    }

    return () => {
      if (syncDelay) clearTimeout(syncDelay);
      if (refreshInterval) clearInterval(refreshInterval);
      if (syncInterval) clearInterval(syncInterval);
    };
  }, [triggerSync, silentRefreshLocal, imapSyncControl.shouldFetch, inboxRefreshControl.shouldFetch]);
```

Replace with:

```tsx
  const pageActive = usePageActive();

  useDeferredEffect(() => {
    // Only do an immediate IMAP sync on first visit (cold cache).
    // On subsequent visits the page shows cached data instantly with no flicker.
    let syncDelay: ReturnType<typeof setTimeout> | undefined;
    if (cachedEmails.length === 0 && imapSyncControl.shouldFetch) {
      syncDelay = setTimeout(() => triggerSync(), 1500);
    }

    // Periodic background refresh: re-read local DB every 30s (silent, no loading indicator).
    // Paused while this page isn't the one visible.
    let refreshInterval: ReturnType<typeof setInterval> | undefined;
    if (inboxRefreshControl.shouldFetch && pageActive) {
      refreshInterval = setInterval(() => silentRefreshLocal(), 30000);
    }

    // Periodic IMAP sync every 2 minutes. Paused while this page isn't the one visible.
    let syncInterval: ReturnType<typeof setInterval> | undefined;
    if (imapSyncControl.shouldFetch && pageActive) {
      syncInterval = setInterval(() => triggerSync(), 120000);
    }

    return () => {
      if (syncDelay) clearTimeout(syncDelay);
      if (refreshInterval) clearInterval(refreshInterval);
      if (syncInterval) clearInterval(syncInterval);
    };
  }, [triggerSync, silentRefreshLocal, imapSyncControl.shouldFetch, inboxRefreshControl.shouldFetch, pageActive]);
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Open `/mail`, DevTools Network tab, wait 30s and confirm a silent local refresh request fires. Navigate away for over 30s, confirm no refresh request fires while gone. Navigate back, confirm refresh resumes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Mail/index.tsx
git commit -m "perf: pause Mail background refresh intervals while page is hidden"
```

---

### Task 8: Pause Learning's QR and Pharmarack-health polling while hidden

**Files:**
- Modify: `frontend/src/pages/Learning/index.tsx`

**Interfaces:**
- Consumes: `usePageActive` from `../../lib/keepAlive/PageActiveContext` (Task 1).
- Produces: no new exports; internal behavior change only.

The login-window poll (`handleOpenLoginWindow`, ~line 463) is the same bounded/self-terminating pattern as Settings' — intentionally left ungated (see the note at the end of this plan).

- [ ] **Step 1: Import the hook**

Find:

```tsx
import { createPortal } from 'react-dom';
```

Replace with:

```tsx
import { createPortal } from 'react-dom';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
```

- [ ] **Step 2: Gate the WhatsApp QR poll**

Find:

```tsx
  useEffect(() => {
    let timer: any;
    if (settingsData?.whatsapp_enabled === 'true' && !waStatus.isReady && qrPollControl.shouldFetch) {
      const fetchQR = async () => {
        try {
          const { data } = await apiClient.get('/messaging/qr');
          setWaStatus(data);
        } catch (error) {
          console.error("Failed to fetch WhatsApp QR", error);
        }
      };
      fetchQR();
      timer = setInterval(fetchQR, 5000);
    }
    return () => clearInterval(timer);
  }, [settingsData?.whatsapp_enabled, waStatus.isReady, qrPollControl.shouldFetch]);
```

Replace with:

```tsx
  const qrPollActive = usePageActive();

  useEffect(() => {
    let timer: any;
    if (settingsData?.whatsapp_enabled === 'true' && !waStatus.isReady && qrPollControl.shouldFetch && qrPollActive) {
      const fetchQR = async () => {
        try {
          const { data } = await apiClient.get('/messaging/qr');
          setWaStatus(data);
        } catch (error) {
          console.error("Failed to fetch WhatsApp QR", error);
        }
      };
      fetchQR();
      timer = setInterval(fetchQR, 5000);
    }
    return () => clearInterval(timer);
  }, [settingsData?.whatsapp_enabled, waStatus.isReady, qrPollControl.shouldFetch, qrPollActive]);
```

- [ ] **Step 3: Gate the Pharmarack health-check poll**

Find:

```tsx
  useEffect(() => {
    const initPr = async () => {
      try {
        const { data } = await apiClient.get('/pharmarack/auto-verify');
        setPrHealth(data);
      } catch (err) {
        console.error('Failed initial Pharmarack verification:', err);
      }
    };
    initPr();
    
    const interval = setInterval(checkPrHealth, 180000); // Poll every 3 minutes
    return () => clearInterval(interval);
  }, []);
```

Replace with:

```tsx
  const healthPollActive = usePageActive();

  useEffect(() => {
    const initPr = async () => {
      try {
        const { data } = await apiClient.get('/pharmarack/auto-verify');
        setPrHealth(data);
      } catch (err) {
        console.error('Failed initial Pharmarack verification:', err);
      }
    };
    initPr();

    if (!healthPollActive) return;
    const interval = setInterval(checkPrHealth, 180000); // Poll every 3 minutes
    return () => clearInterval(interval);
  }, [healthPollActive]);
```

Note the original effect had an empty `[]` dependency array (deliberately running `initPr()` only once on mount, ignoring `checkPrHealth` identity changes). Adding `healthPollActive` preserves that intent — `initPr()` still only reruns if the page were to remount (which no longer happens once mounted), while the interval itself now correctly starts/stops as the page's active state changes.

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Open `/learning` with WhatsApp not connected, DevTools Network tab, confirm `/api/messaging/qr` polls every 5s; navigate away/back, confirm pause/resume. Separately, confirm `/api/pharmarack/auto-verify` fires once on first visit (unaffected either way, since it's outside the gated interval).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Learning/index.tsx
git commit -m "perf: pause Learning QR and Pharmarack health polling while page is hidden"
```

---

### Task 9: Pause PhoneSales' polling while hidden

**Files:**
- Modify: `frontend/src/pages/PhoneSales/index.tsx`

**Interfaces:**
- Consumes: `usePageActive` from `../../lib/keepAlive/PageActiveContext` (Task 1).
- Produces: no new exports; internal behavior change only.

- [ ] **Step 1: Import the hook**

Find:

```tsx
import { Link } from 'react-router-dom';
```

Replace with:

```tsx
import { Link } from 'react-router-dom';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
```

- [ ] **Step 2: Gate the staged-sales/device-data poll**

Find:

```tsx
  useEffect(() => {
    fetchStagedSales();
    fetchDeviceData();
    // Poll data every 8 seconds
    const interval = setInterval(() => {
      fetchStagedSales();
      fetchDeviceData();
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchStagedSales, fetchDeviceData]);
```

Replace with:

```tsx
  const pageActive = usePageActive();

  useEffect(() => {
    fetchStagedSales();
    fetchDeviceData();
    // Poll data every 8 seconds — paused while this page isn't the one visible.
    if (!pageActive) return;
    const interval = setInterval(() => {
      fetchStagedSales();
      fetchDeviceData();
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchStagedSales, fetchDeviceData, pageActive]);
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Open `/phone-sales`, DevTools Network tab, confirm `/api/notifications/devices` and the staged-sales endpoint poll every 8s. Navigate away, confirm it stops. Navigate back, confirm an immediate refetch then resumed polling.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PhoneSales/index.tsx
git commit -m "perf: pause PhoneSales polling while page is hidden"
```

---

## Notes

- **Bounded/self-terminating polls left ungated, by design**: `CompositionQueue`'s stop-enrichment confirmation poll (~line 281), and the Pharmarack login-window polls in `Settings` (~line 777) and `Learning` (~line 463). Each is a short-lived poll (seconds to ~3 minutes max) that a user explicitly started and that stops itself once it gets a result — not the "runs forever in the background" pattern this plan targets. Accepted trade-off: if a user starts one of these and navigates away before it resolves, it'll finish silently in the background rather than pausing (since it's not gated), matching how it already behaves today. Gating these would add complexity without addressing the actual problem (unbounded background chatter across many pages).
- **No logout-triggered reset**: the "Log out" button in `frontend/src/components/Layout.tsx:1145-1147` currently has no `onClick` handler at all — there is no logout flow in this app today. The design spec called for resetting the keep-alive registry on logout (so a shared terminal doesn't leak one user's in-progress state to the next); since there's nothing to hook that into right now, no reset code is added in this plan. If/when a logout flow is built, clearing `KeepAliveOutlet`'s mounted pages (e.g. by changing its `key` prop from the parent, forcing a fresh instance) should be added as part of that work.
- After all 9 tasks land, re-run the manual QA pass from the design spec's Verification section and re-check Lighthouse using the Track A plan's Express-served build.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-26-keepalive-page-architecture.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
