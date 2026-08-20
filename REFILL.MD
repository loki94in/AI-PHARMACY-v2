# PHARMACY REFILL / PATIENT CRM - CURRENT LOGIC AUDIT + REQUIRED NEW WORKFLOW

## 1. CORE RULE

The application must treat the following as completely different entities:

1. PATIENT / CUSTOMER MASTER
2. REFILL SCHEDULE
3. REFILL OCCURRENCE / COMPLETION
4. SALES / BILL HISTORY
5. MEDICINE HISTORY
6. NEW MEDICINE ADDED TO AN EXISTING PATIENT
7. NEW REFILL SCHEDULE

NEVER mix these entities together.

MOST IMPORTANT DATA-INTEGRITY RULE:

    EXISTING PATIENT/CUSTOMER
        ↓
    MUST NEVER BE DELETED
    MUST NEVER BE RECREATED
    MUST NEVER BE DUPLICATED
    MUST NEVER HAVE UNRELATED FIELDS OVERWRITTEN
    MUST KEEP THE SAME PATIENT/CUSTOMER ID

The same rule applies to existing refill medicine records and historical sales.

Real data → process it.
Missing data → request/validate it.
Invalid data → reject it.
Never invent, duplicate, overwrite, or recreate existing data just to complete a workflow.


# 2. CURRENT LOGIC / CURRENT PROBLEM

The current application is behaving as if every refill cycle is a NEW refill/task.

Current behavior is effectively:

    Existing Patient
        ↓
    Existing Refill Medicines
        ↓
    User clicks Renew / Complete / creates another refill
        ↓
    Application creates another refill/task/medicine row
        ↓
    Old refill remains
        ↓
    New refill is added
        ↓
    CRM/Quick Assist groups both records together
        ↓
    User sees OLD + NEW medicines/tasks together

This creates duplicate-looking refill records for the same patient and medicine.

Example:

    Patient: Vivek Ingular

    Existing:
        GLEMPA 10
        ECOSPRIN GOLD
        MET XL
        SACU V 50

    User completes the refill.

Instead of:

    SAME REFILL RECORD
        ↓
    next_due_date = September
        ↓
    same medicine record

The current workflow can produce:

    OLD AUGUST REFILL
        +
    NEW SEPTEMBER REFILL

This is WRONG.

A recurring refill is a SCHEDULE.
It is NOT a new patient.
It is NOT a new medicine history record.
It is NOT a new customer record.
It is NOT a new duplicate refill row for every cycle.


# 3. REQUIRED DATA MODEL CONCEPT

The patient/customer must be the permanent parent record.

Conceptually:

    CUSTOMER / PATIENT
        │
        ├── Patient Master Data
        │
        ├── Contact Information
        │
        ├── Customer Credit / Account Information
        │
        ├── Sales History
        │
        ├── Refill History
        │
        ├── Active Refill Schedules
        │
        └── Medicine History


The Patient ID / Customer ID must remain permanent.

Example:

    patient_id = P001

That ID must continue to represent the same person forever.

Do NOT create:

    P001 → August
    P002 → September

for the same patient.

Instead:

    P001
      ├── August refill occurrence
      ├── September refill occurrence
      ├── October refill occurrence
      └── complete historical sales/refill history


# 4. CRM / CUSTOMER LIST UI

The CRM should have ONE side containing the patient/customer list.

Example:

    ┌──────────────────────────────┐
    │ SEARCH PATIENT / CUSTOMER    │
    ├──────────────────────────────┤
    │ Vivek Ingular                │
    │ Rahul Sharma                 │
    │ Amit Patil                   │
    │ ...                          │
    └──────────────────────────────┘

Each customer appears ONLY ONCE.

Do NOT create multiple customer rows because the patient has multiple refills.

Example:

    WRONG:

    Vivek Ingular - August
    Vivek Ingular - September
    Vivek Ingular - October

    CORRECT:

    Vivek Ingular


# 5. WHEN USER SELECTS A PATIENT

When the user selects:

    Vivek Ingular

the right/main panel should load ALL information belonging to that SAME patient.

