IMPLEMENTATION PLAN
Feature: Add Batch Number to POS Sale Bill PDF Only

Repository:
https://github.com/loki94in/AI-PHARMACY-v2

============================================================
1. OBJECTIVE
============================================================

Make ONE specific change to the existing bill PDF:

Add the medicine's Batch Number to the generated POS bill PDF.

Nothing else in the application should be changed.

The existing application behavior, frontend UI, POS workflow, Sell History, Credit CRM, Refill, discount, tax, totals, inventory, and database behavior must remain exactly as they currently work.

This is a targeted PDF-generation modification only.

============================================================
2. CURRENT BEHAVIOR
============================================================

Currently, when a POS sale/bill is generated:

- The existing bill is created normally.
- The existing POS sale workflow works normally.
- The existing sale information is saved normally.
- The existing Sell History displays its current information.
- The existing discount behavior remains unchanged.
- The existing tax calculation remains unchanged.
- The existing total calculation remains unchanged.
- The existing Credit CRM behavior remains unchanged.
- The existing Refill behavior remains unchanged.
- The PDF is generated using the application's current bill/PDF generation logic.

PROBLEM:

The Batch Number of the sold medicine is available in the application's sale/inventory data, but it is missing from the generated PDF.

============================================================
3. EXPECTED BEHAVIOR
============================================================

When the user generates/downloads/sends the existing POS bill PDF:

The PDF should continue displaying everything that it currently displays.

The ONLY additional information required is:

BATCH NUMBER

for each medicine line/item.

Example:

Medicine Name | Batch No. | Qty | MRP | Tax | Total

The exact existing PDF layout/design should be preserved.

The Batch Number should be added using the same existing PDF table/line structure and styling as much as possible.

============================================================
4. VERY IMPORTANT: DO NOT ADD PURCHASE RATE
============================================================

Purchase Rate / Cost Price must NOT be added to the PDF.

The PDF is a customer-facing POS sales bill.

Do NOT expose:

- Purchase Rate
- Cost Price
- Supplier purchase price
- Distributor purchase price
- Internal purchase information
- Any other internal inventory information

The only inventory-related field being added is:

Batch Number.

============================================================
5. DO NOT CHANGE POS SELL HISTORY
============================================================

The POS Sell History must remain exactly as it currently behaves.

Do NOT:

- Add Batch Number to Sell History unless it is already displayed there.
- Change Sell History columns.
- Change Sell History UI.
- Change Sell History filters.
- Change Sell History search.
- Change Sell History calculations.
- Change historical sale behavior.

The requirement is specifically for the PDF.

============================================================
6. DO NOT CHANGE DISCOUNT BEHAVIOR
============================================================

Existing discount functionality must remain untouched.

If the bill already has a discount:

- Keep the existing discount value.
- Keep the existing calculation.
- Keep the existing saved value.
- Keep the existing PDF behavior for discount.

Do not recalculate discount.

Do not introduce a new discount field.

Do not modify discount storage.

Do not change the frontend discount UI.

If the existing PDF already hides the discount when no discount exists, preserve that behavior.

============================================================
7. DO NOT CHANGE TAX OR TOTAL CALCULATION
============================================================

Tax calculation must remain exactly as it is.

Total calculation must remain exactly as it is.

Do not recalculate:

- Subtotal
- Discount
- Tax
- Grand Total
- Item total
- Any existing financial value

The implementation should only retrieve/display the existing Batch Number.

============================================================
8. BATCH NUMBER SOURCE
============================================================

The Batch Number must come from the existing sale/bill data already used by the application.

First inspect the current POS sale/PDF generation flow and identify:

1. Where the sold medicine information is stored.
2. Where the selected batch is stored.
3. Where the PDF receives its sale-item data.
4. Whether batch_no already exists in the PDF generation payload.
5. If batch_no exists, use it directly.
6. If batch_no exists in the sale/inventory API response but is not passed to the PDF, modify only the required mapping/field selection.

Do NOT create a duplicate batch-number system.

Do NOT create a new database field if batch_no already exists.

Do NOT fetch purchase information merely to obtain the batch number.

============================================================
9. PURCHASE DATA MUST NOT BE USED
============================================================

The implementation must NOT introduce a dependency on:

- Purchase Rate
- Purchase Invoice
- Purchase Cost
- Distributor purchase records

just to display Batch Number.

If Batch Number is already associated with the sold inventory batch, use that existing value.

The PDF should remain independent from unnecessary purchase-price information.

============================================================
10. PDF DISPLAY
============================================================

Add Batch Number to the existing medicine/item section.

Use the current PDF's existing:

- Table structure
- Font
- Font size
- Spacing
- Alignment
- Borders
- Header style
- Footer style
- Page-break behavior

Do not redesign the PDF.

Only extend the existing medicine/item information to include:

Batch No.

The exact placement should follow the existing PDF's table structure and available space.

For example, if the current PDF has:

Medicine | Qty | MRP | Tax | Total

