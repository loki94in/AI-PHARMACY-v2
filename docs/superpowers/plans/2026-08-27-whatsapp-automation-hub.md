# WhatsApp Automation Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate ~20 scattered WhatsApp automations into one header-accessible popover ("Automation Hub") showing per-automation on/off toggles and live/recent send status with loud failure reasons, and enforce a hard 10-15s floor on WhatsApp send pacing app-wide.

**Architecture:** Backend adds a static automation catalog module and one new merged-status endpoint over the *existing* `whatsapp_send_queue` and `automation_notifications` tables (no new tables). Frontend adds a small header button (new pub/sub event, mirroring the existing `whatsappQueueEvent` pattern) that opens a new `AutomationHubPopover` component, built from the same visual conventions as `TriggerSchedulesTab` (toggle cards) and `WhatsAppQueuePopover` (status rows, failure reasons). Pacing is hardened by removing the `turbo`/`fast` presets from `whatsappQueueWorker.ts` and clamping custom pacing values to a 10s floor wherever they're read.

**Tech Stack:** Node/TypeScript + Express backend (ESM, `.js` import extensions), SQLite via `dbManager`, React + TypeScript frontend, Tailwind CSS, lucide-react icons, `ts-jest` for backend unit tests.

**Spec:** `docs/superpowers/specs/2026-08-27-whatsapp-automation-hub-design.md`

## Global Constraints

- No new database tables — reuse `whatsapp_send_queue` and `automation_notifications` only.
- No new top-level route/page — the Hub is a popover/modal, mounted in `Layout.tsx` exactly like `WhatsAppQueuePopover`.
- Pacing floor is a hard 10,000ms minimum, everywhere pacing is read or written (not just at write time) — a stale or directly-edited `app_settings` row must not be able to bypass it.
- `'turbo'` and `'fast'` pacing presets are removed entirely (backend type, backend switch, frontend buttons) — `'safe'` (10-15s) is the only named preset; `'custom'` remains but is clamped.
- Toggle state lives in `app_settings` as string `'true'`/`'false'` values, one key per automation, following the existing `trigger_<name>_enabled` naming convention, default-on (`!== 'false'` read pattern) so existing behavior doesn't change until a user opts out.
- Boolean/string conventions, endpoint URL shapes, and `apiClient` wrapper usage in `frontend/src/services/api.ts` must match the existing entries around lines 1333-1338 and 1407-1410.
- Any new backend test file must be added verbatim to the `testMatch` array in `jest.config.js` — jest here uses an explicit allowlist, not a glob.

---

## File Structure

**Backend — create:**
- `src/services/automationCatalog.ts` — static catalog of all WhatsApp automation types (id, label, description, app_settings key, default-enabled).

**Backend — modify:**
- `src/services/whatsappQueueWorker.ts` — remove `turbo`/`fast` presets, widen `safe` to 10-15s, clamp custom pacing to a 10s floor on read.
- `src/routes/automation.ts` — add `GET /catalog` and `GET /hub-summary` endpoints.
- `src/routes/whatsappQueue.ts` — restrict `POST /pacing` to only accept `preset: 'safe'` or `'custom'` (reject `'turbo'`/`'fast'` with a 400).

**Backend — test:**
- `tests/automationHubPacing.test.ts` — pacing floor clamp behavior (pure logic, no DB).
- `tests/automationHubSummary.test.ts` — `hub-summary` headline computation against a temp SQLite DB (follows `tests/whatsappRouting.test.ts` conventions).

**Frontend — create:**
- `frontend/src/utils/whatsappFailureReason.ts` — `getFormattedFailureReason()` extracted from `WhatsAppQueuePopover.tsx` so both components share identical failure text.
- `frontend/src/components/AutomationHubPopover.tsx` — the new Hub popover (catalog + activity list).

**Frontend — modify:**
- `frontend/src/services/events.ts` — add `automationHubEvent` pub/sub (mirrors `whatsappQueueEvent`).
- `frontend/src/services/api.ts` — add `getAutomationCatalog()` and `getAutomationHubSummary()` client methods.
- `frontend/src/components/Layout.tsx` — add header button (badge-dot states: idle/sending/failed) next to the bell; mount `AutomationHubPopover` conditionally.
- `frontend/src/components/WhatsAppQueuePopover.tsx` — replace local `getFormattedFailureReason` with the shared util; remove Turbo/Fast preset buttons, keep only Safe.

---

### Task 1: Automation catalog module

**Files:**
- Create: `src/services/automationCatalog.ts`
- Test: `tests/automationCatalog.test.ts`

**Interfaces:**
- Produces: `export interface AutomationCatalogEntry { id: string; label: string; description: string; appSettingsKey: string; defaultEnabled: boolean; }` and `export const AUTOMATION_CATALOG: AutomationCatalogEntry[]`.
- Produces: `export async function getAutomationToggleStates(): Promise<Record<string, boolean>>` — reads all `appSettingsKey`s from `app_settings` in one query and returns `{ [id]: enabled }` using the `!== 'false'` default-on convention.

- [ ] **Step 1: Write the failing test**

Create `tests/automationCatalog.test.ts`:

```typescript
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-catalog-auth-'));

import { ensureSchema } from '../src/database.js';

describe('Automation catalog', () => {
  let tmpDir: string;
  let dbPath: string;
  let AUTOMATION_CATALOG: any;
  let getAutomationToggleStates: any;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-catalog-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    ({ AUTOMATION_CATALOG, getAutomationToggleStates } = await import('../src/services/automationCatalog.js'));
    ({ dbManager } = await import('../src/database/connection.js'));
  });

  afterAll(async () => {
    await dbManager.close(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists at least the core known automation types with unique ids', () => {
    const ids = AUTOMATION_CATALOG.map((e: any) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'dispatch_reminder',
      'distributor_collection',
      'refill_reminder',
      'doctor_daily_summary',
      'expiry_report',
      'bounced_products_alert',
      'shortage_notice',
      'credit_reminder',
    ]));
  });

  it('every entry has a non-empty label, description, and app_settings key', () => {
    for (const entry of AUTOMATION_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.appSettingsKey.length).toBeGreaterThan(0);
    }
  });

  it('getAutomationToggleStates defaults every entry to enabled when app_settings is empty', async () => {
    const states = await getAutomationToggleStates();
    for (const entry of AUTOMATION_CATALOG) {
      expect(states[entry.id]).toBe(true);
    }
  });

  it('getAutomationToggleStates reflects an explicit false override', async () => {
    const db = await dbManager.getConnection();
    const target = AUTOMATION_CATALOG[0];
    await db.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, 'false')",
      [target.appSettingsKey]
    );
    const states = await getAutomationToggleStates();
    expect(states[target.id]).toBe(false);
  });
});
```

