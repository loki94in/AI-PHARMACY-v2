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

db.all("SELECT id, name, phone FROM customers WHERE phone IS NOT NULL AND phone != ''", (err, rows) => {
  if (err) {
    console.error(err);
  } else {
    console.log("Registered Customers with Phone Numbers:");
    console.log(rows);
  }
  db.close();
});
