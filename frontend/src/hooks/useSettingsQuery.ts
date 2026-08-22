import { apiClient } from '../services/api';
import { useApiQuery } from './useApiQuery';
import { SETTINGS_QUERY_KEY } from '../utils/settingsSync';

/** Settings shared cache key across the SPA. Cached 60s; SSE/settings writes invalidate via queryClient. */
export function useSettingsQuery(enabled = true) {
  return useApiQuery<Record<string, string>>(
    SETTINGS_QUERY_KEY,
    () => apiClient.get('/settings').then((res) => res.data),
    {
      enabled,
      staleTime: 60 * 1000,
      refetchOnMount: false,
    }
  );
}
