/**
 * classifyDrugSchedules.ts — one-shot classifier for medicines.schedule_type.
 *
 * Classifies every row of the master `medicines` table against the REAL retail
 * drug schedules of India's Drugs and Cosmetics Rules, 1945 (H1 / X / H).
 * Reference data lives in src/utils/drugSchedules.ts (single source of truth,
 * shared with the runtime Google-OCR research service).
 *
 * Matching: whole-token matches only on name + generic_name, so e.g.
 * "Phenobarbital" can never be caught by the Schedule X token "Barbital".
 * Priority X > H1 > H (stricter wins when a substance appears in several lists).
 *
 * Safety contract:
 * - Updates ONLY medicines.schedule_type. Never touches inventory_master,
 *   purchases, sales or any other table.
 * - Idempotent. By default it overwrites only machine-written placeholder
 *   values (NULL / '' / 'None'); user-set custom values survive re-runs.
 *   Pass --force to recompute every row from the reference data.
 * - Missing data stays missing: molecules outside these lists remain unclassified.
 *
 * Usage: npx tsx scripts/classifyDrugSchedules.ts [--dry-run] [--force]
 */

import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { classifyRow } from '../src/utils/drugSchedules.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'app.db');
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// Values written by older app code / placeholders that this classifier owns.
const OVERWRITABLE = new Set([null, '', 'None']);

function main() {
  console.log(`Classify target DB: ${DB_PATH}${DRY_RUN ? ' (DRY RUN)' : ''}${FORCE ? ' (FORCE)' : ''}`);
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 30000');
  db.pragma('journal_mode = WAL');

  const rows = db.prepare('SELECT id, name, generic_name, schedule_type FROM medicines').all() as
    Array<{ id: number; name: string; generic_name: string | null; schedule_type: string | null }>;
  console.log(`Scanning ${rows.length} medicine rows...`);

  const updateStmt = DRY_RUN ? null : db.prepare('UPDATE medicines SET schedule_type = ? WHERE id = ?');

  let changed = 0;
  const counts = { X: 0, H1: 0, H: 0 };
  const runBatch = DRY_RUN
    ? (batch: Array<[string, number]>) => { changed += batch.length; }
    : db.transaction((batch: Array<[string, number]>) => {
        for (const [type, id] of batch) {
          updateStmt!.run(type, id);
          changed += 1;
        }
      });

  let batch: Array<[string, number]> = [];
  for (const row of rows) {
    const current = row.schedule_type === undefined ? null : row.schedule_type;
    const type = classifyRow(row.name, row.generic_name);
    if (!type) continue; // outside H/H1/X reference data — leave untouched
    counts[type] += 1;
    const alreadySet = current === type;
    const owned = OVERWRITABLE.has(current);
    if (alreadySet || (!FORCE && !owned)) continue;
    batch.push([type, row.id]);
    if (batch.length >= 5000) {
      runBatch(batch);
      batch = [];
    }
  }
  if (batch.length) runBatch(batch);

  if (!DRY_RUN) {
    // Normalize legacy non-canonical spellings written by older app code.
    db.prepare("UPDATE medicines SET schedule_type = 'H1' WHERE schedule_type = 'Schedule H1'").run();
    db.exec(`CREATE INDEX IF NOT EXISTS idx_medicines_schedule_type_name
             ON medicines(schedule_type, name)`);
  }

  const finalCounts = db.prepare(
    "SELECT COALESCE(schedule_type,'(null)') AS s, COUNT(*) AS c FROM medicines GROUP BY schedule_type ORDER BY c DESC"
  ).all();

  console.log(`\nRows matching reference data: ${counts.H1 + counts.H + counts.X}`);
  console.log(`  Schedule H1 : ${counts.H1}`);
  console.log(`  Schedule X  : ${counts.X}`);
  console.log(`  Schedule H  : ${counts.H}`);
  console.log(`Rows updated${DRY_RUN ? ' (would be)' : ''}: ${changed}`);
  console.log('\nCurrent distribution:');
  for (const r of finalCounts as Array<{ s: string; c: number }>) console.log(`  ${String(r.s).padEnd(14)} ${r.c}`);
  db.close();
}

main();
