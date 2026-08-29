============================================================
SINGLE IMPLEMENTATION PLAN
AI-PHARMACY-v2
AUTOMATIC WHATSAPP + PDF AFTER SAVE/COMPLETION
============================================================

IMPORTANT SCOPE RULE
============================================================

This is an implementation/completion plan for EXISTING application
behaviour.

The code agent MUST NOT invent or implement unrelated new features.

The code agent MUST:

1. Pull the latest repository before starting.
2. Inspect the current implementation.
3. Understand the existing save/completion flow.
4. Find the exact files responsible for each requested workflow.
5. Cross-check what is already implemented.
6. Modify ONLY what is required to achieve the requested behaviour.
7. Reuse existing WhatsApp queue, Automation Hub, PDF generation,
   notification, and deduplication systems wherever they already exist.
8. Keep the existing frontend UI unchanged.
9. Avoid unrelated refactoring.
10. Review the final git diff and remove every unrelated modification.

If a required behaviour already works correctly:

DO NOT MODIFY IT.

If an existing service already provides the required functionality:

DO NOT CREATE A DUPLICATE SERVICE.

The objective is:

SMALLEST REASONABLE CODE CHANGE
+
EXISTING ARCHITECTURE
+
EXISTING UI
+
REQUESTED AUTOMATIC BEHAVIOUR.

============================================================
1. REQUIRED FINAL BEHAVIOUR
============================================================

When the user completes an EXISTING transaction/action, the
application must automatically start the existing WhatsApp workflow.

The user must NOT need to manually click a separate
"Send WhatsApp" button afterward.

Applicable existing workflows include:

- Sell / billing.
- Direct Save.
- Save & Print.
- Ctrl+S save.
- Credit refill.
- Special Request.
- Special Order.
- Order completion.
- Other existing workflows which already have a WhatsApp message
  requirement.

The exact list must be verified against the current repository.

DO NOT create new business workflows.

============================================================
2. CURRENT BEHAVIOUR
============================================================

Current application behaviour must be traced from the actual code.

The existing flow may currently be similar to:

USER COMPLETES TRANSACTION
        ↓
SAVE / COMPLETE
        ↓
TRANSACTION CREATED
        ↓
USER MANUALLY CLICKS WHATSAPP SEND
        ↓
MESSAGE SENT

Or some workflows may already automatically send WhatsApp.

The code agent MUST NOT assume that every workflow behaves the same.

Instead:

TRACE EACH WORKFLOW.

Determine:

- Does save already trigger WhatsApp?
- Does Save & Print already trigger WhatsApp?
- Does Ctrl+S use the same handler?
- Does Credit Refill already trigger WhatsApp?
- Does Special Request completion already trigger WhatsApp?
- Does Special Order completion already trigger WhatsApp?
- Is PDF already generated?
- Is PDF already passed to the queue?
- Is Automation Hub already updated?
- Is manual Send still required?

Then modify only the workflows where the requested automatic behaviour
is missing or incorrect.

============================================================
3. EXPECTED FINAL FLOW
============================================================

The final expected behaviour is:

USER CLICKS EXISTING ACTION
        ↓
Direct Save
OR
Save & Print
OR
Ctrl+S
OR
existing completion action
        ↓
EXISTING VALIDATION
        ↓
TRANSACTION SUCCESSFULLY SAVED/COMPLETED
        ↓
EXISTING WHATSAPP REQUIREMENT CHECK
        ↓
GET CUSTOMER / DISTRIBUTOR WHATSAPP NUMBER
        ↓
USE EXISTING PDF GENERATION/RETRIEVAL
        ↓
MESSAGE + PDF
        ↓
EXISTING WHATSAPP QUEUE
        ↓
EXISTING AUTOMATION HUB
        ↓
EXISTING PROGRESS
        ↓
EXISTING 10 → 0 SECOND COUNTDOWN
        ↓
AUTOMATIC WHATSAPP SEND
        ↓
SENT / FAILED
        ↓
RESULT STORED IN EXISTING SYSTEM.

