# ==============================================================================
#      AI PHARMACY OS — CONFIGURATION CONSOLIDATION & CLEANUP BLUEPRINT
# ==============================================================================
# Target: Merge Settings (/settings) & AI Learning (/learning) into a Unified Hub
# Risk Level: Low-Medium (Core transactions are isolated via safe-zone rules)
# Grounded on Sources: FEATURE-PAGE-REGISTRY, AUDIT-STRUCTURE-DRIFT-REPORT, 
#                     APPLICATION_COMPLETE_AUDIT, SMALL_BUG_FIX_PLAN
# ==============================================================================

## SECTION 1: SYSTEM BEHAVIOR FORENSICS

### 1.1 Current Behavior (The Conflict Hotspot)
*   **Dual-Editor Conflict**: Both `/settings` and `/learning` load configurations via `GET /api/settings` and write to the same `app_settings` table via `POST /api/settings/save` [1, 2]. 
*   **Last-Writer-Wins Data Loss**: Because each page renders a different subset of configuration keys, saving on one page sends empty or missing fields for the other page's keys, blindly overwriting and wiping out active credentials in the database [1, 2].
*   **Wiped Credentials**:
    *   **Pharmarack**: Saving Settings hard-codes `pharmarack_username`, `pharmarack_password`, and `pharmarack_session_token` to empty strings, instantly destroying active B2B logins [3].
    *   **Gmail**: Settings reads `gmail_pass` on mount but silently drops it from its save payloads, breaking background IMAP scanners upon any store profile save [4].
    *   **Telegram & WhatsApp**: Dual inputs on different screens write conflictingly to the same keys, causing configuration drift [2].
*   **Duplicate Forms**: Inside the Learning page itself, the delivery boy contact form is duplicated across the "Dispatch" and "Operations" tabs, causing out-of-sync UI state [5].
*   **Unmounted Dead Weight**: Nine obsolete standalone page files are still code-split and prefetched on boot, wasting user memory and bundle size [6].
*   **Duplicate Routing**: The backend mounts the `/api/dispatch` router twice in `src/server.ts`, triggering duplicate middleware execution side-effects [7, 8].

### 1.2 Future Behavior (The Unified Settings Hub)
*   **Single Page, Single Source of Truth**: All configurations, credentials, and self-learning tools are hosted strictly under `/settings`. The redundant `/learning` page folder and its 145KB file are deleted [9, 10].
*   **Clean 5-Tab Organization**: Operations are divided into five virtualized, tabbed panels:
    1.  **Store Profile** (Settings-owned): Pharmacy Name, Address, GSTIN, Drug Licenses, and Dinesh WhatsApp number [5, 10].
    2.  **Staff & Security** (Staff/Security-owned): Local staff management, Admin remote password, and machine fingerprint activation [11, 12].
    3.  **Integrations & Credentials** (Merged from Learning): WhatsApp Web QR scanner/polling, WhatsApp Business API parameters, Telegram Bot settings, Gmail/IMAP credentials, and Pharmarack account parameters [10, 11].
    4.  **AI Learning & OCR** (Merged from Learning): OCR correction logs, medicine alias tables, and clinical model stats [10, 13].
    5.  **Data & Backups** (Settings-owned): Backup schedules, manual database backups, and Data Fetch Control toggles [13-15].
*   **Seamless Fallback Redirection**: Legacy deep-links or browser bookmarks pointing to `/learning` automatically redirect via React Router directly to `/settings?tab=integrations` or `/settings?tab=ocr` [16].
*   **Bulletproof Saving**: The backend save handler is hardened. Any incoming empty string or null value for sensitive credentials (like `pharmarack_password` or `gmail_pass`) is ignored if a valid credential already exists in the database, preventing accidental drops [2, 17].
*   **Pruned Server Mounts**: The duplicate `/api/dispatch` mount in `src/server.ts` is eliminated [7, 8].

---

## SECTION 2: FILE CHANGE INVENTORY

To complete this consolidation with zero omissions, exactly **2 backend files** and **5 frontend files** will be modified or deleted.

