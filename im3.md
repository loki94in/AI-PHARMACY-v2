==============================================================================
OPERATIONAL BLUEPRINT: SYSTEM ROUTING, PORT ISOLATION, & STABILITY ENGINE
==============================================================================
Target System: AI Pharmacy OS (v2.0)
Target Hardware: Intel Core i3 3rd-Gen (2 Cores, 4 Threads, HDD, No AVX2)
Estimated Implementation Time: 4 - 5 Hours
Verification Scope: 100% Type-Safe, No-Emit, Path-Aligned, 0% Idle CPU
==============================================================================
================================================================================
COMPREHENSIVE STATUS SUMMARY: CONFIG, ROUTING, & EXECUTABLE DRIFT ================================================================================
This plan addresses several operational issues that degrade performance and cause failures when running on a single local PC.
1.1 Background Timer Silence (Config-Gated Safety)
Current State:
At boot, the main server process unconditionally spawns background setInterval and cron loops for Gmail IMAP polling, WhatsApp message queues, and Telegram bots
.
If the user has not configured these features, the console continuously logs connection exceptions and blocks Node's single thread
.
Target State:
A strict configuration gate is placed at the entry point of every background loop
.
If Gmail credentials (gmail_user), WhatsApp (whatsapp_enabled), or Telegram tokens (telegram_token) are missing or disabled, their respective background timers instantly return, maintaining 100% silent background CPU usage
.
1.2 Route Realignment & Prefix-Drift Corrections
Current State:
Several frontend API requests (such as online searches and automatic composition enrichment) result in 404 errors due to route prefix drift
.
For example, GET /medicines/online-search on the client maps to /api/online-search on the backend, missing the required /api/medicines prefix
.
The settings saving route contains a latent bug where POST /api/settings writes to a nonexistent, phantom settings table instead of the authoritative app_settings table
.
Target State:
All frontend routes are realigned to match their exact backend mounts
.
The settings save route is redirected to write exclusively to the app_settings table
.
Dead, unmounted routes (like /api/v1/sales) are removed from compilation
.
1.3 Single-PC Dev/Exe Process Isolation
Current State:
Running development mode and the compiled .exe on the same PC causes port collisions on port 5174, crashing the second backend instance or silently proxying development traffic to the production database
.
Background browser cleanups (killOrphanChromeProcesses and cleanupProfileLocks) target processes using loose command-line keywords
. This can abruptly terminate a live development automation window when running a production cleanup script
.
Target State:
Development backend remains on port 5174 while the packaged desktop executable backend is assigned to port 5175
.
Browser cleanup scripts are updated to match absolute paths via getAppDataDir(), ensuring that actions in dev mode never target processes in production %LOCALAPPDATA% folders
.
================================================================================2. COMPREHENSIVE FILE CHANGE MANIFEST (14 FILES TOTAL)
To implement this plan without altering security or authentication schemas, exactly 14 files will be modified (8 Backend, 6 Frontend).
2.1 Backend Files to Modify (8 Files)
src/config/index.ts — Implement port separation (dev: 5174, exe: 5175) and AppData directories
.
src/server.ts — Setup top-level uncaught exception process guardians and health check routes
.
src/worker/emailPoller.ts — Implement the IMAP poller configuration gate.
src/services/whatsappQueue.ts — Implement the whatsapp_enabled setting gate.
src/services/telegramPrescriptionService.ts — Gate bot connection attempts based on the telegram_enabled setting.
src/routes/settings.ts — Fix settings route to write to app_settings instead of the nonexistent settings table
.
src/routes/medicines.ts — Correct prefix-drift 404 paths for online searches and auto-enrichments
.
src/services/tokenRefreshScheduler.ts — Restructure Chrome lock cleanups to target absolute paths via getAppDataDir()
.
2.2 Frontend Files to Modify (6 Files)
frontend/src/services/api.ts — Realign prefix-drifted API routes and health check endpoints
.
frontend/src/pages/POS/index.tsx — Memoize cart item and tax calculations using useMemo to eliminate input lag
.
frontend/src/pages/Purchases/index.tsx — Memoize manual purchase entry tax and subtotal calculations
.
frontend/src/pages/Inventory/index.tsx — Shift table rendering to a pure read-only virtualized view
.
frontend/src/pages/Settings/index.tsx — Point Settings save target to /api/settings/save-single
.
frontend/src/components/Layout.tsx — Render top-level ready-banners that hook into /api/health/ready to block UI interactions until the database is fully booted
.
================================================================================3. COMPREHENSIVE CODE-LEVEL SPECIFICATIONS
PHASE 3.1: Environment & Port Separation
FILE 3.1.1: src/config/index.ts
Target Behavior: Set up clean path resolutions and separate ports (dev: 5174, exe: 5175)
.
import path from 'path';
import dotenv from 'dotenv';

