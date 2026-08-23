/**
importMedicineNames.mjs — one-shot master-catalog name importer.

Extracts ONLY medicine_name values from:
  1. retailerdb_backup_*.sql.zip   (actually a GZIP'd PostgreSQL pg_dump; COPY public.medicine block)
  2. medicines.csv                 (column "medicine_name")

and inserts any names missing from the app's master `medicines` table
(data/app.db) with source='master_reference'.

Safety contract:
- Additive-only. Never touches inventory_master, purchases, sales or any other table.
- No invented business data: inserts carry ONLY the name (+ source marker).
  MRP / taxes / manufacturer stay at schema defaults (NULL/0) until a real
  purchase invoice or user edit fills them in.
- Idempotent: re-running skips names that already exist (case-insensitive).

Usage: node scripts/importMedicineNames.mjs [--dry-run]
*/

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DUMP_FILE = path.join(ROOT, 'retailerdb_backup_Sat 08_22_2026_20_02_00.31.sql.zip');
const CSV_FILE = path.join(ROOT, 'medicines.csv');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'app.db');
const DRY_RUN = process.argv.includes('--dry-run');

// normalized key -> display name (first occurrence wins)
const names = new Map();
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function addName(raw) {
  if (!raw) return;
  const name = raw.replace(/\\N/gi, '').trim(); // \N = PG NULL marker
  if (!name || name === '\\N') return;
  const key = norm(name);
  if (!key) return;
  if (!names.has(key)) names.set(key, name);
}

/** Stream the pg_dump, harvest names from the `COPY public.medicine (...)` block only. */
async function extractFromDump() {
  if (!fs.existsSync(DUMP_FILE)) {
    console.log(`[dump] File not found, skipping: ${DUMP_FILE}`);
    return { rows: 0 };
  }
  const gz = zlib.createGunzip();
  const rs = fs.createReadStream(DUMP_FILE);
  const rl = readline.createInterface({ input: rs.pipe(gz), crlfDelay: Infinity });

  let inBlock = false;
  let nameIdx = -1;
  let rows = 0;

  for await (const line of rl) {
    if (!inBlock) {
      if (/^COPY public\.medicine \(/.test(line)) {
        const cols = line.replace(/^COPY public\.medicine \(/, '').replace(/\) FROM stdin;?\s*$/, '');
        nameIdx = cols.split(',').findIndex((c) => c.trim() === 'medicine_name');
        if (nameIdx < 0) throw new Error('medicine_name column not found in COPY header');
        inBlock = true;
      }
      continue;
    }
    if (line === '\\.' || line === '\\.\r') break; // end of COPY block
    const fields = line.split('\t');
    if (fields.length > nameIdx) {
      addName(fields[nameIdx]);
      rows++;
    }
  }
  rl.close();
  rs.destroy();
  console.log(`[dump] Scanned ${rows} medicine rows`);
  return { rows };
}

/** Stream the CSV, harvest the medicine_name column. */
function extractFromCsv() {
  if (!fs.existsSync(CSV_FILE)) {
    console.log(`[csv] File not found, skipping: ${CSV_FILE}`);
    return { rows: 0 };
  }
  const parse = require('csv-parser');
  return new Promise((resolve, reject) => {
    let rows = 0;
    fs.createReadStream(CSV_FILE)
      .pipe(parse())
      .on('data', (row) => {
        addName(row['medicine_name']);
        rows++;
      })
      .on('end', () => {
        console.log(`[csv] Scanned ${rows} medicine rows`);
        resolve({ rows });
      })
      .on('error', reject);
  });
}

async function main() {
  console.log(`Import target DB: ${DB_PATH}${DRY_RUN ? ' (DRY RUN)' : ''}`);
  await extractFromDump();
  await extractFromCsv();
  console.log(`Unique candidate names: ${names.size}`);

  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 30000');

  const before = db.prepare('SELECT COUNT(*) AS c FROM medicines').get().c;
  // Whitespace-collapsed comparison on BOTH sides so spacing variants of an
  // existing name are never re-inserted as "new".
  const collapse = (s) => norm(s);
  const existing = new Set(
    db.prepare('SELECT name FROM medicines').all().map((r) => collapse(r.name))
  );

  const fresh = [];
  for (const [key, display] of names) {
    if (!existing.has(key)) fresh.push(display);
  }
  console.log(`Existing medicines: ${before} | New names to insert: ${fresh.length}`);

  if (DRY_RUN || fresh.length === 0) {
    db.close();
    console.log(fresh.length === 0 ? 'Nothing to insert.' : 'Dry run complete — no writes performed.');
    return;
  }

  const insert = db.prepare("INSERT INTO medicines (name, source) VALUES (?, 'master_reference')");
  let inserted = 0;
  const tx = db.transaction((batch) => {
    for (const name of batch) insert.run(name);
  });
  const BATCH = 2000;
  for (let i = 0; i < fresh.length; i += BATCH) {
    tx(fresh.slice(i, i + BATCH));
    inserted += Math.min(BATCH, fresh.length - i);
    if (inserted % 20000 < BATCH) console.log(`  ...${inserted}/${fresh.length}`);
  }

  const after = db.prepare('SELECT COUNT(*) AS c FROM medicines').get().c;
  const bySource = db
    .prepare("SELECT source, COUNT(*) AS c FROM medicines GROUP BY source ORDER BY c DESC")
    .all();

  db.close();
  console.log(`Done. medicines: ${before} -> ${after} (+${after - before})`);
  console.table(bySource);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
