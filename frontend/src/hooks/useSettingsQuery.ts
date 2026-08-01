import { apiClient } from '../services/api';
import { useApiQuery } from './useApiQuery';
import { SETTINGS_QUERY_KEY } from '../utils/settingsSync';

/** Fresh settings on mount; shared cache key across the SPA. */
export function useSettingsQuery(enabled = true) {
  return useApiQuery<Record<string, string>>(
    SETTINGS_QUERY_KEY,
    () => apiClient.get('/settings').then((res) => res.data),
    {
      enabled,
      staleTime: 0,
      refetchOnMount: true,
    }
  );
}
