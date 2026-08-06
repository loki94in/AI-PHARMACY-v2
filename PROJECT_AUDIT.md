# AI PHARMACY v2 — Full Project Audit (Page-by-Page, Deep Detail)

Generated 2026-08-05. This is the exhaustive version: every frontend page, every API function it calls, every backend endpoint behind those calls (what SQL/tables/services each one touches), the exact step-by-step data flow for real user actions, why the underlying tech was chosen, open-source alternatives for each major piece, and — separately — a full map of how pages hand data to each other (router state, event buses, SSE, shared caches, shared DB tables).

**Table of Contents**
0. Tech Stack Overview (deep)
1. Routing & App Shell
2. Sales & Checkout — POS, Sells, PhoneSales, Returns, CustomerReturn, CustomerReturnHistory
3. Inventory & Procurement — Inventory, Purchases, PurchaseHistory, Expiry, Database, Migration, SellPriceConfig
4. Distributor Ordering & Dispatch — Dispatch, PharmarackCart, NonMappedDistributors, CatalogUpload
5. Compliance, CRM & Communications — CRM, Mail, Compliance, CompositionQueue, Investigation, License
6. Dashboard, Reports & Admin — Dashboard, Reports, Learning, Settings
7. Database Schema (deep)
8. Cross-Cutting Architectural Patterns
9. **How Pages Talk To Each Other** — the full data-handoff map
10. Summary Table — all 27 pages at a glance

---

## 0. Tech Stack Overview (deep)

### 0.1 Backend runtime & framework

**Express (`express`)** is the HTTP server. Every route in `src/routes/*.ts` (41 files) is an Express router mounted under `/api/*`. There is no ORM — every route talks to SQLite via raw SQL through `dbManager.getConnection()`, sometimes inside `dbManager.transaction(...)`.

- **Why Express over the alternatives**: the app is not a public-facing multi-tenant web service — it's a single-pharmacy, single-process backend that ships *inside* a desktop installer alongside the DB file. Express needs no build step, has no opinionated project structure to fight, and every contributor already knows it. Fastify would have given schema-validated routes and ~2x raw throughput, but throughput was never the bottleneck here (SQLite on a local disk, one concurrent user); the operational simplicity of Express won.
- **OSS alternatives and when they'd actually matter**:
  - **Fastify** — worth it only if the team starts feeling pain from unvalidated request bodies (there is no `zod`/`joi`/`ajv` validation layer visible anywhere in the routes — every route trusts `req.body` shape and does manual `if (!x) return res.status(400)` checks). Fastify's built-in JSON-schema validation would remove a whole category of "field was undefined and it silently wrote NaN" bugs.
  - **Koa** — smaller core, more middleware-your-own-way; not a meaningful win here since Express's middleware ecosystem (helmet, rate-limit, cors, multer) is already what's in use.
  - **Hono** — attractive for edge/serverless; irrelevant here since this app is not deployed serverless.
  - **NestJS** — would impose real structure (modules/DI/decorators) on a 41-route, 60-service codebase that's clearly grown organically; a genuine option if the team ever does a deliberate architecture pass, but a large rewrite cost for no runtime benefit today.

**better-sqlite3 + sqlite + sqlite3** — three SQLite bindings coexist in `package.json`. `better-sqlite3` (synchronous, native) is what the app actually runs on for the hot path (`dbManager` wraps it); `sqlite`/`sqlite3` (async, callback/promise style) appear to be legacy or used by a narrower subset of scripts/migrations.

