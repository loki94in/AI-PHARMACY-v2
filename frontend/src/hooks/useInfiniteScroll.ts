import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

interface UseInfiniteScrollOptions<T> {
  queryKey: string;
  cacheKey: string;
  fetchPage: (pageParam: number, filters: any) => Promise<{ data: T[]; totalItems: number; totalPages: number }>;
  serverFilters?: any;
  clientFilterFn?: (item: T) => boolean;
  pageSize?: number;
}

const globalModuleCache: Record<string, any[]> = {};
const globalTotalItems: Record<string, number> = {};

export const clearInfiniteScrollCache = (cacheKey?: string) => {
  if (cacheKey) {
    globalModuleCache[cacheKey] = [];
    globalTotalItems[cacheKey] = 0;
  } else {
    Object.keys(globalModuleCache).forEach(k => {
      globalModuleCache[k] = [];
      globalTotalItems[k] = 0;
    });
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('clear-module-cache', { detail: { cacheKey } }));
  }
};

export function useInfiniteScroll<T>({
  queryKey,
  cacheKey,
  fetchPage,
  serverFilters = {},
  clientFilterFn,
  pageSize = 100,
}: UseInfiniteScrollOptions<T>) {
  const [items, setItems] = useState<T[]>(() => {
    return (globalModuleCache[cacheKey] as T[]) || [];
  });

  const [totalItems, setTotalItems] = useState<number>(() => {
    return globalTotalItems[cacheKey] || 0;
  });

  // Listen for global cache clear events to update mounted states immediately
  useEffect(() => {
    const handleClear = (e: Event) => {
      const customEvent = e as CustomEvent;
      const targetKey = customEvent.detail?.cacheKey;
      if (!targetKey || targetKey === cacheKey) {
        setItems([]);
        setTotalItems(0);
      }
    };
    window.addEventListener('clear-module-cache', handleClear);
    return () => window.removeEventListener('clear-module-cache', handleClear);
  }, [cacheKey]);

  const prevFiltersRef = useRef<any>(serverFilters);

  // Clear cache and reset state when server filters change to prevent stale flash
  const filtersChanged = useMemo(() => {
    const changed = JSON.stringify(prevFiltersRef.current) !== JSON.stringify(serverFilters);
    if (changed) {
      prevFiltersRef.current = serverFilters;
    }
    return changed;
  }, [serverFilters]);

  useEffect(() => {
    if (filtersChanged) {
      globalModuleCache[cacheKey] = [];
      globalTotalItems[cacheKey] = 0;
      setItems([]);
      setTotalItems(0);
    }
  }, [filtersChanged, cacheKey]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: [queryKey, serverFilters],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await fetchPage(pageParam, serverFilters);
      return res;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const currentPage = allPages.length;
      if (currentPage >= lastPage.totalPages) {
        return undefined;
      }
      return currentPage + 1;
    },
    staleTime: 30000, // 30 seconds
    gcTime: 300000, // 5 minutes
    refetchOnMount: true,
  });

  // Sync React Query data with local state & module cache
  useEffect(() => {
    if (data && data.pages.length > 0) {
      const flat = data.pages.flatMap(page => page.data);
      globalModuleCache[cacheKey] = flat.slice(0, 200); // Cap in-memory module cache to 200 items
      
      const lastPage = data.pages[data.pages.length - 1];
      if (lastPage && typeof lastPage.totalItems === 'number') {
        globalTotalItems[cacheKey] = lastPage.totalItems;
        setTotalItems(lastPage.totalItems);
      }
      
      setItems(flat);
    }
  }, [data, cacheKey]);

  // Keep latest dependencies in a ref to avoid stale closures in stable callback
  const latestDepsRef = useRef({ hasNextPage, fetchNextPage, isFetching, isFetchingNextPage });
  latestDepsRef.current = { hasNextPage, fetchNextPage, isFetching, isFetchingNextPage };

  // intersection observer for loading more items when scrolling to the bottom
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (node) {
      observerRef.current = new IntersectionObserver(entries => {
        const { hasNextPage: hasNext, fetchNextPage: fetchNext, isFetching: fetching, isFetchingNextPage: fetchingNext } = latestDepsRef.current;
        if (entries[0].isIntersecting && hasNext && !fetching && !fetchingNext) {
          fetchNext();
        }
      });
      observerRef.current.observe(node);
    }
  }, []);

  // Apply synchronous client-side filtering on the retrieved list
  const filteredItems = useMemo(() => {
    return clientFilterFn ? items.filter(clientFilterFn) : items;
  }, [items, clientFilterFn]);

  return {
    items: filteredItems,
    allItems: items,
    totalItems,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    sentinelRef,
  };
}