============================================================
4. SAVE SUCCESS MUST COME FIRST
============================================================

WhatsApp must NOT be triggered before the transaction is successfully
saved.

Correct:

SAVE
↓
SAVE SUCCESS
↓
GET CREATED TRANSACTION ID
↓
GENERATE/GET RELATED PDF
↓
QUEUE WHATSAPP.

Incorrect:

USER CLICKS SAVE
↓
START WHATSAPP
↓
SAVE FAILS.

The transaction must exist before its WhatsApp message/document is
queued.

============================================================
5. DIRECT SAVE
============================================================

Cross-check the existing Direct Save handler.

Expected:

USER CLICKS DIRECT SAVE
        ↓
Existing validation
        ↓
Existing save logic
        ↓
Save successful
        ↓
Existing transaction/bill ID available
        ↓
Existing PDF generation
        ↓
Existing WhatsApp queue
        ↓
Automation Hub
        ↓
Automatic send.

The user must not have to click Send WhatsApp.

If this already works correctly:

DO NOTHING.

============================================================
6. SAVE & PRINT
============================================================

Cross-check the existing Save & Print handler.

Expected:

USER CLICKS SAVE & PRINT
        ↓
Existing save
        ↓
Save successful
        ↓
Existing print behaviour
        ↓
Existing PDF/document
        ↓
Existing WhatsApp queue
        ↓
Automation Hub
        ↓
Automatic send.

Printing must continue to work exactly as it currently does.

Do NOT remove or redesign printing.

Do NOT change the user's existing print experience.

The WhatsApp operation is an additional background action using the
existing infrastructure.

============================================================
7. CTRL+S
============================================================

Cross-check the keyboard shortcut implementation.

If Ctrl+S already calls the same existing save handler:

DO NOT create another handler.

The expected result is simply:

Ctrl+S
↓
Existing Save/Save & Print logic
↓
Successful transaction
↓
Automatic WhatsApp.

If Ctrl+S bypasses the normal save handler:

Fix only the relevant keyboard/save connection.

Do NOT duplicate the complete save process.

============================================================
8. CREDIT REFILL
============================================================

Cross-check the existing Credit Refill completion flow.

Expected:

CREDIT REFILL COMPLETED
        ↓
Existing save/completion successful
        ↓
Existing refill PDF if applicable
        ↓
Existing WhatsApp queue
        ↓
Automation Hub
        ↓
Automatic WhatsApp send.

Use the existing refill PDF.

Do NOT create another refill PDF generator.

Do NOT create another WhatsApp sender.

============================================================
9. SPECIAL REQUEST / SPECIAL ORDER
============================================================

Cross-check the existing Special Request / Special Order completion
flow.

Expected:

ORDER COMPLETED
        ↓
Existing save/completion successful
        ↓
Existing related PDF if applicable
        ↓
Existing WhatsApp queue
        ↓
Automation Hub
        ↓
Automatic WhatsApp send.

Only implement this connection if the existing completion flow does
not already provide it.

============================================================
10. ALL OTHER EXISTING WHATSAPP WORKFLOWS
============================================================

The agent must audit the existing relevant workflows.

Examples:

- POS Ready.
- Dispatch.
- Distributor Dispatch Reminder.
- Customer Reminder.
- Order Ready.
- Mark Ready.
- Refill Reminder.
- Credit Reminder.
- Monthly Credit/Billing.
- Send All via WhatsApp.
- Cart sharing.
- Medicine list sharing.

The purpose of this audit is NOT to add new WhatsApp functionality.

The purpose is only to verify that existing WhatsApp workflows use
the existing central infrastructure consistently.

If a workflow already works:

DO NOTHING.

If it is broken or incomplete:

FIX ONLY THAT EXISTING PATH.

============================================================
11. PDF ATTACHMENT
============================================================

When an existing workflow has a related PDF/document, the automatic
WhatsApp operation must use the correct existing document.

Expected:

TRANSACTION
        ↓
EXISTING PDF GENERATOR
        ↓
PDF
        ↓
MESSAGE + PDF
        ↓
