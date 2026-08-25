// Background Job Lane — global serialization for heavy background jobs.
//
// node-cron "missed execution" warnings (observed 2026-08-25, 11:20 IST) happen
// when several scheduled jobs fire in the same minute and pile up on the event
// loop / SQLite write lock. This lane guarantees that any two heavy background
// jobs NEVER run concurrently, regardless of user-configured times, and that
// the same job never overlaps with its own next tick.
//
// Contract (see src/AGENTS.md "Queue & Worker Consolidation"):
//  - New HEAVY background jobs (scans, backups, catalog syncs, archives,
//    recalculations) MUST route their tick body through runHeavyJob().
//  - Deliberately NOT lane-routed: tokenRefreshScheduler heartbeat (P4-exempt,
//    lightweight credential probe) and whatsappQueueWorker dispatch (messaging
//    latency must not queue behind a multi-second scan).
//  - Never call runHeavyJob() from INSIDE a lane-running job and await it —
//    that would deadlock the chain.

const pending = new Set<string>(); // queued OR currently running job names
let chain: Promise<unknown> = Promise.resolve();

export async function runHeavyJob<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | { skipped: true }> {
  if (pending.has(name)) {
    console.log(`[JobLane] '${name}' is still queued/running — skipping this tick.`);
    return { skipped: true };
  }
  pending.add(name);
  const exec = chain.then(async () => {
    try {
      return await fn();
    } finally {
      pending.delete(name);
    }
  });
  // Keep the lane alive no matter how a job ends; surface errors to this caller only.
  chain = exec.catch(() => {});
  try {
    return await exec;
  } catch (err) {
    console.error(`[JobLane] '${name}' failed:`, err);
    throw err;
  }
}

export function isHeavyLaneBusy(): boolean {
  return pending.size > 0;
}
