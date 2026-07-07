import { dbManager } from '../src/database/connection.js';

const db = await dbManager.getConnection();
const countRow = await db.get("SELECT COUNT(*) as total FROM medicines WHERE enrichment_status IN ('needs_review', 'unmatched')");
console.log('Total queue rows (all filter):', JSON.stringify(countRow));

const items = await db.all(
  "SELECT id, name, manufacturer, api_reference, enrichment_status, enrichment_confidence FROM medicines WHERE enrichment_status IN ('needs_review', 'unmatched') ORDER BY enrichment_confidence DESC LIMIT 5 OFFSET 0"
);
console.log('Sample rows:', JSON.stringify(items, null, 2));
await dbManager.close(true);
