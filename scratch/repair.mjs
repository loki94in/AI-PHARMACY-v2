import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), 'scripts', 'generate-3d-graph.mjs');
let content = readFileSync(file, 'utf8');

// We normalize newlines to make matching easy
content = content.replace(/\r\n/g, '\n');

// 1. global-stats
const target1 = "document.getElementById('global-stats').textContent = \n        `${rawGraph.nodes.length} Nodes | ${rawGraph.edges.length} Edges`;";
const replace1 = "document.getElementById('global-stats').textContent = \n        `\\${rawGraph.nodes.length} Nodes | \\${rawGraph.edges.length} Edges`;";
// Wait! On disk, it actually has `\${` (with backslash before dollar).
// Let's verify by checking if the file contains the target.
// Let's do a simple regex-based replacement or programmatic search for each block.

console.log('File length before repair:', content.length);

// Let's replace each block literally using single-quoted strings containing the exact text on disk.

// Block 1: global-stats
content = content.replace(
  "document.getElementById('global-stats').textContent = \n        `\\${rawGraph.nodes.length} Nodes | \\${rawGraph.edges.length} Edges`;",
  "document.getElementById('global-stats').textContent = \n        `\\${rawGraph.nodes.length} Nodes | \\${rawGraph.edges.length} Edges`;" // wait, we want to replace the bare backtick ` with \`
);

// Actually, to make it 100% robust and avoid match errors due to backslash mismatches:
// Let's replace the entire initApp function!
const targetInitApp = `    function initApp(graphJson) {
      rawGraph = graphJson;
      
      // Update global badges/stats
      document.getElementById('global-stats').textContent = 
        \`\\\${rawGraph.nodes.length} Nodes | \\\${rawGraph.edges.length} Edges\`;

      // Build layer filters UI dynamically
      buildLayerFilters();

      // Initialize active filters with all available layers
      activeFilters.layers = new Set(rawGraph.layers.map(l => l.id));
      
      // Setup UI listeners
      setupUIEventListeners();
      
      // Process and render
      applyFiltersAndRefresh();
    }`;

// Wait! In the above string targetInitApp, I wrote it using single-quotes/double-quotes in my code, but here I'm writing it in JS.
// Let's write the repair script to use indexOf and replace on the exact text.
// Let's view the exact text in generate-3d-graph.mjs for these functions so we can copy them.
// Wait, we can just replace the whole template string inside generate-3d-graph.mjs using a script that does not use template literals!
// Yes! We can read the template string as a raw text, but since it's inside generate-3d-graph.mjs, the easiest way is:
// We can use a RegExp to find the specific patterns:
// For example, in initApp:
// `document.getElementById('global-stats').textContent =\n        `\${rawGraph.nodes.length} Nodes | \${rawGraph.edges.length} Edges`;`
// Let's do regex replaces!
// We want to turn:
// `document.getElementById('global-stats').textContent = \n        `\${rawGraph.nodes.length}`
// into:
// `document.getElementById('global-stats').textContent = \n        \`\${rawGraph.nodes.length}`

// Let's test the replacements:

// 1. global-stats
content = content.replace(
  /document\.getElementById\('global-stats'\)\.textContent = \s*`\\\$\{rawGraph\.nodes\.length\} Nodes \| \\\$\{rawGraph\.edges\.length\}`;/g,
  "document.getElementById('global-stats').textContent = \n        \\`\\${rawGraph.nodes.length} Nodes | \\${rawGraph.edges.length} Edges\\`;"
);

