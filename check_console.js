import puppeteer from 'puppeteer-core';

(async () => {
  try {
    const browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true
    });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.stack || err.message));
    
    // Track XHR responses
    const apiResponses = [];
    page.on('response', async response => {
      if (response.url().includes('/api/investigation') || response.url().includes('/api/inventory')) {
        try {
          const data = await response.json();
          apiResponses.push({ url: response.url(), status: response.status(), keys: Object.keys(data), dataLen: data.data ? data.data.length : null });
        } catch (_) {}
      }
    });
    
    console.log('Navigating to http://localhost:5173/investigation...');
    await page.goto('http://localhost:5173/investigation');
    await new Promise(resolve => setTimeout(resolve, 8000)); // Wait 8 seconds for API responses
    
    console.log('API responses captured:', JSON.stringify(apiResponses, null, 2));
    
    // Check what's actually rendered inside the investigation panel
    const panelContent = await page.evaluate(() => {
      // Look for the specific ledger table
      const table = document.querySelector('table');
      const rows = table ? table.querySelectorAll('tbody tr') : [];
      const rowCount = rows.length;
      const firstRowText = rows[0] ? rows[0].innerText.substring(0, 200) : 'NO ROWS';
      
      // Look for empty/loading state
      const bodyText = document.body.innerText;
      const hasNoLedger = bodyText.includes('No ledger entries');
      const hasLoadingStock = bodyText.includes('Loading Stock Ledger');
      const hasSaleEntry = bodyText.includes('Sale');
      const hasPurchaseEntry = bodyText.includes('Purchase');
      
      return { rowCount, firstRowText, hasNoLedger, hasLoadingStock, hasSaleEntry, hasPurchaseEntry };
    });
    
    console.log('Panel state:', panelContent);
    
    await browser.close();
  } catch (err) {
    console.error('Puppeteer run failed:', err);
  }
})();
