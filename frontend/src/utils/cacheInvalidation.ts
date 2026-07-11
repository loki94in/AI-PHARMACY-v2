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
    'database-medicines'
  ];

  keys.forEach(key => {
    queryClient.invalidateQueries({ queryKey: [key] });
  });

  // Purge all in-memory infinite scroll caches so unmounted pages fetch fresh on mount
  clearInfiniteScrollCache();
}
