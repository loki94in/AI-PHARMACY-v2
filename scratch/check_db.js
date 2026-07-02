import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');

async function main() {
  console.log('Connecting to database at:', DB_PATH);
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  
  try {
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Tables:', tables.map(t => t.name));

    if (tables.some(t => t.name === 'crash_log')) {
      const crashes = await db.all("SELECT * FROM crash_log ORDER BY id DESC LIMIT 5");
      console.log('--- LATEST 5 CRASH LOGS ---');
      console.log(JSON.stringify(crashes, null, 2));
    } else {
      console.log('crash_log table does not exist.');
    }

    if (tables.some(t => t.name === 'app_settings')) {
      const settings = await db.all("SELECT * FROM app_settings WHERE key LIKE 'pharmarack_%'");
      console.log('--- PHARMARACK SETTINGS ---');
      console.log(JSON.stringify(settings, null, 2));
    }
  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await db.close();
  }
}

main();