| File Path | Action | Type | Detailed Purpose |
| :--- | :--- | :--- | :--- |
| `src/routes/settings.ts` | **MODIFY** | Backend | Fix the incorrect `POST /` single-key table. Harden `POST /save` to protect sensitive credentials from empty-string overrides. |
| `src/server.ts` | **MODIFY** | Backend | Remove the redundant second mount of the `/api/dispatch` router at line ~258. |
| `frontend/src/pages/Learning/index.tsx` | **DELETE** | Frontend | Completely eradicate this 145KB obsolete page file from the disk. |
| `frontend/src/lib/pageImports.ts` | **MODIFY** | Frontend | Remove the `/learning` lazy-chunk compilation record. |
| `frontend/src/App.tsx` | **MODIFY** | Frontend | Remove lazy import of `Learning`, delete `/learning` route, and add fallback redirects from legacy paths to Settings. |
| `frontend/src/components/Layout.tsx` | **MODIFY** | Frontend | Update sidebar navigation links and prefetch paths to point directly to `/settings?tab=...`. |
| `frontend/src/pages/Settings/index.tsx` | **MODIFY** | Frontend | Complete rewrite to implement the 5-tab dashboard. Port over all state variables, polling hooks, and OCR views from the deleted page. |

---

## SECTION 3: STEP-BY-STEP TASK TRACKING CHECKLIST

- [ ] **Task 1: Pre-Implementation Verification**
      - Inspect `src/database.ts` schema version.
      - Verify that the `app_settings` table contains active records for `gmail_pass`, `telegram_token`, and `pharmarack_password`.
      - Confirm the existing dev and production environments are backed up.

- [ ] **Task 2: Hardening the Backend Save Router**
      - Edit `src/routes/settings.ts`.
      - Fix the single-key `POST /` route to write to `app_settings` instead of the incorrect `settings` table.
      - Edit the bulk save `POST /save` route to cross-check incoming credential fields against a protected whitelist. If the incoming value is empty but the database contains an active secret, preserve the database secret.

- [ ] **Task 3: Pruning Server Route Mounts**
      - Edit `src/server.ts`.
      - Locate and delete the duplicate `/api/dispatch` lazy mount line at the bottom of the middleware registration chain.

- [ ] **Task 4: Restructuring the Settings UI Page**
      - Edit `frontend/src/pages/Settings/index.tsx`.
      - Rewrite the layout to support a tab-switched dashboard controlled by URL search parameters (`?tab=...`).
      - Port over the QR-code state polling, connection-ready checkers, and forms for Gmail, WhatsApp, Telegram, and Pharmarack from the old Learning page.
      - Port over the OCR correction tables, alias logs, and clinical retraining stats components.
      - Ensure all inputs, cards, and text use semantic theme variables exclusively (like `bg-bg`, `text-text`, and `border-border`) to guarantee light/dark mode compliance.

- [ ] **Task 5: Adjusting global App Routing & Imports**
      - Modify `frontend/src/lib/pageImports.ts` to delete the `'/learning'` lazy chunk loader.
      - Modify `frontend/src/App.tsx` to remove the lazy import of `Learning` and the `<Route path="/learning">` line.
      - Add React Router `<Navigate>` redirects mapping `/learning`, `/message-listener`, and `/doctors` legacy paths directly to `/settings?tab=integrations` or `/settings?tab=ocr`.

- [ ] **Task 6: Cleaning the Sidebar Layout**
      - Edit `frontend/src/components/Layout.tsx`.
      - Update the "AI Learning" sidebar navigation path to point directly to `/settings?tab=ocr`.
      - Remove the dead paths `/orders`, `/expiry`, `/non-mapped-distributors`, `/automation-center`, and `/refills` from the `isFitPage` array.

- [ ] **Task 7: Eradicating Stale Files & Post-Cleanup Graph Sync**
      - Permanently delete `frontend/src/pages/Learning/index.tsx` from the physical disk.
      - Run `node scripts/quick-update.mjs` to synchronize the project's dependency graph.
      - Run complete TypeScript compiler type-checks on the backend and frontend.

---

## SECTION 4: TECHNICAL CODE SPECIFICATIONS

