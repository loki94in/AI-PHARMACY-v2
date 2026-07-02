import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const chromePath = findChromePath();
  if (!chromePath) { console.error('Chrome not found.'); return; }

  const pharmarackProfilePath = path.resolve(__dirname, '..', 'data', 'pharmarack_profile');
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: pharmarackProfilePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const [page] = await browser.pages();

  // Capture ALL network requests when navigating to cart page
  const captured = [];
  page.on('request', request => {
    const url = request.url();
    // Log only API/XHR calls, skip static assets
    if (url.includes('.js') || url.includes('.css') || url.includes('.png') || url.includes('.svg') || url.includes('.woff') || url.includes('.ico')) return;
    const entry = {
      method: request.method(),
      url,
      headers: request.headers(),
      postData: request.postData() || null
    };
    captured.push(entry);
  });

  page.on('response', async response => {
    const url = response.url();
    if (url.includes('.js') || url.includes('.css') || url.includes('.png') || url.includes('.svg') || url.includes('.woff') || url.includes('.ico')) return;
    const status = response.status();
    // Only log API-like responses (JSON)
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json')) {
      try {
        const body = await response.text();
        const preview = body.length > 800 ? body.substring(0, 800) + '...' : body;
        console.log(`\n<<< RESPONSE: ${response.request().method()} ${url}`);
        console.log(`    Status: ${status}`);
        console.log(`    Body: ${preview}`);
      } catch (e) {
        console.log(`\n<<< RESPONSE: ${url} | Status: ${status} | (Could not read body)`);
      }
    }
  });

  console.log('Navigating to cart page...');
  await page.goto('https://retailers.pharmarack.com/cart', { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('\nCurrent URL:', page.url());
  
  // Wait a bit longer for any lazy-loaded API calls
  await new Promise(r => setTimeout(r, 5000));

  console.log('\n=== ALL CAPTURED REQUESTS ===');
  for (const c of captured) {
    if (c.url.includes('pharmarack.com') && !c.url.includes('.js') && !c.url.includes('.css')) {
      console.log(`${c.method} ${c.url}`);
      if (c.postData) console.log(`  Payload: ${c.postData.substring(0, 400)}`);
    }
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);
