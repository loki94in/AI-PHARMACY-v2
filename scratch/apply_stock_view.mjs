// One-time correction: apply the legacy app's authoritative per-batch live
// stock (stock_view: quantity strips + loose units) onto inventory_master,
// keyed by legacy_batch_id. This is the same source the fixed migration
// worker now uses; run against the dump that produced the current DB.
// Usage: node scratch/apply_stock_view.mjs <dump.(sql|sql.zip gzip)> [--dry-run]
import Database from 'better-sqlite3';
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';

const dumpPath = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');
if (!dumpPath) {
  console.error('Usage: node scratch/apply_stock_view.mjs <dump file> [--dry-run]');
  process.exit(1);
}

// Same normalization as src/utils/stockRebuild.ts — keep in sync.
function normalize(qty, loose, packSize) {
  const size = packSize > 0 ? packSize : 10;
  const total = qty * size + loose;
  if (total <= 0) return { quantity: 0, loose_quantity: 0 };
  const quantity = Math.floor(total / size);
  return { quantity, loose_quantity: total - quantity * size };
}

// 1. Stream the dump and collect stock_view rows
const isGzip = await (async () => {
  const fd = createReadStream(dumpPath, { start: 0, end: 1 });
  const chunks = [];
  for await (const c of fd) chunks.push(c);
  const head = Buffer.concat(chunks);
  return head[0] === 0x1f && head[1] === 0x8b;
})();

const input = isGzip
  ? createReadStream(dumpPath).pipe(createGunzip())
  : createReadStream(dumpPath);
const rl = createInterface({ input, crlfDelay: Infinity });

const stockView = new Map(); // legacy batch_id -> { qty, loose }
let inBlock = false;
let idx = null;

for await (const line of rl) {
  if (line.startsWith('COPY public.stock_view (')) {
    const cols = line.slice(line.indexOf('(') + 1, line.indexOf(')')).split(',').map(c => c.trim());
    idx = { qty: cols.indexOf('quantity'), loose: cols.indexOf('loose'), batch: cols.indexOf('batch_id') };
    inBlock = true;
    continue;
  }
  if (inBlock) {
    if (line === '\\.') break;
    const f = line.split('\t');
    const batchId = f[idx.batch];
    if (!batchId || batchId === '\\N') continue;
    stockView.set(batchId, {
      qty: parseInt(f[idx.qty], 10) || 0,
      loose: parseInt(f[idx.loose], 10) || 0,
    });
  }
}
console.log(`stock_view rows loaded from dump: ${stockView.size.toLocaleString()}`);

// 2. Compare with current inventory_master and apply
const db = new Database('./data/app.db', { fileMustExist: true, readonly: DRY_RUN });
const rows = db.prepare(`
  SELECT im.id, im.legacy_batch_id, im.batch_no, im.quantity, im.loose_quantity,
         COALESCE(m.pack_size, 10) as pack_size, m.name
  FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id
  WHERE im.legacy_batch_id IS NOT NULL
`).all();

let matched = 0, changed = 0, missing = 0;
const changes = [];
for (const r of rows) {
  const sv = stockView.get(r.legacy_batch_id);
  if (!sv) { missing++; continue; }
  matched++;
  const n = normalize(sv.qty, sv.loose, r.pack_size);
  if (n.quantity !== r.quantity || n.loose_quantity !== r.loose_quantity) {
    changed++;
    changes.push({ id: r.id, ...n, batch: r.batch_no, name: r.name, old_q: r.quantity, old_l: r.loose_quantity });
  }
}

console.log(`inventory batches matched to stock_view: ${matched.toLocaleString()} (missing from view: ${missing})`);
console.log(`batches whose stock differs and would be corrected: ${changed.toLocaleString()}`);
console.log('\nSample corrections:');
changes.slice(0, 15).forEach(c =>
  console.log(`  ${c.batch} (${c.name.slice(0, 30)}): ${c.old_q}/${c.old_l} -> ${c.quantity}/${c.loose_quantity}`));

if (DRY_RUN) {
  console.log('\nDry run only — no changes made.');
  db.close();
  process.exit(0);
}

const upd = db.prepare('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?');
db.transaction(() => {
  for (const c of changes) upd.run(c.quantity, c.loose_quantity, c.id);
})();
console.log(`\nApplied. ${changed.toLocaleString()} batches corrected to stock_view values.`);
db.close();
