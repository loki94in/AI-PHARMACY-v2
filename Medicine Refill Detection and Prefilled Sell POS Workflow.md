# Medicine Refill Detection and Prefilled Sell POS Workflow

## Objective

When a medicine has previously been sold to a patient and the patient needs a refill/repeat sale, the application should identify the relevant previous sale from **Sell Bill History / Medicine Sales History**, use the existing patient information, and open the normal **Sell POS** page with the previous medicine details and quantities automatically prefilled.

The existing POS workflow must remain unchanged. This should behave like a **pre-filled POS transaction**, not a separate selling workflow.

---

## 1. How the App Determines That a Medicine Is Due for Refill

The application should not guess that a medicine is a refill merely because stock quantity increased or decreased.

Use existing **sales/bill history** as the primary source.

The app should check:

- Previous sell bills.
- Medicine sales history.
- Patient associated with the previous sale.
- Medicine/product sold.
- Previous quantity sold.
- Sale date.
- Distributor/product information where available.
- Current medicine/sales information.

### Refill identification

If a medicine was previously sold to the same patient and the medicine is eligible for another sale/refill, the application should identify that previous transaction as a potential refill.

The existing patient record should be reused.

---

# 2. Use Existing Patient Information

The user should not have to create or search for the patient again when the patient already exists.

If the previous sale contains the patient information:

- Reuse the existing patient.
- Load the patient's existing details.
- Preserve the existing patient ID/reference.
- Do not create a duplicate patient.
- Use the same patient information already available in the application.

The distributor/medicine section should therefore be able to identify:

**Patient → Previous Sale → Medicines Previously Sold**

---

# 3. Medicine Section → Sell Action

There is currently a problem when the user clicks **Sell** from the medicine section.

### Current behaviour

The application:

**Medicine → Sell → Redirects to Sell POS**

But after redirecting:

- The POS page does not show the previously saved medicine.
- Medicine list is empty.
- Quantity is not automatically populated.
- Patient information may not be carried over correctly.
- The user is forced to manually search and add the medicine again.

This is incorrect.

---

# 4. Required Sell POS Behaviour

When the user clicks **Sell** for a medicine where previous sale/patient information is available:

**Medicine Section**  
↓  
**Click Sell**  
↓  
**Open existing Sell POS**  
↓  
**Automatically load existing patient**  
↓  
**Automatically load selected medicine**  
↓  
**Automatically populate previous/relevant quantity**  
↓  
**User reviews/modifies if required**  
↓  
**Normal existing POS workflow**

The POS should behave exactly like the normal POS, except that the relevant information is already prefilled.

---

# 5. Medicine Must Be Automatically Added to POS

If the user clicks **Sell** on a specific medicine:

- That medicine must already appear in the POS medicine list.
- The correct medicine/product must be selected.
- The available medicine information must be populated from the existing product record.
- The quantity should be automatically populated based on the relevant previous sale/refill information.
- The user must be able to modify the quantity.
- The user must be able to remove the medicine if they do not want to sell it.
- The user must be able to add additional medicines normally.

### Important

Do not simply redirect the user to an empty POS.

The medicine that triggered the **Sell** action must be passed into the POS and displayed automatically.

---

# 6. Patient Must Be Automatically Selected

If the previous sale contains an existing patient:

- Automatically select that patient in POS.
- Load the existing patient record.
- Do not create a new patient.
- Preserve all existing patient details already stored in the system.

If the patient has multiple previous medicines, the system should use the relevant previous sales to determine which medicines can be displayed as refill/pre-filled items.

---

# 7. Quantity Handling

The previous sold quantity should be used as the default quantity where appropriate.

For example:

**Previous sale:**

Medicine A → 30 tablets

When the user selects Sell/Refill:

**POS:**

Medicine A → Quantity: 30

The user must be able to change:

`30 → 20`

or

`30 → 60`

before completing the sale.

The system must not lock the quantity.

