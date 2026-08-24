import './database/sqlitePatch.js';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import axios from 'axios';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { dbManager } from './database/connection.js';
import { ensureSchema } from './database.js';
import { registerProcessGuardian } from './process/processGuardian.js';
import { activityTracker } from './utils/activityTracker.js';
import { getBackendFetchMode } from './services/dataFetchControl.js';
import { config, getAppDataDir, isPackagedApp } from './config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = config.dbPath;

// Global safety net: every module in this app imports the shared `axios`
// default instance (no axios.create() instances exist), and most call sites
// never pass an explicit timeout — a single unresponsive remote endpoint
// (Pharmarack, Telegram, distributor APIs, etc.) would otherwise hang that
// request forever. Per-call timeouts still win when they set their own.
axios.defaults.timeout = 20000;

// Flipped to true once ensureSchema() finishes below. Gates every /api route
// so the first requests after exe launch can't hit a not-yet-created schema
// and randomly 500 during the boot window.
let schemaReady = false;

// Boot timing baseline + best-effort counter of background worker start failures,
// surfaced in one summary line ~T+10s so silent degradations are visible at a glance.
const BOOT_T0 = performance.now();
let bootWorkerFailures = 0;

// Startup check disabled permanently

/**
 * Lazy-load route factory: defers module import until first request hits this path.
 * Eliminates ~8-12s of cold boot time from heavy transitive dependencies
 * (puppeteer, tesseract, onnxruntime, whatsapp-web.js, xlsx, etc.)
 *
 * Takes a loader thunk — `() => import('./routes/x.js')` — rather than a path
 * string. A literal `import('./x.js')` written directly at each call site lets
 * esbuild bundle it (and its dependencies) into the single packaged file;
 * a path string passed through a variable can't be statically analyzed, so it
 * would fall through to a real runtime import that has nothing to resolve
 * against once everything is bundled into one file.
 */
type RouteTier = 'hot' | 'medium' | 'heavy';

const registeredLazyRoutes: Array<{ preload: () => Promise<any>; tier: RouteTier }> = [];

function lazyRoute(loader: () => Promise<{ default: express.Router }>, tier: RouteTier = 'medium'): express.RequestHandler {
  let router: express.Router | null = null;
  let loadPromise: Promise<express.Router> | null = null;
  const preload = () => {
    if (router) return Promise.resolve(router);
    if (!loadPromise) {
      loadPromise = loader().then(m => {
        router = m.default;
        return router!;
      });
    }
    return loadPromise;
  };
  registeredLazyRoutes.push({ preload, tier });
  return (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') {
      loader().then(m => m.default(req, res, next)).catch(next);
      return;
    }
    if (router) return router(req, res, next);
    preload().then(r => r(req, res, next)).catch(next);
  };
}

/**
 * Tiered background route pre-warm, started ONLY after the schema gate opens
 * (Phase 1) so module compilation never competes with database DDL for the
 * event loop.
 *
 * - hot: POS-critical routes, loaded immediately.
 * - medium: everything else, in small staggered batches to flatten the CPU spike.
 * - heavy: AI/OCR/migration modules that drag puppeteer/tesseract/onnx/xlsx-sized
 *   dependency trees into RAM. Loaded one-by-one only while the shop PC is idle;
 *   any earlier real request loads them on demand via the normal lazyRoute
 *   fallback, so skipping them is always safe.
 */
let preWarmStarted = false;
async function startTieredPreWarm(): Promise<void> {
  if (preWarmStarted) return;
  preWarmStarted = true;
  const t0 = performance.now();
  const loaders = (tier: RouteTier) => registeredLazyRoutes.filter(r => r.tier === tier).map(r => r.preload);

  await Promise.allSettled(loaders('hot'));

  const medium = loaders('medium');
  for (let i = 0; i < medium.length; i += 5) {
    await new Promise(resolve => setTimeout(resolve, 300));
    void Promise.allSettled(medium.slice(i, i + 5));
  }

  console.log(`[Boot] Route pre-warm complete (hot+medium) in ${Math.round(performance.now() - t0)}ms.`);

  const heavy = loaders('heavy');
  let heavyIdx = 0;
  const heavyTimer = setInterval(() => {
    if (heavyIdx >= heavy.length) {
      clearInterval(heavyTimer);
      return;
    }
    if (!activityTracker.isIdle(5 * 60 * 1000)) return;
    void heavy[heavyIdx++]().catch(() => {});
  }, 15_000);
}

// Register process-level crash handler (logs to crash_log, exits(1) for watchdog restart)
registerProcessGuardian();

