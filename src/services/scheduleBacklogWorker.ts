import { dbManager } from '../database/connection.js';
import { checkConnectivity } from '../utils/networkDetector.js';
import { onlineDataEnricher } from './onlineDataEnricher.js';

/**
 * Picks a single pre-existing medicine still missing a drug-schedule
 * classification and runs it through the enrichment pipeline (local
 * reference table first, then API/Google fallback under the existing
 * hourly/daily search quotas). Meant to be driven by a slow cron tick
 * (see setupCrons in server.ts) so the whole backlog gets classified
 * gradually — a few per hour — without hammering Google.
 *
 * Ordering by schedule_checked_at (oldest/never-checked first) means an
 * item whose lookup failed just gets deprioritized behind the rest of the
 * backlog rather than retried every tick, while still eventually getting
 * another attempt once everything else has been tried.
 */
export async function processNextScheduleBacklogItem(): Promise<void> {
  const online = await checkConnectivity();
  if (!online) return;

  const db = await dbManager.getConnection();
  let candidate: any;
  try {
    candidate = await db.get(
      `SELECT id, name, manufacturer FROM medicines
       WHERE (schedule_type IS NULL OR schedule_type = 'None')
         AND (enrichment_status IS NULL OR enrichment_status != 'non_pharma')
       ORDER BY schedule_checked_at IS NOT NULL ASC, schedule_checked_at ASC, id ASC
       LIMIT 1`
    );
  } finally {
    await dbManager.close();
  }

  if (!candidate) return;

  try {
    await onlineDataEnricher.enrichMedicineByName(candidate.name, undefined, candidate.manufacturer || undefined);
  } catch (err) {
    console.error(`[ScheduleBacklog] Failed to enrich "${candidate.name}":`, err);
  }
}
