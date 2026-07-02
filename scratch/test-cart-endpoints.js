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

  const start = Date.now();
  const response = await fetch('https://pharmretail-api.pharmarack.com/cart/api/v1/GetUserCartDetails', {
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
    signal: AbortSignal.timeout(15000)
  });
  const elapsed = Date.now() - start;
  
  console.log(`Status: ${response.status} | Time: ${elapsed}ms`);
  
  const text = await response.text();
  
  // Write full response to file for inspection
  fs.writeFileSync(path.resolve(__dirname, 'cart-response.json'), text, 'utf-8');
  console.log(`Full response saved to scratch/cart-response.json (${text.length} bytes)`);
  
  // Parse and show structure
  const data = JSON.parse(text);
  console.log('\nTop-level keys:', Object.keys(data));
  console.log('StatusCode:', data.StatusCode);
  console.log('Message:', data.Message);
  
  if (data.IList && data.IList.length > 0) {
    console.log(`\nIList count: ${data.IList.length} distributors`);
    for (const store of data.IList) {
      console.log(`\n--- Store: ${store.StoreName} (ID: ${store.StoreId}) ---`);
      console.log('  Store-level keys:', Object.keys(store));
      if (store.lineItems && store.lineItems.length > 0) {
        console.log(`  lineItems count: ${store.lineItems.length}`);
        // Show first item in full
        console.log('  First line item keys:', Object.keys(store.lineItems[0]));
        console.log('  First line item:', JSON.stringify(store.lineItems[0], null, 2));
      }
    }
  }
}

main().catch(console.error);
