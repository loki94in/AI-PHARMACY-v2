# WhatsApp Automation Design

**Goal**: Automatically send expiry alerts for medicines and refill reminders for patients via WhatsApp, and provide a manual trigger in the POS billing UI.

## Architecture
- **Express server (`src/server.ts`)** hosts the API and runs a daily background job using `node-cron`.
- **SQLite database (`data/app.db`)** stores medicines, patients, and notification timestamps.
- **WhatsApp client (`whatsapp-web.js`)** runs inside the same Node process, authenticating with a QR code on first launch.
- **PDF generation (`pdfkit`)** creates concise reports attached to WhatsApp messages.

## Database Schema
```sql
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL UNIQUE,
  refill_due_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_notified DATETIME
);

ALTER TABLE medicines ADD COLUMN expiry_date DATE;
ALTER TABLE medicines ADD COLUMN last_notified DATETIME;
```
- `expiry_date` – the date a medicine expires.
- `refill_due_date` – when a patient should receive a refill reminder.
- `last_notified` – tracks the most recent alert to avoid duplicate messages.

## Daily Background Job
- **Schedule**: `0 2 * * *` (2 AM daily, configurable via `DAILY_JOB_HOUR`).
- **Steps**:
  1. Open DB connection.
  2. Query medicines where `expiry_date` ≤ `date('now', '+2 months')` and `last_notified` is NULL or older than the alert window.
  3. Query patients where `refill_due_date` ≤ `date('now', '+7 days')` and `last_notified` is NULL or older.
  4. Generate a PDF for each alert type using **pdfkit**.
  5. Send the PDF via **whatsapp-web.js**:
     - Expiry alerts → admin number (`WHATSAPP_ADMIN`).
     - Refill reminders → patient’s `whatsapp_number`.
  6. Update `last_notified` after a successful send.
- All steps are wrapped in `try/catch`; failures are logged to `logs/alerts_error.log`.

## WhatsApp Client Setup
```js
import { Client, LocalAuth } from 'whatsapp-web.js';
const client = new Client({ authStrategy: new LocalAuth() });
client.on('qr', (qr) => console.log('Scan QR code:', qr));
client.on('ready', () => console.log('WhatsApp client ready'));
await client.initialize();
```
- On first run the QR code is printed to the console for scanning.
- The authenticated session is persisted by `LocalAuth`.

## PDF Generation
```js
import PDFDocument from 'pdfkit';
import fs from 'fs';
function createPdf(data, title, filePath) {
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(filePath));
  doc.fontSize(16).text(title, { align: 'center' });
  doc.moveDown();
  data.forEach(item => {
    doc.fontSize(12).text(`${item.name} – ${item.date}`);
  });
  doc.end();
}
```
- Files are written to `tmp/` and removed after sending.

## POS Billing UI Hook (manual trigger)
Add a button in the billing section (e.g., `Send Refill Now`). On click it POSTs to:
```
POST /api/patients/:id/send-refill
```
The endpoint re‑uses the same WhatsApp client to send a single message using the PDF generator.

## Configuration (`.env`)
```
WHATSAPP_ADMIN=+1234567890
DAILY_JOB_HOUR=2
EXPIRY_ALERT_MONTHS=2
REFILL_ALERT_DAYS=7
```
All values are read at server start.

## Error handling & monitoring
- Daily run status stored in `alerts_status` table (`last_run`, `success`, `error_message`).
- Detailed errors logged to `logs/alerts_error.log`.
- If the WhatsApp client isn’t ready, the job skips sending and logs a warning.

## Security considerations
- WhatsApp numbers are stored as plain text; ensure the DB file is protected by OS permissions.
- The QR authentication data is kept in the user’s home directory by `whatsapp-web.js`; do not commit it to source control.
- Only the admin number and patient numbers that exist in the DB are messaged, preventing arbitrary sends.

---

**Next steps**: commit this spec, run a self‑review for placeholders or contradictions, and ask for your approval before generating the implementation plan.