---

# 8. Multiple Previous Medicines for the Same Patient

If the patient previously purchased multiple medicines and the application has sufficient sales history to identify them:

- Display the relevant medicines in the POS.
- Prefill their quantities based on the applicable previous sale.
- Allow the user to remove individual medicines.
- Allow the user to modify quantities.
- Allow the user to add new medicines.
- Keep the normal POS functionality available.

However, the application should **not blindly copy every historical medicine** into every refill.

Only medicines relevant to the current refill/sale should be prefilled.

---

# 9. Existing POS Workflow Must Remain Unchanged

This is critical.

The existing POS must continue to work exactly as it currently does.

The new functionality should only provide **initial/pre-filled data**.

After the POS opens:

- Existing medicine search works.
- Existing quantity editing works.
- Existing patient selection works.
- Existing discounts work.
- Existing billing works.
- Existing payment workflow works.
- Existing invoice generation works.
- Existing stock deduction works.
- Existing sale history continues to work.

The user should be able to modify the prefilled transaction exactly like a normal POS transaction.

### Principle

**Prefilled POS, not a new POS workflow.**

---

# 10. Data Flow

The intended data flow is:

**Medicine/Sales History**

→ Identify previous sale

→ Identify existing patient

→ Identify previously sold medicine

→ Retrieve previous quantity and relevant sale information

→ Pass patient + medicine + quantity into existing POS

→ POS opens with data prefilled

→ User reviews/modifies

→ Existing POS sale workflow completes the transaction

---

# 11. Avoid Full-Page Reloads Where Possible

When opening Sell POS:

- Pass the required patient and medicine references directly.
- Load the required data when the POS initializes.
- Do not force the user to manually search again.
- Do not reload unrelated medicine/distributor data unnecessarily.
- Do not create duplicate API calls if the required data is already available.
- Preserve the existing application navigation behaviour.

---

# 12. Duplicate Prevention

If the medicine is already present in the POS:

- Do not add the same medicine again.
- Update the existing medicine line if required.

If multiple previous sales contain the same medicine:

- Use the appropriate/latest relevant transaction.
- Do not create duplicate medicine lines from historical records.

---

# 13. Required Acceptance Criteria

### Refill Detection

- [x] Previous sell bills can be used to identify previously sold medicines.
- [x] Medicine sales history can be used as supporting data.
- [x] Existing patient information is reused.
- [x] Duplicate patients are not created.
- [x] The system does not rely only on stock quantity changes to determine a refill.

### Sell → POS

- [x] Clicking Sell from the medicine section opens the existing Sell POS.
- [x] The selected medicine automatically appears in POS.
- [x] Medicine details are populated.
- [x] Previous/relevant quantity is automatically populated.
- [x] Existing patient is automatically selected when available.
- [x] Patient details are preserved.
- [x] User can modify the medicine quantity.
- [x] User can remove the medicine.
- [x] User can add additional medicines.
- [x] Multiple relevant medicines can be prefilled when appropriate.

### Existing POS

- [x] Existing POS medicine search still works.
- [x] Existing patient selection still works.
- [x] Existing billing workflow still works.
- [x] Existing payment workflow still works.
- [x] Existing stock deduction still works.
- [x] Existing invoice generation still works.
- [x] Existing sales history still works.
- [x] Existing POS behaviour is not otherwise changed.

---

# Final Expected Behaviour

### Current Problem

**Medicine → Sell → POS opens → Medicine list empty → Quantity empty → User manually searches again**

### Required Behaviour

**Medicine/Sales History → Sell → Existing Patient Identified → Existing Medicine Identified → Existing Quantity Retrieved → Existing Sell POS Opens → Medicine + Patient + Quantity Already Prefilled → User Reviews/Modifies → Normal POS Sale**

The implementation must therefore **reuse the existing POS**, passing the relevant patient, medicine, and quantity into it rather than building a separate refill-selling process.