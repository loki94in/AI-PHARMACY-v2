import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const GRAPH_JSON_PATH = join(ROOT, '.understand-anything', 'knowledge-graph.json');
const HTML_OUTPUT_PATH = join(ROOT, '3d-knowledge-graph.html');

export function generate3DGraph() {
  console.log('Generating 3D Knowledge Graph HTML...');

  let graphData = { nodes: [], edges: [], layers: [] };
  if (existsSync(GRAPH_JSON_PATH)) {
    try {
      graphData = JSON.parse(readFileSync(GRAPH_JSON_PATH, 'utf8'));
    } catch (e) {
      console.error('Failed to read knowledge-graph.json:', e);
    }
  } else {
    console.warn('knowledge-graph.json not found, creating template with empty data.');
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Pharmacy OS - 3D Knowledge Graph</title>
  
  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  
  <!-- 3D Force Graph & Three.js via CDN -->
  <script src="https://unpkg.com/3d-force-graph"></script>
  <!-- Optional for custom styling/nodes if needed, but 3d-force-graph is self-contained -->

  <style>
    :root {
      --bg-base: #08080c;
      --bg-panel: rgba(13, 13, 20, 0.75);
      --bg-panel-hover: rgba(20, 20, 30, 0.85);
      --border-color: rgba(255, 255, 255, 0.08);
      --border-color-focus: rgba(139, 92, 246, 0.4);
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #8b5cf6;
      --accent-hover: #a78bfa;
      --accent-glow: rgba(139, 92, 246, 0.3);
      --font-sans: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-base);
      color: var(--text-main);
      font-family: var(--font-sans);
      overflow: hidden;
      width: 100vw;
      height: 100vh;
    }

    #3d-graph {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
      z-index: 1;
    }

    /* Glassmorphism Common Styles */
    .glass-panel {
      background: var(--bg-panel);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      z-index: 10;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .glass-panel:hover {
      border-color: rgba(255, 255, 255, 0.12);
    }

    /* Header styling */
    header {
      position: absolute;
      top: 20px;
      left: 20px;
      padding: 16px 24px;
      pointer-events: auto;
    }

    header h1 {
      font-size: 1.4rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      background: linear-gradient(135deg, #fff 30%, #a78bfa 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 4px;
    }

    header p {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Left Sidebar: Controls & Legend */
    #left-sidebar {
      position: absolute;
      top: 96px;
      left: 20px;
      bottom: 20px;
      width: 320px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
      pointer-events: auto;
    }

    /* Right Sidebar: Node Details */
    #right-sidebar {
      position: absolute;
      top: 20px;
      right: 20px;
      bottom: 20px;
      width: 360px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      transform: translateX(400px); /* Hidden by default */
      overflow-y: auto;
      pointer-events: auto;
    }

    #right-sidebar.open {
      transform: translateX(0);
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    /* UI Group elements */
    .sidebar-section {
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 16px;
    }

    .sidebar-section:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .section-title {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 12px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Search Input styling */
    .search-container {
      position: relative;
    }

    .search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-input {
      width: 100%;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 10px 36px 10px 12px;
      color: var(--text-main);
      font-family: var(--font-sans);
      font-size: 0.9rem;
      outline: none;
      transition: all 0.2s;
    }

    .search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-glow);
    }

    .search-icon {
      position: absolute;
      right: 12px;
      color: var(--text-muted);
      pointer-events: none;
      width: 16px;
      height: 16px;
    }

    .autocomplete-results {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: #0f0f15;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      margin-top: 4px;
      max-height: 200px;
      overflow-y: auto;
      z-index: 100;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      display: none;
    }

    .autocomplete-item {
      padding: 8px 12px;
      cursor: pointer;
      font-size: 0.85rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      transition: background 0.15s;
    }

    .autocomplete-item:hover {
      background: rgba(139, 92, 246, 0.15);
      color: #fff;
    }

    .autocomplete-item-path {
      font-size: 0.7rem;
      color: var(--text-muted);
      display: block;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Filters Layout */
    .filter-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 180px;
      overflow-y: auto;
      padding-right: 4px;
    }

    .filter-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      cursor: pointer;
      user-select: none;
      padding: 4px 0;
    }

    .filter-item input {
      accent-color: var(--accent);
      cursor: pointer;
    }

    .layer-color-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    /* Sliders / Controls */
    .control-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .control-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .control-label-wrapper {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
    }

    .control-value {
      color: var(--accent-hover);
      font-weight: 500;
    }

    .slider-input {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.1);
      outline: none;
      accent-color: var(--accent);
    }

    .slider-input::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--accent);
      cursor: pointer;
      transition: transform 0.1s;
    }

    .slider-input::-webkit-slider-thumb:hover {
      transform: scale(1.3);
    }

    /* Toggle switches */
    .toggle-wrapper {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
    }

    .switch {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider-toggle {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(255, 255, 255, 0.1);
      transition: .3s;
      border-radius: 20px;
    }

    .slider-toggle:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
    }

    input:checked + .slider-toggle {
      background-color: var(--accent);
    }

    input:checked + .slider-toggle:before {
      transform: translateX(16px);
    }

    /* Details Panel */
    .details-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }

    .details-name {
      font-size: 1.25rem;
      font-weight: 600;
      word-break: break-all;
      line-height: 1.2;
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.25rem;
      cursor: pointer;
      line-height: 1;
      padding: 4px;
      transition: color 0.2s;
    }

    .close-btn:hover {
      color: #fff;
    }

    .details-path {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-muted);
      word-break: break-all;
      background: rgba(0, 0, 0, 0.2);
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.03);
      margin-bottom: 12px;
    }

    .details-meta-row {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .tag-badge {
      background: rgba(139, 92, 246, 0.15);
      color: var(--accent-hover);
      border: 1px solid rgba(139, 92, 246, 0.25);
      font-size: 0.75rem;
      padding: 3px 8px;
      border-radius: 12px;
      font-weight: 500;
    }

    .type-badge {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-main);
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 0.75rem;
      padding: 3px 8px;
      border-radius: 12px;
      text-transform: capitalize;
    }

    .details-desc {
      font-size: 0.9rem;
      line-height: 1.5;
      color: #d1d5db;
      margin-bottom: 16px;
    }

    .dep-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 180px;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.15);
      padding: 8px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.03);
    }

    .dep-item {
      font-size: 0.8rem;
      color: var(--accent-hover);
      text-decoration: none;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 4px 6px;
      border-radius: 4px;
      transition: background 0.15s;
    }

    .dep-item:hover {
      background: rgba(139, 92, 246, 0.15);
      color: #fff;
    }

    .no-deps {
      font-size: 0.8rem;
      color: var(--text-muted);
      font-style: italic;
      padding: 4px 6px;
    }

    /* Drag & Drop Overlay */
    #drop-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(8, 8, 12, 0.95);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 20px;
      border: 4px dashed var(--accent);
      margin: -4px; /* Fix borders */
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s;
    }

    #drop-overlay.active {
      opacity: 1;
      pointer-events: auto;
    }

    .drop-box {
      border: 2px dashed rgba(255,255,255,0.15);
      border-radius: 16px;
      padding: 40px;
      text-align: center;
      max-width: 450px;
      background: rgba(255,255,255,0.02);
      transition: all 0.3s;
    }

    .drop-box:hover {
      border-color: var(--accent);
      background: rgba(139, 92, 246, 0.03);
    }

    .drop-title {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .btn-primary {
      background: var(--accent);
      color: #fff;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 500;
      cursor: pointer;
      font-family: var(--font-sans);
      margin-top: 16px;
      transition: background 0.2s;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }

    /* Custom graph labels styling */
    .graph-tooltip {
      background: rgba(13, 13, 20, 0.9) !important;
      border: 1px solid rgba(255,255,255,0.15) !important;
      backdrop-filter: blur(8px);
      border-radius: 8px !important;
      color: #fff !important;
      font-family: var(--font-sans) !important;
      padding: 8px 12px !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
    }

    .graph-tooltip-title {
      font-weight: 600;
      font-size: 0.85rem;
      margin-bottom: 2px;
    }

    .graph-tooltip-path {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    /* Stats Indicator */
    .stats-badge {
      display: inline-flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 2px 6px;
      font-size: 0.75rem;
      font-family: var(--font-mono);
      color: var(--accent-hover);
      margin-left: 6px;
    }
  </style>
</head>
<body>

  <div id="3d-graph"></div>

  <!-- Header Panel -->
  <header class="glass-panel">
    <h1>AI Pharmacy OS</h1>
    <p>3D Knowledge Graph Structure <span class="stats-badge" id="global-stats">- Nodes | - Edges</span></p>
  </header>

  <!-- Left Sidebar (Controls) -->
  <div id="left-sidebar" class="glass-panel">
    <!-- Search Node -->
    <div class="sidebar-section">
      <div class="section-title">Search Workspace</div>
      <div class="search-container">
        <div class="search-input-wrapper">
          <input type="text" id="node-search" class="search-input" placeholder="Search files, routes, docs...">
          <svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
        </div>
        <div id="search-results" class="autocomplete-results"></div>
      </div>
    </div>

    <!-- Filter Layers -->
    <div class="sidebar-section">
      <div class="section-title">Architecture Layers <span id="layer-count" style="font-size: 0.75rem; color: var(--text-muted);"></span></div>
      <div class="filter-list" id="layer-filters">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- Filter Types -->
    <div class="sidebar-section">
      <div class="section-title">Node Types</div>
      <div class="filter-list" id="type-filters">
        <label class="filter-item">
          <input type="checkbox" id="type-file" checked data-type="file">
          <span>Source Code</span>
        </label>
        <label class="filter-item">
          <input type="checkbox" id="type-service" checked data-type="service">
          <span>Services</span>
        </label>
        <label class="filter-item">
          <input type="checkbox" id="type-test" checked data-type="test">
          <span>Tests</span>
        </label>
        <label class="filter-item">
          <input type="checkbox" id="type-config" checked data-type="config">
          <span>Configuration</span>
        </label>
        <label class="filter-item">
          <input type="checkbox" id="type-document" checked data-type="document">
          <span>Documentation</span>
        </label>
      </div>
    </div>

    <!-- Visual Settings -->
    <div class="sidebar-section">
      <div class="section-title">Visual Settings</div>
      <div class="control-group">
        
        <div class="toggle-wrapper">
          <span>Auto-Rotation</span>
          <label class="switch">
            <input type="checkbox" id="toggle-rotate">
            <span class="slider-toggle"></span>
          </label>
        </div>

        <div class="control-item">
          <div class="control-label-wrapper">
            <span>Dependency Flow Particles</span>
            <span class="control-value" id="particle-val">3</span>
          </div>
          <input type="range" id="particle-slider" class="slider-input" min="0" max="6" step="1" value="3">
        </div>

        <div class="control-item">
          <div class="control-label-wrapper">
            <span>Connection Line Opacity</span>
            <span class="control-value" id="opacity-val">0.3</span>
          </div>
          <input type="range" id="opacity-slider" class="slider-input" min="0.05" max="0.8" step="0.05" value="0.3">
        </div>

        <div class="toggle-wrapper">
          <span>Size by Connection Count</span>
          <label class="switch">
            <input type="checkbox" id="toggle-size-degree" checked>
            <span class="slider-toggle"></span>
          </label>
        </div>

      </div>
    </div>

    <!-- Load File Trigger -->
    <div class="sidebar-section" style="margin-top: auto; border: none; padding-bottom: 0;">
      <button class="btn-primary" style="width: 100%; margin-top: 0; padding: 8px 12px; font-size: 0.8rem;" onclick="showDropOverlay()">Load Custom Graph JSON</button>
    </div>
  </div>

  <!-- Right Sidebar (Node Details) -->
  <div id="right-sidebar" class="glass-panel">
    <div class="details-header">
      <div class="details-name" id="node-details-name">filename.ts</div>
      <button class="close-btn" onclick="closeSidebar()">&times;</button>
    </div>
    <div class="details-path" id="node-details-path">src/services/filename.ts</div>
    
    <div class="details-meta-row" id="node-details-badges">
      <span class="type-badge">file</span>
      <span class="tag-badge">general</span>
    </div>

    <div class="sidebar-section">
      <div class="section-title">Summary</div>
      <div class="details-desc" id="node-details-summary">No summary available.</div>
    </div>

    <div class="sidebar-section">
      <div class="section-title" id="title-imports">Dependencies (Imports)</div>
      <div class="dep-list" id="node-details-imports">
        <!-- Clickable items -->
      </div>
    </div>

    <div class="sidebar-section">
      <div class="section-title" id="title-dependents">Imported By</div>
      <div class="dep-list" id="node-details-dependents">
        <!-- Clickable items -->
      </div>
    </div>

    <div style="margin-top: auto;">
      <button class="btn-primary" style="width: 100%; margin-top: 0;" id="btn-focus-node">Fly to Node</button>
    </div>
  </div>

  <!-- Drop Zone Overlay -->
  <div id="drop-overlay" onclick="hideDropOverlay()">
    <div class="drop-box" onclick="event.stopPropagation()">
      <div class="drop-title">Load Knowledge Graph</div>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px;">
        Drag & Drop your <code>knowledge-graph.json</code> file here, or select it manually.
      </p>
      <input type="file" id="file-uploader" style="display: none;" accept=".json" onchange="handleFileSelect(this)">
      <button class="btn-primary" onclick="document.getElementById('file-uploader').click()">Select JSON File</button>
      <button class="btn-primary" style="background: rgba(255,255,255,0.06); color: var(--text-main); margin-left: 8px;" onclick="hideDropOverlay()">Cancel</button>
    </div>
  </div>

  <script>
    // Embedded initial graph data
    const INITIAL_GRAPH_DATA = ${JSON.stringify(graphData)};

    // App state
    let rawGraph = INITIAL_GRAPH_DATA;
    let filteredGraph = { nodes: [], links: [] };
    let activeFilters = {
      layers: new Set(),
      types: new Set(['file', 'service', 'test', 'config', 'document'])
    };
    
    let Graph = null;
    let hoveredNode = null;
    let clickedNode = null;
    const highlightNodes = new Set();
    const highlightLinks = new Set();

    // Node colors by architectural layer
    const LAYER_COLORS = {
      'layer:presentation': '#ec4899', // Pink
      'layer:mobile': '#f59e0b',       // Amber
      'layer:api': '#a855f7',          // Purple
      'layer:service': '#10b981',      // Emerald
      'layer:data': '#3b82f6',         // Blue
      'layer:infrastructure': '#06b6d4', // Cyan
      'layer:testing': '#ef4444',      // Red
      'layer:documentation': '#6b7280', // Gray
      'layer:scripts': '#14b8a6',      // Teal
      'layer:configuration': '#84cc16'  // Lime
    };
    const DEFAULT_COLOR = '#94a3b8';   // Slate

    // Initialize Page
    window.addEventListener('DOMContentLoaded', () => {
      initApp(rawGraph);
    });

    function initApp(graphJson) {
      rawGraph = graphJson;
      
      // Update global badges/stats
      document.getElementById('global-stats').textContent = 
        \`\${rawGraph.nodes.length} Nodes | \${rawGraph.edges.length} Edges\`;

      // Build layer filters UI dynamically
      buildLayerFilters();

      // Initialize active filters with all available layers
      activeFilters.layers = new Set(rawGraph.layers.map(l => l.id));
      
      // Setup UI listeners
      setupUIEventListeners();
      
      // Process and render
      applyFiltersAndRefresh();
    }

    // Build the list of filters based on metadata layers
    function buildLayerFilters() {
      const container = document.getElementById('layer-filters');
      container.innerHTML = '';
      
      rawGraph.layers.forEach(layer => {
        const color = LAYER_COLORS[layer.id] || DEFAULT_COLOR;
        
        const label = document.createElement('label');
        label.className = 'filter-item';
        label.innerHTML = \`
          <input type="checkbox" checked value="\${layer.id}">
          <span class="layer-color-dot" style="background-color: \${color};"></span>
          <span style="flex-grow: 1;">\${layer.name}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">\${layer.nodeIds.length}</span>
        \`;
        
        // Listen to checkbox changes
        label.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) {
            activeFilters.layers.add(layer.id);
          } else {
            activeFilters.layers.delete(layer.id);
          }
          applyFiltersAndRefresh();
        });
        
        container.appendChild(label);
      });

      document.getElementById('layer-count').textContent = \`(\${rawGraph.layers.length})\`;
    }

    function setupUIEventListeners() {
      // Type checkboxes
      document.querySelectorAll('#type-filters input').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
          const type = e.target.getAttribute('data-type');
          if (e.target.checked) {
            activeFilters.types.add(type);
          } else {
            activeFilters.types.delete(type);
          }
          applyFiltersAndRefresh();
        });
      });

      // Search bar search listener
      const searchInput = document.getElementById('node-search');
      searchInput.addEventListener('input', (e) => {
        handleSearch(e.target.value);
      });
      
      // Close autocomplete on click outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
          document.getElementById('search-results').style.display = 'none';
        }
      });

      // Particle slider
      const particleSlider = document.getElementById('particle-slider');
      particleSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        document.getElementById('particle-val').textContent = val;
        if (Graph) {
          Graph.linkDirectionalParticles(val);
        }
      });

      // Opacity slider
      const opacitySlider = document.getElementById('opacity-slider');
      opacitySlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('opacity-val').textContent = val;
        if (Graph) {
          Graph.linkOpacity(val);
        }
      });

      // Size by degree toggle
      const sizeToggle = document.getElementById('toggle-size-degree');
      sizeToggle.addEventListener('change', (e) => {
        if (Graph) {
          Graph.nodeVal(e.target.checked ? d => d.degree || 1 : 1);
        }
      });

      // Auto-rotation toggle
      const rotateToggle = document.getElementById('toggle-rotate');
      let angle = 0;
      let rotationInterval = null;
      rotateToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
          rotationInterval = setInterval(() => {
            if (Graph) {
              Graph.cameraPosition({
                x: 400 * Math.sin(angle),
                z: 400 * Math.cos(angle)
              });
              angle += 0.0015;
            }
          }, 20);
        } else {
          clearInterval(rotationInterval);
        }
      });

      // Uploader Drop events
      const dropOverlay = document.getElementById('drop-overlay');
      window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dropOverlay.classList.add('active');
      });
      
      dropOverlay.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      
      dropOverlay.addEventListener('drop', (e) => {
        e.preventDefault();
        dropOverlay.classList.remove('active');
        const files = e.dataTransfer.files;
        if (files.length) {
          parseAndLoadFile(files[0]);
        }
      });
    }

    // Filters node and edges data and reloads graph visualization
    function applyFiltersAndRefresh() {
      // 1. Filter Nodes
      const allowedNodesMap = new Map();
      rawGraph.nodes.forEach(node => {
        // Find layer containing this node ID
        const layer = rawGraph.layers.find(l => l.nodeIds.includes(node.id));
        const layerId = layer ? layer.id : 'layer:configuration';

        const matchesLayer = activeFilters.layers.has(layerId);
        const matchesType = activeFilters.types.has(node.type);

        if (matchesLayer && matchesType) {
          allowedNodesMap.set(node.id, {
            ...node,
            layerId,
            degree: 0 // Will compute below
          });
        }
      });

      // 2. Filter Links (Edges)
      const filteredLinks = [];
      rawGraph.edges.forEach(edge => {
        const sourceExists = allowedNodesMap.has(edge.source);
        const targetExists = allowedNodesMap.has(edge.target);

        if (sourceExists && targetExists) {
          filteredLinks.push({
            source: edge.source,
            target: edge.target,
            type: edge.type,
            weight: edge.weight || 0.5
          });

          // Increment degrees
          allowedNodesMap.get(edge.source).degree += 1;
          allowedNodesMap.get(edge.target).degree += 1;
        }
      });

      const filteredNodes = Array.from(allowedNodesMap.values());
      filteredGraph = { nodes: filteredNodes, links: filteredLinks };

      renderGraph();
    }

    function renderGraph() {
      const graphContainer = document.getElementById('3d-graph');
      
      if (!Graph) {
        // First time initialization
        Graph = ForceGraph3D()(graphContainer)
          .graphData(filteredGraph)
          .backgroundColor('#08080c')
          .showNavInfo(false)
          .nodeColor(node => LAYER_COLORS[node.layerId] || DEFAULT_COLOR)
          .nodeVal(document.getElementById('toggle-size-degree').checked ? d => d.degree || 1 : 1)
          .nodeLabel(node => \`
            <div class="graph-tooltip">
              <div class="graph-tooltip-title">\${node.name}</div>
              <div class="graph-tooltip-path">\${node.filePath}</div>
            </div>
          \`)
          .linkOpacity(parseFloat(document.getElementById('opacity-slider').value))
          .linkColor(link => {
            const sourceNode = typeof link.source === 'object' ? link.source : filteredGraph.nodes.find(n => n.id === link.source);
            const layerId = sourceNode ? sourceNode.layerId : null;
            const color = LAYER_COLORS[layerId] || DEFAULT_COLOR;
            return color + '40'; // 25% opacity default
          })
          .linkDirectionalParticles(parseInt(document.getElementById('particle-slider').value))
          .linkDirectionalParticleSpeed(0.004)
          .linkDirectionalParticleWidth(1.5)
          .linkDirectionalParticleColor(() => '#a78bfa')
          
          // Interactions
          .onNodeClick(node => {
            selectNode(node);
          })
          .onNodeHover((node, prevNode) => {
            if (node === hoveredNode) return;
            
            highlightNodes.clear();
            highlightLinks.clear();
            
            if (node) {
              hoveredNode = node;
              highlightNodes.add(node);
              // Find adjacent links
              filteredGraph.links.forEach(link => {
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                
                if (sourceId === node.id) {
                  highlightLinks.add(link);
                  const targetNode = typeof link.target === 'object' ? link.target : filteredGraph.nodes.find(n => n.id === targetId);
                  if (targetNode) highlightNodes.add(targetNode);
                } else if (targetId === node.id) {
                  highlightLinks.add(link);
                  const sourceNode = typeof link.source === 'object' ? link.source : filteredGraph.nodes.find(n => n.id === sourceId);
                  if (sourceNode) highlightNodes.add(sourceNode);
                }
              });
            } else {
              hoveredNode = null;
            }
            
            updateHighlight();
          });
      } else {
        // Just update graph data
        Graph.graphData(filteredGraph);
      }
    }

    function updateHighlight() {
      if (!Graph) return;

      // Trigger redraw by re-assigning properties
      Graph
        .nodeColor(node => {
          if (highlightNodes.size === 0) return LAYER_COLORS[node.layerId] || DEFAULT_COLOR;
          return highlightNodes.has(node) ? (LAYER_COLORS[node.layerId] || DEFAULT_COLOR) : 'rgba(255, 255, 255, 0.05)';
        })
        .linkColor(link => {
          const sourceNode = typeof link.source === 'object' ? link.source : filteredGraph.nodes.find(n => n.id === link.source);
          const layerId = sourceNode ? sourceNode.layerId : null;
          const color = LAYER_COLORS[layerId] || DEFAULT_COLOR;
          
          if (highlightLinks.size === 0) return color + '40'; // default 25% opacity
          return highlightLinks.has(link) ? color + 'cc' : 'rgba(255, 255, 255, 0.02)'; // highlighted: 80% opacity, others: 2% opacity
        })
        .linkDirectionalParticles(link => {
          if (highlightLinks.size === 0) return parseInt(document.getElementById('particle-slider').value);
          return highlightLinks.has(link) ? parseInt(document.getElementById('particle-slider').value) : 0;
        });
    }

    // Node Selection Flow
    function selectNode(node) {
      clickedNode = node;
      
      // Update UI panels
      document.getElementById('node-details-name').textContent = node.name;
      document.getElementById('node-details-path').textContent = node.filePath || node.id;
      document.getElementById('node-details-summary').textContent = node.summary || 'No summary available.';

      // Badges
      const badgeContainer = document.getElementById('node-details-badges');
      badgeContainer.innerHTML = \`
        <span class="type-badge">\${node.type}</span>
        <span class="type-badge" style="background-color: \${LAYER_COLORS[node.layerId]}20; color: \${LAYER_COLORS[node.layerId]}; border-color: \${LAYER_COLORS[node.layerId]}40;">\${node.layerId.split(':').pop()}</span>
      \`;
      if (node.tags) {
        node.tags.forEach(tag => {
          badgeContainer.innerHTML += \`<span class="tag-badge">\${tag}</span>\`;
        });
      }

      // Find imports (outgoing edges) and dependents (incoming edges)
      // Note: rawGraph edges use raw IDs
      const imports = rawGraph.edges.filter(e => e.source === node.id);
      const dependents = rawGraph.edges.filter(e => e.target === node.id);

      // Render Imports
      const importsContainer = document.getElementById('node-details-imports');
      document.getElementById('title-imports').textContent = \`Dependencies (\${imports.length})\`;
      importsContainer.innerHTML = '';
      if (imports.length > 0) {
        imports.forEach(imp => {
          const targetNode = rawGraph.nodes.find(n => n.id === imp.target);
          const displayName = targetNode ? targetNode.name : imp.target.split(':').pop();
          const element = document.createElement('a');
          element.className = 'dep-item';
          element.textContent = displayName;
          element.title = imp.target;
          element.addEventListener('click', () => jumpToNode(imp.target));
          importsContainer.appendChild(element);
        });
      } else {
        importsContainer.innerHTML = '<div class="no-deps">No imports/dependencies detected.</div>';
      }

      // Render Dependents
      const dependentsContainer = document.getElementById('node-details-dependents');
      document.getElementById('title-dependents').textContent = \`Imported By (\${dependents.length})\`;
      dependentsContainer.innerHTML = '';
      if (dependents.length > 0) {
        dependents.forEach(dep => {
          const sourceNode = rawGraph.nodes.find(n => n.id === dep.source);
          const displayName = sourceNode ? sourceNode.name : dep.source.split(':').pop();
          const element = document.createElement('a');
          element.className = 'dep-item';
          element.textContent = displayName;
          element.title = dep.source;
          element.addEventListener('click', () => jumpToNode(dep.source));
          dependentsContainer.appendChild(element);
        });
      } else {
        dependentsContainer.innerHTML = '<div class="no-deps">No dependents import this file.</div>';
      }

      // Setup Fly-To Button
      const focusBtn = document.getElementById('btn-focus-node');
      // Remove old listeners
      const newFocusBtn = focusBtn.cloneNode(true);
      focusBtn.parentNode.replaceChild(newFocusBtn, focusBtn);
      newFocusBtn.addEventListener('click', () => {
        flyToNode(node);
      });

      // Show Right Sidebar
      document.getElementById('right-sidebar').classList.add('open');
      
      // Auto focus camera
      flyToNode(node);
    }

    function jumpToNode(nodeId) {
      // Find if node exists in filteredGraph
      const node = filteredGraph.nodes.find(n => n.id === nodeId);
      if (node) {
        selectNode(node);
      } else {
        // Alert that it is filtered out, or suggest disabling filters
        alert(\`Node "\${nodeId.split(':').pop()}" is currently filtered out. Enable its layer/type to view.\`);
      }
    }

    // Navigates camera to focus on node
    function flyToNode(node) {
      if (!Graph || !node) return;
      
      // Calculate focus camera position
      const distance = 80;
      const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
      
      Graph.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, // new position
        node, // lookAt node
        2000  // transition duration (ms)
      );
    }

    function closeSidebar() {
      document.getElementById('right-sidebar').classList.remove('open');
      clickedNode = null;
    }

    // Search Logic
    function handleSearch(query) {
      const resultsContainer = document.getElementById('search-results');
      if (!query.trim()) {
        resultsContainer.style.display = 'none';
        return;
      }

      // Filter in rawGraph or filteredGraph? We'll search filteredGraph so that users can jump immediately.
      const queryLower = query.toLowerCase();
      const matches = filteredGraph.nodes.filter(node => 
        node.name.toLowerCase().includes(queryLower) || 
        node.filePath.toLowerCase().includes(queryLower)
      ).slice(0, 10); // cap results

      if (matches.length > 0) {
        resultsContainer.innerHTML = '';
        matches.forEach(node => {
          const item = document.createElement('div');
          item.className = 'autocomplete-item';
          item.innerHTML = \`
            <strong>\${node.name}</strong>
            <span class="autocomplete-item-path">\${node.filePath}</span>
          \`;
          item.addEventListener('click', () => {
            selectNode(node);
            document.getElementById('node-search').value = '';
            resultsContainer.style.display = 'none';
          });
          resultsContainer.appendChild(item);
        });
        resultsContainer.style.display = 'block';
      } else {
        resultsContainer.innerHTML = '<div class="autocomplete-item" style="color: var(--text-muted); cursor: default;">No matching active files</div>';
        resultsContainer.style.display = 'block';
      }
    }

    // Custom File Loading
    function showDropOverlay() {
      document.getElementById('drop-overlay').classList.add('active');
    }

    function hideDropOverlay() {
      document.getElementById('drop-overlay').classList.remove('active');
    }

    function handleFileSelect(input) {
      const file = input.files[0];
      if (file) {
        parseAndLoadFile(file);
      }
    }

    function parseAndLoadFile(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          if (!json.nodes || !json.edges || !json.layers) {
            throw new Error("Invalid structure. Must have 'nodes', 'edges', and 'layers' keys.");
          }
          
          hideDropOverlay();
          closeSidebar();
          
          // Re-initialize app with new JSON
          initApp(json);
        } catch (err) {
          alert('Error parsing JSON file: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
  </script>
</body>
</html>`;

  writeFileSync(HTML_OUTPUT_PATH, htmlContent);
  console.log(`Successfully generated: ${HTML_OUTPUT_PATH}`);
}

// Support running directly if called from CLI
if (process.argv[1] && (process.argv[1].endsWith('generate-3d-graph.mjs') || process.argv[1].endsWith('generate-3d-graph.js'))) {
  generate3DGraph();
}
