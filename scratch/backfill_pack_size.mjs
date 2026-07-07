// One-time backfill: derive medicines.pack_size from the free-text packaging
// field for medicines that were migrated before pack_size existed.
// Mirrors src/utils/packaging.ts's parsePackSizeFromPackaging — keep in sync.
import Database from 'better-sqlite3';

const DRY_RUN = process.argv.includes('--dry-run');

const COUNTABLE_UNIT_PATTERN = /^\s*(\d+)\s*(NO'?S|TAB|TABS|CAP|CAPS|PAD|PADS)\b/i;
function parsePackSizeFromPackaging(packaging) {
  if (!packaging) return null;
  const match = packaging.match(COUNTABLE_UNIT_PATTERN);
  if (!match) return null;
  const size = parseInt(match[1], 10);
  if (!size || size <= 0) return null;
  return size;
}

const db = new Database('./data/app.db', { fileMustExist: true });

const candidates = db.prepare(`
  SELECT id, packaging FROM medicines
  WHERE pack_size IS NULL AND packaging IS NOT NULL AND packaging != ''
`).all();

let parseable = 0;
const sample = [];
for (const row of candidates) {
  const size = parsePackSizeFromPackaging(row.packaging);
  if (size !== null) {
    parseable++;
    if (sample.length < 10) sample.push({ id: row.id, packaging: row.packaging, pack_size: size });
  }
}

console.log(`Medicines with pack_size still NULL: ${candidates.length.toLocaleString()}`);
console.log(`Of those, parseable as a countable pack size: ${parseable.toLocaleString()}`);
console.log('Sample of what would be set:');
sample.forEach(s => console.log(`  id=${s.id} packaging=${JSON.stringify(s.packaging)} -> pack_size=${s.pack_size}`));

if (DRY_RUN) {
  console.log('\nDry run only — no changes made. Re-run without --dry-run to apply.');
  db.close();
  process.exit(0);
}

const update = db.prepare('UPDATE medicines SET pack_size = ? WHERE id = ?');
const updateMany = db.transaction((rows) => {
  let updated = 0;
  for (const row of rows) {
    const size = parsePackSizeFromPackaging(row.packaging);
    if (size !== null) {
      update.run(size, row.id);
      updated++;
    }
  }
  return updated;
});

const updated = updateMany(candidates);
console.log(`\nBackfill complete. Updated pack_size on ${updated.toLocaleString()} medicines.`);
db.close();
