import { dbManager } from '../src/database/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'app.db');

async function run() {
  console.log('--- DB COMPACTION & CHECKPOINT ---');
  
  if (fs.existsSync(DB_PATH)) {
    const stats = fs.statSync(DB_PATH);
    console.log(`Original DB size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  }
  const walPath = DB_PATH + '-wal';
  if (fs.existsSync(walPath)) {
    const stats = fs.statSync(walPath);
    console.log(`Original WAL size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  }

  const db = await dbManager.getConnection();
  console.log('Connected. Running WAL checkpoint...');
  
  const cpStart = Date.now();
  const checkpoint = await db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  console.log(`WAL checkpoint (TRUNCATE) took ${Date.now() - cpStart}ms. Result:`, checkpoint);

  console.log('Running VACUUM (this might take a few seconds)...');
  const vacStart = Date.now();
  await db.run('VACUUM');
  console.log(`VACUUM took ${Date.now() - vacStart}ms.`);

  await dbManager.close(true);

  if (fs.existsSync(DB_PATH)) {
    const stats = fs.statSync(DB_PATH);
    console.log(`New DB size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  }
  if (fs.existsSync(walPath)) {
    const stats = fs.statSync(walPath);
    console.log(`New WAL size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  }
}

run();
