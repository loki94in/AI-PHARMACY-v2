import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('data', 'app.db');
const db = new Database(dbPath);
const tokenRow = db.prepare("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'").get();
const token = tokenRow ? tokenRow.value : '';

console.log('Testing Pharmarack Cart API with token prefix:', token.substring(0, 15));

const startTime = Date.now();
fetch('https://pharmretail-api.pharmarack.com/cart/api/v1/GetUserCartDetails', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'devicetype': 'web',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://retailers.pharmarack.com/',
    'Origin': 'https://retailers.pharmarack.com'
  }
})
.then(async (res) => {
  const duration = Date.now() - startTime;
  console.log(`Response Status: ${res.status} (${res.statusText})`);
  console.log(`Duration: ${duration}ms`);
  const text = await res.text();
  console.log('Response body preview:', text.substring(0, 500));
})
.catch((err) => {
  console.error('Error during cart fetch:', err);
});
