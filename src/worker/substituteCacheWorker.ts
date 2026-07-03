import { dbManager } from '../database/connection.js';

export async function precomputeSubstitutes(): Promise<void> {
  const db = await dbManager.getConnection();
  try {
    console.log('[SubstituteCacheWorker] Starting substitute pre-computation');

    await db.run('UPDATE substitutes SET is_active = 0 WHERE is_active = 1');

    const medicines = await db.all(
      `SELECT id, name, api_reference, item_type
       FROM medicines
       WHERE api_reference IS NOT NULL OR item_type IS NOT NULL`
    );

    console.log(`[SubstituteCacheWorker] Processing ${medicines.length} medicines`);

    let insertCount = 0;

    for (const med of medicines) {
      if (med.api_reference) {
        const compositionAlts = await db.all(
          `SELECT id, name FROM medicines
           WHERE api_reference = ? AND id != ?
           AND api_reference IS NOT NULL`,
          [med.api_reference, med.id]
        );

        for (const alt of compositionAlts) {
          await db.run(
            `INSERT OR REPLACE INTO substitutes
             (source_medicine_id, substitute_medicine_id, match_type, confidence, is_active)
             VALUES (?, ?, 'composition', 0.95, 1)`,
            [med.id, alt.id]
          );
          insertCount++;
        }
      }

      if (med.item_type) {
        const categoryAlts = await db.all(
          `SELECT id, name FROM medicines
           WHERE item_type = ? AND id != ?
           AND item_type IS NOT NULL
           LIMIT 10`,
          [med.item_type, med.id]
        );

        for (const alt of categoryAlts) {
          await db.run(
            `INSERT OR REPLACE INTO substitutes
             (source_medicine_id, substitute_medicine_id, match_type, confidence, is_active)
             VALUES (?, ?, 'category', 0.70, 1)`,
            [med.id, alt.id]
          );
          insertCount++;
        }
      }
    }

    console.log(`[SubstituteCacheWorker] Pre-computed ${insertCount} substitute relationships`);
  } finally {
    await dbManager.close();
  }
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
