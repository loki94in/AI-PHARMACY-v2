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
