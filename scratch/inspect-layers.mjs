import { readFileSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), '.understand-anything', 'knowledge-graph.json');
const data = JSON.parse(readFileSync(file, 'utf8'));

console.log('Layers count:', data.layers.length);
for (const layer of data.layers) {
  console.log(`Layer ID: ${layer.id}, Name: ${layer.name}, NodeIds count: ${layer.nodeIds.length}`);
  console.log('Sample NodeIds:', layer.nodeIds.slice(0, 5));
}
