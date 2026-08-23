/**
 * Route pool + idle pre-warm registry, split out of KeepAliveOutlet so that
 * file stays a components-only module (react-refresh/only-export-components).
 */

// ponytail: pool is bounded by the fixed route table (~23 entries); lists inside
// pages are virtualized/capped, so no LRU eviction needed.
export const visitedPaths: string[] = [];

const prewarmListeners = new Set<() => void>();

/**
 * Idle warm-up: pre-mounts a route hidden so its FIRST user switch renders
 * instantly (same as POS, which mounts at boot as the landing page). The
 * mounted-hidden page fetches nothing that its own usePageActive()/useFetchMode
 * gates don't already allow — this only moves render cost off the click.
 */
export function prewarmRoute(path: string): boolean {
  if (visitedPaths.includes(path)) return false;
  visitedPaths.push(path);
  prewarmListeners.forEach(l => l());
  return true;
}

export function addPrewarmListener(listener: () => void): () => void {
  prewarmListeners.add(listener);
  return () => { prewarmListeners.delete(listener); };
}
