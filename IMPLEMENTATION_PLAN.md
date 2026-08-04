# AI PHARMACY v2 â€” COMPLETE IMPLEMENTATION PLAN

> **Status:** PLANNING â€” DO NOT IMPLEMENT UNTIL APPROVED
> **Created:** 2026-08-04
> **Total Phases:** 8
> **Estimated Total Time:** ~14 hours

---

## TABLE OF CONTENTS

1. Executive Summary
2. System Architecture Overview
3. Phase 1: Phone Number Cleanup
4. Phase 2: OCR Data Quality â€” Extract All Fields
5. Phase 3: WhatsApp Notifications â€” Include Medicine Details
6. Phase 4: Stock Check / Cart Fixes
7. Phase 5: Email Reconciliation â€” Universal Parser
8. Phase 6: Self-Learning Integration
9. Phase 7: Per-Distributor Layout Learning
10. Phase 8: Notification & Communication Fixes
11. Phase Verification Protocol
12. Dependency Map
13. Appendix: File Reference

---

## EXECUTIVE SUMMARY

### What This Plan Fixes

The AI Pharmacy app has **16 connected problems** across 6 areas:

| Area | Problems | Impact |
|---|---|---|
| OCR Detection | Wrong medicine name picked, valid medicines skipped, only 1 medicine per image | Customer gets wrong medicine info |
| WhatsApp Integration | Notifications missing medicine details, special order notifications never sent, phone format issues | Customer never sees what they bought |
| Email Reconciliation | Fails to detect medicines from invoices, only 2 distributor parsers, errors silently swallowed | Distributor invoices not tracked |
| Stock Check / Cart | Stale cache shows phantom stock, refill ignores loose stock, fake 999 stock | Overselling, wrong stock counts |
| Self-Learning | App doesn't learn from bills, 4 learning tables isolated, medicine data stays incomplete | App never improves |
| Per-Distributor Learning | No text/PDF layout learning, missing fields break parsing | New distributors always fail |

### How These Problems Are Connected

```
OCR fixes (Phase 2) -> Better medicine detection -> Better search results
     |
Stock check fixes (Phase 4) -> Correct stock counts -> No overselling
     |
Email fixes (Phase 5) -> Distributor invoices parsed -> Stock updated
     |
WhatsApp fixes (Phase 3) -> Customer gets medicine details -> Better UX
     |
Self-learning (Phase 6) -> App improves from every action -> Less manual work
     |
Layout learning (Phase 7) -> New distributors auto-learned -> Zero configuration
```

**Every fix makes the next fix better.** OCR improvements feed into search, which feeds into stock, which feeds into learning, which feeds into layout learning.

---

## SYSTEM ARCHITECTURE OVERVIEW

### Data Flow — How Everything Connects

`
USER ACTION                    SYSTEM RESPONSE                    LEARNING FEEDBACK
============                   ==============                    =================

1. User scans medicine image
   -> OCR extracts text        -> aiCameraService.ts              -> ocr_corrections
   -> Matches against DB       -> productNameFilterService.ts     -> medicine_aliases
   -> Adds to cart              -> POS/index.tsx                   -> (none currently)

2. User saves bill
   -> Deducts stock            -> sales.ts                        -> (none currently)
   -> Sends WhatsApp           -> whatsappClient.ts               -> automation_notifications
   -> Creates refill           -> refillService.ts                -> patient_refills

3. Distributor sends email
   -> Parses attachment         -> emailService.ts                 -> distributor_historical_files
   -> Matches medicines         -> purchases.ts                    -> distributor_learning_profiles
   -> Updates inventory         -> catalogWorker.ts                -> medicines table

4. Customer searches POS
   -> Searches local cache      -> POS/index.tsx                   -> pharmacist_corrections
   -> Searches Pharmarack       -> pharmarack.ts                   -> distributor_catalog

5. Pharmacist corrects scan
   -> Saves correction          -> aiCamera.ts                     -> ocr_corrections
   -> Updates medicine data     -> medicineService.ts              -> medicine_aliases
`

### Key Database Tables

| Table | Purpose | Learning Role |
|---|---|---|
| medicines | Master product list (name, MRP, manufacturer, packaging, strength, api_reference) | Target for auto-fill |
| medicine_reference | Reference dictionary (~200K rows: name -> composition, manufacturer) | OCR matching source |
| ocr_corrections | OCR text -> correct medicine name mapping | Instant O(1) lookup on future scans |
| medicine_aliases | Global alias -> canonical medicine_id | Cross-app resolution |
| distributor_medicine_aliases | Per-distributor alias -> medicine_id | Distributor-specific matching |
| pharmacist_corrections | Search query -> correct medicine_id | POS search improvement |
| distributor_historical_files | Per-distributor file headers + mapping + extracted data | CSV/XLSX learning |
| distributor_learning_profiles | Per-distributor layout rules | Layout learning (CSV + text/PDF) |
| inventory_master | Stock levels per batch | Stock check source |
| patient_refills | Refill tracking | Refill reminders |
| special_orders | Pending shortage orders | Customer notifications |
| emails | Incoming distributor emails | Reconciliation source |
| automation_notifications | WhatsApp/email notification log | Audit trail |