// Enable background workers and supervisors by default (can be disabled via env var if needed)
process.env.DISABLE_BACKGROUND_WORKERS = process.env.DISABLE_BACKGROUND_WORKERS || 'false';
process.env.DISABLE_SELF_HEALING_WORKERS = process.env.DISABLE_SELF_HEALING_WORKERS || 'false';

const app = express();
app.use(compression());

// Tracks requests currently being handled so graceful shutdown can drain them before
// closing the DB connection — without this, a request mid-query when SIGINT/SIGTERM
// arrives hits an already-closed connection (SQLITE_MISUSE: Database is closed).
let inFlightRequests = 0;
app.use((req, res, next) => {
  inFlightRequests++;
  // 'finish' (normal completion) and 'close' (aborted connection) can both fire for the
  // same response — guard so a request is only ever decremented once.
  let counted = true;
  const release = () => { if (counted) { counted = false; inFlightRequests--; } };
  res.on('finish', release);
  res.on('close', release);
  next();
});

app.use((req, res, next) => {
  // Don't treat status polling or background worker queries as blocking activity
  const isEnrichmentStatus = req.path.startsWith('/api/enrichment/status') || req.path.startsWith('/api/enrichment/queue');
  const isCatalogStatus = req.path.startsWith('/api/catalog/job') || req.path.startsWith('/api/jobs');
  const isNotificationStream = req.path.startsWith('/api/notifications');

  if (!isEnrichmentStatus && !isCatalogStatus && !isNotificationStream) {
    activityTracker.recordActivity();
  }
  next();
});

// Ensure uploads and temp directories exist
const UPLOAD_DIR = config.uploadDir;
const TEMP_DIR = config.tempDir;
const RAW_DIR = path.join(getAppDataDir(), 'catalogue', 'raw');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
if (!fs.existsSync(RAW_DIR)) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}


// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable CSP so inline scripts and styles in index.html can run
}));
const ALLOWED_ORIGINS = [
  'http://localhost:5173',  // Vite dev server
  'http://localhost:5174',  // Production build
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests with no origin (e.g., mobile, Postman)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Allow local network origins (localhost, 127.0.0.1, private IPv4 class A/B/C subnets) on any port
    if (/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS blocked: origin ${origin} not allowed`));
  },
  credentials: true
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Increased threshold for high-frequency SPA interactions
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limits in dev mode, packaged desktop app, or local loopback requests
    if (process.env.NODE_ENV !== 'production' || isPackagedApp()) return true;
    const ip = req.ip || req.socket.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.includes('localhost')) return true;
    return req.path.startsWith('/api/migration') || req.path.startsWith('/api/notifications');
  },
  message: { error: 'Too many requests, please try again later' }
}));
app.use(express.json({ limit: '15mb' }));


app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/data/search_screenshots', express.static(path.join(getAppDataDir(), 'data', 'search_screenshots')));

// Old test console routes have been removed. This server now acts purely as an API backend.

// WhatsApp Business webhook (before auth — needs to be publicly accessible)
app.use('/api/wa-business/webhook', lazyRoute(() => import('./routes/whatsappBusiness.js')));

// Public health check endpoint for mobile connection testing
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString() });
});

// Distinct from /api/health: this reflects DB schema readiness, not just
// process liveness. The frontend axios interceptor already retries 503s with
// backoff (see frontend/src/services/api.ts), so gating on this needs no
// separate frontend polling loop.
app.get('/api/health/ready', (req, res) => {
  if (schemaReady) return res.json({ success: true, ready: true });
  res.status(503).json({ success: false, ready: false, retryAfter: 1 });
});

// Block every other /api route until the schema is ready. Responds 503 (not
// 401), which the frontend already retries with backoff.
//
// /migration is exempt: it must work on a fresh install before anything else
// is ready. Its DB-touching sub-routes already open the sqlite file directly
// via dbManager and would simply 500 on a missing table during the few-second
// schema-creation window — the same behavior they had before this gate
// existed. Gating /migration here regressed it: multer's disk-upload route
// needs no schema at all, but a slow first-ever schema creation on a truly
// fresh %LOCALAPPDATA% install (no pre-existing DB, unlike a dev machine
// reusing one) could outlast the frontend's 503 retry budget and make file
// uploads fail outright.
app.use('/api', (req, res, next) => {
  if (schemaReady || req.path === '/health' || req.path === '/health/ready' || req.path.startsWith('/migration')) return next();
  res.status(503).json({ error: 'Server is initializing', retryAfter: 1 });
});

// All routes lazy-loaded: modules import on first request, not at server startup.
// Agent 2 (CRM & Utilities) Routers
app.use('/api/crm', lazyRoute(() => import('./routes/crm.js')));
app.use('/api/utilities', lazyRoute(() => import('./routes/utilities.js')));
app.use('/api/scan', lazyRoute(() => import('./routes/scan.js'), 'hot'));
app.use('/api/security', lazyRoute(() => import('./routes/security.js')));
app.use('/api/email', lazyRoute(() => import('./routes/email.js')));
app.use('/api/verification', lazyRoute(() => import('./routes/verification.js')));
app.use('/api/migration', lazyRoute(() => import('./routes/migration.js'), 'heavy'));
app.use('/api/settings', lazyRoute(() => import('./routes/settings.js'), 'hot'));
app.use('/api/pharmarack', lazyRoute(() => import('./routes/pharmarack.js'), 'hot'));
app.use('/api/dispatch', lazyRoute(() => import('./routes/dispatch.js')));
app.use('/api/learning', lazyRoute(() => import('./routes/learning.js'), 'heavy'));
app.use('/api/messaging', lazyRoute(() => import('./routes/messaging.js')));
app.use('/api/aicamera', lazyRoute(() => import('./routes/aiCamera.js'), 'heavy'));
app.use('/api/telegram-prescription', lazyRoute(() => import('./routes/telegramPrescription.js'), 'heavy'));
app.use('/api/refills', lazyRoute(() => import('./routes/refills.js')));
app.use('/api/wa-business', lazyRoute(() => import('./routes/whatsappBusiness.js')));
app.use('/api/automation', lazyRoute(() => import('./routes/automation.js')));
app.use('/api/triggers', lazyRoute(() => import('./routes/triggers.js')));
app.use('/api/system', lazyRoute(() => import('./routes/serviceStatus.js')));
// Core API routes
app.use('/api/sales', lazyRoute(() => import('./routes/sales.js'), 'hot'));
app.use('/api/inventory', lazyRoute(() => import('./routes/inventory.js'), 'hot'));
app.use('/api/dashboard', lazyRoute(() => import('./routes/dashboard.js'), 'hot'));
app.use('/api/purchases', lazyRoute(() => import('./routes/purchases.js'), 'hot'));
app.use('/api/sell-price', lazyRoute(() => import('./routes/sellPrice.js')));
app.use('/api/returns', lazyRoute(() => import('./routes/returns.js')));
app.use('/api/customer-returns', lazyRoute(() => import('./routes/customerReturns.js')));
app.use('/api/orders', lazyRoute(() => import('./routes/orders.js')));
app.use('/api/quick-assistant', lazyRoute(() => import('./routes/quickAssistant.js')));
app.use('/api/expiry', lazyRoute(() => import('./routes/expiry.js')));
app.use('/api/reports', lazyRoute(() => import('./routes/reports.js')));
app.use('/api/compliance', lazyRoute(() => import('./routes/compliance.js')));
app.use('/api/schedule-drugs', lazyRoute(() => import('./routes/scheduleDrugs.js')));
app.use('/api/email-order-reviews', lazyRoute(() => import('./routes/emailOrderReviews.js')));
// Generic /api routes
app.use('/api', lazyRoute(() => import('./routes/upload.js')));
app.use('/api', lazyRoute(() => import('./routes/catalog.js')));
app.use('/api', lazyRoute(() => import('./routes/medicines.js'), 'hot'));
app.use('/api', lazyRoute(() => import('./routes/enrichment.js')));
app.use('/api/contacts', lazyRoute(() => import('./routes/contacts.js')));
app.use('/api', lazyRoute(() => import('./routes/distributors.js')));
app.use('/api', lazyRoute(() => import('./routes/notifications.js'), 'hot'));
app.use('/api/whatsapp/queue', lazyRoute(() => import('./routes/whatsappQueue.js'), 'hot'));
app.use('/api/investigation', lazyRoute(() => import('./routes/investigation.js'), 'heavy'));
app.use('/api/audit', lazyRoute(() => import('./routes/audit.js')));
app.use('/api', lazyRoute(() => import('./routes/medicineAvailability.js')));

// Serve the built frontend (frontend/dist) for production-style deployments.
// Multi-candidate search ensures it finds frontend assets regardless of process cwd or pkg packaging.
const appDataDir = getAppDataDir();
const frontendCandidates = [
  path.resolve(appDataDir, 'frontend', 'dist'),
  path.resolve(process.cwd(), 'frontend', 'dist'),
  path.resolve(__dirname, '..', 'frontend', 'dist'),
  path.resolve(__dirname, '..', '..', 'frontend', 'dist'),
  path.resolve(process.cwd(), 'dist'),
  path.resolve(appDataDir, 'dist'),
];

const frontendDist = frontendCandidates.find(dir => fs.existsSync(path.join(dir, 'index.html'))) || frontendCandidates[0];

app.use(express.static(frontendDist, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.includes('assets') || /\.(js|css|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.html$/i.test(filePath)) {
      // Post-deploy clients must revalidate the shell; a cached day-old index.html
      // references pruned hashed chunks and breaks assets until a hard refresh.
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
app.use((req, res, next) => {
  // Let unmatched /api/* or /ws requests fall through to API/404 handlers
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  
  // Do not send index.html fallback for missing static asset files (.js, .css, images, etc.)
  // Returning HTML for a missing JS chunk file causes browser Unexpected token '<' syntax errors and loading loops.
  if (req.path.startsWith('/assets/') || /\.(js|css|png|jpg|jpeg|gif|svg|ico|json|woff2?|ttf|map)$/i.test(req.path)) {
    return res.status(404).send('Asset not found');
  }

  const indexPath = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexPath);
  }
  res.status(503).send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>AI PHARMACY OS — Assets Not Built</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family:system-ui, -apple-system, sans-serif; background:#0f172a; color:#f8fafc; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; padding:16px; box-sizing:border-box;">
        <div style="text-align:center; max-width:480px; width:100%; padding:32px 24px; background:#1e293b; border-radius:20px; border:1px solid #334155; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
          <div style="width:48px; height:48px; margin:0 auto 16px; background:#0ea5e9; border-radius:12px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:24px; color:#fff;">+</div>
          <h2 style="color:#38bdf8; margin:0 0 12px; font-size:20px;">AI PHARMACY OS</h2>
          <p style="color:#94a3b8; font-size:14px; line-height:1.5; margin:0 0 20px;">The backend server is running cleanly on port 5174, but the web interface assets are missing at:<br/><code style="display:block; margin-top:8px; padding:8px; background:#0f172a; border-radius:8px; font-size:12px; color:#e2e8f0; word-break:break-all;">${frontendDist}</code></p>
          <div style="background:#0f172a; padding:12px; border-radius:10px; font-size:12px; color:#cbd5e1; text-align:left; border:1px solid #334155;">
            <strong>To resolve this:</strong>
            <ul style="margin:6px 0 0; padding-left:18px;">
              <li>Run <code>npm run build:all</code> to build the web interface.</li>
              <li>Or run <code>npm run dev</code> to start in development mode.</li>
            </ul>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Initialize services that need startup logic
// These would be initialized via dependency injection in a complete refactor

// Error handling middleware - should be last
app.use(notFoundHandler);
app.use(errorHandler);

// --- Python Bridge Function for SciSpacy Medicine Extraction ---
export function extractMedicinesWithPython(messageText: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const pythonExecutable = path.resolve('python_scripts', '.venv', 'Scripts', 'python.exe');
        const scriptPath = path.resolve('python_scripts', 'extract_medicine.py');

        if (!fs.existsSync(pythonExecutable) || !fs.existsSync(scriptPath)) {
            return resolve([]);
        }

        const pythonProcess = spawn(pythonExecutable, [scriptPath, messageText]);
        
        let resultData = '';
        let errorData = '';
        let isSettled = false;

        const timer = setTimeout(() => {
            if (!isSettled) {
                isSettled = true;
                console.warn('[Python Warning] Python process execution timed out (5s limit). Terminating...');
                try { pythonProcess.kill('SIGKILL'); } catch (_) {}
                reject(new Error('Python process execution timed out.'));
            }
        }, 5000);

        pythonProcess.on('error', (err) => {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(timer);
            console.error(`[Python Error] Failed to spawn Python process: ${err.message}`);
            reject(new Error(`Python process spawn failed: ${err.message}`));
        });

        pythonProcess.stdout.on('data', (data) => {
            resultData += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorData += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(timer);

            if (code !== 0) {
                console.error(`[Python Error] Exit code ${code}: ${errorData}`);
                return reject(new Error('Python script crashed.'));
            }
            try {
                const parsedResult = JSON.parse(resultData);
                if (parsedResult.success) {
                    resolve(parsedResult.medicines);
                } else {
                    reject(new Error(parsedResult.error || 'Unknown Python error.'));
                }
            } catch (error) {
                console.error(`[Parse Error] Output was not valid JSON: ${resultData}`);
                reject(new Error("Failed to parse Python JSON output."));
            }
        });
    });
}

const PORT = config.port;

// Start HTTP server immediately to accept requests in <20ms
// ponytail: bind to 127.0.0.1 explicitly — on Windows, Node 17+ resolves bare
// 'localhost' to ::1 (IPv6) while Vite proxy targets 127.0.0.1 (IPv4), causing ECONNREFUSED.
const server = app.listen(PORT, '127.0.0.1', async () => {
  const serverUrl = `http://localhost:${PORT}`;
  console.log(`Server is running on ${serverUrl} (listening ${Math.round(performance.now() - BOOT_T0)}ms after module load)`);

  // Auto-open browser when launched from the packaged Windows executable (.exe)
  if (isPackagedApp() || process.env.AUTO_OPEN_BROWSER === 'true') {
    setTimeout(() => {
      console.log(`[Boot] Launching default browser at ${serverUrl}...`);
      const openerArgs: [string, string[]] = process.platform === 'win32'
        ? ['cmd', ['/c', 'start', serverUrl]]
        : process.platform === 'darwin'
        ? ['open', [serverUrl]]
        : ['xdg-open', [serverUrl]];
      // A failed browser launch (missing opener binary, locked-down PATH, etc.)
      // must never take down the API server — without this handler, the
      // ChildProcess's unhandled 'error' event becomes an uncaught exception
      // and processGuardian exits the whole process.
      spawn(openerArgs[0], openerArgs[1], { detached: true, stdio: 'ignore' })
        .on('error', (err) => {
          console.warn(`[Boot] Failed to auto-launch browser (non-fatal): ${err.message}`);
        })
        .unref();
    }, 1000);
  }
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`\n⚠️  Port ${PORT} is already bound by another instance of AI Pharmacy OS.`);
    console.warn(`AI Pharmacy OS server is already running in the background. Opening browser window...\n`);
    const serverUrl = `http://localhost:${PORT}`;
    const openerArgs: [string, string[]] = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', serverUrl]]
      : process.platform === 'darwin'
      ? ['open', [serverUrl]]
      : ['xdg-open', [serverUrl]];
    try {
      spawn(openerArgs[0], openerArgs[1], { detached: true, stdio: 'ignore' }).unref();
    } catch (_) {}
    setTimeout(() => process.exit(0), 500);
  } else {
    console.error('Server startup error:', err);
  }
});

  // Deterministic Sequential Staged Boot
  (async () => {
    try {
      // ── Phase 1: Database schema & WAL mode verification (Blocking) ─────────────
      const phase1T0 = performance.now();
      console.log('[Boot:Phase1] Initializing database schema, indexes, and WAL mode...');
      await ensureSchema(DB_PATH);
      schemaReady = true;
      console.log(`[Boot:Phase1] Database schema ready in ${Math.round(performance.now() - phase1T0)}ms — API requests unblocked.`);

      // Route pre-warm now starts here (not at module load) so V8 compile work
      // never competes with database DDL for the event loop.
      void startTieredPreWarm();

      const db = await dbManager.getConnection();

      // ── Phase 2: In-memory cache pre-warm ───────────────────────────────────────
      const phase2T0 = performance.now();
      console.log('[Boot:Phase2] Pre-warming in-memory cache & reference dictionary...');
      const { inventoryCache } = await import('./services/inventoryCache.js');
      inventoryCache.initialize(db);
      inventoryCache.rebuild(db)
        .then(() => console.log('[Boot:Phase2] Compact inventory cache pre-built successfully.'))
        .catch(err => console.error('[Boot:Phase2] Inventory cache prebuild failed:', err));

      // Fire-and-forget (was awaited): seeding must not delay Phase 3 worker
      // startup — failures are logged, nothing downstream depends on it here.
      import('./worker/compositionEnricher.js')
        .then(m => m.seedBundledReference())
        .then(res => {
          if (res.loaded > 0) console.log(`[Boot:Phase2] Seeded ${res.loaded} reference APIs into dictionary.`);
        })
        .catch(seedErr => console.warn('[Boot:Phase2] Bundled reference seed failed:', seedErr));

      console.log(`[Boot:Phase2] Cache init + reference seed dispatched in ${Math.round(performance.now() - phase2T0)}ms.`);

      // Pharmarack session validation starts as soon as the DB is ready — the
      // boot heartbeat probe (T≈now instead of T+2s) proves the stored token or
      // begins the single-flight browser restore BEFORE a user's first search
      // can hit a mid-typing 401. orderFulfillmentService stays on the T+2s
      // stagger in Phase 4 below.
      import('./services/tokenRefreshScheduler.js')
        .then(m => m.tokenRefreshScheduler.start())
        .catch(err => console.warn('[Boot:Phase2] Pharmarack session heartbeat start failed:', err));

      // Record unclean boot flag (flipped to 'true' on clean gracefulShutdown)
      try {
        const prevShutdown = await db.get("SELECT value FROM app_settings WHERE key = 'last_clean_shutdown'");
        if (prevShutdown && prevShutdown.value === 'false') {
          console.warn('[Boot] WARNING: Last shutdown was unclean (app may have crashed or been force-killed).');
        }
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_clean_shutdown', 'false')");
      } catch (bootErr) {
        console.error('[Boot] Could not write last_clean_shutdown flag:', bootErr);
      }

      // Check if background automation is enabled in store settings
      await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
      const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      const isAutoEnabled = autoRow && autoRow.value === 'true';

      // ── Phase 3: Lightweight workers (gated on automation_enabled === 'true') ──
      setImmediate(async () => {
        console.log('[Boot:Phase3] Evaluating lightweight workers & startup evaluation...');

        if (isAutoEnabled) {
          // Unified Engine stock calculator worker
          const { startStockCalculatorWorker } = await import('./worker/stockCalculatorWorker.js');
          startStockCalculatorWorker();
          console.log('[Boot:Phase3] Unified Engine stock calculator worker started.');

          // Startup refill evaluation
          try {
            const { checkAllRefills } = await import('./services/refillService.js');
            await checkAllRefills(db);
          } catch (refillErr) {
            bootWorkerFailures++;
            console.error('[Boot:Phase3] Refill startup evaluation error:', refillErr);
          }

          // Daily catch-up check (overdue credit notes & monthly expiry returns review)
          const d = new Date();
          const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const lastCheckRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_daily_check_date'");
          
          if (!lastCheckRow || lastCheckRow.value !== todayStr) {
            console.log(`[Boot:Phase3] Daily check missed today (${todayStr}). Running catch-up daily check...`);
            try {
              const { checkOverdueCreditNotes } = await import('./services/creditNoteService.js');
              await checkOverdueCreditNotes(db);

              // Expiry return review catch-up — same every-N-days gate as the
              // scheduler (default 15), so a missed tick is recovered on boot.
              const { shouldRunScheduledExpiryReturnScan, scanAndCreateExpiryReviews } = await import('./services/returnsService.js');
              if (await shouldRunScheduledExpiryReturnScan(db)) {
                console.log('[Boot:Phase3] Expiry return review scan due. Running inventory-only expired-stock scan...');
                await scanAndCreateExpiryReviews(db);
              }

              await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_daily_check_date', ?)", [todayStr]);
            } catch (err) {
              bootWorkerFailures++;
              console.error('[Boot:Phase3] Startup catch-up daily check failed:', err);
            }
          }

          // Expiry alerts & shortage reminder scans
          const { checkAndRunScheduledExpiryScan } = await import('./services/expiryAlertService.js');
          await checkAndRunScheduledExpiryScan(90).catch(err => { bootWorkerFailures++; console.error('[Boot:Phase3] Expiry scan check failed:', err); });

          const { checkShortageRequestsAndNotifyAdmin } = await import('./services/shortageReminderService.js');
          checkShortageRequestsAndNotifyAdmin(db).catch(err => { bootWorkerFailures++; console.error('[Boot:Phase3] Shortage check failed:', err); });
        } else {
          console.log('[Boot:Phase3] Background automation is disabled in Settings — skipping automatic startup workers.');
        }

        // Monthly reports check
        const { monthlyReportService } = await import('./services/monthlyReportService.js');
        monthlyReportService.checkAndRunScheduledReports().catch(err => { bootWorkerFailures++; console.error('[Boot:Phase3] Monthly report check failed:', err); });

        // Backup scheduler
        const { initBackupScheduler } = await import('./services/backupService.js');
        await initBackupScheduler().catch(err => { bootWorkerFailures++; console.error('[Boot:Phase3] Failed to init backup scheduler:', err); });

        // Doctor reporting service — registered ONLY when its trigger is enabled
        // (owner rule 2026-08: no feature configured → no timer at all).
        try {
          const drRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_doctor_report_enabled'");
          if (drRow?.value === 'true') {
            const { startDoctorReportingScheduler } = await import('./services/doctorReportingService.js');
            startDoctorReportingScheduler();
            console.log('[Boot:Phase3] Doctor reporting scheduler started (trigger enabled).');
          }
        } catch (err) {
          bootWorkerFailures++;
          console.error('[Boot:Phase3] Doctor reporting gate check failed:', err);
        }

        // Push notification service listener
        import('./services/pushNotificationService.js').catch(err => { bootWorkerFailures++; console.error('[Boot:Phase3] Push service load failed:', err); });

        // Distributor dispatch reminder worker — registered ONLY when its
        // trigger is enabled; triggerSchedulerService stops/starts it live on
        // settings changes.
        try {
          const drwRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_dispatch_reminder_enabled'");
          if (drwRow?.value === 'true') {
            const { startDistributorDispatchReminderWorker } = await import('./services/distributorDispatchReminderWorker.js');
            startDistributorDispatchReminderWorker();
            console.log('[Boot:Phase3] Distributor dispatch reminder worker started (trigger enabled).');
          }
        } catch (err) {
          bootWorkerFailures++;
          console.error('[Boot:Phase3] Distributor reminder worker start failed:', err);
        }

        // WhatsApp queue: boot-time crash recovery ONLY (lazy loop — owner rule
        // 2026-08). The poll loop itself starts on first enqueue / explicit enable.
        import('./services/whatsappQueueWorker.js').then(m => m.whatsappQueueWorker.cleanupOldSentItems()).catch(err => { bootWorkerFailures++; console.error('[Boot:Phase3] WhatsApp queue recovery failed:', err); });

        // ── Phase 4: Headless browser subsystems & asynchronous workers (staggered) ──
        console.log('[Boot:Phase4] Staging headless browser & external service schedulers...');

        // T+2s: order fulfillment only — the Pharmarack session heartbeat now
        // starts right after Phase 1/2 (see [Boot:Phase2]) so token validation
        // and any needed single-flight browser restore begin before the first
        // user search. messagingQueue is lazy now (owner rule 2026-08): its
        // poll loop starts on first pending queueMessage()/retryMessage() —
        // zero ticks when unused.
        setTimeout(async () => {
          try {
            const { orderFulfillmentService } = await import('./services/orderFulfillmentService.js');
            orderFulfillmentService.start();
          } catch (srvErr) {
            bootWorkerFailures++;
            console.error('[Boot:Phase4] Failed to start order fulfillment service:', srvErr);
          }
        }, 2000);

        // T+5s: Worker supervisor & scispaCy NLP sidecar
        setTimeout(async () => {
          try {
            const { workerSupervisor } = await import('./worker/workerSupervisor.js');
            workerSupervisor.start();
          } catch (err) {
            bootWorkerFailures++;
            console.error('[Boot:Phase4] Failed to start worker supervisor:', err);
          }
          try {
            const { startScispacySidecar } = await import('./services/scispacyClient.js');
            startScispacySidecar();
          } catch (err) {
            bootWorkerFailures++;
            console.error('[Boot:Phase4] Failed to start scispaCy sidecar:', err);
          }
        }, 5000);

        // T+8s: Telegram bot service
        setTimeout(async () => {
          try {
            const { telegramBotService } = await import('./telegramBot.js');
            await telegramBotService.initializeOrReloadBot();
            console.log('[Boot:Phase4] Telegram bot initialized');
          } catch (err) {
            bootWorkerFailures++;
            console.error('[Boot:Phase4] Failed to initialize Telegram Bot:', err);
          }
        }, 8000);

        // T+45s: WhatsApp client auto-init (silent restoration if saved session exists & WhatsApp is enabled)
        setTimeout(() => {
          import('./whatsappClient.js').then(async (m) => {
            if (await m.isWhatsAppExplicitlyDisabled()) {
              return;
            }
            if (m.hasSavedSession()) {
              console.log('[Boot:Phase4] Saved WhatsApp session detected. Auto-starting WhatsApp client (staggered T+45s)...');
              await m.initClient().catch(err => { bootWorkerFailures++; console.error('[Boot:Phase4] Auto WhatsApp init failed:', err); });
            }
          }).catch(err => { bootWorkerFailures++; console.error('[Boot:Phase4] WhatsApp client module load failed:', err); });
        }, 45_000);

        // Startup live-cart warm-up: resolves startupSyncCoordinator from real data at boot
        // instead of waiting for the first UI visit to GET /api/pharmarack/cart.
        // Primary path chains onto the first token refresh so it uses a fresh Pharmarack
        // token without racing the headless Chrome login; the T+50s timer is the safety net
        // for scheduler-disabled setups and skipped refreshes.
        import('./services/tokenRefreshScheduler.js').then(m => {
          m.tokenRefreshScheduler.onFirstRefreshComplete(() => {
            import('./routes/pharmarack.js').then(mod => mod.warmupStartupCart()).catch((err: any) => console.warn('[Boot] Cart warm-up failed:', err?.message || err));
          });
        }).catch(err => console.warn('[Boot] Token-refresh warm-up hook failed:', err));

        setTimeout(() => {
          if (process.env.DISABLE_BACKGROUND_WORKERS !== 'false') return;
          import('./routes/pharmarack.js').then(mod => mod.warmupStartupCart()).catch(err => console.warn('[Boot:Phase4] Cart warm-up fallback failed:', err?.message || err));
        }, 50_000);
      });

      // Register crons
      setupCrons(db);

      // One-line boot health summary, ~T+10s (covers the T+2/5/8s staggers).
      // Later failures (WhatsApp T+45s, cart warm-up) still log their own errors.
      setTimeout(() => {
        console.log(`[Boot] Startup complete: ${((performance.now() - BOOT_T0) / 1000).toFixed(1)}s total, ${bootWorkerFailures} background worker start failure(s), ${registeredLazyRoutes.length} lazy routes registered.`);
      }, 10_000);

    } catch (err) {
      if (err instanceof Error && err.message === 'DB_INTEGRITY_FAILURE') {
        console.error(
          '[FATAL] Database integrity check failed and could not be automatically recovered.\n' +
          'Please use the backup/restore feature in the app settings to restore a healthy backup.\n' +
          'The application will not start until the database is repaired.'
        );
      } else {
        console.error('Failed to initialize database schema during boot:', err);
      }
      process.exit(1);
    }
  })();

