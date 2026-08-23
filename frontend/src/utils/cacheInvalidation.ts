import { QueryClient } from '@tanstack/react-query';
import { clearInfiniteScrollCache } from '../hooks/useInfiniteScroll';

/**
 * Invalidates all relevant query lists and purges infinite scroll caches
 * after a write/mutation to stock, sales, returns, or purchases occurs.
 */
export function invalidateAfterStockWrite(queryClient: QueryClient) {
  clearInfiniteScrollCache();

  const keys = [
    'sells-list',
    'inventory-list',
    'dashboard',
    'investigation-list',
    'reports',
    'pos-common-combinations',
    'purchase-history',
    'purchase-history-list',
    'return-history',
    'customer-returns-history-list',
    'database-medicines',
    'pos-special-orders',
    'special-orders',
    'refills',
    'patient-refills',
    'crm-doctors'
  ];

  keys.forEach(key => {
    queryClient.invalidateQueries({ queryKey: [key] });
  });

  // Dispatch custom window event for real-time live update listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('stock-write-completed'));
  }

  // Explicitly remove stale infinite query caches for sells and inventory
  queryClient.removeQueries({ queryKey: ['sells-list'] });
  queryClient.removeQueries({ queryKey: ['inventory-list'] });

  // Silently background-refetch all currently-mounted (active) stale queries immediately.
  // Unmounted pages will refetch on next visit while showing cached data — no wipe, no spinner.
  queryClient.refetchQueries({ queryKey: ['pos-special-orders'] }).catch(() => {});
  queryClient.refetchQueries({ queryKey: ['pos-common-combinations'] }).catch(() => {});
  queryClient.refetchQueries({ queryKey: ['crm-doctors'] }).catch(() => {});
  queryClient.refetchQueries({ type: 'active', stale: true }).catch(() => {});

  // Silently reload client-side compact inventory cache in the background
  import('../services/api.js')
    .then(({ api }) => {
      api.getCompactInventory().catch(() => {});
    })
    .catch(err => {
      console.warn('[CacheInvalidation] Failed to import api:', err);
    });
}

/**
 * Invalidates all price-related query keys and dispatches a price-updated event.
 */
export function invalidateAfterPriceWrite(queryClient: QueryClient) {
  clearInfiniteScrollCache();

  const keys = [
    'inventory-list',
    'database-medicines',
    'sells-list',
    'dashboard'
  ];

  keys.forEach(key => {
    queryClient.invalidateQueries({ queryKey: [key] });
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('price-updated'));
    window.dispatchEvent(new CustomEvent('stock-write-completed'));
  }

  queryClient.refetchQueries({ type: 'active', stale: true }).catch(() => {});

  import('../services/api.js')
    .then(({ api }) => {
      api.getCompactInventory().catch(() => {});
    })
    .catch(err => {
      console.warn('[CacheInvalidation] Failed to import api:', err);
    });
}
