const Database = require('better-sqlite3');
const db = new Database('data/app.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables count:', tables.length);
console.log('Tables:', tables.map(t => t.name).join(', '));
for (const t of tables) {
  const info = db.prepare('PRAGMA table_info(' + t.name + ')').all();
  console.log('\n' + t.name + ': [' + info.map(c => c.name).join(', ') + ']');
}
db.close();
