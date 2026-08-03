import { dbManager } from '../database/connection.js';

async function main() {
  const db = await dbManager.getConnection();
  console.log('=== INSPECTING PURCHASES SEQUENCE & COLUMNS ===');

  // Check ID 15626
  const id15626 = await db.get("SELECT * FROM purchases WHERE id = 15626");
  console.log('Purchase ID 15626:', id15626);

  // Check purchases around 15620 to 15630
  const recentPurchases = await db.all("SELECT p.*, d.name as dist_name FROM purchases p LEFT JOIN distributors d ON p.distributor_id = d.id WHERE p.id >= 15615 ORDER BY p.id DESC");
  console.log('Purchases >= 15615 count:', recentPurchases.length);
  recentPurchases.forEach(p => {
    console.log(`ID: #${p.id}, InvNo: ${p.invoice_no}, AppInvNo: ${p.app_invoice_no}, Date: "${p.date}", BusDate: "${p.business_date}", Dist: ${p.dist_name}, Amount: ${p.total_amount}`);
  });

  // Check table schema for purchases
  const pragma = await db.all("PRAGMA table_info(purchases)");
  console.log('Purchases Table Columns:', pragma.map(c => c.name));
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