change only the relevant item table to:

Medicine | Batch No. | Qty | MRP | Tax | Total

Do not otherwise redesign the document.

============================================================
11. MULTIPLE MEDICINES
============================================================

Every medicine line must show its own Batch Number.

Example:

Medicine A → Batch A123
Medicine B → Batch B456
Medicine C → Batch C789

Do not display only one batch number for the entire invoice.

The batch must correspond to the exact sold item/batch.

============================================================
12. MISSING BATCH NUMBER
============================================================

If an old sale or legacy sale genuinely has no batch number available:

- Do not invent a value.
- Do not query unrelated purchase data.
- Do not break PDF generation.
- Keep the existing PDF generation working.
- Display the existing application's appropriate empty/placeholder behavior if one already exists.

Do not create fake values such as:

N/A

unless the current PDF generation convention already uses N/A.

For new sales where batch data exists, the actual batch number must be displayed.

============================================================
13. FRONTEND UI REQUIREMENT
============================================================

STRICT REQUIREMENT:

DO NOT CHANGE THE FRONTEND UI.

Do not modify:

- POS screen design
- POS medicine selection UI
- POS checkout UI
- Sell History UI
- Credit CRM UI
- Refill UI
- Navigation
- Sidebar
- Global styling
- Buttons
- Cards
- Tables unrelated to the PDF
- Any unrelated page

The user should not see a new UI control for this feature.

The Batch Number should simply appear automatically in the generated PDF.

============================================================
14. FILE-SCOPE REQUIREMENT
============================================================

The agent MUST first inspect the repository and identify the exact file responsible for generating the POS sale bill PDF.

Only that specific PDF-generation file should be modified if it already receives batch_no.

If the PDF-generation file does not currently receive batch_no, then identify the smallest related file/function responsible for supplying the existing batch number to the PDF generator.

Only modify that additional file if absolutely necessary.

Potentially relevant files may include:

- Existing POS bill/PDF generator
- Existing POS sale item mapping
- Existing sale API response mapping

BUT:

These are examples only.

Do NOT modify them unless inspection proves they are directly required.

============================================================
15. NO UNRELATED FILE CHANGES
============================================================

The code agent must NOT:

- Refactor unrelated code.
- Rename unrelated functions.
- Rename unrelated variables.
- Reformat unrelated files.
- Upgrade dependencies.
- Add new libraries.
- Change package versions.
- Change database schema unnecessarily.
- Change API architecture.
- Change global components.
- Change CSS globally.
- Change POS UI.
- Change Sell History.
- Change Credit CRM.
- Change Refill.
- Change inventory logic.
- Change purchase logic.

Only the minimum required code should be changed.

============================================================
16. IF A NEW FILE IS ACTUALLY REQUIRED
============================================================

Do NOT create a new file unless the existing architecture genuinely requires one.

Prefer modifying the existing PDF-generation file.

If a new file is technically necessary:

- Create only the file directly related to POS PDF generation.
- Do not create duplicate functionality.
- Do not create a new PDF system.
- Do not create a new batch service.
- Do not create a new database table.
- Do not create a new UI component.

The agent must explain why the new file was unavoidable.

============================================================
17. DATA FLOW TO PRESERVE
============================================================

The existing flow must remain:

POS Sale
    ↓
Existing Sale Data
    ↓
Existing Bill/PDF Generator
    ↓
Existing PDF

Only extend the item data used by the PDF:

Existing sale item
    +
existing Batch Number
    ↓
Existing PDF

Do not change the overall sale workflow.

============================================================
18. PDF DATA REQUIREMENT
============================================================

For every sold medicine, the PDF item row should have access to:

- Existing Medicine Name
- Existing Batch Number ← ADD THIS
- Existing Quantity
- Existing MRP
- Existing Tax
- Existing Discount behavior
- Existing Total
- Any other fields already present in the current PDF

Do not add Purchase Rate.

Do not add Supplier Cost.

Do not add Distributor Cost.

============================================================
19. CREDIT BILL / CREDIT MESSAGE
============================================================

If the existing Credit Bill/credit-message workflow uses the same POS bill PDF:

The generated PDF should automatically contain the Batch Number.

Do not create a separate credit-PDF implementation.

Do not modify the credit workflow itself.

Do not change how Credit CRM saves data.

Do not change how the message is sent.

The only result should be that the existing PDF attached/generated by that workflow now contains Batch Number.

============================================================
20. REFILL WORKFLOW
============================================================

Do NOT modify the existing Refill workflow.

If a refill bill uses the same existing POS bill PDF generator, the Batch Number should automatically appear because the shared PDF generator has been corrected.

Do not modify:

- Refill detection
- Refill date
- Refill CRM
- Manual refill
- Automatic refill
- Customer matching

unless the repository inspection proves that one of these is directly part of the PDF data source.

============================================================
21. BACKWARD COMPATIBILITY
============================================================

Existing invoices must continue to generate PDFs.

