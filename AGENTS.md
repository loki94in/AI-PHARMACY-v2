# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts (e.g. spelling fixes, style cleanups) do not need updates.

---

# AI Agent Rules — Auto-Knowledge Graph

Every AI agent (opencode, Claude, Cursor, Windsurf, Aider, etc.) working on this project **MUST** follow these rules to keep the knowledge graph auto-updated.

---

## CRITICAL: Auto-Update Knowledge Graph

After ANY code change (add file, edit file, delete file, rename file), you **MUST** run:

```bash
node scripts/quick-update.mjs
```

This takes **< 30 seconds** and updates `.understand-anything/knowledge-graph.json`.

### When to Run
- **After creating a new file** → run `node scripts/quick-update.mjs`
- **After editing a file** → run `node scripts/quick-update.mjs`
- **After deleting a file** → run `node scripts/quick-update.mjs`
- **After renaming a file** → run `node scripts/quick-update.mjs`
- **Before finishing your session** → run `node scripts/quick-update.mjs`

### What It Does
1. Scans all project files (excluding node_modules, dist, .git)
2. Detects new/changed/deleted files since last update
3. Updates the knowledge graph with new nodes and edges
4. Refreshes `PROJECT_AUDIT.md` with current structure
5. Updates `meta.json` with latest commit hash

**Total time: 10-30 seconds**

---

## Reading the Knowledge Graph

Before starting work, read the knowledge graph to understand the project:

```bash
# Quick project overview
cat .understand-anything/meta.json

# Full architecture (223 KB, parse with JSON)
cat .understand-anything/knowledge-graph.json | python3 -c "import json,sys; g=json.load(sys.stdin); print(f'Nodes: {len(g[\"nodes\"])}, Edges: {len(g[\"edges\"])}, Layers: {len(g[\"layers\"])}')"

# Human-readable audit
cat .understand-anything/PROJECT_AUDIT.md
```

---

## File Structure Reference

```
.understand-anything/
├── knowledge-graph.json    # Machine-readable graph (223 KB)
├── PROJECT_AUDIT.md        # Human-readable audit (26 KB)
├── meta.json               # Update metadata
└── .understandignore       # Files to exclude from scan
```

---

## Node ID Convention

When adding nodes, use these ID prefixes:

| Prefix | Type | Example |
|--------|------|---------|
| `file:` | Source code | `file:src/server.ts` |
| `config:` | Config files | `config:package.json` |
| `document:` | Documentation | `document:README.md` |
| `service:` | Services | `file:src/services/emailService.ts` |
| `test:` | Test files | `file:tests/aiCamera.test.ts` |

---

## Quick Commands

```bash
# Update graph (run after ANY file change)
node scripts/quick-update.mjs

# View project stats
node -e "const g=require('./.understand-anything/knowledge-graph.json'); console.log('Nodes:', g.nodes.length, 'Edges:', g.edges.length)"

# List all files in a layer
node -e "const g=require('./.understand-anything/knowledge-graph.json'); const l=g.layers.find(l=>l.id==='layer:api'); l.nodeIds.forEach(n=>console.log(n))"

# Find what imports a file
node -e "const g=require('./.understand-anything/knowledge-graph.json'); const file='src/server.ts'; g.edges.filter(e=>e.target==='file:'+file).forEach(e=>console.log(e.source, e.type))"
```

---

## Adding New Files

When you create a new file, the quick-update script will automatically:
1. Detect the new file
2. Add a node with type based on path/location
3. Scan for imports/exports to create edges
4. Assign to appropriate architecture layer

No manual editing of the graph is needed.

---

## Architecture Layers

| Layer | Description |
|-------|-------------|
| `layer:presentation` | Frontend React SPA |
| `layer:mobile` | React Native Expo app |
| `layer:api` | Express.js route handlers |
| `layer:service` | Business logic services |
| `layer:data` | Database, migrations, data files |
| `layer:infrastructure` | Middleware, workers, config |
| `layer:testing` | Test files |
| `layer:documentation` | Docs, specs, guides |
| `layer:scripts` | CLI tools, seed scripts |
| `layer:configuration` | Package configs, env files |

---

## Troubleshooting

### Graph seems outdated
```bash
node scripts/quick-update.mjs
```

### Graph is too large
The graph is ~223 KB for 258 files. This is normal. If it exceeds 1 MB, check for duplicate nodes:
```bash
node -e "const g=require('./.understand-anything/knowledge-graph.json'); const ids=g.nodes.map(n=>n.id); const dupes=ids.filter((id,i)=>ids.indexOf(id)!==i); console.log('Duplicates:', dupes)"
```

### New file not showing in graph
Run the update script:
```bash
node scripts/quick-update.mjs
```

---

## For Human Reference

- **Architecture**: See `layer:*` nodes in knowledge graph
- **Dependencies**: See `depends-on` and `imports` edges
- **API Routes**: See `layer:api` nodes
- **Services**: See `layer:service` nodes
- **Tests**: See `tested_by` edges

---

*This file ensures every AI agent keeps the project knowledge graph synchronized.*

---

## Delegating to Subagents

