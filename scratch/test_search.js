import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('data', 'app.db');
const db = new Database(dbPath);
const tokenRow = db.prepare("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'").get();
const token = tokenRow ? tokenRow.value : '';

console.log('Testing Pharmarack Search API with token prefix:', token.substring(0, 15));

const payload = {
  SearchKeyword: 'paracetamol',
  StoreId: [],
  NonMappedStoreId: [],
  Count: 10,
  SkipCount: 0,
  isMappedSearch: null,
  IsStock: 2,
  IsScheme: 2,
  IsSort: 1,
  CartSource: 'MOVP'
};

const startTime = Date.now();
fetch('https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/search', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'devicetype': 'web',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://retailers.pharmarack.com/',
    'Origin': 'https://retailers.pharmarack.com'
  },
  body: JSON.stringify(payload)
})
.then(async (res) => {
  const duration = Date.now() - startTime;
  console.log(`Response Status: ${res.status} (${res.statusText})`);
  console.log(`Duration: ${duration}ms`);
  const text = await res.text();
  console.log('Response body preview:', text.substring(0, 500));
})
.catch((err) => {
  console.error('Error during search fetch:', err);
});