- **Why SQLite over a client-server DB (Postgres/MySQL)**: the whole product is offline-first, single-machine, desktop-installed software for an individual pharmacy. There is no "server" to run Postgres on, no DBA, no network dependency that a client-server DB would introduce. A single `.db` file also makes backup trivially copyable (see the Settings page's Backup Center, and Migration's whole-file-swap strategy) and makes the "give me your data" support story as simple as "attach this file."
- **Why `better-sqlite3` specifically (sync) over `sqlite3` (async/callback)**: transactional correctness is critical here (stock decrements, GST totals, invoice numbering) — `better-sqlite3`'s synchronous API lets a `db.transaction(fn)` wrapper guarantee that a whole multi-statement operation (e.g. POS checkout: insert invoice → per-item stock check → per-item decrement → commit) either fully applies or fully rolls back, without the callback-pyramid or interleaving risk that comes with async SQLite drivers under concurrent requests.
- **OSS alternatives**:
  - **libSQL / Turso** — SQLite-file-compatible but adds optional server-side replication/sync; would be the natural next step if the product ever needs "sync this pharmacy's data to the cloud" without abandoning the offline-first file model.
  - **DuckDB** — excellent for the *reporting* side (Reports page's aggregate queries) but not a transactional OLTP replacement; could theoretically sit alongside SQLite purely for analytics, though that's added complexity for marginal query-speed gain at this data volume.
  - **PostgreSQL** — the "obvious" enterprise choice, but wrong for this product's offline/single-file distribution model unless the business model pivots to a hosted multi-pharmacy SaaS.

### 0.2 WhatsApp automation stack

**`whatsapp-web.js`** (wraps a real, logged-in WhatsApp Web session via **`puppeteer-core`**) is the backbone of `src/whatsappClient.ts`, which exposes `sendMessage`, `getWhatsAppStatus`, `shouldRouteToBusiness`, `initClient`, `hashMessageBody`.

- **Why an unofficial session-based client instead of only the official WhatsApp Business Cloud API**: the official API requires Meta business verification, pre-approved message templates for anything outside a 24-hour customer-service window, and per-conversation billing. A pharmacy owner wants to message their *own* delivery boys and distributors freely, using their own personal/business WhatsApp number, with zero approval process and zero per-message cost — `whatsapp-web.js` delivers that immediately. The cost is fragility: Meta can and does change WhatsApp Web's internals without notice, occasionally breaking the unofficial protocol until the library catches up.
- **This is why the app also has `whatsappBusinessService.ts` + `routes/whatsappBusiness.ts`** — a second, official-API-compliant send path exists in parallel, with `shouldRouteToBusiness()` making a per-message routing decision. This is a deliberate hedge: use the free/flexible unofficial client for day-to-day operational messages, keep the option open to route through the compliant official API where that matters more (e.g., customer-facing messages that need to survive a WhatsApp platform change).
- **OSS alternatives**:
  - **Baileys** — a lighter-weight WhatsApp Web protocol implementation with no Chromium/Puppeteer dependency at all (it talks the WebSocket protocol directly). Would shrink the app's install size and memory footprint substantially, at the cost of being arguably *more* fragile to WhatsApp protocol changes than `whatsapp-web.js` (smaller maintainer base, no browser to fall back on for DOM-based workarounds).
  - **venom-bot**, **wppconnect** — same category as whatsapp-web.js (Puppeteer-based), roughly interchangeable; no strong reason to switch given whatsapp-web.js already works and is deeply integrated.
  - **Official Cloud API only** — the "do it the compliant way only" option; would remove all protocol fragility risk but reintroduce the template-approval/cost friction the unofficial path was chosen to avoid. Realistic only if message volume and business risk tolerance both push toward full compliance.

**Anti-detection pacing** (`whatsappQueueWorker.ts`, `pharmarackDailyDispatchService.ts`) is a custom-built queue with randomized 8–12s delays between sends and a rotating daily send-window (11:00–11:10 AM band, ±15min offset, rotating every 45 days) for the automated daily distributor digest — engineered specifically so a bulk-send doesn't look like a bot to WhatsApp's abuse-detection systems. There's no OSS package for this; it's inherently product-specific logic, correctly hand-rolled.

### 0.3 OCR / document intelligence stack

Three OCR engines are present simultaneously: **`tesseract.js`** (pure JS/WASM, no native deps — the safe baseline that always works after install), **`onnxruntime-node`** (runs a custom or pre-trained ONNX model — presumably faster/more accurate for a specific document layout once trained), and **`paddleocr`** (PaddlePaddle's OCR, generally stronger than Tesseract on dense/small printed text like pharma invoice line items).

- **Why three engines instead of one**: this looks like a progressive-enhancement strategy — Tesseract.js guarantees the feature *works* on every install with zero extra native binary risk (WASM runs anywhere Node runs); ONNX Runtime and PaddleOCR are heavier/faster/more accurate options layered in for specific document types (e.g. prescription handwriting vs. printed distributor invoices) where Tesseract's general-purpose accuracy isn't good enough. Running multiple engines and reconciling/choosing results (or routing by document type) is a common pragmatic pattern when no single OCR engine is good enough alone across all input types this app receives (WhatsApp prescription photos, scanned invoices, PDF text layers).
- **OSS alternatives**:
  - **EasyOCR** — often more accurate than Tesseract out of the box, but it's Python-only; embedding it in a Node/Electron desktop app means shipping a Python runtime or running a local subprocess/HTTP microservice, meaningfully more packaging complexity than a pure-JS or ONNX-in-Node solution.
  - **docTR** (Python, Mindee) — similar tradeoff to EasyOCR.
  - **Cloud OCR (Google Vision, AWS Textract, Azure Document Intelligence)** — would likely beat all three current engines on raw accuracy, but breaks the offline-first requirement outright and adds a recurring per-page cost; a non-starter unless the product's offline promise changes.

### 0.4 Email intake stack

**`imap-simple`** + **`mailparser`** — a lightweight IMAP client and MIME parser, used by `emailService.ts` to poll Gmail for distributor invoice emails.

- **Why IMAP polling instead of Gmail's push API (Pub/Sub push notifications)**: Gmail Pub/Sub push requires a Google Cloud project, a publicly reachable webhook endpoint, and OAuth consent-screen verification for production use — none of which fit a desktop app running behind a pharmacist's home/shop router with no public IP. IMAP polling (App Password or OAuth2, both supported per the Learning page) works from anywhere with outbound internet access only.
- **OSS alternatives**: **node-imap** (lower-level, `imap-simple` is a promise wrapper around it — could drop straight to node-imap for fewer dependencies, marginal benefit); a full Gmail API integration (`googleapis` package) would give push notifications and richer metadata but requires the Cloud-project/webhook setup above.

### 0.5 Document generation & parsing

`pdf-parse` / `pdfjs-dist` (read PDFs — distributor invoices, migration source docs) vs `pdfkit` (generate PDFs — pharmacy's own reports/invoices) vs `xlsx` (read/write Excel — catalog imports/exports, migration).

- **OSS alternative worth naming**: **`pdf-lib`** can both read and write PDFs in one library, which could in principle replace the pdf-parse+pdfkit split — but pdfkit's report-layout ergonomics (used across Reports/Compliance/Investigation exports) are more purpose-built for "lay out a document with headers/tables/fonts" than pdf-lib's lower-level approach, so keeping them separate is a reasonable call, not an oversight.

### 0.6 Frontend framework & state

**React + react-router-dom + Vite**, with **`@tanstack/react-query`** used *inconsistently* alongside hand-rolled module-level variable caches (see §8.1) and **`@tanstack/react-virtual`** for every large table (Inventory, Investigation, Sells, PurchaseHistory, CustomerReturnHistory).

- **Why Vite over Create React App / webpack**: Vite's native-ESM dev server and instant HMR matter a lot here because pages are enormous (CRM is 4463 lines, PharmarackCart 3414, Learning 2813, Settings 2541) — a webpack-based dev loop would be materially slower to iterate on files this size. Vite's built-in code-splitting is also exactly what `pageImports.ts`'s per-page `React.lazy()` map relies on.
- **Why `@tanstack/react-virtual` specifically**: several tables here render tens of thousands of DOM rows (full inventory, full sales history) — without windowing, the browser would choke on DOM node count alone. `react-virtual` is the actively-maintained, headless (no imposed styling) choice; **`react-window`** is the main alternative, slightly less actively maintained and less flexible for variable-height rows, which is why the more modern library likely won here.
- **Why React Query is *inconsistently* applied rather than universal**: this reads as organic growth rather than a deliberate two-tier design — some pages (CatalogUpload, Investigation) use it properly with cache-key invalidation; many others (Dispatch, PharmarackCart, CRM, Reports) use plain module-scope variables instead. The practical effect is the same (instant re-mount under `KeepAliveOutlet`), but a new engineer has to learn two different mental models for "how does this page cache its data" depending which page they're in. See §8.1 for the concrete recommendation.

### 0.7 Styling & UI primitives

**Tailwind CSS** + `tailwind-merge` + `clsx` for styling, **`lucide-react`** for icons, **`motion`** (Framer Motion) for animation, **`jspdf`/`jspdf-autotable`** for client-side PDF export (used on nearly every list page's Export button).

- **Why Tailwind over component libraries (MUI, Ant Design, Chakra)**: a component library would have imposed its own design language and bundle weight across 27 pages; Tailwind's utility classes let each page's author (evidently working somewhat independently, given how differently-structured the pages are) build exactly the layout needed without fighting a component API. The tradeoff is the *inconsistency* visible across pages (different caching patterns, different table/pagination implementations) — a shared component library would have forced more structural consistency at the cost of flexibility.
- **OSS alternative if consistency becomes a priority**: adopting **shadcn/ui** (Tailwind-native, copy-in components rather than an npm dependency) would preserve the Tailwind foundation while giving the team a shared `Table`, `Modal`, `Drawer` etc. to converge the currently-divergent per-page implementations onto.

---

## 1. Routing & App Shell

**Files**: `frontend/src/App.tsx`, `frontend/src/lib/pageImports.ts`, `frontend/src/components/Layout.tsx` (2000+ lines)

### 1.1 Code-splitting

All 23 top-level pages are registered in `pageImports.ts` as `path → () => import('../pages/X')`, and `App.tsx` turns each into a `React.lazy()` component. `Layout` itself is also lazy-loaded (`lazy(() => import('./components/Layout'))`) specifically so that Layout's polling/SSE-subscription code (WhatsApp status, Telegram status, Pharmarack session health, the notification stream) doesn't sit in the initial JS bundle and delay first paint.

**Why lazy-load everything instead of one bundle**: with 27 pages this large (several 2000–4400 lines), a single bundle would mean every user downloads and parses megabytes of JS for pages they may never open in a session (License, Migration, CompositionQueue are not daily-use pages for most staff). Per-page code-splitting means the initial load is just POS (the default landing page) plus Layout's shell.

### 1.2 KeepAliveOutlet — the app's defining architectural choice

Instead of React Router's default unmount-on-navigate behavior, this app renders routes through a custom `KeepAliveOutlet` (`frontend/src/lib/keepAlive/KeepAliveOutlet`) over a `pageRoutes` array (22 entries). **Every page that has ever been visited in the session stays mounted in the DOM (hidden, not destroyed) when the user navigates away.**

This single decision explains a huge fraction of the patterns seen across every page in this audit:
- **Why so many pages use module-level variable caches instead of re-fetching on mount**: they don't need to — the component *never unmounts*, so its React state (including any `cachedX` module variable that seeded it) is already sitting in memory when the user navigates back. A traditional unmount/remount SPA would need React Query or similar to avoid a loading spinner on every return visit; this app avoids the problem architecturally instead.
- **Why scroll position and multi-tab state (POS's cart tabs, Purchases' draft-invoice tabs) survive navigation without explicit save/restore code**: the DOM node and its React fiber tree are simply never torn down.
- **The cost**: memory usage grows with the number of distinct pages visited in a session (all of them stay mounted), and any page with an active polling `setInterval`/SSE subscription needs to explicitly gate on page-visibility (see `usePageActive()`, used throughout Learning/Mail/PharmarackCart/CatalogUpload) or it will keep polling forever in the background even while the user is looking at a different page.

**OSS alternative**: `react-activation` provides almost exactly this keep-alive-on-navigate behavior as a maintained library (`<KeepAlive>` wrapper component, drop-in with React Router). Given how central this pattern is to the whole app's design, evaluating whether the hand-rolled `KeepAliveOutlet` has any behavior gaps against `react-activation` would be a reasonable audit item — though replacing working, load-bearing infrastructure this deep in the app is a non-trivial, high-blast-radius change that would need very strong justification.

### 1.3 Legacy path redirects

`App.tsx` declares explicit `<Route>` redirects for old/renamed URLs, presumably preserved for old bookmarks, mobile-app deep links, or in-app links that haven't all been updated:

| Old path | Redirects to |
|---|---|
| `/` | `/pos` |
| `/expiry` | `/returns?tab=expiry` |
| `/automation-center` | `/crm?tab=messages` |
| `/refills` | `/crm?tab=refills` |
| `/message-listener` | `/dashboard` |
| `/non-mapped-distributors` | `/learning?tab=distributors` |
| `/doctors` | `/learning?tab=doctors` |
| `/catalog` | `/database?tab=catalog` |
| `/customer-returns` | `/returns?tab=customer-returns` |
| `/customer-returns-history` | `/returns?tab=customer-returns-history` |

This redirect table is itself evidence of the app's evolution: CRM, Learning, and Returns each absorbed what used to be standalone pages into tabs, and the redirects keep old links working rather than breaking them.

### 1.4 Predictive prefetching

- **1.5s after mount**: `App.tsx` prefetches every page's JS chunk (all 23 `pageImports` entries) during browser idle time.
- **8s after mount**: prefetches Dashboard's API data and Reports' sales/30-day API data specifically — a bet that these are the most likely "next click" for a freshly-opened app.
- **On sidebar link hover** (`Layout.tsx`'s `Sidebar`): both the target page's JS chunk *and* (gated by `useFetchMode('layout.hoverPrefetch')`) its primary React Query data get prefetched — e.g. hovering "CRM" prefetches the doctors list, hovering "Mail" prefetches the email inbox, hovering "Pharmarack Cart" prefetches the cart.

**Why this exists**: the app targets a busy pharmacy counter where every second of loading spinner is friction against a waiting customer. Predictive prefetch trades idle-time bandwidth/CPU (which is free when the user is reading the screen) for perceived-instant navigation.

### 1.5 Layout.tsx — the shared shell

- **Sidebar**: 19 nav items (POS, Sales History, Inventory, Purchase History, Purchases, Distributor Mail, Reports, Pharmarack Cart, Investigation Center, Composition Queue, AI Learning, Dispatch, CRM & Messages, Supplier Returns, Master Database, Phone Sales, Dashboard, Data Migration, License, Settings), 256px desktop / 288px mobile drawer. Active-tab detection is `?tab=`-aware (e.g. `/learning` highlights differently depending on which tab is active).
- **QuickAssistSidebar**: a separate right-hand collapsible panel (refills shortcut, special-orders shortcut) — independent of the main left Sidebar, presumably so time-sensitive cross-cutting reminders (a refill due today, a special order awaiting fulfillment) stay visible regardless of which page the user is deep in.
- **"Sync Reviews Pending" banner**: surfaces a count of staged offline sales/purchases awaiting review, opens a review modal — the UI surface for the offline-queued-write pattern described in §8.6.
- **FlashToast**: app-wide toast component, triggered via the `toastEvent` pub/sub bus (see §9.2) from anywhere in the app without prop-drilling a toast function down through every page.
- **Cross-cutting polling lives here, not per-page**: WhatsApp/Telegram/Pharmarack connection status and the SSE notification stream are all owned by Layout — a deliberate centralization so that, e.g., a WhatsApp-disconnected warning is visible regardless of which page the user is on, and so the polling code only runs once (in Layout) rather than being duplicated per-page.

---

## 2. Sales & Checkout

This cluster is the revenue-critical core of the app: POS (checkout), Sells (history/edit), PhoneSales (remote-order approval), Returns (supplier-side), CustomerReturn (refunds), CustomerReturnHistory (audit trail). Every stock-decrementing or stock-restoring code path in this cluster funnels through the same guiding rule, confirmed at every single insertion point in `src/routes/sales.ts` (POST `/` new sale, hold-bill, update-sale, device-sync, staged-sale-approve) and independently in `customerReturns.ts`:

> **No sale is ever allowed to exceed real, currently-available stock, and no code path auto-creates or tops up stock to make a sale possible.** If `currentTotalUnits < soldTotalUnits`, the operation throws and the whole transaction rolls back — this is a standing project rule, not an incidental implementation detail.

The stock math itself is centralized in `src/utils/stockRebuild.ts::applyStockDelta()`, which treats a batch's stock as one **fungible base-unit pool** (`quantity * packSize + loose_quantity`) rather than two separate counters — so selling 1.5 strips correctly converts into "1 strip decremented, half a strip's worth of loose units adjusted," with floor/modulo re-splitting back into packs+loose after the delta is applied. This one function is the only place in the sales-flow code that should ever mutate `inventory_master.quantity`/`loose_quantity` together — **Returns and CustomerReturn bypass it** (see §2.4 and §2.5), which is flagged below as a real inconsistency.

### 2.1 POS (`frontend/src/pages/POS/index.tsx`, 4243 lines)

**Purpose**: The primary point-of-sale checkout screen — the single busiest page in the app, used continuously at the pharmacy counter. Cashier searches/scans medicines, builds a cart, applies discounts, links a patient/doctor (for prescription tracking and Schedule H1 compliance), and finalizes a sale into an invoice.

**Full feature list**:
- **Multi-tab cart system** — "Cart 1", "Cart 2", etc., persisted to `localStorage` under `pos_active_tabs` / `pos_active_tab_id`. Survives page refresh and tab switches — a cashier can hold one customer's cart open while ringing up another.
- **Medicine search & autocomplete** with server-side fuzzy matching (`GET /api/sales/search-medicine`, `/suggest-medicine`), plus a **barcode/AI camera scanning path** via the shared `AICamera` component.
- **Batch grouping with FEFO (First-Expired-First-Out) ranking**, computed client-side (`groupBatches`/`fefoRank`): batches that still have full strips available rank above loose-only batches, and within that, earliest expiry wins; already-expired batches are excluded from selection entirely on the client (`isExpiredDate`) as a first line of defense — the *authoritative* expiry rejection still happens server-side.
- **Doctor/patient lookup and inline-add modals** — search existing doctors/patients or create new ones without leaving the cart.
- **Doctor combination suggestions** (`GET /crm/doctors/:id/combinations/:medicineId`) — surfaces medicines this doctor commonly prescribes alongside the one just added, presumably to speed up multi-item prescriptions.
- **Refill scheduling toggle** — mark a sold item for automatic refill reminders (feeds directly into CRM's Refills tab, see §9.1).
- **Special-order fulfillment flow** — if a customer had a pending special/back-order, POS can fulfill it directly from the cart (`POST /orders/:id/fulfill`).
- **Quick medicine edit modal** — F8/Alt+E keyboard shortcut opens the shared `UniversalMedicineEditModal` for the currently-focused cart row, without leaving POS.
- **WhatsApp invoice send** — optionally emails/WhatsApps the finished invoice to the customer.
- **Bill validation layer** — before committing, the cart is checked by a dedicated `verificationService.verifyPOSBill()` pass (see below) as an extra correctness gate distinct from the per-item stock check.

**Complete api.ts → endpoint map** (21 unique functions across 32 call sites):

| Function | Endpoint | Purpose |
|---|---|---|
| `searchMedicine` | `GET /api/sales/search-medicine` | Live medicine search box |
| `getQuickEditMedicine` | `GET /api/inventory/medicines/:id/quick-edit` | Populate the F8 quick-edit modal |
| `getOrders` | `GET /api/orders` | Pending special orders, for the fulfillment flow |
| `getInventory` | `GET /api/inventory` | Fallback stock lookups |
| `getDoctors` | `GET /api/crm/doctors` | Doctor picker |
| `getDoctorSuggestions` | `GET /api/crm/doctors/:id/suggestions` | Autocomplete while typing a doctor name |
| `getPatients` | `GET /api/crm/patients` | Patient picker |
| `addPatient` | `POST /api/crm/patients` | Inline new-patient creation |
| `saveContact` | `POST /api/contacts` | Generic contact save (phone book) |
| `suggestMedicine` | `GET /api/sales/suggest-medicine` | Typeahead suggestions |
| `getDoctorCombinations` | `GET /api/crm/doctors/:id/combinations/:medicineId` | "Doctors who prescribe X also prescribe Y" |
| `getMedicineQuickDetails` | `GET /api/medicines/:id/quick-details` | Hover/preview card |
| `autoEnrich` | `POST /api/medicines/auto-enrich` | Trigger enrichment for an unmatched medicine |
| `updateMedicine` | `PUT /api/inventory/:id` | Save from the quick-edit modal |
| `validateBill` | `POST /api/verification/validate-bill` | Pre-submit correctness check |
| `updateSale` | `PUT /api/sales/:id` | Edit-in-place (rare from POS itself, mostly used by Sells) |
| `createSale` | `POST /api/sales` | **The checkout endpoint** |
| `verifySalesHistory` | `GET /api/verification/verify-sales-history/:invoiceNo` | Post-save confirmation check |
| `getCompactInventory` | `GET /api/medicines/compact` | Lightweight full-catalog cache for instant client-side lookups |
| `fulfillSpecialOrder` | `POST /api/orders/:id/fulfill` | Mark a special order fulfilled from this sale |
| `addDoctor` | `POST /api/crm/doctors` | Inline new-doctor creation |
| `queueFromPos` | `POST /api/sales/queue-from-pos` | Offline-queue path (see §8.6) |
| `sendWhatsappMessage` | `POST /api/messaging/send` | Send the finished invoice |

**Backend — `POST /api/sales` step by step** (`src/routes/sales.ts`, ~lines 195-390+):
1. `verificationService.verifyPOSBill(req.body)` runs first — a pre-save validation layer distinct from the per-item stock check; on failure returns HTTP 400 with a `layer` field identifying which check failed (lets the frontend show a specific error rather than a generic "save failed").
2. Per-item field validation: quantity and price must be positive numbers; every item must carry either an `inventory_id` or a `medicine_name` to resolve against.
3. `BEGIN IMMEDIATE TRANSACTION` — the whole checkout is one atomic unit; `IMMEDIATE` (rather than `DEFERRED`) grabs the write lock up front, avoiding a class of SQLite `SQLITE_BUSY` errors under concurrent writers.
4. Customer resolution/auto-creation: matches by phone digits first, then by name, inserts a new `customers` row only if neither matches.
5. `calculateSalesGstAndTotals(db, items, discount)` computes subtotal/CGST/SGST/total using each item's own GST rate (not a flat store-wide rate).
6. `generateInvoiceNo(db)` — scans `sales_invoices.invoice_no` for the current year and produces the next sequential `S-<year>-####`.
7. `INSERT INTO sales_invoices (...)`.
8. If the payment medium is CREDIT/PENDING/UNPAID, `customers.credit_balance` is incremented by the invoice total.
9. **Per line item** (the critical loop):
   - If no `inventory_id` was supplied, resolve `medicine_name` → a `medicines` row → the correct `inventory_master` batch (earliest expiry among available batches). **If nothing resolves, the sale throws and rolls back entirely** — there is no silent skip and no auto-creation of stock to cover the gap.
   - Re-fetch `currentStock` fresh (not trusting any client-supplied stock number) and run the strict check: `currentTotalUnits (quantity*packSize + loose_quantity) < soldTotalUnits → throw "Insufficient stock for ..."`.
   - Reject the item outright if its batch is already expired (`isExpiredForSale`).
   - Insert the `sale_items` row.
   - Call `applyStockDelta()` to decrement `inventory_master` correctly across the pack/loose boundary, then `refreshInventoryActiveStatus` (flips `is_active` off if the batch just hit zero).
10. Any thrown error anywhere in the loop rolls back the *entire* transaction — a single bad line item fails the whole sale, by design (no partial sales).
11. On commit: `inventoryCache.invalidate()`, then optionally send the WhatsApp invoice.

**Data flow — cashier completes a sale, start to finish**:
```
Cashier scans/searches items → cart state (client, per-tab)
  → clicks "Complete Sale"
  → api.createSale(payload)
  → POST /api/sales
      → verificationService.verifyPOSBill()  [pre-check, 400 on failure]
      → BEGIN IMMEDIATE TRANSACTION
      → resolve/create customer
      → calculateSalesGstAndTotals()
      → generateInvoiceNo()  → "S-2026-0842"
      → INSERT sales_invoices
      → for each item:
           resolve medicine + batch (earliest expiry)
           STRICT STOCK CHECK → throw & rollback whole sale if insufficient
           reject if expired
           INSERT sale_items
           applyStockDelta()  → UPDATE inventory_master
      → COMMIT
      → inventoryCache.invalidate()
      → [optional] WhatsApp invoice send
  ← JSON { invoice_no, id, total, ... }
  → POS clears the cart tab, shows invoice/print dialog
  → invalidateAfterStockWrite(queryClient)  → busts every page's stock-dependent cache
```

**Why this design**: FEFO ranking happens client-side purely for display speed (no round-trip per keystroke while browsing batches), but the transaction that actually moves stock is 100% server-authoritative — this is deliberate defense-in-depth so a stale client-side cache (which, given the module-level caching pattern used app-wide, absolutely can go stale while a page sits mounted under `KeepAliveOutlet`) can never cause an oversell. Multi-tab cart persistence to `localStorage` exists because a real pharmacy counter gets interrupted constantly (a phone call, a second customer walking in) — losing an in-progress cart on an accidental refresh would be a serious usability failure.

**OSS alternative notes**: the barcode/camera scanning path (`AICamera`) — if it's using a heavier custom vision pipeline, `@zxing/library` (pure JS, battle-tested, supports most 1D/2D formats) or `quagga2` are lighter, purpose-built barcode-only alternatives worth comparing against if `AICamera`'s scope is closer to "read a barcode" than "understand an arbitrary photo."

### 2.2 Sells (`frontend/src/pages/Sells/index.tsx`, 1360 lines)

**Purpose**: Sales/invoice history and management — list, search/filter, edit, delete, print, and barcode past invoices. This is where mistakes made at POS get corrected after the fact.

**Features**: date-range filter (`DateRangeFilter` + `usePersistedDateRange`, persisted under the `sells-date-range` storage key so the chosen range survives navigation), infinite-scroll virtualized table, column filters (invoice no, patient name, doctor name, minimum amount), the shared `UniversalMedicineEditModal` for correcting line items, CSV/PDF export, per-invoice barcode/QR generation.

**Endpoints**: `GET /api/sales/list` (paginated/filterable), `GET /api/sales/:id`, `PUT /api/sales/:id`, `DELETE /api/sales/:id`, `GET /api/sales/invoice-barcode`, plus `GET /api/inventory/medicines/:id/enriched` and `GET /api/medicines/compact` for supporting lookups.

**Backend — `PUT /api/sales/:id` (edit an existing invoice, ~lines 1856-1922)**: this is more involved than a simple update because stock already moved when the sale was first created.
1. If the item list changed, the route first **reverses every old line item's stock impact** — calls `applyStockDelta()` with a *positive* delta for each original `sale_items` row, effectively "un-selling" the whole invoice back into `inventory_master`.
2. Re-validates the *new* item list against current stock (the same strict insufficient-stock check as a fresh sale) — so you cannot edit an invoice into a state that oversells current inventory, even though the "old" stock was just restored.
3. Re-checks expiry on the new items.
4. Deletes/re-inserts `sale_items` to match the new list, applies the new deltas (decrementing again).

**Backend — `DELETE /api/sales/:id`** (~lines 1947-1995): fetches every `sale_items` row for the invoice, restores stock for each via `applyStockDelta()` (positive delta), then deletes the items and the invoice itself. The response explicitly confirms "stock restored, credit balance updated" — deleting a sale is designed to be fully reversible from an inventory standpoint.

**Data flow (edit an invoice's quantity)**: row → edit modal → `api.updateSale(id, data)` → `PUT /api/sales/:id` → reverse old deltas → validate new quantities against live stock → apply new deltas → commit → UI refetches the list and invalidates the relevant React Query keys.

**Architecture note**: uses `useInfiniteScroll` (cursor/page-based) layered with *client-side* column filters on top of *server-side* date/search filters — a hybrid filtering strategy, presumably because full server-side filtering on every column would mean a request per keystroke across several filter fields simultaneously, while the coarse server-side date/search narrows the working set enough that per-column refinement can happen client-side on the already-fetched page.

### 2.3 PhoneSales (`frontend/src/pages/PhoneSales/index.tsx`, 838 lines)

**Purpose**: An approval queue for orders taken over the phone — a customer calls in an order, staff stages it, and a pharmacist reviews/approves before it becomes a real invoice. This exists as a distinct workflow from POS because a phone order is inherently provisional (items/quantities might need adjustment once someone actually checks the shelf).

**Features**: status filter (all/pending/approved/rejected), item editing before approval, search box. `StagedSale`/`StagedSaleItem` are typed models with `items_json` stored as a JSON string and parsed client-side into `items`.

**The critical design detail**: **staging a phone sale does *not* reserve stock.** `POST /sales/staged` (line 1712) just writes a staging record — it does not touch `inventory_master` at all. The real stock check and decrement only happens at approval time:

**Backend — `POST /sales/staged/:id/approve`** (line 2165, item loop ~2082-2129): re-runs the *identical* insufficient-stock check pattern used everywhere else in `sales.ts` (with an error message specifically referencing "device sync" in this code path, suggesting it's shared with a mobile/device-sync approval flow too), then converts the staged record into real `sales_invoices` + `sale_items` rows and applies `applyStockDelta()`.

`POST /sales/staged/:id/reject` (line 2277) simply marks the record rejected — no stock impact, since none was ever reserved.

**Data flow (pharmacist approves a phone order)**: PhoneSales list → click Approve → `api.approveStagedSale(id, data)` → `POST /api/sales/staged/:id/approve` → same strict stock/expiry checks as POS checkout → insert invoice + items, decrement stock → response → UI flips the staged sale's status and removes it from the pending list.

**Architecture note — an intentional race condition, handled correctly**: because stock isn't reserved at staging time, two staged phone orders for the last unit of something can *both* look approvable in the UI simultaneously. Whichever gets approved first succeeds; the second fails the stock check at its own approval attempt (server-side, transactionally) rather than silently overselling. This is the right tradeoff — reserving stock at staging time would mean a phone order that's never approved (customer changed their mind) permanently locks up inventory until someone remembers to reject it.

### 2.4 Returns (`frontend/src/pages/Returns/index.tsx`, 1646 lines)

**Purpose**: The supplier/distributor-side returns hub — expired or damaged stock being sent *back* to the distributor it was purchased from. This page is structurally a container: it also embeds the CustomerReturn and CustomerReturnHistory pages as sub-tabs (`import CustomerReturn from '../CustomerReturn'`), plus an Expiry sub-view, so `/returns?tab=...` is a single URL surface for four related workflows.

**Features**: barcode/AI-camera item capture for building a return (reusing the same `AICamera` component as POS), a near-expiry view grouped by distributor (to help decide *which* distributor to send a claim to), missing-item resolution, PDF export of distributor claims, purchase lookup by medicine name/batch to attach the original invoice reference to a return.

**Backend — `POST /api/returns/process-returns`** (lines 293-381, the main workflow this UI drives):
1. Validates the items array is non-empty.
2. `BEGIN TRANSACTION`.
3. Generates a sequential `PR-###` return number (scans `returns.return_no`).
4. Groups everything under **one** master `returns` row (`type='purchase'`, `return_sub_type='expiry'`), linking `distributor_id` and, if resolvable, the `original_invoice_id` (matched via `purchases.invoice_no`).
5. If a distributor is known, calls `creditNoteService.trackExpiryReturn(db, returnId, distributorId, totalAmount, 3.0)` — logs an *expected* 3% credit-note claim against that distributor (a business assumption baked into the code: distributors typically credit 3% for expiry returns, though the actual negotiated/received credit is presumably reconciled elsewhere).
6. **Per item**: inserts a `return_items` row; finds the matching `inventory_master` row by `medicine_id + batch_no`; **directly decrements `inventory_master.quantity`** via `Math.max(0, quantity - item.quantity)`.
7. `COMMIT`, `inventoryCache.invalidate()`.

**⚠️ Flagged inconsistency**: step 6's stock decrement is **quantity-only** — it does not call `applyStockDelta()` and does not touch `loose_quantity` at all. Every sales-side stock mutation in this audit goes through the fungible pack+loose pool math in `applyStockDelta()`; this route quietly does its own thing. In practice this mostly works because a supplier return is usually whole-strip quantities, not partial loose units — but it means the two code paths (sales vs. purchase-returns) can, in principle, diverge on edge cases involving loose stock, and any future feature that needs "return N loose units to a distributor" would hit this gap immediately.

**Data flow (submit an expired-stock return to a distributor)**: scan/select expired batches in Returns UI → build an items array (`medicine_id`, `batch_no`, `quantity`, `cost_price`) → `api.processReturns(items)` → `POST /api/returns/process-returns` → transaction inserts `returns`+`return_items`, decrements `inventory_master.quantity`, logs a distributor credit-note expectation → commit → cache invalidated → success screen, PDF export offered via `exportReturnsPDF`.

### 2.5 CustomerReturn (`frontend/src/pages/CustomerReturn/index.tsx`, 320 lines)

**Purpose**: The counterpart to Sells from the customer's side — a customer brings back medicine they bought, and staff process a refund/exchange against the *specific original sale invoice* (not a generic "return this item" flow — it's always tied to what was actually sold).

**Features**: invoice-number search or barcode scan (`cleanInvoiceNoString` strips the `|`-delimited payload a scanned barcode produces down to the plain invoice number), per-item return-quantity entry that's aware of `returned_qty` already processed against that invoice, a reason field, and barcode/QR/print for the resulting return receipt.

**Backend — `GET /customer-returns/search-invoice`** (lines 9-49): looks up `sales_invoices` by invoice number, joins `sale_items` → `inventory_master` → `medicines` to reconstruct the line items, and **separately aggregates `previousReturns`** — the sum of prior `return_items.quantity` already returned against that invoice (`returns.type='sale'`) — specifically to prevent a second over-return against the same invoice.

**Backend — `POST /customer-returns`** (lines 52-183, "Process Customer Return"):
1. Wrapped entirely in `dbManager.transaction(...)`.
2. Generates a `CR-<year>-####` return number.
3. **Per return item**: looks up `inventory_master` → `medicines` for the applicable GST rate (defaulting to 2.5%/2.5% CGST/SGST if the medicine record has no rate set), computes the discounted line-item gross and **back-calculates CGST/SGST from that gross** (a tax-inclusive reversal — since the original sale price already included tax, refunding it correctly means extracting the tax component rather than adding it again), accumulates running totals.
4. Inserts one `returns` row (`type='sale'`, `return_sub_type='good'`).
5. **Per item, the critical guard**: re-fetches the *original* `sale_items.quantity` for that invoice+inventory_id (throws `Item was not sold in this invoice` if no match exists — you cannot return something that was never on the bill); re-sums previously-returned quantity for that same line; **rejects with `Cannot return more than originally sold` if `item.quantity + prevQty > saleItem.quantity`**. Only after passing this guard does it `UPDATE inventory_master SET quantity = quantity + ?` (again — **quantity-only, not `loose_quantity`**, the same divergence from `applyStockDelta()` noted in Returns above) and insert the `return_items` row, plus an optional `action_logs` entry.
6. `inventoryCache.invalidate()` after commit.

**Data flow (customer returns 2 strips against an invoice)**: staff enters/scans the invoice number → `api.searchInvoiceForReturn` → `GET /customer-returns/search-invoice` returns the invoice, its items, and prior-returns totals → staff sets return quantities per item → `api.createCustomerReturn(payload)` → `POST /api/customer-returns` → transaction validates against original-sold-quantity minus already-returned, computes the tax-inclusive refund, writes `returns`/`return_items`, restores `inventory_master.quantity` → commit → cache invalidated → UI shows the refund total and return number, offers barcode/print, calls `invalidateAfterStockWrite`.

**Why the over-return guard matters**: this is the same "never fabricate stock or money out of nowhere" philosophy applied in reverse — just as a sale can never exceed available stock, a return can never exceed what was actually, verifiably sold on that specific invoice, checked server-side rather than trusted from the client.

### 2.6 CustomerReturnHistory (`frontend/src/pages/CustomerReturnHistory/index.tsx`, 263 lines)

**Purpose**: A read-only, searchable, paginated audit trail of every processed customer return — the "prove what happened" lookup page, separate from CustomerReturn's action-taking page.

**Features**: `useInfiniteScroll` (query key `customer-returns-history-list`, cache key `customer-returns-history-cache`), persisted date range (`customer-returns-date-range` storage key), free-text search, CSV/PDF export, fully virtualized rows (`useVirtualizer` + `InfiniteTable`/`VirtualRow` — the same table primitives used on Inventory/Investigation/Sells).

**Backend — `GET /api/customer-returns/history`** (lines 186-277): filters by date range (`date(r.date,'localtime') BETWEEN ...`) and a free-text `search` matched across `return_no`, the joined `sales_invoices.invoice_no`, the `reason` field, and medicine name (via an `EXISTS` subquery against `return_items`/`medicines`). The endpoint supports **two response shapes depending on whether a `page` query param is present**: paginated (`{data, totalItems, totalPages, currentPage}`) or a flat array for simple-limit callers. For each return row, the route separately fetches its `return_items` in a per-row loop — **an N+1 query pattern**.

**Performance note**: at the default page size this N+1 pattern is invisible, but it's the one clearly identifiable query-efficiency issue in this cluster — worth batching into a single `WHERE return_id IN (...)` query if return volume or page size grows significantly.

**Data flow**: search text or date range change → `useInfiniteScroll` triggers `api.getCustomerReturnsHistory({page, limit:50, search, start, end})` → filtered/paginated query plus the per-row items fetch → JSON response → infinite-scroll hook appends the page to the virtualized table → scrolling near the bottom triggers the next page fetch via an intersection-observer sentinel.

---

## 3. Inventory & Procurement

### 3.0 Schema grounding for this cluster

Before the pages themselves, the two tables everything here revolves around:

- **`medicines`** (master catalog — the "what medicines exist" table): `id, name, api_reference, mrp, hsn_code, schedule_type, manufacturer, category, marketed_by, legacy_id, packaging, item_type, cgst_per, sgst_per, igst_per, rack, therapeutic, sub_therapeutic, short_code, ucode, disable_auto_barcode, tb_medicine, source, possible_duplicate_of, sell_price`. Critically, **`pack_unit` (TEXT) and `pack_size` (INTEGER) were both added later via `ALTER TABLE` migrations** (around lines 711 and 815 of `src/database.ts`) — they are not part of the original schema. `pack_unit` is a free-text dosage-form label ("Tablet", "Capsule", "Syrup"); `pack_size` is a numeric "units per strip" **derived** from the free-text `packaging` field via `src/utils/packaging.ts::parsePackSizeFromPackaging()`. That parser explicitly guards against misreading weight/volume packaging strings ("200 ML", "50 G") as a unit count — a comment in the code states "Weight/volume units are not a per-strip count and must not be parsed as one," which is a scar from a prior real bug (see project memory: *pack_size field fix*). `pack_size` gets written from three different places — Inventory's quick-edit (auto-derived from `packaging` via the parser), a manual override on `PUT /inventory/:id`, and new-medicine auto-creation inside Purchases' `/manual` endpoint (which writes it **straight from client payload, bypassing the parser** — a latent inconsistency worth closing).
- **`inventory_master`** (physical stock per batch — the "what's actually on the shelf" table): `id, medicine_id, quantity` (whole packs/strips), `loose_quantity` (loose units below a full strip), `rack_location, batch_no, expiry_date, is_active`. Indexed on `medicine_id`, `batch_no`, and two composite indexes — `(quantity, expiry_date, medicine_id)` and `(medicine_id, quantity, expiry_date)` — specifically to keep the Inventory/Expiry/POS filtered-search queries fast at scale.

### 3.1 Inventory (`frontend/src/pages/Inventory/index.tsx`)

**Purpose**: The live, searchable read/edit view of current physical stock, per batch. This is distinct from **Database** (the master catalog, independent of stock) and **Purchases** (where stock first enters the system) — Inventory is "what do I have right now."

**Full feature list**:
- Virtualized infinite-scroll table (`useInfiniteScroll` + `useVirtualizer`/`InfiniteTable`/`VirtualRow`) over `inventory_master`, 150 rows per page.
- Per-column debounced search filters — medicine name, ID, batch, expiry, pack count, loose count, MRP, rack — each with its own 300ms debounce before hitting the server, so typing across multiple filter boxes doesn't spam requests.
- Stock-status filter dropdown: **All / In Stock (`>0`) / Zero Stock / Negative Stock**. Negative stock showing up as a distinct, filterable state is itself telling — it implies the app has, at some point, produced negative inventory (likely from a bug now presumably fixed, or from a still-possible edge case), and rather than hiding that, the UI surfaces it explicitly so staff can find and correct it.
- Column visibility toggle, persisted to `localStorage` under `inv-page-cols`.
- CSV/PDF export.
- Row click opens a slide-in details drawer (rendered via a portal) showing stock qty, MRP, loose qty, rack, batch, expiry, all inline-editable, **plus an OpenFDA-sourced "Medical Profile" enrichment panel** — active ingredients, indications, warnings, adverse reactions — fetched and cached server-side per medicine name.
- "Universal Edit" button lazy-loads the shared `UniversalMedicineEditModal` for edits that reach beyond this one inventory row into the parent `medicines` record.
- **Cross-references pending special orders**: badges a row with "⚠ N req" if a customer has an open special order matching that medicine by name — a small but meaningful integration that surfaces demand signal directly on the stock screen (see §9.6 for the shared `special_orders` table).

**Complete API map**:

| Function | Endpoint | Purpose |
|---|---|---|
| `getInventory(...)` | `GET /api/inventory` | Paginated, filtered stock list |
| `getEnrichedMedicine(id)` | `GET /api/inventory/medicines/:id/enriched` | OpenFDA panel data |
| `updateMedicine(id, data)` | `PUT /api/inventory/:id` | Save an edit from the drawer |
| `getOrders()` | (special orders route) | Badge cross-reference |

**Backend — `GET /api/inventory`**: builds a dynamic `WHERE` clause over `inventory_master im LEFT JOIN medicines m`, with per-column LIKE/`=` filters and the `stock_filter` logic: `zero` → `quantity=0 AND loose_quantity=0`; `negative` → `quantity<0 OR loose_quantity<0`; `positive` → `is_active=1 AND (quantity>0 OR loose_quantity>0)`. Two distinct code paths: `limit=0` returns everything unpaginated (used for exports/full-catalog client caches), otherwise it runs a `COUNT(*)` plus a `LIMIT/OFFSET` query, ordered by medicine name.

**Backend — `PUT /api/inventory/:id`** — a transactional **3-step sync**, because a single inventory row's data is logically shared across three tables:
1. Updates `inventory_master` itself (quantity, rack_location, batch_no, expiry_date, reorder_level, mrp, loose_quantity).
2. **Mirrors** batch/expiry/MRP changes into any matching `purchase_items` rows (matched by `medicine_id + batch_no`) — so if you correct a batch's expiry date here, the original purchase record reflects the same correction rather than silently diverging.
3. If name/MRP/pack_size/sell_price changed, **also** updates the parent `medicines` row (note: here `pack_size` is parsed via plain `parseInt`, not through `parsePackSizeFromPackaging()` — a second inconsistent write path for the same field).
4. Calls `inventoryService.checkAndTriggerRefillsForMedicine()` — an inventory edit can retroactively trigger refill-due logic (e.g. if stock just came back in for a medicine that had refills paused for lack of stock).
5. Invalidates `inventoryCache` on commit.

Other endpoints in `inventory.ts` referenced by other pages in this cluster: `/override` (manual stock override, mandatory `reason` field, logged to `action_logs`), `/peek/:medicine_id`, `/bulk-sell-prices` (used by SellPriceConfig, §3.7), `/catalog-search` (multi-pass prefix→contains→secondary-field search, used by Purchases' medicine picker), `/batch-info`, `/medicines/:id/quick-edit` (the 26-field "Universal Edit" GET/PUT), `/barcode/:id` (QR generation), `/therapeutic-search`, `/sync` (bulk remote stock override).

**Data flow (row click → view enrichment → save an edit)**:
```
User clicks a virtualized row
  → api.getEnrichedMedicine(item.id) → GET /inventory/medicines/:id/enriched
      → route reads medicines.name → cacheService.get(name) → OpenFDA JSON (or static fallback if uncached)
  → drawer renders stock fields + Medical Profile panel
User edits MRP, clicks Save
  → api.updateMedicine(id, editForm) → PUT /inventory/:id
      → transactional 3-way sync (inventory_master / purchase_items / medicines)
      → inventoryCache.invalidate()
  → loadInventory() refetch + queryClient.invalidateQueries(['inventory-list'])
```

**Why two caches get invalidated on every write**: the server-side `inventoryCache` (`src/services/inventoryCache.ts`) is a backend-level cache consumed by *other* routes (POS's compact-inventory lookups, for instance) — invalidating it server-side is necessary so the next request from *any* client sees fresh data. The client-side React Query `inventory-list` invalidation is separate and only affects this browser session's UI. Both are needed because they cache at different layers.

### 3.2 Purchases (`frontend/src/pages/Purchases/index.tsx`, 3430 lines)

**Purpose**: Manual and AI/OCR-assisted purchase bill (GRN — Goods Receipt Note) entry. This is the primary door through which stock and cost data enter the system — everything downstream (Inventory, POS, Reports) depends on what gets entered here being correct.

**Full feature list**:
- **Multi-tab draft-invoice editor**, persisted to `localStorage` (`purchase_tabs` / `purchase_active_tab_id`) — a pharmacist can start entering one distributor's invoice, get interrupted, switch to another, and come back without losing either draft.
- **Two-tier medicine search**: an instant in-memory filter (`filterLocalCatalog`, prefix-then-infix match, capped at 30 results) against a pre-hydrated master-catalog snapshot for near-zero-latency typing feedback, **layered with** a debounced (120ms) server call (`api.catalogSearch`) that merges in server results and patches live stock/loose-quantity numbers from `getCompactInventoryCache()`. This two-tier approach is a deliberate perceived-speed optimization: the user sees *something* update instantly on every keystroke even though the authoritative/complete result needs a round trip.
- **Auto-fill on medicine selection**: pulls the last purchase's batch/rate/MRP/GST for that medicine (`api.getLastPurchase`) so re-ordering the same item doesn't mean re-typing everything; **auto-creates a name-correction alias** (`api.createMedicineAlias`) if the user typed a name that didn't exactly match what the search resolved to — this is one of the mechanisms that feeds the app's "learned" name-matching over time.
- Distributor CRUD modal, inline new-medicine creation modal, price-history modal, barcode generation (both per-item and whole-bill), a Pharmarack-distributor-mapping filter (to flag which distributors on this bill are also known Pharmarack B2B distributors).
- **Keyboard-driven workflow**: Ctrl+S save, Alt+A add item, F8/Alt+E open Universal Medicine Edit for the focused row, Esc closes all modals — clearly optimized for a power user entering many bills per day without reaching for the mouse.
- **File upload (OCR/Excel) path** (`/purchases/upload`) — auto-resolves item names against previously-learned distributor column mappings and catalog search, reducing (though not eliminating) manual entry for distributors whose invoice layout the system has seen before.
- GST/discount math is computed **twice** — client-side (`calculateItemAmount`) for instant visual feedback as numbers are typed, and again authoritatively server-side, which never trusts the client's arithmetic.

**Complete API map**:

| Function | Endpoint |
|---|---|
| `getDistributors` | `GET /api/distributors` |
| `getPurchases` | `GET /api/purchases` |
| `getPendingReturns` | `GET /api/distributors/:id/pending-returns` |
| `getPharmarackDistributorMappings` | `GET /api/pharmarack/distributor-mappings` |
| `getManufacturers` / `getMarketedBy` | `GET /api/manufacturers`, `GET /api/marketed-by` |
| `getEnrichedMedicine` | `GET /api/inventory/medicines/:id/enriched` |
| `catalogSearch` | `GET /api/inventory/catalog-search` |
| `createMedicineAlias` | `POST /api/inventory/medicines/alias` |
| `getLearnedMapping` | `GET /api/learning/mapping` |
| `getBatchInfo` | `GET /api/inventory/batch-info` |
| `updatePurchase` | `PUT /api/purchases/:id/full` |
| `createManualPurchase` | `POST /api/purchases/manual` |
| `getCompactInventory` | (refresh the POS cache after saving) |
| `generateMedicineBarcodes` / `generateBillBarcode` | `POST/GET /api/utilities/barcode...` |

**Backend — `POST /purchases/manual` step by step** (the core "save bill" endpoint, called `createManualPurchase` on the frontend):
1. Resolves or creates the `distributors` row.
2. **Blocks duplicate `(distributor_id, invoice_no)` pairs** — you cannot accidentally enter the same distributor invoice twice.
3. **Recomputes subtotal/CGST/SGST/discount entirely server-side** — the client's numbers are display-only, never trusted, an explicit anti-tampering measure (and also a correctness measure, since floating-point client math shouldn't be the system of record for money).
4. Generates the sequential `app_invoice_no` (`P-###`, the pharmacy's own internal purchase-numbering scheme, distinct from the distributor's own invoice number).
5. Inserts the `purchases` row.
6. If this purchase is meant to reconcile against an outstanding `expiry_returns_tracking` credit note, does that reconciliation.
7. **Per item**:
   - Upserts into the master catalog via `masterMedicinesSeedService.upsertMasterMedicine`.
   - Resolves the medicine through `medicineService.resolveMedicineNameMultiTier()` — a fallback chain: exact match → alias table → fuzzy match → OCR-correction-table lookup.
   - **If nothing resolves, auto-creates a new `medicines` row** — writing `pack_unit`/`pack_size` directly from the client payload (bypassing `parsePackSizeFromPackaging()`, the same latent inconsistency flagged above).
   - Inserts `purchase_items`.
   - Upserts `inventory_master` by `medicine_id + batch_no` (`totalQty = qty + free_qty` — free/bonus units from the distributor are added straight into saleable stock).
   - Syncs `medicines.mrp/rate/cgst/sgst` from this purchase (the latest purchase's pricing becomes the medicine's current reference pricing).
   - Learns the name-correction mapping for future OCR/search matching.
8. Responds immediately to the client, then does background work in `setImmediate` — refill checks, overlap detection, distributor-learning-profile saves — so the UI doesn't wait on non-critical follow-up work.

**Why item resolution never blocks the purchase**: the layered fallback (multi-tier match → alias → OCR-correction → auto-create) means a pharmacist entering a bill is **never stopped mid-entry** by an unrecognized medicine name — worst case, a new catalog entry gets silently created. The tradeoff, explicitly worth flagging: sloppy/inconsistent naming at entry time can pollute the master catalog with near-duplicate medicines, which is presumably part of why Database (§3.5) and CatalogUpload (§4.4) both have dedicated duplicate-detection/merge tooling — this system expects catalog drift and builds cleanup tooling for it rather than trying to prevent it at the point of entry.

**Data flow (save a purchase bill)**:
```
User fills bill (distributor, items, GST) across a tab
  → Ctrl+S / Save button
  → savePurchase(): client validates distributor+items present
  → api.createManualPurchase(payload) → POST /purchases/manual
      → server recalculates all totals (ignores client math)
      → generates app_invoice_no ("P-1044")
      → per item: resolveMedicineNameMultiTier() → alias → OCR-correction → auto-create if needed
      → INSERT purchase_items, UPSERT inventory_master
      → sync medicines.mrp/rate/cgst/sgst
  ← JSON { saved_items: [{medicine_id, rate, mrp, sell_price}, ...] }
  → barcode modal shown
  → invalidateAfterStockWrite(queryClient)
  → tab cleared
  → navigate('/sell-price-config', { state: { saved_items, invoiceNo } })   ← hands off directly to §3.7
```

### 3.3 PurchaseHistory (`frontend/src/pages/PurchaseHistory/index.tsx`, 1023 lines)

**Purpose**: Browse, search, edit, and delete past purchase invoices; also the home of the **email-based purchase-reconciliation review** — matching incoming distributor emails (synced on the Mail page, §5.2) to purchase records that may or may not have been entered yet.

**Features**: the same virtualized infinite-scroll pattern as Inventory, a 15-day default date range (persisted), per-column filters (ID, distributor, invoice no, date, min/max amount), CSV/PDF export, a reconciliation panel (pending distributor emails needing manual purchase matching, with preview and resolve actions), an edit-in-Purchases handoff, and delete.

**API map**: `getPurchases({...})` → `GET /api/purchases`; `getReconciliationList` → `GET /api/purchases/reconciliation`; `getReconciliationPreview(uid)` → `GET /api/purchases/reconciliation/preview/:email_uid`; `resolveOrderManually(uid)` → `POST /api/purchases/reconciliation/resolve`; `getPurchase(id)` → `GET /api/purchases/:id`; `deletePurchase(id)` → `DELETE /api/purchases/:id`.

**Data flow (edit a purchase)**: row click → `api.getPurchase(id)` → `GET /purchases/:id` returns the full invoice with items → the row's Edit action **navigates to `/purchases`** with `state.prefilledPurchase` (including `editPurchaseId`) → Purchases' own `useEffect` watching `location.state.prefilledPurchase` repopulates the tab form → user edits and saves → `api.updatePurchase(editPurchaseId, payload)` → `PUT /purchases/:id/full` → same barcode/sell-price-config redirect chain as a fresh manual purchase.

### 3.4 Expiry (`frontend/src/pages/Expiry/index.tsx`)

**Purpose**: The near-expiry / already-expired stock monitor — the screen that drives "return this to the distributor before it's a total loss" decisions.

**Features**: date-range picker defaulting to **1 year back through 90 days forward** (deliberately wide — it catches both already-expired stock that still needs processing and stock approaching expiry soon enough to act on), search plus multiple column filters (ID, medicine name, batch, date, quantity range, MRP range, storage location), checkbox multi-select feeding a **"Send to Returns"** action (navigates to `/returns` with `prefilledReturnItems` — see §9.1), CSV/PDF export, a WhatsApp alert dispatch (send a digest to a phone number), and color-coded expiry-urgency badges.

**Architecture — a month-sharded JSON file cache, not a live query**: `GET /api/expiry` is the one clearly unusual design in this cluster. Instead of always querying SQL, it:
1. Computes which `YYYY_MM` month-buckets the requested date range spans.
2. If the cache directory `data/cache/expiry/` or the relevant `expiry_*.json` files are missing, it falls back to a **live SQL query** (joining `inventory_master` → `medicines` → the latest `purchase_items` → `purchases` → `distributors`, filtered to `is_active=1 AND quantity>0` and expiry within range) and **asynchronously triggers `expiryAlertService.rebuildAllExpiryCaches()`** so the cache is warm next time.
3. If cache files exist, it just reads and concatenates the relevant month-JSON files and filters in-memory.

**The subtle, correctness-critical contract**: **a missing month-file is treated as "zero expiring items that month," not as a cache miss requiring a rebuild.** This is stated explicitly in code comments. It means any write path that introduces new expiring stock *must* remember to trigger a cache rebuild (either the full rebuild or the debounced per-item rebuild, `triggerExpiryCacheRebuildDebounced`) or that stock becomes **invisible on this page** without any error — a silent-omission failure mode rather than a loud one.

**Other endpoints**: `GET /expiry/export` (same cache-or-live dual path, formatted via `reportExporter.ts`), `POST /expiry/send-alerts` (queries the 10 soonest-expiring active-stock rows, builds a WhatsApp digest, sends to the passed `phone` or the `owner_phone` setting), `POST /expiry/create-return` (converts a near-expiry row directly into a purchase return — finds the matching `purchase_items` row, generates a `PR-###`, inserts `returns`+`return_items`, decrements `inventory_master.quantity`, and if a distributor is known, calls `creditNoteService.trackExpiryReturn` for the same 3%-credit-note-expectation logic seen in the main Returns page — then triggers the debounced cache rebuild).

**Why a hand-rolled JSON cache instead of just querying SQLite directly**: this looks like a targeted performance fix for a screen that's presumably hit often and whose underlying query (joining across four tables with date-range filtering) got expensive enough at real data volumes to need pre-computation. It trades write-side complexity (every stock-mutating code path near expiry logic now needs to remember to invalidate/rebuild) for very fast reads.

**OSS alternative**: this is functionally a hand-rolled materialized view. A `CREATE TABLE expiry_summary` with `AFTER INSERT/UPDATE/DELETE` triggers on `inventory_master` would give the same fast-read property while keeping the source of truth entirely inside SQLite (no filesystem JSON files to go stale or get out of sync with the DB), and would eliminate the "missing file = empty" footgun entirely since SQL triggers can't silently "forget" to fire the way an application-code call site can forget to invoke a rebuild function.

### 3.5 Database (`frontend/src/pages/Database/index.tsx`, 1238 lines)

**Purpose**: Master medicine-catalog management — the `medicines` table itself, independent of any physical stock. Add/edit/delete catalog entries, seed or resync the reference dataset (200,000+ items), and manage duplicate entries.

**Features**: tab-based (`?tab=`) view, search/filter by product name, MRP, API/salt reference, packaging, and distributor (joined through `purchase_items`), an A-Z letter-jump, sortable columns, bulk-select ("select all across pages"), bulk delete, single/bulk add-medicine modal, manufacturer/marketed-by typeahead, a "Seed Master Catalog" action (loads the full reference dataset), a "Sync Inventory → Master" action (backfills catalog entries from live inventory that somehow lack one), an "Unlock Database" utility (presumably clears a stuck write-lock state), price-history lookup per medicine, and embeds both the `CatalogUpload` component and `UniversalMedicineEditModal`.

**Backend — `GET /api/medicines`**: uses a CTE (`target_medicines`) for pagination, **left-joined against a window-function subquery** — `ROW_NUMBER() OVER (PARTITION BY medicine_id ORDER BY p.date DESC)` — to surface each medicine's `last_purchase_rate`, `last_purchase_mrp`, and `last_distributor_name` **without touching `inventory_master` at all**. This is a nice piece of SQL: it answers "what did I last pay for this medicine" purely from purchase history, decoupled from current stock levels (a medicine can be out of stock and still have a meaningful last-purchase-price on this screen). Search supports multi-token AND matching across name/manufacturer/api_reference for multi-word queries, and prefix+contains matching across name/item_code/manufacturer/api_reference for single-token queries.

**Data flow (search and edit)**: user types in the Product Name filter → debounced → `api.getMedicines(...)` → `GET /medicines?productName=...` → the CTE+window-function query → paginated JSON → table renders. Clicking Edit opens `UniversalMedicineEditModal`, which PUTs to **`inventory.ts`'s** `/medicines/:id/quick-edit` (not a `medicines.ts` route — the "edit everything about a medicine" surface lives with Inventory's route file even though it's launched from Database, Purchases, Sells, and POS alike; see §9.5 for why this shared-modal pattern matters).

### 3.6 Migration (`frontend/src/pages/Migration/index.tsx` + `components/ColumnMapper`, `ErrorRows`, `LocalBackupPanel`, `ModuleSection`, `RedBookUploader`, `ReviewModal`)

**Purpose**: Bulk data import from legacy pharmacy software (Excel/CSV exports) or from a local `.db` backup file — with a **staged review-before-commit workflow** so an import can never corrupt the live database, no matter how messy the source data is.

**Features**: file upload → column-mapping UI → preview/analyze before committing; `ReviewModal` shows a staging summary (row counts per table) and flags conflicts (duplicate invoice numbers, ambiguous medicine matches) for one-by-one resolution before finalizing or rolling back; `LocalBackupPanel` lists discoverable local `.db` backup files and can run a full-database migration directly from one; live migration-status polling throughout.

**Complete API map**: `uploadMigrationFile` (multipart upload), `preMigrationAnalyze`/`analyzeMigrationFile` → `POST /migration/pre-migration-analyze`, `getStagingSummary` → `GET /migration/staging/summary`, `getStagingConflicts` → `GET /migration/staging/conflicts`, `runMigration` → `POST /migration/run`, `resolveStagingConflict` → `POST /migration/staging/resolve`, `rollbackMigration` → `DELETE /migration/staging/rollback`, `finalizeMigration` → `POST /migration/staging/finalize`, `getMigrationStatus` → `GET /migration/status`, `getLocalBackups` → `GET /migration/local-backups`, `runLocalBackupMigration` → `POST /migration/run-local-backup`.

**Backend (`src/routes/migration.ts`, 1142 lines) — the staging model**:
- `POST /run` — logs to `action_logs`, then runs the actual import **in the background** (fire-and-forget; the HTTP response returns immediately with "started") into a **completely separate staging SQLite file** (`STAGING_DB_PATH`) — the live `app.db` is never touched at this stage.
- `GET /staging/inventory|sales|purchases|returns|errors` — read-only browsing of the staged import, each querying the staging DB's own copies of the relevant tables.
- `DELETE /staging/rollback` — deletes the staging DB file outright and resets in-memory migration status. Rollback is total and trivial precisely because nothing in the live DB was ever touched.
- `GET /staging/summary`, `/staging/conflicts`, `POST /staging/resolve` — the pre-commit review surface that `ReviewModal` drives.

**`POST /staging/finalize` — the 11-step cutover** (the single most operationally risky endpoint in the whole app, and it's engineered accordingly):
1. `rebuildMigrationInventoryStock(stagingDb)` — final stock reconciliation on the staging copy before anything touches the live system.
2. Optionally regenerates all sales invoice numbers sequentially (if the source data's numbering was inconsistent).
3. Checkpoints the staging DB's WAL (`wal_checkpoint(TRUNCATE)`) and sets `journal_mode=DELETE`.
4. Runs `PRAGMA integrity_check` against the staging DB.
5. Verifies/repairs `medicines_fts` on the staging copy via `ensureMedicinesFts` — explicitly guarding against the known FTS5 shadow-table corruption failure mode (see project memory: *medicines_fts blocks all inserts*), since a staged DB built from an imported `.db` backup could easily carry a broken FTS index into the live system otherwise.
6. **Fully stops the live `dbManager` connection pool and worker supervisor** — nothing can write to the live DB during the swap.
7. Checkpoints and backs up the live `app.db` to a timestamped `.bak_<ts>` file.
8. **File-copies `staging.db` over `app.db`** — a full-file replacement, not a row-by-row merge.
9. Re-validates integrity of the swapped-in file; **on failure, automatically restores from the backup just made in step 7**.
10. Reopens the live connection pool and re-verifies/rebuilds `medicines_fts` again, now on the live DB.
11. Triggers `stockCalculatorWorker.recalculateStockLimits()` in the background.

**Why a whole-file swap instead of an in-place merge**: legacy-software exports are inherently messy and inconsistent (different schemas, encoding quirks, partial data). Validating and committing an **entire self-consistent database file** — with its own independent integrity check — is safer than interleaving thousands of individual `INSERT`/`UPDATE` statements into the live DB and hoping nothing partially fails midway through (which would leave the live DB in an genuinely ambiguous, hard-to-diagnose state). The explicit backup-then-swap-then-verify-then-auto-restore-on-failure sequence reads as a design shaped directly by a past incident, not a theoretical precaution.

**OSS alternative / heavier-tooling comparison**: this hand-rolled staging+swap approach is a reasonable, SQLite-native way to get transactional-migration guarantees without a dedicated ETL tool. A tool like `pgloader` (if the target were Postgres) gives similar staged-load guarantees out of the box with more configuration and less custom code — not directly applicable here given the SQLite-only architecture, but worth knowing as the "what would a mature ETL tool give us" reference point if migration logic needs to grow further.

### 3.7 SellPriceConfig (`frontend/src/pages/SellPriceConfig/index.tsx`, 284 lines)

**Purpose**: A **post-purchase wizard step**, not a standalone destination — after saving a purchase bill, the pharmacist gets one screen to optionally set a custom "target sell price" per medicine (distinct from MRP), so POS can apply a pre-configured discount automatically instead of always defaulting to MRP.

**Features**: reads `location.state.{invoiceNo, saved_items}` (populated only by Purchases' `savePurchase()` navigate call — see §3.2's data flow) into an editable table (medicine, cost rate, MRP, sell-price input, live-computed discount %). Client-side clamps any sell price above MRP back down to MRP, and shows an amber warning banner if a sell price is set below the cost rate (a margin-protection nudge, not a hard block). "Save All" batches every row into one bulk update; "Skip/Done" just navigates back to `/purchases` without saving anything.

**Backend**: `POST /inventory/bulk-sell-prices` — a transactional loop, `UPDATE medicines SET sell_price = ?` per item (null if blank/invalid), commits once, invalidates `inventoryCache`.

**Architecture note — this page has no GET endpoint at all**: it is hydrated *entirely* from React Router navigation state, never fetched independently. If a user lands here via direct navigation, a page refresh, a bookmark, or the browser back button, `location.state` is empty and the page shows an empty state — there is no way to "reload" this screen's data because the data was never persisted anywhere until the user explicitly saves. This is a legitimate design for a one-shot wizard step (nothing here is meant to be a durable, revisitable view), but it does mean a mid-flow refresh loses the in-progress sell-price entries entirely — worth knowing if that's ever reported as a bug rather than expected behavior.

---

## 4. Distributor Ordering & Dispatch

This cluster is about the *outbound* side of procurement — ordering stock **from** distributors (as opposed to §3's Purchases, which records stock that has already arrived) — plus delivering **to** patients. It's also where the app's WhatsApp automation is most heavily used, so this section ends with a dedicated deep-dive on that shared infrastructure.

### 4.1 Dispatch (`frontend/src/pages/Dispatch/index.tsx`, 886 lines)

**Purpose**: Manages home-delivery orders (deliveries *to patients*, not distributor orders) and the delivery-staff roster; also shows a WhatsApp send-history log of messages sent to delivery boys.

**Full feature list**:
- Stats row: Pending / In Transit / Delivered-Today / Active-Staff counts, computed client-side from the loaded `orders` state.
- **"Delivery Staff Directory"**: inline add-boy form plus a card grid with edit/toggle-active/delete per boy, and a direct `wa.me`/`api.whatsapp.com` link on each card for a quick manual message.
- **"Active Dispatch Queue"** table: full CRUD, with a per-row status `<select>` (Pending / In Transit / Delivered) that updates instantly via `handleStatusChange`.
- **"Send All via WhatsApp"** — batches every Pending/In-Transit order into one enqueue call for stock-collection pickup messages (see §4.5).
- **"Delivery Staff WhatsApp Message History"** — a date-selectable log table reading from the `automation_notifications` table.
- New Dispatch Order modal: patient name/phone/address/items/invoice/assigned boy/notes.
- A second, apparently **orphaned** "Delivery Boys Management" modal exists in the code (`showBoysModal` state) with no visible trigger button in the current render — likely dead UI left over from a refactor where the Delivery Staff Directory section absorbed its functionality.
- Uses module-scoped caches (`getDispatchOrdersCache`/`setDispatchDeliveryBoysCache` from `utils/pageModuleCaches`) for instant re-mount under `KeepAliveOutlet`.

**Complete API map**:

| api.ts function | HTTP | Notes |
|---|---|---|
| `getDispatchOrders()` | `GET /dispatch/orders` | |
| `getDeliveryBoys()` | `GET /dispatch/delivery-boys` | |
| `getDeliveryBoyMessageDates()` | `GET /dispatch/messages/dates` | populates the date picker |
| `getDeliveryBoyMessages(date)` | `GET /dispatch/messages` | |
| `addDeliveryBoy()` | `POST /dispatch/delivery-boys` | upsert-by-name-or-phone (dedupes) |
| `updateDeliveryBoy()` | `PUT /dispatch/delivery-boys/:id` | |
| `deleteDeliveryBoy()` | `DELETE /dispatch/delivery-boys/:id` | |
| `createDispatchOrder()` | `POST /dispatch/orders` | |
| `updateDispatchOrder()` | `PUT /dispatch/orders/:id` | |
| `deleteDispatchOrder()` | `DELETE /dispatch/orders/:id` | |
| `enqueueDistributorCollection()` | `POST /whatsapp/queue/enqueue-distributor-collection` | the "Send All" action |

**Backend behavior (`src/routes/dispatch.ts`, 285 lines)**:
- `GET /orders` — `SELECT d.*, delivery_boy_name FROM dispatch_orders LEFT JOIN delivery_boys`.
- `POST /orders` — inserts into `dispatch_orders`; if an `invoice_no` was supplied, fires `notificationService.notifyDistributorAboutDeliveryBoy(invoice_no)` **in the background** (fire-and-forget — the order save doesn't wait on a notification send).
- `PUT /orders/:id` — partial update; **auto-stamps `delivered_at`** the moment status transitions to `Delivered`; re-fires the same background notification.
- `GET/POST/PUT/DELETE /delivery-boys` — POST upserts by name-or-phone match (prevents accidental duplicate roster entries); every save also **mirrors the phone into `app_settings` keys** `delivery_boy_phone`/`delivery_boy_whatsapp` — a legacy-compatibility shim, since a code comment elsewhere (in PharmarackCart) explicitly notes delivery-boy data is *meant* to come only from the `delivery_boys` table now, implying `app_settings` mirroring is a holdover being phased out rather than the current source of truth.
- `GET /messages/dates`, `GET /messages` — query `automation_notifications` filtered to `type IN ('delivery_boy_dispatch', 'delivery_boy_notification', 'delivery_assignment', 'admin_shortage_reminder', 'dispatch', 'delivery_boy_cart_order', 'delivery_boy_summary', 'distributor_cart_order')`.

**Data flow ("Send All via WhatsApp")**:
```
User clicks "Send All"
  → frontend filters orders to Pending/In-Transit
  → resolves a target delivery-boy phone (state → prompt() fallback if none set)
  → api.enqueueDistributorCollection({orderIds, deliveryBoyPhone, deliveryBoyName})
  → POST /whatsapp/queue/enqueue-distributor-collection
      → fetches full dispatch_orders rows
      → builds one "DISTRIBUTOR STOCK COLLECTION DISPATCH" message per order
      → whatsappQueueWorker.enqueue(phone, msg, 'distributor_collection')  ← queues, does NOT send yet
  → frontend polls GET /dispatch/messages/dates after a 2s delay to refresh the history log
  [separately, the worker's own poll loop later sends each queued message 8-12s apart]
```

### 4.2 PharmarackCart (`frontend/src/pages/PharmarackCart/index.tsx`, 3414 lines — the single largest page in the app)

**Purpose**: The B2B ordering hub for **Pharmarack**, a real third-party distributor marketplace platform. This page manages the pharmacy's **live cart on Pharmarack's own servers** (not a local-only concept), groups cart items by distributor, resolves each distributor's WhatsApp contact, and sends order messages — either through the app's automated queue or a manual one-click fallback.

**Full feature list**:
- Tabs via `?tab=`: cart / sent-history, with a nested `sidebarTab`: all / requests / refills / sales_suggestions / missing_phone / history.
- Distributor filter sub-tabs: active/unsent, sent/success, failed, unmapped, all — each backed by a `useMemo`-derived list (`unsentCartDistributors`, `sentCartDistributors`, `failedDistributors`, `unmappedDistributors`, `activeCartDistributors`).
- Per-distributor card: item list, computed line total, a phone-mapping edit modal (search/create/link either a `distributors` row or a `pharmarack/distributor-mappings` entry), "Send WhatsApp" (single distributor) and delivery-boy-notification buttons.
- **"Send All" batch flow** with a missing-delivery-boy-contact guard modal — if no delivery boy has a phone on file, it prompts to add one inline rather than silently failing or falling back without telling the user.
- **Live WhatsApp queue status polling** every 3.5 seconds (`api.getWhatsAppQueueStatus`) that animates per-distributor badges through queued → sending → success/error, and persists sent-status to `localStorage` (`pharmacart_sent_wa_history`) so the visual state survives a refresh even before the backend history endpoint would confirm it.
- Renders the `NonMappedDistributors` component **inline** (direct import), effectively embedding §4.3 as a nested section rather than requiring separate navigation.
- **Sidebar quick-assist**: pending Special Orders and due Refills, each with **fuzzy-match-to-cart-item detection** (`utils/orderFuzzyMatcher.ts::findBestCartMatchForOrder`) — so if a customer's special order matches something already searchable on Pharmarack, one click adds it to the cart.
- Sent-order history tab: date picker plus "re-add to cart" for reordering a whole day's previously-sent items.
- **`openOrReuseWhatsappTab()` helper**: converts `web.whatsapp.com/send` links to `api.whatsapp.com/send` (a more reliable deep-link variant), reuses a single popup window handle across multiple sends (rather than spawning a new tab every time), and **also dispatches a custom `WHATSAPP_WEB_EXTENSION_SEND` window event/postMessage** — an integration point for an external browser-extension-based send path that exists alongside the backend queue.

**Backend (`src/routes/pharmarack.ts`, 2345 lines — the largest route file in the app)** — key endpoints:
- `GET /search` — live product search against Pharmarack's own search API using a stored session token; results are also cached in-memory (`searchCache`).
- `GET /distributors` — returns locally-known distributors joined with `distributor_learning_profiles`; **`isMapped` is computed as `hasPhone || hasProfile`** — i.e. "mapped," in this app's vocabulary, means *we have a local contact/profile for this distributor*, not that the distributor is mapped inside Pharmarack's own platform. This distinction matters for reading the UI correctly.
- `GET/POST /distributor-mappings` — maps a Pharmarack `store_name` string to a local `distributor_id`/phone; this is the #2-priority source in the frontend's phone-resolution chain (`getDistributorPhoneNumber()`).
- `POST /catalog/sync` — manually triggers `pharmarackCatalogCache.syncCatalog()` (normally a 3 AM cron job, see §4.5).
- `POST /login-window` — opens a native Pharmarack login window (Puppeteer-driven session capture) to (re)establish the session token.
- `POST /cart/add` — enriches any item missing `productCode`/`productName` (from `searchCache` or a fresh on-the-fly search), **requires a valid `pharmarack_session_token`** in `app_settings` (returns 401 `NEED_LOGIN` otherwise), then adds to Pharmarack's *real* cart via their API.
- `POST /delete-cart-item`, `GET /cart` — proxied straight through to Pharmarack's live cart API.
- `POST /cart/notify-manual`, `POST /cart/notify-delivery-boys-batch` — send a WhatsApp notification about cart contents.
- `GET /sent-orders/dates`, `GET /sent-orders`, `GET /sent-orders/latest-map`, `POST /log-placed-order` — read/write the `pharmarack_placed_orders` history table, used both to render the Sent History tab and to detect "already sent" items so the same order doesn't get pushed twice.
- `POST /check-overstock`, `GET /auto-refill-suggestions`, `GET /session-status`, `POST /logout`, `GET /session-logs`, `GET /live-cart-summary`, `GET /auto-verify` — session/health/analytics endpoints.

**Backend — `POST /whatsapp/queue/enqueue-pharmarack-batch`** (`whatsappQueue.ts` lines 81-205), the "Send All" workflow:
1. Resolves the target delivery-boy phone: explicit selection → first active `delivery_boys` row → `app_settings.owner_whatsapp_number`/`shop_phone` fallback, in that priority order.
2. Enqueues **one delivery-boy summary message first** (position #1 in the queue) — a single digest listing every distributor and item count for the day, so the delivery boy gets one overview message before the individual distributor messages start arriving.
3. Enqueues each distributor's pre-built order message individually.
4. **Logs each order into `pharmarack_placed_orders`** and auto-flips any matching `special_orders` row from `Pending` to `Ordered` via fuzzy product-name matching — closing the loop back to CRM's special-orders tracking automatically.
5. Calls `whatsappQueueWorker.triggerProcessing()` to kick the paced sender immediately rather than waiting for its normal poll interval — since the user just explicitly asked for these to go out now.

**Data flow (add an item to cart, then send the order)**:
```
Item added (from search, a refill shortcut, or a special-order match)
  → api.addPharmarackCart([...]) → POST /pharmarack/cart/add
      → item enriched with productCode/productName if missing
      → pushed into Pharmarack's REAL cart via their external API
  → fetchCart() → GET /pharmarack/cart (refetch)
  → items grouped client-side by storeId into Distributor objects
  → phone resolved: session override → local DB mapping → distributors table fuzzy match
User clicks "Send WhatsApp" (single) or "Send All" (batch)
  → buildDistributorOrderMessage() composes the WhatsApp text client-side
  → isItemAlreadySent() filters out items already sent (checks latestSentMap + session sentWaStatusMap)
  PATH A (batch/automated):
    → api.enqueuePharmarackBatch() → POST /whatsapp/queue/enqueue-pharmarack-batch
    → backend queue → whatsappQueueWorker → whatsappClient.sendMessage() (whatsapp-web.js), paced 8-12s apart
  PATH B (manual, single click, bypasses the queue):
    → openOrReuseWhatsappTab() opens api.whatsapp.com/send?phone=...&text=... in a browser tab
    → requires the user to physically click "Send" inside WhatsApp Web themselves
  → api.logPharmarackPlacedOrder() → pharmarack_placed_orders row written
  → localStorage sentWaStatusMap updated
  → UI polls GET /whatsapp/queue/status every 3.5s to reflect real send progress
```

**Why two send paths (automated queue vs. manual tab-open) coexist**: the automated queue is the default for routine batch ordering, but it depends on a live, logged-in WhatsApp Web session running in the background — if that session is down, expired, or the user simply wants to review the message before it goes out, the manual `wa.me`-link fallback still works with zero backend dependency, at the cost of requiring a physical click per message. This is a sensible reliability fallback rather than redundant code.

### 4.3 NonMappedDistributors (`frontend/src/pages/NonMappedDistributors/index.tsx`, 554 lines)

**Purpose**: Lets staff browse and search a specific distributor's product catalog and add items to the Pharmarack cart, specifically for distributors that don't yet have a local phone/contact mapping — "non-mapped" here is entirely about the *local* `distributors`/`distributor_learning_profiles` state, not Pharmarack's own platform status. Also rendered inline inside PharmarackCart (§4.2).

**Features**: two-pane layout (distributor list on the left, filterable by name/city/party code; product search console on the right); a product search form (3-character minimum) returning a results table (name, company, pack, PTR, MRP, stock badge, scheme, a quantity stepper, Add-to-cart); a per-row quantity stepper debounced 700ms that emits a `pharmarack-qty-changed` custom window event rather than making a direct API call (purely a local UI signal — no persistence on quantity change alone); per-product `AbortController` usage so rapid quantity changes cancel superseded in-flight add-to-cart requests instead of racing.

**API map**: `api.getPharmarackDistributors()` → `GET /pharmarack/distributors` (consumes the `nonMapped` array from the same handler described in §4.2); `api.searchPharmarack(query, storeId, false)` → `GET /pharmarack/search` scoped to one store with `isMapped=false`; `api.addPharmarackCart([...])` → `POST /pharmarack/cart/add` (same live-cart endpoint as PharmarackCart, with a `mapped: false` flag on the payload).

**Data flow**: mechanically identical to PharmarackCart's add-to-cart path — item → `/pharmarack/cart/add` → Pharmarack's real cart. After a successful add, this page **dispatches `window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'))`** so PharmarackCart (its parent/sibling under `KeepAliveOutlet`) picks up the new item via its own listener — see §9.2.

**Architecture note**: uses a module-level `cachedDistributors` variable (not React Query) for instant re-mount, the same lightweight pattern used across Dispatch/PharmarackCart.

### 4.4 CatalogUpload (`frontend/src/pages/CatalogUpload/index.tsx`, 1918 lines)

**Purpose**: Bulk-import a distributor or master product catalog (CSV/XLSX/PDF, up to 500MB) into the local `medicines` table — with column-mapping, duplicate-catalog detection, per-row Google-Search-based enrichment for ambiguous records, and a background job queue so a 500MB file never blocks the UI thread or the HTTP request.

**Full feature list**:
- Drag-and-drop / file-picker dropzone (`.csv,.xlsx,.xls,.pdf`).
- **Real-time progress via Server-Sent Events** (`EventSource` on `/notifications/stream`), handling `catalog_job_progress`, `catalog_job_update`, `catalog_review_updated`, `google_verification_required`, `google_verification_solved` events — updates both local component state and a React Query cache key `['catalog-jobs']` optimistically as events arrive.
- **Column-mapping modal**: drag/hover-highlight-linked headers↔DB-field mapping across color-coded field groups (Product Info/blue, Pricing/yellow, Stock/green, row-level batch fields/purple), an undo/redo history stack, and custom column creation for source columns that don't map to any existing field.
- **Job list/history tab** with pause/resume/delete per job. Job status machine: `pending → pending_analysis/processing_analysis → waiting_for_mapping → pending/processing → ready_for_review → done/failed`, plus a `paused` state reachable from most points.
- An 8-tile processing-summary dashboard (total / new / existing / duplicate / pending-review / new-columns / approved / rejected), each tile clickable to filter/highlight the corresponding rows.
- **`ReviewDetailPane`**: the per-record manual-review UI for AI/Google-enriched staged records — approve, reject, merge-with-duplicate, keep-as-new, or manually re-trigger Google enrichment; shows a captured screenshot of the Google search result used for enrichment plus raw OCR text (for PDF-sourced imports) in a collapsible detail section, so a human reviewer can see exactly what evidence the system used to make its suggestion.
- A live "Google Search Limit: count/limit per day" quota display — the enrichment feature is explicitly rate-limited and the remaining budget is surfaced to the user rather than hidden.

**Complete API map**:

| Function | HTTP | Route file |
|---|---|---|
| `uploadCatalogFile(file)` | `POST /upload` (multipart, Multer) | `upload.ts` |
| `getCatalogJobs()` | `GET /jobs` | `catalog.ts` |
| `getCatalogJobStatus(id)` | `GET /catalog/job/:id` | `catalog.ts` |
| `importCatalogJob(id)` | `POST /catalog/import-job/:id` | `catalog.ts` |
| `pauseCatalogJob(id)` / `resumeCatalogJob(id)` | `POST /catalog/job/:id/pause` / `/resume` | `catalog.ts` |
| `deleteCatalogJob(id)` | `DELETE /catalog/job/:id` | `catalog.ts` |
| `getCatalogJobReviews(id)` | `GET /catalog/job/:id/reviews` | `catalog.ts` |
| `approveCatalogReview(id, data)` | `POST /catalog/review/:id/approve` | `catalog.ts` |
| `rejectCatalogReview(id)` | `POST /catalog/review/:id/reject` | `catalog.ts` |
| `enrichCatalogReview(id)` | `POST /catalog/review/:id/enrich` | `catalog.ts` |
| `getGoogleSearchStatus()` | `GET /catalog/search-status` | `catalog.ts` |
| `importCatalog(medicines)` | `POST /catalog/import` | `catalog.ts` (a synchronous, direct-import alternate path not used by the main flow) |

**Backend behavior**:
- `POST /upload` (`upload.ts`) — Multer disk storage, 500MB limit, extension whitelist (`.csv/.xlsx?/.pdf/.zip`/images), copies the file into `catalogue/raw/`, inserts a `catalog_jobs` row (`status: pending_analysis`), then **dynamically imports** `worker/catalogWorker.js` and fires `runCatalogAnalysis(jobId)` in the background — the HTTP response returns immediately with just the `jobId`, well before analysis is done.
- `GET /catalog/job/:id` — reads the `catalog_jobs` row, parses the `extracted_data` JSON column for `previewData`/`headers`/`suggestedMapping`, plus `mapping_config`/`matched_previous_job_id`/`newly_detected_columns` for the duplicate-catalog-detection UI (i.e. "you've uploaded a file with this exact header set before — reuse that mapping?").
- `POST /catalog/import-job/:id` — persists the user's confirmed column mapping into a `catalog_mappings` table (keyed by the sorted header list, so future uploads with the same headers auto-suggest this mapping), flips the job to `pending`, fires `runCatalogImport(jobId)` in the background.
- `POST /catalog/import` — the direct synchronous path: for each medicine, normalizes the name (`utils/nameNormalizer.js`) and calls `medicineService.addOrUpdateMedicine()`; **auto-enrichment-after-import is explicitly disabled here** (commented out in the code) — enrichment must always be manually triggered per record through this path, a deliberate restriction distinct from the async job flow.
- `findSimilarMedicine()` (in `catalog.ts`) — a LIKE-query on the first word of a candidate name, then scores every candidate via `scoreProductName()` (imported from `pharmarackCatalogCache.ts` — the **same fuzzy-scoring function** used for offline distributor-catalog search, see §4.5). A score ≥ 0.75 counts as a duplicate match.
- Review/approve/reject/enrich routes call into `worker/compositionEnricher.js` (`runEnrichment`/`getEnrichmentRunningState`) — the Google-search-based composition-enrichment worker, which is a **separate background worker** from `catalogWorker.js` (import analysis/processing is one worker, composition enrichment is another).

**Data flow (upload a file through to a finished import)**:
```
User drops a file
  → api.uploadCatalogFile() → POST /upload (Multer)
      → catalog_jobs row created, runCatalogAnalysis(jobId) starts in background
          (parses headers, preview rows, suggests a column mapping,
           checks for a matching previously-uploaded header-set)
  ← SSE: catalog_job_update { status: 'waiting_for_mapping' }
  → api.getCatalogJobStatus(id) fetches headers/previewData/suggestedMapping
  → mapping modal opens
User confirms/edits the column mapping
  → api.importCatalogJob(jobId) → POST /catalog/import-job/:id
      → mapping persisted to catalog_mappings (learned for next time)
      → job set to 'pending', runCatalogImport(jobId) starts in background
          (processes rows in transactional batches of 1,000)
  ← SSE: catalog_job_progress / catalog_job_update stream total_count/new_count/
         existing_count/duplicate_count/progress live
  ← SSE: status 'done' → success banner
Ambiguous/duplicate rows appear in stagedReviews
  → api.getCatalogJobReviews(id)
  → ReviewDetailPane: user approves/rejects/enriches each one
      → enrichCatalogReview may trigger Google-search-based lookup (screenshot + OCR evidence shown)
```

### 4.5 Cross-Cutting: The Full WhatsApp Automation Architecture

Because WhatsApp threads through Dispatch, PharmarackCart, CRM (refill reminders), and Learning/Settings (credentials), it's worth documenting once, fully, here.

**Three send paths coexist, by design**:
1. **`whatsapp-web.js` via the paced queue** (the default automated path) — `src/whatsappClient.ts` wraps a real, puppeteer-driven WhatsApp Web session and exposes `sendMessage`, `getWhatsAppStatus`, `shouldRouteToBusiness`, `initClient`, `hashMessageBody`. Nothing calls `sendMessage()` directly from a request handler for bulk sends — everything goes through `whatsappQueueWorker.ts`, which persists a queue table (states: `pending/sending/sent/failed_offline/failed_perm`), paces sends with a **randomized 8–12s window** (`pacingMinMs`/`pacingMaxMs`, adjustable via `PUT /whatsapp/queue/pacing`), tracks `retry_count`, and exposes `getWorkerState()`/`triggerProcessing()`/`retryAllFailed()`/`updateItem()` for the frontend to introspect and control it.
2. **The official WhatsApp Business Cloud API** (`whatsappBusinessService.ts` + `routes/whatsappBusiness.ts`) — a parallel, Meta-compliant send path. `shouldRouteToBusiness()` makes a per-message decision about which of the two backends (unofficial session vs. official API) should handle a given send.
3. **The manual browser-tab fallback** (`openOrReuseWhatsappTab()` in PharmarackCart) — opens `api.whatsapp.com/send?phone=&text=` directly, requiring the user to click Send themselves inside WhatsApp Web. Bypasses the queue and the session entirely; works even if the automated session is broken.

**Anti-detection pacing is a deliberate, product-specific engineering investment**: beyond the queue's 8-12s randomized delay, `pharmarackDailyDispatchService.ts` implements a **randomized daily send-window** for the automated daily distributor-summary digest — an 11:00–11:10 AM band that shifts by up to ±15 minutes and **rotates its exact pattern every 45 days** (`CYCLE_DAYS`, pre-computed 2 days ahead of each rotation). This is explicitly engineered to avoid a fixed, bot-detectable sending cadence for what is otherwise a very regular, automatable daily task — a real engineering response to the operational risk of an unofficial WhatsApp client getting flagged.

**Offline distributor catalog cache** (`src/services/pharmarackCatalogCache.ts`) — the mechanism that lets NonMappedDistributors/PharmarackCart search distributor products even without a live Pharmarack session for every single search:
- `syncCatalog()` is meant to run daily via cron at 3 AM. It requires a live `pharmarack_session_token` (skips entirely, with no wasted calls, if absent). It fetches the store list from Pharmarack's `store-list` API, **prioritizes stores already flagged `Ismapped === 1`** (falling back to the first 20 stores if none are mapped yet), and for each store issues a broad Elasticsearch-backed catalog search (`open-search/api/v2/search`, `SearchKeyword: 'a'` — a deliberately generic query designed to enumerate roughly 200 products per store rather than search for anything specific). It **aborts the entire sync after 3 consecutive per-store errors** — a circuit breaker protecting against hammering a failing upstream API. Results upsert into a local SQLite `distributor_catalog` table (`UNIQUE(store_id, product_name)`, `ON CONFLICT DO UPDATE`) inside one transaction per store.
- `searchCatalog()` — the offline fuzzy-search path itself: builds a cheap SQL candidate filter using `product_name LIKE '%tok%'` OR-clauses across 4-character token prefixes (this handles minor misspellings reasonably well without needing a real fuzzy-search index), falls back to scanning up to 5,000 rows if the token search returns nothing at all, then **re-scores every candidate in JavaScript** via `scoreProductName()`, which combines `enhancedSimilarity()` (from `productNameFilterService.ts`) run against both the full product name and just its leading N+1 tokens — this two-way comparison specifically compensates for catalog names that carry pack/strength suffixes (e.g. "NOVASTAT 20MG TAB 10'S") that would otherwise tank a naive full-string similarity score. Results below `minScore` (default 0.6) are dropped; mapped and non-mapped results are returned as separate lists, each capped at the top 10 by score.
- **This same `scoreProductName()` function is reused** in `catalog.ts`'s `findSimilarMedicine()` for duplicate-medicine detection during catalog import (§4.4), at a stricter 0.75 threshold — one fuzzy-matching primitive, two very different call sites (live distributor search vs. import-time dedup), which is a clean piece of code reuse worth noting positively.
- **Important distinction**: the `distributor_catalog` table (this cache) is logically separate from the `medicines` master table populated by CatalogUpload/Purchases — the former is a live-mirrored, per-distributor-store product list purely for fast offline search of *their* catalog; the latter is the pharmacy's own owned, normalized medicine master data.

**Why build a whole offline mirror of a third-party's catalog rather than always calling their live search API**: a live API call on every keystroke in a search box would be slow (network round-trip to Pharmarack's servers) and would hammer their API with typeahead-volume traffic. Pre-syncing ~200 products per mapped store once a day and searching that locally with SQL + JS scoring gives sub-millisecond search latency and resilience to Pharmarack's API being temporarily slow or down, at the cost of the local copy being up to 24 hours stale — an acceptable tradeoff for a product catalog that doesn't change minute-to-minute.

**OSS alternative for the fuzzy matching**: the hand-rolled token-prefix-filter-then-rescore approach is a reasonable SQLite-native substitute for what a dedicated fuzzy-search library would give more directly — **`fuzzysort`** or **`Fuse.js`** (both pure JS, no native deps) could replace the custom `enhancedSimilarity()`/`scoreProductName()` scoring logic with a maintained, benchmarked implementation; SQLite's own **FTS5 with the trigram tokenizer** (already used for `medicines_fts`, see §7) could also directly replace the `LIKE '%tok%'` candidate-filtering step with a proper search index, which would likely be both faster and more accurate at the candidate-generation stage than string-prefix `LIKE` matching.

---

## 5. Compliance, CRM & Communications

### 5.1 CRM (`frontend/src/pages/CRM/index.tsx`, 4463 lines — the largest single page file in the app)

**Purpose**: A multi-tab customer-relationship hub covering five distinct workflows under one URL: patient medicine-refill scheduling/reminders, special/back-orders, customer credit ledger, distributor-automation message log, and WhatsApp Business. Tabs: `refills`, `special_orders`, `credit`, `messages`, `whatsapp` (`TABS` const).

**Refills tab — full feature list**:
- Patient refill cards split into **Overdue** / **Upcoming** sections, with a status filter (all/active/paused/canceled).
- A **"5–6 Day Lead Window"** banner and a **"3-Day Stock Alert"** banner, both computed *client-side* from each patient's `next_refill_date` and any detected stock shortfall — i.e. the urgency framing shown to staff is derived in the browser from data the API already returned, not a separate server computation.
- Add Refill modal with an inventory-search medicine picker that falls back across three endpoints in priority order (`/medicines/compact` → `/sales/search-medicine` → `/medicines/search-fast`) and a flexible frequency slider (presets of 15/30/60/90 days, or a custom days/weeks/months entry).
- Per-medicine row actions: **Edit Frequency** (slider modal → `PUT /refills/:id/frequency`), **Pause/Resume** (`POST /refills/:id/toggle-pause`), **Cancel** (`POST /refills/:id/cancel`), **"Remind Now"** (an immediate WhatsApp send, `POST /refills/send-reminder-now`), **"Sell Now"** (navigates straight to `/pos` with a prefilled cart — see §9.1), and **"+ Live Cart"** (a shortage shortcut that calls `api.addPharmarackCart` directly from the refills screen when stock is too low to fulfill the refill).
- A module-level cache `cachedRefillsData` for instant re-mount, and a `withSilentRetry` helper that retries transient cold-boot API failures silently (no error toast) before falling back to a visible error — presumably added because the app's startup sequence has a window where the backend isn't fully warmed up yet.

**Special Orders / Customer Credit / Messages / WhatsApp Business tabs**: present in the same 4463-line file (lines 1283-4463) but not traced line-by-line in this audit; the Messages tab (`DistributorMessagesSection`) was traced — a table of automation logs (`GET /automation/notifications`) with type/status filters and a per-row retry button (`POST /automation/notifications/:id/retry`).

**Backend — `src/routes/refills.ts`** (648 lines) — full CRUD over `patient_refills`, joined to `medicines`/`inventory_master`:
- `POST /refills` — inserts a new refill row, using a `parseIntervalDays` helper that accepts either a plain number or flexible interval text.
- `GET /refills/panel` — groups `patient_refills` by phone number, joins medicine names, and computes in-stock quantity per medicine via a subquery summing `inventory_master.quantity + loose_quantity`; also reads `app_settings.refill_notice_days` (the configurable lead-time window).
- `POST /refills/check` — calls `refillService.checkAllRefills(db)`, the automated due-date scanner that presumably runs on a cron schedule and is also manually triggerable from here.
- `PUT /refills/:id`, `PUT /refills/:id/frequency`, `POST /refills/:id/toggle-pause`, `POST /refills/:id/cancel`, `POST /refills/:id/toggle-override`, `POST /refills/:id/fulfill`, `DELETE /refills/:id`.
- `POST /refills/:id/send`, `/acknowledge`, `/skip`, `POST /refills/send-tomorrow-reminder`, `POST /refills/send-reminder-now` — all WhatsApp reminder sends, via `sendMessage()` (`src/whatsappClient.ts`) and a `getMessage()` i18n helper (suggesting message text is localizable); `send-reminder-now` specifically queries active, not-yet-notified refills for a given phone and builds the message using `app_settings.medical_name`.

**Data flow (pause a refill)**: click Pause → `POST /refills/:id/toggle-pause` → route fetches the `patient_refills` row, flips `is_active`, returns a confirmation message → frontend fires `refillEvent.triggerRefresh()` (a custom pub/sub, see §9.2) and shows a toast → silently re-fetches `/refills/panel` to refresh the card grid without a loading flicker.

**Architecture note**: heavy reliance on module-level caches (`cachedRefillsData`) and custom event buses (`refillEvent`, `toastEvent`, `specialOrdersEvent`, `liveCartAddEvent`) rather than a shared query-cache library — consistent with the app-wide pattern (§8.1), but especially pronounced here given the file's size. At 4000+ lines, CRM is flagged as the single largest maintenance-risk file in the frontend simply by virtue of size — any future refactor effort aimed at reducing per-page complexity should likely start here.

### 5.2 Mail (`frontend/src/pages/Mail/index.tsx`, 1011 lines)

**Purpose**: Distributor invoice email intake — synchronize a Gmail inbox locally, inspect emails/attachments, and **manually** parse a selected attachment into a prefillable Purchase Bill. The UI itself states the design intent directly: *"Attachments are not auto-processed into purchases. Select the invoice file(s) below and click Process to parse them."*

**Full feature list**:
- Two-panel layout: email list (left) + selected email's detail/attachments (right).
- Status legend: **New** (green, unread) / **Opened** (amber) / **Saved & Processed** (blue), derived from `isSaved`/`isSeen` flags via `getEmailStatus()`.
- IMAP connectivity indicator (`isImapConfigured`, `isOffline`), kept live via `settings-updated`/`email-config-updated`/`focus`/`visibilitychange` event listeners (see §9.2) — so if the user reconfigures Gmail on the Learning page, Mail's connectivity badge updates without a manual refresh.
- Background polling gated by `useFetchMode('mail.imapSync')` / `useFetchMode('mail.inboxRefresh')`: a cold-cache-only initial sync 1.5s after mount, then a 2-minute periodic IMAP sync plus a 30-second local-DB refresh — **both paused whenever `usePageActive()` reports the page isn't the active one**, which matters a great deal given `KeepAliveOutlet` keeps Mail mounted (and therefore its intervals alive) even when the user has navigated elsewhere.
- Module-level caches (`cachedEmails`, `cachedSelectedEmail`, `cachedAttachments`, `cachedLastSyncedAt`) for instant remount.
- Attachment preview pane supporting PDF/CSV/XLSX/TXT (`api.getAttachmentPreview`).
- **"Process & Create Purchase Bill"**: parses the selected attachment(s) via `api.parseAttachment(filename, false)` (the `false` means parse-only, no DB write), aggregates the resulting line items across files, then **navigates to `/purchases`** with `{ prefilledPurchase, emailSource }` in router state — handing off to Purchases rather than writing a purchase itself (see §9.1).
- "Clear Cache" deletes all cached attachment files server-side (`api.clearAttachmentsCache`).
- **Prefill support arriving from elsewhere**: reads `searchDistributor`/`searchProduct`/`orderId` from navigation state to auto-select a matching email — used when a user arrives here from CRM's Special Order Requests tab looking for the invoice that would fulfill a specific back-order (see §9.1).

**Complete API map**: `api.getEmailStatus()` → `GET /email/status`; `getEmailInbox(limit)` → `GET /email/inbox`; `triggerEmailSync()` → `POST /email/sync`; `markEmailSeen(id)` → `POST /email/:id/seen`; `markEmailSaved(uid)` → `POST /email/:uid/saved`; `getEmailAttachmentsById(id)` → `GET /email/:id/attachments`; `getAttachmentPreview(filename)` → `GET /email/attachments/preview`; `parseAttachment(filename, importData)` → `POST /email/attachments/parse`; `clearAttachmentsCache()` → `DELETE /email/attachments/cache`.

**Backend — `src/routes/email.ts`** (478 lines), backed by `src/services/emailService.ts`:
- `POST /email/` — a webhook-style raw-email ingest → `emailService.processEmail()` + `processAttachments()`, broadcasts an `email_update` SSE event.
- `GET /email/inbox` — reads local SQLite only (`emailService.fetchInbox`), fully **offline-capable**, defaulting to a 7-day window.
- `GET /email/status` — `emailService.getImapStatus()`.
- `POST /email/:id/seen` — marks seen in the local DB *and* best-effort marks seen on the IMAP server (`markAsSeen`).
- `POST /email/sync` — `syncNewEmailsFromIMAP()` + `pruneOldEmails()`.
- `POST /email/prune` — manual retention prune (separate from the automatic one).
- `POST /email/:uid/saved` — `markEmailSaved`.
- `GET /email/:id/attachments` — `downloadAttachmentsForUid`.
- `GET /email/attachments/preview` — reads the file from the uploads directory; text/CSV read raw, PDF via `pdf-parse`, XLSX/XLS via `xlsx` converted to CSV text (capped at 50,000 characters); includes a **directory-traversal guard** on the resolved file path (a real security consideration given the filename comes from user-controlled query params).
- `POST /email/attachments/parse` — `parseAndImportAttachment(filePath, importData)`, broadcasts SSE.
- `DELETE /email/attachments/cache` — deletes every file prefixed `att-` from the uploads directory.
- Google OAuth routes (`/auth/google`, `/auth/google/callback`) for Gmail — sets `app_settings` keys (`gmail_oauth_access_token`, etc.), with a **separate mobile-deep-link redirect branch** (`pharmacymobile://`) for completing OAuth from the paired mobile app rather than the desktop browser.

**Architectural centerpiece — the deliberate manual-review shift, confirmed in code comments**: `emailService.ts::processEmail()` (~line 1481) contains an explicit inline comment documenting a safety-driven redesign:
> *"No automatic background import of purchase bills (should be manually processed by user on frontend). Instead, queue the detected order into a review table... Do NOT call processMedicineOrder() — it fabricates pricing and auto-writes inventory data; left in place unused for a future redesign."*

When an order-related email arrives, `processEmail()` inserts a row into **`email_order_reviews`** (`status: 'pending'`) instead of auto-creating a purchase. `src/routes/emailOrderReviews.ts` (52 lines) exposes only `GET /` (list, optional `?status=` filter) and `POST /:id/dismiss` (marks `status='reviewed'`) — a deliberately thin review-queue API.

**A genuine gap worth flagging**: this `email_order_reviews` queue **does not currently appear to be surfaced in any frontend page examined in this audit** — the Mail page's manual-parse flow bypasses it entirely, going straight from attachment to Purchases' prefill instead. It's a backend-only holding table right now. The code itself acknowledges this — described as intended for "a badge on the Learning or Dispatch page — not built in this task." There's also a known data gap here: the `email_uid` column is inserted as `null` because `ProcessedEmail`'s type doesn't carry the IMAP UID all the way through the call chain (matches project memory: *Email UID Missing from API Request Processing*), meaning that even if a frontend surface for this queue were built today, it couldn't deep-link back to the original email.

**Data flow (process an invoice attachment end-to-end)**:
```
User selects an email
  → api.markEmailSeen(id)  [optimistic local flip to "Opened"]
  → api.getEmailAttachmentsById(id)
User selects a CSV/PDF attachment, clicks Process
  → api.parseAttachment(filename, false)  per file  [parse-only, no DB write]
  → results aggregated into allItems
  → api.markEmailSaved(id)  [flips status to "Saved & Processed"]
  → navigate('/purchases', { state: { prefilledPurchase, emailSource } })
      ↳ the actual INSERT into purchases/purchase_items only happens
        when the user explicitly clicks Save on the Purchases page
```

### 5.3 Compliance (`frontend/src/pages/Compliance/index.tsx`, 452 lines)

**Purpose**: The statutory Schedule H1/H/X drug dispensing register required under India's Drugs & Cosmetics Rules — tracking restricted-drug sales with prescribing-doctor attribution, ready for a Drug Inspector audit.

**Features**: four metric cards (Today's H1 Sales, Monthly H1 Sales, Pending Doctor Assignments, Total Statutory Logs); a filterable register table (keyword, doctor, schedule type H1/H/X, date range, with Reset/Apply); table columns Date / Drug Name / Schedule badge / Patient Name / Prescribing Doctor (flagged amber "Pending Doctor Assignment" if the name is missing, `Self`, or `Pending`) / Qty / Bill No / Actions; an "Assign Doctor" modal per row (sets doctor name + license/registration number); CSV export (`window.open('/api/compliance/export')`) and browser-native Print Register (`window.print()`).

**API map**: `api.getComplianceDashboard()` → `GET /compliance/dashboard`; `api.getH1Register(params)` → `GET /compliance/h1-register`; `api.updateComplianceDoctor(id, data)` → `PUT /compliance/:id/doctor`; a direct (non-`api.ts`-wrapped) link to `GET /compliance/export` for the CSV download.

**Backend — `src/routes/compliance.ts`** (206 lines) — **notably, this is the one route file in this cluster with no dedicated service layer**; every handler runs raw SQL directly against `compliance_logs` via `dbManager.getConnection()`:
- `GET /` — an unrelated generic compliance placeholder (counts expired inventory from `inventory_master`) — a naming collision with the H1-register concept, not actually part of this page's flow.
- `POST /add`, `POST /add-schedule-h1` — insert into `compliance_logs` (date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type); `add-schedule-h1` is presumably invoked from the POS/sales flow itself when a Schedule H1 drug is sold (that call site is in the sales cluster, out of this section's direct scope, but the naming strongly implies POS → Compliance is a write-time integration — see §9.6).
- `GET /dashboard` — four aggregate `COUNT` queries (today, month-to-date, pending-doctor, all-time), matching `schedule_type IN ('H1','H','X','Schedule H1')` or a `LIKE '%H1%'` fallback.
- `GET /h1-register` — a dynamically-built `WHERE` clause from query params, `ORDER BY id DESC LIMIT 500`.
- `PUT /:id/doctor` — `UPDATE compliance_logs SET doctor_name=?, license_no=COALESCE(?, license_no)`.
- `GET /export` — streams a properly CSV-escaped full export of `compliance_logs` with a `Content-Disposition: attachment` header.

**Data flow (assign a doctor to a pending entry)**: click "Assign Doctor" on a flagged row → modal opens → submit → `PUT /compliance/:id/doctor` updates the row → frontend re-runs both `fetchDashboardStats()` and `fetchLogs()` to refresh the pending-count metric card and remove the row's amber badge in one pass.

**Architecture note — data-consistency smell worth flagging**: `schedule_type` values are inconsistently seeded (`'H1'` vs `'Schedule H1'` vs loosely `LIKE`-matched), which strongly suggests this table has been written to by more than one code path over the app's history with slightly different conventions each time. Not a functional bug today (the queries account for the inconsistency with `IN`/`LIKE`), but a real risk if a future write path introduces yet another variant spelling that the existing `IN (...)` lists don't cover.

### 5.4 CompositionQueue (`frontend/src/pages/CompositionQueue/index.tsx`, 684 lines)

**Purpose**: A review queue for enriching medicines with their **composition** (active pharmaceutical ingredient / salt) — matching raw, often messy medicine names against a reference salt master, which powers "same-salt substitute" suggestions used elsewhere in the app (POS/Inventory).

**Features**: a top panel with an enrichment progress bar (`enriched/total`), five stat tiles (Matched, Review, Unmatched, Non-Pharma, Pending), Start/Stop enrichment controls, Import/Export Master CSV, and Export Verified CSV; a filterable (All / Needs Review / Unmatched), paginated (50/page) queue table supporting a `?highlight=<id>` deep-link that scrolls to and focuses a specific row — the mechanism used when arriving here from POS's "unmatched medicine" flow (see §9.1); per-row Accept for a suggested composition or a free-text manual entry; and a **`SearchTermEditor`** subcomponent for unmatched rows — an inline, expandable token-chip UI that lets the user include/exclude individual words from the medicine name before triggering a live, Google-search-based online enrichment lookup (`getTokenPreview` → toggle chips → `setSearchTerm` → `triggerOnlineEnrichment`, then the UI waits roughly 8-10 seconds and reloads).

**API map**: `getEnrichmentStatus()` → `GET /enrichment/status`; `getEnrichmentQueue(page, limit, filter)` → `GET /enrichment/queue`; `startEnrichment()`/`stopEnrichment()` → `POST /enrichment/start`/`/stop`; `updateComposition(id, composition)` → `PUT /enrichment/queue/:id`; `getTokenPreview(name)` → `GET /enrichment/preview-tokens`; `setSearchTerm(id, term)` → `POST /enrichment/set-search-term`; `triggerOnlineEnrichment(id)` → `POST /enrichment/trigger-online/:id`; `importReferenceCsv(file)` → `POST /reference/import`; `exportReferenceCsv()` → `GET /enrichment/reference/export`; `exportVerifiedCsv(status)` → `GET /enrichment/export`.

**Backend — `src/routes/enrichment.ts`** (375 lines, serving both `/enrichment/*` and `/reference/*` under one router): `GET /enrichment/status`, `POST /start`/`/stop` (start returns HTTP 409 if a job is already running — the frontend explicitly checks for that status code); `POST /backfill-suggestions`, `/reclassify-non-pharma` (maintenance operations not wired to this page's UI, presumably run manually/via script); `POST /reference/reload-from-disk`, `POST /reference/import` (Multer `upload.single('file')`); `GET /reference/export`, `GET /enrichment/export` (blob CSV downloads); `GET /queue` (paginated/filterable); `PUT /queue/:id` (manual save); `GET /preview-tokens` (synchronous, pure-string classification — no DB hit, so the token-chip UI feels instant); `POST /set-search-term`; `POST /trigger-online/:id` (kicks off async Google-search enrichment for one row — backgrounded, the frontend polls/refreshes after a fixed delay rather than awaiting the result directly).

**Architecture — deliberate two-tier, human-in-the-loop matching**: local reference-CSV fuzzy matching runs first and auto-fills anything ≥85% confidence, flagging 60–85% as "needs review" for a human to confirm rather than auto-accepting a borderline match. For names that don't match *anything* locally (the "unmatched" bucket), the token-chip UI lets a human curate exactly which words go into an external Google search **before** that search fires — rather than the system guessing which words matter and burning a rate-limited search quota on a bad query. This mirrors the same "stage for human review rather than fully automate" philosophy documented explicitly in the Mail page (§5.2) — it's a recurring, deliberate design stance in this codebase, not a coincidence.

**Data flow (accept a suggested composition)**: a row with `enrichment_status='needs_review'` has `suggested_composition` populated → user clicks the checkmark → `api.updateComposition(id, suggestion)` → `PUT /enrichment/queue/:id` writes the composition and flips status → frontend optimistically removes the row from the local `queue` state and decrements `totalItems`, then calls `loadStatus()` to refresh the stat tiles.

### 5.5 Investigation (`frontend/src/pages/Investigation/index.tsx`, 1737 lines)

**Purpose**: The "Investigation Center" — reconstructs a chronological, running-balance stock ledger (opening/closing quantity per batch and per medicine) across Sales, Purchases, Returns, and manual Adjustments, and lets admins directly correct historical inventory/sales/purchase records with full audit logging. This is the forensic, root-cause-analysis tool for "why does this stock number not match reality" investigations.

**Full feature list**:
- An infinite-scroll, fully virtualized table (`useInfiniteScroll`, `useVirtualizer`, `InfiniteTable`/`VirtualRow`) with server-side filtering on medicine, batch, invoice/reference, party, transaction type, and date range — all debounced 400ms except date/type, which apply immediately.
- **Configurable column visibility** across 14 optional columns (Batch, Date, Invoice, Party, Opening/Purchase/Sales/Purchase-Return/Sales-Return/Adjustment/Stock-Audit/B2B-Sales/Closing-Stock/Medicine-Stock quantities), persisted to `localStorage['inv-ledger-cols']`.
- CSV/PDF export respecting only the currently-visible columns.
- **"Correction Workspace"**: a full-page takeover with three edit modes:
  - `inventory` — direct stock/batch/expiry/MRP/cost/rack correction, with a before/after diff preview card so the admin sees exactly what will change before committing.
  - `sale` — edit an existing sales invoice's line items (quantity, loose quantity, add/remove medicines entirely), with a live-recalculated total (a flat 5% tax rate is hardcoded in this correction path).
  - `purchase` — edit a purchase bill's items similarly, with CGST/SGST/CD (cash discount) recalculation.
- A portalled confirmation modal before every write action, and an **Audit Trail panel** (shown in inventory-edit mode) that surfaces prior `action_logs` entries matched to the current medicine/batch by string-matching (see the architecture note below for why this is fragile).
- After every correction: `invalidateAfterStockWrite(queryClient)` plus a manual refresh of POS's compact-inventory cache — this page's writes are explicitly treated as first-class stock mutations for cache-invalidation purposes, same as a real sale or purchase.

**Complete API map**: `getInvestigationTimeline(params)` → `GET /investigation/timeline`; `getInvestigationDetails(inventoryId)` → `GET /investigation/details/:inventoryId`; `getInvestigationAuditLogs(inventoryId)` → `GET /investigation/audit-logs/:inventoryId`; `updateInvestigationInventory(inventoryId, data)` → `PUT /investigation/inventory/:inventoryId`; `updateInvestigationSaleBill(invoiceId, data)` → `PUT /investigation/sales/:invoiceId`; `updateInvestigationPurchaseBill(purchaseId, data)` → `PUT /investigation/purchases/:purchaseId`; plus generic shared endpoints `getSale`, `getPurchase`, `searchMedicine`, `getCompactInventory`.

**Backend — `src/routes/investigation.ts`** (1160 lines, no dedicated service module — direct SQL throughout, using `inventoryCache.invalidate()` and importing `applyStockDelta` from `src/utils/stockRebuild.js`):
- **`GET /timeline`** — the most computationally involved endpoint in the app: builds four independently-filterable SQL queries (Sale / Purchase / Return / Adjustment), merges them, then **parses `action_logs.description` free-text via regex** to recover medicine/batch/quantity deltas specifically for Adjustment-type rows, sorts everything chronologically ascending to compute running `batchRunning`/`medRunning` Maps (opening and closing balances per batch and per medicine), re-sorts descending for display, applies remaining in-memory filters, and paginates. All of this happens **per request, with no caching** — a deliberate tradeoff given this is an investigative tool used occasionally rather than a high-frequency screen, where always-fresh data matters more than raw speed.
- `GET /search` — a multi-criteria inventory search joined across purchases/sales/distributors/customers, capped at 50 results.
- `GET /details/:inventoryId` — a single inventory record plus its full purchase and sale history plus a simple two-source timeline; this is what seeds the Correction Workspace's diff preview.
- **`PUT /inventory/:inventoryId`** — a transactional direct correction: updates `inventory_master`, cascades batch/expiry changes into matching `purchase_items` and `sale_items` rows, and writes an `action_logs` entry with the old→new values embedded in a formatted description string — **this exact string is what `/timeline` and `/audit-logs/:inventoryId` later regex-parse back out**. Invalidates `inventoryCache`.
- **`PUT /sales/:invoiceId`** — recomputes the stock delta between the old and new line-item sets, validates the new totals against available stock (via `applyStockDelta`, correctly accounting for `pack_size`), rewrites `sale_items`, recalculates totals (the hardcoded 5% flat tax), **saves a before/after snapshot to `sales_bill_edit_history`** (a dedicated audit table distinct from `action_logs`), and also logs to `action_logs`.
- **`PUT /purchases/:purchaseId`** — a similarly delta-based reconciliation against `inventory_master.quantity`, blocking any reduction below currently-available stock, rewriting `purchase_items`, recalculating CGST/SGST, and updating the purchase's totals.
- `GET /audit-logs/:inventoryId` — looks up `action_logs` via `LIKE` matching on the medicine name, batch, or an `"ID <n>"` substring inside `description` — the same fragile string-matching pattern as `/timeline`'s adjustment parsing.

**Data flow (correct a sales invoice via Investigation)**:
```
Admin clicks Edit on a Sale-type row in the ledger
  → api.getSale(invoice_id)  [the SHARED sales route, not investigation-specific]
  → billItems state populated
Admin edits quantities / adds/removes medicines (via api.searchMedicine)
  → Save → confirmation modal → api.updateInvestigationSaleBill(invoiceId, {items, discount})
  → PUT /investigation/sales/:invoiceId
      → computes stock deltas old vs new
      → validates sufficiency (same philosophy as POS: never allow a phantom oversell)
      → UPDATE inventory_master, rewrite sale_items
      → recalculate invoice totals
      → snapshot to sales_bill_edit_history
      → log to action_logs
  → runSearch()  [refetches the infinite-scroll timeline]
  → invalidateAfterStockWrite(queryClient)  [busts every dependent cache app-wide]
```

**Architecture note — the one clear technical-debt hotspot identified across this entire audit**: there are **two independently-derived sources of truth for "what changed"** — the structured `sales_bill_edit_history` table (for sale corrections specifically) versus the free-text `action_logs.description` field that both `/timeline`'s Adjustment-row reconstruction and `/audit-logs/:inventoryId` regex-parse for meaning. This is a brittle coupling: any future change to the exact wording/format of the description string written by `PUT /inventory/:inventoryId` would silently break both downstream parsers, with no compile-time or even obvious runtime signal that anything broke — the timeline would just quietly start missing or misattributing adjustment entries. **The concrete fix, if this is ever revisited**: add a structured `metadata` JSON column to `action_logs` (old value, new value, field name, entity type/id) written alongside the human-readable description, and have `/timeline` and `/audit-logs` read the structured column instead of regexing prose.

### 5.6 License (`frontend/src/pages/License/index.tsx`, 288 lines)

**Purpose**: Desktop-app license activation and status — infrastructure/DRM for the distribution model, not a pharmacy-domain feature. This is the one page in the entire app that isn't about running a pharmacy.

**Features**: a status card (Active/Inactive/Trial badge, a masked license key via `maskKey` showing only the last segment, expiry date, read-only Machine ID, and a color-coded Days Remaining — red at ≤7 days, amber at ≤30, green otherwise); an activation form (paste a license key → `handleActivate`), which on success clears the cached auth token (`clearAuthTokenCache()`) and re-bootstraps one (`ensureAuthToken()`), since activation refreshes the server-side session token that every other API call's axios interceptor depends on.

**Backend — `src/routes/license.ts`** (117 lines), delegating to `src/license/*`:
- `POST /license/activate` — derives a machine fingerprint (`deriveMachineFingerprint()`, `src/license/machineId.js`), calls an **external Google Apps Script license server** (`LICENSE_SERVER_URL`) with `action=activate&key=&fingerprint=`; on success, computes an HMAC-SHA256 `installToken` keyed by `LICENSE_BUILD_CONSTANT` (default `'aip-build-2026'`) bound to the fingerprint, writes `INSTALL_TOKEN`/`LICENSE_KEY`/`SESSION_TOKEN` via `writeToken()` (`src/license/tokenStore.js` — DPAPI-protected Windows registry storage, per the License page's own UI copy), and calls `storeActivationResult()` (`src/license/licenseCheck.js`).
- `GET /license/status` — `getLicenseState()` from `src/license/gracePolicy.js`, a state machine handling grace-period/trial/expiry logic for offline operation.
- `POST /license/heartbeat` — `performLicenseCheck()` + fresh state, for periodic re-validation against the license server — not called from this page directly, presumably triggered by a background process elsewhere in the app.

**Why a Google Apps Script "license server" rather than a dedicated licensing SaaS**: zero hosting cost, zero third-party billing integration, and zero infrastructure to maintain for what's likely a modest-volume desktop product — a genuinely pragmatic choice for the product's scale. The real cost is that license-server uptime, rate limits, and any behavior quirks are entirely outside the team's control and governed by Google Apps Script's own constraints (execution time limits, quota limits) rather than a purpose-built licensing backend's SLAs.

**Why DPAPI + Windows registry for local token storage rather than a plain config file**: DPAPI (Windows Data Protection API) encrypts data using the current Windows user's credentials, so the stored token can't simply be copied to another machine or read by another user account — meaningfully raising the bar against casual license-sharing compared to a plaintext file, at the cost of the app being Windows-specific for this feature (consistent with `platform: win32` being the only environment this app is documented to run in).

**OSS alternative**: **Keygen** (open-source-available license-management server, self-hostable) would remove the Google Apps Script dependency and give a purpose-built API (seat limits, offline license files, webhooks) if licensing needs grow more sophisticated than a single key+fingerprint check; **node-machine-id** is the standard OSS library for the fingerprinting step if `machineId.js` isn't already built on it. Neither is a clear must-do today — the current approach works and costs nothing to run — but both are the natural next step if licensing logic needs to grow (e.g., seat-based licensing for a multi-location pharmacy chain).

---

## 6. Dashboard, Reports & Admin

### 6.1 Dashboard (`frontend/src/pages/Dashboard/index.tsx`, 342 lines)

**Purpose**: The home/overview screen — welcome header, quick-action links, KPI cards, alerts, recent activity. What a user sees first when nothing more specific has drawn them elsewhere.

**Features**: a Quick Action bar linking to `/pos`, `/purchases`, `/inventory`, `/crm?tab=special_orders`, `/crm`; four primary KPI cards (Today's Sales, Low Stock Items — defined as `quantity < 5`, Pending Alerts, System Status — currently a static "Connected" label rather than a live health check); an operational-highlights row (Storage Racks count, Pending Special Orders, Active Delivery Boys, Today's Purchases); a "System Alerts & Action Items" panel listing `action_logs` rows of type `AUTOMATION_ALERT` with a per-row Dismiss button; a Recent Sales Activity table (top 5 invoices) and a Recent Communications/Ingestion feed (top 5 emails), each with a "View All" link into `/sells` or `/mail` respectively; loading-skeleton and error states handled inline.

**API map**: `api.getDashboard()` → `GET /dashboard`; `api.dismissDashboardAlert(id)` → `DELETE /dashboard/alerts/:id`, applied with an **optimistic React Query cache update** (`queryClient.setQueryData`) — the alert visually disappears before the server confirms the delete.

**Backend — `src/routes/dashboard.ts`** (85 lines, no service layer — every query is inline SQL):
- `GET /` assembles the whole dashboard payload from several independent queries: `todaySales` (`sales_invoices` where `date(date)=date('now')`), `lowStock` (count from `inventory_master WHERE quantity < 5`), `pendingTasks` (count of `action_logs WHERE action_type='AUTOMATION_ALERT'`), `alerts` (last 10 rows of that same type), `storageLocations` (active rows), `pendingSpecialOrders` (`special_orders WHERE status='pending'`), `activeDeliveryBoys` (`delivery_boys WHERE is_active=1`), `todayPurchases`, `recentSales` (top 5 `sales_invoices` joined to `customers`), and `recentCommunications` (top 5 `emails` rows — **wrapped in a try/catch that silently degrades to an empty array** if the query fails, e.g. if the `emails` table doesn't exist yet on a fresh install, so a missing/uninitialized email feature never breaks the whole dashboard load).
- `DELETE /alerts/:id` — a plain `DELETE FROM action_logs WHERE id=?`.

**Data flow (dismiss an alert)**: click Dismiss → `api.dismissDashboardAlert(id)` → `DELETE /dashboard/alerts/:id` → row deleted → `{success:true}` → the frontend **immediately** patches the `['dashboard']` React Query cache to both remove the alert from the list and decrement the `pendingTasks` counter, without waiting for a refetch — a genuinely optimistic update, not just an optimistic-looking one.

**Why this page is pre-warmed rather than loaded on demand**: `App.tsx` prefetches the `['dashboard']` query 8 seconds after the app boots, and `Layout.tsx`'s sidebar prefetches it again on hover — by the time a user actually clicks into Dashboard, the data is very likely already sitting in cache, so the "home screen" of the app almost never shows a loading spinner in practice.

### 6.2 Reports (`frontend/src/pages/Reports/index.tsx`, 1557 lines)

**Purpose**: The sales/purchases/inventory/expiry/non-moving/product-trace reporting workspace, with export and WhatsApp dispatch of formatted report PDFs.

**Features**: six tabs via `?tab=` (`sales`, `purchases`, `inventory`, `expiry`, `nonMoving`, `trace`); date-range controls (30 Days/1 Year/All Time presets plus manual From/To); the Non-Moving tab has its own "Inactive ≥ Days" numeric filter plus medicine/batch search; the Trace tab has a free-text search across batch/invoice/distributor; **two stacked module-level in-memory caches** (`cachedReportsMap`, `cachedNonMovingMap`) layered on top of React Query for instant tab-switch hydration; dynamic KPI cards per tab (revenue/COGS/net-profit/margin for sales; totals/supplier-count for purchases; stock valuation for inventory; at-risk value for expiry; locked-capital value for non-moving; trace-health/match-counts for trace); an export modal supporting CSV/PDF, either as a single file or a client-side "split mode" that chunks large exports into multiple 30-item files; "Send WhatsApp" (a combined PDF+chart report sent to the owner) and "Send 3 PDF Styles" (Classic/Corporate/Executive sample templates, presumably for choosing a preferred report look).

**Complete API map**: `api.getReportsSummary({type, fromDate, toDate})` → `GET /reports` (KPI numbers); `api.getReportsData({type, fromDate, toDate})` → `GET /reports/data` (table rows); `api.getNonMovingReportData({days})` → `GET /reports/non-moving/data`; `api.getProductTrace({q})` → `GET /reports/product-trace`; `api.exportReportsPDF(...)`/`exportReportsCSV(...)` → `GET /reports/export-pdf`/`export-csv` (blob); direct (non-`api.ts`-wrapped) calls to `/reports/send-monthly-scheduled`, `/reports/send-all-template-samples`, and `/reports/monthly-scheduled-preview` (opened via `window.open` for a direct PDF download).

**Backend — `src/routes/reports.ts`** (753 lines, no service layer for the core report queries — inline SQL with shared date-coalescing helper expressions `SALES_DATE_EXPR`, `PURCHASES_DATE_EXPR`, etc.):
- `GET /` — per-type summary stats: sales (revenue/COGS/profit-margin from `sales_invoices`/`sale_items`/`inventory_master`), purchases (from `purchases`/`purchase_items`), inventory (valuation from `inventory_master`), expiry (from `inventory_master` filtered by `expiry_date`).
- `GET /data` — raw row lists per type, capped at 500 rows.
- `GET /export-pdf`, `/export-excel`, `/export-csv` — delegate to `src/utils/reportExporter.js` (`exportToPdf`/`exportToExcel`/`exportToCsv`).
- `GET /non-moving`, `GET /non-moving/data` — delegate to `nonMovingReportService` (`generateNonMovingReport`, `saveReportToFile`, `sendReportNotification`, `getNonMovingItems`) — this is the one report type with its own dedicated service module rather than inline SQL.
- `GET /product-trace` — joins `purchase_items`/`purchases`/`distributors`/`medicines` and separately `sale_items`/`sales_invoices`/`customers`/`inventory_master`/`medicines`, LIKE-matching on medicine name, batch, invoice number, or distributor/customer name, each side capped at 100 rows.
- `GET /monthly-scheduled-preview`, `POST /send-monthly-scheduled`, `POST /send-all-template-samples` — delegate to `monthlyReportService` (`compileReportData`, `generateReportPdf`, `generateReportExcel`, `formatReportMessage`, `resolveRecipientPhone`).
- `GET /gstr-1`, `GET /hsn-summary` — additional GST/tax-compliance reports present in this route file but **not surfaced in this Reports page's own tab list** — these are almost certainly consumed by the Compliance page or accessed directly, evidence that not every backend capability has a matching frontend surface yet.

**Data flow (generate a Non-Moving Inventory report)**:
```
User selects "Non-Moving Inventory" tab, sets "Inactive ≥ Days" to 90, clicks Generate
  → handleGenerate() invalidates the React Query key ['reports','nonMoving',90]
    and the module cache entry cachedNonMovingMap[90]
  → api.getNonMovingReportData({days:90}) → GET /reports/non-moving/data?days=90
      → nonMovingReportService.getNonMovingItems(90)
          queries inventory against sales history to find items
          with zero transactions in the last 90 days
  ← { success, periodDays, count, items }
  → 4 dynamic KPI cards render (locked capital at cost, locked capital at MRP,
     inactive-item count, never-sold count)
  → filterable results table
```

**Architecture note**: the two-layer caching (module-level object + React Query `staleTime: 300000`) is unusual enough to flag — it reads as a targeted perf patch against tab-switch loading flicker rather than a deliberate two-tier design, similar in spirit to Reports' sibling pages. Export logic deliberately branches between client-side (JS-chunked multi-file split, for when a user wants several smaller files) and server-side (single blob via `/export-pdf`/`/export-csv`, presumably for when a single complete file matters more than chunk size).

### 6.3 Learning (`frontend/src/pages/Learning/index.tsx`, 2813 lines)

**Purpose**: The "AI Learning & Automation Command Center" — clinical OCR/mapping tuning, doctor affiliations, distributor invoice-layout learning, and, critically, **the credentials hub for Gmail, WhatsApp Web, WhatsApp Business, Telegram, and Pharmarack.** This confirms both standing project facts: Gmail credentials and Pharmarack/delivery-staff configuration genuinely live on this page, not Settings.

**Full feature list by tab** (`?tab=`):
- **`clinical`** (default): a Clinical Logic Sensitivity slider (writes `app_settings.clinical_learning_sensitivity`), Intelligent Suggestions stats (active OCR corrections count, learned prescription-combination count, last retrain date), an **OCR Database Mapping Sandbox** (test a raw/misspelled brand name against the DB live), and a "Retrain Clinical Model" button.
- **`doctors`**: the Doctor Affiliations registry — add/edit/delete doctors, toggle `send_daily_summary` per doctor, and manually trigger a daily doctor-billing summary report.
- **`distributors`** (URL param normalizes to `distributor_layouts`): the distributor list with each one's learned file-mapping profile, a per-distributor manual column-mapping editor (name/qty/rate/mrp/batch/expiry/GST/invoice field mapping), a historical-file comparator, a merge-duplicate-distributors modal, and an add-distributor modal.
- **`operations`** (URL params `distributor_layouts`/`messaging`/`ingestion`/`integrations` all normalize to this tab) — **the "Integrations & Credentials Hub"**, the single most operationally important section of this page:
  - **Gmail & Email Invoice Ingestion card** (~line 2146): shows configured/not-configured state derived from `gmail_auth_method` (`password` vs `oauth2`) and the presence of `gmail_user`/`gmail_pass`; "Configure Scanner" reveals either a Gmail User + App Password pair of inputs, or an OAuth2 toggle; a "Disconnect Google" button.
  - WhatsApp Web QR pairing — polls `/messaging/qr` every 5 seconds while the page is active, plus reconnect/logout/login-window/test-message actions.
  - WhatsApp Business API test button and a webhook-URL copy control.
  - Telegram bot status polling (`/settings/telegram-status`, every 5 seconds).
  - Pharmarack login window plus session-health checking (`/pharmarack/session-status`, polled every 3 minutes via `usePageActive` gating).
- **Live sync via SSE**: subscribes to `/api/notifications/stream` and invalidates the `learning-profiles`/`learning-profile-detail` React Query keys whenever a `distributors_updated` event arrives — so if a distributor gets merged or edited from somewhere else in the app, this page's distributor list updates without a manual refresh.

**Complete API map** (mostly called directly via `apiClient`, not wrapped in the `api.*` object — a difference from most other pages in this audit, worth noting as evidence this page was built more ad hoc): `GET/POST/PUT/DELETE /crm/doctors[/:id]`, `POST /crm/doctors/send-daily-reports`; `GET /learning/profiles[/:id]`, `POST /learning/profiles/:id/mapping`, `/reset`, `POST /learning/profiles/merge`; `GET /learning/stats`, `POST /learning/refresh-model`, `GET /learning/mapping?name=`; `GET /learning/historical-files/:id/data`, `DELETE /learning/historical-files/:id`; `GET/POST /settings`, `POST /settings/google/disconnect`; `POST /distributors`, `api.saveContact(...)`; `GET /messaging/qr`, `POST /messaging/reconnect`/`/logout`/`/login-window`/`/send`; `POST /wa-business/test`; `GET /settings/telegram-status`; `GET /pharmarack/session-status`, `/auto-verify`, `POST /pharmarack/login-window`/`/logout`.

**Backend — `src/routes/learning.ts`** (453 lines):
- `POST /` — logs an arbitrary payload to `action_logs` (type `LEARNING_DATA`) — a stub/placeholder, not fully wired to a real learning pipeline.
- `POST /analyze` — a **rule-based, non-AI** column-header pattern matcher for legacy import files, explicitly documented in the code as "an alternative to Claude AI" — i.e. this endpoint deliberately avoids calling out to any LLM API, presumably for cost/offline reasons, and instead uses hand-written heuristics.
- `POST /apply-model` — also just logs to `action_logs` (type `LEARNING_APPLY`) — another stub.
- `GET /stats` — cached via `getSummaryCache('learning_stats')`, falling back to `rebuildLearningStatsCache()` if the cache is cold.
- `POST /refresh-model` — **a misleadingly-named endpoint**: it logs a `REFRESH_MODEL` action to `action_logs`, but **no actual machine-learning retraining occurs**. Worth knowing before assuming this button does more than it does.
- `GET /mapping?name=` — looks up the `ocr_corrections` table for a previously-corrected name, joined to `medicines`, feeding the OCR sandbox test.
- `GET /profiles` — joins `distributors` + `distributor_learning_profiles` + an aggregated count/status of `distributor_historical_files`.
- `GET /profiles/:distributorId` — that distributor's full detail plus its historical files.
- `POST /profiles/:distributorId/mapping` — upserts `distributor_learning_profiles.file_mapping_rules` (stored as a JSON blob).
- `POST /profiles/:distributorId/reset` — deletes historical files from disk and DB, deletes the learning-profile row.
- **`POST /profiles/merge`** — re-links `purchases`, `purchase_orders`, `returns`, `distributor_payments`, `distributor_payment_details`, and `distributor_historical_files` from a secondary distributor ID to a primary one, deletes the secondary distributor row, and syncs its phone number into `pharmarack_distributors` — a genuinely careful, multi-table merge operation for cleaning up accidental duplicate distributor entries.
- `GET/DELETE /historical-files/:fileId[/data]`.
- `GET /dashboard-stats` — counts across `ocr_corrections`, `medicine_aliases`, `distributor_medicine_aliases`, `pharmacist_corrections`, `medicines`.

**Gmail configuration, confirmed precisely**: the frontend reads/writes `settingsData.gmail_user`, `gmail_pass`, `gmail_auth_method` directly through the **generic** `POST /settings/save` endpoint (handled in `src/routes/settings.ts`, not `learning.ts` — the Learning *page* owns the UI, but the Settings *route file* owns the persistence, an important distinction for anyone debugging this). `POST /settings/google/disconnect` explicitly runs `DELETE FROM app_settings WHERE key IN ('gmail_oauth_refresh_token','gmail_oauth_access_token','gmail_oauth_token_expiry','gmail_user','gmail_pass','gmail_auth_status', ...)` — unambiguous confirmation that **Gmail credentials are literally rows in the generic `app_settings` key/value table**, not a dedicated credentials table, not an environment variable, not a config file on disk.

**Data flow (configure Gmail)**:
```
User: Learning → Operations tab → "Configure Scanner"
  → enters Gmail User + App Password
  → handleSaveConfig() → apiClient.post('/settings/save', settingsData)
  → src/routes/settings.ts POST /save upserts each key
    (gmail_user, gmail_pass, gmail_auth_method, ...) into app_settings
    via INSERT OR REPLACE
  [next IMAP poll cycle, independent of this request]
  → emailService.ts buildImapConfig()
      → SELECT value FROM app_settings WHERE key IN ('gmail_user','email_user','store_email')...
      → picks up the newly-saved value
      → attempts an IMAP connection
```

**Confirmed fail-silent design, traced precisely**: `emailService.ts::buildImapConfig()` (~line 2888) checks the auth method: if it isn't `oauth2` and either `gmail_user` or `gmail_pass` is missing, it **logs** `"[Sync] Gmail App Password authentication selected but user or password not configured."` and returns `{imapConfig: null, isConfigured: false}` — **no throw, no user-facing alert of any kind.** `syncEmails()` (~line 2984) checks `isConfigured` and, if false, simply logs `"[Sync] IMAP not configured, skipping sync."` and returns early. The **same independent re-check pattern** guards `getImapStatus()` (~line 3205) and other IMAP-dependent methods (~line 3330) — **every single entry point re-derives "am I configured" from scratch rather than caching one shared flag**, which means there is no single place where a "Gmail is broken" state gets set and could be surfaced proactively; each caller has to independently notice and handle it. Practically: a misconfigured Gmail account degrades the email-sync feature to complete silence in the logs, with **no popup, no dashboard alert, no red badge** — anyone debugging "why isn't email sync running" needs to know to check the Learning page's connectivity indicator or grep the server logs, because the app itself won't tell them.

### 6.4 Settings (`frontend/src/pages/Settings/index.tsx`, 2541 lines)

**Purpose**: General app settings — pharmacy profile, mobile-app pairing, backups, storage locations, monthly WhatsApp report scheduling, data-fetch-mode control, admin/security, and reset/cache utilities. **Explicitly and deliberately excludes** Gmail/WhatsApp/WhatsApp-Business/Pharmarack/distributor credential editing.

**The exclusion is intentional and documented**: a code comment at line 658 states this explicitly, citing an internal bug-fix plan reference ("SMALL_BUG_FIX_PLAN.md P0-02") — those credential fields are **Learning-owned** and must never be resubmitted from this page, because doing so would risk **clobbering Learning's last save** with stale form data. This is a real bug this design choice prevents, not a hypothetical: if Settings' save payload included, say, a blank `gmail_pass` field (because Settings' own form never loaded that value in the first place), submitting it would wipe out a working Gmail configuration set up on the Learning page moments earlier.

**Full feature list**:
- Pharmacy Details card: name, address, phone, Owner WhatsApp Number, GSTIN, drug license, email.
- Android APK download and remote-pairing modal (`MobileConnectionModal`).
- "Distributor Layouts & Contact Directory" — **a deep-link banner only**, redirecting to `/learning?tab=distributor_layouts`; there is no actual distributor-editing UI on this page itself, reinforcing that distributor management is entirely Learning's domain.
- Storage Locations CRUD (name/code/type/description/default-flag/active-flag) against `/settings/storage-locations`.
- Session Refresh Audit Logs (a history of Pharmarack token-refresh events) plus a manual re-authentication trigger.
- Monthly Report scheduling: period type (monthly/mid-month/quarterly/yearly/custom), delivery format, chart style, template theme, plus preview/send-now/download-sample/send-all-samples actions.
- **Backup Center** (`BackupCenterContent` component): create a backup on demand, schedule a recurring backup frequency, list/restore/delete existing backups.
- **Data Fetch Control**: per-page fetch-mode toggles (`DATA_FETCH_REGISTRY`), persisted as one JSON blob under the `data_fetch_control` setting — this is the mechanism behind every `useFetchMode('page.feature')` gate referenced throughout this audit (Mail's IMAP polling, CompositionQueue's status poll, Learning's hover-prefetch, etc.) — a **single central admin control surface for turning off background polling/fetching per feature**, presumably useful for low-bandwidth or low-power situations.
- Admin/security: reset the admin-authorized device, a factory reset (requires typing "RESET" to confirm, and shows live row counts across tables *before* the user confirms, so they know exactly what they're about to lose), clear cache.
- Desktop notification permission toggle.
- WhatsApp Business API test plus webhook-URL copy — **present here too**, as a distinct control from Learning's WhatsApp Web QR-pairing flow (the two WhatsApp paths, per §4.5, genuinely are separate systems, and this duplication of test controls across two pages reflects that).

**Complete API map**: `useSettingsQuery()` → `GET /settings`; `apiClient.post('/settings/save', payload)` (the main save, explicitly omitting gmail/whatsapp/wa-business/pharmarack keys); `GET/POST/PUT/DELETE /settings/storage-locations[/:id]`; session-refresh log/reauth endpoints under `/pharmarack/*`; monthly-report preview/send endpoints under `/reports/*`; backup endpoints under `/utilities/backup*`; `POST /security/admin/reset-device`; data-utility endpoints under `/utilities/data-counts`, `/reset-data`, `/clear-cache`; `POST /wa-business/test`; `POST /pharmarack/login-window`/`/logout`; `POST /messaging/reconnect`/`/login-window`, `GET /messaging/qr` (polled every 15 seconds while WhatsApp is enabled and the page is visible).

**Backend — `src/routes/settings.ts`** (601 lines):
- `GET /` — `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)` (defensive schema-ensure on every read), then `SELECT * FROM app_settings` flattened into a key/value object. Injects `google_client_id`/`google_client_secret` from `process.env` **only if not already present in the DB** — environment variables act purely as a fallback default; once a value is set in the DB, the DB always wins on subsequent reads.
- `GET /:key`, `POST /` (single-key upsert) — with two special cases: `pharmarack_mode` is **always forced to `'Live'`** regardless of what value was submitted (suggesting a "Test mode" concept existed at some point and was deliberately disabled/removed as a safety measure — the setting can no longer be flipped away from Live even if a client tries); and the various pharmacy-name/phone key aliases (`shop_name`/`pharmacy_name`/`store_name`/`medical_name`, and `shop_phone`/`phone`/`store_phone`/`pharmacy_phone`) are **synchronized to every alias on a single write** — legacy code elsewhere in the app apparently reads different alias names for historically the same concept, and this sync keeps them all consistent rather than requiring every read site to be unified.
- **`POST /save` (bulk upsert)** — the same alias-sync logic, plus several genuinely important guards:
  - A `protectedKeys` list (`pharmarack_session_token`, `pharmarack_username`, `pharmarack_password`, `wa_business_access_token`) is **never overwritten with a blank value** — if the submitted payload has an empty string for one of these, the existing stored value is kept. This guards against exactly the "stale form wipes a working credential" risk that motivated excluding these fields from Settings' own UI in the first place — a defense-in-depth measure even though Settings' UI already avoids submitting them.
  - Triggers `emailService.pruneOldEmails()` if `email_retention_limit` changed.
  - Syncs `delivery_boy_*` fields into the `delivery_boys` table (up to 2 boys by name/phone) — the same legacy-compatibility mirroring noted in Dispatch (§4.1).
  - **Hot-reloads the Telegram bot** (`telegramBotService.initializeOrReloadBot()`) if Telegram-related keys changed in this save — no app restart required.
  - **Hot-reloads the WhatsApp client** (`initClient`/`destroyClient` from `whatsappClient.js`, with a routing decision via `shouldRouteToBusiness()`) if WhatsApp-related keys changed — same no-restart-required principle.
- `POST /upload-stamp`, `/upload-signature` — base64 image uploads into the uploads directory.
- **`GET/POST/PUT/DELETE /distributors[...]`, `/distributors/merge` are present in this route file too** — distributor CRUD is technically "dual-homed": the endpoints live in `settings.ts`, but the Settings **page's UI** never calls them directly (only the deep-link banner to Learning) — only Learning's UI actually exercises these routes. A slightly confusing code-organization quirk (the routes are grouped with Settings by file, but are functionally Learning's feature) worth knowing if searching for "where is distributor CRUD handled."
- `POST /google/disconnect` — deletes the Gmail OAuth/password key set, confirming the same `app_settings`-as-credential-store pattern from the Learning side.
- `GET/POST/PUT/DELETE /storage-locations[/:id]`.

**Data flow (edit the Owner WhatsApp Number)**:
```
User edits the field, clicks "Save Details"
  → handleSaveSettings() builds a payload object that EXPLICITLY excludes
    gmail/whatsapp/pharmarack keys (never even reads them from state)
  → POST /settings/save
      → upserts each submitted key into app_settings
      → syncs phone-field aliases
      → detects no WhatsApp/Telegram key changed → skips the hot-reload branches
  → updateSettingsCache(queryClient, payload)  [patches the ['settings'] RQ cache locally]
  → broadcastContactDataChanged(queryClient)
  → window.dispatchEvent('settings-updated') and ('phone-numbers-updated')
      [other mounted pages react without a full refetch — see §9.2]
```

**Why hot-reload rather than requiring an app restart**: because this is a long-running desktop app that a pharmacy leaves open all day, requiring a restart every time a WhatsApp or Telegram credential changes would be a real usability regression — hot-reloading the relevant client the moment its config changes keeps the "change a setting, it just works" expectation intact.

---

## 7. Database Schema (deep)

`src/database.ts` is the single file that owns schema creation, migrations (`ALTER TABLE` calls run at boot, guarded to be idempotent), and self-healing logic. Key tables, beyond what's already covered inline per-page above:

| Table | Purpose | Notable columns / design details |
|---|---|---|
| `medicines` | Master catalog | `pack_unit` and `pack_size` bolted on later via `ALTER TABLE` (lines ~711, ~815) — not in the original `CREATE TABLE`. `possible_duplicate_of` suggests a self-referential dedup mechanism exists at the schema level, feeding Database's (§3.5) and CatalogUpload's (§4.4) duplicate-detection UIs. |
| `inventory_master` | Physical stock per batch | `quantity` (packs) + `loose_quantity` (loose units) — the app-wide dual-unit fungible model. Composite indexes `(quantity, expiry_date, medicine_id)` and `(medicine_id, quantity, expiry_date)` exist specifically to keep filtered/sorted stock queries fast — the existence of *two* composite indexes with the same three columns in different orders implies two distinct hot query shapes were profiled and optimized for separately (one likely medicine-first for POS lookups, one likely stock/expiry-first for Inventory/Expiry page filtering). |
| `purchases` / `purchase_items` | Procurement records | Per-item GST breakdown (CGST/SGST/IGST rate *and* value columns each), `app_invoice_no` sequential internal numbering distinct from the distributor's own invoice number, `free_qty` (bonus units from the distributor, folded into saleable stock at purchase time), `scheme_per`/`scheme_value` and `cd_value` (cash discount) for the kind of trade-scheme pricing common in pharma distribution. |
| `sales_invoices` / `sale_items` | Sales records | Sequential `S-<year>-####` invoice numbering; `sales_bill_edit_history` (a separate table) captures before/after snapshots specifically for Investigation-driven corrections (§5.5), distinct from the general-purpose `action_logs`. |
| `returns` / `return_items` | Both supplier and customer returns | A single `returns` table serves *both* directions, disambiguated by `type` (`'purchase'` vs `'sale'`) and `return_sub_type` (`'expiry'`, `'good'`, etc.) — one schema, two very different business workflows layered on top via a type discriminator rather than two separate tables. |
| `stock_ledger` | Audit trail | `(medicine_id, batch_no, quantity, loose_quantity, transaction_type, transaction_id, business_date)`, indexed on `(medicine_id, batch_no)` — appears to be a append-only log distinct from both `action_logs` (free text) and `sales_bill_edit_history` (structured snapshots); likely the intended long-term source of truth for "every stock movement, ever," though Investigation's `/timeline` endpoint (§5.5) reconstructs its ledger view from raw transactional tables plus regex-parsed `action_logs` rather than reading `stock_ledger` directly — worth checking whether `stock_ledger` is fully populated by every write path or only some. |
| `medicines_fts` | Full-text search | SQLite **FTS5** virtual table (`fts5(name, content='medicines', content_rowid='id', tokenize='trigram')`) kept in sync via triggers on `medicines` insert/update/delete. Has explicit **self-healing logic** (`ensureMedicinesFts`) — a missing/corrupt shadow table (`medicines_fts_data`/`_idx`/`_docsize`/`_config`) previously broke *every single medicine insert* app-wide (see project memory: *medicines_fts blocks all inserts*) until this was fixed; the same repair function now runs again during Migration's finalize step (§3.6) since a staged database swapped in from an imported `.db` backup could easily carry a stale or corrupt index. |
| `app_settings` | Generic key/value config | The de facto home for **every** third-party credential in the app — Gmail, WhatsApp Business, Pharmarack session tokens, Telegram bot token, plus ordinary preferences like `refill_notice_days` and `email_retention_limit`, all living side by side as untyped string rows in one table. |
| `action_logs` | Free-text audit log | Dual/triple-purpose: a human-readable activity log, a data source for Dashboard's alert feed (`action_type='AUTOMATION_ALERT'`), and — via regex parsing — an input to Investigation's timeline reconstruction (§5.5, flagged as the audit's clearest technical-debt item). |
| `special_orders` | Customer back-orders | Written by CRM, cross-referenced by Inventory (badge on matching rows), and auto-updated by PharmarackCart (fuzzy-matched `Pending → Ordered` transition when a matching order gets sent to a distributor) — see §9.6. |
| `delivery_boys` | Delivery staff roster | The nominal single source of truth for delivery-staff contact info, though `app_settings.delivery_boy_phone`/`delivery_boy_whatsapp` are still mirrored on every save for legacy-compatibility reasons (§4.1, §6.4). |
| `distributor_catalog` | Offline Pharmarack catalog mirror | `UNIQUE(store_id, product_name)`, populated by the daily 3 AM sync cron (§4.5) — logically distinct from `medicines` (the pharmacy's own owned catalog). |
| `catalog_jobs` / `catalog_mappings` | Bulk catalog import pipeline | Job-status state machine plus a "learned" column-mapping cache keyed by sorted header set, so re-uploading a file from a distributor whose layout has been seen before auto-suggests the same mapping (§4.4). |
| `email_order_reviews` | Manual email-order review queue | Written by `emailService.processEmail()` as the safety-driven replacement for auto-importing purchase orders from email (§5.2) — currently backend-only, not yet surfaced in any frontend page. |
| `patient_refills` | Refill scheduling | Drives CRM's Refills tab (§5.1); `is_active` doubles as the pause/resume flag rather than a separate status column. |
| `compliance_logs` | Schedule H1/H/X register | `schedule_type` values inconsistently seeded across at least two historical write conventions (§5.3) — a live example of what happens when a table is written to from multiple code paths without a shared constant/enum enforced at the application layer. |

### 7.1 Why SQLite + FTS5 instead of a client-server DB with a dedicated search engine

This is worth stating once, clearly, since it explains so much of what's structurally unusual across this audit: the entire application is designed to run **offline, on a single desktop machine, per pharmacy** — there is no server to install Postgres on, no DBA, no guaranteed network connection. SQLite needs no server process, backs up as a single copyable file (which is exactly what Migration's whole-file-swap strategy and Settings' Backup Center both lean on), and FTS5's trigram tokenizer gives "good enough" fuzzy medicine-name search without needing Elasticsearch, Meilisearch, or Typesense running alongside it.

**The tradeoff is visible everywhere in this audit**: hand-rolled fuzzy scoring (`scoreProductName()`/`enhancedSimilarity()` in §4.5) instead of a search engine's built-in relevance ranking; a hand-rolled sharded-JSON cache for Expiry (§3.4) instead of a proper materialized view or Redis; manual FTS index corruption-detection-and-repair logic (`ensureMedicinesFts`) instead of a search engine's own operational tooling. None of these are wrong choices given the offline-first constraint — they're the necessary cost of getting SQLite-level operational simplicity while still needing search-engine-like features.

**If the product ever adds a "sync to the cloud" or multi-location feature**, the natural evolution path is **libSQL/Turso** (SQLite-file-compatible, adds optional server-side replication) rather than a wholesale migration to Postgres — it would preserve every offline-first assumption baked into the current codebase (the whole-file backup/restore/migration strategy, in particular) while adding sync as an additive capability rather than a rewrite.

---

## 8. Cross-Cutting Architectural Patterns

### 8.1 Module-level variable caching vs. React Query — an inconsistency worth naming precisely

The majority of pages in this audit (Dispatch, PharmarackCart, NonMappedDistributors, CRM, Reports, Mail, and others) declare **plain module-scope variables** (`cachedOrders`, `cachedDistributors`, `cachedRefillsData`, `cachedReportsMap`, etc.) *outside* the React component, so that when `KeepAliveOutlet` (§1.2) keeps a page mounted and the user navigates back to it, the component's closures still reference the same in-memory data without any fetch at all.

A smaller set of pages (CatalogUpload, Investigation, and parts of Settings/Learning) use **`@tanstack/react-query`** properly — with real cache keys, `staleTime`, and explicit `invalidateQueries`/`setQueryData` calls, often driven by SSE events.

**Both patterns achieve the same practical goal** (instant re-mount, no loading flicker) given `KeepAliveOutlet` already keeps components alive — but a new engineer has to learn **two entirely different mental models** depending which page they're editing: "is this page's data a plain variable I need to manually keep in sync, or a query-cache entry I invalidate by key?" There's no way to tell which pattern a given page uses without opening its source file. **If this is ever worth a dedicated cleanup pass**, standardizing on React Query everywhere (treating the module-level-cache pages as the ones needing migration, since React Query already handles the "keep working with `KeepAliveOutlet`" case just fine, per CatalogUpload's example) would collapse this to one mental model — a real but non-urgent refactor given every individual page currently works correctly.

### 8.2 Strict inventory-only sales — enforced identically at every insertion point

Confirmed, not assumed: the exact same pattern —
```
currentTotalUnits = currentStock.quantity * packSize + currentStock.loose_quantity
soldTotalUnits    = soldQty * packSize + soldLoose
if (currentTotalUnits < soldTotalUnits) throw new Error(`Insufficient stock for "..."`)
```
— appears independently at five separate points in `src/routes/sales.ts`: new-sale creation, hold-bill, sale update, device-sync, and staged-sale approval. No code path in the sales cluster auto-creates stock to satisfy a sale; an unresolvable medicine/batch throws rather than silently substituting or fabricating inventory. This is a standing project rule (confirmed in project memory as *strict inventory-only sales*), and this audit found it correctly and consistently implemented everywhere it should be — **with the one exception of Returns/CustomerReturn's stock-restoration paths bypassing the shared `applyStockDelta()` helper** (§2.4, §2.5) in favor of direct `quantity ± N` updates, which is a divergence in *implementation* rather than *policy* (the policy — never fabricate stock or money — is still upheld by both routes' own explicit guards, just via separately-written code rather than the shared utility).

### 8.3 Deliberate "stage for human review" — a repeated, intentional design philosophy

Two functionally unrelated features independently arrived at the same design pattern, and the code comments in both cases confirm it was a **deliberate correction after a fully-automated version caused real problems**:
- **Email-derived purchase orders** (§5.2) — `email_order_reviews`, replacing an earlier `processMedicineOrder()` function explicitly described in code as one that "fabricates pricing and auto-writes inventory data."
- **Ambiguous medicine-composition matches** (§5.4, CompositionQueue) — a human-curated token-chip UI gates every external Google-search enrichment call rather than letting the system guess.

This is not a coincidence or an inconsistent style choice — it's a recurring, deliberate stance in this codebase: **when automation's failure mode is silently wrong data (fabricated pricing, wrong drug composition), the system defaults to staging the result for a human to confirm rather than committing it automatically.** Anyone adding a new AI/automation feature to this app should treat "stage for review, don't auto-commit" as the established house style unless there's a specific reason a given feature is safe to fully automate.

### 8.4 The pack+loose fungible stock model, and where it's *not* honored

`applyStockDelta()` (`src/utils/stockRebuild.ts`) treats a batch's stock as one fungible pool of base units (`quantity * packSize + loose_quantity`), correctly handling partial-strip math (selling 1.5 strips decrements one whole pack and converts the remainder into loose units, with floor/modulo re-splitting). This is used consistently across the entire Sales cluster (§2.1-2.3) and by Investigation's correction endpoints (§5.5). **Returns and CustomerReturn (§2.4, §2.5) do not use it** — they adjust `quantity` directly and never touch `loose_quantity`. In practice this is low-risk today (returns are typically whole-strip quantities), but it's the one clearly-identified spot where "the same conceptual operation (adjust stock) is implemented two different ways in two different files," and it's worth unifying onto `applyStockDelta()` if loose-unit returns ever become a real use case.

### 8.5 WhatsApp: paced, randomized, multi-path — never synchronous in a request handler

Every automated WhatsApp send in the app goes through `whatsappQueueWorker`'s persistent queue table with jittered 8-12s delays, never fired directly and synchronously from inside an Express route handler. `pharmarackDailyDispatchService.ts` goes further, randomizing its entire daily send-window and rotating that randomization pattern every 45 days specifically to avoid a bot-detectable fixed cadence (§4.5). This is real, deliberate engineering investment against a specific operational risk (an unofficial WhatsApp Web session getting flagged/banned), not incidental complexity.

### 8.6 Offline-first, sync-when-possible, for every external integration

Every third-party integration in this app degrades gracefully rather than blocking core pharmacy operations when it's unavailable:
- **Gmail** — IMAP polling silently no-ops if unconfigured (§6.3), core sales/purchases/inventory are entirely unaffected.
- **Pharmarack** — session-token-gated; when no live session exists, `POST /pharmarack/cart/add` returns a clear `NEED_LOGIN` error rather than failing mysteriously, and the offline `distributor_catalog` cache (§4.5) still lets staff *search* even without a live session (they just can't add-to-cart until re-authenticated).
- **Google Search enrichment** (CompositionQueue, CatalogUpload) — rate-limited with a visible daily quota display, never silently retried into a cost overrun.
- **WhatsApp** — the manual `wa.me`-link fallback (§4.2, §4.5) means messaging never fully breaks even if the automated session is down.

The one place this pattern is arguably *too* silent is Gmail's fail-open/fail-silent design (§6.3) — every other integration in this list gives *some* signal (a `NEED_LOGIN` error, a visible quota counter, a connectivity badge), whereas a misconfigured Gmail account produces no user-facing signal at all beyond a badge on the Learning page that the user has to know to check.

### 8.7 A single shared "Universal Medicine Edit" modal as an integration point

`UniversalMedicineEditModal` is reused, unmodified, across Inventory (§3.1), Purchases (§3.2, via F8/Alt+E), Sells (§2.2), and Database (§3.5) — all four pages that need to edit a medicine record open the exact same component, which PUTs to the exact same endpoint (`/inventory/medicines/:id/quick-edit`). This is good reuse: one edit surface, one 26-field endpoint, rather than four slightly-different edit forms drifting apart over time. It's the cleanest example of intentional cross-page consistency in an otherwise fairly divergent (page-by-page) codebase.

---

## 9. How Pages Talk To Each Other — the full data-handoff map

This section exists because "how pages pass data with each other" is a question the per-page sections above only answer piecemeal. There are **seven distinct mechanisms** by which one page's action affects another page's state in this app, and knowing which one is in play matters when debugging why something didn't update. Listed from most explicit/traceable to most implicit.

### 9.1 Mechanism 1 — React Router navigation state (`navigate(path, { state })`)

The most explicit handoff: one page builds a JavaScript object, calls `navigate()` with it, and the destination page reads `location.state` on mount. This is a **one-shot, non-durable** handoff — refreshing the destination page loses the data, because it was never persisted anywhere, only passed in memory through the router.

| From | To | Payload | Purpose |
|---|---|---|---|
| Mail (§5.2) | Purchases (§3.2) | `{ prefilledPurchase, emailSource }` | Hand off a parsed email attachment's line items so the user can review/save them as a real purchase |
| Purchases (§3.2) | SellPriceConfig (§3.7) | `{ saved_items, invoiceNo }` | Immediately after saving a bill, offer to set custom sell prices for what was just purchased |
| PurchaseHistory (§3.3) | Purchases (§3.2) | `{ prefilledPurchase, editPurchaseId }` | Load an existing purchase into the editor for corrections |
| Expiry (§3.4) | Returns (§2.4) | `{ prefilledReturnItems }` | Pre-select near-expiry batches the user just checked off, as items to return to the distributor |
| CRM Refills tab (§5.1) | POS (§2.1) | prefilled cart / navigation to `/pos` | "Sell Now" on a due refill — jump straight to checkout with that medicine already in the cart |
| CRM Special Order Requests | Mail (§5.2) | `{ searchDistributor, searchProduct, orderId }` | Looking for the invoice email that would fulfill a specific back-order |

**Why this pattern rather than a shared store**: each of these is a genuinely one-directional, one-time handoff tied to a specific user action (not ongoing shared state) — React Router's navigation state is a reasonable fit precisely because nothing needs to persist beyond that single transition. The tradeoff (no durability across refresh) is accepted because these are all "continue what I was just doing" flows, not "resume this later" flows.

### 9.2 Mechanism 2 — Custom `window` events (pub/sub without prop-drilling)

Because `KeepAliveOutlet` (§1.2) keeps every visited page mounted simultaneously, plain browser `CustomEvent`s dispatched on `window` are an effective way for one mounted page to signal another without threading a callback through React Router or a context provider that would have to span totally unrelated page trees.

| Event name | Dispatched by | Listened to by | Effect |
|---|---|---|---|
| `refillEvent` (custom bus, not a raw CustomEvent) | CRM (refill pause/cancel/etc.) | CRM itself, possibly QuickAssistSidebar | Refresh the refills panel without a full remount |
| `toastEvent` | Anywhere (Learning, Settings, Reports, etc.) | `Layout.tsx`'s `FlashToast` | App-wide toast notifications from any page, without prop-drilling a toast function through the whole tree |
| `specialOrdersEvent` | CRM special orders actions | QuickAssistSidebar, PharmarackCart's sidebar quick-assist | Keep the pending-special-orders count/list in sync across the two places it's shown |
| `liveCartAddEvent` | CRM (refills "+ Live Cart" shortage shortcut) | PharmarackCart | Notify the cart page that an item was just added from outside its own UI |
| `settings-updated` | Settings (§6.4) after any save | Mail (connectivity badge), CRM, Layout header | Re-derive UI state that depends on settings without a full page reload |
| `phone-numbers-updated` | Settings (§6.4) | CRM, Layout, anywhere displaying a pharmacy/owner phone number | Same idea, scoped specifically to phone-number fields |
| `email-config-updated` | Learning (Gmail config save) | Mail's polling-gate logic | Mail re-checks IMAP connectivity immediately rather than waiting for its next scheduled poll |
| `pharmarack-qty-changed` | NonMappedDistributors (quantity stepper) | (internal to NonMappedDistributors) | A local-only signal, not actually cross-page, despite being a window event — likely implemented this way for consistency with the rest of the codebase's event style rather than out of necessity |
| `refresh-pharmarack-cart` | NonMappedDistributors, after a successful add-to-cart | PharmarackCart | Pick up a cart change made from the embedded/sibling search page |
| `WHATSAPP_WEB_EXTENSION_SEND` (window event + `postMessage`) | PharmarackCart's `openOrReuseWhatsappTab()` | An external browser extension (outside the app's own React tree entirely) | A hook point for browser-extension-based WhatsApp automation, coexisting with the backend queue path |

**Why events instead of a global state manager (Redux/Zustand/Context)**: given how independently-built each page appears to be (different caching strategies, different table implementations), a lightweight pub/sub bus that any page can fire-and-forget into without a shared store's setup overhead fits the codebase's actual (if not necessarily ideal) level of cross-page coupling. The cost is the same one any event-bus pattern has: there's no static, greppable guarantee that every dispatched event has a live listener, or that a listener hasn't silently stopped working after a refactor — these connections are only discoverable by reading both sides.

### 9.3 Mechanism 3 — Server-Sent Events (`/api/notifications/stream`)

A single SSE channel, subscribed to by `Layout.tsx` (centrally, per §1.5) and additionally by specific pages that need finer-grained live updates:

| Event type | Fired by (backend) | Consumed by | Effect |
|---|---|---|---|
| `email_update` | `email.ts` (`POST /email/`, `/email/attachments/parse`) | Mail | Live-refresh the inbox/attachment state without polling |
| `catalog_job_progress`, `catalog_job_update` | `catalogWorker.js` background jobs | CatalogUpload | Live progress bars and status-tile updates during a bulk import, without polling |
| `catalog_review_updated` | Catalog review approve/reject/enrich actions | CatalogUpload | Keep the review queue in sync if multiple review actions are in flight |
| `google_verification_required`, `google_verification_solved` | `compositionEnricher.js` worker | CatalogUpload | Surface (and clear) a manual-verification prompt if Google's search results need human confirmation mid-enrichment |
| `distributors_updated` | Learning's distributor merge/edit endpoints | Learning (invalidates `learning-profiles`/`learning-profile-detail` React Query keys) | If a distributor is merged or edited, Learning's own list refreshes even if the change originated from a different tab/action within the same page |

**Why SSE rather than WebSockets**: every one of these is a **one-directional, server-to-client** notification stream — the client never needs to send anything back over the same connection. SSE is the simpler protocol for exactly this shape of problem (plain HTTP, automatic reconnection built into the browser's `EventSource`, no separate WebSocket server/upgrade handshake to manage) and is a good fit given Express is already the HTTP server. WebSockets would only earn their extra complexity if the app needed true bidirectional real-time communication (e.g. live multi-user collaborative editing), which it doesn't appear to anywhere in this audit.

### 9.4 Mechanism 4 — Shared backend caches, invalidated across write paths

- **`inventoryCache`** (`src/services/inventoryCache.ts`) — a server-side cache invalidated by `.invalidate()` calls scattered across nearly every stock-writing route: Inventory's `PUT /:id`, Purchases' `/manual` and `/:id/full`, Sales' create/update/delete/staged-approve, Returns' `process-returns`, CustomerReturn's create, Investigation's three correction endpoints, and SellPriceConfig's bulk-price update. It's read back by POS and other pages needing fast compact-inventory lookups. This is the backend's single most-referenced shared mutable cache — essentially every "did stock change" event in the app funnels through invalidating it.
- **`invalidateAfterStockWrite(queryClient)`** — the **frontend-side** counterpart: a helper function called after essentially the same set of stock-mutating actions (POS checkout, Sells edit/delete, Returns, CustomerReturn, Investigation corrections, SellPriceConfig save) that busts the relevant React Query cache keys **app-wide**, so any other currently-mounted (recall: `KeepAliveOutlet` keeps *everything* mounted) page showing stock-derived data refreshes silently rather than showing stale numbers.
- **`getCompactInventoryCache()` / `isCompactInventoryCacheReady()`** — a lightweight, full-catalog, client-side cache (built from `GET /medicines/compact`) shared by POS, Purchases, Database, Returns, and CustomerReturn for instant local stock/price lookups while typing, without a server round-trip per keystroke.

### 9.5 Mechanism 5 — Shared components as de facto integration points

Beyond `UniversalMedicineEditModal` (§8.7), several components/hooks are reused across pages specifically because the underlying *data* they operate on is genuinely shared:
- **`AICamera`** — POS (medicine scanning at checkout) and Returns (`ai-camera/process`, scanning items being returned) — the same visual-capture pipeline serves two different downstream actions (sell vs. return).
- **`DateRangeFilter` / `usePersistedDateRange`** — Sells, CustomerReturnHistory, Reports — a consistent date-filtering UX and a consistent `localStorage` persistence key pattern (`<page>-date-range`) across every history/report screen.
- **`InfiniteTable` / `VirtualRow` / `useInfiniteScroll` / `useVirtualizer`** — Inventory, Investigation, Sells, PurchaseHistory, CustomerReturnHistory — the shared large-table infrastructure; any performance fix or bug fix to this shared layer automatically benefits all five pages at once (and conversely, a regression here affects all five simultaneously).
- **`pageModuleCaches` utilities** — a shared helper module (`utils/pageModuleCaches.ts`) that at least Dispatch and PharmarackCart build their module-level caches through, rather than each page reinventing the "declare a module-scope variable" pattern from scratch.

### 9.6 Mechanism 6 — Direct coupling through shared database tables (no API layer between them)

Some pages "communicate" purely because they read/write the same table, with no explicit API contract between them at all — this is the most implicit and hardest-to-trace mechanism, but genuinely load-bearing:
- **`special_orders`** — created/managed on CRM's Special Orders tab; **badged** on Inventory rows (§3.1) by name match; **auto-transitioned** `Pending → Ordered` by PharmarackCart's batch-send flow (§4.2) via fuzzy product-name matching; **counted** on Dashboard's "Pending Special Orders" tile (§6.1). Four pages, one table, zero direct API calls between any of them — the coupling is entirely at the SQL level.
- **`purchase_items`** — written by Purchases on bill save; **mirrored into** by Inventory's `PUT /:id` whenever a batch/expiry/MRP correction happens (§3.1), so a correction made on the Inventory screen retroactively updates what Purchases/PurchaseHistory show for that same batch.
- **`action_logs`** — written by a large number of routes (Investigation's corrections, Migration, Dispatch's automated notifications, generic settings/learning stub endpoints) and **read** by Dashboard (the alerts feed) and Investigation (the audit-trail panel and, more fragile, the regex-parsed timeline — §5.5, §8.3).
- **`delivery_boys`** — CRUD'd on Dispatch; **read** by PharmarackCart (phone resolution for batch sends) and Learning (delivery-related config); **mirrored into** `app_settings` on every Settings save (§6.4) for legacy call sites that haven't been migrated to read the table directly.
- **`compliance_logs`** — written by both Compliance's own `POST /add-schedule-h1` and, per the endpoint's naming and intent, by the POS/sales flow itself at the moment a Schedule H1 drug is sold (this specific write-time call site sits in the Sales cluster's code, outside what was directly traced in §2, but the route's existence and naming make the integration clear).
- **`app_settings`**, as covered extensively in §6.3/§6.4, is the shared credential/config store that Learning writes to and `emailService.ts`, `whatsappClient.ts`, `telegramBotService`, and the Pharmarack integration all read from independently — the ultimate example of "communication" via a shared table rather than an API contract.

### 9.7 Mechanism 7 — Background worker/queue coordination

- **`whatsappQueueWorker`** — items enqueued from Dispatch (`enqueue-distributor-collection`), PharmarackCart (`enqueue-pharmarack-batch`), and CRM (refill reminder sends); consumed by **one** worker poll loop regardless of which page enqueued them; its live status is polled independently by PharmarackCart (every 3.5s), Settings, and Learning (WhatsApp QR/status sections) — three different pages watching the same underlying queue state, each on its own polling cadence.
- **`catalogWorker.js`** (`runCatalogAnalysis`/`runCatalogImport`) — invoked from `upload.ts` and `catalog.ts`, progress surfaced back to CatalogUpload exclusively via the SSE channel (§9.3) rather than polling.
- **`compositionEnricher.js`** worker — invoked from **both** CompositionQueue's `trigger-online` endpoint (§5.4) and CatalogUpload's review-pane enrichment action (§4.4) — **one shared enrichment worker, two independent frontend entry points**, meaning a change to the enrichment worker's behavior (rate limiting, scoring, screenshot capture) affects both pages' review experiences simultaneously even though they're otherwise unrelated features.

### 9.8 Putting it together — a worked example spanning five pages

To show these mechanisms compounding in a single real workflow: a distributor's invoice arrives by email, and by the time it fully lands in inventory, it has passed through five different pages using four of the seven mechanisms above.

```
1. Mail (§5.2) syncs Gmail (background poll, gated by Settings' Data Fetch Control §6.4)
2. Staff reviews the email, clicks Process
   → Mail navigates to Purchases with { prefilledPurchase, emailSource }      [Mechanism 1: router state]
3. Purchases saves the bill
   → POST /purchases/manual writes purchase_items + inventory_master
   → inventoryCache.invalidate() (backend)                                    [Mechanism 4: shared cache]
   → invalidateAfterStockWrite(queryClient) (frontend)                        [Mechanism 4: shared cache]
   → navigates to SellPriceConfig with { saved_items, invoiceNo }             [Mechanism 1: router state]
4. SellPriceConfig saves custom sell prices
   → POST /inventory/bulk-sell-prices → inventoryCache.invalidate() again
5. Back on POS (already mounted, per KeepAliveOutlet §1.2), the compact
   inventory cache (getCompactInventoryCache, §9.4) is now stale and gets
   refreshed on next access — the newly purchased stock is sellable
   immediately, with correct pricing, with no manual refresh anywhere
   in this chain.
```

No single page in this chain "knows" about the whole flow — each one only knows its own immediate handoff (Mail knows about Purchases; Purchases knows about SellPriceConfig; every stock-writer knows about `inventoryCache`). The coherent end-to-end behavior is an emergent property of these seven mechanisms being applied consistently, not the result of any one page orchestrating the others.

---

## 10. Summary Table — All 27 Pages At A Glance

| Page | Primary Purpose | Backend Route File(s) | Primary DB Tables | Hands data to (§9) | Receives data from (§9) |
|---|---|---|---|---|---|
| POS | Checkout / cart / invoice creation | `sales.ts`, `verification.ts` | `sales_invoices`, `sale_items`, `inventory_master`, `customers` | Compliance (H1 sales), CompositionQueue (unmatched-medicine deep link) | CRM (refill "Sell Now"), Mail→Purchases chain (indirectly, via stock) |
| Sells | Sales/invoice history & edit | `sales.ts` | `sales_invoices`, `sale_items`, `inventory_master` | — | POS (every completed sale) |
| PhoneSales | Phone-order approval queue | `sales.ts` (staged) | staged-sales table, `sales_invoices`, `sale_items` | — | — |
| Returns | Supplier returns hub (+ embeds CustomerReturn) | `returns.ts` | `returns`, `return_items`, `inventory_master` | — | Expiry (`prefilledReturnItems`) |
| CustomerReturn | Refund against an original invoice | `customerReturns.ts` | `returns`, `return_items`, `sales_invoices`, `sale_items` | — | — |
| CustomerReturnHistory | Return audit trail (read-only) | `customerReturns.ts` | `returns`, `return_items` | — | CustomerReturn (every processed return) |
| Inventory | Live per-batch stock view/edit | `inventory.ts` | `inventory_master`, `medicines`, `purchase_items` | — | Purchases/Sales/Returns (every stock write), CRM (special-order badge) |
| Purchases | Purchase bill (GRN) entry | `purchases.ts` | `purchases`, `purchase_items`, `inventory_master`, `medicines` | SellPriceConfig | Mail, PurchaseHistory |
| PurchaseHistory | Past purchases + email reconciliation | `purchases.ts` | `purchases`, `purchase_items` | Purchases (edit handoff) | — |
| Expiry | Near-expiry/expired stock monitor | `expiry.ts` | `inventory_master` (+ month-sharded JSON cache) | Returns | — |
| Database | Master medicine catalog | `medicines.ts` | `medicines`, `purchase_items` (read-only join) | — | CatalogUpload (embedded) |
| Migration | Legacy data import (staged DB swap) | `migration.ts` | all tables, via a full staging-DB file swap | — | — |
| SellPriceConfig | Post-purchase sell-price wizard | `inventory.ts` (bulk-sell-prices) | `medicines` | — | Purchases (router state only, no GET) |
| Dispatch | Home-delivery orders + staff roster | `dispatch.ts` | `dispatch_orders`, `delivery_boys`, `automation_notifications` | — | — |
| PharmarackCart | Live B2B distributor ordering | `pharmarack.ts`, `whatsappQueue.ts` | `pharmarack_placed_orders`, `special_orders` (write), Pharmarack's live remote cart | `special_orders` (auto-flip to Ordered) | NonMappedDistributors, CRM (refill/special-order shortcuts) |
| NonMappedDistributors | Search/order from unmapped distributors | `pharmarack.ts` | `distributor_catalog`, Pharmarack's live remote cart | PharmarackCart | — |
| CatalogUpload | Bulk catalog import + review | `catalog.ts`, `upload.ts` | `catalog_jobs`, `catalog_mappings`, `medicines` | — | Database (embedded) |
| CRM | Refills, credit, special orders, messages | `refills.ts`, `crm.ts` | `patient_refills`, `special_orders`, `automation_notifications` | POS, PharmarackCart, Mail | — |
| Mail | Email invoice intake (manual review) | `email.ts`, `emailOrderReviews.ts` | `emails`, `email_order_reviews` | Purchases | CRM (special-order search prefill) |
| Compliance | Schedule H1/H/X drug register | `compliance.ts` | `compliance_logs` | — | POS (H1 sale write, inferred) |
| CompositionQueue | Medicine salt/composition matching | `enrichment.ts` | `medicines`, reference salt-master table | — | POS (unmatched-medicine deep link) |
| Investigation | Stock ledger forensics & corrections | `investigation.ts` | reads across `sales_invoices`/`purchases`/`returns`/`action_logs`; writes `inventory_master`, `sale_items`, `purchase_items`, `sales_bill_edit_history` | — | — |
| License | Desktop app DRM/activation | `license.ts` | none (Windows registry + external license server) | — | — |
| Dashboard | Home overview/KPIs | `dashboard.ts` | reads `sales_invoices`, `inventory_master`, `action_logs`, `special_orders`, `delivery_boys`, `emails` | — | (reads nearly every table, writes none) |
| Reports | Sales/inventory/expiry reporting | `reports.ts` | reads across `sales_invoices`, `purchase_items`, `inventory_master` | — | — |
| Learning | AI tuning + credentials hub | `learning.ts`, `settings.ts` | `app_settings`, `distributor_learning_profiles`, `ocr_corrections` | Settings, Mail (config-updated event) | — |
| Settings | General app config, backups, admin | `settings.ts` | `app_settings`, `storage_locations`, `delivery_boys` (mirror) | CRM, Mail, Layout (settings-updated event) | Learning (deliberately does NOT receive credential fields) |

---

## Closing Notes

This audit traced **every one of the 27 frontend pages** down to their exact backend endpoints, the SQL/tables each endpoint touches, and the concrete step-by-step data flow for a representative real user action per page — plus, in §9, a dedicated map of the seven distinct mechanisms pages use to communicate with each other, since that cross-page behavior is the hardest thing to reconstruct just by reading one file at a time.

**The handful of items worth prioritizing if this audit turns into a work plan, in rough order of impact**:
1. **Investigation's fragile regex-parsed audit trail** (§5.5, §8.3) — the one spot where a future unrelated change (rewording a log message) could silently break a compliance/forensics tool. Fix: a structured `metadata` JSON column on `action_logs`.
2. **Returns/CustomerReturn bypassing `applyStockDelta()`** (§2.4, §2.5, §8.4) — low risk today, but a real inconsistency that will matter the moment loose-unit returns become common.
3. **The `email_order_reviews` queue with no frontend surface** (§5.2) — the backend safety mechanism exists and works, but nothing in the UI currently shows it to anyone, so it's effectively invisible unless someone queries the database directly.
4. **Gmail's fully-silent failure mode** (§6.3) — every other integration in the app gives some visible signal when misconfigured; Gmail's doesn't, beyond a badge a user has to know to check.
5. **The module-level-cache vs. React-Query split** (§8.1) — not a bug, but a real long-term maintenance cost as the codebase grows, given it means learning two caching models depending which page you're in.

Everything else documented above — the offline-first SQLite architecture, the three-tier OCR strategy, the multi-path WhatsApp automation with deliberate anti-detection pacing, the staged-review philosophy applied twice independently, the whole-file-swap migration strategy — reads as **deliberate, reasoned engineering for this specific product's constraints** (a single-pharmacy, offline-capable, desktop-distributed application integrating with external platforms that were never designed to be automated), not accidental complexity. The open-source alternatives noted throughout are real options, not implied criticisms — in most cases the current choice is the right one for this product's actual constraints, and the alternative is flagged only because it would matter under a different set of constraints (e.g., a multi-location cloud-hosted version of this product, which would change several of these tradeoffs at once).
