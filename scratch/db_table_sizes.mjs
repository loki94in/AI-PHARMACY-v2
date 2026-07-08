import { dbManager } from '../src/database/connection.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const db = await dbManager.getConnection();
  console.log('Connected to database.');

  // List all tables
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('Tables count:', tables.length);

  console.log('Checking all table row counts...');
  const results = [];
  for (const t of tables) {
    try {
      const countRow = await db.get(`SELECT COUNT(*) as count FROM ${t.name}`);
      results.push({ table: t.name, count: countRow.count });
    } catch (e) {
      results.push({ table: t.name, count: -1, error: e.message });
    }
  }

  // Sort by count descending
  results.sort((a, b) => b.count - a.count);
  console.log('Row counts sorted:');
  console.table(results);

  await dbManager.close(true);
}
run();
