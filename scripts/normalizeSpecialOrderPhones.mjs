#!/usr/bin/env node
/**
 * One-shot idempotent cleanup for special_orders.phone (bug P2-08, 2026-08-25).
 *
 * - Rewrites phone values to DIGITS ONLY ("919090636314@c.us@c.us" -> "919090636314").
 * - When the requester NAME embeds exactly one 10-digit mobile number that differs
 *   from the stored phone, the name-embedded digits WIN (real data recorded by the
 *   pharmacist beats a corrupted column; fixes wrong-customer rows like #36).
 *   Nothing is ever invented: no match in the name -> column untouched.
 * - Empty stays empty. No other tables are touched.
 *
 * Usage:  node scripts/normalizeSpecialOrderPhones.mjs [--dry-run]
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'app.db');
const DRY_RUN = process.argv.includes('--dry-run');

if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH);

function extractNamePhone(requester) {
  const runs = String(requester || '').match(/\d{10}/g) || [];
  // Exactly one embedded 10-digit run -> trustworthy; multiple -> ambiguous, skip.
  return runs.length === 1 ? runs[0] : null;
}

const rows = db.prepare('SELECT id, requester, phone FROM special_orders ORDER BY id').all();
const update = db.prepare('UPDATE special_orders SET phone = ? WHERE id = ?');

let cleanedCount = 0;
let nameFixedCount = 0;
let scanned = 0;

for (const row of rows) {
  scanned++;
  const original = String(row.phone ?? '');
  const digits = original.replace(/\D/g, '');
  let next = digits;
  let reason = null;

  const nameDigits = extractNamePhone(row.requester);
  if (nameDigits && digits && digits.slice(-10) !== nameDigits) {
    next = nameDigits;
    reason = 'name-embedded number contradicts stored phone';
  } else if (!digits && nameDigits && !original.trim()) {
    // Only fill an EMPTY phone from the name — never overwrite a present value with a guess.
    next = nameDigits;
    reason = 'empty phone, number found in requester name';
  } else if (digits && digits !== original) {
    reason = 'stripped non-digit formatting/chat-id suffixes';
  }

  if (!reason || next === original) continue;

  if (reason.startsWith('name-embedded')) nameFixedCount++; else cleanedCount++;

  console.log(`#${row.id} [${row.requester}] "${original}" -> "${next}"  (${reason})`);
  if (!DRY_RUN) update.run(next, row.id);
}

console.log('---');
console.log(`Scanned ${scanned} special_orders rows. ` +
  `${cleanedCount} formatting cleanups, ${nameFixedCount} name-corrections. ` +
  (DRY_RUN ? 'DRY RUN — nothing written.' : 'Changes committed.'));

db.close();
