# WhatsApp Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task‑by‑task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically send expiry alerts for medicines and refill reminders for patients via WhatsApp, plus a manual reminder button in the POS billing UI.

**Architecture:** A daily `node‑cron` job runs inside the existing Express server, queries the SQLite DB, generates PDFs with `pdfkit`, and sends them through a single `whatsapp‑web.js` client instance that authenticates via QR code. A POS UI button triggers an on‑demand API endpoint that re‑uses the same client.

**Tech Stack:** TypeScript, Express, node‑cron, sqlite3/sqlite, pdfkit, whatsapp‑web.js, dotenv for config, Jest for tests.

---

### Task 1: Extend database schema
**Files:**
- Modify: `src/database.ts`
- Create migration script (optional) `src/migrations/2026-05-24-add-whatsapp-schema.sql`
- Update: `scripts/ensure-schema.ts` (if exists) or ensure `ensureSchema` runs new commands.

- [ ] **Step 1: Write failing test**
```ts
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

test('patients table exists with required columns', async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE patients (id INTEGER PRIMARY KEY, name TEXT NOT NULL, whatsapp_number TEXT NOT NULL UNIQUE, refill_due_date DATE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_notified DATETIME);`);
  const info = await db.get(`PRAGMA table_info(patients);`);
  expect(info).toBeDefined();
});
```
- [ ] **Step 2: Run test to verify it fails** (no patients table in production DB yet).
- [ ] **Step 3: Implement schema changes** – add `expiry_date` to `medicines`, add `patients` table and `last_notified` columns, update `ensureSchema` SQL.
- [ ] **Step 4: Run test to verify it passes**.
- [ ] **Step 5: Commit**
```bash
git add src/database.ts src/migrations/2026-05-24-add-whatsapp-schema.sql
git commit -m "feat: add patients table and expiry_date columns for WhatsApp alerts"
```

### Task 2: Install and configure WhatsApp client
**Files:**
- Create: `src/whatsappClient.ts`

- [ ] **Step 1: Write failing test** – verify client initialization throws until QR is scanned.
- [ ] **Step 2: Run test (should fail).**
- [ ] **Step 3: Implement client** using `whatsapp-web.js` with `LocalAuth`, expose `sendMessage(to, mediaPath, caption?)` function.
- [ ] **Step 4: Run test (passes).**
- [ ] **Step 5: Commit**
```bash
git add src/whatsappClient.ts
git commit -m "feat: add WhatsApp client wrapper"
```

### Task 3: Add daily background job (cron)
**Files:**
- Modify: `src/server.ts`
- Create: `src/jobs/dailyAlerts.ts`

- [ ] **Step 1: Write failing test** – schedule exists and runs at configured hour.
- [ ] **Step 2: Run test (fails).**
- [ ] **Step 3: Implement job** using `node-cron` (`0 2 * * *` default) that calls a new helper `runDailyAlerts()`.
- [ ] **Step 4: Run test (passes).**
- [ ] **Step 5: Commit**
```bash
git add src/jobs/dailyAlerts.ts src/server.ts
git commit -m "feat: schedule daily alerts job"
```

### Task 4: PDF generation utility
**Files:**
- Create: `src/utils/pdfGenerator.ts`

- [ ] **Step 1: Write failing test** – generate a PDF and check file exists.
- [ ] **Step 2: Run test (fails).**
- [ ] **Step 3: Implement utility** using `pdfkit` (function `createPdf(data: Array<{name:string;date:string}>, title:string, outPath:string)`).
- [ ] **Step 4: Run test (passes).**
- [ ] **Step 5: Commit**
```bash
git add src/utils/pdfGenerator.ts
git commit -m "util: PDF generator for alert reports"
```

### Task 5: Wire daily job to use client & PDF generator
**Files:**
- Modify: `src/jobs/dailyAlerts.ts`

- [ ] **Step 1: Write failing test** – job queries DB, creates PDFs, calls `whatsappClient.sendMessage`.
- [ ] **Step 2: Run test (fails).**
- [ ] **Step 3: Implement logic**: query medicines (`expiry_date <= date('now','+2 months')`), patients (`refill_due_date <= date('now','+7 days')`), generate PDFs, send via client, update `last_notified`.
- [ ] **Step 4: Run test (passes).**
- [ ] **Step 5: Commit**
```bash
git add src/jobs/dailyAlerts.ts
git commit -m "feat: daily alerts job implementation"
```

### Task 6: POS billing UI manual reminder button
**Files:**
- Modify: `ui-demo.html` (or the billing page you’ll add later)
- Create endpoint: `src/routes/patients.ts` (POST `/api/patients/:id/send-refill`)

- [ ] **Step 1: Write failing test** – endpoint returns 200 and triggers WhatsApp send.
- [ ] **Step 2: Run test (fails).**
- [ ] **Step 3: Implement endpoint** that loads patient, generates single‑item PDF, calls client, updates `last_notified`.
- [ ] **Step 4: Add button in HTML** that `fetch('/api/patients/42/send-refill', {method:'POST'})`.
- [ ] **Step 5: Run test (passes).**
- [ ] **Step 6: Commit**
```bash
git add src/routes/patients.ts ui-demo.html
git commit -m "feat: manual refill reminder UI and endpoint"
```

### Task 7: Add configuration & env handling
**Files:**
- Modify: `.env.example` and `src/config.ts`

- [ ] **Step 1: Write failing test** – config values are read correctly.
- [ ] **Step 2: Run test (fails).**
- [ ] **Step 3: Implement config loader** (`dotenv`), expose `WHATSAPP_ADMIN`, `DAILY_JOB_HOUR`, `EXPIRY_ALERT_MONTHS`, `REFILL_ALERT_DAYS`.
- [ ] **Step 4: Run test (passes).**
- [ ] **Step 5: Commit**
```bash
git add .env.example src/config.ts
git commit -m "chore: add env config for WhatsApp alerts"
```

### Task 8: End‑to‑end test of daily flow (optional but recommended)
**Files:**
- Create: `tests/integration/alerts.test.ts`

- [ ] **Step 1: Write test that seeds DB with a medicine expiring in 1 month and a patient refill due in 5 days, runs `runDailyAlerts()`, and asserts WhatsApp client `sendMessage` was called (mocked).**
- [ ] **Step 2: Run test (fails).**
- [ ] **Step 3: Mock `whatsappClient` and verify PDF creation, DB updates.**
- [ ] **Step 4: Run test (passes).**
- [ ] **Step 5: Commit**
```bash
git add tests/integration/alerts.test.ts
git commit -m "test: integration test for daily alerts job"
```

---

**Next steps after plan:**
1. Execute each task automatically via sub‑agent‑driven development (which I will now start).
2. After all tasks are marked complete, run a final code‑review and finish the development branch.

Once you confirm, I will begin dispatching the first sub‑agent for Task 1.
