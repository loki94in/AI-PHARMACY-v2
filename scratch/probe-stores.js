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

  console.log('Probing store-list API...');
  const response = await fetch('https://pharmretail-api.pharmarack.com/user/api/v2/store-list', {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'devicetype': 'web',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://retailers.pharmarack.com/',
      'Origin': 'https://retailers.pharmarack.com'
    },
    signal: AbortSignal.timeout(10000)
  });

  console.log(`Status: ${response.status}`);
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    fs.writeFileSync(path.resolve(__dirname, 'store-list-response.json'), JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Store list data saved. Keys: ${Object.keys(data)}`);
    if (data.data) {
      console.log(`Data array size: ${Array.isArray(data.data) ? data.data.length : typeof data.data}`);
      if (Array.isArray(data.data) && data.data.length > 0) {
        console.log('First store sample:', JSON.stringify(data.data[0], null, 2));
      }
    } else {
      console.log('Response body:', JSON.stringify(data, null, 2).slice(0, 1000));
    }
  } catch (e) {
    console.log('Raw text output (truncated):', text.slice(0, 2000));
  }
}

main().catch(console.error);
