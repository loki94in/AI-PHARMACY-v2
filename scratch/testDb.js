import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function main() {
  const db = await open({ filename: './data/app.db', driver: sqlite3.Database });
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('Tables:', tables.map(t => t.name));
  
  const columns = await db.all("PRAGMA table_info(purchases)");
  console.log('Purchases Columns:', columns.map(c => `${c.name} (${c.type})`));
  
  await db.close();
}

main().catch(console.error);
