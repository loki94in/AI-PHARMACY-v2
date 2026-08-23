import { QueryClient } from '@tanstack/react-query';
import { clearInfiniteScrollCache } from '../hooks/useInfiniteScroll';

/**
 * Invalidates all relevant query lists and purges infinite scroll caches
 * after a write/mutation to stock, sales, returns, or purchases occurs.
 *
 * Deferred-freshness contract: writes only MARK queries stale
 * (refetchType: 'none'). The visible page's PageQueryTracker refetches its own
 * queries instantly; hidden kept-alive pages refresh on next activation.
 * Never reintroduce eager refetchQueries({type:'active'}) here — it fans one
 * write out into simultaneous refetches across every visited page.
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
    queryClient.invalidateQueries({ queryKey: [key], refetchType: 'none' });
  });

  // Dispatch custom window event for real-time live update listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('stock-write-completed'));
  }

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
    queryClient.invalidateQueries({ queryKey: [key], refetchType: 'none' });
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('price-updated'));
    window.dispatchEvent(new CustomEvent('stock-write-completed'));
  }

  import('../services/api.js')
    .then(({ api }) => {
      api.getCompactInventory().catch(() => {});
    })
    .catch(err => {
      console.warn('[CacheInvalidation] Failed to import api:', err);
    });
}
