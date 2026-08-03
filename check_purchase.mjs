import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

// Check recent purchases
const purchases = db.prepare('SELECT id, invoice_no, app_invoice_no, distributor_id, date, total_amount FROM purchases ORDER BY id DESC LIMIT 10').all();
console.log('Recent purchases:', JSON.stringify(purchases, null, 2));

// Check purchase_items for recent
if (purchases.length > 0) {
  const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchases[0].id);
  console.log('\nItems for purchase', purchases[0].id, ':', JSON.stringify(items, null, 2));
}

// Check distributors
const dists = db.prepare('SELECT id, name FROM distributors LIMIT 10').all();
console.log('\nDistributors:', JSON.stringify(dists, null, 2));
