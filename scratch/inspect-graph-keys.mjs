import { readFileSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), '.understand-anything', 'knowledge-graph.json');
const data = JSON.parse(readFileSync(file, 'utf8'));

console.log('Edges sample:', data.edges.slice(0, 5));
