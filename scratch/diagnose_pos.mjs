import { dbManager } from '../src/database/connection.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  console.log('--- DIAGNOSING POS LOAD BOTTLENECK ---');
  let db;
  try {
    db = await dbManager.getConnection();
    console.log('Connected to database.');

    // Count tables
    const tables = ['medicines', 'inventory_master', 'special_orders', 'doctors', 'customers', 'patient_refills', 'sales_invoices', 'sale_items'];
    for (const table of tables) {
      try {
        const row = await db.get(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`Table '${table}' count:`, row.count);
      } catch (err) {
        console.log(`Table '${table}' query failed:`, err.message);
      }
    }

    // Measure queries
    console.log('\n--- PROFILING QUERIES ---');

    let start = Date.now();
    await db.all('SELECT * FROM special_orders ORDER BY date DESC');
    console.log(`1. 'SELECT * FROM special_orders ORDER BY date DESC' took: ${Date.now() - start}ms`);

    start = Date.now();
    await db.all('SELECT * FROM doctors ORDER BY name ASC');
    console.log(`2. 'SELECT * FROM doctors ORDER BY name ASC' took: ${Date.now() - start}ms`);

    start = Date.now();
    const inventoryQuery = `
      SELECT im.*, 
             m.name as name, 
             m.name as medicine_name, 
             im.batch_no as batch_number, 
             im.quantity as stock_quantity, 
             m.item_code as item_code
      FROM inventory_master im
      LEFT JOIN medicines m ON im.medicine_id = m.id
      WHERE 1=1
      ORDER BY m.name ASC, im.id DESC
      LIMIT 12 OFFSET 0
    `;
    await db.all(inventoryQuery);
    console.log(`3. 'Get Inventory (limit 12)' took: ${Date.now() - start}ms`);

    start = Date.now();
    const compactInventoryQuery = `
      SELECT 
        m.id AS medicine_id,
        im.id AS inventory_id,
        m.name,
        im.batch_no,
        im.expiry_date,
        COALESCE(im.mrp, m.mrp, 0) AS mrp,
        im.quantity AS stock_qty,
        im.loose_quantity,
        im.unit_price,
        COALESCE(im.cost_price, 0) AS cost_price,
        m.item_code,
        m.manufacturer,
        m.packaging,
        m.pack_size
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE (im.quantity > 0 OR im.loose_quantity > 0) AND (im.expiry_date IS NULL OR im.expiry_date >= date('now'))
       ORDER BY m.name ASC, im.expiry_date ASC
    `;
    const compactRows = await db.all(compactInventoryQuery);
    console.log(`4. 'Get Compact Inventory' rows: ${compactRows.length}, took: ${Date.now() - start}ms`);

  } catch (error) {
    console.error('Diagnosis script failed:', error);
  } finally {
    await dbManager.close(true);
    process.exit(0);
  }
}

run();
