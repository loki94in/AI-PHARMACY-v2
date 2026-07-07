import Database from 'better-sqlite3';
const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });

// 1. Current loose_quantity distribution
const dist = db.prepare(`
  SELECT
    SUM(CASE WHEN loose_quantity > 0 THEN 1 ELSE 0 END) as positive,
    SUM(CASE WHEN loose_quantity = 0 THEN 1 ELSE 0 END) as zero,
    SUM(CASE WHEN loose_quantity < 0 THEN 1 ELSE 0 END) as negative,
    COUNT(*) as total
  FROM inventory_master
`).get();
console.log('loose_quantity distribution:', JSON.stringify(dist));

// 2. Was migration re-run recently? (stock_ledger created_at watermark)
const ledgerWatermark = db.prepare(`SELECT MIN(created_at) as first, MAX(created_at) as last, COUNT(*) as rows FROM stock_ledger`).get();
console.log('stock_ledger created_at range:', JSON.stringify(ledgerWatermark));

// 3. Is the pack_size backfill still intact? (re-migration with old code would wipe it)
const ps = db.prepare(`SELECT COUNT(*) as with_ps FROM medicines WHERE pack_size IS NOT NULL`).get();
console.log('medicines with pack_size set:', JSON.stringify(ps));

// 4. Sample of positive-loose rows (do any exist at all?)
const samples = db.prepare(`
  SELECT im.batch_no, im.quantity, im.loose_quantity, m.name
  FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id
  WHERE im.loose_quantity > 0 LIMIT 8
`).all();
console.log('sample positive-loose rows:');
samples.forEach(s => console.log(' ', JSON.stringify(s)));

// 5. Unexpired + in-stock positive loose (what POS/Inventory would actually show)
const visible = db.prepare(`
  SELECT COUNT(*) as c FROM inventory_master
  WHERE loose_quantity > 0 AND (expiry_date IS NULL OR expiry_date >= date('now'))
`).get();
console.log('unexpired rows with positive loose:', JSON.stringify(visible));
db.close();