The screen should contain sections such as:

    PATIENT / CUSTOMER DETAILS
    ──────────────────────────
    Name
    Phone
    WhatsApp
    Customer ID
    Credit / Account information
    Other existing patient fields


    ACTIVE REFILL SCHEDULES
    ────────────────────────
    Medicine
    Dose / strength
    Quantity
    Refill cycle
    Last fulfilled date
    Next due date
    Stock status
    Refill status


    CURRENT REFILL
    ──────────────
    Medicines currently due
    Medicines ready for sale
    Medicines needing order
    Medicines already fulfilled


    REFILL HISTORY
    ──────────────
    Previous refill dates
    Medicine
    Quantity
    Invoice / bill reference
    Completion status
    Next scheduled date


    SALES HISTORY
    ─────────────
    Previous invoices
    Sale dates
    Medicines purchased
    Quantities
    Bill amount
    Payment / credit information


IMPORTANT:

All of this information must come from the SAME patient/customer ID.

Do NOT create another patient/customer just because a new refill is created.


# 6. PATIENT MASTER DATA MUST NEVER BE TOUCHED BY REFILL OPERATIONS

Refill operations must NOT modify unrelated patient fields.

For example, if the patient already has:

    patient_id = P001
    name = Vivek Ingular
    phone = XXXXXXXXXX
    WhatsApp = XXXXXXXXXX
    credit_limit = existing value
    address = existing value

Then:

    Complete Refill
    Renew Refill
    Add Medicine
    Edit Refill
    Create New Refill
    Save POS Bill

must NOT:

    create another P001/P002 patient
    overwrite name
    overwrite phone
    overwrite WhatsApp
    overwrite credit information
    overwrite address
    delete patient data
    recreate the patient


Only explicitly requested patient-profile edits may modify patient master data.


# 7. EXISTING MEDICINE REFILL RECORDS MUST ALSO BE PRESERVED

Suppose Vivek already has:

    GLEMPA 10
    ECOSPRIN GOLD
    MET XL

These existing medicine schedules must remain untouched unless the user explicitly edits THAT medicine.

If the user adds:

    SACU V 50

the system must NOT rebuild the entire refill.

It must do:

    Existing GLEMPA
        → preserve existing record

    Existing ECOSPRIN
        → preserve existing record

    Existing MET XL
        → preserve existing record

    New SACU V 50
        → create ONLY the new medicine/refill record


# 8. ADDING A NEW MEDICINE

If the user selects:

    Add Medicine

the system must allow the user to add a medicine to the EXISTING patient.

Example:

    Patient:
        Vivek Ingular

    Existing:
        GLEMPA
        ECOSPRIN
        MET XL

    User adds:
        SACU V 50


The result must be:

    SAME PATIENT
        P001

    Existing records:
        GLEMPA      → unchanged
        ECOSPRIN    → unchanged
        MET XL      → unchanged

    New record:
        SACU V 50   → newly created


NEVER delete and recreate the existing medicines simply because one new medicine was added.


# 9. EDITING AN EXISTING MEDICINE

If the user edits only:

    MET XL

then ONLY the MET XL refill schedule may be updated.

Do NOT do:

    DELETE all patient medicines
    INSERT all medicines again


Instead:

    Find existing MET XL refill record
        ↓
    Validate requested changes
        ↓
    Update only allowed fields
        ↓
    Keep same refill ID


Example:

    Before:

    MET XL
    refill_id = R103
    cycle = 30 days
    next_due = 21 Aug


    User changes cycle to 60 days.


    After:

    MET XL
    refill_id = R103
    cycle = 60 days
    next_due = recalculated according to the new schedule


The refill ID remains the same.

Other medicines remain untouched.


# 10. CREATING A NEW REFILL

A NEW REFILL should only create NEW medicine schedule records.

It must NOT create a new patient.

Example:

    Existing patient:

        Vivek Ingular
        patient_id = P001

    Existing medicines:

        GLEMPA
        ECOSPRIN

    New refill adds:

        MET XL


Correct:

    P001
      ├── GLEMPA       existing
      ├── ECOSPRIN     existing
      └── MET XL       new


Incorrect:

    Create new patient P002
    Copy GLEMPA
    Copy ECOSPRIN
    Add MET XL


# 11. REFILL IS A RECURRING SCHEDULE

A refill record represents:

    Patient
    +
    Medicine
    +
    Refill Cycle
    +
    Schedule
    +
    Current Status


It does NOT represent only one historical event.

Example:

    refill_id = R001
    patient_id = P001
    medicine_id = M001
    cycle = 30 days


