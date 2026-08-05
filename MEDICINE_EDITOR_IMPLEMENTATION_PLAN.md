# Medicine Editor — Complete Implementation Plan

**Date:** 2026-08-05
**Status:** PLANNING — DO NOT IMPLEMENT UNTIL USER APPROVES
**Scope:** 26-field medicine editor + H1 compliance + therapeutic search + smart substitutes
**Files Affected:** 24 files across 6 phases

---

## TABLE OF CONTENTS

1. [Issue Statement — Why We Build This](#1-issue-statement)
2. [Current System Analysis](#2-current-system-analysis)
3. [Pipeline Safety Analysis](#3-pipeline-safety-analysis)
4. [Database Migration](#4-database-migration)
5. [Feature Specifications](#5-feature-specifications)
6. [File Change Manifest](#6-file-change-manifest)
7. [Second-Agent Review Checklist](#7-second-agent-review-checklist)
8. [Implementation Order](#8-implementation-order)
9. [Rollback Plan](#9-rollback-plan)
10. [Approval Gates](#10-approval-gates)

---

## 1. ISSUE STATEMENT

### 1.1 What Problem Are We Solving?

The current `UniversalMedicineEditModal` has **12 fields** and a **flat, non-context-aware packing system**. The pharmacy needs a **full medicine editor with 26 fields** plus **regulatory compliance features** for Schedule H1 drugs.

### 1.2 Specific Issues

| # | Issue | Impact |
|---|-------|--------|
| 1 | Modal only has 12 of 26 required fields | Pharmacists can't edit therapeutic class, tax rates, stock levels, substitutes |
| 2 | Backend PUT only saves 12 fields | Even if modal has 26 fields, 14 won't be saved |
| 3 | Packing system is not form-aware | User sees "1 BOTTLE" instead of "BOTTLE OF 100ML" for liquids |
| 4 | No H1 compliance UI | Backend auto-logs H1 sales but no dashboard, no export, no POS warning |
| 5 | No therapeutic search | Can't search "show all NSAIDs" or "show all antibiotics" |
| 6 | Substitute finding ignores therapeutic class | Only matches by composition or item_type, not drug class |
| 7 | Enrichment doesn't populate therapeutic | Reference DB has composition but enrichment doesn't write therapeutic |
| 8 | pgMasterImporter bug | Therapeutic data is stored in schedule_type field (data corruption) |
| 9 | Import paths write incomplete data | Purchases auto-create only writes 7 of 26 fields |
| 10 | Display pages don't show new fields | POS, Sells, CRM show minimal medicine info |

### 1.3 What We Want to Build

| Feature | Description |
|---------|-------------|
| **Full Medicine Editor** | 26 fields organized in 6 sections with form-aware packing |
| **H1 Compliance Dashboard** | New page to view/export Schedule H1 drug sales for government inspection |
| **POS H1 Warning** | Dialog when selling restricted drugs requiring doctor assignment |
| **Therapeutic Search** | Search by drug class (e.g. "NSAID", "Antibiotic") in POS |
| **Smart Substitutes** | Find alternatives by therapeutic class, not just composition |
| **Enrichment Enhancement** | Auto-populate therapeutic and schedule_type from reference data |

---

## 2. CURRENT SYSTEM ANALYSIS

### 2.1 Medicine Data Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    MEDICINE DATA LIFECYCLE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  IMPORT                    STORAGE                 DISPLAY       │
│  ──────                    ───────                 ───────       │
│  • PG Master Import        • medicines (30 cols)   • POS         │
│  • CSV Catalog Import      • inventory_master      • Purchases   │
│  • Purchases Auto-Create   • medicine_reference    • Database    │
│  • Inventory Create        • medicine_aliases      • Inventory   │
│  • Medicines Route         • distributor_catalog   • Sells       │
│  • MedicineService         • stock_config          • CRM         │
│  • Master Seed             • substitutes           • PDF Invoice │
│  • Migration CSV           • compliance_logs       • WhatsApp    │
│                            • purchase_items        • Mobile App  │
│                            • sale_items            • Pharmarack  │
│                                                                  │
│  EDIT                                                              │
│  ────                                                              │
│  • UniversalMedicineEditModal (12 fields)                        │
│  • Backend PUT /quick-edit (12 fields)                           │
│  • MedicineService.updateMedicine (14 fields)                    │
│  • Purchases Route (price-only)                                  │
│  • Catalog Worker (import-only)                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Current Modal Fields (12)

| # | Field | DB Column | Section |
|---|-------|-----------|---------|
| 1 | Name | `medicines.name` | Medicine Profile |
| 2 | Generic Name | `medicines.generic_name` | Medicine Profile |
| 3 | Manufacturer | `medicines.manufacturer` | Medicine Profile |
| 4 | Marketed By | `medicines.marketed_by` | Medicine Profile |
| 5 | Packaging | `medicines.packaging` | Medicine Profile |
| 6 | Pack Unit | `medicines.pack_unit` | Medicine Profile |
| 7 | Item Code | `medicines.item_code` | Medicine Profile |
| 8 | Category | `medicines.category` | Medicine Profile |
| 9 | Notes | `medicines.api_reference` | Medicine Profile |
| 10 | HSN Code | `medicines.hsn_code` | Medicine Profile |
| 11 | Quantity | `inventory_master.quantity` | Inventory |
| 12 | Rack Location | `inventory_master.rack_location` | Inventory |

### 2.3 Missing Fields (14)

| # | Field | DB Column | Why Missing |
|---|-------|-----------|-------------|
| 13 | Item Type | `medicines.item_type` | Not in modal |
| 14 | Therapeutic | `medicines.therapeutic` | Column doesn't exist |
| 15 | Sub Therapeutic | `medicines.sub_therapeutic` | Column doesn't exist |
| 16 | Schedule Type | `medicines.schedule_type` | Not in modal |
| 17 | Short Code | `medicines.short_code` | Column doesn't exist |
| 18 | UCode | `medicines.ucode` | Column doesn't exist |
| 19 | CGST % | `medicines.cgst_per` | Not in modal |
| 20 | SGST % | `medicines.sgst_per` | Not in modal |
| 21 | IGST % | `medicines.igst_per` | Not in modal |
| 22 | Min Stock | `inventory_master.reorder_level` | Not in modal |
| 23 | Max Stock | `medicines.max_stock_level` | Not in modal |
| 24 | Rack | `medicines.rack` | Not in modal |
| 25 | Is Loose | `medicines.metadata.is_loose` | JSON field |
| 26 | Disable Auto Barcode | `medicines.disable_auto_barcode` | Column doesn't exist |
| 27 | TB Medicine | `medicines.tb_medicine` | Column doesn't exist |

---

## 3. PIPELINE SAFETY ANALYSIS

### 3.1 What Connects to What

```
┌─────────────────────────────────────────────────────────────────┐
│                    PIPELINE CONNECTION MAP                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SAFE CONNECTIONS (No Changes Needed):                           │
│  ─────────────────────────────────────                           │
│  • stockRebuild.ts ── reads pack_size column ── SAFE            │
│  • sales.ts ── reads pack_size column ── SAFE                   │
│  • pdfInvoiceService.ts ── reads pack_size column ── SAFE       │
│  • invoiceService.ts ── reads pack_size column ── SAFE          │
│  • Pharmarack ── sends packaging as-is ── SAFE                  │
│  • CRM ── groups by name (format-agnostic) ── SAFE              │
│  • All LIKE search queries ── substring match ── SAFE           │
│  • Mobile app ── reads pack_size from API ── SAFE               │
│  • All 48 name-reading locations ── display only ── SAFE        │
│  • All 30 pack_size-reading locations ── DB column ── SAFE      │
│                                                                  │
│  CHANGED CONNECTIONS (Need Updates):                             │
│  ──────────────────────────────────                              │
│  • UniversalMedicineEditModal.tsx ── FULL REWRITE               │
│  • packaging.ts ── add STRIP OF / BOTTLE OF patterns            │
│  • POS/index.tsx ── update local parser + H1 warning            │
│  • packagingMatcher.ts ── update normalization                   │
│  • build-medicine-dict.ts ── update token extraction            │
│  • packaging.test.ts ── add new test cases                      │
│  • database.ts ── add 6 new columns                             │
│  • inventory.ts ── expand PUT endpoint                          │
│  • purchases.ts ── write more fields on auto-create             │
│  • medicineService.ts ── include new fields                     │
│  • invoiceService.ts ── add H1 warning check                    │
│  • medicineAvailabilityEngine.ts ── add therapeutic matching   │
│  • compositionEnricher.ts ── populate therapeutic               │
│  • googleSearchService.ts ── expand therapeutic classes         │
│  • pgMasterImporter.ts ── map new fields + fix bug              │
│  • catalogWorker.ts ── map new fields                           │
│  • Compliance/index.tsx ── NEW PAGE                             │
│  • compliance.ts ── enhance endpoints                           │
│  • Database/index.tsx ── show new fields                        │
│  • Inventory/index.tsx ── show new fields                       │
│  • Purchases/index.tsx ── show new fields                       │
│  • Sells/index.tsx ── show schedule_type                        │
│  • CRM/index.tsx ── show therapeutic                            │
│  • api.ts ── update TypeScript types                            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Files That READ `medicines.name` (48 locations)

| File | Usage | Breaks on Rename? |
|------|-------|-------------------|
| `src/routes/medicines.ts` | Search `LIKE`, display | NO — substring match |
| `src/routes/inventory.ts` | Search `LIKE`, display | NO |
| `src/routes/sales.ts` | Stock verify, OCR correct | NO — uses pack_size column |
| `src/routes/investigation.ts` | Reports, filtering | NO — `LIKE` queries |
| `src/routes/crm.ts` | Frequency analysis | NO — groups by name |
| `src/routes/purchases.ts` | Alias resolution | LOW — exact match for dedup |
| `src/routes/expiry.ts` | Display only | NO |
| `src/routes/customerReturns.ts` | Search | NO |
| `src/routes/pharmarack.ts` | Product matching | NO — reads as-is |
| `src/routes/migration.ts` | Duplicate detection | LOW — name comparison |
| `src/routes/orders.ts` | Display | NO |
| `src/routes/whatsappQueue.ts` | Message matching | NO |
| `src/services/pdfInvoiceService.ts` | PDF line items | NO — display only |
| `src/services/invoiceService.ts` | Exact name lookup | LOW — `WHERE name = ?` |
| `src/services/medicineService.ts` | CRUD | NO |
| `src/services/inventoryCache.ts` | Cache | NO |
| `src/worker/catalogWorker.ts` | Import | NO — writes new names |
| `src/worker/importers/pgMasterImporter.ts` | Migration | NO — writes new names |
| `src/worker/migrationWorker.ts` | Migration | NO — writes new names |
| `productResolver.ts` | Fuzzy match | NO — `LIKE` queries |

**VERDICT: 0 files break. Name is display-only across the entire codebase.**

### 3.3 Files That READ/WRITE `medicines.packaging` (35 locations)

| File | Usage | Breaks on Format Change? |
|------|-------|--------------------------|
| `src/utils/packaging.ts` | **CRITICAL** — parses pack_size | YES — must update parser |
| `src/routes/inventory.ts` | **CRITICAL** — quick-edit writes packaging | YES — calls parser |
| `src/routes/medicines.ts` | Create medicine | YES — calls parser |
| `src/routes/sales.ts` | Reorder suggestions | NO — display only |
| `src/routes/purchases.ts` | Display | NO |
| `src/routes/pharmarack.ts` | Sends to Pharmarack | NO — sends as-is |
| `src/routes/catalog.ts` | Import writes | YES — writes new format |
| `src/services/medicineService.ts` | CRUD | NO |
| `src/services/inventoryCache.ts` | Cache | NO |
| `src/services/pharmarackCatalogCache.ts` | Catalog cache | NO |
| `src/services/aiCameraService.ts` | OCR extraction | LOW — regex match |
| `src/worker/catalogWorker.ts` | Import | YES — writes new format |
| `src/worker/importers/pgMasterImporter.ts` | Migration | YES — calls parser |
| `frontend/src/components/UniversalMedicineEditModal.tsx` | **CRITICAL** — edit modal | YES — compiles new format |
| `frontend/src/pages/Database/index.tsx` | **CRITICAL** — calls edit functions | YES — calls name compiler |
| `frontend/src/pages/POS/index.tsx` | **CRITICAL** — own parser copy | YES — dual implementation |
| `frontend/src/utils/packagingMatcher.ts` | Match comparison | LOW — normalizes |

**VERDICT: 5 files need updates, 3 are critical.**

### 3.4 Files That READ/WRITE `medicines.pack_size` (30 locations)

| File | Usage | Breaks? |
|------|-------|---------|
| `src/utils/stockRebuild.ts` | **CRITICAL** — stock math | NO — reads DB column |
| `src/routes/sales.ts` | **CRITICAL** — pricing divisor | NO — reads DB column |
| `src/routes/inventory.ts` | **CRITICAL** — writes pack_size | NO — derives from packaging |
| `src/routes/medicines.ts` | Create medicine | NO — derives from packaging |
| `src/services/pdfInvoiceService.ts` | Invoice pricing | NO — reads DB column |
| `src/services/invoiceService.ts` | Invoice totals | NO — reads DB column |
| `frontend/src/pages/POS/index.tsx` | Cart math | NO — reads from cache |

**VERDICT: 0 files break. pack_size is always read from DB column, never parsed from name.**

### 3.5 Dual Implementation Risk — POS Parser

**Current State:**

POS has its OWN copy of `parsePackSizeFromPackaging` at `frontend/src/pages/POS/index.tsx` line 26:

```typescript
// FRONTEND COPY (POS):
const match = packaging.match(/^(\d+)/);
// "10 TAB" → "10" ✅
// "200 ML" → "200" ❌ (WRONG — treats ml as count!)
// "STRIP OF 10 TAB" → null ❌ (doesn't start with number)

// BACKEND COPY (src/utils/packaging.ts):
const match = packaging.match(/^\s*(\d+)\s*(NO'?S|TAB|TABS|CAP|CAPS|PAD|PADS)\b/i);
// "10 TAB" → "10" ✅
// "200 ML" → null ✅ (correctly rejects)
// "STRIP OF 10 TAB" → null ❌ (doesn't match)
```

**The Danger:**

If a bottle medicine has `packaging = "100 ML"`:
- **Frontend POS** parses it as `packSize = 100` → WRONG (ml ≠ count)
- **Backend** parses it as `packSize = null` → defaults to `10` → also WRONG
- **Result**: Loose unit pricing is wrong

**The Fix:**

Update BOTH parsers to handle `"STRIP OF"` and `"BOTTLE OF"` formats.

---

## 4. DATABASE MIGRATION

### 4.1 New Columns

```sql
-- Add 6 new columns to medicines table
ALTER TABLE medicines ADD COLUMN therapeutic TEXT DEFAULT NULL;
ALTER TABLE medicines ADD COLUMN sub_therapeutic TEXT DEFAULT NULL;
ALTER TABLE medicines ADD COLUMN short_code TEXT DEFAULT NULL;
ALTER TABLE medicines ADD COLUMN ucode TEXT DEFAULT NULL;
ALTER TABLE medicines ADD COLUMN disable_auto_barcode INTEGER DEFAULT 0;
ALTER TABLE medicines ADD COLUMN tb_medicine INTEGER DEFAULT 0;
```

### 4.2 Why These Columns

| Column | Purpose | Example Values |
|--------|---------|----------------|
| `therapeutic` | Broad drug class for search/substitutes | "Analgesic", "Antibiotic", "Antihypertensive" |
| `sub_therapeutic` | Sub-class for precise matching | "NSAIDs", "Fluoroquinolones", "ACE Inhibitors" |
| `short_code` | Quick lookup code | "PAN40", "AZ500" |
| `ucode` | Unique integration code | "UC-001", "UC-002" |
| `disable_auto_barcode` | Toggle barcode printing | 0 (enabled), 1 (disabled) |
| `tb_medicine` | Tuberculosis drug flag | 0 (no), 1 (yes) |

### 4.3 Safety

- All columns are **nullable with defaults**
- No existing data is affected
- No data migration needed
- Old code ignores these columns (they're just NULL)

---

## 5. FEATURE SPECIFICATIONS

### 5.1 Full Medicine Editor Modal (26 Fields)

**6 Sections:**

| Section | Fields | Count |
|---------|--------|-------|
| Basic Information | Name, Item Type, Category, Form, Packaging, Qty Per Unit | 6 |
| Classification | Therapeutic, Sub Therapeutic, Schedule Type, Salts | 4 |
| Manufacturer & Codes | Manufacturer, Marketed By, Barcode, Short Code, UCode, HSN | 6 |
| Tax & Pricing | CGST, SGST, IGST, HSN Lookup Button | 4 |
| Stock & Location | Min Stock, Max Stock, Rack, Is Loose | 4 |
| Substitutes & Options | Substitute, Substitute Type, Disable Barcode, TB Medicine | 4 |

**Form-Aware Packing:**

| Form | Packing Options |
|------|----------------|
| TAB/CAP | STRIP OF 4 TAB, STRIP OF 10 TAB, STRIP OF 15 TAB, 1 TAB, 10 TAB, 30 TAB, Custom |
| SUSPENSION/BOTTLE/SYP | BOTTLE OF 30ML, 50ML, 60ML, 100ML, 120ML, 180ML, Custom |
| AMP/VIAL | 1 AMP, 1 VIAL, Custom |
| GEL/CREAM/OINT | 1 TUBE, Custom |

**Name Format:**

| Form | Pack Type | Example |
|------|-----------|---------|
| TAB/CAP | Strip | PAN 40MG STRIP OF 10 TAB |
| TAB/CAP | Direct | PAN 40MG 10 TAB |
| SUSPENSION/BOTTLE | Bottle | PAN 40MG BOTTLE OF 100ML |
| AMP/VIAL | Ampoule | PAN 40MG 1 AMP |

### 5.2 H1 Compliance Dashboard

**New Page: `/compliance`**

**Features:**
- Today's H1 sales count
- Monthly H1 sales count
- Pending doctor assignments
- Filterable register table
- Export to CSV
- Print H1 register
- Assign doctor to pending entries

**Enhanced Endpoints:**
- `GET /api/compliance/dashboard` — aggregated stats
- `GET /api/compliance/h1-register?date=&drug=` — filtered register
- `PUT /api/compliance/:id/doctor` — assign doctor
- `GET /api/compliance/export?format=csv` — export

### 5.3 POS H1 Warning Dialog

**Trigger:** When user adds Schedule H/H1/X drug to cart

**Dialog Shows:**
- Drug name and schedule type
- Warning message about prescription requirement
- Doctor name input (required)
- Prescription number input (optional)
- Cancel / Add to Cart buttons

**Implementation:**
- Check `schedule_type` at cart-add time
- Store doctor name in sale_items for compliance
- Auto-log to compliance_logs on sale completion

### 5.4 Therapeutic Search

**POS Search Enhancement:**

When user types a therapeutic class name:
- Search `medicines.therapeutic` column (LIKE match)
- Show results with therapeutic class badge
- Allow filtering by therapeutic class

**Example:**
- User types "NSAID"
- Shows: Ibuprofen, Diclofenac, Naproxen, Aceclofenac
- Each shows "NSAID" badge

### 5.5 Smart Substitutes

**Current:** Composition OR item_type only
**New:** Composition → Therapeutic → Sub Therapeutic → Item Type

**Scoring:**
- Same composition: 0.95
- Same therapeutic class: 0.85
- Same sub-therapeutic: 0.75
- Same item_type: 0.70

### 5.6 Enrichment Enhancement

**Current:** Enriches composition only
**New:** Also populates therapeutic and schedule_type

**Enhancement:**
- When enriching composition, also look up therapeutic class
- Write `therapeutic` and `sub_therapeutic` to medicines table
- Expand Google Search therapeutic class list from 8 to 50+ classes

---

## 6. FILE CHANGE MANIFEST

### 6.1 Category A: Database & Backend (6 files)

| # | File | Change | Lines |
|---|------|--------|-------|
| 1 | `src/database.ts` | Add 6 new columns via ALTER TABLE | +12 |
| 2 | `src/routes/inventory.ts` | Expand PUT /quick-edit to handle ALL 26 fields | +40 |
| 3 | `src/utils/packaging.ts` | Add STRIP OF / BOTTLE OF parsing patterns | +15 |
| 4 | `src/routes/purchases.ts` | Write more fields on auto-create | +20 |
| 5 | `src/services/medicineService.ts` | Include new fields in create/update | +10 |
| 6 | `src/services/invoiceService.ts` | Add POS H1 warning check | +15 |

### 6.2 Category B: Frontend — Modal & Pages (8 files)

| # | File | Change | Lines |
|---|------|--------|-------|
| 7 | `UniversalMedicineEditModal.tsx` | Full rewrite with 26 fields | ~900 |
| 8 | `POS/index.tsx` | Update parser + add H1 warning dialog | +50 |
| 9 | `packagingMatcher.ts` | Update normalization for new format | +5 |
| 10 | `Database/index.tsx` | Show new fields in table | +30 |
| 11 | `Inventory/index.tsx` | Show new fields in table | +15 |
| 12 | `Purchases/index.tsx` | Show new fields in table | +15 |
| 13 | `Sells/index.tsx` | Show schedule_type column | +10 |
| 14 | `CRM/index.tsx` | Show therapeutic column | +10 |

### 6.3 Category C: New Pages (2 files)

| # | File | Change | Lines |
|---|------|--------|-------|
| 15 | `Compliance/index.tsx` | NEW: H1 compliance dashboard page | ~400 |
| 16 | `src/routes/compliance.ts` | Enhance endpoints for dashboard | +50 |

### 6.4 Category D: Services & Engine (3 files)

| # | File | Change | Lines |
|---|------|--------|-------|
| 17 | `src/services/medicineAvailabilityEngine.ts` | Add therapeutic matching to substitutes | +30 |
| 18 | `src/worker/compositionEnricher.ts` | Populate therapeutic from reference | +20 |
| 19 | `src/services/googleSearchService.ts` | Expand therapeutic class list from 8 to 50+ | +50 |

### 6.5 Category E: Import Paths (3 files)

| # | File | Change | Lines |
|---|------|--------|-------|
| 20 | `src/worker/importers/pgMasterImporter.ts` | Map therapeutic, sub_therapeutic, fix bug | +10 |
| 21 | `src/worker/catalogWorker.ts` | Map new fields from CSV | +10 |
| 22 | `src/services/medicineService.ts` | Include new fields (already counted) | — |

### 6.6 Category F: Scripts & Tests (2 files)

| # | File | Change | Lines |
|---|------|--------|-------|
| 23 | `scripts/build-medicine-dict.ts` | Update token extraction for new name format | +5 |
| 24 | `tests/packaging.test.ts` | Add tests for new format parsing | +30 |

### 6.7 Total

| Category | Files | Estimated Lines Changed |
|----------|-------|------------------------|
| Database & Backend | 6 | ~112 |
| Frontend Modal & Pages | 8 | ~1,035 |
| New Pages | 2 | ~450 |
| Services & Engine | 3 | ~100 |
| Import Paths | 2 | ~20 |
| Scripts & Tests | 2 | ~35 |
| **Total** | **24** | **~1,752** |

---

## 7. SECOND-AGENT REVIEW CHECKLIST

Before implementation, a second agent must verify:

### 7.1 Parser Safety
- [ ] `parsePackSizeFromPackaging()` handles ALL old formats (10 TAB, 15 NO'S, 10x10, 200 ML)
- [ ] `parsePackSizeFromPackaging()` handles ALL new formats (STRIP OF 10 TAB, BOTTLE OF 100ML)
- [ ] POS local parser matches backend parser behavior
- [ ] `packagingMatcher.ts` normalizes both formats
- [ ] `build-medicine-dict.ts` doesn't choke on "STRIP" / "BOTTLE" tokens

### 7.2 Name Parsing
- [ ] `splitMedicineName()` handles old format names
- [ ] `splitMedicineName()` handles new format names
- [ ] `updateMedicineNameWithPackSize()` compiles both formats

### 7.3 Stock Math Safety
- [ ] Stock math (`stockRebuild.ts`) is NOT modified
- [ ] Sales pricing (`sales.ts`) is NOT modified
- [ ] PDF generation (`pdfInvoiceService.ts`) is NOT modified
- [ ] All 30 pack_size-reading locations use DB column (no name parsing)

### 7.4 Integration Safety
- [ ] Pharmarack integration (`pharmarack.ts`) is NOT modified
- [ ] CRM analytics (`crm.ts`) only adds display column
- [ ] Mobile app reads pack_size from API (no changes needed)
- [ ] All 48 name-reading locations are display-only (no parsing)

### 7.5 Database Safety
- [ ] New columns are nullable with defaults
- [ ] No existing data is affected
- [ ] No data migration needed
- [ ] Old code ignores new columns

### 7.6 New Feature Safety
- [ ] Compliance dashboard is a NEW page (no existing page modified)
- [ ] POS H1 warning only adds dialog (doesn't change cart logic)
- [ ] Therapeutic search only adds LIKE query (doesn't change existing search)
- [ ] Smart substitutes only adds scoring (doesn't change existing matching)

### 7.7 Testing
- [ ] Tests pass: `npm test`
- [ ] Lint passes: `npm run lint`
- [ ] TypeCheck passes: `npm run typecheck`
- [ ] Knowledge graph updated: `node scripts/quick-update.mjs`

---

## 8. IMPLEMENTATION ORDER

### Phase 1: Foundation (Database + Backend)
1. Database migration (add 6 new columns)
2. Backend PUT endpoint expansion
3. Packaging parser update
4. Purchases route update
5. MedicineService update

### Phase 2: Import Paths
6. pgMasterImporter update (fix therapeutic bug)
7. catalogWorker update

### Phase 3: Modal Rewrite
8. UniversalMedicineEditModal full rewrite
9. POS parser update
10. PackagingMatcher update

### Phase 4: Display Pages
11. Database page update
12. Inventory page update
13. Purchases page update
14. Sells page update
15. CRM page update

### Phase 5: New Features
16. Compliance dashboard page (NEW)
17. Compliance route enhancement
18. POS H1 warning dialog
19. POS therapeutic search
20. Substitute engine enhancement
21. Enrichment therapeutic population
22. Google Search therapeutic expansion

### Phase 6: Scripts & Tests
23. Build-medicine-dict update
24. Packaging tests
25. Lint + typecheck
26. Knowledge graph update

---

## 9. ROLLBACK PLAN

If anything breaks after deployment:

1. **Revert `UniversalMedicineEditModal.tsx`** to previous version
2. **Revert `packaging.ts`** to previous version
3. **Revert `POS/index.tsx`** local parser to previous version
4. **Revert `inventory.ts`** PUT endpoint to previous version
5. **Database is SAFE** — new columns are nullable with defaults
6. **No data migration needed** — old names still work
7. **Compliance page is NEW** — can be removed without affecting existing features
8. **POS H1 warning is ADDITIVE** — can be removed without affecting cart logic

The `pack_size` column in the database is the safety net. Even if the name format breaks, all math continues to work because it reads from the column, not the name.

---

## 10. APPROVAL GATES

- [ ] User approves this plan
- [ ] Second agent reviews and signs off
- [ ] All tests pass before implementation starts
- [ ] Implementation completed
- [ ] All tests pass after implementation
- [ ] Knowledge graph updated

---

## APPENDIX A: Complete Field Reference

| # | Field | DB Column | Type | Default | New? |
|---|-------|-----------|------|---------|------|
| 1 | Name | `medicines.name` | TEXT NOT NULL | — | NO |
| 2 | Item Type | `medicines.item_type` | TEXT | NULL | NO |
| 3 | Category | `medicines.category` | TEXT | NULL | NO |
| 4 | Form / Suffix Type | `medicines.pack_unit` | TEXT | NULL | NO |
| 5 | Packaging | `medicines.packaging` | TEXT | NULL | NO |
| 6 | Qty Per Unit | `medicines.pack_size` | INTEGER | NULL | NO |
| 7 | Therapeutic | `medicines.therapeutic` | TEXT | NULL | YES |
| 8 | Sub Therapeutic | `medicines.sub_therapeutic` | TEXT | NULL | YES |
| 9 | Schedule Type | `medicines.schedule_type` | TEXT | 'None' | NO |
| 10 | Salts (Compounds) | `medicines.generic_name` | TEXT | NULL | NO |
| 11 | Manufacturer | `medicines.manufacturer` | TEXT | NULL | NO |
| 12 | Marketed By | `medicines.marketed_by` | TEXT | NULL | NO |
| 13 | Medicine Barcode | `medicines.item_code` | TEXT | NULL | NO |
| 14 | Short Code | `medicines.short_code` | TEXT | NULL | YES |
| 15 | UCode | `medicines.ucode` | TEXT | NULL | YES |
| 16 | HSN Code | `medicines.hsn_code` | TEXT | NULL | NO |
| 17 | CGST % | `medicines.cgst_per` | REAL | 0 | NO |
| 18 | SGST % | `medicines.sgst_per` | REAL | 0 | NO |
| 19 | IGST % | `medicines.igst_per` | REAL | 0 | NO |
| 20 | Min Stock | `inventory_master.reorder_level` | INTEGER | 10 | NO |
| 21 | Max Stock | `medicines.max_stock_level` | INTEGER | NULL | NO |
| 22 | Rack | `inventory_master.rack_location` | TEXT | NULL | NO |
| 23 | Is Loose | `medicines.metadata.is_loose` | JSON | false | NO |
| 24 | Substitute | `substitutes` table | — | — | NO |
| 25 | Substitute Type | `substitutes.match_type` | TEXT | — | NO |
| 26 | Disable Auto Barcode | `medicines.disable_auto_barcode` | INTEGER | 0 | YES |
| 27 | TB Medicine | `medicines.tb_medicine` | INTEGER | 0 | YES |

---

## APPENDIX B: Backward Compatibility Matrix

| Scenario | Old Data | New Data | Safe? |
|----------|----------|----------|-------|
| Open old medicine in modal | "PAN 40MG TAB 10 TAB" | — | ✅ Parser handles both formats |
| Edit old medicine, save | Old format → new format | "PAN 40MG STRIP OF 10 TAB" | ✅ Name updates on next save |
| POS adds old medicine to cart | pack_size=10 from DB | — | ✅ Uses DB column |
| POS adds new medicine to cart | — | pack_size=10 from DB | ✅ Uses DB column |
| Pharmarack receives old format | "10 TAB" sent as-is | — | ✅ No parsing |
| Pharmarack receives new format | — | "STRIP OF 10 TAB" sent as-is | ✅ No parsing |
| Import old format from CSV | "10 TAB" → pack_size=10 | — | ✅ Old parser still works |
| Import new format from CSV | — | "STRIP OF 10 TAB" → pack_size=10 | ✅ New parser handles it |
| Search for old medicine | LIKE '%PAN 40MG%' | — | ✅ Substring match |
| Search for new medicine | — | LIKE '%PAN 40MG%' | ✅ Substring match |
| PDF invoice for old medicine | pack_size=10 from SQL | — | ✅ Uses DB column |
| PDF invoice for new medicine | — | pack_size=10 from SQL | ✅ Uses DB column |
| H1 compliance (new feature) | — | New page, no existing code | ✅ Additive only |
| POS H1 warning (new feature) | — | New dialog, no cart change | ✅ Additive only |
| Therapeutic search (new feature) | — | New LIKE query | ✅ Additive only |

---

**END OF IMPLEMENTATION PLAN**
