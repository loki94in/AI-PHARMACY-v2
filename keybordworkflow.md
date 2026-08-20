AI-PHARMACY-v2 — KEYBOARD-FIRST POS & PURCHASE NAVIGATION
===========================================================

OBJECTIVE
---------
Improve the POS and Purchase pages so a pharmacy user can complete
patient, doctor, medicine, quantity, billing, supplier and purchase
entries almost entirely from the keyboard, without repeatedly using
the mouse.

IMPORTANT:
- Do NOT create a completely new navigation architecture if an existing
  keyboard/focus system can be reused.
- First inspect the existing Quick Special Request popup because its
  Tab and Shift+Tab behaviour is already working correctly.
- Reuse the same proven focus/navigation principles in POS and Purchase.
- Do not break existing mouse interaction.
- Do not change existing business logic, API contracts, database logic,
  calculations, validation or save behaviour unless required specifically
  for keyboard navigation.
- The goal is UX/focus/navigation improvement, not a redesign of POS or
  Purchase.


===========================================================
1. CURRENT / EXISTING WORKFLOW TO AUDIT
===========================================================

Before changing anything, inspect the current implementation of:

POS:
- Patient selection
- Doctor selection
- Medicine search/autocomplete
- Medicine dropdown
- Quantity entry
- Medicine-row creation
- Billing/payment controls
- Save/complete bill controls
- Existing Tab behaviour
- Existing Enter behaviour
- Existing ArrowUp/ArrowDown behaviour
- Existing Shift+Tab behaviour
- Any modal/dialog focus handling

PURCHASE:
- Supplier selection
- Invoice number
- Invoice date
- Medicine search/autocomplete
- Batch
- Expiry
- Quantity
- Purchase Rate
- MRP
- QTY
- Free
- Next medicine row
- Save/submit controls
- Existing Tab behaviour
- Existing Enter behaviour
- Existing ArrowUp/ArrowDown behaviour
- Existing Shift+Tab behaviour

QUICK SPECIAL REQUEST POPUP:
- Inspect the existing working Tab behaviour.
- Inspect the existing working Shift+Tab behaviour.
- Identify how focus is assigned.
- Identify how focus is restored after closing the popup.
- Reuse the working approach where possible.


===========================================================
2. EXPECTED POS KEYBOARD WORKFLOW
===========================================================

When the user opens the POS page:

POS PAGE OPEN
     |
     v
PATIENT NAME FIELD
     |
     | Automatically focused
     v
User can immediately start typing
     |
     v
Patient autocomplete/dropdown
     |
     +---- ArrowDown --> next patient
     |
     +---- ArrowUp   --> previous patient
     |
     +---- Enter     --> select highlighted patient
     |
     v
DOCTOR NAME FIELD
     |
     | Automatically focused after patient selection
     v
User types/searches doctor
     |
     +---- ArrowDown --> next doctor
     |
     +---- ArrowUp   --> previous doctor
     |
     +---- Enter     --> select highlighted doctor
     |
     v
MEDICINE FIELD
     |
     | Automatically focused
     v
User types medicine name
     |
     v
Medicine dropdown opens
     |
     +---- ArrowDown --> next medicine
     |
     +---- ArrowUp   --> previous medicine
     |
     +---- Enter     --> select highlighted medicine
     |
     v
QTY FIELD
     |
     | Automatically focused
     v
User enters quantity
     |
     +---- Enter/Tab --> next logical medicine-entry position
     |
     v
NEXT MEDICINE ROW
     |
     v
MEDICINE FIELD automatically focused
     |
     v
User enters next medicine
     |
     v
QTY
     |
     v
NEXT MEDICINE
     |
     v
CONTINUE...


POS BASIC FLOW:

Patient
  ↓
Doctor
  ↓
Medicine
  ↓
Qty
  ↓
Next Medicine
  ↓
Medicine
  ↓
Qty
  ↓
Next Medicine
  ↓
...


===========================================================
3. POS BACKWARD NAVIGATION
===========================================================

Shift + Tab must move backwards through the same logical sequence.

Example:

Medicine Row 2 Qty
      |
      | Shift + Tab
      v
Medicine Row 2 Medicine
      |
      | Shift + Tab
      v
Medicine Row 1 Qty
      |
      | Shift + Tab
      v
Medicine Row 1 Medicine
      |
      | Shift + Tab
      v
Doctor
      |
      | Shift + Tab
      v