To maximize response efficiency and prevent main context bloat, agents **SHOULD** delegate tasks to subagents:
1. **Research & Code Scanning**: Delegate extensive file reading, codebase-wide grep searches, or external documentation lookups to the `research` subagent.
2. **Parallelizable/Isolated Tasks**: Use `self` or `research` subagents for independent tasks (e.g., verifying test cases, analyzing a specific component's security model) while keeping the main conversation focused on user interaction.
3. **Small Task Delegation**: Use subagents to run small, self-contained scripts, check compiler warnings, run specific formatting commands, or perform minor cleanups to offload processing from the main agent.
4. **Multiple Agents for Development**: For complex, multi-component development (e.g., modifying both frontend page and backend API at the same time), spawn multiple subagents in parallel to focus on separate subsystems, then synthesize and integrate their output in the main agent.
5. **Task Hand-off**: When starting a subagent, provide a clear, actionable prompt and wait for the system to notify you when it completes. Do not poll or loop in the meantime.

---

## Ponytail — Lazy Senior Dev Mode

Ponytail is installed as an always-on ruleset at `.agents/rules/ponytail.md`.
Source: https://github.com/DietrichGebert/ponytail (v4.7.0, MIT)

Before writing any code, agents MUST stop at the first rung that holds:
1. Does this need to exist? (YAGNI) → skip it
2. Stdlib does it? → use it
3. Native platform feature? → use it
4. Installed dependency? → use it
5. One line? → one line
6. Only then: the minimum that works

Intentional simplifications must be marked with a `ponytail:` comment.

---

## UI Development Guidelines

**CRITICAL RULE FOR ALL NEW UI COMPONENTS:**
Never hardcode raw Tailwind colors like `bg-black/20`, `bg-[#18181b]`, `text-white`, or `bg-white/5` when building UI.
This breaks the light mode/theme toggle.
**ALWAYS** use the semantic Tailwind variables defined in the project:
- Backgrounds: `bg-bg`, `bg-bg2`, `bg-bg3`, `bg-glass-bg`
- Text: `text-text`, `text-muted`
- Borders: `border-border`, `border-glass-border`

---

## No Simulated/Mock Features Rule

**CRITICAL RULE:**
- **Never show a simulated or simulation Pharmarack cart ("pharmacart") in the app.**
- **Never show any simulation or mock interface mode.** Remove all badges, labels, toggles, or options referencing "Simulation" or "Simulated" modes for the Pharmarack cart or other app components.
- **Only display live features and live data at all times.** Do not present placeholder or mockup screens for development features in the user-facing UI; if a feature is in development, do not expose a simulated front-end for it.

---

## Pharmarack Session Persistence Contract

To prevent daily session expiration and repetitive OTP prompts:
1. **Background Refresh Scheduler**: Automatically checks and navigates to the Pharmarack dashboard headlessly every 20 minutes to keep the session rolling and capture refreshed API authorization tokens.
2. **Profile Lock Resolution**: Chrome profile lock files (`SingletonLock`, `lockfile`, etc.) are cleaned dynamically before launching Puppeteer to avoid lock crashes.
3. **Session Cookie Preservation**: When background refreshes or cart fallbacks copy the profile directory to a temporary path, the updated session data and rolling cookies must be copied back to the main profile (`data/pharmarack_profile`) on exit, ensuring the primary profile remains authenticated.

---

## SPA Performance & Database Search Contract

To prevent sluggish page switching, high network/CPU utilization, and laggy autocomplete dropdowns:

1. **Module-Level Variable Caching (State Preservation):**
   * All primary SPA pages (such as POS, Purchases, Inventory, and CRM) must utilize module-level variables (declared outside the React component) to cache heavy lists and metadata.
   * On component mount, the page must immediately hydrate its state from the module cache to render instantly without layout shifts or loading spinners.
   * Network requests to refresh data must run silently in the background and update the cache without disrupting the user's focus.

2. **No Mount-Time Request Saturation:**
   * Never trigger multiple individual, concurrent API requests for separate items on page mount (e.g., querying recommendations for 12 items individually).
   * Design and implement batched endpoints (e.g., `/api/sales/recommend-quantity/batch`) to consolidate multiple lookups into a single network round-trip and a single database query.

3. **Asynchronous External Integrations:**
   * Autocomplete dropdown inputs must never combine local database lookups and external network calls (such as Pharmarack) into a single blocking `Promise.all`.
   * Local search results must resolve and render instantly (within $<30\text{ms}$). Third-party search queries must run in parallel and stream/append their results asynchronously when they arrive.

4. **Search Database Optimizations:**
   * Local medicine search endpoints must prioritize fast index range scans (`LIKE 'term%'`) on the medicine name using the index `idx_medicines_name`.
   * If a prefix match yields sufficient results (e.g., $\ge 15$), the endpoint should return immediately. Fall back to middle-word matches (`LIKE '%term%'`) only if necessary.
   * Avoid casting numeric columns (like MRP) to text dynamically in SQL clauses unless the query contains numeric characters. Doing so forces SQLite to run full table scans on every keystroke, causing severe UI lag.

