IMPLEMENTATION PLAN: IDLE-STATE RECOVERY + RAM/CPU OPTIMIZATION FOR POS AND PURCHASE SEARCH

OBJECTIVE

Fix the issue where medicine search works normally immediately after application startup, but after the application remains idle for approximately 30–40 minutes, the POS medicine search and Purchase Bill medicine search stop returning/populating results even though the backend is still working correctly.

The application must automatically clean up genuinely unused resources to reduce unnecessary RAM, CPU, timers, listeners, cached data, and processing activity while ensuring that all critical application functions automatically recover when the user becomes active again.

IMPORTANT SCOPE RULE

- Do NOT redesign the frontend UI.
- Do NOT change the existing POS search UI.
- Do NOT change the existing Purchase Bill search UI.
- Do NOT create a new settings page.
- Do NOT add unrelated optimization features.
- Do NOT simply refresh/reload the entire application as a workaround.
- Do NOT blindly unmount application components just because they are inactive.
- Only modify files directly related to:
  1. POS medicine search
  2. Purchase Bill medicine search
  3. Shared medicine-search/autocomplete services
  4. API/request clients used by those searches
  5. Frontend component lifecycle
  6. Search caching/state management
  7. Idle/resource cleanup
  8. Shared polling/timers/listeners that can become stale
  9. Backend/API connection handling only where required
  10. Existing application lifecycle/resource-management code
- If a new helper/service is genuinely required, create only that required file.
- Reuse existing architecture wherever possible.

CURRENT BEHAVIOUR

The observed behaviour is:

1. Application starts.
2. User opens POS.
3. Medicine search works normally.
4. Search results appear quickly.
5. User leaves the application idle for approximately 30–40 minutes.
6. User returns and searches for a medicine.
7. No results appear.
8. No population/autocomplete occurs.
9. The application appears to be sitting still.
10. Backend/database/API is checked separately and is still working.
11. Refreshing the application immediately fixes the problem.
12. After refresh, medicine search works normally again.

The same type of problem occurs in the Purchase Bill medicine search.

This strongly suggests that the backend/database is not the primary failure point.

The likely failure area is one or more frontend/runtime resources becoming stale, disconnected, cleaned up incorrectly, or no longer triggering the expected update after a long idle period.

POSSIBLE ROOT CAUSES TO INVESTIGATE

Do NOT assume one cause before inspecting the code.

Investigate the existing implementation for:

- Stale React component state
- Stale closures
- Unmounted components whose search handlers are not recreated correctly
- Aborted/frozen requests
- Stale AbortController instances
- Stale fetch/request clients
- Expired cached search data
- Broken cache state
- React Query/SWR/custom cache becoming stale
- Debounce timers that were left in an invalid state
- Throttle timers
- setTimeout/setInterval lifecycle problems
- Event listeners removed and not recreated
- Visibility/idle handlers
- Browser tab suspension behaviour
- Renderer process/resource suspension
- WebSocket/SSE connection becoming stale if used by search
- API client connection reuse problems
- Service-worker/cache issues if applicable
- Database/API connection pool behaviour if applicable
- Frontend error handling that silently ignores failed requests
- Search component failing to update after an inactive period
- Race conditions between stale and new search requests
- Components being intentionally unmounted for optimization but not correctly remounted
- Global application cleanup logic affecting search
- Memory cleanup code accidentally removing required search state
- Backend request succeeding but frontend response handler no longer updating state

The implementation must identify the actual cause from the existing code rather than adding random timers or refreshes.

IDEAL APPLICATION BEHAVIOUR

The application should be optimized for long-running use.

The desired lifecycle is:

APPLICATION RUNNING
        ↓
USER ACTIVE
        ↓
POS/PURCHASE SEARCH WORKS
        ↓
USER BECOMES IDLE
        ↓
CLEAN UP ONLY NON-CRITICAL RESOURCES
        ↓
REDUCE RAM/CPU USAGE
        ↓
CRITICAL APPLICATION SERVICES REMAIN RECOVERABLE
        ↓
