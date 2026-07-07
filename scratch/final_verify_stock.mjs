import Database from 'better-sqlite3';
const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });
const dist = db.prepare(`
  SELECT SUM(CASE WHEN loose_quantity > 0 THEN 1 ELSE 0 END) as positive,
         SUM(CASE WHEN loose_quantity < 0 THEN 1 ELSE 0 END) as negative
  FROM inventory_master`).get();
console.log('loose>0 batches now:', dist.positive, '| loose<0:', dist.negative, '(old app had 371 / 3)');
const known = db.prepare(`
  SELECT im.batch_no, im.quantity, im.loose_quantity, m.name
  FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id
  WHERE im.legacy_batch_id IN ('00037401','00036607','00037431','00037551','00032651')
`).all();
known.forEach(k => console.log(` ${k.name.slice(0,35)} ${k.batch_no}: ${k.quantity} strips + ${k.loose_quantity} loose`));
db.close();
