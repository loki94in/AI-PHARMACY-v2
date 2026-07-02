import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

async function run() {
  const db = await open({
    filename: 'data/app.db',
    driver: sqlite3.Database
  });

  const med = await db.all("SELECT id, name FROM medicines WHERE name LIKE '%ASTHAKIND%'");
  console.log("Medicines found:", med);

  if (med.length > 0) {
    const medIds = med.map(m => m.id);
    console.log("Medicine IDs:", medIds);

    for (const mId of medIds) {
      console.log(`\n--- Transactions for Medicine ID ${mId} ---`);
      // Sales
      const sales = await db.all(`
        SELECT 'Sale' as type, si.quantity, si.loose_qty, si.batch_no, sinv.date, sinv.invoice_no
        FROM sale_items si
        JOIN sales_invoices sinv ON si.invoice_id = sinv.id
        JOIN inventory_master im ON si.inventory_id = im.id
        WHERE im.medicine_id = ?
      `, [mId]);
      console.log(`Sales (${sales.length}):`, sales);

      // Purchases
      const purchases = await db.all(`
        SELECT 'Purchase' as type, pi.quantity, pi.free_qty, pi.batch_no, p.date, p.invoice_no
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        WHERE pi.medicine_id = ?
      `, [mId]);
      console.log(`Purchases (${purchases.length}):`, purchases);

      // Returns
      const returns = await db.all(`
        SELECT 'Return' as type, ri.quantity, ri.batch_no, r.date, r.return_no, r.type as ret_type
        FROM return_items ri
        JOIN returns r ON ri.return_id = r.id
        WHERE ri.medicine_id = ?
      `, [mId]);
      console.log(`Returns (${returns.length}):`, returns);
    }
  }

  await db.close();
}

run().catch(console.error);
