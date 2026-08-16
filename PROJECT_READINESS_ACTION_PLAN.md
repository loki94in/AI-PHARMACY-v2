# PROJECT READINESS ACTION PLAN

> **Current Audit Status:** `PROJECT NOT READY`  
> **Target Status:** `PROJECT READY`  
> **Audit Version:** `15.0`  
> **Last Audit Date:** `2026-08-16`

This document lists everything required to transition **AI-PHARMACY-v2** from `PROJECT NOT READY` to `PROJECT READY`.

---

## 1. Code-Level Fix (1 Item)

### `COMP-02` — Compliance Generic `/add` Endpoint Hardcoded Schedule Type
* **Issue:** `POST /api/compliance/add` hardcodes `schedule_type = 'general'`, ignoring any incoming `schedule_type` in `req.body`. If non-general drugs (Schedule H, H1, X) are logged via this generic endpoint, their schedule category gets overwritten with `'general'`.
* **File:** `src/routes/compliance.ts` (Line 52)
* **What needs to be fixed:**
  Allow `req.body.schedule_type` to pass through dynamically with `'general'` only as a default fallback.
* **How to fix:**
  In `src/routes/compliance.ts`:
  ```typescript
  // Before:
  await db.run(
    'INSERT INTO compliance_logs (date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [date, product, patient_id, doctor_id, license_no, qty, bill_no, 'general']
  );

  // After:
  const resolvedSchedule = req.body.schedule_type || 'general';
  await db.run(
    'INSERT INTO compliance_logs (date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [date, product, patient_id, doctor_id, license_no, qty, bill_no, resolvedSchedule]
  );
  ```

---

## 2. Store Configuration & Operator Actions (6 Items)

### `SETTINGS-01` — Configure Pharmacy Store Profile
* **Issue:** If no store name is configured in `app_settings`, customer WhatsApp messages and report headers fall back to `"AI PHARMACY"`.
* **Location in App:** `Settings → Store Profile`
* **What needs to be fixed:** Set your real registered pharmacy name and contact number.
* **How to fix:**
  1. Navigate to **Settings** → **Store Profile**.
  2. Enter **Pharmacy / Shop Name** (e.g., *"Sharma Medical Store"*).
  3. Enter **Store Phone Number** and **Owner WhatsApp Number**.
  4. Click **Save Settings**.

---

### `COMP-01` — Fill Missing Doctor Registration Numbers
* **Issue:** Historical compliance records with the fake `"REG-NA"` placeholder had their licenses purged on startup (`missing_license = 1`, `license_no = NULL`) so they surface for audit instead of passing as verified.
* **Location in App:** `Compliance`
* **What needs to be fixed:** Replace missing licenses on Schedule H/H1 records with verified doctor registration numbers.
* **How to fix:**
  1. Navigate to **Compliance**.
  2. Look for entries flagged with **Missing Doctor License**.
  3. Click **Edit** on each flagged entry.
  4. Enter the doctor's legitimate State Medical Council registration number (e.g., `MCI-48291`).
  5. Click **Update Entry**.

---

### `MIG-01` — Clean / Link Migration Ghost Inventory Rows
* **Issue:** When legacy sales data was migrated without matching inventory records, placeholder batch rows (`batch_no = ""`, `quantity = 0`) were created to preserve relational integrity.
* **Location in App:** `Investigation Center → Inventory Ledger`
* **What needs to be fixed:** Link ghost batches to actual purchase invoices or remove orphaned stock references.
* **How to fix:**
  1. Navigate to **Investigation Center** → **Inventory Ledger**.
  2. Filter by Batch: enter `""` (blank) or search for `quantity = 0` ghost rows.
  3. Review the associated sales invoice and link to the legitimate purchase invoice batch if known.
  4. Clean up any unlinked orphan records that have no valid business trace.

---

### `DB-01` — Update Placeholder Customer Names
* **Issue:** When refills, held bills, or special orders were booked with a phone number but no patient name, customer master records were created with placeholder names (`"Walk-in Patient"` or `"Customer"`).
* **Location in App:** `CRM → Customers`
* **What needs to be fixed:** Update placeholder customer names with real patient identities.
* **How to fix:**
  1. Navigate to **CRM** → **Customers**.
  2. Search for `"Walk-in Patient"` and `"Customer"`.
  3. Edit each customer record and update the name field with the verified patient name.
  4. Ensure billing operators always enter patient names during sales and refills.

---

### `RET-01` — Always Select Explicit Return Reason
* **Issue:** Submitting a supplier return without selecting a reason causes the backend to record `"Supplier Return"` as a generic safety net, which may misrepresent damage or expiry returns.
* **Location in App:** `Supplier Returns`
* **What needs to be fixed:** Enforce selecting the exact reason during return entry.
* **How to fix:**
  1. Navigate to **Supplier Returns**.
  2. When creating a return, always choose the exact reason from the dropdown:
     - `Expiry`
     - `Damaged`
     - `Short Expiry`
     - `Supplier Return`
  3. Do not leave the reason field unselected.

---

### `WA-03` — Ensure Requester Names on Special Orders
* **Issue:** If a Special Order is saved without a requester name, automated WhatsApp order-ready messages greet the customer as *"Hi Customer,"*.
* **Location in App:** `CRM → Special Orders`
* **What needs to be fixed:** Ensure customer names are captured on all special orders.
* **How to fix:**
  1. Navigate to **CRM** → **Special Orders**.
  2. Review existing orders and edit any rows with empty requester fields to include the customer's name.
  3. When creating new special order requests, always fill the **Customer / Requester Name** field.

---

## 3. Verification & Readiness Sign-Off Checklist

Once the above items are complete:

- [ ] `COMP-02` code change applied to `src/routes/compliance.ts`.
- [ ] Store Profile name and contact configured in `Settings`.
- [ ] Flagged missing licenses reviewed in `Compliance`.
- [ ] Ghost inventory rows reviewed in `Investigation Center`.
- [ ] Customer placeholder names updated in `CRM`.
- [ ] Return reasons consistently selected in `Supplier Returns`.
- [ ] Special order requester names populated in `CRM`.

Open **`/audit`** in the application (**Audit Center**) to confirm the badge transitions to:

```
✅ PROJECT READY
```
