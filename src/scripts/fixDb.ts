import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');

async function fixDb() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // List all tables
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('Existing tables:', tables.map((t: any) => t.name).join(', '));

  // Create catalog_jobs if missing
  await db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      status TEXT CHECK(status IN ('pending','processing','done','failed')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('catalog_jobs table ensured.');

  // Add missing columns silently
  const fixes = [
    `ALTER TABLE catalog_jobs ADD COLUMN extracted_data TEXT`,
    `ALTER TABLE catalog_jobs ADD COLUMN original_filename TEXT`,
  ];
  for (const sql of fixes) {
    try { await db.run(sql); console.log('Applied:', sql); }
    catch (_) { console.log('Skipped (already exists):', sql); }
  }

  // Verify medicines count
  const count = await db.get('SELECT COUNT(*) as c FROM medicines');
  console.log(`Medicines in DB: ${(count as any).c}`);

  await db.close();
  console.log('DB fix complete. Server can now start cleanly!');
}

fixDb().catch(console.error);
