import { dbManager } from '../database/connection.js';

/**
 * Intentionally a no-op. Substitute relationships are resolved via dynamic
 * composition-match lookup at query time instead of precomputed caching.
 * Still called from medicineAvailability.ts, migration.ts, and catalog.ts —
 * do not remove without updating those call sites.
 */
export async function precomputeSubstitutes(): Promise<void> {
  console.log('[SubstituteCacheWorker] Substitute pre-computation is disabled (using dynamic composition-match lookup instead).');
  return;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Periodic scheduler for substitute pre-computation (currently not invoked).
 * The call is deliberately commented out in server.ts to avoid SQLite lock
 * contention on a ~12M row table at boot. Kept in case a lower-risk trigger
 * point is added later.
 */
export function startSubstituteCacheWorker(intervalMs: number = 604800000): void {
  if (intervalId) return;

  console.log(`[SubstituteCacheWorker] Starting with interval ${intervalMs}ms`);
  precomputeSubstitutes().catch(err =>
    console.error('[SubstituteCacheWorker] Initial pre-computation failed:', err)
  );

  intervalId = setInterval(() => {
    precomputeSubstitutes().catch(err =>
      console.error('[SubstituteCacheWorker] Periodic pre-computation failed:', err)
    );
  }, intervalMs);
}

export function stopSubstituteCacheWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[SubstituteCacheWorker] Stopped');
  }
}