USER RETURNS
        ↓
APPLICATION DETECTS ACTIVITY
        ↓
REINITIALIZE/RECONNECT STALE RESOURCES IF REQUIRED
        ↓
USER SEARCHES MEDICINE
        ↓
SEARCH REQUEST EXECUTES
        ↓
RESULTS RETURN
        ↓
RESULTS DISPLAY NORMALLY

The user must NOT need to refresh the application.

CORE REQUIREMENT

The application should distinguish between:

1. Resources that can safely be cleaned up during inactivity.
2. Resources that must remain available.
3. Resources that can be lazily recreated when the user needs them.

Do NOT keep everything permanently alive just to avoid this issue.

Do NOT destroy everything during idle either.

Use a proper lifecycle strategy.

RESOURCE OPTIMIZATION

During extended inactivity, safely clean up resources such as:

- Unused timers
- Unused intervals
- Temporary event listeners
- Inactive polling
- Temporary search state
- Expired temporary cache entries
- Large temporary objects
- Unused subscriptions
- Non-critical background operations
- Other resources already identified in the application

Critical resources should either remain healthy or be automatically reinitialized.

Critical functionality includes:

- POS medicine search
- Purchase Bill medicine search
- Required medicine autocomplete data
- Required API/request functionality
- Required authentication/session state
- Required application state needed for normal operation

SEARCH RECOVERY

When the user returns after being idle, the first search request must be able to recover automatically.

Example:

USER RETURNS
↓
Search medicine
↓
Detect stale search state/request client/cache
↓
Clean/reinitialize required search resources
↓
Execute fresh request
↓
Receive results
↓
Populate existing search UI

The user should not see a broken search state.

No manual refresh should be required.

POS SEARCH

The existing POS medicine search must continue to behave exactly as it currently does during normal active use.

After 30–40 minutes of inactivity:

- User enters medicine name
- Existing search component activates
- Required state is reinitialized if stale
- Existing API request is made
- Backend returns results
- Existing autocomplete/result UI populates
- Search remains fast

Do not modify the visual design or user interaction pattern.

PURCHASE BILL SEARCH

Apply the same lifecycle/recovery logic to Purchase Bill medicine search.

The user should be able to:

- Leave Purchase Bill page inactive
- Return after a long period
- Search for medicine
- Receive results normally

No refresh should be necessary.

SHARED SEARCH LOGIC

If POS and Purchase Bill currently use separate implementations, inspect whether they share:

- Medicine search API
- Search hooks
- Autocomplete services
- API client
- Cache
- Debounce utility
- Medicine master-data service

If a shared service already exists, fix the issue there instead of implementing two separate fixes.

Preferred architecture:

POS Search ───────────┐
                      │
Purchase Search ──────┤
                      ↓
              Shared Medicine
              Search Service
                      ↓
                API Client
                      ↓
                 Backend
                      ↓
              Search Results

This prevents the same idle-state bug from being fixed in one location and remaining broken in another.

REQUEST LIFECYCLE

Every medicine search request must have a valid lifecycle:

SEARCH START
↓
Create valid request
↓
Send request
↓
Receive response
↓
Update current component state
↓
Display results

If the previous request was cancelled/aborted/stale:

OLD REQUEST
↓
Discard safely
↓
Create fresh request
↓
Return current results

A stale request must never permanently block future searches.

ABORT CONTROLLER / REQUEST STATE

If AbortController or equivalent cancellation logic is used:

- Do not reuse an already-aborted controller.
- Create a valid controller for each appropriate search lifecycle.
- Clean up old controllers safely.
- Ensure cleanup from an old component instance cannot cancel a new search.
- Ensure an old request cannot prevent the next request from executing.

DEBOUNCE / THROTTLE

If medicine search uses debounce/throttle:

- Verify timers are cleaned up correctly.
- Verify timers can be recreated after inactivity.
- Ensure a stale timer cannot block new input.
- Ensure cleanup does not leave the search permanently waiting.
- Ensure the first search after inactivity is not swallowed.

