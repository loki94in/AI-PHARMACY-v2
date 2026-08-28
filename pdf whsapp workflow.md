IMPLEMENTATION PLAN: AUTOMATIC PDF ATTACHMENT FOR WHATSAPP MESSAGES

OBJECTIVE

Modify the existing AI-PHARMACY-v2 WhatsApp workflow so that whenever the application sends a WhatsApp message that has a related PDF/document, the correct PDF is automatically generated/retrieved and attached to the WhatsApp message.

This must work with all existing relevant workflows, including:

- Credit Bill
- Credit Reminder
- Refill
- POS Bill
- Order/Invoice
- Order Ready
- Dispatch
- Distributor-related documents
- Medicine/cart-related documents where a PDF already exists
- Monthly Credit/Billing
- Any other existing WhatsApp workflow that has a related PDF

The user should NOT have to manually download the PDF and attach it.

IMPORTANT SCOPE RULE

- Do NOT redesign the frontend UI.
- Do NOT create a new PDF-management page.
- Do NOT create a new WhatsApp page.
- Do NOT change the existing POS, Credit, Refill, Dispatch, Customer, or Order UI.
- Do NOT add unrelated functionality.
- Only modify files directly related to:
  1. WhatsApp sending
  2. PDF generation
  3. Existing invoice/bill/document generation
  4. Existing WhatsApp queue/automation
  5. File/document handling required for WhatsApp attachments
  6. Existing Automation Hub integration
  7. Existing error/notification handling
- If a new helper/service is genuinely required, create only that focused file.
- Reuse existing PDF generation and WhatsApp infrastructure wherever possible.

CURRENT BEHAVIOUR

Currently, the application can generate/send WhatsApp messages from different workflows.

For example:

Credit Bill
→ Generate bill
→ Send WhatsApp message

Refill
→ Generate reminder/details
→ Send WhatsApp message

POS
→ Generate bill/order information
→ Send WhatsApp message

However, the related PDF is not guaranteed to be automatically attached to the WhatsApp message.

The user may therefore receive something like:

"Your credit bill is ready."

but without:

Credit_Bill.pdf

The same issue can occur for refill, invoice, order, or other document-related WhatsApp messages.

EXPECTED BEHAVIOUR

Whenever a WhatsApp message has a related PDF, the application should automatically include that PDF as an attachment.

The complete workflow should become:

EXISTING APP ACTION
        ↓
Generate message content
        ↓
Identify related transaction/document
        ↓
Generate or retrieve correct PDF
        ↓
Validate PDF exists
        ↓
Create WhatsApp automation record
        ↓
Send WhatsApp text + PDF
        ↓
Track result in existing Automation Hub
        ↓
SUCCESS / FAILURE

Example:

CREDIT BILL
        ↓
Generate Credit Bill PDF
        ↓
Generate WhatsApp message
        ↓
Attach Credit Bill PDF
        ↓
Send WhatsApp
        ↓
Automation Hub
        ↓
✓ SENT

PDF ATTACHMENT RULE

The important rule is:

IF A WHATSAPP MESSAGE HAS A RELATED PDF,
THE APPLICATION MUST AUTOMATICALLY ATTACH THAT PDF.

The user should not need to:

- Download the PDF
- Open WhatsApp manually
- Find the customer
- Select the PDF
- Attach it
- Send it

The application handles the complete process.

SUPPORTED EXAMPLES

1. CREDIT BILL

Current:

Credit Bill
↓
WhatsApp message
↓
Customer receives text

New:

Credit Bill
↓
Generate correct Credit Bill PDF
↓
WhatsApp message + PDF
↓
Customer receives both

Example:

"Your monthly credit bill is ready."

Attachment:
Credit_Bill_August_2026.pdf


2. REFILL

Current:

Refill reminder
↓
WhatsApp message

New:

Refill reminder
↓
Generate/retrieve related refill PDF if the workflow has one
↓
Attach PDF
↓
Send WhatsApp

Example:

"Your refill details are ready."

Attachment:
Refill_12345.pdf


3. POS BILL

Current:

POS
↓
Bill/message
↓
WhatsApp

New:

