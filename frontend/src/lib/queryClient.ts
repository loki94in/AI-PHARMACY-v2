import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60_000, // 2 minutes — fast bounce-backs render instantly from cache
      gcTime: 5 * 60_000, // 5 minutes — self-evicting cache window bounds RAM usage to recently touched pages
      refetchOnWindowFocus: false,
      refetchOnMount: false, // Serve instant cached data on page switch without mounting delay
      retry: 1,
      refetchOnReconnect: false,
    },
  },
});