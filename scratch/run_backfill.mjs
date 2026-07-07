import { backfillSuggestedCompositions } from '../src/worker/compositionEnricher.js';
const result = await backfillSuggestedCompositions();
console.log('Backfill result:', JSON.stringify(result));
