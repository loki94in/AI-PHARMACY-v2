import { QueryClient } from '@tanstack/react-query';
import { clearInfiniteScrollCache } from '../hooks/useInfiniteScroll';

/**
 * Invalidates all relevant query lists and purges infinite scroll caches
 * after a write/mutation to stock, sales, returns, or purchases occurs.
 */
export function invalidateAfterStockWrite(queryClient: QueryClient) {
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
    'crm-doctors'
  ];

  keys.forEach(key => {
    queryClient.invalidateQueries({ queryKey: [key] });
  });

  // Force a silent background refetch of active queries immediately
  queryClient.refetchQueries({ queryKey: ['pos-special-orders'] }).catch(() => {});
  queryClient.refetchQueries({ queryKey: ['pos-common-combinations'] }).catch(() => {});
  queryClient.refetchQueries({ queryKey: ['crm-doctors'] }).catch(() => {});

  // Purge all in-memory infinite scroll caches so unmounted pages fetch fresh on mount
  clearInfiniteScrollCache();

  // Silently reload client-side compact inventory cache in the background
  import('../services/api.js')
    .then(({ api }) => {
      api.getCompactInventory().catch(() => {});
    })
    .catch(err => {
      console.warn('[CacheInvalidation] Failed to import api:', err);
    });
}
