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

### Generating human-readable documentation from the graph
After updating the graph, regenerate the full project documentation:
```bash
node scripts/generate-project-docs.mjs   # writes docs/KNOWLEDGE_GRAPH_DOCUMENTATION.md
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

## Bug Fix Rulebook (mandatory for defects)

When the user reports a **bug**, **issue**, **regression**, or asks to fix broken behavior, agents **MUST** read before editing:

1. **`AGENT_BUG_FIX_RULEBOOK.md`** (repository root) — **universal** workflow, guardrails, and checklist (any agent, any issue; portable to other projects)
2. **Root `AGENTS.md`** (this file) — **this project’s** page ownership and architecture contracts
3. **`SMALL_BUG_FIX_PLAN.md`** (repository root) — **this project’s** catalog of fixed and **open** issues (Section 4)

Shortcut pointer: **`BUG_FIX_RULE_GUIDE.md`**. Always-on: **`.agents/rules/bug-fix.md`**.

After fixing a bug in this repo, update `SMALL_BUG_FIX_PLAN.md` (move Open → Fixed) and run `node scripts/quick-update.mjs`.

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
4. **Boot Live-Cart Warm-up** (added 2026-08): after the first boot token refresh settles, the backend proactively loads the live cart via `warmupStartupCart()` (chained on `tokenRefreshScheduler.onFirstRefreshComplete()` with a T+50s fallback) so `startupSyncCoordinator` reflects real sync state instead of waiting for a UI visit — no false "cart sync pending" toast on first boot; genuine session expiry still surfaces the toast truthfully.

---

## SPA Performance & Database Search Contract

To prevent sluggish page switching, high network/CPU utilization, and laggy autocomplete dropdowns:

1. **Module-Level Variable Caching (State Preservation):**
   * All primary SPA pages (such as POS, Purchases, Inventory, and CRM) must utilize module-level variables (declared outside the React component) to cache heavy lists and metadata.
   * On component mount, the page must immediately hydrate its state from the module cache to render instantly without layout shifts or loading spinners.
   * Network requests to refresh data must run silently in the background and update the cache without disrupting the user's focus.

2. **Keep-Alive Is Real (implemented 2026-08):**
   * `KeepAliveOutlet` (frontend/src/lib/keepAlive/KeepAliveOutlet.tsx) now genuinely renders every visited page simultaneously, hiding inactive ones with `display:none`. Pages are mounted ONCE per session; navigation never remounts them.
   * `usePageActive()` returns true ONLY for the currently visible page — background polls/focus-refetches in hidden pages MUST gate on it (Dispatch, CRM, Settings, Mail, etc. already do).
   * Navigation-with-state hand-offs (e.g. Quick Assist → `/pos` `state.prefill`, Sells → editSale) keep working because POS hydration effects depend on `location.state`, not remount. Do NOT convert such effects to mount-only.
   * Freshness for kept-alive pages comes from the global SSE listener + react-query invalidation, not from remount refetches. Any new page must map its query keys into `SSE_QUERY_MAP` instead of relying on `refetchOnMount`.
   * **Deferred-SSE refresh (added 2026-08-23)**: SSE/cache invalidations only MARK queries stale (`refetchType: 'none'`). The visible page's `PageQueryTracker` (lib/keepAlive/PageQueryTracker.tsx, mounted per page by KeepAliveOutlet) refetches its own invalidated queries instantly and silently refreshes stale ones when the page is activated — so one backend write can never fan out into simultaneous refetch storms across hidden pages. Chrome keys outside KeepAliveOutlet (`orders`, `refills`, `settings`) keep instant refetch via `CHROME_INSTANT_KEYS`. NEVER reintroduce eager `refetchQueries({type:'active'})` in SSE handlers or `invalidateAfterStockWrite`.
   * **Idle warm-mount (added 2026-08-23)**: ~20s after boot, App.tsx progressively pre-mounts high-traffic pages (`/dashboard`, `/inventory`, `/crm`, `/mail`, `/purchases`, `/settings`) HIDDEN via `prewarmRoute()` — one every 8s, only while the user is idle >45s and the tab is visible — so their first switch behaves like POS. Page data fetching during warm-up still honors each page's own `useFetchMode` gates.
   * Layout chrome (`Sidebar`, `Topbar`, `QuickAssistSidebar`, `ConnectedDevicesFooterBar`) is `React.memo`-wrapped with stable callbacks; navigation re-renders no longer redraw the whole shell. Sidebar reads the router via its own `useLocation()`, never bare `window.location` during render.


3. **No Mount-Time Request Saturation:**
   * Never trigger multiple individual, concurrent API requests for separate items on page mount (e.g., querying recommendations for 12 items individually).
   * Design and implement batched endpoints (e.g., `/api/sales/recommend-quantity/batch`) to consolidate multiple lookups into a single network round-trip and a single database query.

4. **Asynchronous External Integrations:**
   * Autocomplete dropdown inputs must never combine local database lookups and external network calls (such as Pharmarack) into a single blocking `Promise.all`.
   * Local search results must resolve and render instantly (within $<30\text{ms}$). Third-party search queries must run in parallel and stream/append their results asynchronously when they arrive.

5. **Search Database Optimizations:**
   * Local medicine search endpoints must prioritize fast index range scans (`LIKE 'term%'`) on the medicine name using the index `idx_medicines_name`.
   * If a prefix match yields sufficient results (e.g., $\ge 15$), the endpoint should return immediately. Fall back to middle-word matches (`LIKE '%term%'`) only if necessary.
   * Avoid casting numeric columns (like MRP) to text dynamically in SQL clauses unless the query contains numeric characters. Doing so forces SQLite to run full table scans on every keystroke, causing severe UI lag.

---

## Data Fetch Control & Idle Gating Contract

To prevent excessive network traffic, database load, and background resource usage:
1. **Unified Configuration Registry**: Frontend and backend settings must load dynamically via `dataFetchControl`. Interactive pages must support `auto`, `manual`, and `off` modes.
2. **Idle-Gating**: Background sync tasks, backups, near-expiry scans, catalog updates, and periodic polling jobs must query `activityTracker.isIdle()`. If the user is inactive for >30 minutes, execution must be paused/skipped under `manual` or gated configurations.
3. **No Mount Saturation**: Avoid launching large fetch operations synchronously on page component mount. Utilize local caching, hover-prefetch gating, and on-focus lazily loaded inputs (e.g. Doctor select).
4. **Silent Refresh on Write**: Mutations from sales (POS), purchases, customer returns, or inventory edits must trigger background updates to the client-side cache without blocking user interaction.

### API Optimization Master Plan (binding reference)

**`API_OPTIMIZATION_IMPLEMENTATION_PLAN.md`** (repository root) is the approved master plan for converting the app from timer-driven polling to event-driven refresh (SSE push via `eventService` → `/api/notifications/stream`), gated background workers, and never-lose-credentials session guarantees (Pharmarack / WhatsApp / Gmail / Telegram). Any agent implementing API-call reduction, adding pages/features/workers, or touching session persistence MUST read it first and follow its 4 principles (P1 events-not-timers, P2 cache-first paint, P3 gated workers, P4 credentials are sacred) and its Section 7 "API Efficiency Standard" for all new features.

### Special Order Arrival & Complete Flow Plan (implemented 2026-08)

**`SPECIAL_ORDER_ARRIVAL_IMPLEMENTATION_PLAN.md`** (repository root) documents the special-order lifecycle upgrade, now implemented: (A) `Mark Ready` on `/api/orders/:id/status` queues the arrival WhatsApp inside the same user-clicked request (idempotent via `notified===0`, skipped cleanly when no phone is stored, response carries `whatsapp_queued`), (B) purchase-save and sale-time matching use the stdlib fuzzy scorer (`src/utils/orderNameMatcher.ts`, acceptance threshold 75 = exact/core-equal titles only unless distributor+MRP context boosts; strength-variant siblings like base vs "Plus/DS" are rejected) scoped strictly to active in-app order statuses so Fulfilled/Cancelled/stale orders can never match, recorded with real `match_type/confidence` in `order_overlaps`, and (C) Quick Assist `Complete/Complete All` hands off to POS via the existing `state.prefill` mechanism after marking Fulfilled.

---

## Page Feature Ownership & Migration Contract

To prevent regressions, legacy fallback loops, and developer/AI confusion when features are moved to new pages:

1. **Single Source of Truth**: All feature paths, page responsibilities, API endpoints, and database tables are documented in `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md`.
2. **Strict Route Ownership Rules**:
   - **Delivery Boy Management**: MUST ONLY be read/written via `/dispatch` (`Dispatch/index.tsx`) using the `delivery_boys` database table (`GET/POST /api/dispatch/delivery-boys`). **NEVER** read/write delivery boy details from `Settings` or `app_settings`.
   - **Special Shortage Orders**: MUST ONLY be managed via `/orders` (`Orders/index.tsx`) using the `special_orders` database table (`GET/POST /api/orders`). **NEVER** introduce parallel logic pointing to `pending_shortage_requests`.
   - **AI Learning Hub (`/learning`) & Settings Hub (`/settings`)**: `/learning` (`Learning/index.tsx`) is the dedicated 4-tab AI Learning command center managing Clinical AI retraining, OCR text correction rules, Doctor Directory, Distributor OCR layouts, and QR document scanning sandbox. `/settings` (`Settings/index.tsx`) is the store configuration hub managing Store Profile, Staff & Security, External Integrations, and Data & Backups. These pages function as completely separate routes with ZERO cross-page redirects.

---

## WhatsApp Order Template & Delivery Boy Resolution Contract

To prevent missing delivery boy contact numbers, broken templates, or unformatted text in WhatsApp notifications sent to distributors/customers:

1. **Delivery Boy Resolution & Formatted Phone**:
   - Every WhatsApp order template (including cart order notifications, purchase order notifications, and quick special order notifications) **MUST** resolve active registered delivery boys from the `delivery_boys` database table.
   - When no specific delivery boy is assigned or if `Not assigned yet` is passed, the app **MUST** automatically query the first active delivery boy (`is_active = 1`) from `delivery_boys` and populate **BOTH** their Name (`name`) and Formatted Phone (`+91 XXXXX XXXXX`).
   - If no active delivery boy exists in `delivery_boys`, the template **MUST** fall back to the Store Admin / Pharmacy Owner details from `app_settings` (`owner_whatsapp_number`, `shop_phone`) as `👤 Admin / Store Owner`.
   - Never output raw unformatted phone numbers (like `919876543210` or `9876543210`) or leave `👤 Not assigned yet \n 📞 N/A` when active delivery boys exist in the system.

2. **Special Orders & Quick Request Editing**:
   - All Special Requests / Shortage Orders are stored in the `special_orders` SQLite database table and managed via `GET/POST/PUT/DELETE /api/orders` endpoints.
   - Special Order Request management UI resides on `/crm?tab=special_orders` (`SpecialOrdersSection` in `frontend/src/pages/CRM/index.tsx`).
   - Special Order Requests **MUST** support full editing via the Edit Modal (`showEditModal`), allowing users to edit product name, requester name, phone number, quantity, advance payment, priority, status, and distributor metadata via `api.updateOrder(id, data)` (PUT `/api/orders/:id`).

---

## Strict Legitimate Data & Mandatory Workflow Audit Contract

To maintain total data integrity across the pharmacy POS ecosystem:

**Core Engineering Principle:**
- **Real data → process it.**
- **Missing data → request/validate it.**
- **Invalid data → reject it.**
- **Never → invent it.**

1. **Zero Dummy/Fabricated Business Data**:
   - Never introduce, retain, or silently use dummy, placeholder, fabricated, synthetic, guessed, or arbitrary business data anywhere in the application.
   - Prohibited values include: `MANUAL`, `AUTO`, `SPECIAL`, `DEFAULT`, `BATCH123`, `B-GEN`, `B-CATALOG`, `B-IMPORT`, `B-OFFLINE`, `B-REISSUE`, `B-MANUAL`, `B-NEW`, `12/28`, `12/30`, `2028-12-31`, `100`, `10`, `mrp * 0.7`, `Generic Medicine`, `Item + id`, `123 Health Ave`, `+91 99999 99999`.
2. **Never Add Invented Fallbacks**:
   - Missing required data must remain missing and require the user or a legitimate workflow to provide it.
   - Do not silently create, estimate, assume, auto-generate, or substitute values just to make a feature work or prevent an error.
3. **No Automatic Inventory Creation**:
   - Inventory stock can ONLY be created through a legitimate, verified purchase workflow (`Purchase -> Purchase Invoice Entered -> Verified -> Saved -> Inventory Created`).
   - Registering a medicine master, scanning OCR, receiving emails, or catalog syncs must never automatically create inventory stock.
4. **Mandatory Pre & Post Task Audit**:
   - Every agent task (bug fix, feature, refactor, integration) must perform a repository-wide audit before and after implementation.
   - Every task response MUST conclude with the 8-point Audit Summary:
     1. Existing dummy/fallback logic found.
     2. What was removed or changed.
     3. New dummy/fallback logic introduced (must be None).
     4. Missing-data handling.
     5. Error/fallback behavior.
     6. Auto-created records or values.
     7. Data source and traceability.
     8. Any remaining risk or location that needs review.

---

## Strict Manual-Only Patient Messaging Contract

To prevent unexpected or automated WhatsApp/SMS messages being sent to patients without explicit user intent:

1. **Zero Automatic Patient Messaging**:
   - The application **MUST NEVER** automatically send messages (WhatsApp, SMS, or direct messages) to patients/customers.
   - When medicines arrive in inventory, when purchase invoices are saved/verified, when refills are evaluated, or when stock is reconciled, the system **MUST ONLY** update database statuses (e.g. `status = 'Ready'`, `notified = 0`, `is_ready = 1`) and stage actionable records.
2. **Explicit User-Clicked UI Triggers Only**:
   - All patient notifications require a manual, explicit user click in the UI:
     - **Special Order Arrival**: User clicks `📱 Send Arrival WA` / `Resend` on the Special Requests panel (`/crm?tab=special_orders`).
     - **Refill Reminder**: User clicks `📱 Remind Now` on the Refills panel (`/crm?tab=refills`).
     - **POS / Sales Invoice**: Invoices are dispatched only when the user explicitly checks or enables the WhatsApp toggle at the point of sale.
3. **No Background Worker Auto-Dispatch to Patients**:
   - Background crons, inventory listeners, queue workers, and purchase reconcilers are strictly prohibited from dispatching patient messages autonomously.

---

## Medicine Master-Name Import Contract (added 2026-08)

`scripts/importMedicineNames.mjs` enriches the master `medicines` catalog with NAMES ONLY from the retailer system exports:

- **Sources**: `retailerdb_backup_*.sql.zip` (actually a GZIP'd PostgreSQL `pg_dump`; parses the `COPY public.medicine (...)` stdin block, `medicine_name` column index resolved from the header) and root `medicines.csv` (`medicine_name` column). Both stay gitignored raw inputs.
- **Inserts**: `INSERT INTO medicines (name, source) VALUES (?, 'master_reference')` only — MRP/tax/manufacturer remain schema defaults until a real purchase invoice or user edit fills them. No inventory_master writes, no other tables touched.
- **Dedupe**: whitespace-collapsed case-insensitive comparison on BOTH candidate and DB side; re-runs are idempotent. Do not weaken this to plain `LOWER(TRIM(name))` — that reintroduces spacing-variant duplicates (782 had to be purged after the 2026-08-22 run).
- **Run**: `node scripts/importMedicineNames.mjs [--dry-run]`. 2026-08-22 result: 286,389 → 291,878 rows (+5,489 unique names); legacy duplicate groups pre-dating the import were deliberately left untouched.
