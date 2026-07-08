import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'app.db');

async function run() {
  console.log('--- RUNNING VACUUM (RAW CONNECTION) ---');
  
  if (fs.existsSync(DB_PATH)) {
    const stats = fs.statSync(DB_PATH);
    console.log(`Original DB size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.error('Database file not found at:', DB_PATH);
    process.exit(1);
  }

  try {
    console.log('Opening raw sqlite3 connection...');
    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    console.log('Connected. Running VACUUM...');
    
    const start = Date.now();
    await db.run('VACUUM');
    console.log(`VACUUM completed in ${((Date.now() - start) / 1000).toFixed(2)}s.`);
    
    await db.close();
    console.log('Connection closed.');

    const stats = fs.statSync(DB_PATH);
    console.log(`New DB size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('Vacuum operation failed:', err);
  }
}

run();
