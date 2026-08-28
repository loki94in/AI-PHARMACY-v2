PROJECT:
loki94in/AI-PHARMACY-v2

TASK:
Modify ONLY the existing medicine-search / medicine-selection workflow required
for the Purchase page.

IMPORTANT DEVELOPMENT RULE:
Before changing ANY code, inspect the actual repository files and trace the
current implementation of:

- Purchase page
- POS page
- Master Database page
- Inventory
- Medicine search APIs/services
- Existing Purchase search cache
- Existing compact inventory cache
- Existing purchase/history queries
- Existing medicine/inventory relationships

DO NOT assume that a file, API, database field, hook, component, workflow,
or business rule exists.

DO NOT invent new architecture when the existing project already provides the
required functionality.

DO NOT create new database tables, fields, APIs, caches, services, components,
or workflows unless the existing code has been verified and the change is
actually required.

First understand the current implementation from the repository, then make
the smallest possible modification.

============================================================
1. WHY THIS CHANGE IS REQUIRED
============================================================

The current Purchase page already has a search-result cache and local search
narrowing behavior.

KEEP AND REUSE THE EXISTING PURCHASE CACHE.

The goal is NOT to replace the existing Purchase search system.

The goal is to make the existing Purchase medicine dropdown behave as quickly
and conveniently as the existing POS medicine search while allowing Purchase
to search a broader medicine set.

The Purchase page needs broader medicine visibility because a medicine may be
purchased for the first time.

The user should NOT be forced to go to the Master Database page, manually
create another medicine, enter all medicine details again, save it, and then
return to Purchase when the medicine already exists in the Master Database.

============================================================
2. VERY IMPORTANT VISIBILITY RULE
============================================================

There are different visibility requirements for POS/application pages versus
Purchase and Master Database.

DO NOT make the entire application use the complete Master Database list.

The distinction must remain:

MASTER DATABASE PAGE:
    User can access the complete Master Database.

PURCHASE PAGE:
    User can search/select the complete medicine set needed for purchasing,
    including Master Database medicines and medicines that have previously
    existed in this pharmacy's purchase/inventory history.

POS AND OTHER NORMAL APPLICATION PAGES:
    Must NOT show medicines that are not currently valid/available for normal
    application use according to the CURRENT existing application logic.

In particular:

    ZERO-STOCK medicines
    EXPIRED medicines

must NOT suddenly start appearing in the POS medicine selector just because
the Purchase search has been expanded.

Do NOT change the existing POS visibility behavior unless the repository
proves that the current POS behavior already works differently.

============================================================
3. ZERO-STOCK AND EXPIRED MEDICINES
============================================================

This rule is critical.

A medicine can exist in historical pharmacy purchase records even when its
current inventory is:

    0

or all of its batches are:

    expired

That historical medicine must remain available/searchable where required by
the Purchase workflow and Master Database.

Example:

The pharmacy purchased:

    Dolo 650

The entire quantity was sold.

Current inventory:

    Dolo 650 = 0

Purchase must still be able to find/select Dolo 650.

However:

    POS should NOT show Dolo 650 merely because it exists in historical
    purchase data if the current POS logic excludes zero-stock medicines.

Similarly:

    Dolo 650
    all batches expired

Purchase/Master Database can still show the medicine/history.

POS must continue following its existing current-stock/validity behavior.

IMPORTANT:

Do NOT interpret:

    stock = 0

as:

    medicine does not exist.

Do NOT delete or hide historical purchase records.

Do NOT remove historical medicines from the Master Database.

Current inventory status and historical medicine existence are different
things.

============================================================
4. PURCHASE SEARCH DATASET
============================================================

The Purchase medicine dropdown must be able to find:

A. Medicines currently available in inventory.

B. Medicines previously purchased by this pharmacy, even if:
   - current stock is 0
   - all previous stock has been sold
   - previous batches are expired

C. Medicines available in the Master Database that have never previously
   been purchased by this pharmacy.

Therefore Purchase must effectively search the union of:

    MASTER DATABASE
        +
    PHARMACY PURCHASE / MEDICINE HISTORY
        +
    CURRENT INVENTORY

BUT:

Do NOT duplicate medicines that represent the same underlying medicine.

Use the existing medicine identity/ID and relationships already present in
the project.

Before implementing this, inspect the actual database/API models and determine
how the project currently identifies a medicine.

DO NOT invent a new identity field if an existing one already serves this
purpose.

============================================================
5. MASTER DATABASE MEDICINE SELECTED FROM PURCHASE
============================================================

Example:

Master Database contains:

    Amoxicillin 500 mg

But this pharmacy has never purchased it.

User opens Purchase and searches:

    Amoxicillin

The Purchase dropdown should be able to show:

    Amoxicillin 500 mg

The user should select the existing Master Database medicine.

DO NOT force the user to recreate the medicine.

DO NOT ask the user to manually enter all details that already exist in the
Master Database.

Use the existing Master Medicine record/ID and existing Purchase workflow.

