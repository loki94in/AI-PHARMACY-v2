import { dbManager } from '../src/database/connection.js';

const db = await dbManager.getConnection();
const nullCount = await db.get("SELECT COUNT(*) as c FROM medicines WHERE enrichment_status = 'needs_review' AND suggested_composition IS NULL");
const filledCount = await db.get("SELECT COUNT(*) as c FROM medicines WHERE enrichment_status = 'needs_review' AND suggested_composition IS NOT NULL");
console.log('needs_review with NULL suggestion:', nullCount.c);
console.log('needs_review with filled suggestion:', filledCount.c);

const samples = await db.all(
  "SELECT id, name, enrichment_confidence, suggested_composition FROM medicines WHERE enrichment_status = 'needs_review' AND suggested_composition IS NOT NULL LIMIT 5"
);
console.log('Samples:', JSON.stringify(samples, null, 2));
await dbManager.close(true);
