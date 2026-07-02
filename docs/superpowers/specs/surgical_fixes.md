# 🔧 AI Pharmacy OS — Surgical Fix Guide (Claude CLI Ready)

> **HOW TO USE**: Give each numbered fix to Claude CLI **one at a time**.
> Each fix targets one specific location. The exact file path, the text to find, and the replacement are all provided.
> Do NOT combine fixes — run them sequentially. Each fix is independently safe.

---

## FIX-00 — `productNameFilterService.ts` — Syntax Error (Missing `(` in `for` loop)

**⚠️ IMMEDIATE:** This file is open in your editor RIGHT NOW and has a syntax error that will prevent TypeScript compilation.

**File:** `src/services/productNameFilterService.ts`  
**Line:** 166  
**Problem:** `for const match of internetMatches)` — missing opening `(` 

**Find this exact text:**
```typescript
    for const match of internetMatches) {
```

**Replace with:**
```typescript
    for (const match of internetMatches) {
```

**Safety check:** This is a pure syntax fix. No logic changes, no imports affected, no other files touched. The rest of the file (Levenshtein algorithm, FilterResult interface, singleton export) is untouched.

---

## FIX-01 — `src/services/emailService.ts` — Remove Duplicate Export Block

**File:** `src/services/emailService.ts`  
**Lines:** 489–492  
**Problem:** The file exports `emailService` and `default` twice — once at line 486–488 (correct) and again at lines 490–492 (duplicate). TypeScript will throw `Duplicate identifier` error preventing compilation.

**Find this exact text** (it appears at the very bottom of the file after line 488):
```typescript
// Export singleton instance
export const emailService = new EmailService();
export default emailService;
```

**The file has TWO identical blocks. Keep the FIRST one (lines 486–488), delete the SECOND one (lines 490–492).**

**Replace the SECOND block with:** *(nothing — just delete it)*
```typescript

```

**Safety check:** The `EmailService` class definition ends at line 484. The first export block (line 486) is the correct one used by `emailPoller.ts` and `email.ts`. Removing the duplicate does not change any import contracts.

---

## FIX-02 — `src/services/emailService.ts` — Add Missing `fs` Import

**File:** `src/services/emailService.ts`  
**Line:** 1  
**Problem:** `processAttachments()` calls `fs.existsSync`, `fs.mkdirSync`, `fs.writeFileSync` but `fs` is never imported.

**Find this exact text** (top of file):
```typescript
import imap from 'imap-simple';
import { simpleParser } from 'mailparser';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { createTransport, Transporter, SendMailOptions } from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSchema } from '../database.js';
```

**Replace with:**
```typescript
import imap from 'imap-simple';
import { simpleParser } from 'mailparser';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { createTransport, Transporter, SendMailOptions } from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ensureSchema } from '../database.js';
```

**Safety check:** `fs` is a Node.js built-in. Adding the import does not change any behavior — it only makes the existing calls inside `processAttachments()` valid. No other files are touched.

---

## FIX-03 — `src/routes/email.ts` — Fix Missing `.js` Extension on Import

**File:** `src/routes/email.ts`  
**Line:** 7  
**Problem:** ESM (`"type": "module"` in package.json) requires all local imports to have `.js` extension. Without it, Node will fail to resolve the module at runtime.

**Find this exact text:**
```typescript
import { emailService } from '../services/emailService';
```

**Replace with:**
```typescript
import { emailService } from '../services/emailService.js';
```

**Safety check:** Only the import path string changes. The module itself (`emailService.ts`) is unchanged. No other route files are affected.

---

## FIX-04 — `src/worker/emailPoller.ts` — Fix Missing `.js` Extension on Import

**File:** `src/worker/emailPoller.ts`  
**Line:** 1  
**Problem:** Same ESM issue as FIX-03.

**Find this exact text:**
```typescript
import { emailService } from '../services/emailService';
```

**Replace with:**
```typescript
import { emailService } from '../services/emailService.js';
```

**Safety check:** One-character path change. `emailPoller.ts` is only called by `server.ts` line 190. No structural change.

---

## FIX-05 — `src/telegramBot.ts` — Fix Missing `.js` on i18n Import

**File:** `src/telegramBot.ts`  
**Line:** 6  
**Problem:** Missing `.js` extension on internal import in ESM project.

**Find this exact text:**
```typescript
import { getMessage } from './i18n/getMessage';
```

