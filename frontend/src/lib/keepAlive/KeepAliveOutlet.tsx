import { Suspense, type ReactNode } from 'react';
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
  fallback?: ReactNode;
}

/**
 * Renders every page visited this session simultaneously, hiding all but the current
 * one with display:none instead of unmounting them. Scroll position, form state, and
 * open modals survive navigation; hidden pages stay mounted so React Query's cache
 * invalidation keeps refreshing them in the background.
 */
export function KeepAliveOutlet({ routes, notFoundElement, fallback }: Props) {
  const location = useLocation();
  const matched = routes.find(r => r.path === location.pathname);

  if (!matched) {
    return <>{notFoundElement}</>;
  }

  return (
    <div key={matched.path} className="h-full w-full flex-1 flex flex-col min-h-0">
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
