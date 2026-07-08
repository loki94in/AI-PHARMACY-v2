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

// Current local time: 2026-07-08T17:37:40+05:30 -> Unix epoch timestamp
const currentTime = Math.floor(new Date('2026-07-08T17:37:40+05:30').getTime() / 1000);
const thirtyMinutesAgo = currentTime - 30 * 60;

console.log("Current Time (Unix):", currentTime);
console.log("30 Min Ago (Unix):", thirtyMinutesAgo);

db.all(
  `SELECT id, chat_id, body, timestamp, has_media, type 
   FROM whatsapp_messages 
   WHERE from_me = 0 AND timestamp >= ? 
   ORDER BY timestamp DESC`,
  [thirtyMinutesAgo],
  (err, rows) => {
    if (err) {
      console.error("Query failed:", err.message);
      process.exit(1);
    }
    console.log(`Found ${rows.length} messages received in the last 30 minutes:`);
    rows.forEach((row, i) => {
      console.log(`[${i}] ID: ${row.id} | Chat: ${row.chat_id} | Body: "${row.body}" | HasMedia: ${row.has_media} | Type: ${row.type} | Time: ${new Date(row.timestamp * 1000).toLocaleTimeString()}`);
    });
    db.close();
    process.exit(0);
  }
);
