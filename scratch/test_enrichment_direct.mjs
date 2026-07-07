import { getEnrichmentStatus, getEnrichmentRunningState, loadReferenceData } from '../src/worker/compositionEnricher.js';

const status = await getEnrichmentStatus();
console.log('Enrichment status:', JSON.stringify(status));
console.log('Running state:', getEnrichmentRunningState());

const refLoad = await loadReferenceData();
console.log('Reference data load result:', JSON.stringify(refLoad));
