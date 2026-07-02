#!/usr/bin/env node

/**
 * Quick Knowledge Graph Update (< 30 seconds)
 * 
 * Run: node scripts/quick-update.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, extname, dirname } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const KNOWLEDGE_DIR = join(ROOT, '.understand-anything');
const GRAPH_PATH = join(KNOWLEDGE_DIR, 'knowledge-graph.json');
const META_PATH = join(KNOWLEDGE_DIR, 'meta.json');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
  'backup', '.codegraph', '.wwebjs_auth', 'uploads', '.understand-anything'
]);

const INCLUDE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.txt', '.html', '.css', '.sql',
  '.yml', '.yaml', '.env'
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'
]);

function getAllFiles(dir, files = []) {
  try {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          getAllFiles(fullPath, files);
        } else if (stat.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (INCLUDE_EXTS.has(ext) && !SKIP_FILES.has(entry)) {
            files.push({
              path: relative(ROOT, fullPath),
              size: stat.size,
              mtime: stat.mtime.getTime()
            });
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  return files;
}

function getFileType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (filePath.startsWith('tests/') || filePath.includes('.test.')) return 'test';
  if (filePath.startsWith('frontend/src/pages/')) return 'file';
  if (filePath.startsWith('frontend/src/components/')) return 'file';
  if (filePath.startsWith('frontend/src/')) return 'file';
  if (filePath.startsWith('pharmacy-mobile/app/')) return 'file';
  if (filePath.startsWith('pharmacy-mobile/components/')) return 'file';
  if (filePath.startsWith('pharmacy-mobile/lib/')) return 'file';
  if (filePath.startsWith('src/routes/')) return 'file';
  if (filePath.startsWith('src/services/')) return 'service';
  if (filePath.startsWith('src/middleware/')) return 'file';
  if (filePath.startsWith('src/worker/')) return 'file';
  if (filePath.startsWith('src/scripts/')) return 'file';
  if (filePath.startsWith('src/cli/')) return 'file';
  if (filePath.startsWith('src/database/')) return 'file';
  if (filePath.startsWith('scripts/')) return 'file';
  if (filePath.startsWith('docs/')) return 'document';
  if (filePath.startsWith('data/')) return 'file';
  if (ext === '.json') return 'config';
  if (ext === '.md') return 'document';
  if (ext === '.html' || ext === '.css') return 'file';
  return 'file';
}

function getNodePrefix(type) {
  switch (type) {
    case 'config': return 'config:';
    case 'document': return 'document:';
    default: return 'file:';
  }
}

function detectImports(filePath, content) {
  const imports = [];
  const lines = content.split('\n').slice(0, 50); // Only first 50 lines
  
  for (const line of lines) {
    // import ... from '...'
    const importMatch = line.match(/from\s+['"]([^'"]+)['"]/);
    if (importMatch && (importMatch[1].startsWith('.') || importMatch[1].startsWith('src/'))) {
      const resolved = resolveImport(filePath, importMatch[1]);
      if (resolved) imports.push(resolved);
      continue;
    }
    
    // require('...')
    const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch && (requireMatch[1].startsWith('.') || requireMatch[1].startsWith('src/'))) {
      const resolved = resolveImport(filePath, requireMatch[1]);
      if (resolved) imports.push(resolved);
    }
  }
  
  return imports;
}

function resolveImport(fromFile, importPath) {
  try {
    const dir = dirname(fromFile);
    const resolved = join(dir, importPath);
    
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.js'];
    for (const ext of exts) {
      const fullPath = resolved + ext;
      if (existsSync(join(ROOT, fullPath))) {
        return relative(ROOT, join(ROOT, fullPath));
      }
    }
    
    if (existsSync(join(ROOT, resolved))) {
      return relative(ROOT, join(ROOT, resolved));
    }
  } catch (e) {}
  return null;
}

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

function generateSummary(filePath) {
  const name = filePath.split('/').pop();
  const dir = dirname(filePath);
  
  if (filePath.endsWith('.md')) return `Documentation: ${name}`;
  if (filePath.endsWith('.json')) return `Configuration: ${name}`;
  if (filePath.endsWith('.sql')) return `SQL migration: ${name}`;
  if (filePath.includes('test')) return `Test: ${name}`;
  
  if (filePath.startsWith('src/routes/')) return `API route handler`;
  if (filePath.startsWith('src/services/')) return `Business service`;
  if (filePath.startsWith('src/middleware/')) return `Express middleware`;
  if (filePath.startsWith('src/worker/')) return `Background worker`;
  if (filePath.startsWith('frontend/src/pages/')) return `React page component`;
  if (filePath.startsWith('frontend/src/components/')) return `React component`;
  
  return `Source file: ${name}`;
}

function generateTags(filePath, type) {
  const tags = [];
  
  if (type === 'test') tags.push('test');
  if (type === 'config') tags.push('config');
  if (type === 'document') tags.push('documentation');
  if (type === 'service') tags.push('service');
  
  if (filePath.includes('whatsapp')) tags.push('whatsapp');
  if (filePath.includes('telegram')) tags.push('telegram');
  if (filePath.includes('email')) tags.push('email');
  if (filePath.includes('ocr') || filePath.includes('camera')) tags.push('ocr');
  if (filePath.includes('invoice')) tags.push('invoice');
  if (filePath.includes('migration')) tags.push('migration');
  if (filePath.includes('auth') || filePath.includes('license')) tags.push('auth');
  
  if (filePath.startsWith('src/routes/')) tags.push('api');
  if (filePath.startsWith('src/services/')) tags.push('business-logic');
  if (filePath.startsWith('frontend/')) tags.push('frontend');
  if (filePath.startsWith('pharmacy-mobile/')) tags.push('mobile');
  
  return tags.length ? tags : ['general'];
}

function main() {
  const startTime = Date.now();
  console.log('Quick Knowledge Graph Update\n');
  
  // Load existing graph
  let graph = { nodes: [], edges: [], layers: [], tour: [] };
  if (existsSync(GRAPH_PATH)) {
    try {
      graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));
    } catch (e) {
      console.log('Starting fresh graph');
    }
  }
  
  // Get current git hash
  let currentHash = 'no-git';
  try {
    currentHash = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  } catch (e) {}
  
  // Scan files
  const files = getAllFiles(ROOT);
  const fileMap = new Map(files.map(f => [f.path, f]));
  
  // Build existing nodes map
  const existingByPath = new Map();
  for (const node of graph.nodes) {
    if (node.filePath) existingByPath.set(node.filePath, node);
  }
  
  // Detect changes
  const newFiles = [];
  const changedFiles = [];
  const deletedFiles = [];
  
  for (const [path, file] of fileMap) {
    const existing = existingByPath.get(path);
    if (!existing) {
      newFiles.push(path);
    } else if (file.mtime > (existing._mtime || 0)) {
      changedFiles.push(path);
    }
  }
  
  for (const [path] of existingByPath) {
    if (!fileMap.has(path)) deletedFiles.push(path);
  }
  
  console.log(`Files: ${files.length} | New: ${newFiles.length} | Changed: ${changedFiles.length} | Deleted: ${deletedFiles.length}`);
  
  // Remove deleted
  if (deletedFiles.length > 0) {
    const deletedPaths = new Set(deletedFiles);
    graph.nodes = graph.nodes.filter(n => !deletedPaths.has(n.filePath));
    graph.edges = graph.edges.filter(e => {
      return graph.nodes.some(n => n.id === e.source) && graph.nodes.some(n => n.id === e.target);
    });
  }
  
  // Add/update nodes
  let added = 0, updated = 0;
  
  for (const filePath of [...newFiles, ...changedFiles]) {
    const file = fileMap.get(filePath);
    if (!file) continue;
    
    const type = getFileType(filePath);
    const prefix = getNodePrefix(type);
    const nodeId = `${prefix}${filePath}`;
    
    let content = '';
    try {
      content = readFileSync(join(ROOT, filePath), 'utf8').slice(0, 10000);
    } catch (e) { continue; }
    
    const node = {
      id: nodeId,
      type,
      name: filePath.split('/').pop(),
      filePath,
      summary: generateSummary(filePath),
      tags: generateTags(filePath, type),
      _mtime: file.mtime
    };
    
    const existing = existingByPath.get(filePath);
    if (existing) {
      const idx = graph.nodes.findIndex(n => n.id === nodeId);
      if (idx >= 0) graph.nodes[idx] = { ...graph.nodes[idx], ...node };
      updated++;
    } else {
      graph.nodes.push(node);
      added++;
    }
    
    // Add import edges
    const imports = detectImports(filePath, content);
    for (const imp of imports) {
      const targetId = `file:${imp}`;
      const exists = graph.edges.some(e => e.source === nodeId && e.target === targetId && e.type === 'imports');
      if (!exists) {
        graph.edges.push({ source: nodeId, target: targetId, type: 'imports', weight: 0.7 });
      }
    }
  }
  
  // Rebuild layers
  const layerMap = {};
  for (const node of graph.nodes) {
    if (node.filePath) {
      const layer = getLayer(node.filePath);
      if (!layerMap[layer]) layerMap[layer] = [];
      layerMap[layer].push(node.id);
    }
  }
  
  const layerMeta = {
    'layer:presentation': { name: 'Presentation Layer', description: 'Frontend React SPA' },
    'layer:mobile': { name: 'Mobile Layer', description: 'React Native Expo app' },
    'layer:api': { name: 'API Layer', description: 'Express.js route handlers' },
    'layer:service': { name: 'Service Layer', description: 'Business logic services' },
    'layer:data': { name: 'Data Layer', description: 'Database and data files' },
    'layer:infrastructure': { name: 'Infrastructure Layer', description: 'Middleware and workers' },
    'layer:testing': { name: 'Testing Layer', description: 'Test files' },
    'layer:documentation': { name: 'Documentation Layer', description: 'Docs and specs' },
    'layer:scripts': { name: 'Script Layer', description: 'CLI tools and scripts' },
    'layer:configuration': { name: 'Configuration Layer', description: 'Package configs' }
  };
  
  graph.layers = Object.entries(layerMap).map(([id, nodeIds]) => ({
    id,
    name: layerMeta[id]?.name || id,
    description: layerMeta[id]?.description || '',
    nodeIds
  }));
  
  graph.project = {
    name: 'AI Pharmacy OS',
    languages: ['typescript', 'javascript', 'json', 'markdown', 'html', 'css'],
    frameworks: ['Express.js', 'React', 'Vite', 'Tailwind CSS', 'React Native', 'Expo'],
    description: 'Unified pharmacy management platform.',
    analyzedAt: new Date().toISOString(),
    gitCommitHash: currentHash
  };
  
  // Save
  writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));
  writeFileSync(META_PATH, JSON.stringify({
    lastAnalyzedAt: new Date().toISOString(),
    gitCommitHash: currentHash,
    version: '1.0.0',
    analyzedFiles: files.length
  }, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s | Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length} | Layers: ${graph.layers.length}`);
}

main();