async function setupCrons(db: any) {
  if (process.env.DISABLE_BACKGROUND_WORKERS !== 'false') {
    console.log('[Cron] All background crons are STOPPED and DISABLED.');
    return;
  }

  try {
    const { triggerSchedulerService } = await import('./services/triggerSchedulerService.js');
    await triggerSchedulerService.initSchedules(db);
  } catch (err) {
    bootWorkerFailures++;
    console.error('[Boot] Failed to initialize dynamic trigger scheduler:', err);
  }

  const cron = (await import('node-cron')).default;

  // Periodic Pharmarack catalog sync every 35 minutes — registered ONLY when a
  // Pharmarack session token exists (owner rule 2026-08: credential-gated).
  // Saving a token arms it; logout disarms it (ensureCatalogSyncCron/
  // stopCatalogSyncCron in pharmarackCatalogCache.ts).
  try {
    const { ensureCatalogSyncCron } = await import('./services/pharmarackCatalogCache.js');
    await ensureCatalogSyncCron();
  } catch (err) {
    bootWorkerFailures++;
    console.error('[Boot] Failed to evaluate catalog sync cron registration:', err);
  }

  // Pharmarack daily batch dispatch: runs every minute during the 11 AM hour.
  cron.schedule('* 11 * * *', async () => {
    try {
      const { tryDailySend } = await import('./services/pharmarackDailyDispatchService.js');
      await tryDailySend();
    } catch (err) {
      console.error('[PharmarackBatch] 11AM cron error:', err);
    }
  });

  // Register OCR completion listener for WhatsApp intent service
  try {
    const { eventService } = await import('./services/eventService.js');
    const { whatsappIntentService } = await import('./services/whatsappIntentService.js');
    eventService.on('server_event', (event: any) => {
      if (event?.type === 'ocr_scan_complete') {
        whatsappIntentService.handleOcrComplete(event.payload);
      }
    });
    // Register autoMatchWorker for special order inventory auto-matching
    try {
      const { autoMatchWorker } = await import('./worker/autoMatchWorker.js');
      autoMatchWorker.start(900000); // 15-minute scan interval
      console.log('[Boot] AutoMatchWorker for special orders initialized.');
    } catch (amErr) {
      console.warn('[Boot] AutoMatchWorker initialization skipped:', amErr);
    }
  } catch (err) {
    bootWorkerFailures++;
    console.warn('[Boot] WhatsApp intent service registration skipped:', err);
  }
}

