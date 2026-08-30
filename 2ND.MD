==================================================
STRICT EXECUTION, FILE CONTROL & CROSS-CHECK RULE
==================================================

THIS SECTION IS MANDATORY AND OVERRIDES ANY SHORTCUT.

The agent MUST NOT start editing code immediately.

The agent MUST first understand the existing architecture and create an internal dependency map of the feature.

The objective is not simply to make the application "feel faster."

The objective is to implement the requested behavior ACCURATELY while preserving 100% of the existing application functionality.

==================================================
1. FIRST: FULL PROJECT INSPECTION
==================================================

Before modifying ANY file, inspect the repository structure and identify:

- frontend architecture
- routing architecture
- Keep-Alive implementation
- page mounting/unmounting behavior
- page activation/deactivation logic
- React Query configuration
- query cache configuration
- PageQueryTracker
- SSE implementation
- SSE event mapping
- DOM CustomEvent usage
- WhatsApp event system
- WhatsApp queue system
- automation hub
- background automation
- POS data flow
- Inventory data flow
- Purchase data flow
- Reports data flow
- CRM/refill data flow

DO NOT assume how the system works.

VERIFY IT FROM THE ACTUAL CODE.

==================================================
2. BUILD A FILE DEPENDENCY MAP BEFORE EDITING
==================================================

Before editing, identify the exact files connected to this feature.

For each potentially related file, determine:

FILE PATH:
<exact path>

ROLE:
<what this file does>

USED BY:
<components/hooks/services using it>

DEPENDS ON:
<important dependencies>

AFFECTED BY:
<SSE/query/router/lifecycle relationships>

REQUIRED CHANGE:
<exact reason this file may need modification>

DO NOT MODIFY:
<reason if file is not actually required>

Only files proven to be directly related may be modified.

==================================================
3. FILE MODIFICATION RULE
==================================================

ABSOLUTE RULE:

IF A FILE IS NOT REQUIRED FOR THIS FEATURE:

DO NOT TOUCH IT.

Do not modify a file because:

- it looks related
- it could be optimized
- it is convenient
- it contains similar code
- it might improve performance
- the agent thinks it is "cleaner"

Only modify files with a demonstrated dependency on the requested lifecycle/performance behavior.

==================================================
4. BEFORE EDITING EACH FILE
==================================================

For EVERY file that will be modified, inspect the COMPLETE relevant implementation.

Before editing, document internally:

OLD CODE PURPOSE:
<what the existing code does>

DEPENDENCIES:
<what depends on this code>

CURRENT BEHAVIOR:
<exact runtime behavior>

PROBLEM:
<exact performance/lifecycle problem>

REQUIRED CHANGE:
<smallest required modification>

EXPECTED RESULT:
<what should happen after modification>

REGRESSION RISK:
<what could break>

Only then modify the file.

==================================================
5. SMALLEST POSSIBLE CHANGE
==================================================

Use the smallest safe modification.

DO NOT rewrite entire files.

DO NOT refactor unrelated code.

DO NOT rename unrelated variables.

DO NOT reorganize unrelated imports.

DO NOT change formatting throughout the file.

DO NOT "clean up" existing code unless directly required.

DO NOT replace working architecture with a new architecture unless the existing architecture cannot safely support the requested behavior.

Preserve existing code wherever possible.

==================================================
6. KEEP-ALIVE / PAGE LIFECYCLE CROSS-CHECK
==================================================

Before changing Keep-Alive behavior, verify:

- Why Keep-Alive exists.
- Which pages depend on state preservation.
- Whether forms depend on mounted state.
- Whether modals depend on mounted state.
- Whether navigation depends on mounted state.
- Whether unsaved data depends on mounted state.
- Whether page-level subscriptions depend on mounted state.
- Whether query observers depend on mounted state.

DO NOT simply remove Keep-Alive.

Implement suspension/unmounting only where safe.

If complete unmounting would break state preservation, suspend unnecessary runtime work instead.

==================================================
7. REACT QUERY CROSS-CHECK
==================================================

Before modifying query behavior, identify:

- query keys
- query ownership
- staleTime
- cacheTime/gcTime
- enabled conditions
- refetch behavior
- refetchOnMount
- refetchOnWindowFocus
- invalidation behavior
- PageQueryTracker behavior

For every affected query:

OLD:
<when it fetches>

NEW:
<when it fetches>

Confirm:

- valid cache remains usable
- stale cache can refresh
- inactive pages do not create unnecessary observers
- active pages still receive current data
- no global refetch is introduced

==================================================
8. SSE CROSS-CHECK
==================================================

DO NOT remove the global SSE connection.

Before modifying SSE handling, map:

SSE EVENT
→ QUERY KEY
→ PAGE
→ UI CONSUMER
→ BACKGROUND CONSUMER

For every changed event:

OLD:
<current invalidation/event behavior>

NEW:
<new behavior>

Verify that:

