# 🔧 Problems Encountered & Solutions

Every major problem the project has faced, with root cause analysis and how each was solved.

---

## Problem 1: SQLite `SQLITE_MISUSE` Crashes at Startup

**Symptom**: Server crashes with `SQLITE_MISUSE` error when multiple parts of the codebase open separate database connections simultaneously.

**Root Cause**: The `database.ts` schema setup opened its own connection using the `sqlite` wrapper (over `sqlite3`), while route handlers used `dbManager` which also opens via `sqlite3`. Two separate connection handles fighting over the same database file caused internal state corruption.

**Solution**: Implemented a **Singleton DatabaseManager** pattern in `src/database/connection.ts`:

```typescript
class DatabaseManager {
  private static instance: DatabaseManager;
  private connection: Database | null = null;
  
  public async getConnection(): Promise<Database> {
    if (!this.connection) {
      this.connection = await open({ filename: dbPath, driver: sqlite3.Database });
      await this.connection.run('PRAGMA busy_timeout = 5000;');
    }
    return this.connection;
  }
}
export const dbManager = DatabaseManager.getInstance();
```

**Impact**: All routes and services now share one connection. Eliminates MISUSE errors entirely.

---

## Problem 2: Background Worker Crashes Kill the Entire Application

**Symptom**: If the catalog worker or email poller throws an unhandled exception, the main Express server process goes down, taking the entire application offline.

**Root Cause**: Workers were running in the same process as the Express server. An unhandled rejection or exception in worker code would propagate to the main event loop.

**Solution**: Implemented **WorkerSupervisor** using `child_process.fork()` in `src/worker/workerSupervisor.ts`:

- Workers run as **separate Node.js processes** — their crashes don't affect the main server
- **Heartbeat system**: Sends `PING` every 15 seconds, expects `PONG` response
- **Unresponsive detection**: Workers that don't respond for 45 seconds are force-killed with `SIGKILL`
- **Auto-restart with backoff**: 3s → 6s → 9s → 12s → 15s delay between restarts
- **Crash loop protection**: After 5 consecutive quick failures, automatic restart is suspended
- **Stable run detection**: If a worker runs for >30 seconds, the restart counter resets

---

## Problem 3: Catalog Import CHECK Constraint Crashes

**Symptom**: Adding new job statuses (like `processing_analysis`, `waiting_for_mapping`) caused `CHECK(status IN (...))` constraint violations in SQLite, crashing the catalog import pipeline.

**Root Cause**: The `catalog_jobs` table was originally created with a strict SQL CHECK constraint:
```sql
CHECK(status IN ('pending', 'processing', 'done', 'failed'))
```
When new statuses were introduced, the constraint blocked insertion.

**Solution**: 
1. Removed the strict SQL CHECK constraint from the table definition
2. Added detection logic in `database.ts` that auto-drops and recreates the table if the old CHECK constraint is found:
```typescript
const tableSql = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='catalog_jobs'");
if (tableSql && tableSql.sql.includes('CHECK(status IN')) {
  await db.run("DROP TABLE IF EXISTS catalog_jobs");
}
```
3. Status validation now happens in TypeScript instead of SQL, allowing flexible status additions

---

## Problem 4: Scanned PDFs Return Empty Text

**Symptom**: When users upload scanned PDF catalogs (image-based), `pdf-parse` returns empty or garbage text, making catalog import impossible.

**Root Cause**: `pdf-parse` can only extract embedded text from PDFs. Scanned PDFs are essentially images wrapped in PDF containers — they contain no extractable text.

**Solution**: Implemented a **dual-path extraction pipeline** in `src/extractor.ts`:

1. **Try pdf-parse first** (fast, for text-based PDFs)
2. **Check quality**: If extracted text has fewer than 50 non-whitespace characters → fallback to OCR
3. **OCR fallback pipeline**:
   - Render each PDF page as an image using `pdfjs-dist` + `canvas`
   - OCR each page image using `aiCameraService` (Tesseract.js)
   - Parse the OCR text into structured medicine data
4. **Progress reporting**: OCR path reports progress (5% → 80% for page rendering, 80% → 100% for text parsing)

```typescript
const cleanedText = text.replace(/\s+/g, '').trim();
if (cleanedText.length < MIN_TEXT_CHARS_THRESHOLD) {
  return await extractFromPdfViaOcr(filePath, data, onProgress);
}
```

