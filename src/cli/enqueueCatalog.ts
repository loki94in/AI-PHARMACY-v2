import fs from 'fs';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { ensureSchema } from '../database.js';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directory containing catalog files (relative to project root)
const CATALOG_DIR = process.env.CATALOG_DIR || path.resolve(__dirname, '..', '..', 'uploads');
// SQLite database path (store under data folder)
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

async function enqueue() {
  await ensureSchema(DB_PATH);
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  
  const targetPath = process.argv[2] || CATALOG_DIR;
  const stat = await fs.promises.stat(targetPath);
  
  if (stat.isDirectory()) {
    const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /\.(pdf|csv)$/i.test(entry.name)) {
        const fullPath = path.join(targetPath, entry.name);
        await db.run(`INSERT OR IGNORE INTO catalog_jobs (file_path) VALUES (?)`, fullPath);
      }
    }
  } else if (stat.isFile() && /\.(pdf|csv)$/i.test(targetPath)) {
    await db.run(`INSERT OR IGNORE INTO catalog_jobs (file_path) VALUES (?)`, targetPath);
  }
  
  await db.close();
  console.log('Enqueue complete');
}

enqueue().catch((err) => {
  console.error('Failed to enqueue catalog files:', err);
  process.exit(1);
});