When August refill is completed:

    DO NOT CREATE R002.

Instead:

    R001
      last_fulfilled = August
      next_due = September
      status = scheduled


When September refill is completed:

    R001
      last_fulfilled = September
      next_due = October
      status = scheduled


The same recurring refill schedule continues.


# 12. REFILL COMPLETION WORKFLOW

When the user clicks:

    COMPLETE

from Quick Assist / Refill CRM:

DO NOT create another refill.

Workflow:

    Existing refill
        ↓
    Validate refill ID
        ↓
    Mark current occurrence as fulfilled
        ↓
    Record completion / fulfillment information
        ↓
    Calculate next scheduled date
        ↓
    UPDATE SAME REFILL RECORD
        ↓
    Reset current-cycle state
        ↓
    Show next upcoming due date


Example:

    Current:

        Medicine: GLEMPA
        Cycle: 30 days
        Due: 21 Aug 2026

    User clicks Complete.

    Result:

        Same refill_id
        Last fulfilled: 21 Aug 2026
        Next due: September 2026
        Status: Scheduled


Do NOT show:

    August completed
    +
    New September refill row


Show:

    GLEMPA
    Next Due: September 2026


# 13. POS / SALES ORDER INTEGRATION

The POS must be connected to the refill schedule.

If the user starts a sale from:

    CRM
      ↓
    Sell Now
      ↓
    POS

the existing refill ID should be passed into the POS.

Example:

    refill_id = R001

When the bill is saved:

    Invoice created
        ↓
    Refill ID R001 detected
        ↓
    R001 fulfillment completed
        ↓
    Same R001 updated
        ↓
    Next due date calculated


# 14. MANUAL POS SALE MUST ALSO SUPPORT REFILL RECONCILIATION

If the user opens POS directly and manually selects:

    Patient: Vivek Ingular

    Medicines:
        GLEMPA
        ECOSPRIN
        MET XL


After the bill is successfully saved, the application should check whether these medicines correspond to active refill schedules for the same patient.

Matching priority:

    1. Explicit refill_id
       ↓
    2. Same patient/customer
       +
       same medicine
       +
       active refill schedule
       +
       appropriate due/overdue window
       ↓
    3. If no valid match:
       ordinary sale only


Never mark an unrelated purchase as a refill completion.


# 15. MULTIPLE MEDICINES IN ONE BILL

Example:

    Patient: Vivek

    Existing refill schedules:

        GLEMPA       → R001
        ECOSPRIN     → R002
        MET XL       → R003

    POS invoice:

        GLEMPA
        ECOSPRIN
        MET XL
        Vitamin D


After saving:

    GLEMPA
        → fulfill R001

    ECOSPRIN
        → fulfill R002

    MET XL
        → fulfill R003

    Vitamin D
        → ordinary sale because no refill schedule exists


Then:

    R001 → next due date
    R002 → next due date
    R003 → next due date

NO NEW DUPLICATE REFILL ROWS.


# 16. SALES HISTORY MUST REMAIN SEPARATE

Historical bills must NEVER be deleted or replaced because a refill was completed.

Example:

    Invoice #1001
    21 Aug
    GLEMPA
    ECOSPRIN


This remains permanently in SALES HISTORY.

The refill schedule is separate:

    GLEMPA
    Last fulfilled: 21 Aug
    Next due: September


Therefore:

    SALES HISTORY
        = historical transaction record

    REFILL SCHEDULE
        = current recurring schedule

Do NOT use duplicate refill rows as a substitute for sales history.


# 17. REFILL HISTORY

If the application needs complete refill history, do NOT create duplicate active schedules.

Instead, maintain fulfillment/occurrence history.

Conceptually:

    REFILL SCHEDULE
        R001
        GLEMPA
        30-day cycle
        Current next due = September


    REFILL HISTORY

        R001
        Aug occurrence
        Completed
        Invoice #1001

        R001
        Sep occurrence
        Completed
        Invoice #1050

        R001
        Oct occurrence
        Pending


The schedule remains one persistent record.

The history contains the individual occurrences.


# 18. QUICK ASSIST UI

Quick Assist must be a VIEW of the existing refill schedules.

It must NOT create its own independent refill records.

When the patient is selected:

    Show current active schedules.

For each medicine show:

    Medicine
    Refill cycle
    Last fulfilled
    Next due
    Days remaining / overdue
    Stock
    Need Order
    Live Cart
    Sell Now
    Complete