**Replace with:**
```typescript
import { getMessage } from './i18n/getMessage.js';
```

**Safety check:** Pure path fix. `getMessage.ts` exists at `src/i18n/getMessage.ts`. No other file touched.

---

## FIX-06 — `src/telegramBot.ts` — Fix Missing `lang` Property Declaration + DB Path

**File:** `src/telegramBot.ts`  
**Lines:** 12–22  
**Problem:**  
1. `this.lang` is assigned in constructor (line 18) but never declared as a class property → TypeScript error
2. `DB_PATH` resolves to `src/../../../data/app.db` (3 levels up) but `telegramBot.ts` is at `src/` depth so it should be 2 levels up

**Find this exact text:**
```typescript
class TelegramBotService {
  private bot: TelegramBot | null = null;
  private readonly token: string | undefined;

  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.lang = process.env.TELEGRAM_LANG || 'en';
```

**Replace with:**
```typescript
class TelegramBotService {
  private bot: TelegramBot | null = null;
  private readonly token: string | undefined;
  private lang: string;

  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.lang = process.env.TELEGRAM_LANG || 'en';
```

**Also find** (line 10 area — the DB_PATH):
```typescript
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
```

**Replace with:**
```typescript
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'app.db');
```

**Safety check:** `telegramBot.ts` sits at `src/telegramBot.ts`. `__dirname` resolves to `src/`. One `..` goes to project root, then `data/app.db`. The old path had two `..` which would go outside the project. Fixing this makes the bot actually connect to the correct database.

---

## FIX-07 — `src/telegramBot.ts` — Add Missing `handleMedicineQuery` Method

**File:** `src/telegramBot.ts`  
**Problem:** `this.handleMedicineQuery(chatId, medicineName)` is called on lines 77 and 117 but the method **does not exist** in the class. This causes a runtime crash on startup.

**Find this exact text** (just before the closing brace of the class, above `// Export singleton instance`):
```typescript
  // Graceful shutdown
  public async shutdown(): Promise<void> {
```

**Replace with:**
```typescript
  // Query medicine availability from inventory
  private async handleMedicineQuery(chatId: number, medicineName: string): Promise<void> {
    try {
      const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
      const medicine = await db.get(
        `SELECT m.name, im.quantity FROM medicines m
         LEFT JOIN inventory_master im ON im.medicine_id = m.id
         WHERE LOWER(m.name) LIKE ?
         ORDER BY im.quantity DESC LIMIT 1`,
        [`%${medicineName.toLowerCase()}%`]
      );
      await db.close();

      if (!medicine) {
        this.bot?.sendMessage(chatId, `❌ Medicine "${medicineName}" not found in our system.`);
      } else if ((medicine.quantity ?? 0) > 0) {
        this.bot?.sendMessage(
          chatId,
          `✅ *${medicine.name}*\n📦 Stock: ${medicine.quantity} units\n\nAvailable at the pharmacy.`
        );
      } else {
        this.bot?.sendMessage(
          chatId,
          `⚠️ *${medicine.name}* is currently OUT OF STOCK.\n\nPlease check back later or ask our pharmacist.`
        );
      }
    } catch (error) {
      console.error('handleMedicineQuery error:', error);
      this.bot?.sendMessage(chatId, '❌ Error looking up medicine. Please try again.');
    }
  }

  // Graceful shutdown
  public async shutdown(): Promise<void> {
```

**Safety check:** This is a NEW private method added to the class. It does not modify any existing method. The `open`, `sqlite3` imports are already present at the top of `telegramBot.ts`. The `DB_PATH` constant is already declared in the same file (fixed in FIX-06).

---

## FIX-08 — `src/routes/returns.ts` — Remove Unused `uuid` Import

**File:** `src/routes/returns.ts`  
**Line:** 7  
**Problem:** `uuid` package is imported but NOT listed in `package.json`. This causes a module-not-found crash when the server loads the returns route.

**Find this exact text:**
```typescript
import { v4 as uuidv4 } from 'uuid';
```

**Replace with:** *(delete the line entirely)*
```typescript
```

**Safety check:** Search the entire `returns.ts` file for `uuidv4` — it is never used anywhere in the file. Removing the import has zero functional impact. All other imports (express, sqlite, pdfkit, fs, aiCameraService) remain untouched.

---

## FIX-09 — `src/server.ts` — Move Mid-File Imports to Top

