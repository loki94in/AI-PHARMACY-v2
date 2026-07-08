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

db.all(`SELECT * FROM settings`, (err, settingsRows) => {
  console.log("--- settings Table Rows ---");
  if (err) {
    console.error("Failed to query settings:", err.message);
  } else {
    console.log(settingsRows);
  }

  db.all(`SELECT * FROM app_settings`, (err, appSettingsRows) => {
    console.log("--- app_settings Table Rows ---");
    if (err) {
      console.error("Failed to query app_settings:", err.message);
    } else {
      console.log(appSettingsRows);
    }
    db.close();
    process.exit(0);
  });
});
