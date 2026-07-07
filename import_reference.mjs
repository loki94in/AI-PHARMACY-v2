// Direct DB import: bypass the HTTP API and load directly into medicine_reference
// This is identical to what the /api/enrichment/reference/import endpoint does internally,
// just without the 114MB HTTP upload overhead.
import Database from 'better-sqlite3';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const db = new Database('./data/app.db');

// Ensure table exists (mirrors schema from connection.ts)
db.exec(`
  CREATE TABLE IF NOT EXISTS medicine_reference (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    composition1 TEXT,
    composition2 TEXT,
    manufacturer TEXT,
    UNIQUE(name)
  )
`);

// Clear existing rows first (force reload)
const deleted = db.prepare('DELETE FROM medicine_reference').run();
console.log(`Cleared ${deleted.changes} existing reference rows`);

// Stream-parse the reference CSV and bulk-insert
const insert = db.prepare('INSERT OR IGNORE INTO medicine_reference (name, composition1, composition2, manufacturer) VALUES (?, ?, ?, ?)');
const insertMany = db.transaction((rows) => {
  for (const r of rows) insert.run(r.name, r.comp1 || null, r.comp2 || null, r.manufacturer || null);
});

const rl = createInterface({ input: createReadStream('./data/reference_medicines.csv'), crlfDelay: Infinity });

let headers = null;
let batch = [];
let totalLoaded = 0;
const BATCH_SIZE = 1000;

for await (const line of rl) {
  if (!headers) {
    headers = line.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    continue;
  }
  // Simple CSV parse (handles quoted fields with commas inside)
  const cols = [];
  let inQ = false, cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cols.push(cur);

  const get = (name) => (cols[headers.indexOf(name)] || '').trim();
  const name = get('name');
  if (!name) continue;

  batch.push({
    name,
    comp1: get('short_composition1'),
    comp2: get('short_composition2'),
    manufacturer: get('manufacturer_name'),
  });

  if (batch.length >= BATCH_SIZE) {
    insertMany(batch);
    totalLoaded += batch.length;
    batch = [];
    if (totalLoaded % 10000 === 0) process.stdout.write(`\r  Loaded ${totalLoaded.toLocaleString()} rows...`);
  }
}

if (batch.length > 0) {
  insertMany(batch);
  totalLoaded += batch.length;
}

console.log(`\nDone! Loaded ${totalLoaded.toLocaleString()} rows into medicine_reference`);

// Verify
const count = db.prepare('SELECT COUNT(*) as c FROM medicine_reference').get();
console.log(`Verified: ${count.c.toLocaleString()} rows in table`);
db.close();
