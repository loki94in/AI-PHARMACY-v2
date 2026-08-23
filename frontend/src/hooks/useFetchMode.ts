import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/api';
import { SETTINGS_QUERY_KEY } from '../utils/settingsSync';
import { DEFAULT_FETCH_MODES, type FetchMode } from '../services/dataFetchControl';
import { useState, useCallback } from 'react';

// Shared in-memory cache for manual override activations, so if key is activated,
// it stays active across mounts of the same page/component session.
const manualOverrides = new Set<string>();

interface ServerSettings {
  data_fetch_control?: string;
}

export function useFetchMode(key: string) {
  // Use React Query to fetch settings. It shares the same query cache.
  const { data: serverSettings } = useQuery<ServerSettings>({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => apiClient.get('/settings').then(res => res.data),
    staleTime: 0,
  });

  const [localOverride, setLocalOverride] = useState(() => manualOverrides.has(key));

  // Re-resolve the override from the module cache when the key changes (render-time adjustment)
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setLocalOverride(manualOverrides.has(key));
  }

  // Resolve the current mode for this key
  let mode: FetchMode = DEFAULT_FETCH_MODES[key] || 'auto';

  if (serverSettings && serverSettings.data_fetch_control) {
    try {
      const parsed = JSON.parse(serverSettings.data_fetch_control);
      if (parsed && parsed[key] !== undefined) {
        mode = parsed[key] as FetchMode;
      }
    } catch (e) {
      console.error('[useFetchMode] Error parsing data_fetch_control:', e);
    }
  } else {
    // Synchronous fallback to localStorage if available
    try {
      const stored = localStorage.getItem('data_fetch_control');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed[key] !== undefined) {
          mode = parsed[key] as FetchMode;
        }
      }
    } catch (_e) {}
  }

  // shouldFetch is true if mode is 'auto', or if we manually triggered load
  const shouldFetch = mode === 'auto' || localOverride;

  const requestLoad = useCallback(() => {
    manualOverrides.add(key);
    setLocalOverride(true);
  }, [key]);

  return {
    mode,
    shouldFetch,
    requestLoad,
    loaded: localOverride
  };
}