POS
↓
Generate existing bill PDF
↓
Attach PDF
↓
WhatsApp


4. ORDER / INVOICE

Current:

Order details
↓
WhatsApp

New:

Order details
↓
Existing invoice/order PDF
↓
Attach PDF
↓
WhatsApp


5. DISTRIBUTOR / DISPATCH

If the existing workflow already generates a dispatch-related PDF:

Dispatch
↓
Generate/retrieve PDF
↓
WhatsApp message
↓
Attach PDF
↓
Send


6. SEND ALL VIA WHATSAPP

If the application sends multiple messages through "Send All via WhatsApp", every individual message must receive its own correct document.

Example:

Customer A
→ Message A
→ PDF A
→ WhatsApp

Customer B
→ Message B
→ PDF B
→ WhatsApp

Customer C
→ Message C
→ PDF C
→ WhatsApp

The system must NEVER accidentally attach Customer A's PDF to Customer B's message.

DOCUMENT MATCHING

The PDF must be matched to the correct business transaction.

Examples:

Customer ID
+
Bill ID
+
Invoice ID
+
Order ID
+
Refill ID
+
Credit account/reference

Use the strongest existing identifier available in the relevant workflow.

Do not rely only on:

- Customer name
- Filename
- Current selected customer
- Temporary frontend state

because this can cause the wrong PDF to be attached.

The attachment must correspond to the exact transaction that generated the WhatsApp message.

PDF GENERATION

First inspect the existing application to determine how PDFs are currently generated.

If a PDF generator already exists:

→ Reuse it.

Do NOT create a second PDF-generation system.

If the PDF already exists:

→ Reuse the existing generated file/reference.

If the document must be generated dynamically:

→ Generate it using the existing document/PDF infrastructure.

Only create a new PDF helper if the application genuinely does not have an appropriate reusable mechanism.

PDF VALIDATION

Before sending the WhatsApp message:

1. Confirm the PDF exists.
2. Confirm the file/reference is valid.
3. Confirm it belongs to the correct transaction.
4. Confirm it can be passed to the WhatsApp sending layer.
5. Then send the message.

If the PDF cannot be generated/retrieved/attached, the application must NOT silently send a message that was supposed to contain the document.

The automation should fail clearly.

Example:

✕ FAILED

Credit Bill
Customer: ABC

Reason:
Credit Bill PDF could not be generated.

This failure must be recorded in the existing Automation Hub.

WHATSAPP SEND FLOW

The central WhatsApp sending flow should become:

createWhatsAppAutomation()
        ↓
prepareMessage()
        ↓
identifyRelatedDocument()
        ↓
generateOrRetrievePDF()
        ↓
validatePDF()
        ↓
sendWhatsAppMessage({
    message,
    attachment
})
        ↓
receiveWhatsAppResult()
        ↓
updateAutomation()
        ↓
SENT / FAILED

The PDF preparation must happen before the final WhatsApp send.

AUTOMATION HUB INTEGRATION

This feature must integrate with the existing Automation Hub.

Every WhatsApp message must still appear in the Automation Hub as required by the existing WhatsApp automation implementation.

The Automation Hub should therefore show:

Sending
→ PDF preparation
→ WhatsApp sending
→ Success/Failure

Where the existing UI supports it, the automation record should retain information such as:

- Message type
- Recipient
- Related transaction
- PDF/document reference
- Status
- Error reason
- Timestamp

Do not redesign the Automation Hub.

Use its existing UI.

PROGRESS / COUNTDOWN

If the previously defined WhatsApp Automation Hub progress system is already implemented, the PDF attachment workflow must use the same lifecycle.

Example:

Preparing document
↓
Sending WhatsApp
↓
0–100% progress
↓
10–0 second countdown
↓
SENT / FAILED

Do not create another progress system specifically for PDFs.

FAILURE HANDLING

Every document-related failure must be visible.

Possible reasons:

- PDF generation failed
- PDF file does not exist
- PDF reference is invalid
- Incorrect document reference
- PDF could not be loaded
- PDF attachment failed
- WhatsApp offline
- WhatsApp session unavailable
- Number not registered
- WhatsApp send failed
- Other actual error returned by the existing system

The application must preserve the actual available reason.

