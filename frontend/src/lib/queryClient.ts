import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000, // 5 minutes
      gcTime: 10 * 60_000, // 10 minutes
      refetchOnWindowFocus: false,
      refetchOnMount: false, // Serve instant cached data on page switch without mounting delay
      retry: 1,
      refetchOnReconnect: false,
    },
  },
});