---

## Problem 5: WhatsApp Messages Fail Silently

**Symptom**: Invoice PDFs queued for WhatsApp delivery would fail if the WhatsApp client wasn't connected, with no retry mechanism. Users had no idea their invoices weren't delivered.

**Root Cause**: WhatsApp sends were attempted inline during the sale creation request. If the client was disconnected, the send would fail and the error was swallowed.

**Solution**: Implemented a **persistent WhatsApp queue** backed by SQLite in `src/services/whatsappQueue.ts`:

- Table `pending_whatsapp_jobs` stores all pending sends:
  ```sql
  CREATE TABLE pending_whatsapp_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER,
    recipient_phone TEXT,
    pdf_path TEXT,
    caption TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    retries INTEGER DEFAULT 0
  )
  ```
- **Queue worker** runs independently, processing jobs one at a time
- **Retry logic**: Failed jobs are retried up to 3 times
- **Persistence**: Jobs survive server restarts (stored in DB, not memory)
- **Decoupled**: Sale creation completes immediately; WhatsApp delivery happens asynchronously

---

## Problem 6: Schema Evolution Without Migrations

**Symptom**: Adding new columns to existing tables during development caused "column already exists" errors that crashed the application on startup.

**Root Cause**: SQLite's `ALTER TABLE ADD COLUMN` throws an error if the column already exists. There was no migration tracking system.

**Solution**: The `database.ts` schema setup uses a **defensive try/catch pattern** for all ALTER TABLE statements:

```typescript
const alterStatements = [
  'ALTER TABLE medicines ADD COLUMN manufacturer TEXT',
  'ALTER TABLE medicines ADD COLUMN category TEXT',
  'ALTER TABLE medicines ADD COLUMN mrp REAL DEFAULT 0',
  // ... 60+ more column additions
];

for (const stmt of alterStatements) {
  try {
    await db.run(stmt);
  } catch (_e) {
    // Column already exists — safe to ignore
  }
}
```

**Trade-off**: This works but is not ideal for production. A proper migration system with version tracking would be better (see Improvements section).

---

## Problem 7: Mobile App Offline Sales Need Human Review

**Symptom**: Mobile app creates sales while offline, but directly syncing them to production inventory without review caused stock discrepancies and incorrect totals.

**Root Cause**: Offline sales are created without real-time inventory checks. By the time they sync, the inventory state may have changed (items sold, prices updated, batches depleted).

**Solution**: Implemented a **staging pattern** with human review:

1. Mobile syncs offline sales to `staged_sales` table (not directly to `sales_invoices`)
2. **SSE notification** alerts the desktop user immediately
3. Desktop user opens the **StagedReviewModal** component
4. Review UI shows each staged sale with:
   - Patient name, items, quantities, prices
   - Current inventory status for each item
   - Warnings for out-of-stock or price mismatches
5. **Approve** → commits to production (`sales_invoices`, `sale_items`, `inventory_master`)
6. **Reject** → marks as rejected, no inventory impact

Same pattern exists for `staged_purchases`.

---

## Problem 8: Data Naming Inconsistency (snake_case vs camelCase)

**Symptom**: Backend sends data in `snake_case` (SQLite column naming convention), while JavaScript frontend code conventionally uses `camelCase`. This caused confusion and inconsistent property access patterns across 432+ UI elements.

**Root Cause**: SQLite columns use snake_case (e.g., `invoice_no`, `total_amount`). The backend sends these directly. The frontend was built accessing these as-is.

**Solution**: Implemented **opt-in data standardization** in `frontend/src/services/api.ts`:

```typescript
// Conversion utilities
export const toCamelCase = (str: string): string => {
  return str.replace(/([-_][a-z])/ig, ($1) => {
    return $1.toUpperCase().replace('-', '').replace('_', '');
  });
};

// Axios interceptor — only converts when opted-in
apiClient.interceptors.response.use((response) => {
  if (response.config?.standardizeData && response.data) {
    response.data = objectToCamelCase(response.data);
  }
  return response;
});
```

**Usage**: New modules can opt-in:
```typescript
apiClient.get('/path', { standardizeData: true })
```

**Why not global**: Enabling globally would break 432+ existing UI elements that access snake_case properties. Migration is gradual.