Do not simply show:

"Something went wrong."

FAILURE NOTIFICATION

If PDF attachment causes the WhatsApp automation to fail:

→ Save FAILED state
→ Save actual reason
→ Show the existing failure notification/toast
→ Keep the failure visible in Automation Hub

Example:

🔴 WhatsApp Automation Failed

Credit Bill
Customer: ABC

Reason:
Credit Bill PDF could not be generated.

The user must be able to identify exactly what needs to be fixed.

WRONG PDF PROTECTION

This is a critical requirement.

The application must prevent:

Customer A
→ Customer B PDF

or:

Bill A
→ Bill B PDF

or:

Refill A
→ Refill B PDF

The PDF must be resolved using the same transaction/context that generated the message.

Before sending:

MESSAGE CONTEXT
+
DOCUMENT CONTEXT
=
SAME CUSTOMER / SAME TRANSACTION

Only then should the message be sent.

MULTIPLE MESSAGES / QUEUE

If multiple WhatsApp messages are queued:

Message 1
→ PDF 1
→ Send

Message 2
→ PDF 2
→ Send

Message 3
→ PDF 3
→ Send

Each queue item must maintain its own document reference.

Do not store one global PDF variable for the entire queue.

Do not allow one queued message to overwrite another message's attachment.

MEMORY / FILE CLEANUP

Temporary PDF files should be cleaned up safely after they are no longer required, if the existing architecture creates temporary files.

However:

- Do not delete a PDF before WhatsApp has finished using it.
- Do not delete a document that the application still needs.
- Do not break existing PDF download/view functionality.

The cleanup lifecycle should be:

Generate PDF
↓
Attach/send
↓
Confirm send completed or failed
↓
Release temporary resource
↓
Keep permanent document if existing application requires it

No unnecessary files should accumulate indefinitely.

BACKEND / FRONTEND RESPONSIBILITY

Where possible:

FRONTEND:
- Requests the existing operation.
- Supplies transaction/document context.
- Displays existing Automation Hub status.

BACKEND/SERVICE:
- Generates/retrieves PDF.
- Validates document.
- Passes attachment to WhatsApp sending layer.
- Returns actual result/error.

Do not move large PDF generation unnecessarily into the frontend.

Use the existing application architecture.

FILE MODIFICATION STRATEGY

Before coding:

1. Find the existing WhatsApp sender.
2. Find the existing WhatsApp queue.
3. Find the existing PDF generator.
4. Find existing invoice/bill PDF generation.
5. Find Credit Bill PDF generation.
6. Find Refill document generation.
7. Find POS bill PDF generation.
8. Find Order/Invoice PDF generation.
9. Find Dispatch-related document generation.
10. Find "Send All via WhatsApp".
11. Find existing Automation Hub integration.
12. Find existing error/notification handling.

Then determine where the common integration point exists.

Preferred architecture:

POS ──────────────┐
Credit ───────────┤
Refill ───────────┤
Order ────────────┤
Dispatch ─────────┤
Send All ─────────┤
Other workflows ──┤
                  ↓
       CENTRAL WHATSAPP SERVICE
                  ↓
       MESSAGE + DOCUMENT CONTEXT
                  ↓
        PDF PREPARATION SERVICE
                  ↓
       CENTRAL WHATSAPP SENDER
                  ↓
        AUTOMATION HUB
                  ↓
        SENT / FAILED

If the existing WhatsApp sender already provides a centralized location, modify that location instead of modifying every caller unnecessarily.

If a caller currently sends a message directly and bypasses the central sender, update that caller to use the centralized flow.

FRONTEND UI REQUIREMENT

The frontend should look the same.

No redesign.

No new page.

No new document-management screen.

No new WhatsApp screen.

Only the underlying behaviour changes so that the existing WhatsApp action automatically includes the correct PDF.

The user experience should remain:

Click existing WhatsApp action
↓
Application handles PDF automatically
↓
Application sends WhatsApp
↓
Existing Automation Hub shows progress/result

TESTING REQUIREMENTS

TEST 1:
Credit Bill
→ WhatsApp message
→ Correct Credit Bill PDF attached
→ Successfully delivered

