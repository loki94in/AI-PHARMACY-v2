import Database from 'better-sqlite3';

const db = new Database('./data/app.db');

console.log(db.prepare("SELECT * FROM whatsapp_send_queue WHERE id >= 290").all());

db.close();