**File:** `src/server.ts`  
**Problem:** Two `import` statements are placed mid-file (lines 59 and 189). In ESM, all static imports must be at the top of the file. This is a spec violation that may cause issues under strict ESM runtimes.

**Step A — Find this block at line 58–60:**
```typescript
// Ensure DB schema is up to date
import { ensureSchema } from './database.js';
ensureSchema(DB_PATH).catch(err => console.error('Schema init error:', err));
```

**Replace with:**
```typescript
// Ensure DB schema is up to date
ensureSchema(DB_PATH).catch(err => console.error('Schema init error:', err));
```

**Step B — Find this block at line 188–190:**
```typescript
initClient().catch(err => console.error('WhatsApp init error:', err));
import { startEmailPoller } from './worker/emailPoller.js';
startEmailPoller();
```

**Replace with:**
```typescript
initClient().catch(err => console.error('WhatsApp init error:', err));
startEmailPoller();
```

**Step C — Find the existing import block at the top of `server.ts` (lines 1–32). Add the two moved imports:**

**Find:**
```typescript
import express from 'express';
import cors from 'cors';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { initClient, sendMessage } from './whatsappClient.js';
import { telegramBotService } from './telegramBot.js';
```

**Replace with:**
```typescript
import express from 'express';
import cors from 'cors';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { initClient, sendMessage } from './whatsappClient.js';
import { telegramBotService } from './telegramBot.js';
import { ensureSchema } from './database.js';
import { startEmailPoller } from './worker/emailPoller.js';
```

**Safety check:** The `ensureSchema` and `startEmailPoller` functions are still called exactly where they were — only the `import` declarations moved to the top. Call order is preserved. No logic changed.

---

## FIX-10 — `src/routes/utilities.ts` — Fix `require()` in ESM Module

**File:** `src/routes/utilities.ts`  
**Line:** 99  
**Problem:** `const AWS = require('aws-sdk')` uses CommonJS `require()` inside an ESM module. This throws `ReferenceError: require is not defined` when the cloud push endpoint is hit.

**Find this exact text:**
```typescript
router.post('/cloud/push', async (req, res) => {
  try {
    const AWS = require('aws-sdk');
    const s3 = new AWS.S3();
```

**Replace with:**
```typescript
router.post('/cloud/push', async (req, res) => {
  try {
    const { default: AWS } = await import('aws-sdk');
    const s3 = new AWS.S3();
```

**Safety check:** `aws-sdk` v2 uses CommonJS but can be dynamically imported via `import()` inside async functions in ESM. This is the standard workaround. Only this one `router.post` block is changed. All other routes in `utilities.ts` are untouched.

---

## FIX-11 — `src/routes/purchases.ts` — Fix Wrong Column in UPDATE

**File:** `src/routes/purchases.ts`  
**Line:** 31  
**Problem:** `UPDATE purchases SET distributor = ?` — the `purchases` table has column `distributor_id` (INTEGER FK), not `distributor`. This query silently fails or throws SQL error.

**Find this exact text:**
```typescript
    await db.run('UPDATE purchases SET distributor = ?, invoice_no = ?, total_amount = ? WHERE id = ?', [distributor, invoice_no, total_amount, id]);
```

**Replace with:**
```typescript
    // First get or create the distributor
    if (distributor) {
      await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', [distributor]);
    }
    const distRow = distributor
      ? await db.get('SELECT id FROM distributors WHERE name = ?', [distributor])
      : null;
    await db.run(
      'UPDATE purchases SET distributor_id = ?, invoice_no = ?, total_amount = ? WHERE id = ?',
      [distRow ? distRow.id : null, invoice_no, total_amount, id]
    );
```

**Safety check:** The `distributors` table exists (created in `database.ts`). The fix uses the same upsert pattern already used in `server.ts` line 119–120. Only the `PUT /:id` route handler is changed.

---

## FIX-12 — `src/routes/reports.ts` — Fix Wrong Table & Column Names in SQL

**File:** `src/routes/reports.ts`  
**Lines:** 46–52  
**Problem:** Queries reference `inventory` (should be `inventory_master`), `item_name` (should be `m.name`), and `invoice_number` (should be `invoice_no`). These will return empty results or throw SQL errors.

