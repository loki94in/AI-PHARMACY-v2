import { readFileSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), '.understand-anything', 'knowledge-graph.json');
const data = JSON.parse(readFileSync(file, 'utf8'));

console.log('Nodes count:', data.nodes.length);
const samples = data.nodes.slice(0, 15);
for (const n of samples) {
  console.log(`Node ID: ${n.id}, filePath: ${n.filePath}`);
}

const layerCount = {};
for (const node of data.nodes) {
  const layer = getLayer(node.filePath || '');
  layerCount[layer] = (layerCount[layer] || 0) + 1;
}
console.log('Layer classification count:', layerCount);

function getLayer(filePath) {
  if (filePath.startsWith('frontend/')) return 'layer:presentation';
  if (filePath.startsWith('pharmacy-mobile/')) return 'layer:mobile';
  if (filePath.startsWith('src/routes/')) return 'layer:api';
  if (filePath.startsWith('src/services/')) return 'layer:service';
  if (filePath.startsWith('src/middleware/') || filePath.startsWith('src/worker/')) return 'layer:infrastructure';
  if (filePath.startsWith('data/') || filePath.startsWith('CATALOG/')) return 'layer:data';
  if (filePath.startsWith('tests/')) return 'layer:testing';
  if (filePath.startsWith('docs/')) return 'layer:documentation';
  if (filePath.startsWith('scripts/') || filePath.startsWith('src/scripts/') || filePath.startsWith('src/cli/')) return 'layer:scripts';
  return 'layer:configuration';
}