- SSE still receives events
- active pages update correctly
- inactive pages do not perform unnecessary UI work
- targeted cache invalidation remains correct
- WhatsApp events continue working
- Inventory events continue working
- POS events continue working
- CRM/refill events continue working

==================================================
9. WHATSAPP CROSS-CHECK
==================================================

Treat WhatsApp automation as CRITICAL functionality.

Before editing anything related to WhatsApp UI/lifecycle, trace:

WhatsApp trigger
→ queue
→ worker/background process
→ message sending
→ progress event
→ SSE/event
→ Automation Hub UI

The implementation MUST NOT stop:

- queue processing
- message sending
- scheduled automation
- refill automation
- background worker
- backend processing

Only unnecessary UI work may be suspended.

==================================================
10. POS CROSS-CHECK
==================================================

Trace:

POS
→ Save Bill
→ API/backend
→ database
→ event/SSE
→ cache invalidation
→ Inventory
→ Reports
→ other dependent pages

Verify that Save Bill remains fast.

DO NOT introduce:

Save Bill
→ full application refetch.

==================================================
11. INVENTORY CROSS-CHECK
==================================================

Trace all important Inventory dependencies.

For example:

Sale
→ Inventory change

Purchase
→ Inventory change

Return
→ Inventory change

Inventory event
→ Inventory query invalidation

Verify that the optimization does not create stale inventory data.

==================================================
12. REPORTS CROSS-CHECK
==================================================

Trace:

Sales/Purchases/Inventory
→ Reports data
→ Reports queries

When Reports becomes active:

- cached valid data should be usable
- stale data should refresh
- unrelated queries must not refresh unnecessarily

==================================================
13. PURCHASE HISTORY CROSS-CHECK
==================================================

Trace:

Purchase
→ backend
→ SSE/event
→ Purchase History cache
→ Purchase History page

Verify that the page receives the latest data when required.

==================================================
14. CRM / REFILL CROSS-CHECK
==================================================

Trace:

CRM
→ refill automation
→ backend processing
→ SSE
→ CRM cache
→ CRM UI

Verify that:

CRM UI can become inactive

BUT

refill automation continues.

==================================================
15. UI PRESERVATION CHECK
==================================================

The agent MUST compare the UI before and after.

There must be NO intentional changes to:

- layout
- styling
- colors
- fonts
- spacing
- navigation
- buttons
- cards
- modals
- icons
- animations
- page structure

This implementation is NOT a UI redesign.

==================================================
16. NO UNNECESSARY NEW FILES
==================================================

Before creating a new file, verify:

1. Can the requirement be safely implemented in an existing related file?
2. Does the new file provide genuinely necessary separation?
3. Does it duplicate existing functionality?
4. Does it introduce additional complexity?

If an existing file can safely handle the change:

DO NOT CREATE A NEW FILE.

If a new file is absolutely necessary:

Record:

NEW FILE:
<path>

PURPOSE:
<exact purpose>

WHY EXISTING FILES CANNOT HANDLE IT:
<reason>

DEPENDENCIES:
<dependencies>

==================================================
17. AFTER EACH FILE EDIT
==================================================

Immediately re-check the modified file.

Verify:

- TypeScript correctness
- imports
- exports
- hooks
- cleanup functions
- event listeners
- timers
- subscriptions
- query behavior
- lifecycle behavior

Confirm no unrelated code was changed.

==================================================
18. AFTER ALL FILES ARE MODIFIED
==================================================

Perform a COMPLETE dependency cross-check again.

Review:

ROUTING
↓
PAGE LIFECYCLE
↓
KEEP-ALIVE
↓
QUERY TRACKING
↓
REACT QUERY CACHE
↓
SSE
↓
PAGE EVENTS
↓
WHATSAPP
↓
POS
↓
INVENTORY
↓
PURCHASE
↓
REPORTS
↓
CRM/REFILL

Verify that the complete chain still works.

==================================================
19. GIT DIFF AUDIT
==================================================

Before declaring completion:

Inspect the COMPLETE git diff.

For EVERY modified file:

1. Why was it changed?
2. Which exact requirement required it?
3. Is every changed line necessary?
4. Does it affect unrelated functionality?
5. Does it affect UI?
6. Does it affect business logic?
7. Does it affect database behavior?
8. Does it affect WhatsApp automation?
9. Does it affect POS?
10. Does it affect Inventory?
11. Does it affect Reports?
12. Does it affect CRM/refill?
13. Does it affect SSE?
14. Does it affect caching?

If any changed line is unrelated:

REMOVE/REVERT THAT CHANGE.

==================================================
20. NO HIDDEN CHANGES
==================================================

Do NOT:

- modify files outside the approved scope
- change configuration unnecessarily
- change package versions
- change dependencies
- change build configuration
- change environment files
- change database migrations
- change API contracts
- change authentication
- change unrelated performance systems

unless the dependency inspection proves it is directly required.

