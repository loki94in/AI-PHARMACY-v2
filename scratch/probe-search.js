import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');

async function main() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  const rows = await db.all("SELECT key, value FROM app_settings WHERE key LIKE 'pharmarack_%'");
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  await db.close();

  const token = settings['pharmarack_session_token'];
  if (!token) { console.error('No token!'); return; }
  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  // Let's use Ambika Distributors (StoreId: 9062), which we know is non-mapped
  const payload = {
    SearchKeyword: 'dolo',
    StoreId: [],
    NonMappedStoreId: [9062],
    Count: 10,
    SkipCount: 0,
    isMappedSearch: false,
    IsStock: 2,
    IsScheme: 2,
    IsSort: 1,
    CartSource: 'MOVP'
  };

  console.log('Searching for dolo in Ambika Distributors (9062)...');
  const response = await fetch('https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/search', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'devicetype': 'web',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://retailers.pharmarack.com/',
      'Origin': 'https://retailers.pharmarack.com'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });

  console.log(`Status: ${response.status}`);
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    console.log(`Success: ${data.success}, StatusCode: ${data.StatusCode}`);
    if (data.data) {
      console.log(`Results count: ${data.data.length}`);
      if (data.data.length > 0) {
        console.log('First search result sample:', JSON.stringify(data.data[0], null, 2));
      }
    } else {
      console.log('Response body:', JSON.stringify(data, null, 2).slice(0, 1000));
    }
  } catch (e) {
    console.log('Raw text output (truncated):', text.slice(0, 2000));
  }
}

main().catch(console.error);