When the Purchase is saved, follow the EXISTING application workflow for
associating that medicine with the pharmacy/inventory.

Do not invent a new activation workflow unless the existing code requires one.

============================================================
6. COMPLETELY NEW MEDICINE
============================================================

If the user searches for a medicine that does not exist in the Master Database
and does not exist in the relevant existing pharmacy records:

Only then should the existing/new-medicine creation workflow be used.

Before adding anything new, inspect the existing Purchase page and existing
Master Database page to determine whether a new-medicine creation action
already exists.

If it exists:

    REUSE IT.

Do NOT create a second new-medicine creation component or workflow.

If it does not exist and the requested workflow genuinely requires it, make
the smallest necessary addition.

Do not add unrelated fields or functionality.

============================================================
7. EXISTING PURCHASE CACHE MUST BE REUSED
============================================================

The repository already contains an existing Purchase search cache.

Keep it.

Do NOT replace it with a completely new caching system.

The current implementation includes Purchase-side cached search results and
local narrowing behavior. It also uses the existing compact inventory cache
from the API service.

Reuse these mechanisms wherever possible.

The desired behavior is:

    USER TYPES
        ↓
    EXISTING PURCHASE CACHE / LOCAL RESULTS
        ↓
    IMMEDIATE FILTERING
        ↓
    DROPDOWN APPEARS
        ↓
    EXISTING BACKEND SEARCH / REFRESH
        ↓
    CACHE UPDATED
        ↓
    AUTHORITATIVE RESULTS RECONCILED

The user should not experience an unnecessary wait for a network request when
a relevant result is already available locally.

============================================================
8. POS-LIKE SPEED
============================================================

The Purchase dropdown should feel similar to the existing POS search.

Do NOT slow Purchase down by loading the complete Master Database from the
server for every keystroke.

Do NOT perform a full database request for every character.

Use the existing cache/search behavior and only modify the data scope where
required.

The expected UX is:

    Type "para"
        ↓
    Existing cached/local data is filtered immediately
        ↓
    Matching medicines appear
        ↓
    Backend search can refresh/reconcile results in the background

Do not compromise data correctness just to make the UI appear fast.

============================================================
9. REST OF APPLICATION MUST REMAIN FILTERED
============================================================

This is NOT a request to expose the Master Database throughout the
application.

The requirement is specifically:

    PURCHASE:
        broad medicine selection

    MASTER DATABASE:
        complete Master Database access

    POS / NORMAL APPLICATION:
        existing application medicine visibility

Therefore, do not change POS, Sales, Inventory, or other medicine selectors
to display every Master Database medicine.

Especially do not make the following appear in POS simply because they exist
in Master Database or historical Purchase:

    - never-purchased Master-only medicines
    - zero-stock historical medicines
    - expired-only historical medicines

Unless the repository shows that the current POS workflow intentionally
already displays them.

============================================================
10. HISTORICAL PURCHASE MEDICINES
============================================================

If a medicine was purchased even once by this pharmacy, that medicine should
remain discoverable in Purchase/history according to the existing data model.

Example:

    Purchase 1:
        Medicine A
        Quantity: 10

Later:

    All 10 sold

Current inventory:

    Medicine A = 0

Purchase search:

    Medicine A MUST still be findable.

Another example:

    Medicine B
    Purchased once
    Batch expired
    Current stock = 0

Purchase search:

    Medicine B MUST still be findable.

Master Database:

    Medicine B MUST remain accessible.

POS:

    Medicine B must continue following the existing POS rule and should not
    appear merely because it exists historically.

============================================================
11. DO NOT CONFUSE INVENTORY WITH MEDICINE EXISTENCE
============================================================

Do NOT use current inventory quantity as the definition of whether a medicine
exists.

These are different concepts:

    MASTER MEDICINE
        = medicine definition/catalog record

    PHARMACY PURCHASE HISTORY
        = medicines this pharmacy has purchased historically

    CURRENT INVENTORY
        = medicines/batches currently held in stock

A medicine can therefore have:

    Master record = YES
    Purchase history = YES
    Current stock = 0

and still be a valid historical medicine.

Likewise:

    Master record = YES
    Purchase history = NO
    Current stock = NO

can be a Master-only medicine that Purchase can select for a first purchase.

============================================================
12. DO NOT CREATE DUPLICATES
============================================================

If Purchase finds an existing Master medicine, use that medicine.

Do not create another Master record for the same medicine just because it is
being purchased.

Do not create:

    Dolo 650
    Dolo 650 #2
    Dolo 650 #3

when the existing medicine identity already exists.

Before implementing duplicate prevention, inspect the existing backend and
database logic to determine how medicine identity is currently handled.

Use the existing mechanism.

============================================================
13. DO NOT MODIFY UNRELATED FIELDS
============================================================

This is a strict requirement.

ONLY touch fields, functions, components, API queries, cache behavior, or
database logic that are directly required for this Purchase medicine-search
change.

