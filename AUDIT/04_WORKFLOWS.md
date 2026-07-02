# 📋 All Workflows — Step by Step

Every major workflow in the application, diagrammed and explained in pure context.

---

## 1. Sales / POS Workflow

```mermaid
flowchart TD
    START["Pharmacist opens POS"] --> SEARCH["Search medicine by name"]
    SEARCH --> RESULTS["Display matching inventory<br/>(name, batch, expiry, stock, MRP)"]
    RESULTS --> SELECT["Select batch → add to cart"]
    SELECT --> CART["Cart shows items,<br/>quantities, prices, GST"]
    CART --> PATIENT["Enter patient name,<br/>phone, doctor (optional)"]
    PATIENT --> DISCOUNT["Apply discount %"]
    DISCOUNT --> DECIDE{"Complete or Hold?"}
    DECIDE -->|"Complete Sale"| INVOICE["Generate invoice_no<br/>(auto-increment)"]
    DECIDE -->|"Hold Bill"| HOLD["Save to held_bills<br/>(cart_data as JSON)"]
    HOLD --> RESTORE["Restore later from sidebar"]
    RESTORE --> INVOICE
    INVOICE --> DEDUCT["Deduct stock from<br/>inventory_master"]
    DEDUCT --> LEDGER["Write stock_ledger<br/>(audit trail)"]
    LEDGER --> COMPLIANCE{"Schedule H/H1<br/>drug?"}
    COMPLIANCE -->|"Yes"| LOG["Write compliance_logs"]
    COMPLIANCE -->|"No"| PDF["Generate invoice PDF"]
    LOG --> PDF
    PDF --> WA{"Send via<br/>WhatsApp?"}
    WA -->|"Yes"| QUEUE["Queue in<br/>pending_whatsapp_jobs"]
    WA -->|"No"| DONE["✅ Sale Complete"]
    QUEUE --> DONE
```

### Step-by-step:

1. **User opens `/pos`** → POS page loads, shows empty cart
2. **Types medicine name** → `api.searchMedicine(q)` → `GET /api/sales/search-medicine?q=...`
3. **Backend** queries `medicines` JOIN `inventory_master` for matching stock with batch/expiry info
4. **User selects a batch** → item added to local cart state (React state management)
5. **User enters patient info** → name, phone, doctor name (optional)
6. **User can "Hold Bill"** → saves cart to `held_bills` table with JSON serialized cart data, can restore later
7. **User clicks "Generate Bill"** → `api.createSale(data)` → `POST /api/sales`
8. **Backend performs these operations in sequence:**
   - Creates `sales_invoices` row with auto-generated `invoice_no`
   - Creates `sale_items` rows for each cart item
   - Updates `inventory_master.quantity` (decrements for each item)
   - Inserts `stock_ledger` audit entry per item
   - If a Schedule H/H1 drug was sold: inserts `compliance_logs` record
   - Returns `{ invoiceId, invoiceNo }`
9. **Frontend** receives success → shows toast → PDF can be printed
10. **If WhatsApp enabled** → invoice PDF queued in `pending_whatsapp_jobs` for async delivery

---

## 2. Purchase Import Workflow (Email → Inventory)

```mermaid
flowchart TD
    EMAIL["Distributor sends email<br/>with invoice attachment"] --> POLL["Email Poller Worker<br/>(background process)"]
    POLL --> IMAP["Connect to IMAP<br/>(Gmail credentials from settings)"]
    IMAP --> SYNC["Fetch new emails<br/>→ store in 'emails' table"]
    SYNC --> ATT["Download attachments<br/>→ store in 'email_attachments'"]
    ATT --> UI["User opens Mail page"]
    UI --> CLICK["Clicks 'Parse' on attachment"]
    CLICK --> PARSE["emailService parses file"]
    PARSE --> DETECT{"File type?"}
    DETECT -->|"PDF"| PDF["pdf-parse → extract text<br/>OR OCR fallback"]
    DETECT -->|"CSV"| CSV["csv-parse → structured rows"]
    DETECT -->|"Excel"| XLS["xlsx → sheet parsing"]
    PDF & CSV & XLS --> MAP["Map columns to schema<br/>(AI learning profiles)"]
    MAP --> STAGED["Create staged_purchases"]
    STAGED --> REVIEW["User reviews in<br/>Staged Review Modal"]
    REVIEW --> APPROVE{"Approve?"}
    APPROVE -->|"Yes"| IMPORT["Create purchases +<br/>purchase_items +<br/>inventory_master rows"]
    APPROVE -->|"No"| REJECT["Mark rejected"]
    IMPORT --> NOTIFY["SSE notification<br/>to frontend"]
```