Patient


IMPORTANT:
- Shift+Tab must never jump to an unrelated button or UI element.
- Hidden/non-interactive elements must not enter the keyboard sequence.
- Disabled fields should be skipped where appropriate.
- Focus must remain predictable.


===========================================================
4. EXPECTED PURCHASE KEYBOARD WORKFLOW
===========================================================

The Purchase page must follow this exact logical sequence:

Supplier
   ↓
Invoice No.
   ↓
Invoice Date
   ↓
Medicine
   ↓
Batch
   ↓
Expiry
   ↓
Qty
   ↓
Purchase Rate
   ↓
MRP
   ↓
QTY
   ↓
Free
   ↓
Next Medicine


FULL PURCHASE FLOW:

PURCHASE PAGE OPEN
       |
       v
SUPPLIER
       |
       | User selects supplier
       | Dropdown can be navigated with ArrowUp/ArrowDown
       | Enter confirms selection
       v
INVOICE NO.
       |
       | Type invoice number
       | Tab/Enter → next
       v
INVOICE DATE
       |
       | Enter/select date
       | Tab/Enter → next
       v
MEDICINE
       |
       | Automatically focused
       |
       | User types medicine
       |
       v
MEDICINE DROPDOWN
       |
       +---- ArrowDown --> next result
       |
       +---- ArrowUp   --> previous result
       |
       +---- Enter     --> select highlighted medicine
       |
       v
BATCH
       |
       | Enter batch
       | Tab/Enter → next
       v
EXPIRY
       |
       | Enter/select expiry
       | Tab/Enter → next
       v
QTY
       |
       | Enter purchase quantity
       | Tab/Enter → next
       v
PURCHASE RATE
       |
       | Enter purchase rate
       | Tab/Enter → next
       v
MRP
       |
       | Enter MRP
       | Tab/Enter → next
       v
QTY
       |
       | Enter required QTY
       | Tab/Enter → next
       v
FREE
       |
       | Enter free quantity
       | Tab/Enter
       v
NEXT MEDICINE ROW
       |
       v
MEDICINE FIELD AUTO-FOCUSED
       |
       v
NEXT MEDICINE


PURCHASE CONTINUOUS ENTRY:

Medicine
  ↓
Batch
  ↓
Expiry
  ↓
Qty
  ↓
Purchase Rate
  ↓
MRP
  ↓
QTY
  ↓
Free
  ↓
Medicine
  ↓
Batch
  ↓
Expiry
  ↓
Qty
  ↓
Purchase Rate
  ↓
MRP
  ↓
QTY
  ↓
Free
  ↓
Medicine
  ↓
...


===========================================================
5. PURCHASE BACKWARD NAVIGATION
===========================================================

Shift + Tab must reverse the exact purchase sequence.

Example:

Free
  |
  | Shift + Tab
  v
QTY
  |
  | Shift + Tab
  v
MRP
  |
  | Shift + Tab
  v
Purchase Rate
  |
  | Shift + Tab
  v
Qty
  |
  | Shift + Tab
  v
Expiry
  |
  | Shift + Tab
  v
Batch
  |
  | Shift + Tab
  v
Medicine
  |
  | Shift + Tab
  v
Invoice Date
  |
  | Shift + Tab
  v
Invoice No.
  |
  | Shift + Tab
  v
Supplier


For multiple medicine rows:

Row 2 Free
   ↓ Shift+Tab
Row 2 QTY
   ↓
Row 2 MRP
   ↓
Row 2 Purchase Rate
   ↓
Row 2 Qty
   ↓
Row 2 Expiry
   ↓
Row 2 Batch
   ↓
Row 2 Medicine
   ↓ Shift+Tab
Row 1 Free
   ↓
...


===========================================================
6. KEYBOARD KEY CONTRACT
===========================================================

TAB
---
Normal field:
    Move to the next logical field.

Autocomplete field:
    If an item is highlighted/selected, confirm selection and move
    to the next logical field where appropriate.

SHIFT + TAB
-----------
Normal field:
    Move to the previous logical field.

Autocomplete:
    Must not cause unexpected focus jumps.
    Preserve predictable reverse navigation.

ENTER
-----
Normal text/input field:
    Move to the next logical field when appropriate.

Autocomplete/dropdown open:
    SELECT the currently highlighted item.
    Do NOT blindly move to another field before selecting the item.

