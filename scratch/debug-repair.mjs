import { readFileSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), 'scripts', 'generate-3d-graph.mjs');
let content = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

let index = -1;
while ((index = content.indexOf('global-stats', index + 1)) >= 0) {
  console.log('Found global-stats at:', index);
  console.log('Context:\n', content.substring(index - 50, index + 150));
  console.log('------------------');
}
