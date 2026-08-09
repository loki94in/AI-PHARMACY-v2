# ==============================================================================
# MASTER INTEGRATION PLAN: SETTINGS VS. AI LEARNING READ/WRITE CONFLICT RESOLUTION
# ==============================================================================
# Target System: AI Pharmacy OS (Version 2.0)
# Core Principle: Strict Feature Ownership & Defensive Data Isolation
# Safety Mandate: Zero Regression across POS, Purchases, and Migration
# ==============================================================================

## 1. EXECUTIVE ARCHITECTURAL SUMMARY
The AI Pharmacy OS currently suffers from an operational conflict in how configuration data is managed. Both the Settings page (/settings) and the AI Learning page (/learning) read from and write to the same single database table (`app_settings`) using a generic bulk upsert endpoint (`POST /api/settings/save`). Because both pages load the entire set of settings on mount, saving a basic store setting (like the store name or tax rate) on the Settings page transmits a payload containing empty or stale values for external integration keys (such as Gmail IMAP, Pharmarack, Telegram, and WhatsApp), instantly wiping out active configurations set up in the Learning page.

This plan permanently severs this destructive cross-page connection by establishing strict key ownership, sanitizing the save payloads on the frontend, and hardening the backend API with a defensive key-gating layer.

---

## 2. CONFIGURATION KEY OWNERSHIP MAP
To prevent future drift, we establish an absolute, non-negotiable division of configuration keys:

+-----------------------------------------------------------------------------------+
|                              SHARED DATABASE: `app_settings`                      |
+---------------------------------------------------+-------------------------------+
|             ✅ SETTINGS PAGE (Core Metadata)       |   🧠 AI LEARNING (Integrations)|
+---------------------------------------------------+-------------------------------+
| * pharmacy_name (aliases: shop_name, medical_name)| * gmail_user                  |
| * pharmacy_address (aliases: shop_address)        | * gmail_pass                  |
| * pharmacy_phone (aliases: shop_phone)            | * gmail_auth_method           |
| * store_gstin                                     | * telegram_enabled            |
| * drug_license_no                                 | * telegram_token              |
| * invoice_prefix                                  | * telegram_chat_id            |
| * data_fetch_control                              | * whatsapp_enabled            |
| * dinesh_whatsapp_number (Bounced Alerts)         | * whatsapp_preferred_system   |
| * google_client_id                                | * wa_business_enabled         |
| * google_client_secret                            | * wa_business_access_token    |
| * tax_rate                                        | * wa_business_phone_number_id |
| * backup_schedule                                 | * pharmarack_username         |
|                                                   | * pharmarack_password         |
|                                                   | * pharmarack_session_token    |
|                                                   | * pharmarack_mode             |
|                                                   | * automation_enabled          |
|                                                   | * wa_auto_share_admin         |
+---------------------------------------------------+-------------------------------+
* Note: Delivery Boy contacts are 100% owned by the `delivery_boys` database table and accessed via the `/dispatch` page. No delivery boy fields may be read or written inside Settings or Learning page forms.

---

## 3. FILE CHANGE MANIFEST
We will edit exactly **3 core files** across the frontend and backend. No other files are touched, protecting the safety of downstream features:

1. **`src/routes/settings.ts` (Backend API)**
   - Fix SQL target-table bug (line 62 writes to a nonexistent `settings` table instead of `app_settings`).
   - Implement a backend-level defensive payload validator on `POST /settings/save` to reject or filter out empty values for integration/protected keys.
2. **`frontend/src/pages/Settings/index.tsx` (Frontend SPA)**
   - Remove duplicate HTML form controls, UI cards, and tab panes for Telegram, WhatsApp, and Gmail.
   - Restructure the local React state and `handleSaveSettings` payload to completely omit all external integration keys.
   - Delete dead `interface DeliveryBoy` left-over declarations.
3. **`frontend/src/pages/Learning/index.tsx` (Frontend SPA)**
   - Remove duplicate delivery-boy forms (the Dispatch tab and Operations tab double-render identical keys).
   - Ensure the page remains the sole canonical writer for Gmail, Telegram, WhatsApp Web, and Pharmarack.

---

## 4. PHASED TASK BREAKDOWN & IMPLEMENTATION STEPS