---

## PHASE 1: PHONE NUMBER CLEANUP

**Time:** 30 minutes
**Priority:** Quick win — foundational
**Depends on:** None

### Problem Statement

Users can enter phone numbers with +91 prefix in some input fields. The app stores 919876543210 (12 digits) instead of 9876543210 (10 digits). This causes WhatsApp messages to fail or go to wrong numbers.

### Root Cause

Some input fields have sanitizePhoneInput() (strips to 10 digits), others have NO sanitization:

| Input Field | Has Sanitization | Result |
|---|---|---|
| POS credit bill phone | Yes | Stores 10 digits |
| Settings store phone | Yes | Stores 10 digits |
| Settings owner WhatsApp | Yes | Stores 10 digits |
| Purchases distributor phone | NO | Stores 12 digits if user types +91 |
| Learning distributor WhatsApp | NO | Stores 12 digits if user types +91 |
| Dispatch delivery boy phone | NO | Stores raw input |
| Mobile app customer phone | NO | Stores raw input |

### How to Fix

| # | File | Line | Change |
|---|---|---|---|
| 1 | frontend/src/pages/Purchases/index.tsx | 2855 | Add sanitizePhoneInput() to distributor phone input |
| 2 | frontend/src/pages/Learning/index.tsx | 2567 | Add sanitization to distributor WhatsApp phones input |
| 3 | frontend/src/pages/Dispatch/index.tsx | 411 | Add sanitization to delivery boy phone edit field |
| 4 | pharmacy-mobile/app/(tabs)/billing/index.tsx | 1144 | Add sanitizePhoneInput() to mobile app customer phone input |
| 5 | src/routes/settings.ts | 340-341 | Add 91 prefix stripping on save to ensure 10 digits stored |

### How This Helps Other Phases

- Phase 2 (OCR): Correct phone format means OCR-scanned phone numbers are stored consistently
- Phase 3 (WhatsApp): Correct phone format means messages always reach the right number
- Phase 6 (Learning): Correct phone format means customer records match across the system

### Verification Checklist

- [ ] Open Purchases page -> enter +919876543210 in distributor phone -> save -> verify database stores 9876543210
- [ ] Open Learning page -> enter +919876543210 in WhatsApp phones -> save -> verify database stores 9876543210
- [ ] Open Dispatch page -> edit delivery boy phone with +91 prefix -> save -> verify 10 digits stored
- [ ] Open Mobile app -> enter +919876543210 in customer phone -> verify sanitization
- [ ] Open Settings -> enter +919876543210 in store phone -> save -> verify 10 digits stored
- [ ] Send test WhatsApp message -> verify delivery to correct number
- [ ] Run node scripts/quick-update.mjs to update knowledge graph

---

## PHASE 2: OCR DATA QUALITY — EXTRACT ALL FIELDS

**Time:** 2 hours
**Priority:** High impact — foundation for everything
**Depends on:** Phase 1

### Problem Statement

OCR currently only extracts medicine name and MRP. It misses manufacturer, packaging, and strength. MRP regex is too narrow. Wrong MRP breaks search filtering. Only 1 medicine detected per image.

### Root Causes

| # | Cause | File:Line | What Goes Wrong |
|---|---|---|---|
| 1 | MRP regex too narrow | aiCameraService.ts:482 | Only matches MRP: 120.00 — misses M.R.P., MAX RETAIL PRICE, Rs120/- |
| 2 | No MRP sanity check | aiCameraService.ts:483 | Misread 1 or 999999 accepted silently |
| 3 | No manufacturer extraction | aiCameraService.ts:426 | Manufacturer NEVER extracted — always null |
| 4 | No packaging extraction | aiCameraService.ts:426 | Packaging NEVER extracted — always null |
| 5 | Rupee symbol dropped from OCR | aiCameraService.ts:117 | Char whitelist does not include Rupee symbol |
| 6 | Hardcoded packSize=10 | POS/index.tsx:1895 | All scanned items default to 10 tablets |
| 7 | Guessed costPrice=70% | POS/index.tsx:1893 | Cost price guessed at 70% of MRP |
| 8 | Wrong MRP breaks search | productNameFilterService.ts:436 | MRP +/-20% filter excludes correct medicine |
| 9 | Audit saves only name+mrp | aiCamera.ts:66 | Manufacturer/packaging lost on manual save |
| 10 | Single medicine per image | aiCameraService.ts | No multi-region detection |

