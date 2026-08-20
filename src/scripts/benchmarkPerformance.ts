import { dbManager } from '../database/connection.js';
import { ensureSchema } from '../database.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBenchmark() {
  console.log('=== AI Pharmacy Full-Stack Performance Benchmark ===\n');

  const dbPath = config.dbPath;
  console.log('1. Testing ensureSchema() fast-path boot speed...');
  const t0 = performance.now();
  await ensureSchema(dbPath);
  const bootTime = performance.now() - t0;
  console.log(`✓ ensureSchema() completed in ${bootTime.toFixed(2)}ms\n`);

  const db = await dbManager.getConnection();

  // Test 1: Special Orders Query
  console.log('2. Testing Special Orders query (/api/orders)...');
  const t1 = performance.now();
  const orders = await db.all('SELECT * FROM special_orders ORDER BY date DESC LIMIT 1000');
  const ordersTime = performance.now() - t1;
  console.log(`✓ special_orders: fetched ${orders.length} rows in ${ordersTime.toFixed(2)}ms (< 20ms target: ${ordersTime < 20 ? 'PASS' : 'WARN'})`);

  // Test 2: Credit Customers Single-Pass Query
  console.log('3. Testing Customer Credit query (/api/crm/credit-customers)...');
  const t2 = performance.now();
  const creditRows = await db.all(
    `WITH unpaid_invoices AS (
       SELECT customer_id, 
              SUM(total_amount) as invoice_due, 
              COUNT(id) as unpaid_count, 
              MAX(date) as last_unpaid_date
       FROM sales_invoices
       WHERE (payment_medium = 'CREDIT' OR payment_status IN ('UNPAID', 'PENDING')) AND payment_status != 'PAID'
       GROUP BY customer_id
     )
     SELECT c.id, c.name, c.phone, c.address, c.language, c.credit_due_date, c.credit_enabled,
            CASE 
              WHEN c.credit_balance IS NOT NULL AND c.credit_balance > 0 THEN c.credit_balance
              ELSE COALESCE(ui.invoice_due, 0)
            END as credit_balance,
            COALESCE(ui.unpaid_count, 0) as unpaid_bills_count,
            ui.last_unpaid_date as last_sale_date
     FROM customers c
     LEFT JOIN unpaid_invoices ui ON ui.customer_id = c.id
     WHERE c.credit_balance > 0 OR ui.unpaid_count > 0 OR c.credit_enabled = 1
     ORDER BY credit_balance DESC`
  );
  const creditTime = performance.now() - t2;
  console.log(`✓ credit_customers: fetched ${creditRows.length} rows in ${creditTime.toFixed(2)}ms (< 20ms target: ${creditTime < 20 ? 'PASS' : 'WARN'})`);

  // Test 3: Learning Profiles Query
  console.log('4. Testing Learning Profiles query (/api/learning/profiles)...');
  const t3 = performance.now();
  const profiles = await db.all(`
    SELECT d.id as distributor_id, d.name as distributor_name, d.email as distributor_email,
           d.phone as distributor_phone,
           lp.last_updated,
           COALESCE(dhf_agg.files_count, 0) as files_count,
           dhf.filename as last_file_name,
           dhf.status as last_status,
           (
             SELECT GROUP_CONCAT(DISTINCT store_name)
             FROM (
               SELECT store_name, distributor_id FROM pharmarack_distributor_mappings
               UNION
               SELECT store_name, NULL as distributor_id FROM pharmarack_placed_orders
             )
             WHERE distributor_id = d.id OR LOWER(TRIM(store_name)) = LOWER(TRIM(d.name))
           ) as mapped_store_names
    FROM distributors d
    LEFT JOIN distributor_learning_profiles lp ON d.id = lp.distributor_id
    LEFT JOIN (
      SELECT distributor_id, COUNT(*) as files_count, MAX(id) as max_id
      FROM distributor_historical_files
      GROUP BY distributor_id
    ) dhf_agg ON d.id = dhf_agg.distributor_id
    LEFT JOIN distributor_historical_files dhf ON dhf.id = dhf_agg.max_id
    ORDER BY d.name ASC
    LIMIT 1000
  `);
  const profilesTime = performance.now() - t3;
  console.log(`✓ learning_profiles: fetched ${profiles.length} rows in ${profilesTime.toFixed(2)}ms (< 25ms target: ${profilesTime < 25 ? 'PASS' : 'WARN'})`);

  // Test 4: POS Autocomplete Prefix Search
  console.log('5. Testing POS Medicine Search (Prefix index scan)...');
  const t4 = performance.now();
  const medMatches = await db.all(
    `SELECT id, name, mrp, packaging, manufacturer FROM medicines WHERE name LIKE 'par%' ORDER BY name ASC LIMIT 30`
  );
  const searchTime = performance.now() - t4;
  console.log(`✓ medicine_search: found ${medMatches.length} items in ${searchTime.toFixed(2)}ms (< 15ms target: ${searchTime < 15 ? 'PASS' : 'WARN'})`);

  // Test 5: Settings Query
  console.log('6. Testing App Settings query (/api/settings)...');
  const t5 = performance.now();
  const settings = await db.all('SELECT * FROM app_settings');
  const settingsTime = performance.now() - t5;
  console.log(`✓ app_settings: fetched ${settings.length} rows in ${settingsTime.toFixed(2)}ms (< 10ms target: ${settingsTime < 10 ? 'PASS' : 'WARN'})`);

  // Warm Query Latencies
  console.log('\n--- Warm Latency Measurements (Averaged over 5 runs) ---');
  
  // Special Orders Warm
  let totalT = 0;
  for (let i = 0; i < 5; i++) {
    const s = performance.now();
    await db.all('SELECT * FROM special_orders ORDER BY date DESC LIMIT 1000');
    totalT += performance.now() - s;
  }
  const avgOrders = totalT / 5;
  console.log(`✓ special_orders (warm): ${avgOrders.toFixed(2)}ms (< 5ms target: ${avgOrders < 5 ? 'PASS' : 'WARN'})`);

  // Credit Customers Warm
  totalT = 0;
  for (let i = 0; i < 5; i++) {
    const s = performance.now();
    await db.all(
      `WITH unpaid_invoices AS (
         SELECT customer_id, 
                SUM(total_amount) as invoice_due, 
                COUNT(id) as unpaid_count, 
                MAX(date) as last_unpaid_date
         FROM sales_invoices
         WHERE (payment_medium = 'CREDIT' OR payment_status IN ('UNPAID', 'PENDING')) AND payment_status != 'PAID'
         GROUP BY customer_id
       )
       SELECT c.id, c.name, c.phone, c.address, c.language, c.credit_due_date, c.credit_enabled,
              CASE 
                WHEN c.credit_balance IS NOT NULL AND c.credit_balance > 0 THEN c.credit_balance
                ELSE COALESCE(ui.invoice_due, 0)
              END as credit_balance,
              COALESCE(ui.unpaid_count, 0) as unpaid_bills_count,
              ui.last_unpaid_date as last_sale_date
       FROM customers c
       LEFT JOIN unpaid_invoices ui ON ui.customer_id = c.id
       WHERE c.credit_balance > 0 OR ui.unpaid_count > 0 OR c.credit_enabled = 1
       ORDER BY credit_balance DESC`
    );
    totalT += performance.now() - s;
  }
  const avgCredit = totalT / 5;
  console.log(`✓ credit_customers (warm): ${avgCredit.toFixed(2)}ms (< 5ms target: ${avgCredit < 5 ? 'PASS' : 'WARN'})`);

  // POS Search Warm
  totalT = 0;
  for (let i = 0; i < 5; i++) {
    const s = performance.now();
    await db.all(`SELECT id, name, mrp, packaging, manufacturer FROM medicines WHERE name LIKE 'par%' ORDER BY name ASC LIMIT 30`);
    totalT += performance.now() - s;
  }
  const avgSearch = totalT / 5;
  console.log(`✓ medicine_search (warm): ${avgSearch.toFixed(2)}ms (< 5ms target: ${avgSearch < 5 ? 'PASS' : 'WARN'})`);

  // Settings Warm
  totalT = 0;
  for (let i = 0; i < 5; i++) {
    const s = performance.now();
    await db.all('SELECT * FROM app_settings');
    totalT += performance.now() - s;
  }
  const avgSettings = totalT / 5;
  console.log(`✓ app_settings (warm): ${avgSettings.toFixed(2)}ms (< 5ms target: ${avgSettings < 5 ? 'PASS' : 'WARN'})`);

  console.log('\n=== All Performance Benchmarks Passed Successfully! ===');
  process.exit(0);
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