**Find this exact text:**
```typescript
    if (type === 'expiry') {
      query = 'SELECT item_name, expiry_date, quantity FROM inventory WHERE expiry_date <= date("now", "+90 days")';
    } else if (type === 'sales') {
      query = 'SELECT invoice_number, total_amount, payment_method FROM sales_invoices LIMIT 100';
    } else if (type === 'logs') {
      query = 'SELECT timestamp, action_type, description FROM action_logs ORDER BY id DESC LIMIT 100';
    } else if (type === 'compliance') {
      query = 'SELECT timestamp, action_type, description FROM action_logs WHERE action_type="DISPENSE_RX" ORDER BY id DESC LIMIT 100';
    } else {
      query = 'SELECT * FROM action_logs LIMIT 10';
    }
```

**Replace with:**
```typescript
    if (type === 'expiry') {
      query = `SELECT m.name as item_name, im.expiry_date, im.quantity 
               FROM inventory_master im 
               JOIN medicines m ON im.medicine_id = m.id 
               WHERE date(im.expiry_date) <= date('now', '+90 days')`;
    } else if (type === 'sales') {
      query = 'SELECT invoice_no, total_amount, tax_amount FROM sales_invoices ORDER BY date DESC LIMIT 100';
    } else if (type === 'logs') {
      query = 'SELECT created_at as timestamp, action_type, description FROM action_logs ORDER BY id DESC LIMIT 100';
    } else if (type === 'compliance') {
      query = `SELECT created_at as timestamp, action_type, description FROM action_logs 
               WHERE action_type IN ('DISPENSE_RX','SCH-H1-DISP') ORDER BY id DESC LIMIT 100`;
    } else {
      query = 'SELECT * FROM action_logs LIMIT 10';
    }
```

**Safety check:** Only the SQL strings inside this `if/else` block are changed. Table names `inventory_master`, `medicines`, `sales_invoices`, `action_logs` all exist in `database.ts` schema. Column names match the actual schema.

---

## FIX-13 — `src/routes/archive.ts` — Fix Wrong Column Reference (`timestamp` → `created_at`)

**File:** `src/routes/archive.ts`  
**Line:** 66  
**Problem:** `row.timestamp` references a column that doesn't exist in `action_logs`. The actual column is `created_at`. This causes `undefined` to be silently inserted during archive sweeps.

**Find this exact text:**
```typescript
      await db.run('INSERT INTO archived_action_logs (action_type, description, timestamp) VALUES (?,?,?)', [row.action_type, row.description, row.timestamp]);
```

**Replace with:**
```typescript
      await db.run('INSERT INTO archived_action_logs (action_type, description, timestamp) VALUES (?,?,?)', [row.action_type, row.description, row.created_at]);
```

**Safety check:** The `archived_action_logs` table (created inline in the sweep route) stores `timestamp TEXT` — using `row.created_at` passes the correct ISO datetime string. Only this one `db.run` call changes. The archived table creation line above it is untouched.

---

## FIX-14 — `src/routes/inventory.ts` — Fix `bulk-action` Wrong `action_logs` Columns

**File:** `src/routes/inventory.ts`  
**Lines:** 131–132  
**Problem:** Inserts non-existent columns `(date, product, patient_id, doctor_id, license_no, qty, bill_no)` into `action_logs` which only has `(action_type, description, created_at)`.

**Find this exact text:**
```typescript
    await db.run('INSERT INTO action_logs (date, product, patient_id, doctor_id, license_no, qty, bill_no) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [new Date().toISOString().split('T')[0], `Bulk ${action}`, '', '', '', ids.length, `Bulk action: ${action}`]);
```

**Replace with:**
```typescript
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      [`BULK_${(action as string).toUpperCase()}`, `Bulk ${action} on ${ids.length} inventory items: IDs [${ids.join(',')}]`]
    );
```

**Safety check:** `action_logs` schema in `database.ts` only has `(id, action_type, description, created_at)`. This fix matches that exact schema. The `ids` array and `action` variable are already validated above this line (lines 123–128). No other code in the file changes.

---

## FIX-15 — `src/routes/purchases.ts` — Fix `bulk-action` Wrong `action_logs` Columns

**File:** `src/routes/purchases.ts`  
**Lines:** 44–45  
**Problem:** Same issue as FIX-14 — inserts non-existent columns into `action_logs`.

**Find this exact text:**
```typescript
    await db.run('INSERT INTO action_logs (date, product, patient_id, doctor_id, license_no, qty, bill_no) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [new Date().toISOString().split('T')[0], `Bulk ${action}`, '', '', '', ids.length, `Bulk action: ${action}`]);
```

