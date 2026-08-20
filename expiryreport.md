AI Pharmacy — Near-Expiry Audit Report Implementation Plan

Objective

Modify only the Near-Expiry reporting/audit flow so that it reports:

1. Near-expiry batches based on the actual expiry date.
2. Only batches that are currently physically present in inventory_master.
3. Only remaining unsold stock — never completely sold-out stock.
4. Never stock that has already been processed as an expiry return.
5. No unrelated changes to POS, billing, purchases, sales, inventory, OCR, WhatsApp, or other reports.

⸻

1. Current Implementation Audit

Current Expiry page

frontend/src/pages/Expiry/index.tsx already loads the expiry list from the expiry API and displays inventory-based expiry information.

The backend src/routes/expiry.ts already uses:

* inventory_master
* quantity > 0
* active inventory
* expiry-date filtering

The cache-backed path also filters with:

* quantity > 0
* requested expiry date range

Therefore, completely sold inventory is already excluded from the primary Expiry page.

Current Returns → Near Expiry implementation

src/routes/returns.ts currently exposes:

GET /returns/near-expiry

It reads:

* inventory_master
* medicine
* purchase history
* distributor

and requires:

im.quantity > 0

It then calculates the expiry threshold.

Existing problem

The endpoint does not explicitly exclude batches that have already been processed through the expiry-return workflow.

Therefore the same batch can potentially remain eligible for the Near-Expiry return/report flow even though it has already been returned.

The current implementation is therefore:

inventory quantity > 0 + expiry date

but the required implementation is:

current inventory quantity > 0 + expiry date + not already returned

⸻

2. Required Rule

The single source of truth for whether stock is physically available must remain:

inventory_master

The report must never derive current stock from:

* sales history
* purchase quantity
* medicine master
* historical purchase quantity
* return history alone

Current stock must come from the current inventory row.

Eligibility formula

A batch is eligible for Near-Expiry Audit reporting only when:

inventory_master.quantity > 0

AND

expiry_date >= report_start_date

AND

expiry_date <= report_end_date

AND

batch has not already been completely processed as an expiry return

AND

inventory row is active

⸻

3. Change #1 — Near-Expiry Date Logic

Use the actual expiry date from the inventory batch.

The existing system supports expiry values such as:

* MM/YY
* MM/YYYY
* normal date values

Keep the existing date parsing behavior.

Do not introduce a second expiry-date system.

The report must calculate:

days_remaining = expiry_date - today

and classify the item according to the existing selected date window.

Examples:

* today → expired
* within 30 days → near expiry
* within 60 days → near expiry
* within 90 days → near expiry
* outside selected range → not shown

Do not change the existing date-range UI.

⸻

4. Change #2 — Only Current Unsold Inventory

The Near-Expiry report must use inventory_master as the authoritative current-stock source.

Required condition:

quantity > 0

and, where applicable:

is_active = 1

This guarantees:

* fully sold batches are excluded
* zero-stock batches are excluded
* inactive inventory rows are excluded
* historical purchase records alone cannot make an item appear

Important

Do NOT calculate:

purchase quantity - sales quantity

inside the report.

Do NOT reconstruct inventory from sales history.

Use the application’s already-maintained inventory quantity.

This keeps the implementation consistent with the existing inventory architecture.

⸻

5. Change #3 — Exclude Already Returned Expiry Stock

The Near-Expiry report must also check the expiry-return workflow.

The query must identify the same medicine + batch combination in the expiry-return records.

The key identity should be:

medicine_id + batch_no

The report must not display a batch as a new return candidate when that batch has already been completely processed as an expiry return.

Important distinction

Do not simply exclude every batch that has ever had a return record if partial-return behavior is supported.

Correct business behavior is:

Current inventory quantity
    >
Already returned quantity

If current inventory has no remaining stock, the batch is excluded.

If a previous return already removed the relevant stock and the current inventory quantity is zero, it is excluded automatically.

If a batch still has genuine stock remaining, only the remaining stock may be eligible.

The implementation must therefore prevent duplicate return candidates without hiding legitimate remaining stock.

⸻

6. Backend Change Location

Primary backend file:

src/routes/returns.ts

