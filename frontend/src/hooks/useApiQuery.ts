import { useQuery, useMutation, useQueryClient, QueryClient } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';

export interface UseApiQueryOptions<TData = unknown, TError = Error>
  extends Omit<UseQueryOptions<TData, TError, TData, any>, 'queryKey' | 'queryFn'> {
  enabled?: boolean;
}

export function useApiQuery<TData = unknown, TError = Error>(
  key: string | readonly unknown[],
  fn: () => Promise<TData>,
  options?: UseApiQueryOptions<TData, TError>
) {
  return useQuery<TData, TError, TData, any>({
    queryKey: Array.isArray(key) ? key : [key],
    queryFn: fn,
    enabled: options?.enabled ?? true,
    ...options,
  });
}

export interface UseApiMutationOptions<TData = unknown, TVariables = unknown, TError = Error, TContext = unknown> {
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => void | Promise<unknown>;
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => void | Promise<unknown>;
  onSettled?: (data: TData | undefined, error: TError | null, variables: TVariables, context: TContext | undefined) => void | Promise<unknown>;
  invalidateKeys?: (string | readonly unknown[])[];
  optimisticUpdate?: {
    queryKey: string | readonly unknown[];
    updateFn: (oldData: any, variables: TVariables) => any;
  };
}

export function useApiMutation<TData = unknown, TVariables = unknown, TError = Error, TContext = any>(
  fn: (vars: TVariables) => Promise<TData>,
  options?: UseApiMutationOptions<TData, TVariables, TError, TContext>
) {
  const queryClient = useQueryClient();

  return useMutation<TData, TError, TVariables, any>({
    mutationFn: fn,
    onMutate: async (variables: TVariables) => {
      let context: any = {};
      if (options?.optimisticUpdate) {
        const qKey = Array.isArray(options.optimisticUpdate.queryKey)
          ? options.optimisticUpdate.queryKey
          : [options.optimisticUpdate.queryKey];

        // Cancel outgoing queries to avoid overwriting our optimistic update
        await queryClient.cancelQueries({ queryKey: qKey });

        // Snapshot the previous value
        const previousData = queryClient.getQueryData(qKey);
        context.previousData = previousData;

        // Optimistically update
        queryClient.setQueryData(qKey, (old: any) => options.optimisticUpdate!.updateFn(old, variables));
      }
      return context;
    },
    onError: (err, variables, context) => {
      if (options?.optimisticUpdate && context?.previousData !== undefined) {
        const qKey = Array.isArray(options.optimisticUpdate.queryKey)
          ? options.optimisticUpdate.queryKey
          : [options.optimisticUpdate.queryKey];
        queryClient.setQueryData(qKey, context.previousData);
      }
      options?.onError?.(err, variables, context);
    },
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context);
      if (options?.invalidateKeys) {
        options.invalidateKeys.forEach((key) => {
          const qKey = Array.isArray(key) ? key : [key];
          queryClient.invalidateQueries({ queryKey: qKey });
        });
      }
    },
    onSettled: (data, error, variables, context) => {
      if (options?.optimisticUpdate) {
        const qKey = Array.isArray(options.optimisticUpdate.queryKey)
          ? options.optimisticUpdate.queryKey
          : [options.optimisticUpdate.queryKey];
        queryClient.invalidateQueries({ queryKey: qKey });
      }
      options?.onSettled?.(data, error, variables, context);
    },
  });
}

export function cancelQueries(queryKey: string | readonly unknown[], client?: QueryClient) {
  const queryClient = client || new QueryClient();
  return queryClient.cancelQueries({ queryKey: Array.isArray(queryKey) ? queryKey : [queryKey] });
}