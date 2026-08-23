import { useEffect } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';

/**
 * Deferred-SSE contract (root AGENTS.md "Real KeepAlive + freshness rule"):
 *
 * The global SSE listener only MARKS queries stale (refetchType: 'none') so
 * hidden kept-alive pages never burn network/CPU on background refetch storms.
 * This tracker restores classic behavior for the VISIBLE page:
 *
 * - Always records which query hashes resolve (so warm-mounted and revisited
 *   pages know their own data).
 * - While active: an external invalidation (action.type === 'invalidate')
 *   refetches owned queries instantly — identical to pre-deferral behavior.
 * - On activation flip: silently refreshes stale owned queries right after the
 *   instant cached paint.
 */

interface CacheNotifyEventLike {
  query?: Query;
  action?: { type?: string };
}

// page path -> query hashes whose data resolved while that page was visible
const pageOwnedQueryHashes = new Map<string, Set<string>>();

function recordPageQuery(pagePath: string, queryHash: string) {
  let set = pageOwnedQueryHashes.get(pagePath);
  if (!set) {
    set = new Set();
    pageOwnedQueryHashes.set(pagePath, set);
  }
  set.add(queryHash);
}

interface Props {
  pagePath: string;
  active: boolean;
}

export function PageQueryTracker({ pagePath, active }: Props) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const cache = queryClient.getQueryCache();

    const unsubscribe = cache.subscribe((rawEvent) => {
      const event = rawEvent as CacheNotifyEventLike;
      const query = event.query;
      if (!query) return;

      if (event.action?.type === 'success') {
        recordPageQuery(pagePath, query.queryHash);
        return;
      }
      // Fetch-on-invalidate ONLY while this page is visible — hidden kept-alive
      // pages stay deferred until their next activation scan below.
      if (
        active &&
        event.action?.type === 'invalidate' &&
        pageOwnedQueryHashes.get(pagePath)?.has(query.queryHash) &&
        query.state.fetchStatus !== 'fetching'
      ) {
        void query.fetch(undefined, { cancelRefetch: false });
      }
    });

    if (!active) return unsubscribe;

    const owned = pageOwnedQueryHashes.get(pagePath);
    if (owned?.size) {
      owned.forEach(hash => {
        const q = cache.get(hash);
        if (q && q.isStale() && q.state.fetchStatus !== 'fetching') {
          void q.fetch(undefined, { cancelRefetch: false });
        }
      });
    }

    return unsubscribe;
  }, [active, pagePath, queryClient]);

  return null;
}