// Graceful shutdown with auto-backup
async function gracefulShutdown(signal: string) {
  console.log(`${signal} received. Draining in-flight requests...`);
  // Stop accepting NEW connections immediately, but let requests already being handled
  // finish naturally instead of racing them against dbManager.close(true) below.
  server.close();
  const drainStart = Date.now();
  const DRAIN_TIMEOUT_MS = 10000;
  while (inFlightRequests > 0 && Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (inFlightRequests > 0) {
    console.warn(`[Shutdown] ${inFlightRequests} request(s) still in flight after ${DRAIN_TIMEOUT_MS}ms — proceeding anyway.`);
  }

  console.log(`${signal} received. Creating shutdown backup...`);
  // Mark clean shutdown BEFORE anything else that might fail
  try {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_clean_shutdown', 'true')");
  } catch (flagErr) {
    console.error('[Shutdown] Could not write last_clean_shutdown=true:', flagErr);
  }
  try {
    const { createBackup } = await import('./services/backupService.js');
    const result = await createBackup(`Shutdown (${signal})`);
    console.log(`[Backup] Shutdown backup created: ${result.filename}`);
  } catch (err) {
    console.error('[Backup] Shutdown backup failed:', err);
  }
  try {
    const { workerSupervisor } = await import('./worker/workerSupervisor.js');
    workerSupervisor.stop();
  } catch (err) {
    console.error('Error stopping worker supervisor:', err);
  }
  try {
    const { stopScispacySidecar } = await import('./services/scispacyClient.js');
    stopScispacySidecar();
  } catch (err) {
    console.error('Error stopping scispaCy sidecar:', err);
  }
  await dbManager.close(true);
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
process.on('SIGBREAK', () => gracefulShutdown('SIGBREAK'));