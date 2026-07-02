const Database = require('better-sqlite3');
const db = new Database('data/app.db', { readonly: true });

console.log('=== APP SETTINGS ===');
const settings = db.prepare("SELECT key, value FROM app_settings").all();
for (const s of settings) {
  // Mask password for privacy
  const val = s.key.includes('pass') || s.key.includes('token') || s.key.includes('secret') ? '********' : s.value;
  console.log(`${s.key}: ${val}`);
}

console.log('\n=== RECENT ACTION LOGS ===');
const logs = db.prepare("SELECT * FROM action_logs ORDER BY created_at DESC LIMIT 20").all();
for (const log of logs) {
  console.log(`[${log.created_at}] [${log.action_type}] ${log.description}`);
}

console.log('\n=== EMAILS STATS ===');
const totalEmails = db.prepare("SELECT COUNT(*) as count FROM emails").all()[0].count;
console.log('Total emails in local DB:', totalEmails);
if (totalEmails > 0) {
  const latest = db.prepare("SELECT uid, from_addr, subject, date, is_saved, is_order FROM emails ORDER BY date DESC LIMIT 5").all();
  console.log('Latest emails in DB:');
  for (const e of latest) {
    console.log(`- UID: ${e.uid}, From: ${e.from_addr}, Subject: ${e.subject}, Date: ${e.date}, Saved: ${e.is_saved}, Order: ${e.is_order}`);
  }
}

db.close();
