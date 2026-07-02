import chokidar from 'chokidar';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { ensureSchema } from '../database.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');

// Ensure DB schema exists before watching
ensureSchema(DB_PATH).catch(console.error);

const watcher = chokidar.watch(`${CATALOG_DIR}/**/*.@(pdf|csv)`, { ignoreInitial: true });

watcher.on('add', async (filePath) => {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run(`INSERT OR IGNORE INTO catalog_jobs (file_path) VALUES (?)`, filePath);
  await db.close();
  console.log('Enqueued new catalog file:', filePath);
});

console.log('Watching catalog folder for new PDF/CSV files...');