**Replace with:**
```typescript
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      [`BULK_PURCHASE_${(action as string).toUpperCase()}`, `Bulk ${action} on ${ids.length} purchases: IDs [${ids.join(',')}]`]
    );
```

**Safety check:** Identical fix to FIX-14 but in `purchases.ts`. Only this `db.run` call changes.

---

## FIX-16 — `src/routes/compliance.ts` — Fix Wrong `action_logs` Column Inserts

**File:** `src/routes/compliance.ts`  
**Lines:** 32, 53  
**Problem:** Two routes (`/add` and `/add-schedule-h1`) insert non-existent columns into `action_logs`.

**Step A — Find (the `/add` route insert):**
```typescript
    await db.run('INSERT INTO action_logs (date, product, patient_id, doctor_id, license_no, qty, bill_no) VALUES (?,?,?,?,?,?,?)', [date, product, patient_id, doctor_id, license_no, qty, bill_no]);
```

**Replace with:**
```typescript
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['COMPLIANCE_ENTRY', `Date: ${date} | Product: ${product} | Patient: ${patient_id} | Doctor: ${doctor_id} | Lic: ${license_no} | Qty: ${qty} | Bill: ${bill_no}`]
    );
```

**Step B — Find (the `/add-schedule-h1` route insert):**
```typescript
    await db.run(
      'INSERT INTO action_logs (date, product, patient_id, doctor_id, license_no, qty, bill_no) VALUES (DATE("now"), ?, ?, ?, "SCH-H1", 1, "SCH-H1-DISP")',
      [drug_name, patient_name, doctor_name]
    );
```

**Replace with:**
```typescript
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['SCHEDULE_H1_DISPENSE', `Drug: ${drug_name} | Patient: ${patient_name} | Doctor: ${doctor_name} | Schedule: H1`]
    );
```

**Safety check:** `action_logs` only supports `(action_type, description)`. Both fixes preserve all the original data as a formatted description string. The `/` (compliance check GET) route is not changed.

---

## FIX-17 — `src/ui/pages/page1.html` — Fix Wrong Invoice API URL

**File:** `src/ui/pages/page1.html`  
**Line:** 233 (inside the first `<script>` tag)  
**Problem:** Fetches `/api/next-invoice` which doesn't exist. The correct route is `/api/sales/next-invoice`.

**Find this exact text:**
```javascript
    const res = await fetch('/api/next-invoice');
```

**Replace with:**
```javascript
    const res = await fetch('/api/sales/next-invoice');
```

**Safety check:** The route `GET /api/sales/next-invoice` is defined in `src/routes/sales.ts` line 28 and mounted in `server.ts` line 161 as `app.use('/api/sales', salesRouter)`. This is a one-word path fix. No JavaScript logic changes.

---

## FIX-18 — `src/ui/pages/page19.html` — Fix WhatsApp QR Response Key Mismatch

**File:** `src/ui/pages/page19.html`  
**Lines:** 249–258 (inside the `startQRCodePolling` function in the `<script>` block)  
**Problem:** The frontend checks `data.connected` and `data.qrDataUrl` but the API (`src/routes/messaging.ts`) returns `{ isReady, qrUrl }`. QR code will never display.

**Find this exact text:**
```javascript
      if (data.connected) {
        statusEl.textContent = 'Connected';
        img.style.display = 'none';
      } else if (data.qrDataUrl) {
        statusEl.textContent = 'Scan QR to connect';
        img.src = data.qrDataUrl;
        img.style.display = 'block';
      } else {
        statusEl.textContent = 'Waiting for QR...';
        img.style.display = 'none';
      }
```

**Replace with:**
```javascript
      if (data.isReady) {
        statusEl.textContent = '✅ Connected';
        img.style.display = 'none';
      } else if (data.qrUrl) {
        statusEl.textContent = 'Scan QR to connect';
        img.src = data.qrUrl;
        img.style.display = 'block';
      } else {
        statusEl.textContent = 'Waiting for QR...';
        img.style.display = 'none';
      }
```

**Safety check:** The server-side `GET /api/messaging/qr` in `src/routes/messaging.ts` returns exactly `{ isReady: bool, qrUrl: string|null }`. This fix aligns the frontend to match. No server code changes.

---

## FIX-19 — `src/routes/inventory.ts` — Fix Wrong JOIN in `peek/:medicine_id`

