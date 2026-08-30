import { Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PageActiveProvider } from './PageActiveContext';
import { PageQueryTracker } from './PageQueryTracker';
import { PageErrorBoundary } from './PageErrorBoundary';

export interface KeepAliveRoute {
  path: string;
  element: ReactNode;
}

interface Props {
  routes: KeepAliveRoute[];
  notFoundElement: ReactNode;
  fallback?: ReactNode;
}

/**
 * Renders the active page, suspending inactive page UI to release DOM nodes,
 * timers, listeners, and React Query observers when navigating away.
 * Data cache is preserved globally in React Query for instant cache-first painting.
 */
export function KeepAliveOutlet({ routes, notFoundElement, fallback }: Props) {
  const location = useLocation();

  const matched = routes.find(r => r.path === location.pathname);

  if (!matched) {
    return <>{notFoundElement}</>;
  }

  return (
    <div
      key={matched.path}
      className="h-full w-full flex-1 flex flex-col min-h-0"
    >
      <PageQueryTracker pagePath={matched.path} active={true} />
      <PageActiveProvider value={true}>
        <PageErrorBoundary pagePath={matched.path}>
          <Suspense fallback={fallback || null}>
            {matched.element}
          </Suspense>
        </PageErrorBoundary>
      </PageActiveProvider>
    </div>
  );
}

