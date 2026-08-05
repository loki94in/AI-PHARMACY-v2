# MEDICINE EDITOR — AGENT IMPLEMENTATION GUIDE

**Generated:** 2026-08-05
**Purpose:** Complete step-by-step guide for any AI agent to implement the Medicine Editor redesign
**Rule:** Agent MUST complete ALL steps, reverify each step, and confirm completion before moving to next

---

## TABLE OF CONTENTS

1. [Pre-Implementation Checklist](#pre-implementation-checklist)
2. [Phase 1: Database Migration](#phase-1-database-migration)
3. [Phase 2: Backend Updates](#phase-2-backend-updates)
4. [Phase 3: Parser Updates](#phase-3-parser-updates)
5. [Phase 4: Modal Rewrite](#phase-4-modal-rewrite)
6. [Phase 5: Display Pages](#phase-5-display-pages)
7. [Phase 6: New Features](#phase-6-new-features)
8. [Phase 7: OCR Integration](#phase-7-ocr-integration)
9. [Phase 8: Scripts & Tests](#phase-8-scripts--tests)
10. [Final Verification](#final-verification)

---

## PRE-IMPLEMENTATION CHECKLIST

Agent MUST verify these items BEFORE starting implementation:

- [ ] Read this entire document completely
- [ ] Read `AGENTS.md` in root folder
- [ ] Read `frontend/AGENTS.md`
- [ ] Run `node scripts/quick-update.mjs` to update knowledge graph
- [ ] Verify current git status: `git status`
- [ ] Create a new branch: `git checkout -b feature/medicine-editor-redesign`
- [ ] Read `src/database.ts` to understand current schema
- [ ] Read `src/routes/inventory.ts` lines 760-830 to understand current PUT endpoint
- [ ] Read `frontend/src/components/UniversalMedicineEditModal.tsx` to understand current modal
- [ ] Read `src/utils/packaging.ts` to understand current parser
- [ ] Read `frontend/src/pages/POS/index.tsx` lines 26-40 to understand POS parser copy

**If ANY of these reads fail, STOP and report the error. Do NOT proceed.**

---

## PHASE 1: DATABASE MIGRATION

### Step 1.1: Add 6 New Columns

**File:** `src/database.ts`

**Action:** Find the last `ALTER TABLE medicines ADD COLUMN` statement (around line 788) and ADD these 6 lines AFTER it:

```typescript
// Medicine editor expansion fields
['medicines', 'therapeutic', 'ALTER TABLE medicines ADD COLUMN therapeutic TEXT DEFAULT NULL'],
['medicines', 'sub_therapeutic', 'ALTER TABLE medicines ADD COLUMN sub_therapeutic TEXT DEFAULT NULL'],
['medicines', 'short_code', 'ALTER TABLE medicines ADD COLUMN short_code TEXT DEFAULT NULL'],
['medicines', 'ucode', 'ALTER TABLE medicines ADD COLUMN ucode TEXT DEFAULT NULL'],
['medicines', 'disable_auto_barcode', 'ALTER TABLE medicines ADD COLUMN disable_auto_barcode INTEGER DEFAULT 0'],
['medicines', 'tb_medicine', 'ALTER TABLE medicines ADD COLUMN tb_medicine INTEGER DEFAULT 0'],
```

**Verification:**
- [ ] Read the file again to confirm 6 new lines are added
- [ ] Verify the lines are AFTER the existing ALTER TABLE statements
- [ ] Verify the syntax is correct (matching existing pattern)

### Step 1.2: Add Index for Therapeutic Search

**File:** `src/database.ts`

**Action:** Find the last `CREATE INDEX IF NOT EXISTS` statement for medicines and ADD:

```typescript
['CREATE INDEX IF NOT EXISTS idx_medicines_therapeutic ON medicines(therapeutic)'],
```

**Verification:**
- [ ] Read the file again to confirm index is added
- [ ] Verify the syntax matches existing index creation pattern

---

## PHASE 2: BACKEND UPDATES

### Step 2.1: Expand PUT /quick-edit Endpoint

**File:** `src/routes/inventory.ts`

**Action 1:** Find the SELECT query in the GET endpoint (around line 722) and ADD these fields:

```sql
therapeutic, sub_therapeutic, short_code, ucode,
disable_auto_barcode, tb_medicine,
item_type, schedule_type,
cgst_per, sgst_per, igst_per,
max_stock_level, rack
```

**Action 2:** Find the UPDATE query in the PUT endpoint (around line 761) and ADD these fields:

```sql
therapeutic = ?,
sub_therapeutic = ?,
short_code = ?,
ucode = ?,
disable_auto_barcode = ?,
tb_medicine = ?,
item_type = ?,
schedule_type = ?,
cgst_per = ?,
sgst_per = ?,
igst_per = ?,
max_stock_level = ?,
rack = ?
```

**Action 3:** Add the corresponding values to the query parameters array.

**Verification:**
- [ ] Read the GET endpoint to confirm new fields are in SELECT
- [ ] Read the PUT endpoint to confirm new fields are in UPDATE
- [ ] Count the fields: should be 26+ fields total
- [ ] Verify all new fields have corresponding `?` placeholders
- [ ] Verify all new fields have corresponding values in the params array

### Step 2.2: Update Purchases Auto-Create

**File:** `src/routes/purchases.ts`

**Action:** Find the medicine auto-create INSERT (around line 913) and ADD these fields:

```sql
generic_name, packaging, category, marketed_by,
schedule_type, pack_unit, pack_size, item_type
```

**Verification:**
- [ ] Read the INSERT statement to confirm new fields are added
- [ ] Verify corresponding values are provided (may need to add null/defaults)

### Step 2.3: Update MedicineService

**File:** `src/services/medicineService.ts`

**Action:** Find `createMedicine` and `addOrUpdateMedicine` functions and ADD these fields to the INSERT/UPDATE:

```sql
therapeutic, sub_therapeutic, short_code, ucode,
disable_auto_barcode, tb_medicine
```

**Verification:**
- [ ] Read the functions to confirm new fields are added
- [ ] Verify the fields are in both INSERT and UPDATE statements

---

## PHASE 3: PARSER UPDATES

### Step 3.1: Update Backend Parser

**File:** `src/utils/packaging.ts`

**Action:** Add these patterns BEFORE the existing `COUNTABLE_UNIT_PATTERN`:

```typescript
// New format: "STRIP OF 10 TAB" → 10
const STRIP_OF_PATTERN = /^\s*STRIP\s+OF\s+(\d+)\s*(TAB|CAP|TABS|CAPS)?\b/i;
const stripMatch = packaging.match(STRIP_OF_PATTERN);
if (stripMatch) return parseInt(stripMatch[1], 10);

// New format: "BOTTLE OF 100ML" → 100
const BOTTLE_OF_PATTERN = /^\s*BOTTLE\s+OF\s+(\d+)\s*ML\b/i;
const bottleMatch = packaging.match(BOTTLE_OF_PATTERN);
if (bottleMatch) return parseInt(bottleMatch[1], 10);
```

**Verification:**
- [ ] Read the file again to confirm new patterns are added
- [ ] Verify they are BEFORE the existing COUNTABLE_UNIT_PATTERN
- [ ] Test mentally: "STRIP OF 10 TAB" should return 10
- [ ] Test mentally: "BOTTLE OF 100ML" should return 100
- [ ] Test mentally: "10 TAB" should still return 10 (backward compatible)

### Step 3.2: Update POS Parser

**File:** `frontend/src/pages/POS/index.tsx`

**Action:** Find the local `parsePackSizeFromPackaging` function (around line 26) and ADD these patterns at the TOP of the function:

```typescript
// New format support
const stripOfMatch = packaging.match(/^\s*STRIP\s+OF\s+(\d+)/i);
if (stripOfMatch) return parseInt(stripOfMatch[1], 10);

const bottleOfMatch = packaging.match(/^\s*BOTTLE\s+OF\s+(\d+)/i);
if (bottleOfMatch) return parseInt(bottleOfMatch[1], 10);
```

**Verification:**
- [ ] Read the function to confirm new patterns are added
- [ ] Verify they are at the TOP (before the existing `/^(\d+)/` pattern)
- [ ] Verify the function still returns a number in all cases

### Step 3.3: Update PackagingMatcher

**File:** `frontend/src/utils/packagingMatcher.ts`

**Action:** Find the normalization function and ADD these lines:

```typescript
normalized = normalized.replace(/^STRIP\s+OF\s+/i, '');
normalized = normalized.replace(/^BOTTLE\s+OF\s+/i, '');
```

**Verification:**
- [ ] Read the function to confirm normalization lines are added
- [ ] Test mentally: "STRIP OF 10 TAB" → "10 TAB" after normalization
- [ ] Test mentally: "BOTTLE OF 100ML" → "100ML" after normalization

---

## PHASE 4: MODAL REWRITE

### Step 4.1: Rewrite UniversalMedicineEditModal

**File:** `frontend/src/components/UniversalMedicineEditModal.tsx`

**This is the LARGEST change. Follow these sub-steps carefully:**

#### Step 4.1.1: Define New Types

**Action:** Add TypeScript interfaces at the top of the file:

```typescript
interface MedicineFormData {
  // Basic Information
  name: string;
  item_type: string;
  category: string;
  pack_unit: string;
  packaging: string;
  pack_size: number;
  
  // Classification
  therapeutic: string;
  sub_therapeutic: string;
  schedule_type: string;
  generic_name: string;
  
  // Manufacturer & Codes
  manufacturer: string;
  marketed_by: string;
  item_code: string;
  short_code: string;
  ucode: string;
  hsn_code: string;
  
  // Tax & Pricing
  cgst_per: number;
  sgst_per: number;
  igst_per: number;
  
  // Stock & Location
  max_stock_level: number;
  rack: string;
  rack_location: string;
  quantity: number;
  
  // Options
  disable_auto_barcode: number;
  tb_medicine: number;
  api_reference: string;
}

interface OCRData {
  potentialName?: string;
  genericName?: string;
  strength?: string;
  manufacturer?: string;
  packaging?: string;
  dosageForm?: string;
  mrp?: number;
  batchNumber?: string;
  expiryDate?: string;
}

interface Props {
  medicineId: number;
  ocrData?: OCRData;
  onClose: () => void;
  onSave: () => void;
}
```

**Verification:**
- [ ] Read the file to confirm interfaces are added
- [ ] Verify all 26 fields are in MedicineFormData
- [ ] Verify OCRData interface exists
- [ ] Verify Props includes ocrData optional prop

#### Step 4.1.2: Add Form-Aware Packing Presets

**Action:** Add these constants after the imports:

```typescript
const SOLID_PRESETS = [
  { key: 'STRIP_OF_4', label: 'STRIP OF 4 TAB', packSize: 4, isStrip: true },
  { key: 'STRIP_OF_10', label: 'STRIP OF 10 TAB', packSize: 10, isStrip: true },
  { key: 'STRIP_OF_15', label: 'STRIP OF 15 TAB', packSize: 15, isStrip: true },
  { key: 'DIRECT_1', label: '1 TAB', packSize: 1, isStrip: false },
  { key: 'DIRECT_10', label: '10 TAB', packSize: 10, isStrip: false },
  { key: 'DIRECT_30', label: '30 TAB', packSize: 30, isStrip: false },
  { key: 'CUSTOM', label: 'Custom…', packSize: 0, isStrip: false },
];

const LIQUID_PRESETS = [
  { key: 'BOTTLE_30ML', label: 'BOTTLE OF 30ML', packSize: 30 },
  { key: 'BOTTLE_50ML', label: 'BOTTLE OF 50ML', packSize: 50 },
  { key: 'BOTTLE_60ML', label: 'BOTTLE OF 60ML', packSize: 60 },
  { key: 'BOTTLE_100ML', label: 'BOTTLE OF 100ML', packSize: 100 },
  { key: 'BOTTLE_120ML', label: 'BOTTLE OF 120ML', packSize: 120 },
  { key: 'BOTTLE_180ML', label: 'BOTTLE OF 180ML', packSize: 180 },
  { key: 'CUSTOM', label: 'Custom…', packSize: 0 },
];

const OTHER_PRESETS = [
  { key: 'DEFAULT_1', label: '1', packSize: 1 },
  { key: 'CUSTOM', label: 'Custom…', packSize: 0 },
];

const FORM_TO_PRESETS: Record<string, typeof SOLID_PRESETS> = {
  TAB: SOLID_PRESETS,
  CAP: SOLID_PRESETS,
  STRIP: SOLID_PRESETS,
  SUSPENSION: LIQUID_PRESETS,
  BOTTLE: LIQUID_PRESETS,
  SYP: LIQUID_PRESETS,
  LIQ: LIQUID_PRESETS,
  AMP: OTHER_PRESETS,
  VIAL: OTHER_PRESETS,
  GEL: OTHER_PRESETS,
  CREAM: OTHER_PRESETS,
  OINT: OTHER_PRESETS,
  INJ: OTHER_PRESETS,
  NONE: OTHER_PRESETS,
};
```

**Verification:**
- [ ] Read the file to confirm presets are added
- [ ] Verify SOLID_PRESETS has 7 options
- [ ] Verify LIQUID_PRESETS has 7 options
- [ ] Verify OTHER_PRESETS has 2 options
- [ ] Verify FORM_TO_PRESETS maps all form types

#### Step 4.1.3: Update Name Compilation Logic

**Action:** Replace the existing name compilation logic with:

```typescript
function compileMedicineName(baseName: string, packType: string, preset: any, customPackaging: string): string {
  if (!baseName) return '';
  if (packType === 'NONE') return baseName;
  
  const packagingStr = preset.key === 'CUSTOM' ? customPackaging : preset.label;
  
  if (preset.isStrip) {
    return `${baseName} STRIP OF ${preset.packSize} ${packType}`;
  }
  
  if (['SUSPENSION', 'BOTTLE', 'SYP', 'LIQ'].includes(packType)) {
    return `${baseName} BOTTLE OF ${preset.packSize}ML`;
  }
  
  return `${baseName} ${packagingStr}`;
}
```

**Verification:**
- [ ] Read the function to confirm it compiles correctly
- [ ] Test mentally: baseName="PAN 40MG", packType="TAB", preset=STRIP_OF_10 → "PAN 40MG STRIP OF 10 TAB"
- [ ] Test mentally: baseName="PAN 40MG", packType="BOTTLE", preset=BOTTLE_100ML → "PAN 40MG BOTTLE OF 100ML"

#### Step 4.1.4: Update Name Parsing Logic

**Action:** Replace the existing `splitMedicineName` function with:

```typescript
function splitMedicineName(name: string, packaging: string): {
  baseName: string;
  packType: string;
  packCategory: 'strip' | 'liquid' | 'other';
  packQty: number;
} {
  // Try new format: "STRIP OF"
  const stripMatch = name.match(/^(.+?)\s+STRIP\s+OF\s+(\d+)\s+(TAB|CAP)$/i);
  if (stripMatch) {
    return {
      baseName: stripMatch[1],
      packType: stripMatch[3],
      packCategory: 'strip',
      packQty: parseInt(stripMatch[2]),
    };
  }
  
  // Try new format: "BOTTLE OF"
  const bottleMatch = name.match(/^(.+?)\s+BOTTLE\s+OF\s+(\d+)ML$/i);
  if (bottleMatch) {
    return {
      baseName: bottleMatch[1],
      packType: detectFormFromName(bottleMatch[1]),
      packCategory: 'liquid',
      packQty: parseInt(bottleMatch[2]),
    };
  }
  
  // Fallback: old format "PAN 40MG TAB 10 TAB"
  // ... keep existing logic ...
}
```

**Verification:**
- [ ] Read the function to confirm it handles both formats
- [ ] Test mentally: "PAN 40MG STRIP OF 10 TAB" → baseName="PAN 40MG", packType="TAB", packCategory="strip", packQty=10
- [ ] Test mentally: "PAN 40MG BOTTLE OF 100ML" → baseName="PAN 40MG", packCategory="liquid", packQty=100
- [ ] Test mentally: "PAN 40MG TAB 10 TAB" → falls through to old logic

#### Step 4.1.5: Build New UI Sections

**Action:** Replace the modal body with 6 sections:

**Section 1: Basic Information**
- Name input (with live preview)
- Item Type dropdown
- Category dropdown
- Form / Suffix Type dropdown
- Packaging dropdown (dynamic based on form)
- Qty Per Unit input

**Section 2: Classification**
- Therapeutic input
- Sub Therapeutic input
- Schedule Type dropdown
- Salts / Compounds input

**Section 3: Manufacturer & Codes**
- Manufacturer input (with autocomplete)
- Marketed By input (with autocomplete)
- Medicine Barcode input
- Short Code input
- UCode input
- HSN Code input

**Section 4: Tax & Pricing**
- CGST % input
- SGST % input
- IGST % input
- HSN Lookup button

**Section 5: Stock & Location**
- Min Stock input
- Max Stock input
- Rack Location input
- Is Loose toggle

**Section 6: Substitutes & Options**
- Substitute button
- Substitute Type dropdown
- Disable Auto Barcode toggle
- TB Medicine toggle

**Verification:**
- [ ] Read the file to confirm all 6 sections are present
- [ ] Count the fields: should be 26 fields total
- [ ] Verify each section has the correct fields
- [ ] Verify the form state includes all 26 fields

#### Step 4.1.6: Add OCR Pre-fill Support

**Action:** In the useEffect that loads medicine data, add OCR pre-fill logic:

```typescript
useEffect(() => {
  if (ocrData) {
    // Pre-fill from OCR data
    setForm((prev: any) => ({
      ...prev,
      name: ocrData.potentialName || prev.name,
      generic_name: ocrData.genericName || prev.generic_name,
      manufacturer: ocrData.manufacturer || prev.manufacturer,
      packaging: ocrData.packaging || prev.packaging,
      item_type: ocrData.dosageForm || prev.item_type,
    }));
    
    // Parse packaging from OCR
    if (ocrData.packaging) {
      const parsed = splitMedicineName(ocrData.potentialName || '', ocrData.packaging);
      setBaseName(parsed.baseName);
      setPackType(parsed.packType);
      // ... set other state
    }
  }
}, [ocrData]);
```

**Verification:**
- [ ] Read the useEffect to confirm OCR pre-fill logic is added
- [ ] Verify it only runs when ocrData is provided
- [ ] Verify it doesn't overwrite existing data when ocrData is null

---

## PHASE 5: DISPLAY PAGES

### Step 5.1: Update Database Page

**File:** `frontend/src/pages/Database/index.tsx`

**Action:** Add these columns to the table display:
- Therapeutic
- Sub Therapeutic
- Short Code
- UCode
- Schedule Type (if not already shown)
- Item Type (if not already shown)

**Verification:**
- [ ] Read the file to confirm new columns are added
- [ ] Verify they are in the table header and row rendering

### Step 5.2: Update Inventory Page

**File:** `frontend/src/pages/Inventory/index.tsx`

**Action:** Add to inventory detail view:
- Therapeutic
- Sub Therapeutic
- Schedule Type

**Verification:**
- [ ] Read the file to confirm new fields are added

### Step 5.3: Update Purchases Page

**File:** `frontend/src/pages/Purchases/index.tsx`

**Action:** Add to purchase form display:
- Therapeutic
- Sub Therapeutic
- Schedule Type

**Verification:**
- [ ] Read the file to confirm new fields are added

### Step 5.4: Update Sells Page

**File:** `frontend/src/pages/Sells/index.tsx`

**Action:** Add schedule_type column to sales table.

**Verification:**
- [ ] Read the file to confirm schedule_type column is added

### Step 5.5: Update CRM Page

**File:** `frontend/src/pages/CRM/index.tsx`

**Action:** Add therapeutic column to CRM display.

**Verification:**
- [ ] Read the file to confirm therapeutic column is added

---

## PHASE 6: NEW FEATURES

### Step 6.1: Create Compliance Dashboard Page

**File:** `frontend/src/pages/Compliance/index.tsx` (NEW FILE)

**Action:** Create a new page with:
- Header: "Schedule H1 Compliance Dashboard"
- Stats cards: Today's H1 sales, Monthly H1 sales, Pending doctor assignments
- Filterable register table
- Export to CSV button
- Print H1 register button
- Assign doctor functionality

**Verification:**
- [ ] Read the file to confirm it exists
- [ ] Verify it has all required components
- [ ] Verify it calls the compliance API endpoints

### Step 6.2: Enhance Compliance Route

**File:** `src/routes/compliance.ts`

**Action:** Add these endpoints:
- `GET /api/compliance/dashboard` — aggregated stats
- `GET /api/compliance/h1-register?date=&drug=` — filtered register
- `PUT /api/compliance/:id/doctor` — assign doctor
- `GET /api/compliance/export?format=csv` — export

**Verification:**
- [ ] Read the file to confirm new endpoints are added
- [ ] Verify each endpoint has proper error handling

### Step 6.3: Add POS H1 Warning

**File:** `frontend/src/pages/POS/index.tsx`

**Action:** When adding item to cart, check schedule_type:
```typescript
if (['H', 'H1', 'X'].includes(item.schedule_type?.toUpperCase())) {
  setShowH1Warning(true);
  setH1WarningItem(item);
  return;
}
```

Add H1 Warning Dialog component:
- Show drug name and schedule type
- Require doctor name input
- Optional prescription number input
- Cancel / Add to Cart buttons

**Verification:**
- [ ] Read the file to confirm H1 check is added
- [ ] Read the file to confirm H1 Warning Dialog component exists
- [ ] Verify the dialog requires doctor name before proceeding

### Step 6.4: Add Therapeutic Search to POS

**File:** `frontend/src/pages/POS/index.tsx`

**Action:** In the search function, add therapeutic matching:
```typescript
// If no results from name search, try therapeutic search
if (results.length === 0) {
  results = await api.searchByTherapeutic(searchTerm);
}
```

**Verification:**
- [ ] Read the file to confirm therapeutic search is added
- [ ] Verify it only runs as fallback when name search returns empty

### Step 6.5: Enhance Substitute Engine

**File:** `src/services/medicineAvailabilityEngine.ts`

**Action:** Add therapeutic matching to `getSubstitutes`:
```typescript
// After composition match, add therapeutic match
const therapeuticMatches = await db.all(
  `SELECT m.*, 0.85 as confidence 
   FROM medicines m 
   WHERE m.therapeutic = ? AND m.id != ?`,
  [sourceMed.therapeutic, sourceMed.id]
);
```

**Verification:**
- [ ] Read the function to confirm therapeutic matching is added
- [ ] Verify it returns results with confidence score 0.85

### Step 6.6: Enhance Enrichment

**File:** `src/worker/compositionEnricher.ts`

**Action:** When enriching composition, also populate therapeutic:
```typescript
// After enriching api_reference, also set therapeutic
if (reference.therapeutic) {
  await db.run(
    'UPDATE medicines SET therapeutic = ? WHERE id = ?',
    [reference.therapeutic, medicineId]
  );
}
```

**Verification:**
- [ ] Read the function to confirm therapeutic population is added

### Step 6.7: Expand Therapeutic Classes

**File:** `src/services/googleSearchService.ts`

**Action:** Expand the hardcoded therapeutic class list from 8 to 50+:
- ANALGESIC, ANTIPYRETIC, ANTIBIOTIC, ANTIFUNGAL
- BETA BLOCKER, NSAID, PROTON PUMP INHIBITOR, ANTIHISTAMINE
- ACE INHIBITOR, ARB, CALCIUM CHANNEL BLOCKER, DIURETIC
- STATIN, FIBRATE, ANTIDIABETIC, INSULIN
- ANTIDEPRESSANT, ANXIOLYTIC, ANTIPSYCHOTIC
- etc.

**Verification:**
- [ ] Read the file to confirm therapeutic class list is expanded
- [ ] Verify at least 50 classes are included

---

## PHASE 7: OCR INTEGRATION

### Step 7.1: Update AICamera Component

**File:** `frontend/src/components/AICamera.tsx`

**Action:** Ensure the scan result includes all structured fields:
```typescript
onScanResult({
  ...response.data,
  capturedImage: base64Image,
  // Ensure these fields are included:
  potentialName: response.data.medicineInfo?.potentialName,
  genericName: response.data.medicineInfo?.genericName,
  strength: response.data.medicineInfo?.strength,
  manufacturer: response.data.medicineInfo?.manufacturer,
  packaging: response.data.medicineInfo?.packaging,
  dosageForm: response.data.medicineInfo?.dosageForm,
  mrp: response.data.medicineInfo?.mrp,
  batchNumber: response.data.medicineInfo?.batchNumber,
  expiryDate: response.data.medicineInfo?.expiryDate,
})
```

**Verification:**
- [ ] Read the file to confirm all fields are included in scan result

### Step 7.2: Update POS OCR Handler

**File:** `frontend/src/pages/POS/index.tsx`

**Action:** Pass OCR data to edit modal:
```typescript
// When opening edit modal after scan
setEditMedicineId(medId);
setEditOcrData(ocrResult); // Store OCR data
```

Then pass to modal:
```typescript
<UniversalMedicineEditModal
  medicineId={editMedicineId}
  ocrData={editOcrData}
  onClose={() => { setEditMedicineId(null); setEditOcrData(null); }}
  onSave={handleSave}
/>
```

**Verification:**
- [ ] Read the file to confirm OCR data is stored
- [ ] Read the file to confirm OCR data is passed to modal

### Step 7.3: Update aiCameraService

**File:** `src/services/aiCameraService.ts`

**Action:** Extract therapeutic from medicine_reference:
```typescript
// After resolving generic name, also get therapeutic
const ref = await db.get(
  'SELECT therapeutic FROM medicine_reference WHERE name = ?',
  [genericName]
);
if (ref) {
  finalInfo.therapeutic = ref.therapeutic;
}
```

**Verification:**
- [ ] Read the function to confirm therapeutic extraction is added

---

## PHASE 8: SCRIPTS & TESTS

### Step 8.1: Update Build Medicine Dict

**File:** `scripts/build-medicine-dict.ts`

**Action:** Add token exclusion for new keywords:
```typescript
nameStr = nameStr.replace(/\bSTRIP\s+OF\b/gi, '');
nameStr = nameStr.replace(/\bBOTTLE\s+OF\b/gi, '');
```

**Verification:**
- [ ] Read the file to confirm token exclusion is added

### Step 8.2: Add Packaging Tests

**File:** `tests/packaging.test.ts`

**Action:** Add test cases:
```typescript
describe('parsePackSizeFromPackaging - new formats', () => {
  test('STRIP OF 10 TAB → 10', () => {
    expect(parsePackSizeFromPackaging('STRIP OF 10 TAB')).toBe(10);
  });
  test('STRIP OF 15 CAP → 15', () => {
    expect(parsePackSizeFromPackaging('STRIP OF 15 CAP')).toBe(15);
  });
  test('BOTTLE OF 100ML → 100', () => {
    expect(parsePackSizeFromPackaging('BOTTLE OF 100ML')).toBe(100);
  });
  test('10 TAB → 10 (backward compatible)', () => {
    expect(parsePackSizeFromPackaging('10 TAB')).toBe(10);
  });
});
```

**Verification:**
- [ ] Read the file to confirm test cases are added

### Step 8.3: Run Tests

**Action:**
```bash
npm test
```

**Verification:**
- [ ] All tests pass
- [ ] No test failures

### Step 8.4: Run Lint

**Action:**
```bash
npm run lint
```

**Verification:**
- [ ] No lint errors
- [ ] No lint warnings (or only pre-existing ones)

### Step 8.5: Run TypeCheck

**Action:**
```bash
npm run typecheck
```

**Verification:**
- [ ] No type errors

### Step 8.6: Update Knowledge Graph

**Action:**
```bash
node scripts/quick-update.mjs
```

**Verification:**
- [ ] Knowledge graph updated successfully

---

## FINAL VERIFICATION

Agent MUST complete ALL these checks before marking implementation as DONE:

### Code Quality
- [ ] All files have been read and verified after editing
- [ ] No TypeScript errors
- [ ] No lint errors
- [ ] All tests pass

### Feature Completeness
- [ ] Modal has 26 fields in 6 sections
- [ ] Form-aware packing works (TAB→strip, BOTTLE→ml)
- [ ] Name compilation works (STRIP OF / BOTTLE OF format)
- [ ] Name parsing works (both old and new formats)
- [ ] Backend PUT saves all 26 fields
- [ ] H1 Compliance dashboard exists and works
- [ ] POS H1 warning dialog works
- [ ] Therapeutic search works in POS
- [ ] Smart substitutes use therapeutic class
- [ ] Enrichment populates therapeutic
- [ ] OCR data passes to edit modal

### Safety
- [ ] stockRebuild.ts NOT modified
- [ ] sales.ts NOT modified (except H1 check)
- [ ] pdfInvoiceService.ts NOT modified
- [ ] pharmarack.ts NOT modified
- [ ] All 48 name-reading locations still work
- [ ] All 30 pack_size-reading locations still work
- [ ] Backward compatibility maintained (old format still works)

### Documentation
- [ ] Knowledge graph updated
- [ ] Git commit with descriptive message

---

## GIT COMMIT

After all verification passes:

```bash
git add -A
git commit -m "feat: complete medicine editor redesign with 26 fields, H1 compliance, therapeutic search, OCR integration"
```

---

**END OF AGENT IMPLEMENTATION GUIDE**