EXISTING WHATSAPP QUEUE.

The user must not manually attach the PDF.

Do not create a new PDF generation architecture.

Use the existing PDF service/generator.

============================================================
12. TRANSACTION/PDF MATCHING
============================================================

The PDF must belong to the exact transaction that generated the
message.

Example:

BILL #1001
↓
PDF FOR BILL #1001
↓
CUSTOMER A
↓
WHATSAPP MESSAGE FOR CUSTOMER A.

Never use:

- Latest PDF.
- Current selected PDF.
- Global PDF variable.
- Unrelated customer's PDF.

Use the existing transaction identifiers.

============================================================
13. AUTOMATION HUB
============================================================

Every automatically generated WhatsApp operation must appear in the
EXISTING Automation Hub.

The user should see the existing operation without needing to open
another screen.

Expected:

SAVE SUCCESS
↓
WHATSAPP QUEUED
↓
AUTOMATION HUB ENTRY
↓
PROGRESS
↓
COUNTDOWN
↓
SENT / FAILED.

Do not create a new Automation Hub.

Do not create a new header.

Do not redesign the existing Automation Hub.

============================================================
14. EXISTING PROGRESS
============================================================

Reuse the existing progress system.

Expected existing behaviour:

QUEUED
↓
PROCESSING
↓
0–100% PROGRESS
↓
10 → 0 SECOND COUNTDOWN
↓
SEND
↓
SUCCESS/FAILURE.

Do not create another progress component.

Do not add a second countdown.

============================================================
15. SILENT BACKGROUND OPERATION
============================================================

The automatic WhatsApp send should happen in the background.

The user should be able to continue working.

Example:

User clicks:

DIRECT SAVE

The bill saves.

Then:

Automation Hub:
"WhatsApp sending..."

The user does NOT need to:

- Click WhatsApp.
- Click Send.
- Attach PDF.
- Open WhatsApp manually.

============================================================
16. FAILURE HANDLING
============================================================

If automatic WhatsApp sending fails, the existing failure system must
capture it.

Examples:

- WhatsApp offline.
- WhatsApp unavailable.
- Number missing.
- Invalid number.
- Number not registered with WhatsApp.
- PDF generation failure.
- PDF missing.
- PDF attachment failure.
- Send timeout.
- Queue failure.

The exact error available from the existing WhatsApp layer should be
stored and displayed.

Do not replace it with a generic message.

============================================================
17. FAILURE AFTER SAVE
============================================================

Important:

A WhatsApp failure must NOT undo a successfully saved transaction.

Correct:

SAVE SUCCESS
↓
WHATSAPP FAILS
↓
BILL REMAINS SAVED
↓
AUTOMATION HUB SHOWS FAILED
↓
USER CAN SEE THE REASON.

Do NOT roll back a successful bill simply because WhatsApp is offline.

============================================================
18. PDF FAILURE AFTER SAVE
============================================================

If the existing workflow requires a PDF:

SAVE SUCCESS
↓
PDF GENERATION FAILS
↓
WHATSAPP OPERATION FAILS/REMAINS UNFULFILLED
↓
ACTUAL PDF ERROR STORED
↓
AUTOMATION HUB SHOWS FAILURE.

Do not silently pretend that the message was successfully sent with
a missing required document.

However, do not invent a mandatory PDF requirement for an existing
workflow that does not require one.

============================================================
19. DUPLICATE SEND PROTECTION
============================================================

This is critical.

The same transaction must not generate duplicate WhatsApp messages
because the user:

- Clicks Save & Print.
- Uses Ctrl+S.
- Retries after a UI event.
- Performs an existing save action more than once.

Use the existing queue/deduplication mechanism.

Do NOT create another deduplication system unless the existing one
cannot handle the specific case.

The agent must first inspect how the current queue identifies
duplicates.

============================================================
20. MANUAL SEND BUTTON
============================================================

DO NOT REMOVE OR CHANGE existing UI unless the current requirement
specifically requires it.

The requirement is:

