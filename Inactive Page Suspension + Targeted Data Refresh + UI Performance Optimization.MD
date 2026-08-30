IMPLEMENTATION PLAN
TITLE: Inactive Page Suspension + Targeted Data Refresh + UI Performance Optimization

OBJECTIVE
Improve application responsiveness and reduce CPU/RAM usage by preventing inactive pages from continuing to perform unnecessary React rendering, listeners, timers, and data work.

IMPORTANT SCOPE RULE
- DO NOT modify the frontend UI design, layout, styling, colors, components, navigation appearance, or user-facing behavior.
- DO NOT modify unrelated features.
- DO NOT create unnecessary new files.
- DO NOT modify files outside the specific files directly responsible for page lifecycle/Keep-Alive behavior, React Query data lifecycle, SSE invalidation, and related page refresh handling.
- Before changing any file, verify that the file is directly involved in this feature.
- If a file is not required for this feature, DO NOT TOUCH IT.
- Preserve all existing functionality.
- Do not change database schemas, API contracts, WhatsApp automation logic, POS billing behavior, CRM behavior, inventory calculations, reports calculations, or business logic unless absolutely required for lifecycle handling.
- Do not change the frontend UI.
- The final implementation must behave visually exactly as it does now.

==================================================
1. CURRENT BEHAVIOR
==================================================

The application currently uses a Keep-Alive style architecture where previously visited pages can remain mounted after the user navigates away.

This can cause inactive pages to continue holding:
- React component state
- React effects
- event listeners
- SSE-related listeners
- timers
- subscriptions
- React Query observers
- background data processing

The global SSE system also receives backend events and invalidates/refetches related queries.

Examples:
- POS creates/saves a bill.
- Inventory changes.
- Purchase is created.
- CRM/refill data changes.
- WhatsApp queue/status changes.
- Reports-related data becomes stale.

The current architecture already attempts to reduce unnecessary refetching by using SSE and deferred invalidation, but inactive mounted pages can still consume browser resources.

The result can be:
- UI temporarily slow
- delayed clicks
- delayed page switching
- occasional freezing sensation
- increased CPU usage
- increased RAM usage
- unnecessary background React work

The application does NOT necessarily crash. The problem is primarily responsiveness and unnecessary background workload.

==================================================
2. EXPECTED BEHAVIOR
==================================================

Only the currently visible/active page should remain fully active.

When the user navigates away:

ACTIVE PAGE
→ page becomes inactive
→ page-specific effects stop
→ page-specific listeners stop
→ page-specific timers stop
→ page-specific React Query observers stop
→ page-specific background processing stops
→ UI resources are released

The page's DATA CACHE must NOT necessarily be deleted.

React Query/cache data should remain available according to the existing cache/stale-time strategy.

Therefore:

PAGE UI = can be unmounted/suspended
DATA CACHE = can remain cached

This is the key optimization.

==================================================
3. DATA REFRESH ARCHITECTURE
==================================================

Do NOT solve this by refetching the entire application whenever the user changes pages.

Use targeted invalidation/refetching.

Example:

POS saves bill
        ↓
Backend data changes
        ↓
Existing SSE event is received
        ↓
Only affected React Query keys become stale
        ↓
Inactive pages do NOT immediately refetch
        ↓
Current active page refreshes only if required
        ↓
User later opens Reports
        ↓
Reports reads cached data immediately when valid
        ↓
If stale, Reports performs its own required refetch
        ↓
Only Reports-required data is requested

Do NOT perform:
"POS changed → refetch every page → refetch entire database."

==================================================
4. REQUIRED PAGE LIFECYCLE MODEL
==================================================

Implement or adapt the existing page lifecycle system so that:

ACTIVE PAGE:
- mounted/active
- UI effects running
- required queries active
- required listeners active

INACTIVE PAGE:
- unmounted or suspended according to the safest existing architecture
- no unnecessary page-specific timers
- no unnecessary page-specific subscriptions
- no unnecessary query observers
- no repeated background rendering

Do not remove the global SSE connection.

The global SSE connection should remain a single application-level listener because it is responsible for receiving backend changes.

The optimization must happen at the page level.

==================================================
5. REACT QUERY REQUIREMENTS
==================================================

Preserve the existing React Query caching architecture.

Use:
- cache retention
- staleTime
- targeted query invalidation
- refetch only when the relevant page becomes active

