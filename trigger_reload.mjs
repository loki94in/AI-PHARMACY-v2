// Triggers the backend's internal reference loader using the already-on-disk CSV
// by calling a dedicated lightweight endpoint that just runs loadReferenceData({ force: true })
// This avoids the 114MB HTTP upload and DB lock issues.
import http from 'http';

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/enrichment/reference/reload',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': 0 }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});
req.on('error', e => console.error('Error:', e));
req.end();
