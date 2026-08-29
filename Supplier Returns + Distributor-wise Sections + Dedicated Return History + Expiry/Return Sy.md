IMPLEMENTATION PLAN
Feature: Supplier Returns + Distributor-wise Sections + Dedicated Return History + Expiry/Return Synchronization

Repository:
https://github.com/loki94in/AI-PHARMACY-v2

OBJECTIVE
---------
Modify the existing Returns and Expiry workflow so that:

1. The active Supplier Return screen remains the workspace for creating/currently processing returns.
2. Medicines added to a return are automatically grouped into separate distributor sections.
3. Each distributor section can be collapsed/expanded independently.
4. Each distributor section can be exported independently as its own supplier debit note/return document.
5. Completed/old supplier return bills are handled through the existing/dedicated Return History area instead of cluttering the active return workspace.
6. Medicines/batches added to a supplier return from Expiry or manually from Returns are automatically reconciled with the Expiry list.
7. Once an expiry item/batch/quantity has been added to a return, it must no longer remain available as an actionable expiry item for the same stock.
8. If a return is cancelled/deleted before final processing, the corresponding expiry availability must be restored where appropriate.
9. Existing inventory, return, stock movement, purchase lookup, distributor lookup, and audit behavior must remain intact.
10. Do NOT redesign the existing frontend UI. Reuse the current visual components, layout, buttons, cards, styling, navigation, and interaction patterns wherever possible.
11. Do NOT create unrelated new systems, duplicate APIs, duplicate database tables, or duplicate data models.
12. Only modify files directly related to this feature.

IMPORTANT SCOPE RULE
--------------------
Before changing anything, inspect the current implementation and identify the exact files/functions responsible for:

- Supplier Returns
- Distributor grouping
- Return PDF/debit-note generation
- Return processing
- Return History
- Expiry Monitor
- Expiry → Return prefill/push
- Customer Returns only if the shared return infrastructure requires a change
- API/service methods used by the above
- Backend/database logic used to persist returns and stock movements

Do not modify Customer Returns/POS logic if it is independent and does not require modification for this feature.

Do not change unrelated pages, global UI, authentication, unrelated inventory logic, or unrelated database functionality.

==================================================
1. CURRENT BEHAVIOR TO PRESERVE/UNDERSTAND
==================================================

The existing Returns Command Center is located at:

frontend/src/pages/Returns/index.tsx

The existing project also contains:

frontend/src/pages/Returns/ExpiryReturnReview.tsx
frontend/src/pages/Expiry/
frontend/src/pages/CustomerReturn/
frontend/src/pages/CustomerReturnHistory/

The current Returns implementation already contains important functionality including:

- Multiple return draft tabs.
- Local draft persistence through localStorage.
- Purchase-history lookup.
- Automatic filling of distributor/invoice/purchase/batch/expiry/cost information.
- AI camera scanning.
- Return item quantities.
- Distributor-related data.
- Return history retrieval.
- Return history item loading.
- Return editing/deletion.
- Return processing.
- Cache invalidation after stock writes.
- Expiry review pending count.
- Existing grouped return data structure.

Do not remove these existing capabilities.

The existing code already defines a GroupedReturn structure containing distributor information and item lists. Reuse this existing concept rather than introducing another parallel grouping architecture.

==================================================
2. EXPECTED ACTIVE SUPPLIER RETURN BEHAVIOR
==================================================

The active Supplier Return page should work as follows:

User opens Supplier Returns.

User can continue using the existing Return 1 / Return 2 / additional draft tabs.

User adds medicines normally.

When medicines belong to different distributors, the application must automatically organize them into separate distributor sections.

Example:

Distributor A
    Medicine A1
    Medicine A2
    Medicine A3
    Distributor A total
    Export Distributor A

Distributor B
    Medicine B1
    Medicine B2
    Distributor B total
    Export Distributor B

Distributor C
    Medicine C1
    Distributor C total
    Export Distributor C

The return remains one active draft.

Do NOT create separate drafts merely because distributors are different.

The grouping is a presentation and processing organization layer over the existing return draft.

==================================================
3. DISTRIBUTOR GROUPING RULE
==================================================