Avoid:
- global refetchAll
- invalidating unrelated queries
- refetching all visited pages simultaneously
- deleting useful cache unnecessarily

When an SSE event affects multiple domains, invalidate only the query keys already associated with that event.

Example:

inventory_changed
→ inventory-related queries

sale_created
→ sales/dashboard/report-related queries that genuinely depend on sales

invoice_saved
→ purchase/inventory/report queries that genuinely depend on the invoice

refill_updated
→ refill/CRM queries

wa_queue_update / WhatsApp events
→ WhatsApp-specific state/events

Do not expand the invalidation map unnecessarily.

==================================================
6. WHATSAPP AUTOMATION REQUIREMENT
==================================================

WhatsApp automation must continue working even when the user changes pages.

Changing pages must NOT:
- stop WhatsApp automation
- stop the WhatsApp queue worker
- stop message delivery
- stop refill automation
- stop scheduled automation
- break SSE
- require the user to keep the CRM page open

WhatsApp background processing must remain application-level/background functionality.

Only unnecessary PAGE UI listeners/rendering should stop.

The WhatsApp Automation Hub UI should not remain actively rendering when it is not visible.

==================================================
7. POS / BILL SAVE REQUIREMENT
==================================================

The existing POS Save Bill behavior must remain fast.

After saving a bill:

Do NOT reload the entire application.

Only update/invalidate the relevant data.

For example:

Save Bill
→ backend saves sale
→ SSE/event is generated
→ relevant cache keys become stale
→ active pages that need the information update
→ inactive pages remain dormant
→ when user opens them, their required data is refreshed if stale

The user must not experience a full application refresh.

==================================================
8. REPORTS REQUIREMENT
==================================================

When user opens Reports:

- Reports should activate normally.
- Existing cached data should be reused where valid.
- Stale Reports data should refetch.
- Only Reports-required queries should execute.
- Other inactive pages must remain inactive.
- Do not refetch Inventory + POS + CRM + Purchase History + all other pages merely because Reports opened.

==================================================
9. PURCHASE HISTORY REQUIREMENT
==================================================

When user opens Purchase History:

- Activate Purchase History.
- Use existing cache when valid.
- Refetch only required stale Purchase History queries.
- Do not reload unrelated application data.
- Do not activate previously visited pages.

==================================================
10. CRM / REFILL REQUIREMENT
==================================================

CRM/refill automation must continue independently of the CRM page UI.

If a refill is generated:

Backend
→ event/SSE
→ refill-related cache becomes stale
→ CRM page updates when active
→ if CRM is inactive, do not force its entire UI to render/refetch continuously
→ when CRM becomes active, it reads/refetches the required current data.

==================================================
11. MEMORY / CPU REQUIREMENT
==================================================

The implementation must reduce unnecessary browser workload.

Target:

Before:
Multiple visited pages remain active
→ multiple effects/listeners/query observers
→ background rendering
→ more CPU/RAM
→ occasional UI lag

After:
Only active page remains fully active
→ inactive page resources released
→ cached data retained
→ targeted refresh
→ lower CPU/RAM
→ smoother navigation
→ faster UI response

Do not sacrifice correctness merely to reduce memory.

==================================================
12. FILE SCOPE CONTROL
==================================================

Before implementation:

1. Identify the exact existing files responsible for:
   - Keep-Alive/page lifecycle
   - page activation/deactivation
   - React Query page tracking
   - global SSE invalidation
   - related lifecycle hooks

2. Create a small list of ONLY those files.

3. Modify ONLY those files.

4. If a new helper is genuinely required, create it only inside the existing appropriate feature/module location.

5. Do not modify:
   - unrelated pages
   - UI components
   - CSS
   - database files
   - API business logic
   - WhatsApp worker logic
   - POS business logic
   - CRM business logic
   - Reports business logic
   - Inventory business logic

unless direct lifecycle integration requires a specific change.

Do not perform broad refactoring.

==================================================
13. UI PRESERVATION
==================================================

The visual UI must remain unchanged.

Do NOT change:
- layout
- colors
- fonts
- spacing
- buttons
- navigation
- cards
- modals
- animations visible to the user
- page design

This is a performance/lifecycle optimization only.

==================================================
14. SAFETY REQUIREMENTS
==================================================

Before changing code:

- Inspect the current lifecycle architecture.
- Identify how Keep-Alive works.
- Identify how PageQueryTracker works.
- Identify how global SSE invalidation works.
- Identify which queries are page-specific.
- Identify which listeners belong to individual pages.
- Identify which processes must remain global.

Do not assume architecture.

Use the existing implementation.

Preserve current functionality.

==================================================
15. CROSS-PAGE TESTING
==================================================

After implementation, verify at minimum:

TEST 1
Open POS
→ save bill
→ navigate to Inventory
→ verify inventory updates correctly.

TEST 2
Open POS
→ save bill
→ navigate to Reports
→ verify correct updated report data.

TEST 3
Open POS
→ create purchase
→ open Purchase History
→ verify latest purchase appears.

TEST 4
Open CRM
→ trigger refill-related activity
→ navigate elsewhere
→ verify automation continues.

TEST 5
Trigger WhatsApp automation
→ navigate between multiple pages
→ verify WhatsApp processing continues.

TEST 6
Visit 5–10 different pages
→ return to first page
→ verify navigation remains responsive.

TEST 7
Generate multiple SSE/backend events
→ verify only affected queries refresh.

TEST 8
Verify no full-page reload occurs during normal navigation.

TEST 9
Verify inactive pages do not continue unnecessary timers/listeners/query observers.

==================================================
16. PERFORMANCE VALIDATION
==================================================

Compare before vs after:

- Page switching responsiveness
- Click response
- CPU usage
- RAM usage
- Number of active React effects
- Number of active page listeners
- Number of React Query observers
- Number of API requests
- SSE event handling
- Time required to display cached page data
- Time required to refresh stale page data

The objective is:

FAST ACTIVE PAGE
+
DORMANT INACTIVE PAGES
+
RETAINED CACHE
+
TARGETED REFRESH
+
GLOBAL BACKGROUND AUTOMATION

==================================================
17. DO NOT OVER-OPTIMIZE
==================================================

Do NOT:
- remove caching
- disable SSE
- disable WhatsApp automation
- disable refill automation
- remove required background workers
- globally stop application events
- refetch everything on every navigation
- delete all cache on page change
- introduce unnecessary polling
- introduce new timers

The solution must be based on lifecycle management and targeted data refresh.

==================================================
18. FINAL CODE REVIEW REQUIREMENT
==================================================

After implementation, perform a strict self-review.

For every modified file, answer:

1. Why was this file modified?
2. Is this file directly related to page lifecycle/data refresh?
3. What exact behavior changed?
4. What existing behavior was preserved?
5. Could this change affect another feature?
6. Could this cause unnecessary refetching?
7. Could this stop WhatsApp/refill automation?
8. Could this cause stale data?
9. Does the frontend UI remain unchanged?

If any modified file is not directly necessary, revert that unrelated modification.

==================================================
19. REQUIRED FINAL REPORT
==================================================

After completing the code, provide a SHORT comparison:

OLD BEHAVIOR:
- Previously visited pages remained active.
- Their effects/listeners/query observers could continue running.
- SSE updates could create additional background work.
- CPU/RAM usage could increase.
- UI could occasionally feel slow/frozen.

NEW BEHAVIOR:
- Only the active page remains fully active.
- Inactive page UI resources are released.
- React Query cache remains available.
- SSE remains global.
- Only affected data becomes stale/refetches.
- POS, Reports, Inventory, Purchase History, CRM and WhatsApp continue working.
- WhatsApp/refill automation remains independent of page visibility.
- No frontend UI changes.

FILES MODIFIED:
List ONLY the exact files actually modified.

FILES NOT MODIFIED:
Confirm that unrelated files were not touched.

FINAL VERIFICATION:
Confirm that cross-page data updates, POS bill saving, Reports, Purchase History, Inventory, CRM/refill automation, WhatsApp automation, SSE updates, caching, and navigation were checked.

MOST IMPORTANT RULE:
DO NOT MODIFY ANY FILE SIMPLY TO "IMPROVE PERFORMANCE."
ONLY MODIFY FILES THAT ARE DIRECTLY REQUIRED FOR THIS PAGE LIFECYCLE + TARGETED REFRESH OPTIMIZATION.
DO NOT CHANGE THE FRONTEND UI.
DO NOT CHANGE BUSINESS LOGIC.
DO NOT CHANGE DATABASE STRUCTURE.
DO NOT CHANGE EXISTING USER WORKFLOWS.