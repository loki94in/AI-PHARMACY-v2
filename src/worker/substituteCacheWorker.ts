import { dbManager } from '../database/connection.js';

export async function precomputeSubstitutes(): Promise<void> {
  console.log('[SubstituteCacheWorker] Substitute pre-computation is disabled (using dynamic composition-match lookup instead).');
  return;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

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
