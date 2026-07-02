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
  if (!chromePath) {
    console.error('Google Chrome not found.');
    return;
  }

  const pharmarackProfilePath = path.resolve(__dirname, '..', 'data', 'pharmarack_profile');
  console.log('Launching browser with profile:', pharmarackProfilePath);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: pharmarackProfilePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const [page] = await browser.pages();

  // Intercept and log all cart-related network requests
  page.on('request', request => {
    const url = request.url();
    if (url.includes('cart') || url.includes('Cart')) {
      console.log(`\n>>> Intercepted Request: ${request.method()} ${url}`);
      console.log('Headers:', JSON.stringify(request.headers(), null, 2));
      const postData = request.postData();
      if (postData) {
        console.log('Payload:', postData);
      }
    }
  });

  console.log('Navigating to search page...');
  await page.goto('https://retailers.pharmarack.com/search', { waitUntil: 'networkidle2', timeout: 45000 });

  console.log('Current URL:', page.url());

  // Input search term
  const searchSelector = 'input[placeholder*="search" i], input[placeholder*="medicine" i], input[type="search"]';
  await page.waitForSelector(searchSelector, { timeout: 15000 });
  await page.focus(searchSelector);
  await page.type(searchSelector, 'Inderal LA 20');
  await page.keyboard.press('Enter');

  console.log('Search submitted. Waiting for results...');
  await new Promise(r => setTimeout(r, 5000));

  // Find and click Add to Cart
  const addBtnSelector = 'button[class*="add" i], button[id*="add" i], button[title*="add" i], .add-to-cart, .btn-add';
  console.log('Waiting for Add to Cart button...');
  await page.waitForSelector(addBtnSelector, { timeout: 15000 });
  
  console.log('Clicking Add to Cart button...');
  await page.click(addBtnSelector);

  console.log('Button clicked. Waiting to capture request...');
  await new Promise(r => setTimeout(r, 5000));

  await browser.close();
  console.log('Done.');
}

main().catch(console.error);
