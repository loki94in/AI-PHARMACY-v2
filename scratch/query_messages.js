import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';

async function main() {
  const dbPath = path.resolve('data', 'app.db');
  console.log('Connecting to:', dbPath);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  try {
    console.log('--- Database Tables ---');
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log(tables.map(t => t.name));

    // Check if there is a whatsapp_messages or similar table
    console.log('--- Last 10 Messages ---');
    if (tables.some(t => t.name === 'whatsapp_messages')) {
      const msgs = await db.all("SELECT * FROM whatsapp_messages ORDER BY id DESC LIMIT 10");
      console.log(msgs);
    } else if (tables.some(t => t.name === 'messages')) {
      const msgs = await db.all("SELECT * FROM messages ORDER BY id DESC LIMIT 10");
      console.log(msgs);
    } else {
      console.log('No messages or whatsapp_messages table found');
    }

    console.log('--- App Settings ---');
    const settings = await db.all("SELECT * FROM app_settings");
    console.log(settings);

  } catch (err) {
    console.error(err);
  } finally {
    await db.close();
  }
}

main();
