import Database from 'better-sqlite3';

const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('--- Database Tables & Row Counts ---');
  for (const table of tables) {
    const tableName = table.name;
    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM [${tableName}]`).get();
    console.log(`${tableName}: ${countRow.cnt} rows`);
  }
} catch (e) {
  console.error('Error querying database:', e.message);
} finally {
  db.close();
}
