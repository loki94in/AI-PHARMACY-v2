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


