The Infinite Loop: Performance Optimization & Global Verification Playbook

1. Hardware Context & The 200ms Mandate

In the operational context of a high-volume local pharmacy, latency is a systemic failure. We have mandated a sub-200ms response time for all core interactions to ensure the OS remains a tool, not a bottleneck. Achieving this on legacy hardware requires a brutal acknowledgement of physical constraints. Our architecture must be precision-engineered to accommodate the specific limitations of the 3rd-generation Intel i3 (Ivy Bridge) environment.

Target Hardware Baseline (Ivy Bridge Constraints)

Component	Specification	Technical Bottleneck
CPU	3rd-gen i3 (2 Cores / 4 Threads)	High contention between Express, workers, and Puppeteer sessions.
Storage	5400RPM HDD	Synchronous I/O operations (logs, WAL checkpoints) cause thread stalls.
Instruction Set	No AVX2 Support	OCR engines (Tesseract/ONNX) default to inefficient fallback paths.
Memory	4GB–8GB RAM	Sufficient for ~140MB idle, but vulnerable to eager module loading.

The lack of AVX2 support renders modern OCR acceleration impossible, making synchronous OCR operations a "killer" of UI responsiveness. Furthermore, the high cost of synchronous disk writes on 5400RPM HDDs dictates that we must move all non-critical I/O to asynchronous background streams. We will now address the root causes of the current performance degradation identified during the system audit.

2. Diagnostics & Root Cause Analysis (RC-1 to RC-4)

Diagnostic clarity is the only path to meaningful optimization. We reject "optimization theatre"—making aesthetic code changes that offer no measurable gain. The following four root causes are the primary drivers of system latency.

Detailed Root Cause Analysis

* RC-1: Chatty Database: The system originally triggered SQLITE_MISUSE crashes due to redundant connection openings across 33 routes. Without Write-Ahead Logging (WAL) and the DatabaseManager singleton handle, concurrent processes competed for file locks on the slow HDD, resulting in blocked transactions.
* RC-2: Chatty Frontend (Mount Saturation): Pages like the Point of Sale (POS) were observed triggering multiple concurrent API requests for separate items immediately upon mounting. This saturation overwhelms the limited CPU threads of the i3 and creates a queue at the SQLite single-writer bottleneck.
* RC-3: Blocking Render: Our audit identified monolithic files—specifically the 103KB App.tsx and the 112KB purchases.ts route—that block the main execution thread during parsing. Large, unvirtualized medicine lists force the browser to calculate thousands of DOM nodes simultaneously, leading to severe UI "jank."
* RC-4: Eager Loading: Heavy dependencies, including Puppeteer for WhatsApp and ONNX/Tesseract for OCR, are currently imported at startup. This inflates the initial memory footprint and delays the "Time to Interactive" (TTI) by several seconds on the target i3 baseline.

Symptom vs. Code Reality

Symptom	Code Reality
"Database is locked" during POS search	Multiple SQLite connections; lack of WAL mode and better-sqlite3 workers.
Blank white screens on route change	Monolithic 103KB App.tsx and 112KB purchases.ts blocking the thread.
5+ second boot time	Eager imports of WhatsApp/OCR modules at application entry.
UI freezes during stock scrolls	10,000+ DOM nodes rendered without @tanstack/react-virtual virtualization.

These findings necessitate the immediate execution of the 4-Phase Performance Master Plan to stabilize the OS core.

3. The 4-Phase Performance Master Plan (The 39-Point Strike)

We will stabilize the backend core before applying frontend polish. Every point below is mandated for sub-200ms compliance.

Phase 1: P0 Critical – Backend Core & Debounce (12 Items)

Goal: Eliminate I/O blocking and CPU contention.

