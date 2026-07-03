import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PORT = 9898;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  let filePath = join(process.cwd(), req.url === '/' ? '3d-knowledge-graph.html' : req.url);
  
  // Remove query params or hashes
  filePath = filePath.split('?')[0].split('#')[0];
  
  if (existsSync(filePath)) {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const mime = MIME_TYPES[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