The grouping key must be reliable.

Prefer:

distributor_id

and use distributor_name only as a display/fallback value.

Do not group only by distributor name because two records with the same name could represent different distributors.

If distributor_id is unavailable, use the existing fallback behavior already present in the project rather than inventing a new identity mechanism.

Where invoice-level separation is already required by the existing return logic, preserve the existing invoice information inside the distributor section.

Do not lose:

- distributor ID
- distributor name
- invoice number
- purchase date
- medicine ID
- medicine name
- batch number
- expiry date
- quantity
- purchase/cost price
- MRP
- purchase item ID

==================================================
4. COLLAPSE / EXPAND
==================================================

Each distributor section must independently support collapse/expand.

Use the existing UI components/icons/styles already used by Returns or other related pages.

Do not introduce a new design system.

Default behavior should preserve the current usability as much as possible.

Collapsing one distributor must not collapse other distributor sections.

The item data must remain intact while collapsed.

==================================================
5. DISTRIBUTOR-WISE EXPORT
==================================================

The current export/PDF functionality must be changed so that a distributor section can be exported independently.

When the user selects:

Export Distributor A

the generated debit note/PDF must contain ONLY Distributor A's return items.

It must NOT include Distributor B or Distributor C.

The document must continue using the existing supplier debit-note/PDF generation logic and existing formatting wherever possible.

Do not create a completely separate PDF system.

Reuse the existing PDF/export function and pass the selected distributor's grouped items into it.

The exported document must retain the relevant existing information:

- Supplier/distributor name
- Distributor details if currently available
- Return/debit note number
- Date
- Purchase invoice information
- Medicine name
- Batch
- Expiry
- Quantity
- Purchase/cost rate
- Amount
- Existing totals
- Existing applicable tax/financial fields
- Existing pharmacy/business information

Only the selected distributor's data should be included.

If the current application supports a combined export, do not unnecessarily remove it unless the current behavior directly conflicts with the new requirement. The primary requirement is that individual distributor export must work.

==================================================
6. RETURN PROCESSING
==================================================

Processing the active return must continue using the existing backend/API workflow.

When a return is processed:

- Returned quantity must be deducted from inventory according to existing rules.
- Existing stock_movements behavior must remain intact.
- Return record must be saved.
- Return items must be saved.
- Existing audit/history behavior must remain intact.
- Existing cache invalidation must remain intact.
- POS/inventory search cache refresh behavior must remain intact where currently required.

Do not duplicate stock deduction logic in the frontend.

Do not create a second inventory adjustment mechanism.

The frontend should call the existing processing API/service.

If the backend currently expects the complete return as one transaction, preserve that behavior unless the existing architecture explicitly supports distributor-level processing.

==================================================
7. DISTRIBUTOR-WISE PROCESSING CONSIDERATION
==================================================

The UI must allow the user to understand and export each distributor separately.

However, do not automatically split database transactions into multiple returns unless the existing data model requires it.

The key distinction is:

UI:
Distributor-wise sections.

Data:
Existing return architecture.

If the current backend already stores distributor/invoice-level return information, reuse it.

If the business requirement requires each distributor to become an individually identifiable return/debit-note record after processing, inspect the existing database/API model first and make the smallest necessary backend change.

Do not create a new database table unless there is genuinely no existing place to store the required information.

==================================================
8. DEDICATED RETURN HISTORY
==================================================

The active Returns workspace should focus on current/draft returns.

Completed/old supplier return bills should be accessible through the existing Return History functionality/page where possible.

Inspect the existing:

CustomerReturnHistory

and any existing supplier return history implementation before creating anything new.

Do NOT duplicate an existing history system.

If there is already a supplier return history section in Returns/index.tsx, extract/reuse only what is necessary so completed supplier return records can be viewed as historical records without affecting the active return workflow.

History should allow the user to:

- Search old returns.
- Filter by relevant existing fields.
- Open/view a completed return.
- View its distributor.
- View returned medicines.
- View batches.
- View quantities.
- View financial totals.
- Reprint/export the applicable debit note.
- Preserve existing edit/delete functionality only where the existing business rules allow it.

Do not remove existing audit capabilities.