### Step-by-step:

1. **Distributor emails invoice** (PDF/CSV/Excel attachment) to the pharmacy's Gmail
2. **Email Poller Worker** (background process) connects to IMAP and syncs new emails
3. **Emails stored** in `emails` table with metadata; attachments saved to `email_attachments`
4. **User opens Mail page** → sees inbox with distributor emails
5. **Clicks "Parse"** on an attachment → `emailService` processes the file
6. **File parsing** depends on type: PDF → text extraction (or OCR), CSV → column parsing, Excel → sheet parsing
7. **Column mapping** uses AI learning profiles from `distributor_learning_profiles` to auto-match columns
8. **Staged data** written to `staged_purchases` for human review
9. **User approves** → creates proper `purchases`, `purchase_items`, and `inventory_master` rows
10. **SSE notification** sent to update the frontend

---

## 3. Catalog Import Workflow

```mermaid
flowchart TD
    UPLOAD["User uploads CSV/PDF/Excel<br/>on Catalog Upload page"] --> API["POST /api/upload<br/>(multer file handler)"]
    API --> JOB["Create catalog_jobs row<br/>(status: 'pending')"]
    JOB --> WORKER["Catalog Worker picks up job"]
    WORKER --> ANALYZE["Parse file headers<br/>(status: 'processing_analysis')"]
    ANALYZE --> HEADERS["Extract column names"]
    HEADERS --> AUTOMATCH["Auto-match columns<br/>to medicine schema"]
    AUTOMATCH --> WAIT["Status: 'waiting_for_mapping'"]
    WAIT --> SSE["SSE → frontend shows<br/>'Ready for Mapping'"]
    SSE --> USERMAP["User confirms/edits<br/>column mapping"]
    USERMAP --> IMPORT["POST /api/catalog/import-job/:id"]
    IMPORT --> PROCESS["Worker processes rows<br/>(status: 'processing')"]
    PROCESS --> PROGRESS["SSE progress updates<br/>(10%, 20%, ... 100%)"]
    PROGRESS --> DEDUP["Duplicate detection<br/>(name matching)"]
    DEDUP --> INSERT["INSERT/UPDATE medicines table"]
    INSERT --> DONE["Status: 'done'<br/>SSE → success toast"]
```

### Step-by-step:

1. **User uploads a file** (CSV/PDF/Excel) on the Catalog Upload page
2. **Multer handler** saves file to `uploads/temp/`, creates `catalog_jobs` row
3. **Catalog Worker** (background process) picks up the pending job
4. **Worker analyzes file** — extracts column headers, detects file format
5. **Auto-matching** tries to map columns to medicine schema fields (name, composition, manufacturer, etc.)
6. **Status set to `waiting_for_mapping`** → SSE notification sent to frontend
7. **Frontend shows mapping UI** — user can confirm or edit the auto-detected mappings
8. **User submits mapping** → `POST /api/catalog/import-job/:id`
9. **Worker processes each row** — progress updates sent via SSE (visible in topbar progress bar)
10. **Duplicate detection** — checks if medicine name already exists in `medicines` table
11. **New medicines inserted**, existing ones updated → final status: `done`
12. **Frontend shows success toast** with counts (new, existing, duplicates)

---

## 4. Data Migration Workflow (Legacy System → AI Pharmacy)

