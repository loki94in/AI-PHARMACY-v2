import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('data', 'app.db');
console.log('Opening database at:', dbPath);

try {
  const db = new Database(dbPath);
  const rows = db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'pharmarack_%' OR key = 'automation_enabled'").all();
  console.log('Database settings:');
  console.log(JSON.stringify(rows, null, 2));
  db.close();
} catch (err) {
  console.error('Failed to read database:', err);
}