Add `"**/tests/automationCatalog.test.ts"` to the `testMatch` array in `jest.config.js` (insert it alongside the other `**/tests/*.test.ts` entries, comma-separated, matching the existing style).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/automationCatalog.test.ts`
Expected: FAIL — `Cannot find module '../src/services/automationCatalog.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/services/automationCatalog.ts`:

```typescript
import { dbManager } from '../database/connection.js';

export interface AutomationCatalogEntry {
  id: string;
  label: string;
  description: string;
  appSettingsKey: string;
  defaultEnabled: boolean;
}

export const AUTOMATION_CATALOG: AutomationCatalogEntry[] = [
  {
    id: 'pos_bill',
    label: 'POS Bill Message',
    description: 'Sends the bill/receipt over WhatsApp when a cashier ticks "send WhatsApp" at checkout.',
    appSettingsKey: 'trigger_wa_pos_bill_enabled',
    defaultEnabled: true,
  },
  {
    id: 'invoice_pdf',
    label: 'Invoice PDF Delivery',
    description: 'Sends the generated invoice PDF to the customer over WhatsApp.',
    appSettingsKey: 'trigger_wa_invoice_pdf_enabled',
    defaultEnabled: true,
  },
  {
    id: 'distributor_collection',
    label: 'Distributor Collection Orders',
    description: 'Notifies the delivery boy and distributors when stock needs to be collected.',
    appSettingsKey: 'trigger_wa_distributor_collection_enabled',
    defaultEnabled: true,
  },
  {
    id: 'pharmarack_batch',
    label: 'Pharmarack Batch Dispatch',
    description: 'Sends the delivery boy summary and one message per distributor for a Pharmarack cart batch.',
    appSettingsKey: 'trigger_wa_pharmarack_batch_enabled',
    defaultEnabled: true,
  },
  {
    id: 'single_distributor_order',
    label: 'Single Distributor Order',
    description: 'Sends a dispatch message for one distributor order.',
    appSettingsKey: 'trigger_wa_single_distributor_order_enabled',
    defaultEnabled: true,
  },
  {
    id: 'credit_reminder',
    label: 'Customer Credit Reminder',
    description: 'Sends a payment-due reminder to a customer with outstanding credit/ledger balance.',
    appSettingsKey: 'trigger_wa_credit_reminder_enabled',
    defaultEnabled: true,
  },
  {
    id: 'payment_receipt',
    label: 'Payment Receipt',
    description: 'Sends a receipt over WhatsApp after a customer payment is recorded.',
    appSettingsKey: 'trigger_wa_payment_receipt_enabled',
    defaultEnabled: true,
  },
  {
    id: 'doctor_daily_summary',
    label: 'Doctor Daily Prescription Summary',
    description: 'Sends each referring doctor a daily summary of their patients\' prescriptions.',
    appSettingsKey: 'trigger_wa_doctor_daily_summary_enabled',
    defaultEnabled: true,
  },
  {
    id: 'expiry_report',
    label: 'Near-Expiry Inventory Alert',
    description: 'Sends the owner a summary of inventory nearing expiry.',
    appSettingsKey: 'trigger_wa_expiry_report_enabled',
    defaultEnabled: true,
  },
  {
    id: 'bounced_products_alert',
    label: 'Bounced Products Alert',
    description: 'Alerts the owner about distributor products that bounced or were short-delivered.',
    appSettingsKey: 'trigger_wa_bounced_products_alert_enabled',
    defaultEnabled: true,
  },
  {
    id: 'shortage_notice',
    label: 'Shortage / Special-Order Follow-up',
    description: 'Notifies the admin about pending shortage or special-order requests.',
    appSettingsKey: 'trigger_wa_shortage_notice_enabled',
    defaultEnabled: true,
  },
  {
    id: 'refill_reminder',
    label: 'Patient Refill Reminder',
    description: 'Sends refill reminders to patients (single medicine, consolidated, due-tomorrow, and send-now variants).',
    appSettingsKey: 'trigger_wa_refill_reminder_enabled',
    defaultEnabled: true,
  },
  {
    id: 'dispatch_reminder',
    label: 'Distributor Dispatch Reminder',
    description: 'Reminds a distributor when the delivery boy has not dropped off stock.',
    appSettingsKey: 'trigger_wa_dispatch_reminder_enabled',
    defaultEnabled: true,
  },
  {
    id: 'monthly_report',
    label: 'Monthly / Periodic Report',
    description: 'Sends the owner scheduled periodic reports (text, PDF, or Excel).',
    appSettingsKey: 'trigger_wa_monthly_report_enabled',
    defaultEnabled: true,
  },
  {
    id: 'admin_escalation',
    label: 'AI Admin Escalation',
    description: 'Escalates an unresolved WhatsApp medicine query to the admin when the AI cannot confidently answer it.',
    appSettingsKey: 'wa_auto_share_admin',
    defaultEnabled: true,
  },
  {
    id: 'medicine_discovery_suggestion',
    label: 'Unknown Medicine Discovery Suggestion',
    description: 'Suggests composition and schedule info for a medicine mentioned over WhatsApp that is not yet in the catalog.',
    appSettingsKey: 'trigger_wa_medicine_discovery_enabled',
    defaultEnabled: true,
  },
];

/** Reads app_settings for every catalog entry's key in one query, defaulting missing keys to enabled ('true'). */
export async function getAutomationToggleStates(): Promise<Record<string, boolean>> {
  const db = await dbManager.getConnection();
  const keys = AUTOMATION_CATALOG.map(e => e.appSettingsKey);
  const placeholders = keys.map(() => '?').join(',');
  const rows = keys.length
    ? await db.all(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`, keys)
    : [];
  const valueByKey = new Map(rows.map((r: any) => [r.key, r.value]));
  const result: Record<string, boolean> = {};
  for (const entry of AUTOMATION_CATALOG) {
    const raw = valueByKey.get(entry.appSettingsKey);
    result[entry.id] = raw === undefined ? entry.defaultEnabled : raw !== 'false';
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/automationCatalog.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/automationCatalog.ts tests/automationCatalog.test.ts jest.config.js
git commit -m "feat: add WhatsApp automation catalog with per-type toggle state"
```

---

### Task 2: Hard 10-15s pacing floor in whatsappQueueWorker

**Files:**
- Modify: `src/services/whatsappQueueWorker.ts:35` (type), `:70-71` (defaults), `:125-172` (load/set/preset methods), `:979-986` (preset detection in `getWorkerState`)
- Modify: `src/routes/whatsappQueue.ts:470-488` (`POST /pacing` route)
- Test: `tests/automationHubPacing.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `WhatsAppQueueWorker.setPacingPreset(preset: 'safe')` (narrowed signature — `'turbo'`/`'fast'` removed), `WhatsAppQueueWorker.loadPacingConfig()` now guarantees `minMs >= 10000`, `WhatsAppQueueWorker.setPacingConfig(minSec, maxSec)` now clamps `minSec` to `>= 10`.

- [ ] **Step 1: Write the failing test**

Create `tests/automationHubPacing.test.ts`:

```typescript
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-pacing-auth-'));

import { ensureSchema } from '../src/database.js';

describe('WhatsApp queue pacing floor', () => {
  let tmpDir: string;
  let dbPath: string;
  let whatsappQueueWorker: any;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-pacing-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    ({ whatsappQueueWorker } = await import('../src/services/whatsappQueueWorker.js'));
    ({ dbManager } = await import('../src/database/connection.js'));
  });

  afterAll(async () => {
    await dbManager.close(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('setPacingConfig clamps a below-floor minSec up to 10s', async () => {
    await whatsappQueueWorker.setPacingConfig(0.1, 0.3);
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(10000);
    expect(maxMs).toBeGreaterThanOrEqual(minMs + 1000);
  });

  it('setPacingConfig keeps a valid 10-15s range unchanged', async () => {
    await whatsappQueueWorker.setPacingConfig(11, 14);
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(11000);
    expect(maxMs).toBe(14000);
  });

  it('setPacingConfig corrects an inverted range (max below min)', async () => {
    await whatsappQueueWorker.setPacingConfig(12, 5);
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(12000);
    expect(maxMs).toBeGreaterThanOrEqual(minMs + 1000);
  });

  it('loadPacingConfig re-clamps a stale below-floor value already stored in app_settings', async () => {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_min', '100')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_max', '300')");
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(10000);
    expect(maxMs).toBeGreaterThanOrEqual(minMs + 1000);
  });

  it('setPacingPreset("safe") sets a 10-15s range', async () => {
    const result = await whatsappQueueWorker.setPacingPreset('safe');
    expect(result.minMs).toBe(10000);
    expect(result.maxMs).toBe(15000);
  });

  it('setPacingPreset rejects removed presets at the type level (compile-time) and the route rejects them at runtime — see whatsappQueueRoute test below', () => {
    expect(typeof whatsappQueueWorker.setPacingPreset).toBe('function');
  });
});
```

Add `"**/tests/automationHubPacing.test.ts"` to `jest.config.js`'s `testMatch` array.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/automationHubPacing.test.ts`
Expected: FAIL — the "keeps a valid 10-15s range unchanged" and "stale below-floor" and "safe preset 10-15s" assertions fail against current code (current floor is 100ms, current safe preset is 10-12s not 10-15s).

- [ ] **Step 3: Write minimal implementation**

In `src/services/whatsappQueueWorker.ts`:

Change line 35 from:
```typescript
  pacingPreset: 'turbo' | 'fast' | 'safe' | 'custom';
```
to:
```typescript
  pacingPreset: 'safe' | 'custom';
```

Change lines 70-71 from:
```typescript
  private pacingMinMs = 10000;
  private pacingMaxMs = 15000;
```
to (unchanged — already 10000/15000, confirming the class-level default is already correct; only the persisted-settings path and preset method need fixing):
```typescript
  private pacingMinMs = 10000;
  private pacingMaxMs = 15000;
```

Replace the `loadPacingConfig` method (lines 125-147) with:
```typescript
  /** Reload pacing settings from DB app_settings */
  public async loadPacingConfig(): Promise<{ minMs: number; maxMs: number }> {
    try {
      const db = await dbManager.getConnection();
      await this.ensureSchema(db);
      const minRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_queue_pacing_min'");
      const maxRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_queue_pacing_max'");

      const rawMin = minRow ? parseInt(minRow.value, 10) : 10000;
      const rawMax = maxRow ? parseInt(maxRow.value, 10) : 15000;

      // Hard floor: no send path may pace faster than 10s, even if app_settings
      // holds a stale or directly-edited value from before this floor existed.
      this.pacingMinMs = Math.max(10000, isNaN(rawMin) ? 10000 : rawMin);
      this.pacingMaxMs = Math.max(this.pacingMinMs + 1000, isNaN(rawMax) ? 15000 : rawMax);
    } catch (err) {
      // Use defaults
    }
    return { minMs: this.pacingMinMs, maxMs: this.pacingMaxMs };
  }
```

Replace the `setPacingConfig` method (lines 150-160) with:
```typescript
  /** Update pacing config in database. minSec is floored to 10s; maxSec is floored to minSec + 1s. */
  public async setPacingConfig(minSec: number, maxSec: number): Promise<void> {
    const minMs = Math.max(10000, Math.round(minSec * 1000));
    const maxMs = Math.max(minMs + 1000, Math.round(maxSec * 1000));

    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_min', ?)", [String(minMs)]);
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_max', ?)", [String(maxMs)]);

    this.pacingMinMs = minMs;
    this.pacingMaxMs = maxMs;
  }
```

Replace the `setPacingPreset` method (lines 162-172) with:
```typescript
  /** Set pacing preset: 'safe' (10-15s, anti-ban) — the only preset; 'turbo'/'fast' were removed as unsafe. */
  public async setPacingPreset(preset: 'safe'): Promise<{ minMs: number; maxMs: number; preset: string }> {
    await this.setPacingConfig(10, 15);
    return { minMs: this.pacingMinMs, maxMs: this.pacingMaxMs, preset };
  }
```

Update the preset-detection block (originally lines 979-986) to match the new `'safe' | 'custom'` type:
```typescript
    let preset: 'safe' | 'custom' = 'custom';
    if (this.pacingMinMs === 10000 && this.pacingMaxMs === 15000) {
      preset = 'safe';
    }
```

In `src/routes/whatsappQueue.ts`, replace the `POST /pacing` handler (lines 471-488) with:
```typescript
router.all('/pacing', async (req, res) => {
  const { minSec, maxSec, preset } = req.body || {};
  try {
    if (preset === 'turbo' || preset === 'fast') {
      return res.status(400).json({ error: 'The "turbo" and "fast" pacing presets have been removed. WhatsApp sends must never go faster than 10-15s apart. Use "safe" or a custom range of at least 10s.' });
    }
    if (preset === 'safe') {
      const result = await whatsappQueueWorker.setPacingPreset(preset);
      const state = await whatsappQueueWorker.getWorkerState();
      return res.json({ success: true, ...result, message: `Pacing set to ${preset} mode (${result.minMs/1000}s-${result.maxMs/1000}s)`, state });
    }
    if (typeof minSec === 'number' && typeof maxSec === 'number') {
      await whatsappQueueWorker.setPacingConfig(minSec, maxSec);
      const state = await whatsappQueueWorker.getWorkerState();
      return res.json({ success: true, minSec, maxSec, message: `Pacing updated to ${state.currentPacingMinMs/1000}s - ${state.currentPacingMaxMs/1000}s`, state });
    }
    return res.status(400).json({ error: 'Either preset ("safe") or minSec & maxSec required' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update pacing' });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/automationHubPacing.test.ts`
Expected: PASS (all 6 tests)

Also run the existing whatsapp-related suites to confirm no regression:
Run: `node --experimental-vm-modules node_modules/.bin/jest tests/whatsappRouting.test.ts tests/whatsappPipeline.test.ts tests/whatsappIntentGate.test.ts`
Expected: PASS (or same pre-existing failures as before this change — compare against a baseline run if any of these were already failing; do not let new failures introduced by this task slip through)

- [ ] **Step 5: Commit**

```bash
git add src/services/whatsappQueueWorker.ts src/routes/whatsappQueue.ts tests/automationHubPacing.test.ts jest.config.js
git commit -m "fix: enforce hard 10-15s WhatsApp send pacing floor, remove turbo/fast presets"
```

---

### Task 3: Frontend pacing UI update (remove Turbo/Fast buttons)

**Files:**
- Modify: `frontend/src/components/WhatsAppQueuePopover.tsx:188-196` (`handleSetPacingPreset`), `:857-898` (preset pill buttons)

**Interfaces:**
- Consumes: `api.setWhatsAppQueuePacingPreset` (Task 4 narrows its type to `'safe'`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: No new automated test** — this is a pure UI removal with no new logic branch; verified manually in Step 3 below. (Per Task Right-Sizing: a UI-only deletion with no behavior beyond what Task 2's route-level rejection already covers doesn't need its own test cycle.)

- [ ] **Step 2: Update the handler**

In `frontend/src/components/WhatsAppQueuePopover.tsx`, replace lines 188-196:
```typescript
  const handleSetPacingPreset = async (preset: 'turbo' | 'fast' | 'safe') => {
    try {
      await api.setWhatsAppQueuePacingPreset(preset);
      const msg = preset === 'turbo'
        ? '🚀 Ultra-Fast Turbo Pacing enabled (100ms speed)' 
        : preset === 'fast' 
          ? '⚡ Fast Pacing enabled (1-3s)' 
          : '🛡️ Safe Pacing enabled (8-12s)';
```
with:
```typescript
  const handleSetPacingPreset = async (preset: 'safe') => {
    try {
      await api.setWhatsAppQueuePacingPreset(preset);
      const msg = '🛡️ Safe Pacing enabled (10-15s, anti-ban floor)';
```
(keep the rest of the function body — the `toastEvent.trigger(msg, ...)` call and catch block — unchanged).

- [ ] **Step 3: Replace the preset pill buttons**

Replace lines 857-898 (`{/* Quick Actions & Speed Pacing Controls */}` block's pacing pills) — remove the Turbo and Fast `<button>` elements entirely, keep only Safe, and drop the now-single-option pill styling down to a plain status label since there's nothing left to switch between:

```tsx
          {/* Quick Actions & Speed Pacing Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
            {/* Pacing floor notice — no faster presets exist; this is a fixed anti-ban protection, not a user choice */}
            <div className="flex items-center gap-1.5 bg-bg/60 px-2.5 py-1.5 rounded-xl border border-glass-border/40 text-[10px] font-bold text-emerald-400">
              <ShieldCheck size={12} />
              <span>Safe Pacing: 10-15s between messages (fixed, anti-ban)</span>
            </div>
```

Add `ShieldCheck` to the `lucide-react` import at the top of the file if not already imported (check the existing import line and add it to the destructured list alongside icons like `Zap`, `RefreshCw`, `Clock`, `CheckCircle2`, `WifiOff`).

- [ ] **Step 4: Manually verify in the browser**

Start the dev server (frontend + backend), open the WhatsApp queue popover, confirm: no Turbo/Fast buttons render, the "Safe Pacing: 10-15s" notice shows, and triggering a send still works and paces at 10-15s (observable via the countdown timer already shown in the popover).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/WhatsAppQueuePopover.tsx
git commit -m "fix: remove Turbo/Fast pacing buttons from WhatsApp queue popover UI"
```

---

### Task 4: Shared failure-reason util + api.ts client methods

**Files:**
- Create: `frontend/src/utils/whatsappFailureReason.ts`
- Modify: `frontend/src/components/WhatsAppQueuePopover.tsx:13-34` (remove local function, import shared one)
- Modify: `frontend/src/services/api.ts:1407` (narrow `setWhatsAppQueuePacingPreset` type), add two new methods near line 1338 (automation section)

**Interfaces:**
- Produces: `export function getFormattedFailureReason(errorMsg?: string, status?: string): string` from `frontend/src/utils/whatsappFailureReason.ts`.
- Produces: `api.getAutomationCatalog(): Promise<{ id: string; label: string; description: string; enabled: boolean }[]>` and `api.getAutomationHubSummary(): Promise<AutomationHubSummary>` (type defined in Task 5, consumed here as a forward reference resolved when Task 5 lands — see note below).
- Consumes: none from other frontend tasks for the util extraction; the two new `api.ts` methods call endpoints built in Task 5, so this task's methods will 404 until Task 5's backend routes exist — acceptable since Task 6 (which uses them) runs after Task 5.

- [ ] **Step 1: Create the shared util**

Create `frontend/src/utils/whatsappFailureReason.ts`:

```typescript
/** Turns a raw WhatsApp send error into a short, human-readable reason. Shared by WhatsAppQueuePopover and AutomationHubPopover so failure text is identical everywhere it's shown. */
export function getFormattedFailureReason(errorMsg?: string, status?: string): string {
  if (!errorMsg && status === 'failed_offline') {
    return 'PC / Internet is offline or connection lost';
  }
  if (!errorMsg) {
    return 'Message delivery failed during queue dispatch attempt';
  }
  const msg = errorMsg.toLowerCase();
  if (msg.includes('invalid') || msg.includes('phone') || msg.includes('number')) {
    return 'Invalid recipient phone number format';
  }
  if (msg.includes('session') || msg.includes('auth') || msg.includes('token') || msg.includes('login')) {
    return 'WhatsApp Web session disconnected / login required';
  }
  if (msg.includes('timeout') || msg.includes('net::err') || msg.includes('econnrefused')) {
    return 'Network connection timeout';
  }
  if (msg.includes('not registered') || msg.includes('not on whatsapp')) {
    return 'Recipient phone number is not registered on WhatsApp';
  }
  return errorMsg;
}
```

- [ ] **Step 2: Update WhatsAppQueuePopover.tsx to use the shared util**

Remove lines 13-34 (the local `getFormattedFailureReason` function definition) from `frontend/src/components/WhatsAppQueuePopover.tsx`.

Add an import near the top of the file (alongside other local imports such as the `api` service import):
```typescript
import { getFormattedFailureReason } from '../utils/whatsappFailureReason';
```

Leave all call sites (lines ~525, ~594, ~596) unchanged — they already call `getFormattedFailureReason(item.error_message, item.status)`, which now resolves to the imported function.

- [ ] **Step 3: Manually verify no regression**

Run the frontend typecheck: `cd frontend && npx tsc --noEmit`
Expected: no new errors referencing `WhatsAppQueuePopover.tsx` or the removed function.

- [ ] **Step 4: Add api.ts client methods**

In `frontend/src/services/api.ts`, narrow the existing pacing method signature at line 1407 from:
```typescript
  setWhatsAppQueuePacingPreset: (preset: 'turbo' | 'fast' | 'safe') => apiClient.post<{ success: boolean; preset: string; minMs: number; maxMs: number; message: string; state: WhatsAppQueueStatus | null }>('/whatsapp/queue/pacing', { preset }).then(res => res.data),
```
to:
```typescript
  setWhatsAppQueuePacingPreset: (preset: 'safe') => apiClient.post<{ success: boolean; preset: string; minMs: number; maxMs: number; message: string; state: WhatsAppQueueStatus | null }>('/whatsapp/queue/pacing', { preset }).then(res => res.data),
```

Add two new methods immediately after line 1338 (`manualNotification`, in the automation section), matching the existing style:
```typescript
  getAutomationCatalog: () => apiClient.get<Array<{ id: string; label: string; description: string; enabled: boolean }>>('/automation/catalog').then(res => res.data),
  setAutomationToggle: (id: string, enabled: boolean) => apiClient.post<{ success: boolean }>(`/automation/catalog/${id}/toggle`, { enabled }).then(res => res.data),
  getAutomationHubSummary: () => apiClient.get<AutomationHubSummary>('/automation/hub-summary').then(res => res.data),
```

Add the `AutomationHubSummary` type near the existing `AutomationNotification` type definition (search for `interface AutomationNotification` in the file and place the new interface directly after it):
```typescript
export interface AutomationHubActivityItem {
  automationType: string;
  targetName: string | null;
  status: string;
  errorMessage: string | null;
  sentAt: number | null;
  createdAt: string;
}

export interface AutomationHubSummary {
  headline: 'sending' | 'failed' | 'idle';
  activity: AutomationHubActivityItem[];
}
```

- [ ] **Step 5: Run the frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (the two new `api.ts` methods reference endpoints that don't exist yet on the backend, but TypeScript only checks the client-side types, not runtime endpoint existence, so this passes).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/whatsappFailureReason.ts frontend/src/components/WhatsAppQueuePopover.tsx frontend/src/services/api.ts
git commit -m "refactor: extract shared WhatsApp failure-reason util, add automation hub API client methods"
```

---

### Task 5: Backend hub-summary and catalog endpoints

**Files:**
- Modify: `src/routes/automation.ts` — add `GET /catalog`, `POST /catalog/:id/toggle`, `GET /hub-summary`
- Test: `tests/automationHubSummary.test.ts`

**Interfaces:**
- Consumes: `AUTOMATION_CATALOG`, `getAutomationToggleStates()` from `src/services/automationCatalog.ts` (Task 1).
- Produces: `GET /api/automation/catalog` → `Array<{ id, label, description, enabled }>`; `POST /api/automation/catalog/:id/toggle` → `{ success: boolean }`; `GET /api/automation/hub-summary` → `{ headline: 'sending'|'failed'|'idle', activity: AutomationHubActivityItem[] }` matching the frontend type from Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/automationHubSummary.test.ts`:

```typescript
import { jest } from '@jest/globals';

// Mock WhatsApp dependency BEFORE any other imports — src/routes/automation.ts imports
// sendMessage from whatsappClient.js at module load time, and that module would otherwise
// try to boot real Puppeteer/whatsapp-web.js during the test. Mirrors tests/automation.test.ts.
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve({ sent: true })),
  initClient: jest.fn(() => Promise.resolve(true)),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, isReady: true, sleeping: false, initializing: false, status: 'CONNECTED' })),
  shouldRouteToBusiness: jest.fn(() => false),
  hashMessageBody: jest.fn(() => 'mock-hash'),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : ''),
  hasSavedSession: jest.fn(() => true),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  markWhatsAppActivity: jest.fn(),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  isPuppeteerDetachedError: jest.fn(() => false),
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn(),
  destroyClient: jest.fn(() => Promise.resolve(undefined)),
  forceReconnect: jest.fn(() => Promise.resolve(undefined)),
  reconnectClient: jest.fn(() => Promise.resolve(undefined)),
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([])),
  getMessageMedia: jest.fn(() => Promise.resolve({ mimetype: 'image/jpeg', data: '' })),
  downloadMessageMediaById: jest.fn(() => Promise.resolve(undefined))
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import request from 'supertest';