1. Switch Workers to better-sqlite3: Migrate catalogWorker.ts and migrationWorker.ts to the synchronous driver. So What? Eliminates Promise/microtask overhead on 2-core i3 CPUs.
2. Implement Gzip Compression: Add compression() middleware to server.ts. So What? Reduces payload size for 435 endpoints, speeding up low-bandwidth local transfers.
3. Async Logging with pino: Replace 1,153 synchronous console.log calls. So What? Moves log I/O off the main thread, preventing 5400RPM HDD write stalls.
4. Singleton DatabaseManager Enforcement: Unify all connections in connection.ts. So What? Terminates SQLITE_MISUSE crashes.
5. Activate WAL Mode: Execute PRAGMA journal_mode = WAL. So What? Permits concurrent reads during active writes, essential for background sync.
6. Busy Timeout Extension: Set busy_timeout = 30000. So What? Prevents transaction failures during heavy background catalog imports.
7. Atomic Sale Transactions: Wrap sales.ts logic (invoice -> items -> stock) in dbManager.transaction(). So What? Ensures data integrity during power failures.
8. Email Connection Cleanup: Refactor emailService.ts with try/finally blocks for connections. So What? Prevents memory leaks and IMAP connection exhaustion.
9. WhatsApp/Telegram Queueing: Move all messaging to whatsappQueue.ts. So What? Decouples UI response from external network latency.
10. Environment-Driven API Keys: Remove hardcoded fallback keys from config/index.ts. So What? Mandates secure, unique keys for every installation.
11. Bcrypt Password Hashing: Hash all passwords in app_settings. So What? Secures local data against unauthorized SQLite file access.
12. Global Phone Sanitization: Enforce 10-digit stripping in settings.ts. So What? Prevents WhatsApp delivery failures due to +91 prefix drift.

Phase 2: P1 High – Frontend Latency & Mount Staggering (12 Items)

Goal: Reduce perceived latency and network saturation. 13. Route-Level Code Splitting: Implement React.lazy for all 25 active routes. So What? Reduces the initial JS bundle size from 500KB+ to <50KB. 14. Batched Medicine Search: Consolidate multiple queries in POS into a single network round-trip. So What? Prevents "request saturation" on mount. 15. Hover-Prefetching: Lazy load medicine metadata only when the user hovers over an item. So What? Reduces unnecessary background CPU cycles. 16. OCR Auto-Fill Integration: Map OCR results directly to medicineService.ts. So What? Minimizes manual typing and human error in data entry. 17. Dashboard Metric Staggering: Delay non-essential metrics by 500ms on load. So What? Prioritizes the "Sale" button rendering over secondary charts. 18. useDeferredValue for Search: Apply React 18 hooks to search inputs. So What? Keeps the input field responsive while the list filters. 19. Consolidated Save Payloads: Unify Settings and Learning save logic. So What? Prevents "last-writer-wins" data corruption between pages. 20. Fix 404 Prefix-Drift: Correct /medicines/online-search paths. So What? Restores broken search features previously returning 404 errors. 21. Client-Side Gzip Decompression: Ensure headers are correctly handled. So What? Offloads processing from the backend to the client. 22. Background Sync UI Feedback: Add progress indicators for catalog_job_progress. So What? Reduces user anxiety during long imports. 23. Search AbortController: Cancel stale API requests on new keystrokes. So What? Frees up backend worker threads immediately. 24. Pharmarack Token Caching: Store session tokens in app_settings. So What? Avoids unnecessary Puppeteer boots for already-authenticated sessions.

Phase 3: P2 Medium – Render Performance & Virtualization (12 Items)

Goal: Optimize DOM weight and UI reconciliation. 25. Virtualize Inventory List: Apply @tanstack/react-virtual. So What? Reduces DOM nodes from 10,000+ to ~20, preventing main-thread locks on i3 CPUs. 26. Virtualize Sells List: Apply virtualization to sales history. So What? Ensures smooth scrolling even with years of transaction data. 27. POS CartItem Memoization: Use React.memo for cart rows. So What? Prevents re-rendering the entire cart when a single quantity changes. 28. Module-Level Variable Caching: Cache medicine lists outside the React lifecycle. So What? Enables instant rendering during tab switches without loading spinners. 29. Extract Sidebar/Topbar from App.tsx: Modularize the layout. So What? Reduces the scope of React reconciliation during global state changes. 30. Fix usePageCache Layout Shifts: Enforce fixed-height containers. So What? Eliminates the "jumping" UI effect during data hydration. 31. Route-Level ErrorBoundary: Wrap each page in an error boundary. So What? Prevents a single component failure from crashing the entire SPA. 32. Throttled Scroll Listeners: Apply 16ms throttling. So What? Reduces CPU overhead during high-speed scrolling on integrated graphics. 33. Virtualize PurchaseHistory: Apply @tanstack/react-virtual to the history tab. So What? Maintains 60FPS UI responsiveness. 34. Inline SVG Optimization: Replace heavy icons with optimized paths. So What? Reduces the initial HTML parsing time. 35. Debounce Investigator Updates: Apply 300ms debounce to composition searches. So What? Prevents database "thrashing" during typing. 36. Portal-Based Modals: Move toasts and modals to Portals. So What? Prevents unnecessary re-renders of the background page tree.