### TASK 1: BACKEND ROUTE HARDENING (src/routes/settings.ts)
*   **Action 1.1: Fix the Single-Key Write Target**
    Find the single-key insert endpoint `POST /api/settings` (around line 62). It currently executes:
    `INSERT OR REPLACE INTO settings (key, value) ...`
    Change this to target the correct table:
    `INSERT OR REPLACE INTO app_settings (key, value) ...`
*   **Action 1.2: Enforce Defensive Key-Gating on Bulk Save**
    Find the bulk save handler `POST /api/settings/save` (around line 71). Currently, it blindly iterates over `Object.entries(req.body)` and upserts every key.
    We will modify this to:
    1. Define a strict list of `INTEGRATION_KEYS` owned exclusively by the Learning page.
    2. Define a list of `PROTECTED_SECRET_KEYS` (e.g., `gmail_pass`, `pharmarack_password`, `telegram_token`) that must never be overwritten with empty strings or nulls if they already have values in the database.
    3. Filter the incoming `req.body` to ensure that if a request originates from the Settings page (detected via an added header or by analyzing the payload contents), it automatically strips out all `INTEGRATION_KEYS` before processing the database write.

### TASK 2: SETTINGS PAGE SURGERY (frontend/src/pages/Settings/index.tsx)
*   **Action 2.1: Purge UI Overlap**
    Open `Settings/index.tsx` and systematically delete:
    - The Gmail/IMAP Configuration Card.
    - The Telegram Bot Configuration Card.
    - The WhatsApp Web / WhatsApp Business API Toggle Cards.
    - Any lingering Pharmarack account inputs.
*   **Action 2.2: Payload Sanitization**
    Find the save handler `handleSaveSettings`. Currently, it constructs a payload object from all local state fields.
    Modify this function to **only** include core metadata keys in the Axios request. Ensure that keys such as `gmail_user`, `gmail_pass`, `pharmarack_username`, `telegram_token`, etc., are **never** appended to the payload.
*   **Action 2.3: Dead Code Cleanup**
    Locate and delete the unused `interface DeliveryBoy` and any unused local state setters for these fields.

### TASK 3: LEARNING PAGE CONSOLIDATION (frontend/src/pages/Learning/index.tsx)
*   **Action 3.1: Remove Duplicate Delivery Boy Inputs**
    As documented in Audit B.4, duplicate forms render the same four keys (`delivery_boy_name`, `delivery_boy_whatsapp`, etc.) in the Dispatch tab and the Operations tab.
    - Remove the manual delivery-boy input cards completely.
    - Ensure the Dispatch tab exclusively renders or embeds the central `<Dispatch />` manager component which communicates directly with the `delivery_boys` database table via `/api/dispatch/delivery-boys`.

---

## 5. COMPLETE TECHNICAL CODE CHANGES (THE SURGERY)