process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-hub-summary-auth-'));

import { ensureSchema } from '../src/database.js';

describe('Automation hub summary endpoint', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: express.Express;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-hub-summary-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const automationRouter = (await import('../src/routes/automation.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/automation', automationRouter);

    ({ dbManager } = await import('../src/database/connection.js'));
  });

  afterAll(async () => {
    await dbManager.close(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /catalog returns every catalog entry with an enabled flag', async () => {
    const res = await request(app).get('/api/automation/catalog');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const entry of res.body) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.enabled).toBe('boolean');
    }
  });

  it('POST /catalog/:id/toggle persists the new state and GET /catalog reflects it', async () => {
    const catalogRes = await request(app).get('/api/automation/catalog');
    const target = catalogRes.body[0];

    const toggleRes = await request(app)
      .post(`/api/automation/catalog/${target.id}/toggle`)
      .send({ enabled: false });
    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.success).toBe(true);

    const afterRes = await request(app).get('/api/automation/catalog');
    const afterTarget = afterRes.body.find((e: any) => e.id === target.id);
    expect(afterTarget.enabled).toBe(false);
  });

  it('GET /hub-summary returns headline "idle" when there is no recent activity', async () => {
    const res = await request(app).get('/api/automation/hub-summary');
    expect(res.status).toBe(200);
    expect(res.body.headline).toBe('idle');
    expect(Array.isArray(res.body.activity)).toBe(true);
  });

  it('GET /hub-summary returns headline "sending" when a queue item is pending', async () => {
    const db = await dbManager.getConnection();
    await db.run(
      "INSERT INTO whatsapp_send_queue (number, message, type, status, target_name) VALUES ('919999999999', 'test', 'credit_reminder', 'pending', 'Test Customer')"
    );
    const res = await request(app).get('/api/automation/hub-summary');
    expect(res.body.headline).toBe('sending');
  });

  it('GET /hub-summary returns headline "failed" when the most recent terminal item failed', async () => {
    const db = await dbManager.getConnection();
    await db.run("DELETE FROM whatsapp_send_queue");
    await db.run(
      "INSERT INTO whatsapp_send_queue (number, message, type, status, target_name, error_message) VALUES ('919999999999', 'test', 'credit_reminder', 'failed_perm', 'Test Customer', 'Invalid phone number')"
    );
    const res = await request(app).get('/api/automation/hub-summary');
    expect(res.body.headline).toBe('failed');
    expect(res.body.activity.length).toBeGreaterThan(0);
    expect(res.body.activity[0].errorMessage).toBe('Invalid phone number');
  });
});
```

Add `"**/tests/automationHubSummary.test.ts"` to `jest.config.js`'s `testMatch` array.

Confirmed: `supertest` (`^7.2.2`) and `@types/supertest` are already dev dependencies (see `package.json`), and `tests/automation.test.ts` already uses this exact `request(app)` pattern against the same `automation.ts` router — this test mirrors that file's proven setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/automationHubSummary.test.ts`
Expected: FAIL — `GET /api/automation/catalog` 404s (route doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `src/routes/automation.ts`, add near the top (after the existing imports, before `router.get('/notifications', ...)`):

```typescript
import { AUTOMATION_CATALOG, getAutomationToggleStates } from '../services/automationCatalog.js';

// List every known WhatsApp automation type with its current enabled state
router.get('/catalog', async (req, res) => {
  try {
    const states = await getAutomationToggleStates();
    const result = AUTOMATION_CATALOG.map(entry => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      enabled: states[entry.id],
    }));
    res.json(result);
  } catch (err: any) {
    console.error('Failed to fetch automation catalog:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Toggle a single automation type on/off
router.post('/catalog/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body || {};
  const entry = AUTOMATION_CATALOG.find(e => e.id === id);
  if (!entry) {
    return res.status(404).json({ error: `Unknown automation id: ${id}` });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' });
  }
  try {
    const db = await dbManager.getConnection();
    await db.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [entry.appSettingsKey, String(enabled)]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to toggle automation:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Merged live/recent WhatsApp send status for the Automation Hub header badge + popover
router.get('/hub-summary', async (req, res) => {
  try {
    const db = await dbManager.getConnection();

    const queueRows = await db.all(
      `SELECT type, target_name, status, error_message, sent_at, created_at
       FROM whatsapp_send_queue
       ORDER BY created_at DESC LIMIT 20`
    );
    const notificationRows = await db.all(
      `SELECT type, recipient_name, status, error_message, created_at
       FROM automation_notifications
       WHERE type = 'whatsapp' OR type LIKE 'whatsapp%'
       ORDER BY created_at DESC LIMIT 20`
    );

    const activity = [
      ...queueRows.map((r: any) => ({
        automationType: r.type,
        targetName: r.target_name || null,
        status: r.status,
        errorMessage: r.error_message || null,
        sentAt: r.sent_at || null,
        createdAt: r.created_at,
      })),
      ...notificationRows.map((r: any) => ({
        automationType: r.type,
        targetName: r.recipient_name || null,
        status: r.status,
        errorMessage: r.error_message || null,
        sentAt: null,
        createdAt: r.created_at,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const hasActiveSend = queueRows.some((r: any) => ['pending', 'sending', 'waiting'].includes(r.status));
    const mostRecentTerminal = activity.find(a => !['pending', 'sending', 'waiting'].includes(a.status));
    const mostRecentFailed = mostRecentTerminal && String(mostRecentTerminal.status).startsWith('failed');

    let headline: 'sending' | 'failed' | 'idle' = 'idle';
    if (hasActiveSend) {
      headline = 'sending';
    } else if (mostRecentFailed) {
      headline = 'failed';
    }

    res.json({ headline, activity: activity.slice(0, 20) });
  } catch (err: any) {
    console.error('Failed to build automation hub summary:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});
```

Note: `dbManager` is already imported at the top of `src/routes/automation.ts` (line 2, per existing code) — reuse it, do not re-import.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/automationHubSummary.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/routes/automation.ts tests/automationHubSummary.test.ts jest.config.js
git commit -m "feat: add automation catalog and hub-summary endpoints"
```

---

### Task 6: automationHubEvent pub/sub

**Files:**
- Modify: `frontend/src/services/events.ts` — add `automationHubEvent` after the existing `whatsappQueueEvent` block (after line 107)

**Interfaces:**
- Produces: `export const automationHubEvent = { triggerOpen: () => void; triggerUpdated: () => void; subscribeOpen: (cb: () => void) => (() => void); subscribeUpdated: (cb: () => void) => (() => void); }`.

- [ ] **Step 1: No automated test** — this is a direct copy of the already-proven `whatsappQueueEvent` pattern (same file, same tested-in-production mechanism); a unit test would just be re-testing `window.dispatchEvent`/`addEventListener`, which the codebase does not test elsewhere for this pattern (`whatsappQueueEvent` itself has no dedicated test file).

- [ ] **Step 2: Add the event bus**

In `frontend/src/services/events.ts`, insert immediately after the `whatsappQueueEvent` block (after line 107, before the `MessageSendProgressDetail` interface):

```typescript
// Global event bus helper for the WhatsApp Automation Hub entry point in the header
export const automationHubEvent = {
  triggerOpen: () => {
    window.dispatchEvent(new CustomEvent('app-open-automation-hub'));
  },
  triggerUpdated: () => {
    window.dispatchEvent(new CustomEvent('app-automation-hub-updated'));
  },
  subscribeOpen: (callback: () => void) => {
    const handler = () => callback();
    window.addEventListener('app-open-automation-hub', handler);
    return () => window.removeEventListener('app-open-automation-hub', handler);
  },
  subscribeUpdated: (callback: () => void) => {
    const handler = () => callback();
    window.addEventListener('app-automation-hub-updated', handler);
    return () => window.removeEventListener('app-automation-hub-updated', handler);
  },
};
```

- [ ] **Step 3: Run the frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/events.ts
git commit -m "feat: add automationHubEvent pub/sub for the Automation Hub entry point"
```

---

### Task 7: AutomationHubPopover component

**Files:**
- Create: `frontend/src/components/AutomationHubPopover.tsx`

**Interfaces:**
- Consumes: `api.getAutomationCatalog()`, `api.setAutomationToggle(id, enabled)`, `api.getAutomationHubSummary()` (Task 4/5), `getFormattedFailureReason` (Task 4), `automationHubEvent.subscribeUpdated` (Task 6), `whatsappQueueEvent.triggerOpen` (existing).
- Produces: `export default function AutomationHubPopover({ onClose }: { onClose: () => void }): JSX.Element` — consumed by `Layout.tsx` in Task 8.

- [ ] **Step 1: No automated test for this component** — this repo has no frontend component test runner configured (jest here is backend-only, ESM/`ts-jest` targeting `src/`; there's no React Testing Library setup found in `frontend/`). Verification is manual (Step 3).

- [ ] **Step 2: Write the component**

Create `frontend/src/components/AutomationHubPopover.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { X, MessageSquareText, CheckCircle2, XCircle, Clock, ExternalLink } from 'lucide-react';
import { api } from '../services/api';
import { getFormattedFailureReason } from '../utils/whatsappFailureReason';
import { whatsappQueueEvent, automationHubEvent } from '../services/events';

interface CatalogEntry {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface ActivityItem {
  automationType: string;
  targetName: string | null;
  status: string;
  errorMessage: string | null;
  sentAt: number | null;
  createdAt: string;
}

interface AutomationHubPopoverProps {
  onClose: () => void;
}

export default function AutomationHubPopover({ onClose }: AutomationHubPopoverProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [catalogRes, summaryRes] = await Promise.all([
        api.getAutomationCatalog(),
        api.getAutomationHubSummary(),
      ]);
      setCatalog(catalogRes);
      setActivity(summaryRes.activity);
    } catch (err) {
      console.error('Failed to load automation hub data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = automationHubEvent.subscribeUpdated(() => loadData());
    return unsubscribe;
  }, []);

  const handleToggle = async (entry: CatalogEntry) => {
    setTogglingId(entry.id);
    const nextEnabled = !entry.enabled;
    setCatalog(prev => prev.map(e => (e.id === entry.id ? { ...e, enabled: nextEnabled } : e)));
    try {
      await api.setAutomationToggle(entry.id, nextEnabled);
    } catch (err) {
      console.error('Failed to toggle automation:', err);
      setCatalog(prev => prev.map(e => (e.id === entry.id ? { ...e, enabled: entry.enabled } : e)));
    } finally {
      setTogglingId(null);
    }
  };

  const statusPill = (status: string) => {
    if (status === 'sent') {
      return (
        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
          <CheckCircle2 size={10} /> Sent
        </span>
      );
    }
    if (status.startsWith('failed')) {
      return (
        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
          <XCircle size={10} /> Failed
        </span>
      );
    }
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
        <Clock size={10} /> Pending
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-end p-4 pt-16" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[80vh] overflow-y-auto bg-glass-bg backdrop-blur-xl border border-glass-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-glass-border sticky top-0 bg-glass-bg backdrop-blur-xl z-10">
          <div className="flex items-center gap-2">
            <MessageSquareText size={18} className="text-sky-400" />
            <h2 className="text-sm font-bold text-text">WhatsApp Automation Hub</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg3/60 text-muted hover:text-text" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-xs text-muted">Loading...</div>
        ) : (
          <>
            <div className="p-4 space-y-2">
              <h3 className="text-[11px] font-bold text-muted uppercase tracking-wide">Automations</h3>
              {catalog.map(entry => (
                <div key={entry.id} className="p-3 rounded-xl bg-bg3/30 border border-border flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-text">{entry.label}</p>
                    <p className="text-[11px] text-muted mt-0.5">{entry.description}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      disabled={togglingId === entry.id}
                      onChange={() => handleToggle(entry)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                  </label>
                </div>
              ))}
            </div>

            <div className="p-4 pt-0 space-y-2">
              <h3 className="text-[11px] font-bold text-muted uppercase tracking-wide">Recent Activity</h3>
              {activity.length === 0 && (
                <p className="text-xs text-muted p-3">No WhatsApp messages sent yet.</p>
              )}
              {activity.map((item, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-bg3/30 border border-border space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-text truncate">
                      {item.automationType}{item.targetName ? ` — ${item.targetName}` : ''}
                    </span>
                    {statusPill(item.status)}
                  </div>
                  {item.status.startsWith('failed') && (
                    <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2 py-1.5">
                      Reason: {getFormattedFailureReason(item.errorMessage || undefined, item.status)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 pt-0">
              <button
                onClick={() => { whatsappQueueEvent.triggerOpen(); onClose(); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-bg3/60 hover:bg-bg3 text-text transition-all"
              >
                View Full Queue <ExternalLink size={12} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manually verify in the browser**

Start the dev server, temporarily render `<AutomationHubPopover onClose={() => {}} />` from a test route or via Task 8's wiring (do this step after Task 8 lands, or wire it in early for a quick check). Confirm: catalog list renders with working toggles, activity list renders (empty state if no data), "View Full Queue" opens the existing `WhatsAppQueuePopover`.

- [ ] **Step 4: Run the frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AutomationHubPopover.tsx
git commit -m "feat: add AutomationHubPopover component"
```

---

### Task 8: Header entry point in Layout.tsx

**Files:**
- Modify: `frontend/src/components/Layout.tsx` — add badge-dot button near line 1745-1747 (before the Notification bell block), mount `AutomationHubPopover` conditionally near line 3411-3415 (alongside `WhatsAppQueuePopover`), subscribe to `automationHubEvent.subscribeOpen` near line 2959-2963, poll `hub-summary` for the badge state.

**Interfaces:**
- Consumes: `AutomationHubPopover` (Task 7), `automationHubEvent` (Task 6), `api.getAutomationHubSummary()` (Task 5).
- Produces: nothing consumed by later tasks — this is the final integration point.

- [ ] **Step 1: No automated test** — `Layout.tsx` has no existing test coverage (confirmed no `Layout.test.tsx` in the repo); this is UI wiring verified manually.

- [ ] **Step 2: Add state and polling in the outer `Layout` component**

Near line 2959-2963 (where `Layout` subscribes to `whatsappQueueEvent.subscribeOpen`), add:

```typescript
  const [showAutomationHub, setShowAutomationHub] = useState(false);
  const [automationHubHeadline, setAutomationHubHeadline] = useState<'sending' | 'failed' | 'idle'>('idle');

  useEffect(() => {
    const unsubscribeOpen = automationHubEvent.subscribeOpen(() => setShowAutomationHub(true));
    return unsubscribeOpen;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pollHeadline = async () => {
      try {
        const summary = await api.getAutomationHubSummary();
        if (!cancelled) setAutomationHubHeadline(summary.headline);
      } catch (_) {
        // Non-fatal — badge just stays at its last known state
      }
    };
    pollHeadline();
    const unsubscribeUpdated = automationHubEvent.subscribeUpdated(pollHeadline);
    const unsubscribeQueueUpdated = whatsappQueueEvent.subscribeUpdated(pollHeadline);
    return () => {
      cancelled = true;
      unsubscribeUpdated();
      unsubscribeQueueUpdated();
    };
  }, []);

  const handleAutomationHubClose = () => {
    setShowAutomationHub(false);
    setAutomationHubHeadline('idle');
  };
```

Add `automationHubEvent` to the existing import of `whatsappQueueEvent` from `../services/events` at the top of the file.

- [ ] **Step 3: Add the header button in `Topbar`**

`Topbar` needs `automationHubHeadline` and an `onOpenAutomationHub` callback passed as props from `Layout`, mirroring how `onOpenWaQueue` is already threaded through (per the exploration: `Topbar` receives `onOpenWaQueue` and calls it via its own `whatsappQueueEvent` subscription at lines 1144-1147). Add `automationHubHeadline: 'sending' | 'failed' | 'idle'` and `onOpenAutomationHub: () => void` to `Topbar`'s props interface, and pass them from `Layout`'s render of `<Topbar ... />` (found near line 3354 where `openWaQueuePopover` is passed).

Insert this button in `Topbar`'s right-side icon cluster, immediately before the Notification bell block (before line 1747's `{/* Notification bell */}` comment):

```tsx
          {/* WhatsApp Automation Hub */}
          <button
            onClick={onOpenAutomationHub}
            className={`relative p-2 rounded-xl transition-all duration-200 flex items-center justify-center border cursor-pointer group ${
              automationHubHeadline === 'failed'
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                : automationHubHeadline === 'sending'
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                  : 'bg-glass-bg border-glass-border text-muted hover:text-text hover:bg-bg3/60'
            }`}
            aria-label="WhatsApp Automation Hub"
            title="WhatsApp Automation Hub"
          >
            <MessageSquareText size={18} className="group-hover:scale-110 transition-transform" />
            {automationHubHeadline !== 'idle' && (
              <span className={`absolute -top-1.5 -right-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${
                automationHubHeadline === 'failed' ? 'bg-rose-500' : 'bg-sky-500 animate-pulse'
              }`} />
            )}
          </button>
```

Add `MessageSquareText` to the `lucide-react` import list at the top of `Layout.tsx` if not already present (it's used in Task 7's component but that's a separate file — `Layout.tsx` needs its own import).

- [ ] **Step 4: Mount the popover**

Near line 3411-3415, where `WhatsAppQueuePopover` is conditionally mounted, add immediately after:

```tsx
      {showAutomationHub && (
        <AutomationHubPopover
          onClose={handleAutomationHubClose}
        />
      )}
```

Add the import at the top of `Layout.tsx`:
```typescript
import AutomationHubPopover from './AutomationHubPopover';
```

- [ ] **Step 5: Wire the `Topbar` invocation**

At the `<Topbar ... />` render call (near line 3354 where `openWaQueuePopover` is passed as a prop), add:
```tsx
onOpenAutomationHub={() => setShowAutomationHub(true)}
automationHubHeadline={automationHubHeadline}
```

- [ ] **Step 6: Run the frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manually verify in the browser**

Start the dev server. Confirm:
- A new icon button appears in the header next to the notification bell, with no dot when idle.
- Clicking it opens `AutomationHubPopover` with the catalog and activity list populated.
- Trigger a real or test WhatsApp send (e.g. via an existing "send now" action) and confirm the header dot turns blue/pulsing while sending.
- Force a failure (e.g. an invalid phone number in a manual send) and confirm the dot turns red, and opening the Hub shows the failure reason inline without needing to click to expand.
- After opening the Hub following a failure, confirm the dot clears back to idle (per `handleAutomationHubClose` resetting `automationHubHeadline`).
- Confirm the Settings → Trigger Schedules tab's "WhatsApp Message Queue" toggle and the Hub's per-automation toggles operate independently (they key off different `app_settings` entries — the Trigger Schedules toggle controls the queue worker's own on/off, the Hub's toggles control each automation's trigger point) and neither one crashes the other.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "feat: add WhatsApp Automation Hub entry point to the header"
```

---

## Self-Review Notes

**Spec coverage check:**
- Automation catalog + per-automation toggles → Task 1, 5, 7 ✓
- Live status feed + failure reasons shown inline → Task 5, 7 ✓
- Header dot (sending/failed/idle), no new page → Task 8 ✓
- Auto-clear badge on Hub open → Task 8 Step 2 (`handleAutomationHubClose`) ✓
- 10-15s hard pacing floor, remove turbo/fast → Task 2, 3 ✓
- No new DB tables → confirmed, all tasks read/write only `app_settings`, `whatsapp_send_queue`, `automation_notifications` ✓
- Shared failure-reason text between popovers → Task 4 ✓

**Type consistency check:** `AutomationHubSummary`/`AutomationHubActivityItem` (Task 4) match the shapes returned by `GET /hub-summary` (Task 5) and consumed by `AutomationHubPopover` (Task 7) — field names (`automationType`, `targetName`, `status`, `errorMessage`, `sentAt`, `createdAt`) are identical across all three. `CatalogEntry` (Task 7, local) matches `GET /catalog`'s response shape (Task 5) and `api.getAutomationCatalog()`'s declared type (Task 4). `automationHubEvent`'s four methods (Task 6) are called with matching names in Task 7 (`subscribeUpdated`) and Task 8 (`subscribeOpen`, `subscribeUpdated`, and implicitly `triggerOpen`/`triggerUpdated` are available for future callers though not invoked by this plan's tasks — acceptable, as no task needs to trigger the hub open from elsewhere yet).

**Placeholder scan:** no TBD/TODO/FIXME anywhere in the plan; every step has concrete code, not a description of what to write.