After Complete:

    Immediately update the UI to the next due date.

Example:

    BEFORE:

    GLEMPA
    Due: 21 Aug 2026
    Due in 1 day


    AFTER COMPLETE:

    GLEMPA
    Next Due: September 2026
    Scheduled
    Due in X days


Do NOT leave the August task visible as an active task.


# 19. DUE DATE DISPLAY

The application should calculate and display:

    Due Today
    Due Tomorrow
    Due in X Days
    Overdue by X Days
    Next Month
    Next Scheduled Date


Example:

    Next Due: 21 Sep 2026

    Display:

    "Due in 32 days"

or, when appropriate:

    "Due: 21 Sep 2026"


The displayed date must always come from the current refill schedule stored in the database.


# 20. RENEW SCHEDULE BUTTON

RENEW SCHEDULE must NOT mean:

    Create another copy of this refill.

Instead it should mean:

    Continue / reactivate / advance the existing recurring schedule.


If the existing schedule is active:

    DO NOT create a duplicate.

If the schedule is paused:

    Reactivate the same schedule.

If the user explicitly wants a DIFFERENT medicine or DIFFERENT schedule:

    Create only the new schedule while preserving the old one.


# 21. PAUSE

Pause should update only the selected refill schedule.

Example:

    R001
    GLEMPA
    status = paused


It must NOT affect:

    patient profile
    other medicines
    other refill schedules
    sales history
    credit information


# 22. CANCEL

Cancel should cancel/deactivate only the selected refill schedule.

It must NOT delete:

    patient
    customer
    historical invoices
    previous refill occurrences
    other medicines


Historical data must remain available.


# 23. DATA UPDATE RULE

Every update must use the exact entity ID being changed.

Example:

    Updating patient:
        UPDATE patient WHERE patient_id = P001

    Updating refill:
        UPDATE refill WHERE refill_id = R001

    Updating medicine schedule:
        UPDATE refill WHERE refill_id = R001

    Creating new medicine:
        INSERT new refill only for new medicine

NEVER use:

    DELETE all patient's refill records
    THEN recreate them


NEVER use:

    DELETE patient
    THEN create patient again


NEVER copy old medicine records into a new refill just because another medicine was added.


# 24. DUPLICATE PREVENTION

Before creating a new refill schedule, check:

    same patient_id
    +
    same medicine_id
    +
    active schedule


If an active schedule already exists:

    DO NOT INSERT another one.

Instead:

    return/use the existing refill record.


If a new schedule is intentionally required, it must have a clearly different business reason and must not silently duplicate an existing active schedule.


# 25. PATIENT SELECTION MUST ALWAYS LOAD COMPLETE CONTEXT

When user selects:

    Vivek Ingular

load:

    Patient master data
    Customer/credit information
    Contact/WhatsApp information
    Active refill schedules
    Current due medicines
    Refill history
    Sales history
    Existing medicine schedules
    Pending/overdue refills
    Current cart/order information where applicable


All data must be connected through the existing patient/customer ID.


# 26. NEW MEDICINE MUST NEVER DAMAGE OLD MEDICINES

Example:

Existing:

    GLEMPA
    ECOSPRIN
    MET XL


User adds:

    SACU V 50


Result:

    GLEMPA       → unchanged
    ECOSPRIN     → unchanged
    MET XL       → unchanged
    SACU V 50    → new


If the user later edits SACU V 50:

    SACU V 50    → update only SACU record

Do NOT rebuild the patient refill list.


# 27. EXISTING MEDICINE EDIT MUST NEVER DAMAGE OTHER MEDICINES

Example:

    User edits GLEMPA cycle from 30 days → 60 days.


Only:

    GLEMPA refill record

may change.

The following must remain untouched:

    ECOSPRIN
    MET XL
    SACU V 50
    Patient details
    WhatsApp
    Phone
    Credit
    Sales history
    Previous refill history


# 28. DATABASE SAFETY REQUIREMENT

Before implementing changes, identify the actual relationships between:

    patients/customers
    patient_refills
    medicines
    sales/orders
    sale_items
    invoices
    refill fulfillment/history
    customer credit/account data


Do not guess field names.

Do not invent IDs.

Do not migrate or delete existing data blindly.

