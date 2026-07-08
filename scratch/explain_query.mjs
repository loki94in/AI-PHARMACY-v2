import { dbManager } from '../src/database/connection.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const db = await dbManager.getConnection();
  const query = `
    EXPLAIN QUERY PLAN
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
  const plan = await db.all(query);
  console.log('QUERY PLAN:');
  console.log(JSON.stringify(plan, null, 2));
  await dbManager.close(true);
}
run();