### How to Fix

| # | File | Line | Change |
|---|---|---|---|
| 1 | src/services/aiCameraService.ts | 482 | Fix MRP regex to handle M.R.P., MAX RETAIL PRICE, Rupee symbol, Rs., multi-word separators, 1-3 decimal places |
| 2 | src/services/aiCameraService.ts | 483 | Add MRP sanity check — reject values less than 1 or greater than 100000 |
| 3 | src/services/aiCameraService.ts | 426 | Add manufacturer extraction — regex for common Indian pharma patterns: Mfr by, Manufactured by, company names |
| 4 | src/services/aiCameraService.ts | 426 | Add packaging extraction — detect 10x1x10, 15 TABS, 30 CAPS, 100ml patterns |
| 5 | src/services/aiCameraService.ts | 117 | Add Rupee symbol to char whitelist so OCR does not silently drop it |
| 6 | src/routes/aiCamera.ts | 66 | Save all OCR fields on audit resolve — pass manufacturer, packaging, strength to addOrUpdateMedicine() |
| 7 | frontend/src/pages/POS/index.tsx | 1895 | Remove hardcoded packSize=10 — use extracted packaging or lookup from database |
| 8 | frontend/src/pages/POS/index.tsx | 1893 | Remove guessed costPrice=70% — use rate from database or leave blank |
| 9 | src/services/productNameFilterService.ts | 436 | Widen MRP tolerance from +/-20% to +/-40% to handle OCR misreads |
| 10 | src/services/aiCameraService.ts | — | Add multi-medicine detection — split image into regions, detect multiple strips, return array |

### How This Helps Other Phases

- Phase 3 (WhatsApp): Better OCR means correct medicine names in notification
- Phase 4 (Stock): Correct MRP means correct stock values, no overselling
- Phase 5 (Email): OCR manufacturer/packaging data can cross-validate email parsing
- Phase 6 (Learning): Every OCR correction improves future matching via ocr_corrections
- Phase 7 (Layout Learning): OCR data validates email-parsed data

### Verification Checklist

- [ ] Scan medicine image with M.R.P. Rs.149.00 -> verify MRP extracted as 149
- [ ] Scan medicine image with MAX RETAIL PRICE 120.00 -> verify MRP extracted as 120
- [ ] Scan medicine with MRP 0 or 999999 -> verify rejected
- [ ] Scan medicine with manufacturer name -> verify manufacturer extracted
- [ ] Scan medicine with 10x1x10 packaging -> verify packaging extracted
- [ ] Scan image with 2 medicine strips -> verify BOTH detected
- [ ] Manually correct audit -> verify all fields saved to database
- [ ] Search for medicine with correct MRP -> verify found (not excluded by filter)
- [ ] Run node scripts/quick-update.mjs to update knowledge graph

---

## PHASE 3: WHATSAPP NOTIFICATIONS — INCLUDE MEDICINE DETAILS

**Time:** 1.5 hours
**Priority:** High impact — customer-facing
**Depends on:** Phase 2

### Problem Statement

When a bill is saved, the WhatsApp notification to the customer has NO medicine names, NO MRP, NO quantities. Customer only sees Bill #S-2026-0001, Amount: Rs.1500 with no idea what they bought.

### Root Causes

| # | Cause | File:Line | What Goes Wrong |
|---|---|---|---|
| 1 | No items in template | sales.ts:473-525 | Template only has bill number + total — no item list |
| 2 | PDF path not used | sales.ts:527 | Main POS sends text-only; PDF receipt only in staged-sale path |
| 3 | Errors silently swallowed | sales.ts:458 | Fire-and-forget IIFE — if WhatsApp fails, no error shown |
| 4 | Special order template never sent | sales.ts:562 | Template built but never dispatched |
| 5 | Phone format issues | sales.ts:454 | +91 prefix handling may produce wrong WhatsApp JID |

### How to Fix

| # | File | Line | Change |
|---|---|---|---|
| 1 | src/routes/sales.ts | 473-525 | Add item list to template — loop over items array, append medicine name + qty + MRP to waMsg |
| 2 | src/routes/sales.ts | 527 | Use PDF path — call whatsappInvoiceService.sendInvoiceViaWhatsApp(invoiceId) instead of plain text |
| 3 | src/routes/sales.ts | 458 | Add error feedback — log failure to automation_notifications with status: failed |
| 4 | src/routes/sales.ts | 562 | Send special order notification — after building template, call sendMessage() to dispatch it |
| 5 | src/routes/sales.ts | 454 | Normalize phone — use sanitizePhoneInput() before sending to WhatsApp |

