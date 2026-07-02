import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

import { ensureSchema } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../data/app.db');

async function migrate() {
  await ensureSchema(DB_PATH);
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  console.log('Connected to DB. Starting Item Code migration...');

  try {
    await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_item_code ON medicines(item_code)');
  } catch (err) {
    console.warn('Index creation error:', err);
  }

  const medicines = await db.all('SELECT id, item_code FROM medicines WHERE item_code IS NULL');
  console.log(`Found ${medicines.length} medicines without item_code. Migrating...`);

  await db.run('BEGIN TRANSACTION');
  let count = 0;
  for (const med of medicines) {
    const code = `SKU-${10000 + med.id}`;
    await db.run('UPDATE medicines SET item_code = ? WHERE id = ?', [code, med.id]);
    count++;
  }
  await db.run('COMMIT');

  console.log(`Successfully assigned item_code to ${count} medicines.`);
  await db.close();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
