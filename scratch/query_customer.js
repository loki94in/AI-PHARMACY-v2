import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../data/app.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  }
});

const phoneSearch = '265046877806598';
const last10 = phoneSearch.slice(-10);

db.get(
  `SELECT id, name, phone FROM customers WHERE phone LIKE ? OR phone LIKE ? LIMIT 1`,
  [`%${phoneSearch}%`, `%${last10}%`],
  (err, row) => {
    if (err) {
      console.error("Query failed:", err.message);
      process.exit(1);
    }
    console.log("Found Customer:", row);
    db.close();
    process.exit(0);
  }
);
