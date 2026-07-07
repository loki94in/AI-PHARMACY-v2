import { RxNormClient } from '../src/services/apiClients/rxNormClient.js';
import { withRetry } from '../src/utils/retry.js';

const client = new RxNormClient();

console.log('--- RxNorm: known drug (Ibuprofen) ---');
const result1 = await client.queryMedicine('Ibuprofen');
console.log(JSON.stringify(result1));

console.log('--- RxNorm: gibberish name (should be null) ---');
const result2 = await client.queryMedicine('Zzzznotarealdrugxyz123');
console.log(JSON.stringify(result2));

console.log('--- withRetry: fn that fails twice then succeeds ---');
let calls = 0;
const retried = await withRetry(async () => {
  calls++;
  if (calls < 3) return null;
  return { ok: true, calls };
}, { label: 'test', delayMs: 50 });
console.log('Result:', JSON.stringify(retried), 'Total calls:', calls);

console.log('--- withRetry: fn that always fails (should give up after 3 attempts) ---');
let calls2 = 0;
const gaveUp = await withRetry(async () => {
  calls2++;
  return null;
}, { label: 'test2', delayMs: 50 });
console.log('Result:', gaveUp, 'Total calls:', calls2);
