IMPLEMENTATION PLAN
TITLE: Final Inactive Page Suspension + Targeted Data Refresh + UI Performance Optimization

OBJECTIVE

Implement and verify the page-lifecycle performance optimization in AI-PHARMACY-v2 so that inactive pages do not continue consuming unnecessary browser resources, while cached data, SSE updates, POS, Inventory, Reports, Purchase History, CRM, WhatsApp automation, and all existing workflows continue working exactly as before.

The application UI must remain visually and functionally unchanged.

The objective is:

ACTIVE PAGE
→ fully responsive

INACTIVE PAGE
→ no unnecessary UI/runtime work

DATA CACHE
→ retained

SSE
→ remains global

BACKGROUND AUTOMATION
→ continues independently

DATA
→ remains accurate

CPU/RAM
→ unnecessary workload reduced

==================================================
1. ABSOLUTE FILE-SCOPE RULE
==================================================

THIS IS THE MOST IMPORTANT RULE.

DO NOT MODIFY ANY FILE BEFORE INSPECTING THE PROJECT AND PROVING THAT THE FILE IS DIRECTLY RELATED TO THIS FEATURE.

Only modify files directly responsible for:

- page lifecycle
- Keep-Alive behavior
- page activation/deactivation
- React Query page tracking
- React Query cache behavior
- global SSE invalidation
- lifecycle-related performance handling

The currently identified core files are:

1. frontend/src/lib/keepAlive/KeepAliveOutlet.tsx
2. frontend/src/lib/keepAlive/PageQueryTracker.tsx
3. frontend/src/hooks/useGlobalSseInvalidation.ts
4. frontend/src/lib/queryClient.ts

BUT:

DO NOT blindly assume these are the only files that may be required.

Inspect the repository first.

If another existing file is proven to be directly required, it may be modified.

If a file is not proven necessary:

DO NOT TOUCH IT.

==================================================
2. NO UNNECESSARY NEW FILES
==================================================

Do NOT create new files unless absolutely required.

Before creating any file:

- verify whether an existing related file can safely contain the required logic
- verify that the new file is genuinely necessary
- verify that it does not duplicate existing functionality

If no new file is required:

CREATE NONE.

Do not create:

- duplicate hooks
- duplicate query managers
- duplicate SSE systems
- duplicate Keep-Alive systems
- duplicate cache systems
- unnecessary utilities

==================================================
3. NO UI CHANGES
==================================================

The frontend UI must remain EXACTLY as it currently appears.

DO NOT change:

- layout
- sidebar
- navigation design
- buttons
- cards
- colors
- typography
- spacing
- icons
- animations
- modals
- tables
- forms
- page structure
- theme
- CSS
- Tailwind classes

This task is strictly an internal lifecycle/performance optimization.

The user should not visually notice a redesign.

==================================================
4. CURRENT BEHAVIOR
==================================================

Previously visited pages may remain mounted through the Keep-Alive architecture.

Inactive pages can therefore retain:

- React component trees
- DOM nodes
- React state
- useEffect execution
- event listeners
- subscriptions
- timers
- query observers
- background rendering
- page-specific processing

At the same time, the application receives global SSE events.

Examples:

POS saves a bill
→ sale/inventory event

Purchase created
→ purchase/inventory event

Inventory changed
→ inventory event

CRM/refill updated
→ refill event

WhatsApp queue/status changed
→ WhatsApp event

These events can cause React Query invalidation or page-related updates.

The result can be:

- temporary UI lag
- delayed clicks
- slow navigation
- intermittent freezing sensation
- increased CPU usage
- increased RAM usage
- unnecessary background rendering

The application may still continue working and loading data, which is why this is a responsiveness problem rather than necessarily a crash.

==================================================
5. EXPECTED BEHAVIOR
==================================================

Only the currently active page should remain fully active.

When the user navigates away:

ACTIVE PAGE
↓
becomes inactive
↓
page-specific effects stop
↓
page-specific listeners stop
↓
page-specific timers stop
↓
page-specific subscriptions stop
↓
page-specific query observers stop
↓
unnecessary rendering stops

The useful DATA CACHE must remain available.

IMPORTANT:

Do not destroy cached data merely because the UI component becomes inactive.

PAGE UI:
inactive/unmounted/suspended where safe

DATA CACHE:
retained according to existing React Query rules

==================================================
6. DO NOT BLINDLY REMOVE KEEP-ALIVE
==================================================

Before changing Keep-Alive behavior, inspect why it exists.

Determine whether any pages depend on:

- preserved form state
- unsaved user input
- modal state
- navigation state
- scroll state
- temporary page state
- existing component persistence

Do NOT simply remove Keep-Alive globally.

If complete unmounting is safe:

unmount inactive page.

