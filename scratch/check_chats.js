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

db.get("SELECT * FROM whatsapp_chats WHERE id = ?", ['265046877806598@lid'], (err, row) => {
  if (err) {
    console.error(err);
  } else {
    console.log("Cached Row for 265046877806598@lid:");
    console.log(row);
  }
  db.close();
});
