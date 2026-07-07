import { dbManager } from '../src/database/connection.js';
import { ensureEnrichmentColumns } from '../src/worker/compositionEnricher.js';

const db = await dbManager.getConnection();
await ensureEnrichmentColumns(db);
const items = await db.all(
  "SELECT id, name, manufacturer, api_reference, enrichment_status, enrichment_confidence, suggested_composition FROM medicines WHERE enrichment_status IN ('needs_review', 'unmatched') ORDER BY enrichment_confidence DESC LIMIT 3 OFFSET 0"
);
console.log('Route-identical query succeeded:', JSON.stringify(items, null, 2));
await dbManager.close(true);
