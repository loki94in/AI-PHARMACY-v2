# Patient Refill Panel: Grouped Multi-Medicine View, Auto Stock Pre-Check & Live-Cart Fallback

## Context

Investigation confirmed the backend automation for refills is already substantial:
- `patient_refills` table (`src/database.ts` ~line 147, extended ~lines 282-318) stores patient refill metadata: `patient_name, patient_phone, medicine_id, refill_interval_days, last_refill_date, next_refill_date, status, hold_for_stock, is_active, is_ready, acknowledged, ordering_triggered, quick_bill_id`.
- Two separate checking flows currently exist:
  1. `checkAllRefills(db)` in `src/services/refillService.ts` (runs daily via cron at 9:00 AM and catch-up on boot).
  2. `checkRefillsAndGenerateOrders()` in `src/services/orderFulfillmentService.ts` (runs every hour).
- Today these workflows are duplicated, run at different times, use slightly different parameters (e.g. 10 units vs 1 unit order quantities), and lack synchronization.
- **No dedicated frontend Refill Panel**: Only a list inside `AutomationCenter/index.tsx`. The user wants a dedicated Left-side panel and a Refill management page highlighting due patients, grouped by patient (one row per patient listing all their due medicines).
- **No configurable global lead time**: Currently hardcoded to 6 days (5 if Sunday).
- **No per-medicine stock-verified override**: Today the automation always trusts `inventory_master.quantity`. Pharmacists want a per-medicine, per-cycle override to physically confirm stock presence.
- **Tomorrow's Due Reminder Template**: If a patient's refill is due **tomorrow**, and the medicines have been checked (are in stock or override is verified), we show a manual send button in the Refill Panel to dispatch a tailored WhatsApp collection reminder.

## Proposed Changes

### Database

#### [MODIFY] [database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts)
- Add migration ALTER statement to add `stock_verified_override` to the `patient_refills` table:
  ```sql
  ALTER TABLE patient_refills ADD COLUMN stock_verified_override INTEGER DEFAULT 0
  ```

---

### Backend Services

#### [MODIFY] [refillService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/refillService.ts)
- Refactor `checkAllRefills(db)` to become the **single source of truth** for refill processing.
- Retrieve the configurable `refill_notice_days` (default `3` days) from `app_settings`.
- In `checkAllRefills`:
  - Calculate due lead time: `diffDays <= refill_notice_days`.
  - Check stock availability (`SUM(quantity)`) from `inventory_master` for the medicine.
  - If `qty > 0` OR `stock_verified_override = 1`:
    - Auto-create Quick Bill (held bill) if it does not exist yet.
    - Set `is_ready = 1`, `hold_for_stock = 0`, and link the `quick_bill_id`.
  - If `qty <= 0` AND `stock_verified_override = 0`:
    - Ensure a special order does not already exist for this patient/medicine before adding one.
    - Create a high-priority special order (source `refill`, quantity 10, priority `High`, status `Pending`, `pharmarack_mapped = 1`).
    - Set `hold_for_stock = 1`, `is_ready = 0`, `ordering_triggered = 1`.
    - Silent API post to add item to the Pharmarack cart (using `messagingQueue` or endpoint fetch).
- Clean up duplicate direct WhatsApp notification methods and utilize the unified `messagingQueue` where applicable.

#### [MODIFY] [orderFulfillmentService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/orderFulfillmentService.ts)
- Combine background check workflows: Refactor `checkRefillsAndGenerateOrders()` to dynamically import and call `checkAllRefills(db)`.
- Eliminate the duplicate stock-checking, update query, and special order insertion logic from `orderFulfillmentService.ts` to prevent status drifts or conflicting orders.

---

### Backend Routes

#### [MODIFY] [refills.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/refills.ts)
- Add new endpoints:
  - `GET /api/refills/panel`: Fetches the `refill_notice_days` setting. Selects all active `patient_refills` due within the notice days. Joins `medicines` and `inventory_master` (for `SUM(quantity)` as `in_stock_qty`). Groups server-side by `patient_phone` and returns grouped records: `{ patient_name, patient_phone, next_refill_date, medicines: [{ id, medicine_name, quantity_needed, in_stock_qty, stock_verified_override, acknowledged, hold_for_stock }] }`.
  - `POST /api/refills/:id/toggle-override`: Flips `stock_verified_override` (0 or 1). Re-runs `checkAllRefills` to refresh billing/ordering immediately.
  - `POST /api/refills/:id/fulfill`: Fulfills the current cycle: sets `last_refill_date = datetime('now')`, advances `next_refill_date` by `refill_interval_days`, resets `stock_verified_override = 0`, `ordering_triggered = 0`, `is_ready = 0`, and sets status back to `pending`.
  - `POST /api/refills/send-tomorrow-reminder`: Accept a patient's `patient_phone`. Retrieve all their pending, ready/verified refills due tomorrow. Formulate a consolidated message: *"Hello {patient_name}, this is a friendly reminder that your refill for {medicine_names} is due tomorrow. We have checked our stock and prepared it for you. Please collect it from {medical_name} at your convenience."*. Queue this via `messagingQueue` (or fallback WhatsApp client).

---

### Frontend Components

#### [NEW] [Refills index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Refills/index.tsx)
- Create a dedicated Refill management page.
- Lists grouped patient cards/rows with nested due medicines.
- Shows current stock levels versus needed quantities.
- Provides a checkbox to toggle the physical stock verification override (`stock_verified_override`).
- Provides a "Send to POS" button to trigger automated billing.
- Provides a "Add to Live Cart" button for out-of-stock items, opening the `LiveCartAddModal`.
- **WhatsApp Reminder Trigger**: If a patient has refills due tomorrow (and they are ready/verified), render a "Send WhatsApp Reminder" button. On click, call `POST /api/refills/send-tomorrow-reminder` and display a success toast.

#### [MODIFY] [Layout.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/Layout.tsx)
- Add a left-side compact Refills panel/widget showing upcoming due patients. Clicking a patient focuses them or navigates to the POS/Refills page.

#### [MODIFY] [AutomationCenter.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/AutomationCenter/index.tsx)
- Add a slider/input for the `refill_notice_days` global lead-time setting (saves to `POST /api/settings/save`).

#### [MODIFY] [POS index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx)
- **POS Handoff**: Read query/state parameters on mount (`medicine_id`, `patient_name`, `patient_phone`). Automatically pre-fill the customer details and add the medicine to the cart using the existing `addToCart` handler.
- **Name-Match Alert**: When typing a customer name, check against upcoming due refills. If there is a match, display an inline alert: *"XYZ has a pending refill for Amlodipine. Add to sale? [Accept] [Ignore]"*.
  - Clicking **Accept** adds the medicine and automatically triggers `/api/refills/:id/fulfill` on complete checkout.

---

## Verification Plan

### Automated Tests
- Run `npm test` (`tests/automation.test.ts`) to ensure refill cycles run and update correctly.
- Implement tests verifying `stock_verified_override` skips order generation.

### Manual Verification
1. Open the **Automation Center**, update refill lead time to 3 days, and verify it updates the DB.
2. Verify the **Refill Panel** groups items by patient phone.
3. Check the "Physical Stock Verified" override checkbox on an out-of-stock item: run a manual check and verify no special order or Pharmarack cart insertion occurs.
4. Select "Send to POS" and verify the cart and patient details pre-fill correctly.
5. Search a matching patient name in the POS search bar and verify the auto-suggest banner shows Accept/Ignore.
6. Verify clicking the "Send WhatsApp Reminder" button on a patient due tomorrow sends the consolidated reminder message format successfully.