First inspect the existing schema and determine which existing records represent:

    Patient Master
    Refill Schedule
    Refill Occurrence
    Sales History


Then modify the workflow around the existing data model.


# 29. REQUIRED FINAL BEHAVIOR

The final workflow must behave like this:

    CUSTOMER/PATIENT
          │
          ▼
    SELECT PATIENT
          │
          ├── Patient Details
          ├── WhatsApp / Contact
          ├── Credit / Account
          ├── Sales History
          ├── Refill History
          └── Active Refill Schedules
                         │
                         ▼
                  SELECT MEDICINE
                         │
             ┌───────────┴───────────┐
             │                       │
       Existing Medicine        New Medicine
             │                       │
             ▼                       ▼
        EDIT SAME ID             CREATE NEW
             │                    REFILL ONLY
             │                       │
             └───────────┬───────────┘
                         ▼
                     SAVE
                         │
                         ▼
                SAME PATIENT ID
                PRESERVED
                         │
                         ▼
                  POS / SALES
                         │
                         ▼
                   BILL SAVED
                         │
                         ▼
              MATCH REFILL SCHEDULE
                         │
                         ▼
                COMPLETE OCCURRENCE
                         │
                         ▼
                UPDATE SAME REFILL
                         │
                         ▼
                CALCULATE NEXT DUE
                         │
                         ▼
                 SEPTEMBER DATE
                         │
                         ▼
              SAME REFILL ID CONTINUES


# 30. NON-NEGOTIABLE ACCEPTANCE CRITERIA

The implementation is NOT complete unless all of these are true:

[ ] Selecting a patient shows the complete patient context.

[ ] A patient/customer exists only once.

[ ] Existing patient ID is never recreated during refill operations.

[ ] Existing patient master fields are never changed by refill operations.

[ ] Existing medicine refill IDs remain unchanged when another medicine is added.

[ ] Adding a new medicine creates only the new medicine/refill record.

[ ] Editing one medicine updates only that medicine/refill record.

[ ] Existing medicines are never deleted and recreated during Edit.

[ ] Renew does not create duplicate active refill schedules.

[ ] Complete does not create a new refill row.

[ ] POS bill completion can fulfill the corresponding existing refill.

[ ] Quick Assist Complete and POS fulfillment use the same business logic.

[ ] Completing August changes the existing refill's next due date to September.

[ ] August does not remain as an active refill task after completion.

[ ] Sales history remains permanently available.

[ ] Refill history remains permanently available.

[ ] Multiple medicines in one bill can fulfill multiple existing refill schedules.

[ ] A medicine without a refill schedule remains an ordinary sale.

[ ] Unrelated purchases do not automatically complete refills.

[ ] Patient WhatsApp/contact/credit/account information remains untouched.

[ ] No existing historical data is deleted to implement the new workflow.

[ ] No dummy/duplicate data is generated.

[ ] Database state is the single source of truth after every operation.

[ ] UI must refresh from the server after completion rather than maintaining a separate fake refill state.


# FINAL BUSINESS RULE

ONE PATIENT/CUSTOMER = ONE PERMANENT MASTER RECORD.

ONE ACTIVE PATIENT + MEDICINE + RECURRING REFILL PLAN = ONE ACTIVE REFILL SCHEDULE.

ONE REFILL SCHEDULE CAN HAVE MANY COMPLETION OCCURRENCES.

ONE SALE/BILL IS A HISTORICAL TRANSACTION.

ADDING A NEW MEDICINE = ADD ONLY THE NEW MEDICINE.

EDITING A MEDICINE = UPDATE ONLY THAT MEDICINE.

COMPLETING A REFILL = COMPLETE THE CURRENT OCCURRENCE AND MOVE THE SAME REFILL SCHEDULE TO ITS NEXT DUE DATE.

NEVER CREATE A NEW PATIENT OR DUPLICATE OLD MEDICINES JUST TO REPRESENT THE NEXT REFILL CYCLE.

NEVER DELETE OR RECREATE EXISTING PATIENT, MEDICINE, SALES, CREDIT, WHATSAPP, CONTACT, OR HISTORICAL DATA AS PART OF A REFILL OPERATION.

PRESERVE ALL EXISTING DATA AND IDs.
UPDATE ONLY THE EXACT RECORD THAT THE USER ACTUALLY INTENDED TO CHANGE.
```