Phase 4: P3 Low – Bundle Size & Dead Code (3 Items)

Goal: Lean out the final executable. 37. Purge src/routes/v1/sales.ts: Delete the 789-line orphan file. So What? Eliminates maintenance confusion and reduces disk footprint. 38. Delete src/services/nNotificationService.ts: Remove the typo-laden duplicate. So What? Ensures only the verified notificationService.ts is used. 39. Excise Unused Imports: Remove BrandBanner and PriceIntelPanel from POS/Purchases. So What? Reduces the compiled JS bundle size.

4. Single-PC Dev/EXE Separation & Safety

Running development and production instances on a single Windows host is a critical risk factor. We will enforce environment isolation.

Default Port Separation Fix

To prevent EADDRINUSE failures and proxy collisions, the system enforces:

* Port 5174: Development environment only.
* Port 5175: Packaged Executable / Production build.

Path-Scoped Lock Protocol

We will modify killOrphanChromeProcesses() and cleanupProfileLocks() to utilize absolute paths derived from getAppDataDir().

* Mechanism: Before launching Puppeteer for Pharmarack, the system must explicitly identify and remove SingletonLock files within the data/pharmarack_profile/ directory. This prevents the "Profile in use" crash that occurs when a background refresh collides with a manual session.
* Messaging Safety Layer: We will enforce a process.cwd() fallback fix in routes/messaging.ts. This ensures that WhatsApp session data is always written to the authenticated data directory, preventing session loss when the executable is launched from different system contexts.

5. Global Verification & Stability Layer

Stability is not a state; it is a continuously verified property. We are shifting to a proactive 12-step verification pipeline.

The 12-Step Verification Pipeline

1. Database Integrity: Execute PRAGMA integrity_check on every boot.
2. WAL Verification: Confirm journal_mode = WAL is active for the current session.
3. Schema Readiness: Gate all API traffic until ensureSchema() signals completion.
4. Table Presence Audit: Verify the existence of credit_notes, compliance_logs, and ocr_corrections.
5. POS Bill Integrity: Audit sale_items against sales_invoices to ensure no orphaned rows.
6. Stock Ledger Matching: Verify that every inventory deduction has a corresponding stock_ledger entry.
7. Tax Calculation Audit: Confirm GST/HSN application consistency across purchase_items.
8. License Fingerprint: Validate the machine fingerprint against the license_session_token.
9. WhatsApp Readiness: Check the whatsapp-web.js client state for READY status.
10. Pharmarack Token Health: Verify the 20-minute rolling token refresh timestamp.
11. Email IMAP Connectivity: Test poll status for the configured Gmail/IMAP host.
12. Worker Heartbeat Monitor: Confirm PONG responses from catalogWorker and emailPoller.

Self-Healing Patterns

If connection.ts detects database corruption, the system will automatically rename the file to .corrupt and restore from the most recent app.db.bak or compressed snapshot. This pattern ensures business continuity in the event of a hard power failure on a 5400RPM HDD.

6. The Agent Anti-Hallucination Execution Loop

Architectural refactors by AI agents require strict guardrails to prevent the invention of non-existent routes or tables.

1. Step 1: Pre-Implementation Checklist: The agent must verify the presence of the target file and lines in the current source context before proposing an edit.
2. Step 2: During-Phase Validation: Mandatory execution of node scripts/quick-update.mjs after every file change to keep the knowledge graph synchronized.
3. Step 3: Post-Phase Verification: Running the 12-step verification pipeline to confirm no regressions in shared utilities like dbManager.
4. Step 4: Regression Prevention: Explicitly forbid deleting code without consulting FEATURE-PAGE-REGISTRY.md to confirm the current active "home" of a feature.

The Master Writer Philosophy: We provide no simulated features. We only build with live data and documented structures. By adhering to this playbook, we will achieve the sub-200ms objective and deliver a professional, performant pharmacy OS.
