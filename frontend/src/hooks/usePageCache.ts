import { useApiQuery } from './useApiQuery';
import type { UseApiQueryOptions } from './useApiQuery';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Custom hook to cache page query results with a 15-minute staleTime.
 * Returns query state, manual refetch function, and invalidation controls.
 */
export function usePageCache<TData = unknown, TError = Error>(
  key: string | readonly unknown[],
  fn: () => Promise<TData>,
  options?: UseApiQueryOptions<TData, TError>
) {
  const queryClient = useQueryClient();
  const queryKey = Array.isArray(key) ? key : [key];

  const queryResult = useApiQuery<TData, TError>(
    queryKey,
    fn,
    {
      staleTime: 15 * 60 * 1000, // 15 minutes TTL
      refetchOnWindowFocus: false,
      ...options,
    }
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  return {
    data: queryResult.data,
    isLoading: queryResult.isLoading,
    isFetching: queryResult.isFetching,
    error: queryResult.error,
    refetch: queryResult.refetch,
    invalidate
  };
}
