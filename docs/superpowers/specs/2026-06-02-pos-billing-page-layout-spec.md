# POS Billing Page: Page-wise Layout & Visual Specification

This document serves as the permanent visual and structural reference for the **AI Pharmacy POS Billing Main Counter** (Page 1: Sales). All future pages, sub-modules, and layout adjustments must align with these vertical and horizontal spacing conventions.

---

## 🖥️ Layout Wireframe (Console Block Representation)

```text
=========================================================================================================================
💊 AI PHARMACY POS  |  [🟢 ONLINE]                                                                              07:56 PM
=========================================================================================================================
👤 Pt: [Walk-in] | 📞: [9876543210] | 🥼 Dr: [Dr. Priya  ▼] | ⚪ [WA: OFF] | 📅: 2026-06-02
-------------------------------------------------------------------------------------------------------------------------
🔎 Search: [ search medicine by name, salts composition, batch...               ] [📷 AI SCAN (F9)]
-------------------------------------------------------------------------------------------------------------------------
🛒 CART (3 Items)                                                                   | 📷 CAMERA & SUGGESTIONS (1/4)
+---------------------------------------------------------------------------------+ | +-----------------------------+
| MEDICINE         | PACK SIZE | STRIPS  | LOOSE   | RETURN  | UNIT MRP | TOT (₹) | | | [📷] AI CAMERA PREVIEW      |
+---------------------------------------------------------------------------------+ | | +-------------------------+ |
| Dolo 650         | 15 Tab    |  [ 1 ]  |  [ 5 ]  |  [ 0 ]  | 2.00/Tab |   40.00 | | | |                         | |
| Pantocid 40      | 10 Tab    |  [ 2 ]  |  [ 0 ]  |  [ 0 ]  | 4.50/Str |   90.00 | | | |   [ LIVE OCR CAMERA ]   | |
| Okacet 10mg      | 10 Tab    |  [ 0 ]  |  [ 3 ]  |  [ 0 ]  | 3.50/Tab |   10.50 | | | |                         | |
+---------------------------------------------------------------------------------+ | | +-------------------------+ |
| [+ Add Med...  ] | [Pack   ] |  [ 0 ]  |  [ 0 ]  |  [ 0 ]  |          | [➕ Add]| | |-----------------------------|
+---------------------------------------------------------------------------------+ | | [🥼] DR. SUGGESTIONS          |
                                                                                    | | +-------------------------+ |
🧾 CHECKOUT                                                                         | | |                         | |
Subtotal: ₹130.50  |  Disc: [ 10 ]%  |  GST (12%): ₹14.05  |  TOTAL: ₹131.55        | | | • Ecosprin 75mg  [+ Add] | |
=================================================================================== | | | • Atorvas 10mg   [+ Add] | |
[🟢 COMPLETE SALE & DISPATCH (Ctrl+Enter)]   |   [F2] Search  [F4] Hold             | | |                         | |
=================================================================================== | | +-------------------------+ |
                                                                                    | +-----------------------------+
```

---

## 💎 Structural Design Standards

### 1. The Horizon Metadata Header Bar (Single-Row Alignment)
* **Rule:** All metadata parameters must share a single, horizontal flex row at the very top of the page.
* **Fields Included:** Patient profile `Pt`, 10-digit primary phone `No`, Doctor dropdown `Dr`, WhatsApp switch `WA`, and Date `📅`.
* **WhatsApp Default Rule:** The WhatsApp notifications toggle must start as **WA: OFF** for all new sales. It activates into a green glowing **WA: ON** state only upon explicit user opt-in click.
* **Format Sanitization:** Inputs under the 10-digit `📞 Phone` field are resolved silently on input, prepending the country code prefix (`91` for India) behind the scenes.

### 2. High-Density Billing Table & Loose Quantity Engine
* **Rule:** The cart table utilizes a 75% screen width split (3 out of 4 columns in the layout grid).
* **Loose Sales Fields:** Side-by-side columns are provided for Strips (full packs) and Loose Tablets.
* **Calculations Logic:** 
  $$\text{Unit Rate} = \frac{\text{Pack MRP}}{\text{Pack Size}}$$
  $$\text{Row Total} = (\text{Strips} \times \text{Pack MRP}) + (\text{Loose} \times \text{Unit Rate}) - (\text{Return} \times \text{Unit Rate})$$
* **Auto-Aggregation Logic:** If a cashier enters a loose quantity value exceeding the defined pack size, the state worker automatically increments the strip count and resets the loose units field to its mathematical remainder.

### 3. Symmetrical Widget Sidebar (1/4 Width Split)
* **Rule:** The final 1/4 screen width (25%) houses active, vertically stacked widgets.
* **Widgets Included:** **AI Camera Preview** and **Doctor Suggestions (Co-prescriptions)**.
* **Symmetry:** Both widget cards share identical height bounds and padding structures, creating vertical and horizontal balance across the POS console.

### 4. Inline Checkout summary
* **Rule:** Subtotals, custom discounts, tax divisions, and grand totals are placed inline in a horizontal flex panel at the bottom of the table area, preserving maximum listing space.