THE USER SHOULD NOT NEED TO CLICK THE MANUAL SEND BUTTON AFTER
SUCCESSFULLY SAVING/COMPLETING THE TRANSACTION.

If the existing button remains visible because it serves another
existing workflow:

leave it unchanged.

Do not redesign the interface.

============================================================
21. FILE-LEVEL CROSS-CHECK
============================================================

Before coding, the agent must map:

ACTION
→ HANDLER
→ SERVICE
→ TRANSACTION SAVE
→ PDF
→ WHATSAPP QUEUE
→ AUTOMATION HUB.

For example:

SELL SAVE
→ existing sales save handler
→ existing invoice service
→ existing PDF service
→ existing WhatsApp queue
→ existing Automation Hub.

CREDIT REFILL
→ existing refill handler
→ existing refill service
→ existing refill PDF
→ existing WhatsApp queue
→ existing Automation Hub.

SPECIAL ORDER
→ existing order completion handler
→ existing order/PDF service
→ existing WhatsApp queue
→ existing Automation Hub.

The actual filenames must be discovered from the current repository.

Do not invent filenames.

============================================================
22. FILE MODIFICATION RULE
============================================================

ONLY MODIFY FILES DIRECTLY RELATED TO THE REQUEST.

Possible areas:

- Existing POS/sales save handler.
- Existing Save & Print handler.
- Existing keyboard shortcut handler if required.
- Existing Credit Refill completion handler.
- Existing Special Request/Order completion handler.
- Existing WhatsApp queue integration.
- Existing PDF integration.
- Existing Automation Hub integration.

Do not modify unrelated files.

============================================================
23. NEW FILE RULE
============================================================

Do NOT create new files unless absolutely necessary.

First determine whether the existing responsible file/service can
perform the required connection.

If an existing service already supports:

- WhatsApp queueing.
- PDF attachment.
- Automation Hub.
- Failure handling.

reuse it.

A new file is justified only if the current architecture genuinely
cannot support the requested existing behaviour without creating
duplication or an unmaintainable change.

If no new file is required:

CREATE NO NEW FILE.

============================================================
24. NO FRONTEND UI CHANGE
============================================================

Strict requirement:

DO NOT change the existing frontend UI.

No:

- New buttons.
- New panels.
- New pages.
- New modals.
- New layouts.
- New WhatsApp controls.
- New PDF controls.
- New Automation Hub design.

The existing UI remains exactly as it is.

Only the underlying event/action flow is corrected.

============================================================
25. NO NEW FEATURES
============================================================

The code agent MUST NOT implement anything that is not required by
this plan.

Do not add:

- New WhatsApp message types.
- New reminder types.
- New billing workflows.
- New PDF formats.
- New automation types.
- New notification systems.
- New settings.
- New reports.
- New dashboards.
- New database structures without necessity.
- New UI features.
- New integrations.

If the agent notices another possible improvement:

DO NOT IMPLEMENT IT.

It may be noted separately, but it must not be included in this
change.

============================================================
26. IMPLEMENTATION ORDER
============================================================

STEP 1
Pull the latest main branch.

STEP 2
Confirm the exact current commit.

STEP 3
Inspect today's/latest relevant commits.

STEP 4
Find all existing save/completion handlers.

STEP 5
Find Direct Save.

STEP 6
Find Save & Print.

STEP 7
Find Ctrl+S.

STEP 8
Find Credit Refill completion.

STEP 9
Find Special Request/Order completion.

STEP 10
Find existing WhatsApp queue entry points.

STEP 11
Find existing PDF generators.

STEP 12
Find existing Automation Hub event creation.

STEP 13
Map each workflow.

STEP 14
Mark each as:

ALREADY WORKING
PARTIAL
BROKEN
MISSING.

STEP 15
DO NOTHING to ALREADY WORKING workflows.

STEP 16
Fix only PARTIAL/BROKEN/MISSING behaviour that belongs to this plan.

STEP 17
Reuse existing services.

STEP 18
Run tests/build/typecheck.

STEP 19
Cross-check every requested workflow.

STEP 20
Review git diff.

STEP 21
Remove unrelated changes.

