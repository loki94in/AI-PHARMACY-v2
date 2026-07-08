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

db.all(
  `SELECT phone, reason, added_at FROM ignored_whatsapp_numbers`,
  [],
  (err, rows) => {
    if (err) {
      console.error("Query failed:", err.message);
      process.exit(1);
    }
    console.log("Ignored numbers in DB:", rows);
    db.close();
    process.exit(0);
  }
);
