import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000, // 5 minutes
      gcTime: 8 * 60 * 60_000, // 8 hours — keeps all page data alive for a full working day
      refetchOnWindowFocus: false,
      refetchOnMount: false, // Serve instant cached data on page switch without mounting delay
      retry: 1,
      refetchOnReconnect: false,
    },
  },
});