Target endpoint:

GET /returns/near-expiry

Current query:

FROM inventory_master im
JOIN medicines m ...
LEFT JOIN purchase_items ...
LEFT JOIN purchases ...
LEFT JOIN distributors ...
WHERE im.quantity > 0

Modify only this endpoint’s eligibility query/processing.

Do not replace the entire Returns route.

Do not create a new worker.

Do not create a new database.

Do not create a second inventory table.

Do not modify POS stock logic.

⸻

7. Recommended Backend Query Strategy

Keep the current inventory-based query.

Add the minimum required exclusion logic for already-processed expiry returns.

Conceptually:

SELECT
    im.id AS inventory_id,
    im.medicine_id,
    im.batch_no,
    im.expiry_date,
    im.quantity,
    im.cost_price,
    im.mrp,
    m.name AS medicine_name,
    d.name AS distributor_name,
    d.id AS distributor_id
FROM inventory_master im
JOIN medicines m
    ON im.medicine_id = m.id
LEFT JOIN purchase_items pi
    ON pi.medicine_id = m.id
   AND pi.batch_no = im.batch_no
LEFT JOIN purchases p
    ON pi.purchase_id = p.id
LEFT JOIN distributors d
    ON p.distributor_id = d.id
WHERE COALESCE(im.is_active, 1) = 1
  AND im.quantity > 0

Then apply the existing expiry-date calculation.

The already-returned check should use the existing return data structures rather than introducing another table.

⸻

8. Prevent Duplicate Expiry-Return Candidates

Before returning the final Near-Expiry list:

inventory batch
       ↓
quantity > 0 ?
       ↓ yes
expiry inside selected range ?
       ↓ yes
already completely returned ?
       ↓ no
SHOW

Otherwise:

DO NOT SHOW

This rule must be applied server-side.

Do not rely only on React filtering.

The frontend should never receive an invalid return candidate in the first place.

⸻

9. Audit Report Change

Primary audit engine:

src/utils/auditEngine.ts

Current Expiry audit checks only expiry-return approval accountability.

Add one focused audit check to the existing Expiry category.

Do not create another audit category.

Do not change the Audit Center layout.

The new check should verify:

Near-expiry report candidate
        =
current inventory
        +
valid expiry date
        +
quantity > 0
        -
already returned stock

The audit should detect if the Near-Expiry query can expose:

* zero-stock batches
* fully sold batches
* fully returned batches

If such records are detected, the audit should produce an Expiry finding.

Suggested finding ID:

EXP-NEAR-EXPIRY-STOCK-SCOPE

Severity:

HIGH

because this can cause an operator to attempt a duplicate supplier return.

⸻

10. Audit Finding Definition

Suggested summary:

Near-expiry reporting contains stock that is no longer an eligible current inventory return candidate.

Location:

src/routes/returns.ts — GET /returns/near-expiry
inventory_master / return_items

Expected action:

Update the Near-Expiry query so that only active inventory with positive remaining quantity and no already-completed expiry return is returned.

The audit must calculate the finding from live database data.

Do not hardcode a finding.

⸻

11. Frontend Change

Primary frontend files:

frontend/src/pages/Expiry/index.tsx
frontend/src/pages/AuditCenter/index.tsx

Keep changes minimal.

The Expiry page already uses the expiry API and already works with current inventory quantity.

Do not redesign the page.

Do not add another Near-Expiry table.

Do not add another filter panel.

Do not add another dashboard card.

The existing UI should simply receive the corrected backend result.

The Audit Center should continue displaying the existing audit finding structure.

⸻

12. Required UI Result

If inventory contains:

Batch	Expiry	Current Qty	Sold	Returned	Show?
A	within window	10	90	0	YES
B	within window	0	100	0	NO
C	within window	0	50	50	NO
D	outside window	20	0	0	NO
E	within window	20	0	0	YES

The report must show only:

A
E

The important point is that the report represents what is physically still in inventory now, not what was historically purchased or sold.

⸻

13. Return Workflow Protection

The same eligibility rule must also be respected when the Expiry page sends selected rows to Returns.

Existing flow:

Expiry page
    ↓