const isPackaged = process.env.NODE_ENV === 'production' || !!(process as any).parent;
const baseDir = isPackaged ? path.dirname(process.execPath) : process.cwd();
dotenv.config({ path: path.join(baseDir, '.env') });

export function isPackagedApp(): boolean {
  return isPackaged;
}

export function getAppDataDir(): string {
  if (isPackaged) {
    return path.join(process.env.LOCALAPPDATA || '', 'AI Pharmacy OS');
  }
  return process.cwd();
}

// Separate default ports to prevent cross-environment port collisions
const DEFAULT_PORT = isPackaged ? 5175 : 5174;

export const config = {
  port: parseInt(process.env.PORT || '', 10) || DEFAULT_PORT,
  env: process.env.NODE_ENV || 'development',
  dbPath: path.join(getAppDataDir(), 'data', 'app.db'),
  backupDir: path.join(getAppDataDir(), 'backup')
};
PHASE 3.2: Self-Healing Boot, Process Guardians, & System Health Gate
FILE 3.2.1: src/server.ts
Target Behavior: Prevent Express from accepting queries during database schema migrations or connection initializations
.
import express from 'express';
import compression from 'compression'; // Enable Gzip response compression
import { config } from './config/index.js';
import { dbManager } from './database/connection.js';

const app = express();
app.use(compression());

let isSystemReady = false;

// PROCESS GUARDIANS: Prevent unhandled timer exceptions from crashing the server
process.on('uncaughtException', (error) => {
  console.error('[PROCESS GUARDIAN] Intercepted uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[PROCESS GUARDIAN] Intercepted unhandled promise rejection at:', promise, 'reason:', reason);
});

// Database Readiness Gate
app.get('/api/health/ready', (req, res) => {
  if (!isSystemReady) {
    return res.status(503).json({ status: 'booting', message: 'Initializing database schema and checking integrity...' });
  }
  return res.status(200).json({ status: 'ready', message: 'System ready.' });
});

try {
  const db = dbManager.getConnection();
  console.log(`[BOOT] Connected to SQLite database at: ${config.dbPath}`);
  
  isSystemReady = true;

  app.listen(config.port, () => {
    console.log(`[BOOT] AI Pharmacy OS Server running on port ${config.port} [NODE_ENV=${config.env}]`);
  });
} catch (err) {
  console.error('[BOOT CRITICAL] Failed to establish database connection. Boot halted.', err);
  process.exit(1);
}
PHASE 3.3: Configuration-Gated Background Silence
FILE 3.3.1: src/worker/emailPoller.ts
Target Behavior: Check database configuration at the start of the loop and skip the connection gracefully if unconfigured
.
import { dbManager } from '../database/connection.js';

export async function pollInboxLoop() {
  const db = dbManager.getConnection();
  
  const gmailUser = db.prepare("SELECT value FROM app_settings WHERE key = 'gmail_user'").get() as { value: string } | undefined;
  const gmailPass = db.prepare("SELECT value FROM app_settings WHERE key = 'gmail_pass'").get() as { value: string } | undefined;

  // Configuration Gate Check
  if (!gmailUser?.value || !gmailPass?.value) {
    console.log('[EMAIL POLLER GATER] IMAP email credentials are unconfigured. Polling loop is silent.');
    return; // Exit without running network socket operations
  }

  // Execute IMAP connection...
}
FILE 3.3.2: src/services/whatsappQueue.ts
Target Behavior: Skip database scans if WhatsApp Web is completely turned off
.
import { dbManager } from '../database/connection.js';

