import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');

async function main() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  console.log('Table schema:');
  const info = await db.all("PRAGMA table_info(special_orders)");
  console.log(info);
  await db.close();
}

main().catch(console.error);
