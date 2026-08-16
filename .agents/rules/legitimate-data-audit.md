# Legitimate Data Workflow & Mandatory Pre/Post Audit Rule

**MANDATORY PROJECT-WIDE RULE FOR EVERY DEVELOPMENT TASK ACROSS THIS CODEBASE.**

## Core Engineering Principle

> **Real data → process it.**  
> **Missing data → request/validate it.**  
> **Invalid data → reject it.**  
> **Never → invent it.**  

---

## 1. Zero Fabricated Business Data & Fallback Elimination

**NEVER introduce, retain, or silently use fabricated, dummy, placeholder, guessed, synthetic, or arbitrary business data or fallback logic.**

This applies strictly to:
- **Batch numbers** (e.g. `MANUAL`, `AUTO`, `SPECIAL`, `DEFAULT`, `BATCH123`, `B-GEN`, `B-CATALOG`, `B-IMPORT`, `B-OFFLINE`, `B-REISSUE`, `B-MANUAL`, `B-NEW`, generated UUIDs/timestamps used as batches)
- **Expiry dates** (e.g. `12/28`, `12/30`, `2028-12-31`, estimated future years)
- **MRP, Prices & Cost Prices** (e.g. `100`, `10`, `mrp * 0.7`, `8`, `15`)
- **Quantities & Pack Sizes** (e.g. `quantity = 100`, `packSize = 10`)
- **Medicines & Inventory** (registering medicine master, OCR extraction, email import, or catalog sync must NEVER auto-create inventory stock)
- **Purchases, Sales & Bills** (no fake sales, fake bills, fake transactions, or fake historical values)
- **Customers, Suppliers & Shop Details** (no fictional addresses like `123 Health Ave` or fake phones like `+91 99999 99999`)

**Missing data must remain missing.** The legitimate workflow or user must provide it. Never invent a value just to prevent an error, hide missing data, or make the UI work.

---

## 2. Mandatory Pre & Post Audit on Every Task

This audit is **mandatory for every task, feature, bug fix, refactor, and integration**, even when seemingly unrelated.

### Pre-Implementation Audit
Before modifying code:
1. Audit the affected workflow and existing implementation across the repository.
2. Check how the feature currently works and where its data originates.
3. Check how missing data is handled, every fallback/default, automatic record creation, error recovery, OCR/import behavior, background jobs, and database writes.
4. Verify whether the planned task could introduce any fallback, guess, or synthetic data.

### Post-Implementation Audit & Required 8-Point Report
After implementation, audit the codebase again and conclude the task response with the following 8-point report:

1. **Existing dummy/fallback logic found:** (List any found or none)
2. **What was removed or changed:** (Exact removals/fixes made)
3. **New dummy/fallback logic introduced:** (Must be None)
4. **Missing-data handling:** (How missing fields are surfaced/prompted)
5. **Error/fallback behavior:** (How errors or incomplete inputs are handled without inventing data)
6. **Auto-created records or values:** (Confirm no inventory/business rows auto-generated)
7. **Data source and traceability:** (Trace where business values originate)
8. **Any remaining risk or location that needs review:** (Risks/areas checked across repository)
