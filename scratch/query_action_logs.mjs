import Database from 'better-sqlite3';

const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });

try {
  const logs = db.prepare('SELECT * FROM action_logs ORDER BY id DESC LIMIT 20').all();
  console.log('--- Action Logs ---');
  logs.forEach(log => {
    console.log(JSON.stringify(log, null, 2));
  });
} catch (e) {
  console.error('Error querying database:', e.message);
} finally {
  db.close();
}
