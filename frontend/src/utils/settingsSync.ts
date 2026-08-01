import type { QueryClient } from '@tanstack/react-query';
import { clearDispatchPageCache } from './pageModuleCaches';

export const SETTINGS_QUERY_KEY = ['settings'] as const;

/** Push saved settings into the React Query cache immediately (before refetch completes). */
export function updateSettingsCache(
  queryClient: QueryClient,
  partial: Record<string, string | undefined | null>
): void {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined && v !== null) cleaned[k] = String(v);
  }
  queryClient.setQueryData<Record<string, string>>(SETTINGS_QUERY_KEY, (old) => ({
    ...(old || {}),
    ...cleaned,
  }));
}

/**
 * Notify every page that pharmacy settings, contacts, or delivery boys changed.
 * Clears module caches and refetches active settings queries so UI stays in sync.
 */
export async function broadcastContactDataChanged(queryClient?: QueryClient): Promise<void> {
  clearDispatchPageCache();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('settings-updated'));
    window.dispatchEvent(new CustomEvent('phone-numbers-updated'));
    window.dispatchEvent(new CustomEvent('contacts-updated'));
  }

  if (queryClient) {
    await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    await queryClient.refetchQueries({ queryKey: SETTINGS_QUERY_KEY, type: 'active' });
  }
}