==================================================
9. EXPIRY → SUPPLIER RETURN
==================================================

When the user is in Expiry Monitor and selects:

Add to Return / Push to Return

the existing expiry item information must be transferred into the Supplier Return draft.

The return item should retain as much existing information as available:

- medicine ID
- medicine name
- batch
- expiry date
- current/returnable quantity
- purchase/cost price
- MRP
- purchase item ID
- purchase invoice number
- purchase date
- distributor ID
- distributor name

Do not make the user manually re-enter information that the application already knows.

The existing Expiry → Return flow should be reused and corrected rather than replaced with a new flow.

==================================================
10. CRITICAL EXPIRY SYNCHRONIZATION RULE
==================================================

When an expiry item/batch is added to a supplier return, it must immediately stop appearing as an actionable/available expiry item for that same returnable stock.

Example:

Expiry Monitor:

Medicine X
Batch B001
Stock: 20
Expiry: 15/09/2026

User adds 20 units to Supplier Return.

Expected Expiry Monitor behavior:

Medicine X / Batch B001 must no longer appear as available expiry stock for return.

If the expiry page uses a status such as:

Pending Return
Queued for Return
Return Staged

then use the existing status architecture if available.

Do not simply hide the item permanently from the database.

The application must retain enough information to know that the stock has been staged/returned.

==================================================
11. PARTIAL QUANTITY EXPIRY RULE
==================================================

The synchronization must support partial returns.

Example:

Expiry stock:

Batch B001 = 20 units.

User adds 5 units to Supplier Return.

Expected:

Expiry actionable quantity = 15 units.

The system must not incorrectly remove the entire batch if only 5 units were returned/staged.

If another 15 units are later added to a return:

Remaining actionable quantity = 0.

At that point the batch should no longer appear as actionable in Expiry Monitor.

Do not use a simple boolean "returned=true" if it cannot support partial quantities.

Use quantity-aware calculations based on the existing stock/return data.

==================================================
12. MANUAL RETURN → EXPIRY SYNCHRONIZATION
==================================================

If the user adds an expired/near-expiry medicine manually from the Supplier Returns page rather than using the Expiry page:

The application should identify the corresponding stock batch using existing identifiers such as:

- medicine_id
- batch_no
- expiry_date
- purchase_item_id where available

and ensure that the same quantity is no longer treated as freely available for expiry return.

This must prevent duplicate return selection.

Do not interfere with normal inventory stock until the return is actually processed if the existing business workflow treats the draft as only staged.

The distinction must be maintained:

DRAFT/STAGED RETURN
=
Reserved/queued for return in the expiry workflow.

PROCESSED RETURN
=
Actually removed from inventory.

==================================================
13. CANCEL / DELETE / REMOVE FROM RETURN
==================================================

If a user removes an expiry-derived medicine from the active return before processing:

The previously reserved/staged expiry quantity should become available again in Expiry Monitor.

Example:

Expiry stock = 20.

User adds 10 to return.

Expiry available = 10.

User removes those 10 from the draft.

Expiry available must return to 20.

If the return has already been processed, do NOT restore expiry availability merely because a UI item is deleted.

Processed return behavior must follow the existing backend/audit rules.

==================================================
14. PROCESSING VS DRAFT RESERVATION
==================================================

Do not confuse a draft return with an actual inventory return.

A draft should not cause duplicate physical stock deduction.

Existing inventory deduction must happen at the existing processing stage.

The expiry page should calculate actionable stock by accounting for quantities already staged/queued in active returns where appropriate.

If the existing backend has no concept of staged quantity, implement the smallest possible mechanism using the existing return/draft infrastructure.

Prefer server-side calculation for authoritative stock values.

Do not rely only on localStorage for inventory correctness.

localStorage may continue to store the user's UI draft, but inventory/expiry availability must not depend exclusively on browser-local data.

==================================================
15. DATA CONSISTENCY
==================================================

The following must always remain consistent:

Inventory stock
    ↕
Supplier returns
    ↕
Return items
    ↕
Stock movements
    ↕
Expiry Monitor
    ↕
Expiry Return Review
    ↕
Return History

Do not solve the problem by simply filtering the frontend.