```mermaid
flowchart TD
    UPLOAD["User uploads legacy data file<br/>(CSV/Excel/ZIP from old system)"] --> ANALYZE["POST /api/migration/analyze"]
    ANALYZE --> DETECT{"File type?"}
    DETECT -->|"ZIP"| UNZIP["Extract ZIP → identify<br/>contained files"]
    DETECT -->|"Excel"| SHEETS["List available sheets"]
    DETECT -->|"CSV"| HEADERS["Extract headers"]
    UNZIP & SHEETS & HEADERS --> PREVIEW["Return column preview<br/>to frontend"]
    PREVIEW --> MAP["User maps columns<br/>to target schema"]
    MAP --> DATATYPE["User selects data type:<br/>medicines / inventory /<br/>sales / purchases / returns"]
    DATATYPE --> RUN["POST /api/migration/run"]
    RUN --> MW["Migration Worker processes"]
    MW --> PARSE["Parser matches data type"]
    PARSE --> VALIDATE["Validate + clean each row"]
    VALIDATE --> STAGE["Write to staging tables<br/>(staging_inventory, staging_sales, etc.)"]
    STAGE --> REVIEW["User reviews staged data<br/>with inline editing"]
    REVIEW --> FINALIZE["POST /api/migration/staging/finalize"]
    FINALIZE --> COMMIT["Transaction: copy staging<br/>→ production tables"]
    COMMIT --> CLEANUP["Drop staging tables"]
```

### Supported legacy parsers:
- `inventoryParser.ts` — Master data + stock from old systems
- `salesParser.ts` — Sales invoices + line items  
- `returnsParser.ts` — Return bills + line items
- `pgCopyParser.ts` — PostgreSQL COPY format (for direct database exports)
- `pgMasterImporter.ts` — PostgreSQL master data importer
- `pgSalesImporter.ts` — PostgreSQL sales data importer
- `pgPurchaseImporter.ts` — PostgreSQL purchase data importer
- `pgReturnsImporter.ts` — PostgreSQL returns data importer

---

## 5. Background Worker Supervisor Workflow

```mermaid
flowchart TD
    SERVER["Server startup"] --> WS["workerSupervisor.start()"]
    WS --> FORK1["fork() Catalog Worker"]
    WS --> FORK2["fork() Email Poller"]
    WS --> HEALTH["Start health check loop<br/>(every 15 seconds)"]
    
    HEALTH --> PING["Send PING to each worker"]
    PING --> PONG{"Worker responds<br/>with PONG?"}
    PONG -->|"Yes"| UPDATE["Update lastPongTime"]
    PONG -->|"No (>45s)"| KILL["SIGKILL worker"]
    
    KILL --> EXIT["Worker exit event fires"]
    EXIT --> STABLE{"Ran > 30 seconds?"}
    STABLE -->|"Yes"| RESET["Reset restart counter"]
    STABLE -->|"No"| INC["Increment restart counter"]
    RESET & INC --> CHECK{"restartCount < 5?"}
    CHECK -->|"Yes"| DELAY["Wait (N × 3s) backoff"]
    DELAY --> RESPAWN["Re-fork worker"]
    CHECK -->|"No"| ABANDON["Log error,<br/>stop auto-restart"]
```

### How it works:
1. **Server starts** → `workerSupervisor.start()` is called
2. **Two workers are forked** as separate Node.js processes (Catalog Worker, Email Poller)
3. **Health check loop** runs every 15 seconds:
   - Sends `PING` message via IPC to each worker
   - Worker responds with `PONG`
   - If no `PONG` received for 45 seconds → worker is force-killed with `SIGKILL`
4. **On worker exit:**
   - If worker ran for >30 seconds → considered stable, restart counter resets to 0
   - If worker crashed quickly → restart counter increments
   - Backoff delay: 3s, 6s, 9s, 12s, 15s between restarts
   - After 5 consecutive quick failures → stops auto-restart

---

## 6. Notification Multi-Channel Workflow

```mermaid
flowchart TD
    TRIGGER["System event<br/>(refill due, expiry, order ready)"] --> NS["NotificationService"]
    NS --> DECIDE{"Channel type?"}
    DECIDE -->|"WhatsApp Personal"| WA["whatsappClient.ts<br/>(whatsapp-web.js)"]
    DECIDE -->|"WhatsApp Business"| WABA["WhatsApp Business API<br/>(official Meta API)"]
    DECIDE -->|"Telegram"| TG["telegramBot.ts<br/>(node-telegram-bot-api)"]
    DECIDE -->|"Push"| PUSH["pushNotificationService.ts<br/>(registered device tokens)"]
    DECIDE -->|"SSE"| SSE["Server-Sent Events<br/>to frontend browser"]
    
    WA --> QUEUE["whatsappQueue.ts<br/>(persistent queue in DB)"]
    QUEUE --> RETRY{"Send failed?"}
    RETRY -->|"Yes (retries < 3)"| QUEUE
    RETRY -->|"No"| DONE["✅ Delivered"]
```

