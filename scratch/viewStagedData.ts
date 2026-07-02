import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '..', 'data', 'staging.db');

try {
  console.log(`Opening staging database at: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });

  // 1. List all tables
  console.log('\n=== All Tables in staging.db ===');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  console.log(tables.map(t => t.name));

  // 2. Describe schemas
  for (const table of tables) {
    const name = table.name;
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM "${name}"`).get() as { count: number };
    console.log(`Table [${name}]: ${countRow.count.toLocaleString()} rows`);
  }

} catch (err: any) {
  console.error('Error listing tables:', err.message);
}
