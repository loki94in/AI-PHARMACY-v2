import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

async function heal() {
  console.log('Connecting to database...');
  const db = await open({
    filename: './data/app.db',
    driver: sqlite3.Database
  });

  console.log('Starting transaction to update sales_invoices...');
  await db.run('BEGIN TRANSACTION');

  try {
    const startTime = Date.now();
    
    console.log('1. Healing subtotal column...');
    const subtotalResult = await db.run(`
      UPDATE sales_invoices
      SET subtotal = COALESCE(NULLIF(
        (
          SELECT COALESCE(SUM(
            (si.quantity * (si.unit_price * (1 - COALESCE(si.discount_per, 0) / 100))) +
            (si.loose_qty * ((si.unit_price * (1 - COALESCE(si.discount_per, 0) / 100)) / COALESCE(m.pack_size, 10)))
          ), 0)
          FROM sale_items si
          JOIN inventory_master im ON si.inventory_id = im.id
          JOIN medicines m ON im.medicine_id = m.id
          WHERE si.invoice_id = sales_invoices.id
        ), 0), total_amount)
      WHERE subtotal IS NULL OR subtotal = 0;
    `);
    console.log(`Subtotals updated: ${subtotalResult.changes} rows.`);

    console.log('2. Healing discount column...');
    const discountResult = await db.run(`
      UPDATE sales_invoices
      SET discount = CASE 
        WHEN subtotal > total_amount THEN ROUND(subtotal - total_amount) 
        ELSE 0 
      END
      WHERE discount IS NULL OR discount = 0;
    `);
    console.log(`Discounts updated: ${discountResult.changes} rows.`);

    await db.run('COMMIT');
    console.log(`Successfully healed database in ${Date.now() - startTime}ms.`);
  } catch (err) {
    console.error('Error during database healing, rolling back:', err);
    await db.run('ROLLBACK');
  } finally {
    await db.close();
  }
}

heal();