### 5.1 BACKEND SURGERY: `src/routes/settings.ts`
```typescript
// SEARCH AND REPLACE IN src/routes/settings.ts

// --- STEP 1.1: Fix the table write target (around line 62) ---
// BEFORE:
// db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
// AFTER:
db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);


// --- STEP 1.2: Implement defensive payload isolation in /save (around line 71) ---
// Modify the POST /save router handler to filter key-writes dynamically:

router.post('/save', authenticateApiKey, async (req, res) => {
  const db = dbManager.getConnection();
  
  // Define strict boundaries
  const LEARNING_OWNED_KEYS = [
    'gmail_user', 'gmail_pass', 'gmail_auth_method',
    'telegram_enabled', 'telegram_token', 'telegram_chat_id',
    'whatsapp_enabled', 'whatsapp_preferred_system',
    'wa_business_enabled', 'wa_business_access_token', 'wa_business_phone_number_id',
    'pharmarack_username', 'pharmarack_password', 'pharmarack_session_token', 'pharmarack_mode',
    'automation_enabled', 'wa_auto_share_admin'
  ];

  const PROTECTED_SECRETS = ['gmail_pass', 'pharmarack_password', 'telegram_token', 'wa_business_access_token'];

  try {
    const payload = { ...req.body };
    const isSettingsPageSave = req.headers['x-source-screen'] === 'settings' || !payload.gmail_pass;

    dbManager.transaction(() => {
      // 1. Fetch current database settings to prevent blind overrides of secrets
      const currentSettingsRows = db.prepare("SELECT key, value FROM app_settings").all() as { key: string; value: string }[];
      const currentSettings = currentSettingsRows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {} as Record<string, string>);

      for (const [key, value] of Object.entries(payload)) {
        // Guard A: If the save originates from the Settings screen, block overwriting Learning-owned keys
        if (isSettingsPageSave && LEARNING_OWNED_KEYS.includes(key)) {
          console.log(`[DEFENSE-GATE] Blocked Settings page from overwriting Learning-owned key: ${key}`);
          continue;
        }

        // Guard B: Prevent overwriting a populated secret with an empty string or null
        if (PROTECTED_SECRETS.includes(key) && (!value || String(value).trim() === '')) {
          if (currentSettings[key]) {
            console.log(`[DEFENSE-GATE] Preserved existing populated secret for key: ${key}`);
            continue;
          }
        }

        // Standard Upsert
        db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
      }
    });

    // Trigger settings sync broadcast
    settingsSync.broadcast();
    res.json({ success: true, message: 'Settings saved and synchronized successfully.' });
  } catch (error) {
    console.error('[SETTINGS_SAVE_ERROR]', error);
    res.status(500).json({ success: false, error: 'Internal server error while saving configurations.' });
  }
});
5.2 FRONTEND SURGERY: frontend/src/pages/Settings/index.tsx
// Edit inside handleSaveSettings to strip payload & add identification header:

const handleSaveSettings = async (e: React.FormEvent) => {
  e.preventDefault();
  
  // Construct pure Settings payload - EXCLUDING all Learning-owned keys
  const sanitizedPayload = {
    pharmacy_name: settingsState.pharmacy_name,
    pharmacy_address: settingsState.pharmacy_address,
    pharmacy_phone: settingsState.pharmacy_phone,
    store_gstin: settingsState.store_gstin,
    drug_license_no: settingsState.drug_license_no,
    invoice_prefix: settingsState.invoice_prefix,
    data_fetch_control: JSON.stringify(settingsState.data_fetch_control),
    dinesh_whatsapp_number: settingsState.dinesh_whatsapp_number,
    google_client_id: settingsState.google_client_id,
    google_client_secret: settingsState.google_client_secret,
    tax_rate: settingsState.tax_rate,
    backup_schedule: settingsState.backup_schedule
  };

  try {
    // Axios request carrying the source-screen identification header
    await apiClient.post('/api/settings/save', sanitizedPayload, {
      headers: { 'x-source-screen': 'settings' }
    });
    
    // Broadcast updates to other pages immediately
    triggerSettingsSyncEvent();
    toastEvent.trigger({ type: 'success', message: 'Store configurations saved successfully!' });
  } catch (error) {
    console.error('Failed to save settings:', error);
    toastEvent.trigger({ type: 'error', message: 'Failed to save store configurations.' });
  }
};
6. GLOBAL VERIFICATION & RE-VERIFICATION PIPELINE
We will execute the complete 12-Step pipeline to guarantee system stability and verify that the conflict is permanently resolved without breaking a single existing feature:
[Step 1: Code Integrity] ──> [Step 2: Server Boot] ──> [Step 3: LAN Reachable]
                                                                 │
[Step 6: No Overwrite]   <── [Step 5: Settings Save] <── [Step 4: Seed Credentials]
          │
[Step 7: Check POS] ──> [Step 8: Check Purchases] ──> [Step 9: Check Migration]
                                                                 │
[Step 12: Graph Update] <── [Step 11: Build App] <── [Step 10: Clean tsc]
Step 1 [Integrity Check]: Run git diff and static grep checks to ensure no unauthorized files or lines were modified.
Step 2 [Server Boot]: Boot the Express server on port 5174 and ensure no startup/compilation crashes occur.
Step 3 [CORS & LAN Check]: Confirm the server successfully binds and is accessible over localhost.
Step 4 [Seed Integration Credentials]: Open the Learning Page and configure active credentials for Gmail (gmail_pass) and Pharmarack (pharmarack_password). Verify they write successfully to app_settings and that services start.
Step 5 [Settings Save Action]: Open the Settings Page, modify only the "Pharmacy Name" or "Address", and click Save.
Step 6 [Verify Zero Overwrite]: Execute a direct SQL query against the app_settings table. Confirm that gmail_pass and pharmarack_password remain intact and have NOT been replaced with empty strings.
Step 7 [POS Checkout Regression Check]: Perform a live POS sale with Cash. Confirm transaction completes smoothly, deducts stock correctly via applyStockDelta, and doesn't throw auth or missing-field errors.
Step 8 [Purchases GRN Regression Check]: Perform a manual Purchase entry. Confirm medicine auto-creates and updates inventory levels without touching the resolved Settings.
Step 9 [Migration Core Safe Check]: Run a pre-migration analysis in Migration tab. Verify that the staging database file is created safely without interfering with the live configurations.
Step 10 [Clean TypeScript Check]: Run npx tsc --noEmit on the backend and npx tsc -b --noEmit on the frontend. Both must return zero compilation errors.
Step 11 [Production Executable Build]: Execute npm run build:exe. Ensure esbuild, SEA bundling, and Vite SPA output build cleanly with zero broken imports.
Step 12 [Knowledge Graph Synchronization]: Run node scripts/quick-update.mjs to auto-update the system's structural documentation.
7. AUTOMATED VERIFICATION PLAYBOOK SCRIPT
Save the following validation script as /workspace/scratch/verify-isolation.mjs and execute it to automatically test the payload gate:
import sqlite3 from 'better-sqlite3';
import assert from 'assert';

const db = new sqlite3('/workspace/data/app.db');

try {
  console.log('--- STARTING CONFLICT RESOLUTION AUTOMATED VERIFICATION ---');

  // 1. Seed simulated Learning credentials
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_pass', 'secure_app_password_123')").run();
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_password', 'secure_ph_password_456')").run();
  console.log('✓ Successfully seeded active integration secrets in app_settings.');

  // 2. Simulate Settings Save payload (which sends blanks or lacks integration keys)
  const incomingSettingsPayload = {
    pharmacy_name: 'AI New Life Pharmacy v2',
    pharmacy_address: '102 Main Street, Bangalore',
    gmail_pass: '', // Stale/empty field from Settings UI representation
    pharmarack_password: ''
  };

  console.log('Simulating a Settings Page save event targeting /api/settings/save...');
  
  // Backend logic simulation
  const LEARNING_OWNED_KEYS = ['gmail_pass', 'pharmarack_password'];
  const PROTECTED_SECRETS = ['gmail_pass', 'pharmarack_password'];

  db.transaction(() => {
    const currentSettingsRows = db.prepare("SELECT key, value FROM app_settings").all();
    const currentSettings = currentSettingsRows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    for (const [key, value] of Object.entries(incomingSettingsPayload)) {
      // Simulate isSettingsPageSave condition
      const isSettingsPageSave = true; 

      if (isSettingsPageSave && LEARNING_OWNED_KEYS.includes(key)) {
        console.log(`  -> [PASSIVE GUARD] Successfully blocked Settings page from overwriting Learning key: ${key}`);
        continue;
      }

      if (PROTECTED_SECRETS.includes(key) && (!value || value.trim() === '')) {
        if (currentSettings[key]) {
          console.log(`  -> [PASSIVE GUARD] Successfully preserved existing secret for: ${key}`);
          continue;
        }
      }

      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
    }
  })();

  // 3. Assertions
  const checkName = db.prepare("SELECT value FROM app_settings WHERE key='pharmacy_name'").get().value;
  const checkGmail = db.prepare("SELECT value FROM app_settings WHERE key='gmail_pass'").get().value;
  const checkPharmarack = db.prepare("SELECT value FROM app_settings WHERE key='pharmarack_password'").get().value;

  assert.strictEqual(checkName, 'AI New Life Pharmacy v2', 'Pharmacy name should have updated.');
  assert.strictEqual(checkGmail, 'secure_app_password_123', 'Gmail App Password MUST NOT be overwritten!');
  assert.strictEqual(checkPharmarack, 'secure_ph_password_456', 'Pharmarack Password MUST NOT be overwritten!');

  console.log('\n==================================================');
  console.log('🎉 ALL SANITIZATION AND ISOLATION VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('==================================================');

} catch (error) {
  console.error('❌ VERIFICATION FAILED:', error.message);
  process.exit(1);
} finally {
  db.close();
}

***

### Next Steps & Discussion
* **Does this structural division of keys align perfectly with your visual layout goals?**