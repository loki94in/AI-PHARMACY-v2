import Database from 'better-sqlite3';
const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });

const batches = ['B5AKZ021', 'JKAD24057', '110225-ST1', 'FRW153065AS', 'GA164049'];
for (const b of batches) {
  console.log(`\n=== batch ${b} ===`);
  const rows = db.prepare(`
    SELECT im.id as inv_id, im.medicine_id, im.batch_no, im.expiry_date, im.quantity, im.loose_quantity,
           im.mrp as inv_mrp, im.unit_price, im.cost_price,
           m.name, m.pack_unit, m.packaging, m.mrp as med_mrp
    FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id
    WHERE im.batch_no = ?
  `).all(b);
  rows.forEach(r => console.log(JSON.stringify(r)));
}
db.close();