The frontend filter must reflect actual application state.

Where possible, derive the state from existing API/database records.

==================================================
16. EXPIRY RETURN REVIEW
==================================================

Inspect:

frontend/src/pages/Returns/ExpiryReturnReview.tsx

before modifying the expiry workflow.

If an expiry item is staged for review, the same item/quantity must not be duplicated when the user later pushes it into Supplier Return.

Preserve:

- pending review
- approve
- reject
- physical quantity verification
- quantity adjustment
- existing return staging behavior

If approved/reviewed items are already connected to return records, reuse that relationship.

Do not introduce a second expiry-review queue.

==================================================
17. API/SERVICE LAYER
==================================================

Inspect the existing API service implementation for:

- getReturns
- getReturnItems
- updateReturn
- deleteReturn
- return processing
- lookupPurchases
- expiry queries
- expiry review
- distributor queries
- PDF/export-related API calls if any

Reuse existing endpoints whenever possible.

Only add or modify an API endpoint when the current API genuinely cannot provide the required behavior.

If an API change is necessary:

- Keep naming consistent with the existing API.
- Keep response structures backward compatible where possible.
- Do not break Customer Returns.
- Do not duplicate existing endpoints.
- Validate quantities server-side.
- Validate medicine/batch relationships server-side.

==================================================
18. DATABASE/BACKEND
==================================================

Before changing database/backend code, inspect the current schema and return processing implementation.

Determine whether existing tables already contain enough information for:

- return
- return_items
- distributor
- purchase invoice
- purchase item
- batch
- stock
- stock_movements
- expiry review/staging

Prefer using existing columns/relationships.

Only add a database field if it is absolutely required to distinguish staged return quantities from processed quantities.

If a migration is required:

- Create only the necessary migration.
- Keep existing records compatible.
- Do not alter unrelated tables.
- Do not change existing data unnecessarily.

==================================================
19. CACHE / REFRESH BEHAVIOR
==================================================

The existing Returns code already uses centralized stock-write invalidation.

Preserve that architecture.

After:

- creating a return
- processing a return
- deleting a return
- editing a return
- changing expiry return staging

invalidate/refetch only the relevant queries.

At minimum ensure the following views become consistent:

- Returns
- Expiry Monitor
- Expiry Return Review
- Inventory where affected
- Return History

Do not introduce aggressive polling.

Use the existing event/SSE/cache invalidation architecture already present in the project.

==================================================
20. FRONTEND UI CONSTRAINT
==================================================

STRICT:

Do NOT redesign the application UI.

Do NOT change:

- global colors
- global typography
- navigation design
- sidebar design
- page structure unrelated to this feature
- existing button style
- existing card style
- unrelated pages
- unrelated components

Only modify the existing Returns/Expiry UI enough to support:

- distributor grouping
- collapse/expand
- distributor-level export
- correct expiry synchronization

Reuse existing components and styling classes.

==================================================
21. FILE-SCOPE RULE
==================================================

The code agent must identify and modify only files directly responsible for this feature.

Expected candidate files include, but MUST NOT be assumed without inspection:

frontend/src/pages/Returns/index.tsx
frontend/src/pages/Returns/ExpiryReturnReview.tsx
frontend/src/pages/Expiry/*
frontend/src/pages/CustomerReturnHistory/* only if shared history behavior genuinely requires it
frontend/src/services/api*
backend return/expiry API files
backend database/schema/migration files only if required
existing PDF/debit-note utility files only if required

Do not modify files merely because they are nearby.

Before making changes, establish:

CURRENT FILE
    ↓
CURRENT FUNCTION
    ↓
WHY IT MUST CHANGE
    ↓
EXPECTED RESULT

Every modified file must have a direct reason related to this feature.

==================================================
22. DUPLICATE-PREVENTION RULE
==================================================

The application must prevent the same medicine batch/quantity from being accidentally returned twice through:

- Expiry Monitor
- Expiry Return Review
- Supplier Returns
- multiple active return drafts

Use the existing medicine/batch/purchase-item identifiers.

For quantity validation, consider:

physical stock
-
already processed return quantity
-
already staged return quantity

=
currently returnable quantity

Do not allow the user to exceed the actual available quantity.

==================================================
23. MULTIPLE RETURN DRAFTS
==================================================

Existing multiple draft tabs must continue working.

Example:

Return 1:
Distributor A + Distributor B

Return 2:
Distributor A + Distributor C

The system must not incorrectly treat Return 2's items as belonging to Return 1.

When calculating staged expiry quantities, account for all active drafts if the business rule is global reservation.

If localStorage is currently the only storage mechanism for drafts, do not treat it as authoritative inventory state.

The final server-side validation must prevent over-returning stock.

==================================================
24. HISTORY / COMPLETED RETURN DATA
==================================================

After processing:

Active draft
    ↓
Processed return
    ↓
Return History

The completed return should retain the exact distributor/item/batch/quantity/financial information required to reproduce the debit note later.

History must not depend on the current purchase data remaining unchanged.

Historical records should use the existing stored return information wherever available.

==================================================
25. ERROR HANDLING
==================================================

Do not silently create inconsistent state.

If return processing fails:

- Do not remove expiry availability permanently.
- Do not claim stock was returned.
- Do not clear the draft as if successful.

If expiry synchronization fails:

- Do not silently allow duplicate return quantities.
- Surface an appropriate existing-style error.
- Keep the draft data intact.

Use existing application error handling patterns.

==================================================
26. ACCEPTANCE TESTS
==================================================

Test all of the following after implementation.

TEST 1:
Add medicines from one distributor.
Expected:
One distributor section.

TEST 2:
Add medicines from two distributors.
Expected:
Two independent distributor sections.

TEST 3:
Collapse Distributor A.
Expected:
Distributor A items hidden; Distributor B unaffected.

TEST 4:
Export Distributor A.
Expected:
PDF contains only Distributor A.

TEST 5:
Process return.
Expected:
Inventory decreases according to existing rules.
Return is saved.
Return history shows it.

TEST 6:
Open historical return.
Expected:
Correct distributor, medicines, batches, quantities, prices, and totals.

TEST 7:
Expiry stock = 20.
Add 5 to return.
Expected:
Expiry actionable quantity = 15.

TEST 8:
Remove the 5-unit draft item.
Expected:
Expiry actionable quantity returns to 20.

TEST 9:
Expiry stock = 20.
Add all 20 to return.
Expected:
Expiry batch is no longer actionable.

TEST 10:
Try adding more than remaining quantity.
Expected:
Application prevents over-return.

TEST 11:
Add expiry item to Return 1.
Try adding same batch/quantity to Return 2.
Expected:
Duplicate quantity cannot exceed available stock.

TEST 12:
Process expiry-derived return.
Expected:
Inventory, expiry status, return record, stock movements, and history remain consistent.

TEST 13:
Delete/cancel an unprocessed return.
Expected:
Reserved expiry quantity becomes available again.

TEST 14:
Existing Customer Return/POS refund flow.
Expected:
No regression.

TEST 15:
Existing purchase lookup.
Expected:
No regression.

TEST 16:
Existing AI Camera return flow.
Expected:
No regression.

TEST 17:
Existing expiry review flow.
Expected:
No duplicate staging or return.

TEST 18:
Existing multiple draft tabs.
Expected:
No cross-contamination between drafts.

==================================================
27. IMPLEMENTATION ORDER
==================================================

Step 1:
Inspect all relevant existing Returns, Expiry, Review, History, API, backend, and database code.

Step 2:
Map the current data flow:

Purchase
→ Inventory
→ Expiry
→ Return Draft
→ Return Review
→ Process Return
→ Stock Movement
→ Return History

Step 3:
Identify where distributor grouping already exists and reuse it.

Step 4:
Modify active Supplier Return rendering so grouped distributor sections are displayed independently.

Step 5:
Add independent collapse/expand state per distributor section.

Step 6:
Modify the existing export function so it accepts a selected distributor/group and generates only that group's debit note.

Step 7:
Keep completed return records accessible through the dedicated/existing history mechanism.

Step 8:
Modify Expiry → Return synchronization so staged quantities are accounted for.

Step 9:
Add quantity-aware synchronization for partial returns.

Step 10:
Ensure removing an unprocessed return item releases the staged expiry quantity.

Step 11:
Ensure server-side processing validates actual available stock.

Step 12:
Update only necessary cache invalidation/refetch behavior.

Step 13:
Run TypeScript/build/lint/tests relevant to changed files.

Step 14:
Cross-check every changed file against this implementation plan.

==================================================
28. DO NOT DO THESE THINGS
==================================================

Do NOT:

- redesign the frontend
- create a new Returns UI from scratch
- create duplicate Return History systems
- create duplicate expiry systems
- create duplicate stock tables
- create duplicate APIs
- modify unrelated modules
- change Customer Returns unnecessarily
- move files unnecessarily
- rename unrelated components
- introduce polling if existing event/cache mechanisms work
- use localStorage as authoritative inventory state
- deduct stock when merely creating a draft
- permanently delete expiry data merely because it was staged
- allow duplicate return quantities
- combine different distributors into one export
- create separate drafts automatically for every distributor
- change existing styling unless required for the distributor grouping behavior

==================================================
29. FINAL CODE-AGENT CROSS-CHECK
==================================================

Before finishing, verify:

[ ] Current Return draft functionality still works.
[ ] Multiple draft tabs still work.
[ ] Purchase auto-lookup still works.
[ ] AI Camera still works.
[ ] Distributor data is preserved.
[ ] Items are grouped by distributor.
[ ] Distributor sections can collapse/expand independently.
[ ] Each distributor can be exported independently.
[ ] Export contains only the selected distributor.
[ ] Processed returns still deduct stock correctly.
[ ] stock_movements remains correct.
[ ] Return History contains processed supplier returns.
[ ] Historical return details remain accurate.
[ ] Expiry → Return works.
[ ] Manual Return → Expiry synchronization works.
[ ] Partial expiry quantities work.
[ ] Removing an unprocessed return releases expiry quantity.
[ ] Duplicate return quantities are prevented.
[ ] Multiple drafts cannot cause over-return.
[ ] Expiry Review does not create duplicate return quantities.
[ ] Customer Returns/POS behavior is unchanged.
[ ] No unrelated frontend UI has been changed.
[ ] No unrelated files have been modified.
[ ] No unnecessary new files/tables/APIs have been created.
[ ] TypeScript/build/lint/tests pass.
[ ] Final diff contains only feature-related changes.

==================================================
SHORT OLD BEHAVIOR vs NEW BEHAVIOR
==================================================

OLD BEHAVIOR
------------
User adds medicines to Supplier Return.
Different distributors can end up together in the return workspace.
Export/history behavior is tied more closely to the combined return workflow.
Expiry items can remain visible/actionable even after being staged for return, creating a risk of duplicate selection.
The active return area also carries historical-return functionality.

NEW BEHAVIOR
------------
User adds medicines to Supplier Return.
The application automatically groups them by distributor inside the same draft.

Distributor A
    → its own collapsible section
    → its own total
    → its own export

Distributor B
    → its own collapsible section
    → its own total
    → its own export

Completed returns are handled through Return History.

Expiry quantities are synchronized with active/staged returns.

If 5 of 20 expiry units are added to return:
    Expiry available = 15.

If the 5 are removed before processing:
    Expiry available = 20 again.

If all 20 are staged:
    No remaining actionable expiry quantity.

When the return is actually processed:
    Inventory is deducted using the existing stock/return backend flow,
    stock movement is recorded,
    return history is updated,
    and expiry state remains consistent.

The UI design remains the existing application UI.
Only the functionality and data flow required for this feature are changed.

FINAL REQUIREMENT
-----------------
Implement the feature by modifying the smallest possible set of existing related files.

Do not make broad architectural changes.

Do not modify unrelated files.

Do not change the frontend UI design.

Do not remove existing working functionality.

Reuse existing components, APIs, data models, cache invalidation, PDF generation, and return/expiry mechanisms wherever they already satisfy the requirement.

After implementation, provide a concise summary listing:

1. Files actually modified.
2. What changed in each modified file.
3. Old behavior vs new behavior.
4. Any new file/API/database migration created, with the reason it was genuinely necessary.
5. Tests/build/lint verification performed.