### Template Example (After Fix)

`
Dear Rajesh,

Your bill #S-2026-0001:
1. Dexamethasone 0.5mg Tab x 2 strips = Rs.25.00
2. Biopron L Cap x 1 strip = Rs.120.00
3. Crocin 500mg Tab x 3 strips = Rs.45.00
Total: Rs.190.00

Thank you for your purchase!
`

### How This Helps Other Phases

- Phase 2 (OCR): Better OCR means correct medicine names in notification
- Phase 6 (Learning): Notification log with medicine details enables learning from sales patterns
- Phase 8 (Notifications): Fixed error handling means failed notifications are visible

### Verification Checklist

- [ ] Save a bill with 3 medicines -> verify WhatsApp includes all 3 names, quantities, MRP
- [ ] Save a credit bill -> verify notification includes item list + outstanding balance
- [ ] Save a bill when WhatsApp is disconnected -> verify error logged to automation_notifications
- [ ] Fulfill a special order -> verify customer receives WhatsApp notification
- [ ] Check phone number with +91 prefix -> verify message reaches correct number
- [ ] Run node scripts/quick-update.mjs to update knowledge graph

---

## PHASE 4: STOCK CHECK / CART FIXES

**Time:** 1.5 hours
**Priority:** Medium impact — prevents overselling
**Depends on:** Phase 1

### Problem Statement

Cart sometimes shows medicines as available when they are out of stock. Refill system ignores loose units. Deleted batches get fake 999 stock. Edit mode shows unlimited stock.

### Root Causes

| # | Cause | File:Line | What Goes Wrong |
|---|---|---|---|
| 1 | Stale cache shows phantom stock | api.ts:253 | Frontend cache not refreshed after other user sale |
| 2 | Fake 999 stock | POS/index.tsx:1315 | Missing batches get fabricated stock of 999 |
| 3 | No hard block on over-adding | POS/index.tsx:2746 | Warning shows but does not block adding more |
| 4 | Undefined stock bypasses check | POS/index.tsx:1982 | Old/held bills skip validation entirely |
| 5 | Edit mode 99999 | POS/index.tsx:321 | Edit bill shows unlimited stock |
| 6 | Refill ignores loose stock | refillService.ts:56 | SUM(quantity) only — loose invisible |
| 7 | Refill panel ignores loose | refills.ts:283 | Same issue in panel query |
| 8 | Recommend-quantity defaults | sales.ts:810 | Name mismatch defaults to 1 strip |

### How to Fix

| # | File | Line | Change |
|---|---|---|---|
| 1 | frontend/src/pages/POS/index.tsx | 1315-1332 | Remove fake 999 — when activeBatches.length === 0, show Out of stock instead |
| 2 | frontend/src/pages/POS/index.tsx | 2746-2758 | Hard block — prevent adding more than available stock in search dropdown |
| 3 | frontend/src/pages/POS/index.tsx | 1982 | Do not skip — fetch live stock from server instead of skipping validation |
| 4 | frontend/src/pages/POS/index.tsx | 321 | Remove 99999 — fetch real stock for edit mode |
| 5 | src/services/refillService.ts | 56-60 | Count loose — SUM(quantity + COALESCE(loose_quantity, 0)) |
| 6 | src/routes/refills.ts | 283-291 | Count loose — same fix |
| 7 | src/routes/sales.ts | 810-860 | Fix fallback — use LIKE prefix match instead of exact IN match |
| 8 | frontend/src/services/api.ts | 253-298 | Auto-refresh — ensure inventoryCache.invalidate() triggers frontend refresh |

### How This Helps Other Phases

- Phase 2 (OCR): Correct stock counts mean OCR-scanned items show real availability
- Phase 3 (WhatsApp): Correct stock means refill notifications only sent when actually in stock
- Phase 5 (Email): Email-parsed purchases update stock correctly
- Phase 6 (Learning): Stock changes feed into learning about demand patterns

### Verification Checklist

- [ ] Add medicine to cart -> verify stock shows correct remaining quantity
- [ ] Add medicine with 0 stock -> verify Out of stock shown (not fake 999)
- [ ] Add more than available -> verify hard block prevents it
- [ ] Edit existing bill -> verify real stock shown (not 99999)
- [ ] Check refill with loose units -> verify loose stock counted
- [ ] Search for medicine with slight name mismatch -> verify recommend-quantity works
- [ ] Run node scripts/quick-update.mjs to update knowledge graph

---

## PHASE 5: EMAIL RECONCILIATION — UNIVERSAL PARSER