If complete unmounting would break required state:

preserve the required state while stopping unnecessary runtime activity.

The goal is:

STOP UNNECESSARY WORK

not:

DESTROY PAGE STATE WITHOUT ANALYSIS.

==================================================
7. REACT QUERY CACHE
==================================================

Retain useful cached data.

Do not force a database/API reload every time the user changes pages.

The intended flow is:

User opens Page A
↓
Page A loads data
↓
User opens Page B
↓
Page A UI becomes inactive
↓
Page A cache remains
↓
User returns to Page A
↓
Valid cache appears immediately
↓
If stale, only Page A's required data refreshes

Do not introduce:

refetchAll()

or equivalent global refetch behavior.

==================================================
8. STALE DATA BEHAVIOR
==================================================

The application must still show current data.

Use the existing React Query/SSE architecture.

When data changes:

Backend
↓
SSE event
↓
affected query marked stale
↓
inactive page remains inactive
↓
user opens affected page
↓
page checks cache freshness
↓
stale required query refreshes

Do NOT reload the complete application.

==================================================
9. GLOBAL SSE
==================================================

Keep ONE global SSE connection.

Do NOT create page-specific duplicate SSE connections.

Do NOT disable SSE.

Do NOT move critical background automation into page components.

The existing global SSE listener should continue receiving backend events.

The important optimization is:

SSE EVENT
↓
identify affected query
↓
mark affected data stale
↓
do not activate inactive pages
↓
do not force unnecessary background rendering

Where the current architecture already uses:

refetchType: 'none'

preserve the intended deferred invalidation behavior unless inspection proves a correction is required.

==================================================
10. PAGE QUERY TRACKING
==================================================

PageQueryTracker must correctly understand which queries belong to which route/page.

When a page becomes inactive:

- it should not continue unnecessary query observation
- it should not continuously refetch in the background

When the page becomes active:

- restore/use its required queries
- reuse valid cached data
- silently refresh stale owned queries where appropriate

Do not refetch unrelated queries.

==================================================
11. POS SAVE BILL
==================================================

POS Save Bill behavior must remain unchanged.

Expected:

Save Bill
↓
backend saves bill
↓
existing events/SSE
↓
affected query caches become stale
↓
relevant active pages update
↓
inactive pages remain inactive

DO NOT:

Save Bill
→ reload entire application

DO NOT:

Save Bill
→ refetch every page

DO NOT:

Save Bill
→ destroy all React Query cache.

==================================================
12. INVENTORY
==================================================

When POS, Purchase, Return, or another existing workflow changes inventory:

Inventory changes
↓
existing backend event
↓
Inventory-related cache marked stale
↓
active Inventory UI updates where required
↓
inactive Inventory UI remains dormant
↓
when opened, stale Inventory data refreshes

Do not modify Inventory business logic.

==================================================
13. REPORTS
==================================================

When a sale/purchase/inventory event affects Reports:

Reports-related query becomes stale.

If Reports is inactive:

DO NOT force Reports UI to render/refetch continuously.

When user opens Reports:

- use valid cache immediately
- refresh stale Reports queries
- update the page with current data

Do not refetch unrelated pages.

==================================================
14. PURCHASE HISTORY
==================================================

When a purchase changes:

Purchase History-related data can become stale.

If Purchase History is inactive:

- no unnecessary UI rendering
- no unnecessary query observer work

When opened:

- valid cache can display immediately
- stale data refreshes
- only Purchase History-related queries execute

==================================================
15. CRM / REFILL
==================================================

CRM UI lifecycle must NOT control the actual refill automation.

Refill automation must continue even when CRM is not open.

Expected:

CRM inactive
↓
refill automation continues
↓
backend update
↓
SSE event
↓
CRM data marked stale
↓
CRM UI remains inactive
↓
user opens CRM
↓
current data is available/refreshed

Do not change refill business logic.

==================================================
16. WHATSAPP AUTOMATION
==================================================

WhatsApp automation is critical.

Changing pages must NOT stop:

- WhatsApp queue
- message sending
- scheduled automation
- refill automation
- background worker
- server-side processing
- SSE

Only the WhatsApp page UI/runtime work should become inactive when its UI is not visible.

Expected:

WhatsApp automation
↓
continues independently

User leaves WhatsApp page
↓
WhatsApp processing continues

User returns
↓
current status/data is displayed

==================================================
17. AUTOMATION HUB TIMER / UI WORK
==================================================

Inspect WhatsApp Automation Hub specifically for:

- timers
- progress intervals
- event subscriptions
- state updates
- loadData()
- queue events
- automation events
- message progress events

If these are UI-specific:

They must not continue consuming resources while the Hub UI is inactive.

However:

DO NOT stop the actual WhatsApp sending process.

Separate:

BACKGROUND AUTOMATION

from

UI PRESENTATION.

==================================================
18. PERFORMANCE ARCHITECTURE
==================================================

Target architecture:

GLOBAL APPLICATION
│
├── Global SSE
│
├── WhatsApp background processing
│
├── Refill/background processing
│
└── React Query cache
       │
       ├── ACTIVE PAGE
       │    ├── UI active
       │    ├── effects active
       │    ├── required listeners active
       │    └── required queries active
       │
       └── INACTIVE PAGE
            ├── UI inactive
            ├── effects stopped
            ├── listeners stopped
            ├── timers stopped
            └── query observers stopped
                 │
                 └── cache retained

==================================================
19. BEFORE EDITING EACH FILE
==================================================

For every file selected for modification, inspect its complete relevant implementation.

Document internally:

FILE:
<exact path>

CURRENT RESPONSIBILITY:
<what it does>

DEPENDENCIES:
<what depends on it>

CURRENT BEHAVIOR:
<exact behavior>

PROBLEM:
<exact issue>

REQUIRED CHANGE:
<smallest change required>

EXPECTED RESULT:
<result>

REGRESSION RISK:
<possible impact>

Only after this analysis may the file be edited.

==================================================
20. AFTER EDITING EACH FILE
==================================================

Immediately inspect the changed file again.

Verify:

- imports
- exports
- hooks
- cleanup
- listeners
- timers
- subscriptions
- query behavior
- cache behavior
- lifecycle behavior
- TypeScript correctness

Confirm no unrelated code was changed.

==================================================
21. CROSS-FILE DEPENDENCY CHECK
==================================================

After all changes, trace the complete chain:

ROUTER
↓
KeepAliveOutlet
↓
PAGE ACTIVATION
↓
PageQueryTracker
↓
React Query
↓
CACHE
↓
GLOBAL SSE
↓
EVENT INVALIDATION
↓
ACTIVE PAGE
↓
POS / INVENTORY / PURCHASE / REPORTS / CRM / WHATSAPP

Confirm the modified files work together.

Do not evaluate files individually only.

The complete flow must remain correct.

==================================================
22. CROSS-FEATURE TESTING
==================================================

TEST A:
POS Save Bill
→ Inventory
→ verify correct update.

TEST B:
POS Save Bill
→ Reports
→ verify correct update.

TEST C:
Create Purchase
→ Purchase History
→ verify current data.

TEST D:
Change Inventory
→ navigate between pages
→ verify no full application reload.

TEST E:
CRM/refill
→ leave CRM
→ verify automation continues.

TEST F:
WhatsApp automation
→ leave WhatsApp page
→ verify processing continues.

TEST G:
Return to WhatsApp Hub
→ verify current status is correct.

TEST H:
Open many pages
→ navigate repeatedly
→ verify UI remains responsive.

TEST I:
Generate multiple SSE events
→ verify no unnecessary full-app refetch.

TEST J:
Return to previously visited pages
→ verify cache-first behavior
→ verify stale data refreshes when required.

==================================================
23. UI REGRESSION CHECK
==================================================

Compare before and after.

Confirm:

- same layout
- same navigation
- same colors
- same buttons
- same cards
- same forms
- same tables
- same modal behavior
- same animations
- same page structure

If UI changes are detected:

REVERT THE UI CHANGE.

==================================================
24. PERFORMANCE CHECK
==================================================

Compare old and new runtime behavior.

OLD:

Multiple visited pages
→ mounted UI trees
→ effects
→ listeners
→ timers
→ query observers
→ background work
→ higher CPU/RAM
→ occasional lag

NEW:

Only active page
→ normal runtime activity

Inactive pages
→ minimal/no unnecessary runtime activity

Cache
→ retained

SSE
→ global

Data refresh
→ targeted

Expected result:

Lower unnecessary CPU usage
Lower unnecessary RAM usage
Fewer unnecessary renders
Fewer unnecessary query operations
Smoother navigation
Faster UI response

==================================================
25. FULL GIT DIFF AUDIT
==================================================

Before completion, inspect the COMPLETE git diff.

For EVERY modified file:

1. Why was this file changed?
2. Which exact requirement required it?
3. Is every changed line necessary?
4. Is any unrelated code changed?
5. Is UI changed?
6. Is business logic changed?
7. Is database behavior changed?
8. Is WhatsApp automation affected?
9. Is POS affected?
10. Is Inventory affected?
11. Is Reports affected?
12. Is Purchase History affected?
13. Is CRM/refill affected?
14. Is SSE affected?
15. Is cache behavior affected?

If any modification is unnecessary:

REMOVE/REVERT IT.

==================================================
26. FINAL FILE AUDIT
==================================================

Produce a final list:

MODIFIED FILE:
<exact path>
WHY:
<exact reason>

MODIFIED FILE:
<exact path>
WHY:
<exact reason>

CREATED FILES:
None
OR
<exact file + exact reason>

UNRELATED FILES:
Confirm they were not modified.

==================================================
27. BUILD / VALIDATION
==================================================

Run the repository's existing validation/build commands where available.

At minimum, verify:

- client build
- TypeScript
- existing guardrails
- existing tests
- lint/type validation if already configured

Do NOT add new validation dependencies just for this task.

Do NOT modify build configuration simply to make validation pass.

If validation fails:

DO NOT claim completion.

Identify the exact failure and correct only the relevant code.

==================================================
28. NO FALSE CLAIMS
==================================================

Do not state:

"100% fixed"

unless the actual behavior has been verified.

A successful build proves compilation.

It does NOT automatically prove that intermittent UI lag has disappeared.

Clearly distinguish:

CODE VERIFICATION
from
REAL RUNTIME PERFORMANCE VERIFICATION.

==================================================
29. FINAL REQUIRED RESPONSE
==================================================

After implementation, provide a SHORT comparison.

OLD BEHAVIOR:
- Inactive pages could remain active.
- Background effects/listeners/query observers could continue running.
- SSE activity could create additional frontend workload.
- CPU/RAM could increase.
- UI could intermittently feel slow.

NEW BEHAVIOR:
- Active page remains fully active.
- Inactive page runtime work is suspended/stopped where safe.
- Useful React Query cache is retained.
- SSE remains global.
- Only affected data becomes stale.
- Stale data refreshes when the relevant page becomes active.
- POS remains fast.
- Inventory remains accurate.
- Reports remain accurate.
- Purchase History remains accurate.
- CRM/refill automation continues.
- WhatsApp automation continues independently.
- Frontend UI remains unchanged.

FILES MODIFIED:
<exact list>

FILES CREATED:
<exact list or NONE>

FILES NOT MODIFIED:
Confirm unrelated files were untouched.

VALIDATION:
<build/test/guardrail results>

PERFORMANCE:
<what was verified and what remains to be verified>

==================================================
30. FINAL NON-NEGOTIABLE EXECUTION ORDER
==================================================

The coding agent MUST follow this exact order:

1. INSPECT THE ENTIRE RELEVANT ARCHITECTURE.
2. IDENTIFY THE CURRENT ROOT CAUSE.
3. TRACE ALL DEPENDENCIES.
4. IDENTIFY EXACT RELATED FILES.
5. DO NOT TOUCH UNRELATED FILES.
6. INSPECT EACH TARGET FILE BEFORE EDITING.
7. DEFINE THE SMALLEST REQUIRED CHANGE.
8. MODIFY ONLY REQUIRED CODE.
9. PRESERVE THE EXISTING UI.
10. PRESERVE BUSINESS LOGIC.
11. PRESERVE DATABASE BEHAVIOR.
12. PRESERVE WHATSAPP AUTOMATION.
13. PRESERVE REFILL AUTOMATION.
14. PRESERVE GLOBAL SSE.
15. PRESERVE REACT QUERY CACHE.
16. PREVENT INACTIVE PAGE BACKGROUND WORK.
17. IMPLEMENT TARGETED REFRESH ONLY.
18. TEST CROSS-PAGE DATA FLOWS.
19. TEST POS → INVENTORY → REPORTS.
20. TEST PURCHASE → PURCHASE HISTORY.
21. TEST CRM → REFILL.
22. TEST WHATSAPP → BACKGROUND PROCESSING.
23. REVIEW EVERY MODIFIED FILE.
24. REVIEW THE COMPLETE GIT DIFF.
25. REVERT EVERY UNRELATED CHANGE.
26. RUN EXISTING BUILD/VALIDATION.
27. CONFIRM UI IS UNCHANGED.
28. CONFIRM DATA IS CORRECT.
29. CONFIRM BACKGROUND AUTOMATION CONTINUES.
30. ONLY THEN REPORT COMPLETION.

FINAL OBJECTIVE:

DO NOT MAKE THE APPLICATION LOOK DIFFERENT.

MAKE THE APPLICATION DO LESS UNNECESSARY WORK.

ACTIVE PAGE:
FAST + RESPONSIVE

INACTIVE PAGE:
NO UNNECESSARY RUNTIME WORK

CACHE:
RETAINED

SSE:
GLOBAL

DATA:
CURRENT

AUTOMATION:
CONTINUES

UI:
UNCHANGED

BUSINESS LOGIC:
UNCHANGED

DATABASE:
UNCHANGED

UNRELATED FILES:
UNTOUCHED

PERFORMANCE:
IMPROVED WITHOUT SACRIFICING FUNCTIONALITY