### 4.1 Backend: Hardening the Settings Save Router (`src/routes/settings.ts`)
```typescript
import { Router } from 'express';
import { dbManager } from '../database/connection.js';
import { authenticateApiKey } from '../middleware/auth.js';

const router = Router();

// Fix the single-key POST route (writes correctly to app_settings instead of phantom settings table)
router.post('/', authenticateApiKey, async (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, message: 'Key is required' });
  }
  try {
    const db = dbManager.getConnection();
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)")
      .run(key, value === null ? null : String(value));
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Harden bulk settings save with a strict credential-protection whitelist
router.post('/save', authenticateApiKey, async (req, res) => {
  const settings = req.body;
  const db = dbManager.getConnection();

  // Whitelist of keys containing critical credentials that must never be wiped with blank strings
  const protectedCredentials = [
    'pharmarack_password',
    'pharmarack_session_token',
    'gmail_pass',
    'gmail_oauth_refresh_token',
    'wa_business_access_token',
    'telegram_token'
  ];

  try {
    dbManager.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        // Guard: If the incoming value is empty but a valid credential exists in the DB, skip overwrite
        if (protectedCredentials.includes(key) && (!value || String(value).trim() === '')) {
          const existing = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
          if (existing && existing.value && existing.value.trim() !== '') {
            continue; // Safely preserve the active database credential
          }
        }
        db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)")
          .run(key, value === null ? null : String(value));
      }
    });

    // Broadcast the update event to other active SPA page tabs in real-time
    if (global.broadcastSettingsUpdate) {
      global.broadcastSettingsUpdate(settings);
    }

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
4.2 Backend: Pruning Duplicate Route Mount (src/server.ts)
// Look for the lazy route registrations around lines ~210 - ~260.
// RETAIN the primary correct mount at line ~224:
app.use('/api/dispatch', lazyRoute(() => import('./routes/dispatch.js')));

// LOCATE and DELETE/REMOVE this redundant second mount line further down (line ~258):
// app.use('/api/dispatch', lazyRoute(() => import('./routes/dispatch.js'))); // <--- DELETE THIS LINE ENTIRELY
4.3 Frontend: Update Lazy imports Map (frontend/src/lib/pageImports.ts)
// Open pageImports.ts, find and DELETE the '/learning' route code-split entry:
// BEFORE:
// '/learning': () => import('../pages/Learning'), // <--- DELETE THIS LINE

// AFTER:
// The key '/learning' is completely absent from the exports dictionary.
4.4 Frontend: Router Configuration & Fallbacks (frontend/src/App.tsx)
// 1. Remove the lazy import line
// DELETE: const Learning = lazy(pageImports['/learning']);

// 2. Remove the Route element declaration inside the <Routes> block
// DELETE: <Route path="/learning" element={<Learning />} />

// 3. Add clean fallback Navigate elements to map legacy deep-links to Settings tabs
<Route path="/learning" element={<Navigate to="/settings?tab=integrations" replace />} />
<Route path="/non-mapped-distributors" element={<Navigate to="/settings?tab=ocr" replace />} />
<Route path="/message-listener" element={<Navigate to="/dashboard" replace />} />
<Route path="/doctors" element={<Navigate to="/settings?tab=ocr" replace />} />
4.5 Frontend: Clean the Sidebar Navigation (frontend/src/components/Layout.tsx)
// 1. Locate the sidebar menu item array configuration (around line ~131)
// Update the path for the "AI Learning" link to point to the new Settings tab
{
  path: '/settings?tab=ocr',
  label: 'AI Learning',
  icon: BrainIcon,
  // ...
}

// 2. Locate the "isFitPage" check array (around line ~1685)
// Remove the dead redirect paths. Change it from:
// const isFitPage = ['/pos', '/inventory', '/orders', '/expiry', '/non-mapped-distributors', '/settings', '/crm', '/returns', '/learning'];
// TO: (Only active, directly-mounted structural routes remain)
const isFitPage = ['/pos', '/inventory', '/settings', '/crm', '/returns', '/database', '/dashboard', '/reports', '/investigation', '/purchases', '/purchase-history', '/dispatch', '/mail', '/composition-queue', '/phone-sales', '/migration', '/license'];
4.6 Frontend: Merge and Rewrite the Settings Page (frontend/src/pages/Settings/index.tsx)
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSettingsQuery } from '../../hooks/useSettingsQuery';
import { usePageActive } from '../../hooks/usePageActive';
import { toastEvent } from '../../utils/events';
import { apiClient } from '../../services/api';

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'profile';
  const isPageVisible = usePageActive(); // Prevent background polling when settings isn't active

  const tabs = [
    { id: 'profile', label: 'Store Profile' },
    { id: 'staff', label: 'Staff & Security' },
    { id: 'integrations', label: 'Integrations & Credentials' },
    { id: 'ocr', label: 'AI Learning & OCR' },
    { id: 'backups', label: 'Data & Backups' }
  ];

  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId });
  };

  return (
    <div className="min-h-screen bg-bg text-text p-6">
      <div className="flex flex-col mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-text mb-2">Pharmacy Configuration & Control Hub</h1>
        <p className="text-sm text-muted">Manage store details, staff credentials, automated integrations, and AI self-learning data.</p>
      </div>

      {/* Tab Switcher Headers */}
      <div className="flex border-b border-border mb-6 overflow-x-auto scrollbar-none gap-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`py-3 px-6 font-medium text-sm border-b-2 whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Panel Content Area */}
      <div className="bg-bg2 border border-border rounded-2xl p-6 shadow-sm">
        {activeTab === 'profile' && <StoreProfileTab />}
        {activeTab === 'staff' && <StaffSecurityTab />}
        {activeTab === 'integrations' && <IntegrationsCredentialsTab isVisible={isPageVisible} />}
        {activeTab === 'ocr' && <AiLearningOcrTab isVisible={isPageVisible} />}
        {activeTab === 'backups' && <DataBackupsTab />}
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB COMPONENTS (PORTED & CONSOLIDATED)
// ==========================================

