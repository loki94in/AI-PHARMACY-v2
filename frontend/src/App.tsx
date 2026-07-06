import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Agentation } from 'agentation';
import { pageImports } from './lib/pageImports';

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

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Layout theme={theme} setTheme={setTheme}>
          <Suspense fallback={<PageLoader />}>
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
              <Route path="/automation-center" element={<Navigate to="/crm?tab=automation" replace />} />
              <Route path="/refills" element={<Navigate to="/crm?tab=refills" replace />} />
              <Route path="/pharmarack-cart" element={<PharmarackCart />} />
              <Route path="/non-mapped-distributors" element={<Navigate to="/pharmarack-cart?tab=non-mapped" replace />} />
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
          </Suspense>
        </Layout>
      </Suspense>
      <Agentation key={theme} />
    </BrowserRouter>
  );
}

export default App;