export async function processWhatsAppQueue() {
  const db = dbManager.getConnection();
  
  const waEnabled = db.prepare("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'").get() as { value: string } | undefined;

  // Configuration Gate Check
  if (!waEnabled || waEnabled.value !== 'true') {
    return; // Maintain total CPU and database silence
  }

  // Scan queue and process pending jobs...
}
FILE 3.3.3: src/services/telegramPrescriptionService.ts
Target Behavior: Bypass connection if token is missing or integration toggle is disabled
.
import { dbManager } from '../database/connection.js';

export function initializeTelegramBot() {
  const db = dbManager.getConnection();
  
  const tgEnabled = db.prepare("SELECT value FROM app_settings WHERE key = 'telegram_enabled'").get() as { value: string } | undefined;
  const tgToken = db.prepare("SELECT value FROM app_settings WHERE key = 'telegram_token'").get() as { value: string } | undefined;

  // Configuration Gate Check
  if (!tgEnabled || tgEnabled.value !== 'true' || !tgToken?.value) {
    console.log('[TELEGRAM GATER] Telegram Bot integration is unconfigured or disabled. Listeners bypassed.');
    return; // Silent bypass
  }

  // Bind node-telegram-bot-api...
}
PHASE 3.4: Route Realignment & Database Save Fixes
FILE 3.4.1: src/routes/settings.ts
Target Behavior: Redirect settings save paths to write to app_settings instead of the nonexistent settings table
.
import { Router } from 'express';
import { dbManager } from '../database/connection.js';

const router = Router();

