const Database = require('better-sqlite3');
const db = new Database('data/app.db', { readonly: true });
console.log(db.prepare("SELECT * FROM app_settings WHERE key LIKE 'pharmarack_%'").all());
db.close();
