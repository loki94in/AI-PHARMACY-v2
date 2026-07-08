import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../data/app.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    process.exit(1);
  }
});

db.all(
  "SELECT id, name, phone FROM customers WHERE name LIKE '%sonaw%' OR name LIKE '%sonawne%' OR name LIKE '%sonawane%'",
  (err, rows) => {
    if (err) {
      console.error(err);
    } else {
      console.log(`Found ${rows.length} matching Sonawne profiles:`);
      console.log(rows);
    }
    db.close();
  }
);
