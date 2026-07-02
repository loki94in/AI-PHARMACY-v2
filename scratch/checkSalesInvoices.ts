import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '..', 'data', 'staging.db');

try {
  const db = new Database(dbPath, { readonly: true });
  console.log('=== Checking sales_invoices table in staging.db ===');
  
  const countRow = db.prepare('SELECT COUNT(*) as count FROM sales_invoices').get() as { count: number };
  console.log(`Total sales_invoices: ${countRow.count}`);

  const sampleRows = db.prepare('SELECT id, invoice_no, legacy_id FROM sales_invoices LIMIT 10').all();
  console.log('Sample rows:');
  console.log(sampleRows);

  const nullLegacyIdCount = db.prepare('SELECT COUNT(*) as count FROM sales_invoices WHERE legacy_id IS NULL').get() as { count: number };
  console.log(`Invoices with legacy_id IS NULL: ${nullLegacyIdCount.count}`);

} catch (err: any) {
  console.error('Error:', err.message);
}
