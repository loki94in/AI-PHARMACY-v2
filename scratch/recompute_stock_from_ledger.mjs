// One-time recompute: fix inventory_master.quantity/loose_quantity for every
// migrated batch by treating strips+loose as one fungible base-unit pool
// instead of two independently-summed ledger columns.
// Mirrors src/utils/stockRebuild.ts::rebuildStockFromLedger — keep in sync.
import Database from 'better-sqlite3';

const DRY_RUN = process.argv.includes('--dry-run');

function rebuildStockFromLedger(rows, packSize) {
  const size = packSize > 0 ? packSize : 10;
  let totalUnits = 0;
  for (const r of rows) totalUnits += (r.quantity * size) + r.loose_quantity;
  if (totalUnits <= 0) return { quantity: 0, loose_quantity: 0 };
  const quantity = Math.floor(totalUnits / size);
  const loose_quantity = totalUnits - quantity * size;
  return { quantity, loose_quantity };
}

const db = new Database('./data/app.db', { fileMustExist: true });

const batches = db.prepare(`
  SELECT im.id, im.medicine_id, im.batch_no, im.quantity as old_qty, im.loose_quantity as old_loose,
         COALESCE(m.pack_size, 10) as pack_size
  FROM inventory_master im
  JOIN medicines m ON im.medicine_id = m.id
  WHERE im.legacy_batch_id IS NOT NULL
`).all();

const ledgerStmt = db.prepare(`SELECT quantity, loose_quantity FROM stock_ledger WHERE medicine_id = ? AND batch_no = ?`);

let changed = 0;
let clampedNegative = 0;
const sample = [];

const results = batches.map(b => {
  const rows = ledgerStmt.all(b.medicine_id, b.batch_no);
  let totalUnits = 0;
  for (const r of rows) totalUnits += (r.quantity * b.pack_size) + r.loose_quantity;
  const { quantity, loose_quantity } = rebuildStockFromLedger(rows, b.pack_size);

  if (totalUnits < 0) clampedNegative++;
  if (quantity !== b.old_qty || loose_quantity !== b.old_loose) {
    changed++;
    if (sample.length < 15) {
      sample.push({ batch: b.batch_no, pack_size: b.pack_size, old_qty: b.old_qty, old_loose: b.old_loose, new_qty: quantity, new_loose: loose_quantity });
    }
  }
  return { id: b.id, quantity, loose_quantity };
});

console.log(`Total batches checked: ${batches.length.toLocaleString()}`);
console.log(`Batches whose quantity/loose_quantity would change: ${changed.toLocaleString()}`);
console.log(`Batches clamped to 0/0 due to negative total (genuine data gap): ${clampedNegative.toLocaleString()}`);
console.log('\nSample changes:');
sample.forEach(s => console.log(JSON.stringify(s)));

if (DRY_RUN) {
  console.log('\nDry run only — no changes made. Re-run without --dry-run to apply.');
  db.close();
  process.exit(0);
}

const update = db.prepare(`UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?`);
const updateMany = db.transaction((rows) => {
  for (const r of rows) update.run(r.quantity, r.loose_quantity, r.id);
});
updateMany(results);

console.log(`\nRecompute complete. Updated ${changed.toLocaleString()} batches.`);
db.close();
