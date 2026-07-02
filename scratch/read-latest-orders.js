import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');

async function main() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  console.log('Fetching last 5 special orders...');
  const rows = await db.all("SELECT * FROM special_orders ORDER BY id DESC LIMIT 5");
  console.log(JSON.stringify(rows, null, 2));
  await db.close();
}

main().catch(console.error);
