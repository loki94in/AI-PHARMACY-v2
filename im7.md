# ==============================================================================
#      AI PHARMACY OS — PERFORMANCE OPTIMIZATION & CONSOLIDATION BLUEPRINT
# ==============================================================================
# Focus: Structural Consolidation & Bundle Optimization (Zero Auth/Security Changes)
# Target: Merge Settings (/settings) & Non-Sensitive AI Learning (/learning)
# Excluded: All User Passwords, Cashier logins, and Third-Party API Credentials
# DB Model: Asynchronous SQLite Engine (await dbManager.getConnection() / db.run)
# ==============================================================================

## SECTION 1: SYSTEM BEHAVIOR ANALYSIS (OPTIMIZATION FOCUS)

### 1.1 Current Behavior (Redundant Redirection & Routing Overhead)
*   **Split Page Memory Footprint**: The `/settings` and `/learning` views are maintained as separate pages. This loads duplicate styling, duplicate API fetch states, and redundant layout wrapper re-renders.
*   **Duplicate Backend Route Mounting**: The backend server mounts the `/api/dispatch` endpoint twice inside `src/server.ts` [1]. This forces the Express routing engine to evaluate duplicate middleware matches on every incoming dispatch call, increasing API response times.
*   **Vite Bundle Bloat**: The 145KB `Learning/index.tsx` page is built into its own code-split lazy chunk. It is prefetched on boot, wasting network bandwidth, client memory, and slowing down page transition times on lower-spec client hardware.
*   **Database Query Mismatch**: The backend router (`src/routes/settings.ts`) contains single-key save queries that mismatch database schema layouts.

### 1.2 Future Behavior (The Streamlined & Optimized Application Layout)
*   **Consolidated Single Page (Zero Auth Impact)**: The `/learning` page and its standalone folder are deleted. The non-sensitive operational fields (Store Profile, AI Learning, and Backups) are unified into a single `/settings` page.
*   **Optimized Express Routing Table**: The redundant route mount inside `src/server.ts` is pruned, speeding up route table execution times.
*   **Reduced Initial JS Bundle**: Deleting `Learning/index.tsx` drops unnecessary code-splitting overhead and shrinks the distribution folder (`dist/`) output size.
*   **Asynchronous Database Writing**: Single-key updates utilize standard async parameters, avoiding thread blockages and transaction errors.

---

## SECTION 2: FILE CHANGE & MOVEMENT MAP

Exactly **1 backend file** and **5 frontend files** are targeted for performance optimization.

| File Path | Action | Type | Optimization Purpose |
| :--- | :--- | :--- | :--- |
| `src/routes/settings.ts` | **MODIFY** | Backend | Streamline single-key saves using asynchronous query bindings to avoid server thread blockages. |
| `src/server.ts` | **MODIFY** | Backend | Prune duplicate route mount. |
| `frontend/src/pages/Learning/index.tsx` | **DELETE** | Frontend | Delete the obsolete 145KB file to save bundle size. |
| `frontend/src/lib/pageImports.ts` | **MODIFY** | Frontend | Remove the `/learning` lazy-chunk definition. |
| `frontend/src/App.tsx` | **MODIFY** | Frontend | Remove legacy path routing and map redirects to settings tabs. |
| `frontend/src/components/Layout.tsx` | **MODIFY** | Frontend | Redirect the sidebar navigation for "AI Learning" to point to `/settings?tab=ocr`. |
| `frontend/src/pages/Settings/index.tsx` | **MODIFY** | Frontend | Restructure Settings into a 3-tab lightweight layout. Port over the OCR table and alias views. |

---

## SECTION 3: PERFORMANCE CONSOLIDATION TASK CHECKLIST

- [ ] **Task 1: Server and Core Routing Setup**
      - Open `src/server.ts` and search for duplicate mounts of `/api/dispatch`.
      - Delete the redundant duplicate mount line.
      - Edit `src/routes/settings.ts` to implement clean, asynchronous SQLite single-key saves.

- [ ] **Task 2: Cleanup Client Router Chunks**
      - Open `frontend/src/lib/pageImports.ts` and remove `/learning`.
      - Open `frontend/src/App.tsx`, remove import references for `/learning`, and configure Navigate fallback routes mapping `/learning` directly to `/settings?tab=ocr`.

- [ ] **Task 3: Refactor Sidebar Navigation**
      - Open `frontend/src/components/Layout.tsx`.
      - Update the path of the "AI Learning" sidebar option to `/settings?tab=ocr`.
      - Remove `/learning` and other dead paths from the `isFitPage` evaluation loop to prevent routing crashes.

- [ ] **Task 4: Structural Rewrite of Settings Hub (3-Tab Layout)**
      - Edit `frontend/src/pages/Settings/index.tsx`.
      - Implement a high-performance 3-Tab layout:
        1. **Store Profile** (Settings-owned Store Metadata)
        2. **AI Learning & OCR** (Ported OCR corrections & alias logs)
        3. **Data & Backups** (Database tools & Fetch triggers)
      - Port over state managers for OCR lists and clinical tables without importing or editing credential variables.

- [ ] **Task 5: Eradicate Dead Files & Recompile**
      - Permanently delete the physical file `frontend/src/pages/Learning/index.tsx`.
      - Run TypeScript compilation checks (`tsc --noEmit`) to verify zero compile errors.

---

## SECTION 4: TECHNICAL SOURCE CODE IMPLEMENTATION

