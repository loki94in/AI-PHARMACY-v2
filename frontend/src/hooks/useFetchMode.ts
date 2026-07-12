import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/api';
import { DEFAULT_FETCH_MODES, type FetchMode } from '../services/dataFetchControl';
import { useState, useCallback, useEffect } from 'react';

// Shared in-memory cache for manual override activations, so if key is activated,
// it stays active across mounts of the same page/component session.
const manualOverrides = new Set<string>();

export function useFetchMode(key: string) {
  // Use React Query to fetch settings. It shares the same query cache.
  const { data: serverSettings } = useQuery<Record<string, any>>({
    queryKey: ['settings'],
    queryFn: () => apiClient.get('/settings').then(res => res.data),
    staleTime: 5 * 60 * 1000, // cache settings for 5 minutes
  });

  const [localOverride, setLocalOverride] = useState(() => manualOverrides.has(key));

  useEffect(() => {
    if (manualOverrides.has(key)) {
      setLocalOverride(true);
    }
  }, [key]);

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
    } catch (e) {}
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