Select item
    ↓
Send to Returns
    ↓
Returns workspace

Do not break this flow.

The backend must remain the final authority.

If an item disappears from inventory between selection and processing, the return operation must not blindly process it.

The existing process-returns transaction should continue to be used.

Do not replace the transaction mechanism.

⸻

14. Cache Consideration

The repository already has an expiry cache.

Do not create another cache.

The existing expiry cache is already designed around the principle that cache entries represent stock with quantity greater than zero, and missing month files represent no remaining stock.

Keep that architecture.

After stock writes/returns, the existing cache invalidation/rebuild mechanism should remain responsible for refreshing expiry data.

No new background service is required.

⸻

15. Exactly Three Changes — Scope Lock

Only these three functional changes are allowed:

Change 1 — Date

Near-Expiry items must be selected strictly according to the actual expiry date and selected date window.

Change 2 — Current inventory

Only currently present inventory with positive remaining quantity can appear.

Sold-out/zero-stock historical items must never appear.

Change 3 — Already returned

Already completely processed expiry-return stock must not appear again as a new Near-Expiry return candidate.

Everything else remains unchanged.

⸻

16. Explicitly Do Not Change

Do NOT modify:

* POS
* Billing
* Sales calculation
* Purchase calculation
* Inventory deduction logic
* OCR
* WhatsApp
* Distributor mapping
* Pharmarack
* Customer Returns
* Purchase Returns
* Medicine master
* Database architecture
* SQLite connection architecture
* WorkerSupervisor
* caching architecture
* Audit Center layout
* existing expiry date UI
* existing return processing transaction
* unrelated audit checks

No refactor.

No new abstraction layer.

No new service.

No new database table.

No new API unless absolutely required by an existing implementation constraint.

⸻

17. Validation Tests

The implementation is complete only when all of these pass.

Test 1 — Unsold near-expiry

Inventory:

quantity = 10
expiry = within selected window

Expected:

VISIBLE

Test 2 — Completely sold

Inventory:

quantity = 0
expiry = within selected window

Expected:

NOT VISIBLE

Test 3 — Already returned

Batch has already been completely processed through expiry return.

Current inventory:

quantity = 0

Expected:

NOT VISIBLE

Test 4 — Partially sold

Original purchase:

100

Sold:

70

Current inventory:

30

Expiry within window.

Expected:

VISIBLE — quantity 30

Test 5 — Outside expiry window

Current inventory:

quantity = 20

Expiry outside selected range.

Expected:

NOT VISIBLE

Test 6 — Partial return

Original inventory:

50

Returned:

20

Remaining inventory:

30

If the application’s existing workflow allows remaining stock to be returned later:

VISIBLE — quantity 30

The report must never show the already-returned 20 as current stock.

Test 7 — Audit validation

Run Audit Center.

The Expiry category must report CLEAN when the Near-Expiry source contains only:

active inventory
+
quantity > 0
+
valid expiry window
+
eligible remaining stock

⸻

18. Final Acceptance Rule

The implementation is accepted only if this statement is always true:

Every item shown in Near-Expiry Audit/Expiry Return is a real batch that currently has remaining inventory and is within the selected expiry window; no fully sold or already completely returned batch can appear.

If the database contains historical sales, old purchases, old returns, or old expiry records, those historical records must not resurrect an item in the current Near-Expiry report.

The current inventory_master state is authoritative for current stock.

⸻

19. Implementation Order

1. Audit the existing /returns/near-expiry query.
2. Add the minimum server-side exclusion for already-completed expiry returns.
3. Preserve inventory_master.quantity > 0.
4. Preserve existing expiry-date parsing.
5. Preserve existing distributor/purchase lookup.
6. Add the single Expiry audit validation to auditEngine.ts.
7. Do not redesign frontend.
8. Run the seven validation scenarios.
9. Run the existing project tests/build.
10. Verify the Audit Center reports CLEAN after the data is correct.

Definition of Done

No additional feature is required.

The task is complete when:

Near Expiry
    =
Current Inventory
    +
Correct Expiry Date
    +
Positive Remaining Quantity
    -
Completely Returned Stock

and the Audit Center validates that rule.