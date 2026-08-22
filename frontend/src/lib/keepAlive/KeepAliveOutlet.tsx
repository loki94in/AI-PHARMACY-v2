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

// ponytail: pool is bounded by the fixed route table (~23 entries); lists inside
// pages are virtualized/capped, so no LRU eviction needed.
const visitedPaths: string[] = [];

/**
 * Renders every page visited this session simultaneously, hiding all but the current
 * one with display:none instead of unmounting them. Scroll position, form state, and
 * open modals survive navigation; hidden pages stay mounted so SSE-driven listeners
 * and React Query cache invalidation keep refreshing them in the background.
 *
 * Pages receive real visibility via PageActiveProvider: usePageActive() is true only
 * for the currently shown route, gating focus-refetches and background polls.
 */
export function KeepAliveOutlet({ routes, notFoundElement, fallback }: Props) {
  const location = useLocation();
  const matched = routes.find(r => r.path === location.pathname);

  if (!matched) {
    return <>{notFoundElement}</>;
  }

  if (!visitedPaths.includes(matched.path)) {
    visitedPaths.push(matched.path);
  }

  return (
    <>
      {visitedPaths.map(path => {
        const route = routes.find(r => r.path === path);
        if (!route) return null;
        const isActive = path === matched.path;
        return (
          <div
            key={path}
            className="h-full w-full flex-1 flex flex-col min-h-0"
            style={isActive ? undefined : { display: 'none' }}
            aria-hidden={!isActive}
          >
            <PageActiveProvider value={isActive}>
              <PageErrorBoundary pagePath={path}>
                <Suspense fallback={fallback || null}>
                  {route.element}
                </Suspense>
              </PageErrorBoundary>
            </PageActiveProvider>
          </div>
        );
      })}
    </>
  );
}
