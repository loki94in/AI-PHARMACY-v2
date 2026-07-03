import { useQuery, useQueryClient, QueryClient } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';
import { apiClient } from '../services/api';

interface UseApiQueryOptions<TData, TError> extends Omit<UseQueryOptions<TData, TError>, 'queryKey' | 'queryFn'> {
  enabled?: boolean;
}

export function useApiQuery<TData = unknown, TError = Error>(
  key: string | readonly unknown[],
  fn: () => Promise<TData>,
  options?: UseApiQueryOptions<TData, TError>
) {
  const queryClient = useQueryClient();
  
  return useQuery<TData, TError>({
    queryKey: Array.isArray(key) ? key : [key],
    queryFn: fn,
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 30_000,
    gcTime: options?.gcTime ?? 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: options?.retry ?? 1,
    refetchOnReconnect: false,
    ...options,
  });
}

export function useApiMutation<TData = unknown, TVariables = unknown, TError = Error>(
  fn: (vars: TVariables) => Promise<TData>,
  options?: {
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: TError, variables: TVariables) => void;
    invalidateKeys?: string[][];
  }
) {
  const queryClient = useQueryClient();
  
  return {
    mutate: async (variables: TVariables) => {
      try {
        const data = await fn(variables);
        options?.onSuccess?.(data, variables);
        if (options?.invalidateKeys) {
          await Promise.all(
            options.invalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: key }))
          );
        }
        return data;
      } catch (error) {
        options?.onError?.(error as TError, variables);
        throw error;
      }
    },
    mutateAsync: async (variables: TVariables) => {
      try {
        const data = await fn(variables);
        options?.onSuccess?.(data, variables);
        if (options?.invalidateKeys) {
          await Promise.all(
            options.invalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: key }))
          );
        }
        return data;
      } catch (error) {
        options?.onError?.(error as TError, variables);
        throw error;
      }
    },
  };
}

export function cancelQueries(queryKey: string | readonly unknown[], client?: QueryClient) {
  const queryClient = client || new QueryClient();
  return queryClient.cancelQueries({ queryKey: Array.isArray(queryKey) ? queryKey : [queryKey] });
}