============================================================
27. REQUIRED CROSS-CHECK MATRIX
============================================================

The agent must internally produce:

------------------------------------------------------------
WORKFLOW: SELL / DIRECT SAVE
------------------------------------------------------------

Current:
[inspect]

Save handler:
[inspect]

PDF:
[inspect]

WhatsApp:
[inspect]

Automation Hub:
[inspect]

Required modification:
[only if necessary]

------------------------------------------------------------
WORKFLOW: SELL / SAVE & PRINT
------------------------------------------------------------

Current:
[inspect]

Save handler:
[inspect]

Print handler:
[inspect]

PDF:
[inspect]

WhatsApp:
[inspect]

Required modification:
[only if necessary]

------------------------------------------------------------
WORKFLOW: CTRL+S
------------------------------------------------------------

Current:
[inspect]

Handler:
[inspect]

Does it use the same save path?
[YES/NO]

Required modification:
[only if necessary]

------------------------------------------------------------
WORKFLOW: CREDIT REFILL
------------------------------------------------------------

Current:
[inspect]

Completion:
[inspect]

PDF:
[inspect]

WhatsApp:
[inspect]

Required modification:
[only if necessary]

------------------------------------------------------------
WORKFLOW: SPECIAL REQUEST/ORDER
------------------------------------------------------------

Current:
[inspect]

Completion:
[inspect]

PDF:
[inspect]

WhatsApp:
[inspect]

Required modification:
[only if necessary]

============================================================
28. TEST: DIRECT SAVE
============================================================

Test:

Open existing Sell/POS flow.

Complete a valid bill.

Click:

DIRECT SAVE.

Expected:

Bill saves successfully.
↓
PDF is handled through existing implementation where applicable.
↓
WhatsApp queue receives the message.
↓
Automation Hub shows it.
↓
Countdown/progress works.
↓
WhatsApp automatically sends.
↓
No manual Send click required.

============================================================
29. TEST: SAVE & PRINT
============================================================

Complete valid bill.

Click:

SAVE & PRINT.

Expected:

Bill saves.
↓
Existing print behaviour works.
↓
WhatsApp automatically queues.
↓
Automation Hub shows activity.
↓
PDF is attached where applicable.
↓
WhatsApp sends automatically.

No UI redesign.

============================================================
30. TEST: CTRL+S
============================================================

Complete valid bill.

Use:

CTRL+S.

Expected:

Same intended save behaviour.

The WhatsApp operation must not be skipped merely because the
transaction was saved through the keyboard shortcut.

============================================================
31. TEST: CREDIT REFILL
============================================================

Complete valid credit refill.

Expected:

Refill saved.
↓
Existing PDF generated/retrieved where applicable.
↓
WhatsApp queued.
↓
Automation Hub updated.
↓
Automatic send.

No manual Send click.

============================================================
32. TEST: SPECIAL ORDER
============================================================

Complete existing special order/request.

Expected:

Order successfully completed.
↓
Existing PDF if applicable.
↓
WhatsApp queued.
↓
Automation Hub.
↓
Automatic send.

============================================================
33. TEST: WHATSAPP OFFLINE
============================================================

Disconnect/disable WhatsApp.

Complete a valid transaction.

Expected:

Transaction remains successfully saved.

WhatsApp:

FAILED / appropriate existing waiting state.

Automation Hub:

Shows failure/reason.

No silent failure.

No transaction rollback.

============================================================
34. TEST: NUMBER NOT REGISTERED
============================================================

Use an existing customer number that is not registered on WhatsApp.

Complete transaction.

Expected:

Transaction saves.

WhatsApp operation fails.

Automation Hub shows the actual available reason.

The failure remains visible through the existing notification/history
system.

============================================================
35. TEST: PDF FAILURE
============================================================

Force the existing PDF generation path to fail in a safe test
environment.

Expected:

If PDF is required:

WhatsApp operation must not falsely appear successful.

The failure reason must be retained.

============================================================
36. TEST: DUPLICATE SAVE EVENT
============================================================

