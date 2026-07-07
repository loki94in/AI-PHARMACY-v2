import { RxNormClient } from '../src/services/apiClients/rxNormClient.js';
const client = new RxNormClient();
console.log('--- Combination drug: Vicodin (hydrocodone/acetaminophen brand) ---');
console.log(JSON.stringify(await client.queryMedicine('Vicodin')));
console.log('--- Combination drug: Duexis (ibuprofen/famotidine) ---');
console.log(JSON.stringify(await client.queryMedicine('Duexis')));