### Supported notification types:
| Type | Channel | Use Case |
|------|---------|----------|
| WhatsApp Personal | `whatsapp-web.js` | Invoice delivery, refill reminders |
| WhatsApp Business | Meta Cloud API | Templated messages, delivery updates |
| Telegram | Bot API | Low stock alerts, refill alerts, prescription OCR |
| Push Notification | Device token registry | Mobile app notifications |
| SSE | Browser EventSource | Real-time UI updates (progress, sync alerts) |

---

## 7. AI Camera / OCR Workflow

```mermaid
flowchart TD
    INPUT["User uploads image/PDF"] --> SERVICE["aiCameraService.ts"]
    SERVICE --> TRY1["Try Tesseract.js<br/>(on-device, no internet)"]
    TRY1 --> CONF{"Confidence > threshold?"}
    CONF -->|"Yes"| RESULT["Return extracted text"]
    CONF -->|"No"| TRY2["Try ONNX PaddleOCR<br/>(onnxruntime-node)"]
    TRY2 --> RESULT2["Return best result"]
    RESULT & RESULT2 --> PARSE["Parse text into<br/>structured medicine data"]
    PARSE --> AUDIT["Save to ocr_audit_queue<br/>for human review"]
    AUDIT --> CORRECT["User corrects OCR errors<br/>→ saves to ocr_corrections"]
    CORRECT --> LEARN["System learns corrections<br/>for future accuracy"]
```

### OCR pipeline details:
1. **Tesseract.js** — Primary OCR engine, runs entirely on-device (no internet needed)
2. **ONNX PaddleOCR** — Secondary engine using `onnxruntime-node`, used when Tesseract confidence is low
3. **Human review** — OCR results are queued in `ocr_audit_queue` for pharmacist verification
4. **Learning** — Corrections stored in `ocr_corrections` table, used to improve future OCR accuracy

---

## 8. Supplier Returns Workflow

```mermaid
flowchart TD
    SCAN["Expiry Monitor scans<br/>inventory for near-expiry items"] --> LIST["Display near-expiry list<br/>(items expiring in N months)"]
    LIST --> SELECT["User selects items<br/>for return"]
    SELECT --> LOOKUP["Lookup original<br/>purchase batch"]
    LOOKUP --> RETURN["Create return record<br/>in 'returns' table"]
    RETURN --> ITEMS["Create return_items<br/>for each selected item"]
    ITEMS --> STOCK["Remove items from<br/>inventory_master"]
    STOCK --> CREDIT["Create expiry_returns_tracking<br/>(expected credit note)"]
    CREDIT --> ALERT["Set reminder_date<br/>(45 days from return)"]
    ALERT --> CRON["Daily cron checks<br/>overdue credit notes"]
    CRON --> NOTIFY["Send alert if<br/>credit note overdue"]
```

---

## 9. Automated Cron Jobs

| Schedule | Cron Expression | Task | Description |
|----------|----------------|------|-------------|
| Daily 9:00 AM | `0 9 * * *` | Patient refills + credit notes | Checks all patient refill schedules, sends reminders. Checks overdue credit notes from suppliers. |
| 1st & 16th of month, 9:00 AM | `0 9 1,16 * *` | Expiry scan | Scans inventory for items expiring within 90 days. Sends WhatsApp/Telegram alerts. |
| Nightly 9:30 PM | `30 21 * * *` | Auto backup | Creates database backup at pharmacy closing time. |
| Every 3h or 6h | `0 */3 * * *` or `0 */6 * * *` | Scheduled backup | User-configured periodic backup frequency. |

### Startup catch-up logic:
When the server starts, it checks:
- Was today's daily check already run? If not → runs immediately
- Is WhatsApp enabled? If yes → pre-initializes the client
- Starts the WhatsApp queue worker
- Starts the backup scheduler
- Starts the worker supervisor
