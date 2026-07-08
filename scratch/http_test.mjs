import http from 'http';

function checkUrl(url) {
  return new Promise((resolve) => {
    console.log(`Sending request to ${url}...`);
    const req = http.get(url, { timeout: 2000 }, (res) => {
      console.log(`${url} STATUS: ${res.statusCode}`);
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log(`${url} BODY:`, body);
        resolve(true);
      });
    });

    req.on('error', (e) => {
      console.error(`${url} ERROR: ${e.message}`);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log(`${url} TIMEOUT!`);
      req.destroy();
      resolve(false);
    });
  });
}

async function run() {
  await checkUrl('http://127.0.0.1:3000/api/health');
  await checkUrl('http://[::1]:3000/api/health');
  await checkUrl('http://127.0.0.1:3000/api/messaging/qr');
}

run();