router.post('/save-single', (req, res) => {
  const { key, value } = req.body;
  const db = dbManager.getConnection();

  try {
    db.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);

    return res.status(200).json({ success: true, message: 'Setting saved successfully.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
FILE 3.4.2: src/routes/medicines.ts
Target Behavior: Align prefix-drifted paths for online searches and auto-enrichments under the /api/medicines suffix context
.
import { Router } from 'express';

const router = Router();

// FIX: Aligns path from /api/online-search to /api/medicines/online-search
router.get('/online-search', async (req, res) => {
  const { query } = req.query;
  // Execute online search API requests...
  return res.json({ query, results: [] });
});

// FIX: Aligns path from /api/auto-enrich to /api/medicines/auto-enrich
router.post('/auto-enrich', async (req, res) => {
  const { id } = req.body;
  // Trigger medicine composition auto-enrichment...
  return res.json({ success: true, message: 'Enrichment queued.' });
});

export default router;
PHASE 3.5: Absolute Directory Path Lock Cleanup
FILE 3.5.1: src/services/tokenRefreshScheduler.ts
Target Behavior: Limit browser profile lock files cleanup to the absolute path generated by getAppDataDir() to prevent cross-killing development profiles
.
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { getAppDataDir } from '../config/index.js';

export function cleanProfileLockFiles() {
  const profileDir = path.join(getAppDataDir(), 'data', 'pharmarack_profile');
  const lockFiles = ['SingletonLock', 'lockfile', 'SingletonSocket'];

  lockFiles.forEach(file => {
    const lockPath = path.join(profileDir, file);
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        console.log(`[CLEANUP] Removed absolute browser lock file: ${lockPath}`);
      }
    } catch (err) {
      console.warn(`[CLEANUP WARNING] Unable to unlink lock file at ${lockPath}:`, err);
    }
  });

  try {
    const escapedPath = profileDir.replace(/\\/g, '\\\\');
    if (process.platform === 'win32') {
      execSync(`wmic process where "CommandLine like '%${escapedPath}%'" call terminate`, { stdio: 'ignore' });
    }
  } catch (err) {
    // Graceful fallback if WMIC permissions are restricted
  }
}
PHASE 3.6: Frontend Realignment & Memoization
FILE 3.6.1: frontend/src/services/api.ts
Target Behavior: Direct queries to the appropriate isolated port based on packaging environment and correct prefix mismatch
.
import axios from 'axios';

const isPackaged = window.location.port === '5175';
export const API_BASE_URL = isPackaged ? 'http://localhost:5175/api' : '/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export const api = {
  checkReady: () => apiClient.get('/health/ready'),
  
  // FIX: Aligns path correctly with the backend medicines router prefix
  searchOnlineMedicines: (query: string) => 
    apiClient.get(`/medicines/online-search?query=${encodeURIComponent(query)}`),
  
  // FIX: Aligns path correctly with the backend medicines router prefix
  autoEnrichMedicine: (id: number) => 
    apiClient.post('/medicines/auto-enrich', { id }),

  getSettings: () => apiClient.get('/settings'),
  saveSingleSetting: (key: string, value: string) => 
    apiClient.post('/settings/save-single', { key, value }),
};
FILE 3.6.2: frontend/src/components/Layout.tsx
Target Behavior: Renders page container elements and locks UI input until /api/health/ready returns success to eliminate initialization errors
.
import React, { useEffect, useState } from 'react';
import { api } from '../services/api';

export function ApplicationContainer({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [bootMessage, setBootMessage] = useState('Checking database connection...');

  useEffect(() => {
    let checkInterval: NodeJS.Timeout;
    
    const verifySystemState = async () => {
      try {
        const response = await api.checkReady();
        if (response.status === 200) {
          setIsReady(true);
          clearInterval(checkInterval);
        }
      } catch (err: any) {
        if (err.response && err.response.data) {
          setBootMessage(err.response.data.message || 'Database initializing...');
        } else {
          setBootMessage('System booting up... Waiting for SQLite WAL setup...');
        }
      }
    };

    verifySystemState();
    checkInterval = setInterval(verifySystemState, 2000);

    return () => clearInterval(checkInterval);
  }, []);

  if (!isReady) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg font-sans">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        <h1 className="mt-6 text-xl font-bold text-text">AI Pharmacy OS</h1>
        <p className="mt-2 text-sm text-muted font-mono">{bootMessage}</p>
        <div className="absolute bottom-6 text-xs text-muted">Offline-First Desktop Release v2.1.0-Stable</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      {children}
    </div>
  );
}
================================================================================4. VERIFICATION PIPELINE & STABILITY GATES
To guarantee zero-error execution, the coding agent MUST execute and report the results of every step in this loop. No steps are skipped.
                  ┌──────────────────────────────────────────┐
                  │   STEP 4.1: PRE-IMPLEMENTATION DEPS      │
                  │   - Verify all 14 files exist in system  │
                  │   - Take copy backup of live data/app.db │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   STEP 4.2: COMPILATION & TYPE CHECKING  │
                  │   - Run backend check: npx tsc --noEmit  │
                  │   - Run frontend check: npx tsc -b       │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   STEP 4.3: TESTING CONFIGURATION GATES  │
                  │   - Toggle WhatsApp/Telegram/IMAP off   │
                  │   - Verify CPU remains at 0% on idle     │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┘
                  │   STEP 4.4: PATHS AND PORT INTEGRITY     │
                  │   - Verify dev on 5174, exe on 5175      │
                  │   - Rebuild knowledge graph relationships│
                  │   - Refresh PROJECT_AUDIT.md             │
                  └──────────────────────────────────────────┘
[ ] Step 4.1: Pre-Implementation Verification
Verify all 14 files are present.
Take a backup copy of the local SQLite database file (data/app.db).
[ ] Step 4.2: Compilation & Types Validation
Run the backend compiler check:
Run the frontend package compiler check:
[ ] Step 4.3: Verification of Configuration Gates
Disable WhatsApp and Telegram integrations on the Learning page
.
Check the active background processes. Verify that they skip all database reads/writes and do not attempt remote socket handshakes
.
[ ] Step 4.4: Paths & Port Integrity
Start the backend on dev mode (5174) and launch a packaged executable. Verify that both instances run side-by-side on their respective ports (5174 and 5175) without port collisions or database cross-writes
.
Run the knowledge graph generator to sync the updated file dependencies:
