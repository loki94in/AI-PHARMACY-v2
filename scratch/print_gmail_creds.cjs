const Database = require('better-sqlite3');
const db = new Database('data/app.db', { readonly: true });

const keys = [
  'gmail_user',
  'gmail_pass',
  'gmail_auth_method',
  'gmail_oauth_access_token',
  'gmail_oauth_refresh_token',
  'gmail_oauth_token_expiry',
  'google_client_id',
  'google_client_secret'
];

for (const key of keys) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  console.log(`${key}:`, row ? `'${row.value}'` : 'not set');
}

db.close();
