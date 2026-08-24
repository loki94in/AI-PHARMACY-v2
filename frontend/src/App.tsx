import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { pageImports } from './lib/pageImports';
import { KeepAliveOutlet, type KeepAliveRoute } from './lib/keepAlive/KeepAliveOutlet';
import { prewarmRoute } from './lib/keepAlive/routePool';
import { queryClient } from './lib/queryClient';
import { api } from './services/api';
import { getTodayString, getNDaysAgoString } from './utils/date';

import { ErrorBoundary } from './components/ErrorBoundary';

// Minimal page-switch loading fallback — renders instantly, no layout shift
const PageLoader = () => (
  <div className="flex-1 flex items-center justify-center h-full">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      <span className="text-xs text-muted font-semibold uppercase tracking-widest">Loading...</span>
    </div>
  </div>
);

// Lazy-load layout to move polling, SSE streams, and heavy components out of the initial bundle (G1/G4)
const Layout = lazy(() => import('./components/Layout'));
const AgentationDev = import.meta.env.DEV ? lazy(() => import('agentation').then(m => ({ default: m.Agentation }))) : null;

// Lazy-loaded pages (ponytail: code-splitting prevents mounting lag)
const Dashboard = lazy(pageImports['/dashboard']);
const Inventory = lazy(pageImports['/inventory']);
const POS = lazy(pageImports['/pos']);
const Purchases = lazy(pageImports['/purchases']);
const CRM = lazy(pageImports['/crm']);
const PurchaseHistory = lazy(pageImports['/purchase-history']);
const Migration = lazy(pageImports['/migration']);
const Reports = lazy(pageImports['/reports']);
const Settings = lazy(pageImports['/settings']);
const Mail = lazy(pageImports['/mail']);
const Returns = lazy(pageImports['/returns']);
const Sells = lazy(pageImports['/sells']);
const DatabasePage = lazy(pageImports['/database']);
const AIEngineering = lazy(pageImports['/ai-engineering']);
const PharmarackCart = lazy(pageImports['/pharmarack-cart']);
const InvestigationCenter = lazy(pageImports['/investigation']);
const PhoneSales = lazy(pageImports['/phone-sales']);
const DispatchPage = lazy(pageImports['/dispatch']);
const Learning = lazy(pageImports['/learning']);
const AuditCenter = lazy(pageImports['/audit']);

// Legacy routes → Pharma Intelligence hub tabs. Query params (e.g. POS's
// /composition-queue?highlight=N) are preserved through the redirect.
const HubRedirect: React.FC<{ tab: string }> = ({ tab }) => {
  const [searchParams] = useSearchParams();
  const merged = new URLSearchParams(searchParams);
  merged.set('tab', tab);
  return <Navigate to={`/ai-engineering?${merged.toString()}`} replace />;
};

// Real pages rendered through KeepAliveOutlet — every path here stays mounted once visited.
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
  { path: '/ai-engineering', element: <AIEngineering /> },
  { path: '/pharmarack-cart', element: <PharmarackCart /> },
  { path: '/migration', element: <Migration /> },
  { path: '/reports', element: <Reports /> },
  { path: '/settings', element: <Settings /> },
  { path: '/mail', element: <Mail /> },
  { path: '/dispatch', element: <DispatchPage /> },
  { path: '/database', element: <DatabasePage /> },
  { path: '/learning', element: <Learning /> },
  { path: '/audit', element: <AuditCenter /> },
];

