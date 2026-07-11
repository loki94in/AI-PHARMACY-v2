import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000, // 5 minutes
      gcTime: 10 * 60_000, // 10 minutes
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      retry: 1,
      refetchOnReconnect: false,
    },
  },
});