After successful selection:
    Move focus to the next logical field.

ARROW DOWN
----------
Autocomplete/dropdown open:
    Highlight next result.

ARROW UP
--------
Autocomplete/dropdown open:
    Highlight previous result.

IMPORTANT:
ArrowUp/ArrowDown should primarily control dropdown selection when
a dropdown is open.

ESC
---
If autocomplete/dropdown is open:
    Close the dropdown without selecting an unintended item.

If a modal is open:
    Follow existing modal close/cancel behaviour.

Do not break existing Escape behaviour.


===========================================================
7. AUTOCOMPLETE BEHAVIOUR
===========================================================

Patient / Doctor / Medicine / Supplier autocomplete must behave
predictably.

Example:

User types:

    "para"

Dropdown:

    Paracetamol 500
    Paracetamol 650
    Paracetamol Suspension

Initial highlighted result:
    First valid result

ArrowDown:
    Highlight next result

ArrowDown:
    Highlight next result

ArrowUp:
    Highlight previous result

Enter:
    Select highlighted result

After selection:
    Dropdown closes
    Selected value is committed
    Next logical field receives focus

Escape:
    Dropdown closes
    Current input remains safe
    Do not accidentally select another item


===========================================================
8. AUTOMATIC FOCUS
===========================================================

POS:

When POS page opens:
    Automatically focus Patient Name.

Do NOT require:
    Mouse click → Patient field → start typing.

Expected:

Open POS
   ↓
Patient Name already focused
   ↓
User starts typing immediately


After Patient selection:

Patient
   ↓
Doctor automatically focused


After Doctor selection:

Doctor
   ↓
Medicine automatically focused


After Medicine selection:

Medicine
   ↓
Qty automatically focused


After Qty completion:

Qty
   ↓
New Medicine Row
   ↓
Medicine automatically focused


PURCHASE:

When Purchase page opens:
    Focus the first logical field according to the existing page
    workflow (normally Supplier).

After completing the header fields:

Supplier
   ↓
Invoice No.
   ↓
Invoice Date
   ↓
Medicine


After selecting medicine:

Medicine
   ↓
Batch


Then:

Batch
   ↓
Expiry
   ↓
Qty
   ↓
Purchase Rate
   ↓
MRP
   ↓
QTY
   ↓
Free
   ↓
Next Medicine


After Free:

Free
   ↓
New Medicine Row
   ↓
Medicine automatically focused


===========================================================
9. DYNAMIC MEDICINE ROW BEHAVIOUR
===========================================================

When the user completes the final field of a medicine row:

POS:
    Qty
       ↓
    Create/activate next medicine row
       ↓
    Focus Medicine input

PURCHASE:
    Free
       ↓
    Create/activate next medicine row
       ↓
    Focus Medicine input


IMPORTANT:
- Do not create duplicate rows.
- Do not create a new row merely because the user presses Tab repeatedly.
- Create/activate the next row only according to the existing application
  row-creation/business rules.
- Do not alter existing save/calculation behaviour.


===========================================================
10. MOUSE COMPATIBILITY
===========================================================

Keyboard-first does NOT mean mouse-disabled.

The user must still be able to:

- Click Patient
- Click Doctor
- Click Medicine
- Click dropdown result
- Click Qty
- Click Batch
- Click Expiry
- Click any existing action
- Click Save
- Click Cancel
- Click Payment
- Click Purchase actions

After mouse interaction, keyboard navigation must continue correctly
from the newly focused field.

Example:

User is typing Medicine
    ↓
Clicks dropdown result with mouse
    ↓
Medicine selected
    ↓
Qty automatically receives focus
    ↓
User continues using keyboard


===========================================================
11. MODAL / POPUP FOCUS
===========================================================

Use the existing Quick Special Request popup behaviour as the
reference implementation.

When a popup/modal opens:

    Save previous focused element
             ↓
    Focus first logical field in popup
             ↓
    Tab stays within popup according to existing behaviour
             ↓
    Shift+Tab moves backward
             ↓
    Close popup
             ↓
    Restore focus to the previous logical element


Do not allow background POS/Purchase controls to unexpectedly receive
focus while a modal is active.


===========================================================
12. IMPORTANT EDGE CASES
===========================================================

EDGE CASE 1:
No patient selected.

Expected:
    Do not incorrectly move to unrelated fields.
    Follow existing required-field validation.

EDGE CASE 2:
No doctor selected.