CACHE MANAGEMENT

Inspect existing medicine-search caching.

The cache must not cause this behaviour:

30 MINUTES IDLE
↓
Cached state becomes stale/broken
↓
Search assumes data/request is valid
↓
No new request
↓
No result

Instead:

If cached data is valid:
→ use it normally.

If cached data is stale:
→ automatically refresh/revalidate.

If cache state is invalid:
→ discard only the invalid cache
→ perform a fresh search.

Do not unnecessarily clear all application caches.

API CLIENT RECOVERY

If the frontend uses a shared API client:

- Ensure it remains usable after long inactivity.
- Detect stale request/connection state.
- Reinitialize only when necessary.
- Do not recreate the entire application.
- Do not force a full-page refresh.

If normal HTTP fetch requests are used and no persistent connection exists, do not introduce unnecessary connection-management complexity.

BACKGROUND/IDLE MANAGEMENT

Inspect whether the application already has:

- Idle detection
- Visibility detection
- Page lifecycle handling
- Electron/desktop lifecycle handling
- Background cleanup
- Memory optimization
- Polling suspension
- Tab/window visibility handling

If such functionality already exists, extend/fix it instead of creating another idle-management system.

If no suitable mechanism exists and a small lifecycle helper is genuinely necessary, create one centralized helper.

The helper should have one responsibility:

Manage safe cleanup and recovery of non-critical resources during extended inactivity.

It should NOT control business logic.

ACTIVE VS IDLE

The application should conceptually behave as:

ACTIVE:
- Normal search
- Normal timers
- Normal required subscriptions
- Normal UI activity

IDLE:
- Stop non-critical background work
- Clean temporary resources
- Reduce unnecessary processing
- Preserve critical functionality
- Keep application state recoverable

RETURNING ACTIVE:
- Detect user activity
- Reinitialize resources that were intentionally suspended
- Revalidate stale state
- Allow normal search immediately

IMPORTANT:
Idle optimization must never result in a permanent broken state.

ERROR HANDLING

The current problem is particularly bad because the application appears to do nothing.

Do not silently swallow search failures.

If a search request fails:

- Capture the error.
- Determine whether it is a network/request/cache/lifecycle error.
- Recover automatically when possible.
- Preserve the existing UI design.
- If an actual user-facing error notification already exists, use it.
- Do not create a new notification system solely for this feature.

The application should not falsely show "no medicines found" when the actual problem is that the request never executed or the frontend failed to process the response.

OBSERVABILITY / DEBUGGING

During implementation, add appropriate internal logging only where needed to identify:

- Search request started
- Search request completed
- Search request failed
- Search request aborted
- Idle cleanup executed
- Resource reinitialization executed
- Cache invalidated/revalidated
- Recovery triggered

Do not flood production logs with unnecessary messages.

If the project already has a logging/debug mechanism, use it.

RAM OPTIMIZATION

The goal is NOT to force RAM usage to zero.

The goal is to avoid retaining unnecessary resources indefinitely.

Inspect and clean:

- Large temporary arrays
- Duplicate medicine datasets
- Stale search results
- Unused subscriptions
- Event listeners
- Timers
- Intervals
- Background polling
- Temporary request objects
- Unused component state
- Duplicate cached datasets

Do not remove medicine master data that is required for instant POS/Purchase searching unless it can be safely reloaded automatically.

If medicine master data is large, use the existing architecture to keep memory reasonable without breaking search.

CPU OPTIMIZATION

During inactivity:

- Stop unnecessary polling.
- Stop unnecessary timers.
- Stop unnecessary background calculations.
- Avoid repeated API calls.
- Avoid repeated React renders caused by background state changes.
- Avoid continuously processing data that the user is not viewing.

When the user becomes active:

- Resume only the required functionality.

The application must remain responsive during long-running sessions.

IMPORTANT:
Do not optimize by adding arbitrary inactivity timers that unmount critical application infrastructure.

FRONTEND UI PRESERVATION

The UI must remain visually and functionally consistent.