// 2. buildLayerFilters innerHTML
content = content.replace(
  /label\.innerHTML = `\s*<input type="checkbox" checked value="\\\$\{layer\.id\}">\s*<span class="layer-color-dot" style="background-color: \\\$\{color\};"><\/span>\s*<span style="flex-grow: 1;">\\\$\{layer\.name\}<\/span>\s*<span style="font-size: 0.75rem; color: var\(--text-muted\); font-family: var\(--font-mono\);">\\\$\{layer\.nodeIds\.length\}<\/span>\s*`;/g,
  "label.innerHTML = \\`\n          <input type=\"checkbox\" checked value=\"\\${layer.id}\">\n          <span class=\"layer-color-dot\" style=\"background-color: \\${color};\"></span>\n          <span style=\"flex-grow: 1;\">\\${layer.name}</span>\n          <span style=\"font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);\">\\${layer.nodeIds.length}</span>\n        \\`;"
);

// 3. nodeLabel
content = content.replace(
  /\.nodeLabel\(node => `\s*<div class="graph-tooltip">\s*<div class="graph-tooltip-title">\\\$\{node\.name\}<\/div>\s*<div class="graph-tooltip-path">\\\$\{node\.filePath\}<\/div>\s*<\/div>\s*`\)/g,
  ".nodeLabel(node => \\`\n            <div class=\"graph-tooltip\">\n              <div class=\"graph-tooltip-title\">\\${node.name}</div>\n              <div class=\"graph-tooltip-path\">\\${node.filePath}</div>\n            </div>\n          \\`)"
);

// 4. badgeContainer
content = content.replace(
  /badgeContainer\.innerHTML = `\s*<span class="type-badge">\\\$\{node\.type\}<\/span>\s*<span class="type-badge" style="background-color: \\\$\{LAYER_COLORS\[node\.layerId\]\}20; color: \\\$\{LAYER_COLORS\[node\.layerId\]\}; border-color: \\\$\{LAYER_COLORS\[node\.layerId\]\}40;">\\\$\{node\.layerId\.split\(':'\)\.pop\(\)\}<\/span>\s*`;/g,
  "badgeContainer.innerHTML = \\`\n        <span class=\"type-badge\">\\${node.type}</span>\n        <span class=\"type-badge\" style=\"background-color: \\${LAYER_COLORS[node.layerId]}20; color: \\${LAYER_COLORS[node.layerId]}; border-color: \\${LAYER_COLORS[node.layerId]}40;\">\\${node.layerId.split(':').pop()}</span>\n      \\`;"
);

// 5. tag badge loop innerHTML
content = content.replace(
  /badgeContainer\.innerHTML \+= `<span class="tag-badge">\\\$\{tag\}<\/span>`;/g,
  "badgeContainer.innerHTML += \\`<span class=\"tag-badge\">\\${tag}</span>\\`;"
);

// 6. imports title
content = content.replace(
  /document\.getElementById\('title-imports'\)\.textContent = `Dependencies \(\\\$\{imports\.length\}\)`;/g,
  "document.getElementById('title-imports').textContent = \\`Dependencies (\\${imports.length})\\`;"
);

// 7. dependents title
content = content.replace(
  /document\.getElementById\('title-dependents'\)\.textContent = `Imported By \(\\\$\{dependents\.length\}\)`;/g,
  "document.getElementById('title-dependents').textContent = \\`Imported By (\\${dependents.length})\\`;"
);

// 8. alert
content = content.replace(
  /alert\(`Node "\\\$\{nodeId\.split\(':'\)\.pop\(\)\}" is currently filtered out\. Enable its layer\/type to view\.`\);/g,
  "alert(\\`Node \"\\${nodeId.split(':').pop()}\" is currently filtered out. Enable its layer/type to view.\\`);"
);

// 9. autocomplete item
content = content.replace(
  /item\.innerHTML = `\s*<strong>\\\$\{node\.name\}<\/strong>\s*<span class="autocomplete-item-path">\\\$\{node\.filePath\}<\/span>\s*`;/g,
  "item.innerHTML = \\`\n            <strong>\\${node.name}</strong>\n            <span class=\"autocomplete-item-path\">\\${node.filePath}</span>\n          \\`;"
);

writeFileSync(file, content, 'utf8');
console.log('Repair script finished.');