Verify that one transaction does not accidentally create multiple
identical WhatsApp operations because of:

- Save.
- Save & Print.
- Ctrl+S.
- Existing event handlers.

Use existing queue/deduplication logic.

Expected:

ONE intended transaction
→ ONE intended WhatsApp operation.

============================================================
37. FINAL GIT DIFF REVIEW
============================================================

After implementation:

Review every changed file.

For every changed file ask:

"Is this file directly responsible for the requested automatic
WhatsApp/PDF behaviour?"

If NO:

REVERT IT.

For every new function ask:

"Was this required to achieve the requested behaviour?"

If NO:

REMOVE IT.

For every new file ask:

"Was this genuinely necessary?"

If NO:

REMOVE IT.

For every UI modification ask:

"Was this explicitly requested?"

If NO:

REVERT IT.

============================================================
38. FINAL OLD VS NEW BEHAVIOUR
============================================================

OLD BEHAVIOUR:

USER COMPLETES BILL
        ↓
CLICK DIRECT SAVE / SAVE & PRINT
        ↓
TRANSACTION SAVES
        ↓
USER MAY NEED TO MANUALLY CLICK
WHATSAPP SEND
        ↓
MESSAGE SENT
        ↓
PDF MAY ALREADY BE AVAILABLE
DEPENDING ON WORKFLOW
        ↓
USER HAS TO INTERACT AGAIN.


NEW BEHAVIOUR:

USER COMPLETES BILL
        ↓
CLICK DIRECT SAVE
OR
SAVE & PRINT
OR
CTRL+S
        ↓
TRANSACTION SAVES SUCCESSFULLY
        ↓
EXISTING PDF HANDLING
        ↓
EXISTING WHATSAPP QUEUE
        ↓
EXISTING AUTOMATION HUB
        ↓
EXISTING PROGRESS
        ↓
EXISTING 10 → 0 SECOND COUNTDOWN
        ↓
MESSAGE + CORRECT PDF
        ↓
AUTOMATIC WHATSAPP SEND
        ↓
SENT
OR
FAILED WITH REASON.


============================================================
39. FINAL USER EXPERIENCE
============================================================

The user experience should become:

USER SAVES
        ↓
DONE.

The application handles the existing WhatsApp automation in the
background.

The user does NOT need to perform a second Send action.

The existing Automation Hub provides visibility.

The existing PDF is automatically attached where the existing
workflow requires it.

If WhatsApp succeeds:

SENT.

If WhatsApp fails:

FAILED + REASON.

The transaction itself remains saved when the WhatsApp operation fails.

============================================================
40. FINAL NON-NEGOTIABLE AGENT RULE
============================================================

THIS PLAN DOES NOT AUTHORIZE NEW FEATURES.

THE AGENT MUST NOT:

- Invent functionality.
- Add unrelated features.
- Redesign UI.
- Rebuild existing systems.
- Create duplicate services.
- Create duplicate queues.
- Create duplicate PDF systems.
- Modify unrelated files.
- Refactor unrelated code.
- Change unrelated business logic.

THE AGENT MUST:

PULL
↓
UNDERSTAND
↓
TRACE
↓
CROSS-CHECK
↓
IDENTIFY THE EXACT RESPONSIBLE FILE
↓
VERIFY EXISTING IMPLEMENTATION
↓
MODIFY ONLY THE REQUIRED PART
↓
TEST
↓
CROSS-CHECK AGAIN
↓
REVIEW GIT DIFF
↓
REMOVE UNRELATED CHANGES.

FINAL OBJECTIVE:

EXISTING SAVE/COMPLETION ACTION
+
EXISTING PDF SYSTEM
+
EXISTING WHATSAPP QUEUE
+
EXISTING AUTOMATION HUB
+
MINIMUM NECESSARY CODE CHANGE
=
AUTOMATIC WHATSAPP MESSAGE + PDF
WITHOUT MANUAL SEND.

NO NEW FEATURE.

NO NEW UI.

NO UNRELATED FILE CHANGES.

NO DUPLICATE SYSTEMS.

============================================================