Do not change:

- POS layout
- Medicine search box design
- Search result design
- Purchase Bill layout
- Header layout
- Buttons
- Existing colors
- Existing typography
- Existing navigation
- Existing page structure

Only the underlying lifecycle/resource behaviour should change.

FILE-LEVEL IMPLEMENTATION APPROACH

Before modifying anything:

1. Inspect the complete repository tree.
2. Identify the existing POS medicine-search files.
3. Identify the existing Purchase Bill medicine-search files.
4. Identify shared medicine-search hooks/services.
5. Identify API clients used by medicine search.
6. Identify caching logic.
7. Identify debounce/throttle logic.
8. Identify idle/resource cleanup logic.
9. Identify application lifecycle logic.
10. Identify existing Automation/notification systems only if they interact with this lifecycle.
11. Identify database/backend endpoints used for medicine search.
12. Trace the complete request from UI → frontend service → API → backend → database → response → UI.

Then identify the actual point where the long-idle failure occurs.

Only after identifying the root cause should code be modified.

PREFERRED MODIFICATION STRATEGY

If the problem exists in a shared search hook/service:

→ Fix the shared hook/service.

If the problem exists in the API client:

→ Fix the API client.

If the problem exists in lifecycle cleanup:

→ Fix the lifecycle cleanup.

If the problem exists in POS only:

→ Modify the POS search-related file.

If the problem exists in Purchase only:

→ Modify the Purchase search-related file.

If both use the same broken shared mechanism:

→ Fix the shared mechanism rather than duplicating fixes.

If a new helper is required:

→ Create one small, focused helper/service.

Do not create multiple overlapping optimization services.

NO FULL APPLICATION RELOAD

Do not solve the issue with:

window.location.reload()

or equivalent full application refresh.

A full reload hides the underlying lifecycle bug instead of fixing it.

The application must recover internally.

NO FORCED REMOUNT WORKAROUND

Do not use arbitrary key changes or forced page remounts merely to make the search work again.

If a component genuinely needs to be remounted/reinitialized, fix its lifecycle so that it naturally reinitializes when it becomes active.

BACKEND VALIDATION

Because the observed backend appears to continue working, backend changes should be minimal.

Verify:

- Medicine search endpoint still responds after long idle.
- Database connection remains healthy.
- API response remains correct.
- No backend timeout is incorrectly being interpreted as frontend success.
- No backend modification is needed if the backend is already functioning correctly.

Only modify backend files if the investigation proves the backend contributes to the issue.

TESTING PLAN

TEST 1: NORMAL STARTUP

Start application.

Search medicine in POS.

Expected:
- Results appear normally.
- Existing speed remains unchanged.

TEST 2: PURCHASE SEARCH

Search medicine in Purchase Bill.

Expected:
- Results appear normally.

TEST 3: SHORT IDLE

Leave application inactive for 5–10 minutes.

Return.

Search medicine.

Expected:
- Results appear normally.

TEST 4: LONG IDLE

Leave application inactive for 30–40 minutes.

Return.

Search medicine in POS.

Expected:
- Results appear normally.
- No refresh required.

TEST 5: LONG IDLE PURCHASE

Leave Purchase Bill inactive for 30–40 minutes.

Return.

Search medicine.

Expected:
- Results appear normally.
- No refresh required.

TEST 6: VERY LONG IDLE

Leave application idle for an extended period.

Return.

Search medicine.

Expected:
- Search automatically recovers.
- No full application reload required.

TEST 7: RAPID SEARCH

Search several medicines quickly.

Expected:
- Existing debounce/search behaviour remains correct.
- Latest search returns correct result.
- Old requests do not override newer searches.

TEST 8: SEARCH DURING RECOVERY

Return from idle and immediately search.

Expected:
- Search resources initialize automatically.
- Results populate normally.

TEST 9: WHATSAPP / OTHER BACKGROUND FUNCTIONS

Verify idle optimization does not break unrelated existing application functionality.

TEST 10: MEMORY

Run application normally.

