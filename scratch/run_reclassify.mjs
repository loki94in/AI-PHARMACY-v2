import { reclassifyNonPharmaProducts } from '../src/worker/compositionEnricher.js';
const result = await reclassifyNonPharmaProducts();
console.log('Reclassify result:', JSON.stringify(result));