Expected:
    Follow existing application validation.
    Do not bypass required fields accidentally.

EDGE CASE 3:
Medicine search returns no result.

Expected:
    User can continue typing/editing.
    Do not automatically select an invalid result.

EDGE CASE 4:
Medicine dropdown is open and user presses Enter.

Expected:
    Select highlighted medicine.
    Then move to the next logical field.

EDGE CASE 5:
Medicine dropdown is open and user presses ArrowDown.

Expected:
    Move highlight only.
    Do not move form focus.

EDGE CASE 6:
User presses Shift+Tab from the first field.

Expected:
    Follow browser/application focus rules without jumping to an
    unrelated internal element.

EDGE CASE 7:
User presses Tab rapidly.

Expected:
    No duplicate medicine rows.
    No skipped required fields.
    No focus loss.

EDGE CASE 8:
User uses mouse after keyboard navigation.

Expected:
    Keyboard navigation remains functional.

EDGE CASE 9:
Validation error occurs.

Expected:
    Focus should move to the relevant invalid field where practical,
    instead of becoming lost.

EDGE CASE 10:
Dropdown is closed.

Expected:
    Arrow keys should follow the page's existing intended behaviour
    and must not interfere with text editing/cursor movement.

EDGE CASE 11:
Modal opens during entry.

Expected:
    Focus moves into modal and returns correctly after close.

EDGE CASE 12:
Last medicine row is incomplete.

Expected:
    Do not silently skip required fields or create confusing duplicate
    rows.


===========================================================
13. POS EXPECTED USER EXPERIENCE
===========================================================

The ideal pharmacy cashier experience should be:

OPEN POS
   ↓
Patient field already focused
   ↓
Type patient
   ↓
ArrowDown / ArrowUp
   ↓
Enter
   ↓
Doctor field
   ↓
Type doctor
   ↓
ArrowDown / ArrowUp
   ↓
Enter
   ↓
Medicine field
   ↓
Type medicine
   ↓
ArrowDown / ArrowUp
   ↓
Enter
   ↓
Qty
   ↓
Type quantity
   ↓
Enter
   ↓
Next Medicine
   ↓
Type medicine
   ↓
Enter
   ↓
Qty
   ↓
Enter
   ↓
Next Medicine
   ↓
...

The user should be able to perform normal high-volume medicine entry
without repeatedly reaching for the mouse.


===========================================================
14. PURCHASE EXPECTED USER EXPERIENCE
===========================================================

OPEN PURCHASE
   ↓
Supplier
   ↓
Invoice No.
   ↓
Invoice Date
   ↓
Medicine
   ↓
Batch
   ↓
Expiry
   ↓
Qty
   ↓
Purchase Rate
   ↓
MRP
   ↓
QTY
   ↓
Free
   ↓
Medicine
   ↓
Batch
   ↓
Expiry
   ↓
Qty
   ↓
Purchase Rate
   ↓
MRP
   ↓
QTY
   ↓
Free
   ↓
Medicine
   ↓
...


The operator should be able to enter a complete purchase invoice
continuously using the keyboard.


===========================================================
15. IMPLEMENTATION RULE
===========================================================

BEFORE MODIFYING CODE:

1. Inspect the latest AI-PHARMACY-v2 source.
2. Identify the actual POS page/component.
3. Identify the actual Purchase page/component.
4. Identify the actual medicine autocomplete implementation.
5. Identify patient autocomplete.
6. Identify doctor autocomplete.
7. Identify supplier autocomplete.
8. Identify medicine-row components.
9. Identify the Quick Special Request popup.
10. Identify how its working Tab/Shift+Tab behaviour is implemented.
11. Identify any existing reusable focus/navigation utilities.
12. Reuse existing patterns wherever possible.

DO NOT:
- Create an unrelated navigation framework.
- Duplicate existing autocomplete logic.
- Duplicate existing modal focus logic.
- Rewrite POS business logic.
- Rewrite Purchase business logic.
- Change database schema.
- Change API contracts.
- Change billing calculations.
- Change inventory calculations.
- Change purchase calculations.
- Remove working mouse interactions.
- Introduce unnecessary dependencies.


===========================================================
16. IMPLEMENTATION PRINCIPLE
===========================================================

The implementation should establish a clear logical focus order.

The DOM/tab order and application focus behaviour should match the
actual pharmacy workflow.

POS:

Patient
 → Doctor
 → Medicine
 → Qty
 → Medicine
 → Qty
 → ...


PURCHASE:

Supplier
 → Invoice No.
 → Invoice Date
 → Medicine
 → Batch
 → Expiry
 → Qty
 → Purchase Rate
 → MRP
 → QTY
 → Free
 → Medicine
 → Batch
 → Expiry
 → ...


Do not depend only on arbitrary DOM position if the UI contains
unrelated controls, hidden elements, icons, buttons or side panels.


===========================================================
17. VALIDATION / ACCEPTANCE TESTS
===========================================================

POS TEST:

[ ] Open POS.
[ ] Patient field automatically receives focus.
[ ] Type patient without clicking.
[ ] ArrowDown changes highlighted patient.
[ ] ArrowUp changes highlighted patient.
[ ] Enter selects patient.
[ ] Focus moves to Doctor.
[ ] Type doctor without mouse.
[ ] ArrowDown/ArrowUp navigate doctor results.
[ ] Enter selects doctor.
[ ] Focus moves to Medicine.
[ ] Type medicine.
[ ] ArrowDown/ArrowUp navigate medicine results.
[ ] Enter selects medicine.
[ ] Focus moves to Qty.
[ ] Enter/Tab completes quantity.
[ ] Next medicine row receives focus.
[ ] Medicine field is automatically focused.
[ ] Second medicine can be entered without mouse.
[ ] Shift+Tab moves backward correctly.
[ ] No unrelated UI element steals focus.
[ ] Mouse interaction still works.
[ ] Save/payment workflow remains unchanged.


PURCHASE TEST:

[ ] Open Purchase.
[ ] Supplier receives initial focus according to page workflow.
[ ] Supplier can be selected using keyboard.
[ ] Tab moves to Invoice No.
[ ] Enter/Tab moves to Invoice Date.
[ ] Enter/Tab moves to Medicine.
[ ] Medicine autocomplete works with ArrowUp/ArrowDown.
[ ] Enter selects medicine.
[ ] Focus moves to Batch.
[ ] Tab/Enter moves to Expiry.
[ ] Tab/Enter moves to Qty.
[ ] Tab/Enter moves to Purchase Rate.
[ ] Tab/Enter moves to MRP.
[ ] Tab/Enter moves to QTY.
[ ] Tab/Enter moves to Free.
[ ] Completing Free moves to next Medicine.
[ ] New medicine row is not duplicated.
[ ] Shift+Tab reverses the workflow.
[ ] Mouse interaction remains functional.
[ ] Existing purchase calculations remain unchanged.
[ ] Existing save/submit workflow remains unchanged.


REGRESSION TEST:

[ ] Quick Special Request popup still works.
[ ] Tab still works in popup.
[ ] Shift+Tab still works in popup.
[ ] Existing POS mouse workflow still works.
[ ] Existing Purchase mouse workflow still works.
[ ] Existing autocomplete selection still works.
[ ] Existing validation still works.
[ ] Existing billing still works.
[ ] Existing inventory updates still work.
[ ] Existing purchase stock updates still work.
[ ] No unrelated page navigation is affected.


===========================================================
18. FINAL SUCCESS CRITERIA
===========================================================

SUCCESS means:

A pharmacy operator can open POS and immediately type the patient name
without clicking the Patient field.

Then:

Patient
 → Doctor
 → Medicine
 → Qty
 → Next Medicine
 → Medicine
 → Qty
 → Next Medicine

can be completed almost entirely from the keyboard.

Similarly, Purchase can be completed as:

Supplier
 → Invoice No.
 → Invoice Date
 → Medicine
 → Batch
 → Expiry
 → Qty
 → Purchase Rate
 → MRP
 → QTY
 → Free
 → Next Medicine

with:

TAB       = forward navigation
SHIFT+TAB = backward navigation
ENTER     = confirm/select or advance when appropriate
ARROW UP  = previous dropdown result
ARROW DOWN= next dropdown result
ESC       = close/cancel dropdown where appropriate

The navigation must be predictable, fast, mouse-compatible and
consistent with the already-working Quick Special Request popup.

MOST IMPORTANT:
Do not implement this as a superficial "add tabindex everywhere" fix.
The final behaviour must follow the real pharmacy workflow and must
remain stable when medicine rows are dynamically added, dropdowns open,
validation errors occur, modals appear, or the user switches between
keyboard and mouse.