Leave idle.

Verify unnecessary background resources reduce where appropriate.

Expected:
- No uncontrolled growth.
- No unnecessary polling.
- No continuously increasing memory caused by leaked listeners/timers.

TEST 11: CPU

Leave application idle.

Expected:
- CPU usage should remain low compared with active operation.
- No runaway interval/timer/render loop.

TEST 12: RETURN TO ACTIVE

Interact with application after long idle.

Expected:
- Required resources resume.
- POS search works.
- Purchase search works.
- Existing application functionality remains responsive.

TEST 13: BACKEND STILL AVAILABLE

Keep backend running during the idle period.

After returning:
- Verify search request reaches backend.
- Verify response reaches frontend.
- Verify frontend renders result.

TEST 14: BACKEND TEMPORARILY UNAVAILABLE

If the backend is temporarily unavailable:

- Search should fail gracefully.
- Existing error handling should appear.
- Once backend is available, the next search should recover.

TEST 15: INVALID SEARCH

Search a medicine that does not exist.

Expected:
- Existing "no result" behaviour remains unchanged.
- It must not be confused with a lifecycle failure.

SUCCESS CRITERIA

The implementation is complete only when:

1. POS medicine search works after application startup.
2. POS medicine search works after 30–40 minutes of inactivity.
3. Purchase Bill medicine search works after 30–40 minutes of inactivity.
4. No application refresh is required.
5. Backend functionality is not unnecessarily modified.
6. Existing search speed is preserved during active use.
7. Stale frontend resources are correctly cleaned up.
8. Required resources can automatically recover.
9. Stale requests cannot permanently block future searches.
10. Stale AbortControllers cannot block new searches.
11. Debounce/throttle timers cannot permanently block searches.
12. Invalid/stale cache cannot permanently block searches.
13. Event listeners are cleaned up correctly.
14. Background polling/timers stop when genuinely unnecessary.
15. Required functionality resumes when the user becomes active.
16. RAM usage is reduced where resources are genuinely unnecessary.
17. CPU usage is reduced during prolonged inactivity.
18. No memory leaks are introduced.
19. No new UI design is introduced.
20. POS UI remains unchanged.
21. Purchase Bill UI remains unchanged.
22. Existing application workflows remain unchanged.
23. No full-page/application refresh is used as the solution.
24. No arbitrary forced remount workaround is used.
25. Only directly related files are modified.
26. Any new file created has one clearly defined responsibility.
27. The actual root cause is fixed rather than hidden.

FINAL EXPECTED ARCHITECTURE

The final behaviour should be:

                APPLICATION
                     │
          ┌──────────┴──────────┐
          ↓                     ↓
        ACTIVE                 IDLE
          │                     │
          ↓                     ↓
   Normal resources      Clean non-critical
   and search            resources
          │                     │
          │              Preserve/recover
          │              critical services
          │                     │
          └──────────┬──────────┘
                     ↓
              USER RETURNS
                     ↓
          Activity detected
                     ↓
       Reinitialize stale resources
              if necessary
                     ↓
             Medicine Search
                     ↓
          Fresh valid request
                     ↓
                 Backend
                     ↓
                 Results
                     ↓
          Existing UI populated

FINAL PRINCIPLE

The application should NOT simply "keep everything mounted forever."

It should also NOT "unmount everything after inactivity."

The correct implementation is:

CLEAN WHAT IS NOT NEEDED
+
KEEP CRITICAL FUNCTIONS RECOVERABLE
+
REINITIALIZE STALE RESOURCES AUTOMATICALLY
+
NEVER REQUIRE A MANUAL REFRESH
+
REDUCE RAM/CPU USAGE WITHOUT BREAKING THE APPLICATION

The user's experience should ultimately be simple:

OPEN APP → SEARCH WORKS
↓
LEAVE APP FOR 40 MINUTES
↓
COME BACK
↓
SEARCH WORKS

The optimization should happen underneath the existing UI without the user needing to know that resources were cleaned up, suspended, refreshed, or reinitialized.