**Time:** 3 hours
**Priority:** High impact — distributor invoice tracking
**Depends on:** Phase 1, Phase 2

### Problem Statement

Email reconciliation fails to detect medicines from distributor invoices. Only 2 distributors (Shriyash, Nitin) have custom parsers. All others use a rigid generic parser that fails on non-standard formats. Errors are silently swallowed.

### Root Causes

| # | Cause | File:Line | What Goes Wrong |
|---|---|---|---|
| 1 | Only 2 distributor parsers | emailService.ts:2262 | Hardcoded for Shriyash and Nitin only |
| 2 | Generic parser too rigid | emailService.ts:525 | Requires exact 5+ token format with expiry in specific position |
| 3 | Silent error swallowing | purchases.ts:1942 | catch (pe) { // ignore } — failures disappear |
| 4 | Medicine names lost | emailService.ts:1309 | Body text extraction only finds inline quantities |
| 5 | PDF text garbled | emailService.ts:2060 | Scanned PDFs return empty/jumbled text |
| 6 | Limited email query | purchases.ts:1853 | Only last 50 emails queried |
| 7 | Limited purchase query | purchases.ts:2031 | Only last 200 purchases queried |
| 8 | Noise filter too aggressive | emailService.ts:3324 | Filters out valid medicine names |

### How to Fix

| # | File | Line | Change |
|---|---|---|---|
| 1 | src/services/emailService.ts | — | Add detectLayoutType(text) — auto-detect horizontal/vertical/concatenated layout |
| 2 | src/services/emailService.ts | 525 | Rewrite generic parser — use layout classifier instead of rigid format |
| 3 | src/services/emailService.ts | 581 | Extract Shriyash logic — generalize into parseVerticalBlockInvoice() function |
| 4 | src/services/emailService.ts | 731 | Extract Nitin logic — generalize into parseConcatenatedInvoice() function |
| 5 | src/services/emailService.ts | 2262 | Remove hardcoded triggers — use layout detection, not content.includes(SHRIYASH) |
| 6 | src/services/emailService.ts | 3324 | Improve noise filter — be less aggressive, allow single-word names |
| 7 | src/services/emailService.ts | 2519 | Add error logging — log parsing failures instead of silent catch |
| 8 | src/services/emailService.ts | 1936 | Handle missing attachments — log warning, skip gracefully |
| 9 | src/routes/purchases.ts | 1853 | Increase email limit from 50 to 200 |
| 10 | src/routes/purchases.ts | 2031 | Increase purchase limit from 200 to 500 |

### Layout Detection Algorithm

`
detectLayoutType(text):
  lines = text.split(newline)

  Check for vertical block (serial numbers)
  if lines.any(l => /^\d{3}$/.test(l.trim()))
    return vertical

  Check for concatenated (8-digit HSN prefix)
  if lines.any(l => /^\d{8}/.test(l.trim()))
    return concatenated

  Check for horizontal table (expiry date + surrounding numbers)
  if lines.any(l => expiry date pattern and adjacent numbers)
    return horizontal

  Try all three, pick best result
  return auto-detect
`

### How This Helps Other Phases

- Phase 2 (OCR): Email-parsed data validates OCR-extracted data
- Phase 4 (Stock): Correct email parsing means correct stock updates
- Phase 6 (Learning): Email parsing success feeds into distributor learning
- Phase 7 (Layout Learning): Successful parses save layout patterns for future use

### Verification Checklist

- [ ] Send CSV invoice from new distributor -> verify auto-detected layout
- [ ] Send PDF invoice from new distributor -> verify medicine names extracted
- [ ] Send invoice with missing GST -> verify graceful fallback (default GST applied)
- [ ] Send invoice with missing batch -> verify generated batch number
- [ ] Send invoice from Shriyash -> verify vertical block parser works
- [ ] Send invoice from Nitin -> verify concatenated parser works
- [ ] Check Learning page -> verify distributor profile saved
- [ ] Send same distributor invoice again -> verify learned layout applied
- [ ] Run node scripts/quick-update.mjs to update knowledge graph

---

## PHASE 6: SELF-LEARNING INTEGRATION

**Time:** 2 hours
**Priority:** Medium impact — app improvement over time
**Depends on:** Phase 2, Phase 3, Phase 5

### Problem Statement

The app has 4 isolated learning tables that do not talk to each other. Bills do not feed back into learning. Medicine data stays incomplete. The app never gets smarter from daily use.

### Root Causes

| # | Cause | File:Line | What Goes Wrong |
|---|---|---|---|
| 1 | No bill to learning feed | sales.ts | Bill save does not confirm medicine data |
| 2 | 4 learning tables isolated | Various | ocr_corrections, medicine_aliases, distributor_medicine_aliases, pharmacist_corrections do not share data |
| 3 | Medicine data stays incomplete | medicineService.ts | New data does not auto-fill missing fields |
| 4 | No unified learning view | Learning/index.tsx | No dashboard showing all learning activity |
| 5 | Name-only matching | productNameFilterService.ts:286 | Only loads names, not MRP/manufacturer/packaging |

### How to Fix

| # | File | Line | Change |
|---|---|---|---|
| 1 | src/routes/sales.ts | after save | Bill to Learning — after sale, confirm medicine name in ocr_corrections if scan was used |
| 2 | src/services/productNameFilterService.ts | 286 | Load all fields — extend initialize() to load name + MRP + manufacturer + packaging + strength |
| 3 | src/services/productNameFilterService.ts | 364 | Use all fields in scoring — add manufacturer/packaging/strength as scoring signals |
| 4 | src/services/medicineService.ts | 226 | Auto-fill missing fields — merge new data with existing (do not overwrite good data) |
| 5 | src/routes/learning.ts | — | Add unified dashboard — show all learning activity in one view |
| 6 | frontend/src/pages/Learning/index.tsx | — | Add Learning Stats — show accuracy rate, most scanned, most corrected |

### Learning Flow Diagram

`
USER ACTION                    LEARNING TABLE UPDATED         FUTURE BENEFIT
============                   =====================          ==============

OCR scan corrected             ocr_corrections                Same scan resolves in O(1)
Bill saved                     (confirm medicine)             Medicine data confirmed
Purchase saved                 distributor_medicine_aliases   Same distributor resolves instantly
POS search corrected           pharmacist_corrections         Better ranking next time
Email parsed successfully      distributor_learning_profiles  Same layout applied next time
Manual alias created           medicine_aliases               Alias resolves across app
`

### How This Helps Other Phases

- Phase 2 (OCR): Learning improves OCR matching accuracy
- Phase 3 (WhatsApp): Correct medicine data means correct notifications
- Phase 4 (Stock): Learning improves stock predictions
- Phase 5 (Email): Learning improves email parsing accuracy
- Phase 7 (Layout Learning): Learning feeds into per-distributor layout patterns

### Verification Checklist

- [ ] Correct an OCR scan -> verify ocr_corrections updated
- [ ] Scan same text again -> verify instant resolution (no fuzzy matching)
- [ ] Save purchase with new distributor name -> verify distributor_medicine_aliases updated
- [ ] Search POS with corrected term -> verify pharmacist_corrections updated
- [ ] Check Learning page -> verify unified dashboard shows all activity
- [ ] Check medicine with missing manufacturer -> verify auto-filled from new data
- [ ] Run node scripts/quick-update.mjs to update knowledge graph

---

## PHASE 7: PER-DISTRIBUTOR LAYOUT LEARNING

**Time:** 2 hours
**Priority:** Medium impact — zero-configuration for new distributors
**Depends on:** Phase 5, Phase 6

### Problem Statement

The app has CSV/XLSX column learning per distributor, but NO text/PDF layout learning. New distributors always fail because their PDF layouts are not recognized. Missing fields (GST, batch, rate) break parsing completely.

### Root Causes

| # | Cause | File:Line | What Goes Wrong |
|---|---|---|---|
| 1 | No text layout storage | distributor_learning_profiles | Only stores CSV column mappings, not text layout patterns |
| 2 | Hardcoded parsers | emailService.ts:581,731 | Shriyash and Nitin are hardcoded, not generalized |
| 3 | No layout classifier | emailService.ts | No auto-detection of horizontal/vertical/concatenated |
| 4 | Missing fields break parsing | emailService.ts:525 | If GST/batch missing, entire line skipped |
| 5 | No confidence tracking | distributor_learning_profiles | No success count or accuracy score |

### How to Fix

| # | File | Line | Change |
|---|---|---|---|
| 1 | src/database.ts | 494 | Extend schema — add layout_type, layout_patterns, field_positions, missing_field_rules, success_count, last_success_at |
| 2 | src/services/emailService.ts | — | Save layout on success — after parse, store layout_type, regex patterns, field positions |
| 3 | src/services/emailService.ts | — | Use learned layout — on next email, load profile, apply patterns |
| 4 | src/services/emailService.ts | — | Handle missing fields — use missing_field_rules (GST default, batch generation, rate calculation) |
| 5 | frontend/src/pages/Learning/index.tsx | — | Add Layout Editor — show/edit layout type, field rules, missing field defaults |
| 6 | frontend/src/pages/Learning/index.tsx | — | Add Parse History — show last 5 successful parses |

### Schema Extension

`sql
ALTER TABLE distributor_learning_profiles ADD COLUMN layout_type TEXT;
ALTER TABLE distributor_learning_profiles ADD COLUMN layout_patterns TEXT; -- JSON
ALTER TABLE distributor_learning_profiles ADD COLUMN field_positions TEXT; -- JSON
ALTER TABLE distributor_learning_profiles ADD COLUMN missing_field_rules TEXT; -- JSON
ALTER TABLE distributor_learning_profiles ADD COLUMN success_count INTEGER DEFAULT 0;
ALTER TABLE distributor_learning_profiles ADD COLUMN last_success_at DATETIME;
`

### Missing Field Handling Rules

| Missing Field | Default Action | Profile Override |
|---|---|---|
| GST | Use 12% (most common pharma slab) | {gst_default: 18} |
| Batch | Generate from invoice_no + serial | {batch_prefix: B-IMPORT} |
| Rate | Calculate: rate = MRP / (1 + gst%/100) | {rate_calculation: from_mrp_and_gst} |
| MRP | Flag for review | — |
| Expiry | Flag for review | — |
| Quantity | Flag for review | — |

### How This Helps Other Phases

- Phase 5 (Email): Layout learning makes email parsing universal
- Phase 6 (Learning): Layout learning is part of the self-learning system
- Phase 2 (OCR): Layout-learned data validates OCR data

### Verification Checklist

- [ ] Parse invoice from new distributor -> verify layout_type detected and stored
- [ ] Parse same distributor invoice again -> verify learned layout applied
- [ ] Parse invoice with missing GST -> verify default GST applied
- [ ] Parse invoice with missing batch -> verify batch generated
- [ ] Check Learning page -> verify layout editor shows per-distributor patterns
- [ ] Check parse history -> verify last 5 parses displayed
- [ ] Run node scripts/quick-update.mjs to update knowledge graph

---

## PHASE 8: NOTIFICATION & COMMUNICATION FIXES

**Time:** 1 hour
**Priority:** Quick wins — fixing silent failures
**Depends on:** Phase 3

### Problem Statement

Multiple notification paths fail silently. Errors are swallowed. Special order notifications are never sent. Anti-duplicate suppression drops valid messages.

### Root Causes

| # | Cause | File:Line | What Goes Wrong |
|---|---|---|---|
| 1 | Error swallowing | sales.ts:458 | Fire-and-forget IIFE catches all errors |
| 2 | No item details in log | sales.ts:530 | Notification log has no medicine data |
| 3 | Anti-duplicate too aggressive | whatsappClient.ts:696 | 30-second window drops different messages |
| 4 | Null customerId | sales.ts:477 | Previous unpaid bills silently dropped |
| 5 | Bounce detection ignores loose | bouncedAlertService.ts | Only checks strips, not loose units |

### How to Fix

| # | File | Line | Change |
|---|---|---|---|
| 1 | src/routes/sales.ts | 458 | Log errors — add try/catch with error saved to automation_notifications |
| 2 | src/routes/sales.ts | 530 | Save details — include medicine names in automation_notifications.message |
| 3 | src/whatsappClient.ts | 696 | Reduce window — change from 30s to 5s for different message types |
| 4 | src/routes/sales.ts | 477 | Fix null customer — always resolve customer before building notification |
| 5 | src/services/bouncedAlertService.ts | — | Count loose — add loose stock to bounce detection query |

### How This Helps Other Phases

- Phase 3 (WhatsApp): Fixed error handling means failed notifications are visible
- Phase 6 (Learning): Notification logs with medicine details enable learning
- Phase 7 (Layout Learning): Accurate notification data validates parsed data

### Verification Checklist

- [ ] Send WhatsApp when disconnected -> verify error logged to automation_notifications
- [ ] Check notification log -> verify medicine names included
- [ ] Send 2 different messages within 5 seconds -> verify both delivered
- [ ] Save bill without customer -> verify no crash, graceful handling
- [ ] Check bounce detection -> verify loose stock counted
- [ ] Run node scripts/quick-update.mjs to update knowledge graph

---

## PHASE VERIFICATION PROTOCOL

### Before Each Phase

1. Read this plan — understand the cause, fix, and verification for the current phase
2. Read AGENTS.md — follow DOX hierarchy and editing rules
3. Read relevant source files — understand current code before modifying
4. Run node scripts/quick-update.mjs — ensure knowledge graph is current

### During Each Phase

1. Implement changes — follow the exact file/line references in the plan
2. Run linter/typecheck — npm run lint and npm run typecheck if available
3. Test each change — follow the verification checklist for the phase
4. Run node scripts/quick-update.mjs — update knowledge graph after each file change

### After Each Phase

1. Run full verification checklist — test ALL items in the phase
2. Run node scripts/quick-update.mjs — final knowledge graph update
3. Check for regressions — ensure previous phases still work
4. Update this plan — mark phase as complete with date
5. DO NOT proceed to next phase until verification passes

### Final Verification (After All Phases)

1. Run all 8 phase verification checklists — confirm everything passes
2. Test end-to-end flow:
   - Scan medicine -> verify all fields extracted
   - Save bill -> verify WhatsApp includes medicine details
   - Check stock -> verify correct counts
   - Send email from new distributor -> verify auto-parsed
   - Correct OCR scan -> verify learning saved
   - Check Learning page -> verify all data displayed
3. Run node scripts/quick-update.mjs — final knowledge graph update
4. Update AGENTS.md — document all changes
5. Finalize task — mark all phases complete

---

## DEPENDENCY MAP

`
Phase 1: Phone Cleanup
    |
Phase 2: OCR Data Quality
    |
Phase 3: WhatsApp Notifications ----> Phase 8: Notification Fixes
    |
Phase 4: Stock Check / Cart
    |
Phase 5: Email Reconciliation -----> Phase 7: Layout Learning
    |
Phase 6: Self-Learning Integration
`

### Critical Path

Phase 1 -> Phase 2 -> Phase 3 -> Phase 6 -> Phase 7

### Parallelizable Phases

- Phase 4 (Stock) can run in parallel with Phase 3 (WhatsApp)
- Phase 5 (Email) can run in parallel with Phase 4 (Stock)
- Phase 8 (Notifications) depends only on Phase 3

---

## APPENDIX: FILE REFERENCE

### Core Files to Modify

| File | Phases | Purpose |
|---|---|---|
| src/services/aiCameraService.ts | 2 | OCR processing, MRP/name extraction |
| src/routes/sales.ts | 3, 4, 8 | Bill save, WhatsApp notifications, stock check |
| src/services/emailService.ts | 5, 7 | Email parsing, layout learning |
| src/services/productNameFilterService.ts | 2, 6 | Medicine matching, learning |
| src/services/medicineService.ts | 6 | Medicine CRUD, auto-fill |
| src/routes/purchases.ts | 5 | Email reconciliation |
| src/services/refillService.ts | 4 | Refill stock check |
| src/routes/refills.ts | 4 | Refill panel |
| src/whatsappClient.ts | 8 | WhatsApp sending |
| src/routes/aiCamera.ts | 2 | Audit resolve |
| src/routes/learning.ts | 6 | Learning dashboard |
| src/database.ts | 7 | Schema extensions |
| frontend/src/pages/POS/index.tsx | 2, 4 | Cart, stock display |
| frontend/src/pages/Learning/index.tsx | 6, 7 | Learning UI |
| frontend/src/pages/Purchases/index.tsx | 1 | Phone input |
| frontend/src/pages/Dispatch/index.tsx | 1 | Phone input |
| pharmacy-mobile/app/(tabs)/billing/index.tsx | 1 | Phone input |
| src/routes/settings.ts | 1 | Phone storage |
| src/services/bouncedAlertService.ts | 8 | Bounce detection |

### Learning Tables

| Table | Current Use | After Plan |
|---|---|---|
| ocr_corrections | OCR text to medicine name | + bill confirmation, + usage stats |
| medicine_aliases | Global alias to medicine_id | + auto-fill from new data |
| distributor_medicine_aliases | Per-distributor alias | + bill confirmation |
| pharmacist_corrections | Search query to medicine_id | + unified learning dashboard |
| distributor_historical_files | CSV/XLSX headers + mapping | + text/PDF layout patterns |
| distributor_learning_profiles | CSV column mapping rules | + layout_type, layout_patterns, missing_field_rules |

### Estimated Time Summary

| Phase | Time | Priority |
|---|---|---|
| Phase 1: Phone Cleanup | 30 min | Quick win |
| Phase 2: OCR Data Quality | 2 hours | High impact |
| Phase 3: WhatsApp Notifications | 1.5 hours | High impact |
| Phase 4: Stock Check / Cart | 1.5 hours | Medium impact |
| Phase 5: Email Reconciliation | 3 hours | High impact |
| Phase 6: Self-Learning | 2 hours | Medium impact |
| Phase 7: Layout Learning | 2 hours | Medium impact |
| Phase 8: Notification Fixes | 1 hour | Quick wins |
| **Total** | **~14 hours** | |

---

> **END OF IMPLEMENTATION PLAN**
> Created: 2026-08-04
> Status: PLANNING — DO NOT IMPLEMENT UNTIL APPROVED