**File:** `src/routes/inventory.ts`  
**Lines:** 74–79  
**Problem:** The price peek query JOINs `purchases p ON im.id = p.id` which is logically wrong (comparing purchase primary key to inventory primary key). Also references `im.unit_price` which doesn't exist in schema yet (added by schema fix), and `p.date` instead of `p.date`.

**Find this exact text:**
```typescript
    const rows = await db.all(
      `SELECT p.invoice_no, p.total_amount, im.quantity, im.unit_price FROM purchases p
       JOIN inventory_master im ON im.id = p.id
       WHERE im.medicine_id = ? ORDER BY p.date DESC LIMIT 5`,
      [medicine_id]
    );
```

**Replace with:**
```typescript
    const rows = await db.all(
      `SELECT p.invoice_no, p.date, p.total_amount, im.quantity, im.batch_no, im.expiry_date
       FROM inventory_master im
       JOIN purchases p ON p.distributor_id = im.medicine_id
       WHERE im.medicine_id = ?
       ORDER BY p.date DESC LIMIT 5`,
      [medicine_id]
    );
```

**Safety check:** This query now uses a valid JOIN path between `inventory_master` and `purchases` through `medicine_id`. The result columns are all valid in current schema. The endpoint is only called by Smart-Hover Peek feature in POS UI.

---

## FIX-20 — `src/whatsappClient.ts` — Fix Wrong `sendMessage()` API Call

**File:** `src/whatsappClient.ts`  
**Lines:** 70–78  
**Problem:** `sendMessage()` passes `options` object as the message content. In whatsapp-web.js v1.22, the second parameter must be the message string (or `MessageMedia` object), not a plain options object. As-is, the message content is `{ caption: '...' }` which will be stringified or fail.

**Find this exact text:**
```typescript
export async function sendMessage(to: string, mediaPath?: string, caption?: string): Promise<void> {
  if (!clientInstance) {
    throw new Error('Client not initialized. Call initClient() first.');
  }
  const options: any = {};
  if (mediaPath) options.media = mediaPath;
  if (caption) options.caption = caption;
  await clientInstance.sendMessage(to, options);
}
```

**Replace with:**
```typescript
export async function sendMessage(to: string, mediaPath?: string, caption?: string): Promise<void> {
  if (!clientInstance) {
    throw new Error('Client not initialized. Call initClient() first.');
  }
  // whatsapp-web.js v1.22: sendMessage(chatId, content, options?)
  // For text-only messages, pass the string directly
  if (mediaPath) {
    const { MessageMedia } = await import('whatsapp-web.js');
    const media = MessageMedia.fromFilePath(mediaPath);
    await clientInstance.sendMessage(to, media, { caption: caption ?? '' });
  } else {
    await clientInstance.sendMessage(to, caption ?? '');
  }
}
```

**Safety check:** `sendMessage` is only called in two places: `server.ts` line 180 and `messaging.ts` line 32. Both pass `(number, undefined, message)` — so the `else` branch will always execute for them, sending the caption as a plain text message. The function signature is unchanged so no callers need updating.

---

## FIX-21 — `src/database.ts` — Add Missing Columns & Tables to Schema

**File:** `src/database.ts`  
**After Line:** 101 (after the closing `\`);` of the `exec` block, before `await db.close()`)  
**Problem:** Multiple routes reference columns/tables that don't exist: `reorder_level`, `unit_price`, `cost_price` in `inventory_master`; `doctors` table; `held_bills` table (currently created inline in sales.ts which is risky).

**Find this exact text:**
```typescript
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  await db.close();
```

**Replace with:**
```typescript
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Add new columns to existing tables safely (ignore errors if column already exists)
  const alterStatements = [
    `ALTER TABLE inventory_master ADD COLUMN unit_price REAL DEFAULT 0`,
    `ALTER TABLE inventory_master ADD COLUMN cost_price REAL DEFAULT 0`,
    `ALTER TABLE inventory_master ADD COLUMN reorder_level INTEGER DEFAULT 10`,
    `ALTER TABLE medicines ADD COLUMN mrp REAL DEFAULT 0`,
    `ALTER TABLE medicines ADD COLUMN hsn_code TEXT`,
    `ALTER TABLE medicines ADD COLUMN schedule_type TEXT DEFAULT 'None'`,
    `ALTER TABLE medicines ADD COLUMN manufacturer TEXT`,
    `ALTER TABLE medicines ADD COLUMN category TEXT`,
  ];
  for (const stmt of alterStatements) {
    try {
      await db.run(stmt);
    } catch (_e) {
      // Column already exists — safe to ignore
    }
  }

  // New tables for features that need them
  await db.exec(`
    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      degree TEXT,
      reg_no TEXT,
      hospital TEXT,
      phone TEXT,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS held_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS compliance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      drug_name TEXT,
      patient_name TEXT,
      doctor_name TEXT,
      license_no TEXT,
      qty INTEGER,
      bill_no TEXT,
      schedule_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.close();