==================================================
21. TEST DATA FLOW AFTER IMPLEMENTATION
==================================================

Verify the following complete flows:

FLOW A:
POS Save Bill
→ database
→ SSE
→ Inventory
→ Reports
→ correct UI data

FLOW B:
Purchase
→ database
→ SSE
→ Purchase History
→ correct UI data

FLOW C:
Inventory change
→ SSE
→ Inventory cache
→ active/inactive page behavior

FLOW D:
CRM refill
→ background automation
→ SSE
→ CRM data
→ correct UI

FLOW E:
WhatsApp automation
→ queue
→ worker
→ message send
→ progress
→ SSE
→ Automation Hub

FLOW F:
User navigation
→ Page A
→ Page B
→ Page C
→ Page D
→ back to Page A

Verify that inactive pages do not continue unnecessary runtime work.

==================================================
22. PERFORMANCE CROSS-CHECK
==================================================

Compare:

BEFORE:
- active pages
- inactive mounted pages
- listeners
- timers
- query observers
- API requests
- CPU usage
- RAM usage

AFTER:
- active pages
- inactive page runtime work
- listeners
- timers
- query observers
- API requests
- CPU usage
- RAM usage

The expected result is:

LESS BACKGROUND WORK
+
SAME DATA CORRECTNESS
+
SAME UI
+
SAME AUTOMATION
=
BETTER RESPONSIVENESS

==================================================
23. DO NOT CLAIM SUCCESS WITHOUT VERIFICATION
==================================================

Do not report:

"Performance fixed"

unless the implementation has been cross-checked.

If a particular behavior cannot be verified from the code:

State that it could not be verified.

Do not guess.

==================================================
24. FINAL IMPLEMENTATION REPORT
==================================================

After completion, provide a concise but accurate report:

IMPLEMENTATION STATUS:
Completed / Not completed

OLD BEHAVIOR:
<short description>

NEW BEHAVIOR:
<short description>

ROOT CAUSE ADDRESSED:
<short description>

FILES MODIFIED:
1. <exact path>
   - reason
   - exact responsibility

2. <exact path>
   - reason
   - exact responsibility

FILES CREATED:
<list or "None">

FILES NOT TOUCHED:
Confirm unrelated files were not modified.

UI:
Confirm frontend UI was not changed.

BUSINESS LOGIC:
Confirm business logic was preserved.

DATA:
Confirm cache + targeted refresh behavior.

SSE:
Confirm global SSE remains functional.

WHATSAPP:
Confirm background WhatsApp automation remains functional.

POS:
Confirm Save Bill behavior remains functional.

INVENTORY:
Confirm updates remain correct.

REPORTS:
Confirm stale/current data behavior.

PURCHASE HISTORY:
Confirm updates remain correct.

CRM/REFILL:
Confirm background automation remains functional.

PERFORMANCE:
Describe the expected reduction in unnecessary runtime work.

==================================================
25. FINAL ABSOLUTE RULE
==================================================

THE AGENT MUST THINK IN THIS ORDER:

1. INSPECT
2. UNDERSTAND
3. TRACE DEPENDENCIES
4. IDENTIFY EXACT FILES
5. IDENTIFY EXACT LINES/LOGIC
6. PLAN THE SMALLEST CHANGE
7. MODIFY ONLY REQUIRED FILES
8. CROSS-CHECK EACH MODIFICATION
9. TEST ALL RELATED DATA FLOWS
10. REVIEW COMPLETE DIFF
11. REMOVE UNRELATED CHANGES
12. VERIFY UI IS UNCHANGED
13. VERIFY AUTOMATION IS UNCHANGED
14. VERIFY DATA CORRECTNESS
15. VERIFY PERFORMANCE BEHAVIOR
16. ONLY THEN DECLARE COMPLETE

NO SHORTCUTS.

NO BROAD REFACTORING.

NO UNRELATED FILE CHANGES.

NO UI CHANGES.

NO BUSINESS-LOGIC CHANGES.

NO DATABASE CHANGES.

NO DISABLING WHATSAPP AUTOMATION.

NO DISABLING SSE.

NO FULL APPLICATION REFETCH.

NO ASSUMPTIONS.

EVERY MODIFICATION MUST HAVE A SPECIFIC, TRACEABLE REASON.

THE FINAL CODE MUST DELIVER:

ACTIVE PAGE
→ FULL RESPONSIVENESS

INACTIVE PAGE
→ MINIMAL RUNTIME WORK

CACHE
→ RETAINED

DATA
→ ACCURATE

SSE
→ GLOBAL AND ACTIVE

WHATSAPP/REFILL AUTOMATION
→ CONTINUES IN BACKGROUND

POS/INVENTORY/REPORTS/PURCHASE/CRM
→ WORK AS BEFORE

FRONTEND UI
→ EXACTLY UNCHANGED

CPU/RAM
→ REDUCED UNNECESSARY WORK

NAVIGATION
→ SMOOTH AND RESPONSIVE