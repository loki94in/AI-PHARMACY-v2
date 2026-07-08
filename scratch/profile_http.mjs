import axios from 'axios';

async function run() {
  console.log('--- PROFILING HTTP ENDPOINTS ---');
  const endpoints = [
    { name: 'GET /api/orders', url: 'http://localhost:3000/api/orders' },
    { name: 'GET /api/crm/doctors', url: 'http://localhost:3000/api/crm/doctors' },
    { name: 'GET /api/inventory?limit=12', url: 'http://localhost:3000/api/inventory?limit=12' },
    { name: 'GET /api/medicines/compact', url: 'http://localhost:3000/api/medicines/compact' }
  ];

  for (const ep of endpoints) {
    const start = Date.now();
    try {
      const res = await axios.get(ep.url, { headers: { 'x-session-token': 'true' } });
      const elapsed = Date.now() - start;
      console.log(`${ep.name}: Success, Status: ${res.status}, Time: ${elapsed}ms, Data Size: ${JSON.stringify(res.data).length} bytes`);
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log(`${ep.name}: FAILED, Time: ${elapsed}ms, Error: ${err.message}`);
    }
  }
}

run();
