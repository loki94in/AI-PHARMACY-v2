import Database from 'better-sqlite3';
const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });
console.log('--- medicines columns ---');
console.log(db.prepare("PRAGMA table_info(medicines)").all().map(c => c.name).join(', '));
console.log('--- inventory_master columns ---');
console.log(db.prepare("PRAGMA table_info(inventory_master)").all().map(c => c.name).join(', '));
db.close();
