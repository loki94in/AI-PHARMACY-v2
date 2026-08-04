# SELL BILL BARCODE FEATURE - IMPLEMENTATION PLAN

## WHY WE NEED THIS

When a customer returns medicine to the pharmacy, the staff needs to trace it back to the original sale invoice. Currently, the staff must manually type the invoice number (e.g., S-2026-0001) which is:
- **Error-prone**: Typos lead to wrong invoice lookup
- **Slow**: Manual entry takes time during busy hours
- **Frustrating**: Customers may not remember their invoice number

**Solution**: Add a scannable barcode to every sell bill invoice. When a customer returns with their bill, the staff simply scans the barcode and the original sale loads instantly.

---

## HOW WE ARE BUILDING THIS

### Barcode Format
The barcode encodes: `S-2026-0001|2026-08-04` (invoice number + date)
- **QR Code**: Scannable with any phone camera
- **Code128**: Scannable with dedicated barcode scanner hardware

### Architecture
```
SALE COMPLETED
    |
    v
INVOICE GENERATED (with barcode)
    |
    +---> PDF Invoice (barcode embedded)
    +---> View Modal (barcode displayed)
    +---> Sales History (barcode button per row)
    +---> WhatsApp (barcode image included)
    |
    v
CUSTOMER RETURNS
    |
    +---> Scan barcode from invoice
    +---> Auto-detect invoice number
    +---> Load original sale items
    +---> Process return
    +---> Show return receipt (with original barcode)
```

---

## IMPLEMENTATION PHASES

### PHASE 1: Backend Dependencies
- [x] Install `jsbarcode` and `@types/jsbarcode`
- [x] Verify `canvas` is available (already installed)

### PHASE 2: Barcode Generation Endpoint
- [x] Create `GET /api/utilities/sale-invoice-barcode/:invoiceNo`
- [x] Generate QR code using `qrcode` library
- [x] Generate Code128 barcode using `jsbarcode` + `canvas`
- [x] Return PDF with both barcodes and text labels

### PHASE 3: PDF Invoice Enhancement
- [x] Add barcode section to `pdfInvoiceService.ts`
- [x] Embed QR code after items table, before totals
- [x] Ensure barcode prints on physical invoices

### PHASE 4: Frontend API
- [x] Add `generateSaleInvoiceBarcode()` method to `api.ts`

### PHASE 5: Sells Page - Invoice View
- [x] Add barcode display in invoice view modal
- [x] Add "Print Barcode" button

### PHASE 6: Sells Page - Sales History
- [x] Add barcode icon button in each row of sales history table
- [x] Click opens barcode PDF

### PHASE 7: Customer Return - Auto-Detect
- [x] Modify invoice search input to detect barcode scans
- [x] Auto-extract invoice number from scanned data
- [x] Auto-trigger search on detection

### PHASE 8: Customer Return - Receipt
- [x] Show original invoice barcode on return confirmation
- [x] Allow printing return receipt with barcode

### PHASE 9: CRM - Barcode Search
- [x] Add "Scan Invoice Barcode" search option in CRM
- [x] Allow finding transactions by scanning barcode

### PHASE 10: WhatsApp Integration
- [x] Generate barcode image for WhatsApp notifications
- [x] Include barcode in bill notification messages

### PHASE 11: Knowledge Graph Update
- [x] Run `node scripts/quick-update.mjs`

---

## FILE CHANGE MANIFEST

| File | Action | Lines |
|------|--------|-------|
| `package.json` | MODIFY | Add jsbarcode |
| `src/services/barcodeService.ts` | NEW | Add ~40 lines (barcode buffer & Data URL service) |
| `src/routes/utilities.ts` | MODIFY | Add ~90 lines (new barcode endpoint) |
| `src/services/pdfInvoiceService.ts` | MODIFY | Add ~20 lines (embedded barcode section) |
| `frontend/src/services/api.ts` | MODIFY | Add ~10 lines |
| `frontend/src/pages/Sells/index.tsx` | MODIFY | Add ~90 lines |
| `frontend/src/pages/CustomerReturn/index.tsx` | MODIFY | Add ~50 lines |
| `frontend/src/pages/CRM/index.tsx` | MODIFY | Add ~10 lines |
| `src/services/whatsappInvoiceService.ts` | MODIFY | Add ~10 lines |

---

## VERIFICATION CHECKLIST

After implementation:
- [x] Create a test sale in POS
- [x] View invoice - verify QR + Code128 displays
- [x] Print invoice - verify barcode is scannable
- [x] Go to Customer Return
- [x] Scan barcode from printed invoice
- [x] Verify invoice auto-loads
- [x] Process return
- [x] Verify return receipt shows barcode
- [x] Check sales history shows barcode button
- [x] Check CRM barcode search works
- [x] Verify WhatsApp notification includes barcode

---

## LOOP INSTRUCTIONS

The agent MUST:
1. Read this plan
2. Execute one phase at a time
3. After each phase, mark as complete [x]
4. Run `node scripts/quick-update.mjs` after backend changes
5. Verify each change works before moving to next
6. If any phase fails, fix it before continuing
7. Continue until ALL phases are complete
8. Generate detailed final report
