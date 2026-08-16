# Legitimate Data Workflow & Mandatory Pre/Post Audit Rule

**MANDATORY FOR EVERY DEVELOPMENT TASK ACROSS THIS CODEBASE.**

## Core Inviolable Contract

1. **Zero Dummy/Fabricated Business Data**: Never use dummy, placeholder, fabricated, synthetic, guessed, or arbitrary business data anywhere in the application. This includes:
   - Batch numbers (e.g. `MANUAL`, `AUTO`, `SPECIAL`, `DEFAULT`, `BATCH123`, `B-GEN`, `B-CATALOG`, `B-IMPORT`, `B-OFFLINE`, `B-REISSUE`, `B-MANUAL`, `B-NEW`)
   - Expiry dates (e.g. `12/28`, `12/30`, `2028-12-31`)
   - Prices / MRP / Cost prices (e.g. `100`, `10`, `mrp * 0.7`)
   - Quantities / Pack sizes (e.g. `quantity = 100`, `packSize = 10`)
   - Medicine records, inventory batches, purchase records, bills, customer/shop details, IDs, or historical transactions.
2. **Never Add Invented Fallbacks**: If required business data is missing, keep it missing and require the user or a legitimate source/workflow to provide it.
3. **No Auto-Created Inventory**: Stock is created ONLY through completed, approved purchase workflows.
4. **Mandatory Pre & Post Task Audit**: For every development task (even seemingly unrelated tasks), perform an audit before and after changes.

## Mandatory Task Audit Summary Template

Every task response must end with an Audit Summary addressing these 8 items:

1. **Existing dummy/fallback logic found:** (List any found or none)
2. **New dummy/fallback logic introduced:** (Must be None)
3. **Missing-data handling:** (How missing fields are surfaced/prompted)
4. **Error/fallback behavior:** (How errors are communicated safely without inserting fake data)
5. **Auto-created records or values:** (Confirm no inventory/business rows auto-generated)
6. **Data source and traceability:** (Trace where business values originate)
7. **Changes made to remove or prevent such logic:** (Modifications made)
8. **Any remaining risk or location that needs review:** (Risks/areas checked)
