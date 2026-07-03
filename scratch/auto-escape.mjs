import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), 'scripts', 'generate-3d-graph.mjs');
let content = readFileSync(file, 'utf8');

// Normalize newlines
content = content.replace(/\r\n/g, '\n');
const lines = content.split('\n');

let inScriptBlock = false;
let fixedCount = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.includes('<script>')) {
    inScriptBlock = true;
    continue;
  }
  
  if (line.includes('</script>')) {
    inScriptBlock = false;
    continue;
  }
  
  if (inScriptBlock) {
    // If the line contains INITIAL_GRAPH_DATA, it's the JSON block, skip it
    if (line.includes('INITIAL_GRAPH_DATA')) {
      continue;
    }
    
    // Replace any backtick NOT preceded by a backslash with \`
    // We use a negative lookbehind regex: /(?<!\\)`/g
    const newLine = line.replace(/(?<!\\)`/g, '\\`');
    if (newLine !== line) {
      lines[i] = newLine;
      fixedCount++;
    }
  }
}

writeFileSync(file, lines.join('\n'), 'utf8');
console.log(`Auto-escape finished. Fixed ${fixedCount} lines.`);