DO NOT:

    - add unrelated database fields
    - add unrelated UI fields
    - redesign the Purchase page
    - redesign POS
    - redesign Master Database
    - change unrelated APIs
    - change unrelated validation
    - change unrelated calculations
    - change unrelated inventory logic
    - change unrelated purchase-save behavior
    - change styling unnecessarily
    - rename unrelated variables
    - refactor large parts of the application unnecessarily

Make the smallest targeted modification possible.

============================================================
14. NO ASSUMPTIONS
============================================================

Before implementing, verify each required behavior directly from the
repository.

Specifically inspect:

    - actual Purchase page file(s)
    - actual POS page file(s)
    - actual Master Database page file(s)
    - actual Inventory page/service
    - actual medicine API methods
    - actual inventory API methods
    - actual purchase-history API methods
    - actual cache implementation
    - actual database schema/models/migrations
    - actual backend route handlers related to medicine search/purchase
    - actual medicine ID relationships

If something cannot be verified from the repository:

    DO NOT ASSUME IT EXISTS.

Do not write implementation based on an imagined API, imagined field, or
imagined database relationship.

Instead, continue inspecting the repository until the existing implementation
is understood.

If a requested behavior cannot be safely implemented without introducing a
new architectural element, clearly identify that before making the change.

============================================================
15. IMPLEMENTATION STRATEGY
============================================================

First:

    TRACE CURRENT WORKFLOW.

Second:

    IDENTIFY EXISTING PURCHASE CACHE.

Third:

    IDENTIFY CURRENT POS SEARCH DATASET.

Fourth:

    IDENTIFY CURRENT MASTER DATABASE DATASET.

Fifth:

    IDENTIFY HOW HISTORICAL PURCHASED MEDICINES ARE CURRENTLY STORED.

Sixth:

    Identify the minimum change required so Purchase can search:

        Master
        +
        pharmacy historical medicines
        +
        current inventory

Seventh:

    Reuse the existing Purchase cache to provide instant local filtering.

Eighth:

    Preserve the current POS dataset/filter.

Ninth:

    Test that:

        Current-stock medicine
            -> Purchase searchable
            -> POS behavior unchanged

        Zero-stock historical medicine
            -> Purchase searchable
            -> Master Database searchable
            -> POS does NOT show it if current POS excludes zero stock

        Expired historical medicine
            -> Purchase searchable
            -> Master Database searchable
            -> POS does NOT show it if current POS excludes expired/invalid stock

        Master-only medicine
            -> Purchase searchable
            -> can be selected for purchase
            -> no duplicate Master medicine created

        Completely unknown medicine
            -> existing new-medicine workflow is used

============================================================
16. ACCEPTANCE CRITERIA
============================================================

The implementation is correct only if ALL of the following are true:

1. Purchase medicine search remains fast.

2. Existing Purchase cache is reused.

3. Purchase can search Master Database medicines.

4. Purchase can search medicines previously purchased by the pharmacy.

5. Previously purchased medicines remain searchable even when stock is 0.

6. Previously purchased medicines remain searchable even when their batches
   are expired.

7. Master Database continues to provide access to the complete Master catalog.

8. POS does NOT start showing Master-only medicines.

9. POS does NOT start showing zero-stock/expired historical medicines merely
   because Purchase can now search them.

10. Existing medicine IDs/relationships are reused.

11. Existing medicines are not duplicated.

12. User does not need to manually recreate a Master medicine when that
    medicine already exists.

13. Existing Purchase save, inventory, batch, distributor, and history
    workflows remain intact.

14. No unrelated fields or features are added.

15. No unverified assumptions are made.

16. Only the files/functions actually required for this behavior are modified.

============================================================
FINAL PRINCIPLE
============================================================

DO NOT BUILD A NEW SYSTEM JUST BECAUSE THIS REQUIREMENT SOUNDS LIKE A NEW
SYSTEM.

The existing project already has:

    Purchase search cache
    Compact inventory cache
    Medicine APIs
    Purchase history
    Master Database
    Inventory
    POS medicine search

Use what already exists.

The required change is primarily about:

    WHAT DATA PURCHASE SEARCH IS ALLOWED TO SEE

while preserving:

    WHAT POS AND THE REST OF THE APPLICATION ARE ALLOWED TO SEE

The final behavior should be:

    MASTER DATABASE
        -> complete Master medicine catalog

    PURCHASE
        -> Master medicines
        + pharmacy historical medicines
        + current inventory
        -> fast existing Purchase cache/search

    POS / NORMAL APPLICATION
        -> existing application medicine filtering
        -> do NOT expose Master-only, zero-stock, or expired historical
           medicines merely because Purchase has broader search

Most importantly:

    DO NOT ASSUME.
    INSPECT THE ACTUAL FILES FIRST.
    MODIFY ONLY WHAT IS REQUIRED.
    REUSE THE EXISTING WORKFLOW AND CACHE.
    DO NOT ADD THINGS THAT WERE NOT REQUESTED.