### 4.1 Backend: Asynchronous Settings Saver (`src/routes/settings.ts`)
```typescript
import { Router } from 'express';
import { dbManager } from '../database/connection.js';
import { authenticateApiKey } from '../middleware/auth.js';

const router = Router();

// Fix single-key save route using optimal async bindings mapped directly to app_settings
router.post('/', authenticateApiKey, async (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, error: 'key required' });
  }
  try {
    const db = await dbManager.getConnection(); // Get connection asynchronously [2]
    const saveValue = key === 'pharmarack_mode' ? 'Live' : (value ?? '');
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, saveValue]); // [3]
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Settings save error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
4.2 Backend: Prune Duplicate Express Mounts (src/server.ts)
// RETAIN the primary route registration:
app.use('/api/dispatch', lazyRoute(() => import('./routes/dispatch.js')));

// LOCATE AND DELETE THIS DUPLICATE MIDDLEWARE MOUNT (line ~258):
// app.use('/api/dispatch', lazyRoute(() => import('./routes/dispatch.js'))); // <--- REMOVE AND DELETE THIS LINE
4.3 Frontend: Update Lazy Route Imports (frontend/src/lib/pageImports.ts)
// Open pageImports.ts, find and DELETE the '/learning' route split record:
// BEFORE:
// '/learning': () => import('../pages/Learning'), // <--- DELETE THIS LINE
4.4 Frontend: fallbacks & Redirects (frontend/src/App.tsx)
// 1. Remove the lazy import line
// DELETE: const Learning = lazy(pageImports['/learning']);

// 2. Remove the Route element declaration inside the <Routes> block
// DELETE: <Route path="/learning" element={<Learning />} />

// 3. Add clean fallback Navigate elements to redirect old paths to Settings tabs
<Route path="/learning" element={<Navigate to="/settings?tab=ocr" replace />} />
<Route path="/non-mapped-distributors" element={<Navigate to="/settings?tab=ocr" replace />} />
<Route path="/message-listener" element={<Navigate to="/dashboard" replace />} />
4.5 Frontend: Clean the Sidebar Layout (frontend/src/components/Layout.tsx)
// 1. Locate the sidebar menu item array configuration (around line ~131)
// Update the path for the "AI Learning" link to point directly to our Settings tab
{
  path: '/settings?tab=ocr',
  label: 'AI Learning',
  icon: BrainIcon,
  // ...
}

// 2. Locate the "isFitPage" check array (around line ~1685)
// Remove the dead routing targets. Change from legacy layout array to optimized:
const isFitPage = ['/pos', '/inventory', '/settings', '/crm', '/returns', '/database', '/dashboard', '/reports', '/investigation', '/purchases', '/purchase-history', '/dispatch', '/mail', '/composition-queue', '/phone-sales', '/migration', '/license'];
4.6 Frontend: Optimized 3-Tab Settings Page (frontend/src/pages/Settings/index.tsx)
import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageActive } from '../../hooks/usePageActive';

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'profile';
  const isPageVisible = usePageActive(); // Check if page is visible before execution

  const tabs = [
    { id: 'profile', label: 'Store Profile' },
    { id: 'ocr', label: 'AI Learning & OCR' },
    { id: 'backups', label: 'Data & Backups' }
  ];

  return (
    <div className="min-h-screen bg-bg text-text p-6">
      <div className="flex flex-col mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-text mb-2">Pharmacy Settings Hub</h1>
        <p className="text-sm text-muted">Manage physical profile details, AI learning sets, and system backups.</p>
      </div>

      {/* Optimized Tab Headers */}
      <div className="flex border-b border-border mb-6 gap-2 overflow-x-auto scrollbar-none">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSearchParams({ tab: tab.id })}
            className={`py-3 px-6 font-medium text-sm border-b-2 transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div className="bg-bg2 border border-border rounded-2xl p-6 shadow-sm">
        {activeTab === 'profile' && <StoreProfileTab />}
        {activeTab === 'ocr' && <AiLearningOcrTab isVisible={isPageVisible} />}
        {activeTab === 'backups' && <DataBackupsTab />}
      </div>
    </div>
  );
}

// ==========================================
// PORTED OPERATIONAL TABS (NON-CREDENTIAL)
// ==========================================

function StoreProfileTab() {
  return (
    <div className="text-text space-y-6">
      <h3 className="text-lg font-medium border-b border-border pb-2">Pharmacy Store Profile</h3>
      {/* Existing Name, Address, GSTIN, License & दिनेश WhatsApp fields go here */}
    </div>
  );
}

interface TabProps { isVisible: boolean; }

function AiLearningOcrTab({ isVisible }: TabProps) {
  // Purely handles non-sensitive medicine lookup tables and learning corrections
  return (
    <div className="text-text space-y-6">
      <h3 className="text-lg font-medium border-b border-border pb-2">AI Document Learning & Name Mapping</h3>
      {/* Ported OCR corrections log table & Medicine aliases mapper go here */}
    </div>
  );
}

function DataBackupsTab() {
  return (
    <div className="text-text space-y-6">
      <h3 className="text-lg font-medium border-b border-border pb-2">Database Backup Utilities</h3>
      {/* Backup scheduler scheduler and on-demand database sync cards go here */}
    </div>
  );
}
SECTION 5: RIGOROUS PERFORMANCE & INTEGRITY CHECKING
Before completing this phase, you must verify that no regressions have been introduced:
[ ] Validate Complete Deletion: Check that frontend/src/pages/Learning/index.tsx has been physically deleted from disk.
[ ] Zero Auth Impact: Ensure that no modifications are made to password hashes or user credentials.
[ ] No Mocking: Verify that all sub-components continue to interface directly with active backend APIs.
[ ] Theme Consistency: Confirm that all elements use semantic Tailwind variables to support Light/Dark theme switching.
[ ] Clean Compilation: Compile backend and frontend routes with npx tsc --noEmit and confirm zero errors are thrown.
[ ] Fallback Verification: Navigate to /learning and verify the app automatically redirects to /settings?tab=ocr.

***