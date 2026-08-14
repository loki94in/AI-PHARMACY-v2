import { useSyncExternalStore } from 'react';

const draftStore = new Map<string, any>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach(fn => fn());
}

/** Set a draft value in memory without triggering component unmount data loss */
export function setDraft<T>(key: string, value: T | ((prev: T) => T)) {
  const current = draftStore.get(key);
  const next = typeof value === 'function' ? (value as (prev: any) => T)(current) : value;
  draftStore.set(key, next);
  notify();
}

/** Get a draft value from memory synchronously */
export function getDraft<T>(key: string): T | undefined {
  return draftStore.get(key);
}

/** Remove a draft from memory */
export function clearDraft(key: string) {
  draftStore.delete(key);
  notify();
}

/**
 * Lightweight, zero-dependency hook for reactive form draft persistence across route switches.
 */
export function useDraftStore<T>(
  key: string,
  initialValue?: T
): [T, (val: T | ((prev: T) => T)) => void] {
  const state = useSyncExternalStore(
    subscribe,
    () => (draftStore.has(key) ? draftStore.get(key) : initialValue),
    () => initialValue
  );

  const set = (val: T | ((prev: T) => T)) => {
    setDraft<T>(key, val);
  };

  return [state as T, set];
}
