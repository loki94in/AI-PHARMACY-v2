#!/usr/bin/env node

/**
 * Generate Complete Project Documentation from the Knowledge Graph
 *
 * Reads .understand-anything/knowledge-graph.json and renders a single,
 * comprehensive Markdown reference describing the entire project:
 * architecture layers, every file node, import/dependency edges, tests,
 * and configuration.
 *
 * Run: node scripts/generate-project-docs.mjs
 * Output: docs/KNOWLEDGE_GRAPH_DOCUMENTATION.md
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const GRAPH_PATH = join(ROOT, '.understand-anything', 'knowledge-graph.json');
const META_PATH = join(ROOT, '.understand-anything', 'meta.json');
const OUT_PATH = join(ROOT, 'docs', 'KNOWLEDGE_GRAPH_DOCUMENTATION.md');

const LAYER_ORDER = [
  'layer:presentation',
  'layer:mobile',
  'layer:api',
  'layer:service',
  'layer:infrastructure',
  'layer:data',
  'layer:testing',
  'layer:documentation',
  'layer:scripts',
  'layer:configuration'
];

const LAYER_COLOR = {
  'layer:presentation': '#ec4899',
  'layer:mobile': '#f59e0b',
  'layer:api': '#a855f7',
  'layer:service': '#10b981',
  'layer:data': '#3b82f6',
  'layer:infrastructure': '#06b6d4',
  'layer:testing': '#ef4444',
  'layer:documentation': '#6b7280',
  'layer:scripts': '#14b8a6',
  'layer:configuration': '#84cc16'
};

// Paths to exclude from the narrative walkthrough (vendored / generated / caches)
const EXCLUDE_IF = [
  '/.venv/', 'site-packages/', 'node_modules/', '/.expo/', '/.wwebjs_',
  '/dist/', '/dist-pkg/', '/build/', '/backup/', 'coverage/', '/.gradle/'
];

export function generateProjectDocs() {
  if (!existsSync(GRAPH_PATH)) {
    console.error('knowledge-graph.json not found. Run `node scripts/quick-update.mjs` first.');
    return;
  }

  const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));
  const meta = existsSync(META_PATH) ? JSON.parse(readFileSync(META_PATH, 'utf8')) : {};

  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
  const layerById = new Map(graph.layers.map(l => [l.id, l]));

  // Filter out vendored/generated noise for the narrative sections
  const isNoise = n => EXCLUDE_IF.some(s => (n.filePath || '').includes(s));
  const cleanNodes = graph.nodes.filter(n => !isNoise(n));
  const cleanNodeIds = new Set(cleanNodes.map(n => n.id));
  const cleanEdges = graph.edges.filter(e => cleanNodeIds.has(e.source) && cleanNodeIds.has(e.target));

  const typeCount = {};
  cleanNodes.forEach(n => { typeCount[n.type] = (typeCount[n.type] || 0) + 1; });

  const layerCount = {};
  cleanNodes.forEach(n => {
    const layer = graph.layers.find(l => l.nodeIds.includes(n.id));
    const key = layer ? layer.id : 'layer:configuration';
    layerCount[key] = (layerCount[key] || 0) + 1;
  });

  const links = [];
  graph.layers.forEach(l => {
    const count = layerCount[l.id] || 0;
    links.push(`[${l.name}](#${l.id.replace(/:/g, '-')})`);
  });

  const md = [];
  md.push(`# AI Pharmacy OS — Complete Project Documentation`);
  md.push('');
  md.push(`> **Auto-generated from the project knowledge graph** (\`.understand-anything/knowledge-graph.json\`). Do not edit by hand — run \`node scripts/generate-project-docs.mjs\` after \`node scripts/quick-update.mjs\` to refresh.`);
  md.push('');
  md.push('## Project Overview');
  md.push('');
  md.push(`| Attribute | Value |`);
  md.push(`|---|---|`);
  md.push(`| **Name** | ${graph.project?.name || 'AI Pharmacy OS'} |`);
  md.push(`| **Description** | ${graph.project?.description || ''} |`);
  md.push(`| **Languages** | ${(graph.project?.languages || []).join(', ')} |`);
  md.push(`| **Frameworks** | ${(graph.project?.frameworks || []).join(', ')} |`);
  md.push(`| **Analyzed At** | ${meta.lastAnalyzedAt || graph.project?.analyzedAt || ''} |`);
  md.push(`| **Git Commit** | \`${meta.gitCommitHash || graph.project?.gitCommitHash || ''}\` |`);
  md.push(`| **Graph Nodes (total)** | ${graph.nodes.length} |`);
  md.push(`| **Graph Edges (total)** | ${graph.edges.length} |`);
  md.push(`| **Documented Nodes (excl. vendored/caches)** | ${cleanNodes.length} |`);
  md.push(`| **Documented Edges (excl. vendored/caches)** | ${cleanEdges.length} |`);
  md.push('');
  md.push('## Table of Contents');
  md.push('');
  md.push('1. [Project Overview](#project-overview)');
  md.push('2. [Architecture Layers](#architecture-layers)');
  md.push('3. [File Inventory by Layer](#file-inventory-by-layer)');
  md.push('4. [Node Type Breakdown](#node-type-breakdown)');
  md.push('5. [Dependency Graph (imports)](#dependency-graph-imports)');
  md.push('6. [Automation and Background Timers](#automation-and-background-timers)');
  md.push('7. [Configuration & Environment](#configuration-and-environment)');
  md.push('');
  md.push('## Architecture Layers');
  md.push('');
  md.push('| Layer | Description | Files (doc.) |');
  md.push('|---|---|---|');
  graph.layers.forEach(l => {
    const count = layerCount[l.id] || 0;
    md.push(`| **${l.name}** \`${l.id}\` | ${l.description || ''} | ${count} |`);
  });
  md.push('');

  // ---- File inventory by layer ----
  md.push('## File Inventory by Layer');
  md.push('');
  md.push('All project files (vendored `.venv`/`node_modules`/build caches excluded). Each entry shows the node id, type, role summary, and tags. File names link to their repository path.');
  md.push('');

  const orderedLayers = [...graph.layers].sort((a, b) => {
    const ia = LAYER_ORDER.indexOf(a.id);
    const ib = LAYER_ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  for (const layer of orderedLayers) {
    const name = layer.name || layer.id;
    const color = LAYER_COLOR[layer.id] || '#888';
    md.push(`### ${name} — \`${layer.id}\``);
    md.push('');
    md.push(`<small style="color:${color}">${layer.nodeIds.length} node(s) in graph</small>`);
    md.push('');
    const layerNodes = layer.nodeIds
      .map(id => nodeById.get(id))
      .filter(Boolean)
      .filter(n => !isNoise(n))
      .sort((a, b) => (a.filePath || a.id).localeCompare(b.filePath || b.id));

    if (layerNodes.length === 0) {
      md.push('_No documentation-level files in this layer._');
      md.push('');
      continue;
    }

    const kind = layer.id.includes('api') ? 'Routes' : 'Files';
    md.push(`#### ${kind}`);
    md.push('');
    md.push('| # | Path | Type | Summary | Tags |');
    md.push('|---|---|---|---|---|');
    layerNodes.forEach((n, i) => {
      const path = n.filePath || n.id.replace(/^[^:]+:/, '');
      const tags = n.tags ? n.tags.map(t => '`' + t + '`').join(' ') : '';
      md.push(`| ${i + 1} | \`${path}\` | \`${n.type}\` | ${n.summary || ''} | ${tags} |`);
    });
    md.push('');
  }

  // ---- Node type breakdown ----
  md.push('## Node Type Breakdown');
  md.push('');
  md.push('| Type | Count | Example |');
  md.push('|---|---|---|');
  const typeGuides = {
    file: 'Source code', service: 'Business service', test: 'Test suite',
    config: 'Configuration / JSON', document: 'Documentation / Markdown'
  };
  Object.entries(typeCount).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    const example = cleanNodes.find(n => n.type === t);
    const exPath = example ? (example.filePath || '') : '';
    md.push(`| \`${t}\` | ${c} | ${exPath ? '`' + exPath + '`' : ''} |`);
  });
  md.push('');

  // ---- Dependency graph ----
  md.push('## Dependency Graph (imports)');
  md.push('');
  md.push('Edges represent `import`/`require` relationships detected in source (resolve-based, first 50 lines). Only edges whose source and target exist as documented nodes are shown.');
  md.push('');

  // Top imported-by files (most dependents)
  const dependents = {};
  cleanEdges.forEach(e => { dependents[e.target] = (dependents[e.target] || 0) + 1; });
  const topDependents = Object.entries(dependents).sort((a, b) => b[1] - a[1]).slice(0, 30);
  md.push('### Most Imported Modules (top 30 dependents)');
  md.push('');
  md.push('| Imported By Count | Module |');
  md.push('|---|---|');
  topDependents.forEach(([id, cnt]) => {
    const n = nodeById.get(id);
    md.push(`| ${cnt} | \`${n ? (n.filePath || id) : id}\` |`);
  });
  md.push('');

  // Highest-fanout sources (import the most)
  const fanout = {};
  cleanEdges.forEach(e => { fanout[e.source] = (fanout[e.source] || 0) + 1; });
  const topFanout = Object.entries(fanout).sort((a, b) => b[1] - a[1]).slice(0, 20);
  md.push('### Most Dependent Sources (top 20 importing modules)');
  md.push('');
  md.push('| Imports | Module |');
  md.push('|---|---|');
  topFanout.forEach(([id, cnt]) => {
    const n = nodeById.get(id);
    md.push(`| ${cnt} | \`${n ? (n.filePath || id) : id}\` |`);
  });
  md.push('');

  // ---- Automation & timers (heuristic from names on service/worker layer) ----
  md.push('## Automation and Background Timers');
  md.push('');
  md.push('Services and workers that scan files for repeated-interval, cron, or background-loop behaviour. Intervals are summarized from the file inventory; confirm exact values in source.');
  md.push('');
  const automationTerms = /(worker|queue|cron|poll|scheduler|refresh|alert|expiry|backup|scan|dispatch|remainder|reminder|sync|prune)/i;
  const autoCandidates = cleanNodes.filter(n =>
    (n.type === 'service') && automationTerms.test(n.filePath || '')
  ).sort((a, b) => (a.filePath || '').localeCompare(b.filePath || ''));
  md.push('| Service | Path |');
  md.push('|---|---|');
  autoCandidates.forEach(n => md.push(`| ${n.name} | \`${n.filePath}\` |`));
  md.push('');

  // ---- Configuration & env ----
  md.push('## Configuration & Environment');
  md.push('');
  md.push('| Type | Count |');
  md.push('|---|---|');
  const configCount = (typeCount['config'] || 0);
  md.push(`| Config nodes (json/yml/env) | ${configCount} |`);
  const envNodes = cleanNodes.filter(n => (n.filePath || '').includes('.env') || (n.filePath || '').endsWith('.env'));
  if (envNodes.length) {
    md.push('');
    md.push('| Env file | Description |');
    md.push('|---|---|');
    envNodes.forEach(n => md.push(`| \`${n.filePath}\` | ${n.summary || ''} |`));
  }
  md.push('');

  // ---- Active graph coverage note ----
  md.push('## Generated Notes');
  md.push('');
  md.push(`- Graph totals include vendored packages (\`.venv\`, \`node_modules\`, caches) that are excluded from the narrative sections.
- Edges shown are only those whose both endpoints survived the noise filter; the raw graph may carry more edges.
- Regenerate with:
  \`\`\`bash
  node scripts/quick-update.mjs          # refresh the graph
  node scripts/generate-project-docs.mjs # refresh this document
  \`\`\`
`);
  md.push('---');
  md.push(`_Generated at ${new Date().toISOString()}._`);

  writeFileSync(OUT_PATH, md.join('\n'), 'utf8');
  console.log(`Generated: ${OUT_PATH}`);
  console.log(`Nodes: ${cleanNodes.length} documented (${graph.nodes.length} total) | Edges: ${cleanEdges.length} documented (${graph.edges.length} total)`);
}

// Support running directly from CLI
if (process.argv[1] && (process.argv[1].endsWith('generate-project-docs.mjs') || process.argv[1].endsWith('generate-project-docs.js'))) {
  generateProjectDocs();
}