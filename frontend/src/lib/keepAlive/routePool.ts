import { pageImports } from '../pageImports';

/**
 * Route pool + idle pre-warm registry.
 */
export const visitedPaths: string[] = [];

const prewarmListeners = new Set<() => void>();

/**
 * Idle warm-up: prefetches the code chunk for a route during idle periods so its
 * FIRST user navigation loads and renders instantly without network bundle latency.
 */
export function prewarmRoute(path: string): boolean {
  if (visitedPaths.includes(path)) return false;
  visitedPaths.push(path);
  if (pageImports[path]) {
    pageImports[path]().catch(() => {});
  }
  prewarmListeners.forEach(l => l());
  return true;
}

export function addPrewarmListener(listener: () => void): () => void {
  prewarmListeners.add(listener);
  return () => { prewarmListeners.delete(listener); };
}