// ──────────────────────────────────────────────
// App Component
// ──────────────────────────────────────────────
function App() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; }
    catch { return 'dark'; }
  });

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.body.classList.add('light');
      try { localStorage.setItem('feedback-toolbar-theme', 'light'); } catch { }
    } else {
      document.documentElement.classList.remove('light');
      document.body.classList.remove('light');
      try { localStorage.setItem('feedback-toolbar-theme', 'dark'); } catch { }
    }
    try { localStorage.setItem('theme', theme); } catch { }
  }, [theme]);

  useEffect(() => {
    // Prefetch all other page chunks in the background after initial render to make page transitions instant.
    // Staggered in small batches (instead of firing all ~20 chunks at once) to avoid network saturation and
    // to keep heavy, rarely-needed chunks (e.g. the Migration page's Framer Motion dependency) from loading
    // immediately alongside everything else.
    const PREFETCH_BATCH_SIZE = 5;
    const PREFETCH_BATCH_DELAY_MS = 200;
    const pageKeys = Object.keys(pageImports);
    const batches: string[][] = [];
    for (let i = 0; i < pageKeys.length; i += PREFETCH_BATCH_SIZE) {
      batches.push(pageKeys.slice(i, i + PREFETCH_BATCH_SIZE));
    }

    const batchTimers: ReturnType<typeof setTimeout>[] = [];

    const prefetchChunk = (key: string) =>
      Promise.resolve()
        .then(() => pageImports[key]())
        .catch((err) => {
          console.warn(`Failed to prefetch page chunk: ${key}`, err);
        });

    const timer = setTimeout(() => {
      batches.forEach((batch, batchIndex) => {
        batchTimers.push(
          setTimeout(() => {
            Promise.all(batch.map(prefetchChunk));
          }, batchIndex * PREFETCH_BATCH_DELAY_MS)
        );
      });
    }, 1500);

    // Data prefetch for key pages now rides the IDLE warm-mount gate below
    // (first idle>45s + visible window) instead of firing unconditionally at
    // T+8s on every boot — the ungated Reports sales prefetch full-scanned the
    // invoices table on every startup whether or not /reports was ever opened.

    return () => {
      clearTimeout(timer);
      batchTimers.forEach((t) => clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    // Idle warm-mount (root AGENTS.md SPA contract): progressively pre-mount
    // high-traffic pages HIDDEN so their first switch behaves like POS (which
    // mounts at boot as the landing page). Each step fires only while the user
    // is idle (>45s without input) and the tab is visible; page-level data
    // fetching still honors its own useFetchMode / data_fetch_control gates.
    const WARMUP_PATHS = ['/dashboard', '/inventory', '/crm', '/mail', '/purchases', '/settings'];
    let lastInteraction = Date.now();
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const markInteraction = () => { lastInteraction = Date.now(); };
    const step = () => {
      if (idx >= WARMUP_PATHS.length) return;
      const idleFor = Date.now() - lastInteraction;
      if (document.visibilityState === 'visible' && idleFor > 45_000) {
        // One-time data prefetch rides the FIRST idle window: dashboard
        // (landing query) + default Reports sales tab — both only after the
        // user has actually been idle, never during the boot-critical phase.
        if (idx === 0) {
          queryClient.prefetchQuery({
            queryKey: ['dashboard'],
            queryFn: () => api.getDashboard(),
            staleTime: 5 * 60_000,
          }).catch(() => {});

          const today = getTodayString();
          const from30 = getNDaysAgoString(30);
          queryClient.prefetchQuery({
            queryKey: ['reports', 'sales', from30, today],
            queryFn: () => Promise.all([
              api.getReportsSummary({ type: 'sales', fromDate: from30, toDate: today }),
              api.getReportsData({ type: 'sales', fromDate: from30, toDate: today }),
            ]).then(([summary, records]) => ({ summary, records })),
            staleTime: 5 * 60_000,
          }).catch(() => {});
        }
        prewarmRoute(WARMUP_PATHS[idx]);
        idx += 1;
        timer = setTimeout(step, 8000);
      } else {
        timer = setTimeout(step, 5000);
      }
    };
    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('pointermove', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('wheel', markInteraction, { passive: true });
    timer = setTimeout(step, 20_000);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('pointermove', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('wheel', markInteraction);
    };
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Layout theme={theme} setTheme={setTheme}>
            <Routes>
              <Route path="/" element={<Navigate to="/pos" replace />} />
              <Route path="/expiry" element={<Navigate to="/returns?tab=expiry" replace />} />
              <Route path="/automation-center" element={<Navigate to="/crm?tab=messages" replace />} />
              <Route path="/refills" element={<Navigate to="/crm?tab=refills" replace />} />
              <Route path="/message-listener" element={<Navigate to="/dashboard" replace />} />
              <Route path="/non-mapped-distributors" element={<Navigate to="/learning?tab=distributor_layouts" replace />} />
              <Route path="/doctors" element={<Navigate to="/learning?tab=doctors" replace />} />
              <Route path="/catalog" element={<Navigate to="/database?tab=catalog" replace />} />
              <Route path="/customer-returns" element={<Navigate to="/returns?tab=customer" replace />} />
              <Route path="/customer-returns-history" element={<Navigate to="/returns?tab=customer-history" replace />} />
              <Route path="/compliance" element={<HubRedirect tab="compliance" />} />
              <Route path="/schedule-drugs" element={<HubRedirect tab="schedules" />} />
              <Route path="/composition-queue" element={<HubRedirect tab="composition" />} />
              <Route path="*" element={
                <KeepAliveOutlet
                  routes={pageRoutes}
                  fallback={<PageLoader />}
                  notFoundElement={
                    <div className="flex flex-col items-center justify-center h-full text-text p-6 text-center space-y-4">
                      <h1 className="text-3xl font-extrabold">404 — Page Not Found</h1>
                      <p className="text-muted text-sm max-w-md">The requested route does not exist or has been relocated to another workspace tab.</p>
                      <a
                        href="/dashboard"
                        className="px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl shadow-lg hover:bg-primary/90 transition-all inline-flex items-center gap-2"
                      >
                        Return to Dashboard
                      </a>
                    </div>
                  }
                />
              } />
            </Routes>
          </Layout>
        </Suspense>
        {import.meta.env.DEV && AgentationDev && (
          <Suspense fallback={null}>
            <AgentationDev key={theme} />
          </Suspense>
        )}
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
