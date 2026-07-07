import { getEnrichmentStatus, getEnrichmentRunningState } from '../src/worker/compositionEnricher.js';
const status = await getEnrichmentStatus();
console.log('status:', JSON.stringify(status));
console.log('running (this process only):', getEnrichmentRunningState());