TEST 2:
Refill
→ WhatsApp message
→ Correct refill PDF attached where applicable
→ Successfully delivered

TEST 3:
POS Bill
→ WhatsApp message
→ Correct POS PDF attached

TEST 4:
Order
→ Correct order/invoice PDF attached

TEST 5:
Dispatch
→ Correct dispatch document attached where applicable

TEST 6:
Send All
→ Every recipient gets the correct individual PDF

TEST 7:
Multiple queued messages
→ No attachment cross-over

TEST 8:
PDF generation failure
→ WhatsApp automation becomes FAILED
→ Actual PDF error shown
→ Automation Hub retains failure
→ Existing failure notification appears

TEST 9:
PDF missing
→ FAILED
→ Correct reason shown

TEST 10:
WhatsApp offline
→ FAILED
→ Existing WhatsApp error shown
→ No false SENT state

TEST 11:
Number not registered
→ FAILED
→ Correct WhatsApp reason shown

TEST 12:
Large PDF
→ Attachment still works
→ No UI freeze or unnecessary memory growth

TEST 13:
Repeated sending
→ Correct PDF every time
→ No stale document reference

TEST 14:
Long application session
→ PDF generation and WhatsApp attachment continue working

TEST 15:
Application idle and recovered
→ WhatsApp message + PDF still works normally

SUCCESS CRITERIA

The implementation is complete when:

1. Every relevant WhatsApp message can automatically include its related PDF.
2. Users do not need to manually download PDFs.
3. Users do not need to manually attach PDFs.
4. Credit Bills automatically attach their correct PDFs.
5. Refill workflows automatically attach their correct PDFs where a PDF exists.
6. POS bills automatically attach the correct PDF.
7. Order/invoice workflows attach the correct document.
8. Dispatch workflows attach the correct document where applicable.
9. Send All handles individual message/document pairs correctly.
10. No customer receives another customer's document.
11. Every message continues to appear in the existing Automation Hub.
12. Existing progress/countdown behaviour is reused.
13. PDF generation/attachment failures are recorded.
14. Actual failure reasons are shown.
15. Existing failure notifications are triggered.
16. Failed operations do not silently disappear.
17. Existing frontend UI remains unchanged.
18. Existing WhatsApp functionality remains compatible.
19. Existing PDF generation is reused wherever possible.
20. No duplicate PDF system is unnecessarily introduced.
21. No duplicate WhatsApp sending system is introduced.
22. Only related files are modified.
23. Any new file has one focused responsibility.
24. Temporary resources are cleaned safely.
25. No unrelated application behaviour is changed.

FINAL EXPECTED FLOW

OLD:

Credit Bill
↓
Create message
↓
WhatsApp
↓
Customer receives message
↓
PDF may need manual handling

NEW:

Credit Bill
↓
Create message
↓
Identify exact bill/transaction
↓
Generate/retrieve correct PDF
↓
Validate PDF
↓
Attach PDF automatically
↓
Send WhatsApp
↓
Existing Automation Hub tracks operation
↓
✓ SENT
↓
Customer receives:
Message + Correct PDF

If anything fails:

Message/PDF preparation
↓
✕ FAILED
↓
Actual failure reason saved
↓
Existing Automation Hub shows failure
↓
Existing notification alerts user
↓
User can resolve the issue

SHORT OLD VS NEW BEHAVIOUR

OLD:

User triggers WhatsApp
→ Message is sent
→ Related PDF is not always automatically attached
→ User may need to handle the PDF separately
→ Failure can be difficult to identify

NEW:

User triggers WhatsApp
→ Application automatically finds/generates the correct PDF
→ PDF is automatically attached
→ Message + PDF are sent together
→ Automation Hub tracks everything
→ If PDF/WhatsApp fails, the exact reason is saved and shown
→ User does not manually download or attach the document

IN ONE LINE:

OLD = WhatsApp message and PDF are separate.

NEW = EVERY RELEVANT WHATSAPP MESSAGE AUTOMATICALLY CARRIES ITS CORRECT PDF, WITH THE EXISTING AUTOMATION HUB TRACKING THE COMPLETE PROCESS FROM PREPARATION TO SENT/FAILED.