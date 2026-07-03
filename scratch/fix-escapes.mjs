import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), 'scripts', 'generate-3d-graph.mjs');
let content = readFileSync(file, 'utf8');

// We want to ensure all these lines inside htmlContent use exactly one backslash for backticks and dollar signs
// Let's replace the broken lines with the correct escaped versions.
// We use single quotes in this repair script to avoid escaping backticks!

const replacements = [
  {
    target: "document.getElementById('global-stats').textContent = \n        `${rawGraph.nodes.length} Nodes | ${rawGraph.edges.length} Edges`;",
    replace: "document.getElementById('global-stats').textContent = \n        `\\${rawGraph.nodes.length} Nodes | \\${rawGraph.edges.length} Edges`;"
  },
  {
    target: "label.innerHTML = `\n          <input type=\"checkbox\" checked value=\"${layer.id}\">\n          <span class=\"layer-color-dot\" style=\"background-color: ${color};\"></span>\n          <span style=\"flex-grow: 1;\">${layer.name}</span>\n          <span style=\"font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);\">${layer.nodeIds.length}</span>\n        `;",
    replace: "label.innerHTML = `\n          <input type=\"checkbox\" checked value=\"\\${layer.id}\">\n          <span class=\"layer-color-dot\" style=\"background-color: \\${color};\"></span>\n          <span style=\"flex-grow: 1;\">\\${layer.name}</span>\n          <span style=\"font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);\">\\${layer.nodeIds.length}</span>\n        `;"
  },
  {
    target: ".nodeLabel(node => `\n            <div class=\"graph-tooltip\">\n              <div class=\"graph-tooltip-title\">${node.name}</div>\n              <div class=\"graph-tooltip-path\">${node.filePath}</div>\n            </div>\n          `)",
    replace: ".nodeLabel(node => `\n            <div class=\"graph-tooltip\">\n              <div class=\"graph-tooltip-title\">\\${node.name}</div>\n              <div class=\"graph-tooltip-path\">\\${node.filePath}</div>\n            </div>\n          `)"
  },
  {
    target: "badgeContainer.innerHTML = `\n        <span class=\"type-badge\">${node.type}</span>\n        <span class=\"type-badge\" style=\"background-color: ${LAYER_COLORS[node.layerId]}20; color: ${LAYER_COLORS[node.layerId]}; border-color: ${LAYER_COLORS[node.layerId]}40;\">${node.layerId.split(':').pop()}</span>\n      `;\n      if (node.tags) {\n        node.tags.forEach(tag => {\n          badgeContainer.innerHTML += `<span class=\"tag-badge\">${tag}</span>`;\n        });\n      }",
    replace: "badgeContainer.innerHTML = `\n        <span class=\"type-badge\">\\${node.type}</span>\n        <span class=\"type-badge\" style=\"background-color: \\${LAYER_COLORS[node.layerId]}20; color: \\${LAYER_COLORS[node.layerId]}; border-color: \\${LAYER_COLORS[node.layerId]}40;\">\\${node.layerId.split(':').pop()}</span>\n      `;\n      if (node.tags) {\n        node.tags.forEach(tag => {\n          badgeContainer.innerHTML += `<span class=\"tag-badge\">\\${tag}</span>`;\n        });\n      }"
  },
  {
    target: "document.getElementById('title-imports').textContent = `Dependencies (${imports.length})`;",
    replace: "document.getElementById('title-imports').textContent = `Dependencies (\\${imports.length})`;"
  },
  {
    target: "document.getElementById('title-dependents').textContent = `Imported By (${dependents.length})`;",
    replace: "document.getElementById('title-dependents').textContent = `Imported By (\\${dependents.length})`;"
  },
  {
    target: "alert(`Node \"${nodeId.split(':').pop()}\" is currently filtered out. Enable its layer/type to view.`);",
    replace: "alert(`Node \"\\${nodeId.split(':').pop()}\" is currently filtered out. Enable its layer/type to view.`);"
  },
  {
    target: "item.innerHTML = `\n            <strong>${node.name}</strong>\n            <span class=\"autocomplete-item-path\">${node.filePath}</span>\n          `;",
    replace: "item.innerHTML = `\n            <strong>\\${node.name}</strong>\n            <span class=\"autocomplete-item-path\">\\${node.filePath}</span>\n          `;"
  }
];

// In the replacements, we also need to escape the backticks around the replacement blocks so they have a single backslash
// Let's do this programmatically or just do it by replacing the backticks with \`
for (const r of replacements) {
  let targetNormalized = r.target.replace(/\r\n/g, '\n');
  let replaceNormalized = r.replace.replace(/\r\n/g, '\n');
  
  // Since on disk the backticks in the target lines are currently bare backticks, we find them and escape them in the replacement
  // We want to add a backslash before every backtick in the replacement content
  let fixedReplace = replaceNormalized.replace(/`/g, '\\`');
  
  if (content.includes(targetNormalized)) {
    content = content.replace(targetNormalized, fixedReplace);
    console.log('Successfully replaced block!');
  } else {
    console.warn('Could not find block:\n' + targetNormalized.substring(0, 100));
  }
}

writeFileSync(file, content, 'utf8');
console.log('Finished fixing generate-3d-graph.mjs');
