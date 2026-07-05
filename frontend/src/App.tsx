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
const Doctors = lazy(pageImports['/doctors']);
const Dispatch = lazy(pageImports['/dispatch']);
const Reports = lazy(pageImports['/reports']);
const License = lazy(pageImports['/license']);
const Settings = lazy(pageImports['/settings']);
const Mail = lazy(pageImports['/mail']);
const Returns = lazy(pageImports['/returns']);
const CatalogUpload = lazy(pageImports['/catalog']);
const Orders = lazy(pageImports['/orders']);
const Expiry = lazy(pageImports['/expiry']);
const Sells = lazy(pageImports['/sells']);
const Learning = lazy(pageImports['/learning']);
const DatabasePage = lazy(pageImports['/database']);
const CompositionQueue = lazy(pageImports['/composition-queue']);
const CustomerReturn = lazy(pageImports['/customer-returns']);
const CustomerReturnHistory = lazy(pageImports['/customer-return-history']);
const PharmarackCart = lazy(pageImports['/pharmarack-cart']);
const NonMappedDistributors = lazy(pageImports['/non-mapped-distributors']);
const AutomationCenter = lazy(pageImports['/automation-center']);
const InvestigationCenter = lazy(pageImports['/investigation']);
const PhoneSales = lazy(pageImports['/phone-sales']);
const Refills = lazy(pageImports['/refills']);

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
              <Route path="/expiry" element={<Expiry />} />
              <Route path="/pos" element={<POS />} />
              <Route path="/sells" element={<Sells />} />
              <Route path="/phone-sales" element={<PhoneSales />} />
              <Route path="/investigation" element={<InvestigationCenter />} />
              <Route path="/purchases" element={<Purchases />} />
              <Route path="/manual-purchase" element={<Purchases />} />
              <Route path="/purchase-history" element={<PurchaseHistory />} />
              <Route path="/crm" element={<CRM />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/automation-center" element={<AutomationCenter />} />
              <Route path="/refills" element={<Refills />} />
              <Route path="/pharmarack-cart" element={<PharmarackCart />} />
              <Route path="/non-mapped-distributors" element={<NonMappedDistributors />} />
              <Route path="/migration" element={<Migration />} />
              <Route path="/doctors" element={<Doctors />} />
              <Route path="/dispatch" element={<Dispatch />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/license" element={<License />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/mail" element={<Mail />} />
              <Route path="/catalog" element={<CatalogUpload />} />
              <Route path="/learning" element={<Learning />} />
              <Route path="/database" element={<DatabasePage />} />
              <Route path="/composition-queue" element={<CompositionQueue />} />
              <Route path="/customer-returns" element={<CustomerReturn />} />
              <Route path="/customer-returns-history" element={<CustomerReturnHistory />} />
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
