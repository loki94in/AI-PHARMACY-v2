import { productNameFilterService } from '../src/services/productNameFilterService.js';
import { searchCatalog } from '../src/services/pharmarackCatalogCache.js';
import { dbManager } from '../src/database/connection.js';

async function main() {
  const dbPath = 'data/app.db';
  process.env.DB_PATH = dbPath;

  const medicineName = 'Azetor 20';
  console.log(`Processing extraction for: "${medicineName}"`);

  // 1. Search local medicines
  const filterResult = await productNameFilterService.filterProductNames(medicineName, {
    minConfidenceThreshold: 0.6
  });
  console.log('\n--- Local Matches ---');
  console.log(filterResult.matches);

  // 2. Direct Pharmarack catalog search
  console.log('\n--- Catalog Search Results ---');
  let catalogResults = null;
  try {
    catalogResults = await searchCatalog(medicineName);
    console.log(JSON.stringify(catalogResults, null, 2));
  } catch (err) {
    console.error('Catalog search error:', err);
  }

  // 3. Construct the message that would be sent
  console.log('\n--- Constructed Admin Notification Message ---');
  let messageText = '';
  if (filterResult.matches.length > 0) {
    messageText = `🔔 *Prescription Medicine Extracted*\n\n` +
      `• *Customer:* Test Customer\n` +
      `• *Phone:* 919000000001\n` +
      `• *Extracted Medicine:* ${medicineName} (Qty: 1)\n` +
      `• *Local Stock Match:* Yes (${filterResult.matches[0]})`;
  } else {
    const topMatches = catalogResults?.mapped || [];
    const matchLines = topMatches.slice(0, 3).map(m => `  - ${m.name} (MRP: ₹${m.mrp}, Pack: ${m.packaging})`).join('\n');
    messageText = `⚠️ *Medicine NOT in Local Stock — PharmaRack Matches*\n\n` +
      `• *Customer:* Test Customer\n` +
      `• *Phone:* 919000000001\n` +
      `• *Extracted Medicine:* ${medicineName} (Qty: 1)\n\n` +
      `*PharmaRack Matches Found:*\n${matchLines || '  - None'}\n\n` +
      `_Review pending in Admin Panel._`;
  }
  console.log(messageText);

  await dbManager.close(true);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