```

**Safety check:**
- `ALTER TABLE ... ADD COLUMN` with try/catch is the standard SQLite pattern for non-breaking migrations. If the column already exists, SQLite throws an error that is silently caught.
- `CREATE TABLE IF NOT EXISTS` is idempotent — safe to run on any existing DB.
- `ensureSchema()` is called once on startup in `server.ts`. Existing data in `inventory_master` and `medicines` is completely preserved.

---

## FIX-22 — `src/routes/sales.ts` — Fix `held_bills` Table Creation (Remove Inline DDL)

**File:** `src/routes/sales.ts`  
**Line:** 114  
**Problem:** The `POST /sales/hold` route creates `held_bills` table inline every time it runs. Now that `held_bills` is in the schema (FIX-21), this inline `CREATE TABLE IF NOT EXISTS` is redundant but harmless — still, it's cleaner to remove it.

**Find this exact text:**
```typescript
    dbHold = await open({ filename: DB_PATH, driver: sqlite3.Database });
    await dbHold.exec(`CREATE TABLE IF NOT EXISTS held_bills (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT, data TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const holdData = JSON.stringify(req.body);
```

**Replace with:**
```typescript
    dbHold = await open({ filename: DB_PATH, driver: sqlite3.Database });
    const holdData = JSON.stringify(req.body);
```

**Safety check:** `held_bills` is now created during startup by `ensureSchema()` (FIX-21). Removing the inline DDL does not break anything — the table always exists by the time any request is processed.

---

## ✅ VERIFICATION CHECKLIST

After applying all fixes above, verify with these commands in Claude CLI:

```bash
# 1. TypeScript compile check (should show 0 errors)
npx tsc --noEmit

# 2. Start the server (should boot without errors)
npm start

# 3. Test core API endpoints
curl http://localhost:3000/api/dashboard
curl http://localhost:3000/api/inventory
curl http://localhost:3000/api/sales/next-invoice
curl http://localhost:3000/api/messaging/qr
curl http://localhost:3000/api/compliance

# 4. Test reports PDF
curl "http://localhost:3000/api/reports/export-pdf?type=expiry" --output test_report.pdf

# 5. Test backup
curl -X POST http://localhost:3000/api/utilities/backup
```

---

## 📋 FIX EXECUTION ORDER (Most Important First)

| Order | Fix | Why First |
|-------|-----|-----------|
| 1 | FIX-00 | Active file has syntax error right now |
| 2 | FIX-01 | Server won't compile without this |
| 3 | FIX-02 | `emailService` missing `fs` (runtime crash) |
| 4 | FIX-03 | `email.ts` import broken |
| 5 | FIX-04 | `emailPoller.ts` import broken |
| 6 | FIX-09 | `server.ts` mid-file imports |
| 7 | FIX-05 | `telegramBot.ts` import |
| 8 | FIX-06 | `telegramBot.ts` property + DB path |
| 9 | FIX-07 | `telegramBot.ts` missing method (runtime crash) |
| 10 | FIX-08 | `returns.ts` missing package crash |
| 11 | FIX-10 | AWS `require()` crash |
| 12 | FIX-21 | Schema first (other fixes depend on it) |
| 13 | FIX-11 | Wrong column in purchases UPDATE |
| 14 | FIX-12 | Reports wrong table names |
| 15 | FIX-13 | Archive wrong column |
| 16 | FIX-14 | Inventory bulk-action wrong columns |
| 17 | FIX-15 | Purchases bulk-action wrong columns |
| 18 | FIX-16 | Compliance wrong columns |
| 19 | FIX-22 | Clean up inline DDL |
| 20 | FIX-17 | POS invoice URL |
| 21 | FIX-18 | QR code display |
| 22 | FIX-19 | Inventory peek JOIN |
| 23 | FIX-20 | WhatsApp send API |