Existing sales must continue to open.

Existing Sell History must continue to work.

Existing Credit CRM must continue to work.

Existing Refill must continue to work.

Existing discount bills must continue to generate correctly.

Existing non-discount bills must continue to generate correctly.

The only visual PDF difference should be the addition of Batch Number.

============================================================
22. VALIDATION
============================================================

Test at least these cases:

TEST 1:
Create a normal POS sale with one medicine.

Expected:
PDF contains the correct Batch Number.

TEST 2:
Create a POS sale with multiple medicines from different batches.

Expected:
Each medicine displays its correct corresponding Batch Number.

TEST 3:
Create a sale with a discount.

Expected:
Existing discount remains exactly as before.
Batch Number is additionally shown.

TEST 4:
Create a sale without discount.

Expected:
Existing discount behavior remains unchanged.
Batch Number is shown.

TEST 5:
Create a sale with tax.

Expected:
Existing tax and total remain unchanged.
Batch Number is shown.

TEST 6:
Open the same sale in Sell History.

Expected:
Sell History behavior/UI is unchanged.

TEST 7:
Generate/send a Credit Bill.

Expected:
The PDF contains Batch Number.
Credit workflow itself remains unchanged.

TEST 8:
Generate a refill-related bill.

Expected:
The same PDF behavior applies automatically if the existing PDF generator is shared.
No refill workflow changes.

TEST 9:
Use an old/legacy invoice where batch data is unavailable.

Expected:
PDF still generates successfully.
No fabricated batch number.

TEST 10:
Verify PDF does NOT contain:

- Purchase Rate
- Cost Price
- Supplier Purchase Price
- Distributor Cost

============================================================
23. BUILD / CODE CHECK
============================================================

After the change:

- Run the project's existing TypeScript/build validation.
- Run relevant lint checks if configured.
- Run relevant tests if available.
- Verify the PDF generation path.
- Verify no unrelated files changed.

If the repository has no relevant automated test for PDF generation, manually validate the generated PDF using representative bills.

============================================================
24. FINAL DIFF CHECK
============================================================

Before completing the task, inspect the final git diff.

The agent must verify:

[ ] Only PDF-related code was changed.
[ ] Any second modified file is directly required to provide existing Batch Number data.
[ ] No unrelated files were modified.
[ ] No frontend UI was changed.
[ ] No new dependency was added.
[ ] No database migration was created unless genuinely required.
[ ] No purchase-rate data was added to the PDF.
[ ] No discount logic was changed.
[ ] No tax logic was changed.
[ ] No total calculation was changed.
[ ] No POS workflow was changed.
[ ] No Sell History workflow was changed.
[ ] No Credit CRM workflow was changed.
[ ] No Refill workflow was changed.
[ ] Existing PDF design remains intact except for Batch Number.
[ ] Every medicine line shows its correct Batch Number when available.

============================================================
25. FINAL IMPLEMENTATION PRINCIPLE
============================================================

This is NOT a new billing feature.

This is NOT a POS redesign.

This is NOT a Sell History change.

This is NOT a Credit CRM change.

This is NOT a Refill change.

This is NOT a purchase-data change.

This is ONLY:

EXISTING POS BILL PDF
        +
EXISTING MEDICINE BATCH NUMBER
        ↓
UPDATED POS BILL PDF

Everything else stays exactly as it currently works.

============================================================
SHORT OLD BEHAVIOR vs NEW BEHAVIOR
============================================================

OLD BEHAVIOR:

POS sale is completed normally.

The existing bill/PDF is generated normally.

Medicine details appear in the PDF.

However:

Batch Number is missing from the PDF.

All other POS, Sell History, Credit CRM, Refill, discount, tax, inventory, and billing behavior remains as currently implemented.

NEW BEHAVIOR:

POS sale is completed exactly the same way.

The existing bill/PDF is generated exactly the same way.

The only change is:

Medicine
    ↓
Existing medicine information
    +
Existing Batch Number
    ↓
PDF

Example:

OLD PDF:

Medicine A | Qty 2 | MRP ₹100 | Tax ₹10 | Total ₹210

NEW PDF:

Medicine A | Batch B12345 | Qty 2 | MRP ₹100 | Tax ₹10 | Total ₹210

Purchase Rate is NOT shown.

No other calculation or workflow changes.

============================================================
FINAL AGENT INSTRUCTION
============================================================

Inspect the repository first.

Locate the actual POS bill PDF generation implementation.

Trace where the existing sold item's Batch Number is already available.

Modify ONLY the smallest number of directly related files required to pass that existing Batch Number into the existing PDF and display it.

Do not create a new architecture.

Do not redesign the UI.

Do not modify unrelated functionality.

Do not modify Purchase Rate/Cost Price behavior.

Do not modify discount, tax, total, POS, Sell History, Credit CRM, or Refill behavior.

After coding, cross-check the final diff against this entire plan and confirm exactly which files were modified and why each modified file was necessary.