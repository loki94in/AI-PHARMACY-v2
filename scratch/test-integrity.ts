import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '..', 'data', 'app.db');

async function test() {
  console.log('Connecting to database:', dbPath);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  
  console.log('Running PRAGMA integrity_check...');
  const res = await db.get('PRAGMA integrity_check');
  console.log('Result:', res);
  
  await db.close();
}

test().catch(err => {
  console.error('Error:', err);
});
