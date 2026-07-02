import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');

async function main() {
  console.log('Connecting to database:', DB_PATH);
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // Let's search if there are matching products in catalog to enrich this request with Pharmarack details
  // For Inderal LA 20, let's search if any matched
  const rows = await db.all("SELECT * FROM special_orders WHERE product LIKE '%Inderal%'");
  console.log('Existing Inderal orders:', rows);

  // Insert the request
  const sql = `
    INSERT INTO special_orders (
      product, requester, phone, qty, priority, status,
      pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped,
      pharmarack_scheme, advance_payment
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await db.run(sql, [
    'Inderal LA 20',
    'Walk-in Customer',
    '9999999999',
    1,
    'Normal',
    'Pending',
    null,
    null,
    null,
    0,
    null,
    0.0
  ]);

  console.log('Successfully inserted order for "Inderal LA 20"!');
  await db.close();
}

main().catch(console.error);