function StoreProfileTab() {
  // Contains existing Store Profile Form fields
  // Pharmacy Name, Address, GSTIN, Drug License, दिनेश WhatsApp alert number
  return <div className="text-text">/* Store Profile Fields */</div>;
}

function StaffSecurityTab() {
  // Contains local cashier roster management, Admin Remote password, activation keys
  return <div className="text-text">/* Staff & Security Credentials */</div>;
}

interface TabProps { isVisible: boolean; }

function IntegrationsCredentialsTab({ isVisible }: TabProps) {
  // Merged state & polling handlers from Learning/index.tsx
  // - WhatsApp Web QR Poll (Gated by isVisible & active connection state)
  // - WhatsApp Business API Webhook keys
  // - Telegram Bot token connection status
  // - Gmail App Password / IMAP connection settings (does not drop gmail_pass on save!)
  // - Pharmarack credentials & login session refresh status
  return <div className="text-text">/* WhatsApp, Telegram, Gmail & Pharmarack configurations */</div>;
}

function AiLearningOcrTab({ isVisible }: TabProps) {
  // Merged components from Learning/index.tsx
  // - OCR Corrections Logs & Audit database
  // - Medicine Name Alias Registry table
  // - Retrain Clinical Model statistics dashboard
  return <div className="text-text">/* OCR Learning Database & Aliases Workspace */</div>;
}

function DataBackupsTab() {
  // Backup scheduler configuration, cloud backup trigger, Data Fetch Control registry board
  return <div className="text-text">/* Backups & Data Fetch Control Toggles */</div>;
}
SECTION 5: STRICT RE-VERIFICATION & ANTI-REGRESSION LOOP
To satisfy the zero-error/zero-omission requirement, the implementing agent must run through these verification steps before concluding the session.
5.1 Verification Checklist
[ ] Strict File Deletion: Physically confirm that the file frontend/src/pages/Learning/index.tsx is completely gone. No stub files or commented-out modules may remain.
[ ] No Mock UI Verification: Ensure that no fake modes or mock-up states are introduced to bypass live database checking. All fields must directly reflect real keys in app_settings.
[ ] Unified Theme Enforcement: Verify that every form input card, toggle button, or table row utilizes semantic Tailwind tokens (bg-bg, text-text, border-border, etc.) instead of hardcoded hex codes, preserving theme toggling.
[ ] TypeScript Type-Check: Trigger compilation on both backend and frontend environments:
[ ] Double-Redirect Sanity Check: Type /learning directly into your browser's address bar. Confirm that the application redirects smoothly to /settings?tab=integrations without crashing.
[ ] Uncompromised Core Workflows: Perform a mockup checkout in POS, load a history card in Purchases, and open the Migration tab. Verify that no database access or schema-lock errors are thrown.
[ ] Credential Preservation Verification (Critical Path):
Navigate to Settings -> Integrations & Credentials. Fill in valid, test credentials for Gmail, Telegram, and Pharmarack. Save the configuration.
Switch to the Store Profile tab, modify the Store Name, and click Save.
Reload the browser completely, return to the Integrations & Credentials tab, and confirm that all passwords and tokens remain intact and populated (proving the new POST /save whitelist logic successfully blocked blank overrides).
[ ] Graph Update: Run the knowledge graph synchronizer to update auditing logs:
5.2 The Agent Promise
"I will not skip any file, line, or task in this blueprint. I will not declare the consolidation complete until both TypeScript checks compile successfully and the credential-preservation test passes with 100% data integrity."

***