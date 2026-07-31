import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Agentation } from 'agentation';
import { pageImports } from './lib/pageImports';
import { KeepAliveOutlet, type KeepAliveRoute } from './lib/keepAlive/KeepAliveOutlet';
import { queryClient } from './lib/queryClient';
import { api } from './services/api';
import { getTodayString, getNDaysAgoString } from './utils/date';

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

// Lazy-loaded pages (ponytail: code-splitting prevents mounting lag)
const Dashboard = lazy(pageImports['/dashboard']);
const Inventory = lazy(pageImports['/inventory']);
const POS = lazy(pageImports['/pos']);
const Purchases = lazy(pageImports['/purchases']);
const CRM = lazy(pageImports['/crm']);
const PurchaseHistory = lazy(pageImports['/purchase-history']);
const Migration = lazy(pageImports['/migration']);
const Reports = lazy(pageImports['/reports']);
const License = lazy(pageImports['/license']);
const Settings = lazy(pageImports['/settings']);
const Mail = lazy(pageImports['/mail']);
const Returns = lazy(pageImports['/returns']);
const Orders = lazy(pageImports['/orders']);
const Sells = lazy(pageImports['/sells']);
const Learning = lazy(pageImports['/learning']);
const DatabasePage = lazy(pageImports['/database']);
const CompositionQueue = lazy(pageImports['/composition-queue']);
const PharmarackCart = lazy(pageImports['/pharmarack-cart']);
const InvestigationCenter = lazy(pageImports['/investigation']);
const PhoneSales = lazy(pageImports['/phone-sales']);
const DispatchPage = lazy(pageImports['/dispatch']);
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
    // Prefetch all other page chunks in the background after initial render to make page transitions instant
    const timer = setTimeout(() => {
      Object.keys(pageImports).forEach((key) => {
        try {
          pageImports[key]();
        } catch (err) {
          console.warn(`Failed to prefetch page chunk: ${key}`, err);
        }
      });
    }, 1500);

    // Pre-fetch data for key pages so they show instantly with no loading spinner on first visit.
    // Runs 8s after startup — after compact cache + settings load on cold boot.
    const dataTimer = setTimeout(() => {
      // Dashboard — single query
      queryClient.prefetchQuery({
        queryKey: ['dashboard'],
        queryFn: () => api.getDashboard(),
        staleTime: 5 * 60_000,
      }).catch(() => {});

      // Reports — pre-fetch default sales tab for last 30 days
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
    }, 8000);

    return () => {
      clearTimeout(timer);
      clearTimeout(dataTimer);
    };
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Layout theme={theme} setTheme={setTheme}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to="/pos" replace />} />
              <Route path="/expiry" element={<Navigate to="/returns?tab=expiry" replace />} />
              <Route path="/automation-center" element={<Navigate to="/crm?tab=messages" replace />} />
              <Route path="/orders" element={<Navigate to="/crm?tab=special_orders" replace />} />
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
          </Suspense>
        </Layout>
      </Suspense>
      <Agentation key={theme} />
    </BrowserRouter>
  );
}

export default App;
