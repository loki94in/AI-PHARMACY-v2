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

// Flipped to true once ensureSchema() finishes below. Gates every /api route
// so the first requests after exe launch can't hit a not-yet-created schema
// and randomly 500 during the boot window.
let schemaReady = false;

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
function lazyRoute(loader: () => Promise<{ default: express.Router }>): express.RequestHandler {
  let router: express.Router | null = null;
  let loadPromise: Promise<express.Router> | null = null;
  return (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') {
      loader().then(m => m.default(req, res, next)).catch(next);
      return;
    }
    if (router) return router(req, res, next);
    if (!loadPromise) {
      loadPromise = loader().then(m => {
        router = m.default;
        return router!;
      });
    }
    loadPromise.then(r => r(req, res, next)).catch(next);
  };
}

// Register process-level crash handler (logs to crash_log, exits(1) for watchdog restart)
registerProcessGuardian();

// Enable background workers and supervisors by default (can be disabled via env var if needed)
process.env.DISABLE_BACKGROUND_WORKERS = process.env.DISABLE_BACKGROUND_WORKERS || 'false';
process.env.DISABLE_SELF_HEALING_WORKERS = process.env.DISABLE_SELF_HEALING_WORKERS || 'false';

const app = express();
app.use(compression());

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
app.use('/api/security', lazyRoute(() => import('./routes/security.js')));
app.use('/api/email', lazyRoute(() => import('./routes/email.js')));
app.use('/api/verification', lazyRoute(() => import('./routes/verification.js')));
app.use('/api/migration', lazyRoute(() => import('./routes/migration.js')));
app.use('/api/settings', lazyRoute(() => import('./routes/settings.js')));
app.use('/api/pharmarack', lazyRoute(() => import('./routes/pharmarack.js')));
app.use('/api/dispatch', lazyRoute(() => import('./routes/dispatch.js')));
app.use('/api/archive', lazyRoute(() => import('./routes/archive.js')));
app.use('/api/learning', lazyRoute(() => import('./routes/learning.js')));
app.use('/api/messaging', lazyRoute(() => import('./routes/messaging.js')));
app.use('/api/aicamera', lazyRoute(() => import('./routes/aiCamera.js')));
app.use('/api/telegram-prescription', lazyRoute(() => import('./routes/telegramPrescription.js')));
app.use('/api/refills', lazyRoute(() => import('./routes/refills.js')));
app.use('/api/wa-business', lazyRoute(() => import('./routes/whatsappBusiness.js')));
app.use('/api/automation', lazyRoute(() => import('./routes/automation.js')));
app.use('/api/system', lazyRoute(() => import('./routes/serviceStatus.js')));
// Core API routes
app.use('/api/sales', lazyRoute(() => import('./routes/sales.js')));
app.use('/api/inventory', lazyRoute(() => import('./routes/inventory.js')));
app.use('/api/dashboard', lazyRoute(() => import('./routes/dashboard.js')));
app.use('/api/purchases', lazyRoute(() => import('./routes/purchases.js')));
app.use('/api/sell-price', lazyRoute(() => import('./routes/sellPrice.js')));
app.use('/api/returns', lazyRoute(() => import('./routes/returns.js')));
app.use('/api/customer-returns', lazyRoute(() => import('./routes/customerReturns.js')));
app.use('/api/credit-notes', lazyRoute(() => import('./routes/creditNotes.js')));
app.use('/api/orders', lazyRoute(() => import('./routes/orders.js')));
app.use('/api/quick-assistant', lazyRoute(() => import('./routes/quickAssistant.js')));
app.use('/api/expiry', lazyRoute(() => import('./routes/expiry.js')));
app.use('/api/reports', lazyRoute(() => import('./routes/reports.js')));
app.use('/api/compliance', lazyRoute(() => import('./routes/compliance.js')));
app.use('/api/email-order-reviews', lazyRoute(() => import('./routes/emailOrderReviews.js')));
// Generic /api routes
app.use('/api', lazyRoute(() => import('./routes/upload.js')));
app.use('/api', lazyRoute(() => import('./routes/catalog.js')));
app.use('/api', lazyRoute(() => import('./routes/medicines.js')));
app.use('/api', lazyRoute(() => import('./routes/enrichment.js')));
app.use('/api/contacts', lazyRoute(() => import('./routes/contacts.js')));
app.use('/api', lazyRoute(() => import('./routes/distributors.js')));
app.use('/api', lazyRoute(() => import('./routes/notifications.js')));
app.use('/api/whatsapp/queue', lazyRoute(() => import('./routes/whatsappQueue.js')));
app.use('/api/investigation', lazyRoute(() => import('./routes/investigation.js')));
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
        // Path to the Python executable in your virtual environment
        const pythonExecutable = path.resolve('python_scripts', '.venv', 'Scripts', 'python.exe');
        const scriptPath = path.resolve('python_scripts', 'extract_medicine.py');

        const pythonProcess = spawn(pythonExecutable, [scriptPath, messageText]);
        
        let resultData = '';
        let errorData = '';

        pythonProcess.stdout.on('data', (data) => {
            resultData += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorData += data.toString();
        });

        pythonProcess.on('close', (code) => {
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
const server = app.listen(PORT, async () => {
  const serverUrl = `http://localhost:${PORT}`;
  console.log(`Server is running on ${serverUrl}`);

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
    console.warn(`AI Pharmacy OS server is already running in the background.\n`);
    process.exit(0);
  } else {
    console.error('Server startup error:', err);
  }
});

  // Asynchronously initialize database, indexes and cache in the background
  (async () => {
    try {
      console.log('[Boot] Initializing database schema and index checks...');
      await ensureSchema(DB_PATH);
      schemaReady = true;
      console.log('[Boot] Schema ready — API requests unblocked.');

      const db = await dbManager.getConnection();
      
      // Initialize and rebuild compact inventory cache
      const { inventoryCache } = await import('./services/inventoryCache.js');
      inventoryCache.initialize(db);
      // ponytail: don't await — cache auto-rebuilds on first get() call, no need to block boot
      inventoryCache.rebuild(db)
        .then(() => console.log('[Boot] Compact inventory cache pre-built successfully.'))
        .catch(err => console.error('[Boot] Inventory cache prebuild failed:', err));

      // Mark this boot as unclean (will be flipped to 'true' in gracefulShutdown)
      try {
        const prevShutdown = await db.get("SELECT value FROM app_settings WHERE key = 'last_clean_shutdown'");
        if (prevShutdown && prevShutdown.value === 'false') {
          console.warn('[Boot] WARNING: Last shutdown was unclean (app may have crashed or been force-killed).');
        }
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_clean_shutdown', 'false')");
      } catch (bootErr) {
        console.error('[Boot] Could not write last_clean_shutdown flag:', bootErr);
      }

      // Check if background automation is enabled
      await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
      const row = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      const isAutoEnabled = row && row.value === 'true';

      // Flatten background initialization sequence using flat step array and Promise.allSettled
      // Run steps at T+2 seconds (warm caches, workers, Telegram, schedulers)
      setImmediate(async () => {
        console.log('[Boot] Starting background initialization services...');

        const initSteps = [
          // Step 1: WhatsApp client lazy initialization — only started when user visits WhatsApp UI page
          (async () => {
            console.log('[Boot] WhatsApp client is lazy-loaded (will only initialize when user opens WhatsApp page).');
          })(),

          // Step 2: Unified Engine background workers
          (async () => {
            const { startStockCalculatorWorker } = await import('./worker/stockCalculatorWorker.js');
            startStockCalculatorWorker();
            console.log('[Boot] Unified Engine background workers started');
          })(),

          // Step2b: Seed a small bundled API dictionary into medicine_reference
          // (offline fallback when the full reference CSV is absent) so API-identity
          // matching + the scan gate have a working dictionary from first boot.
          (async () => {
            try {
              const { seedBundledReference } = await import('./worker/compositionEnricher.js');
              const res = await seedBundledReference();
              if (res.loaded > 0) console.log(`[Boot] Seeded ${res.loaded} reference APIs.`);
            } catch (seedErr) {
              console.warn('[Boot] Bundled reference seed failed:', seedErr);
            }
          })(),

          // Step 3: Startup catch-up check & cron schedules (Refills, overdue credit notes, return processing)
          (async () => {
            console.log('[Boot] Running startup evaluation for patient refills and credit notes...');
            try {
              const { checkAllRefills } = await import('./services/refillService.js');
              await checkAllRefills(db);
            } catch (refillErr) {
              console.error('[Boot] Refill startup evaluation error:', refillErr);
            }

            if (isAutoEnabled) {
              const d = new Date();
              const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              const lastCheckRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_daily_check_date'");
              
              if (!lastCheckRow || lastCheckRow.value !== todayStr) {
                console.log(`[Boot] Daily check missed today (${todayStr}). Running catch-up daily check...`);
                try {
                  const { checkOverdueCreditNotes } = await import('./services/creditNoteService.js');
                  await checkOverdueCreditNotes(db);
                  
                  // Auto expiry return on 18th, 19th, 20th of the month
                  const dayOfMonth = new Date().getDate();
                  if (dayOfMonth === 18 || dayOfMonth === 19 || dayOfMonth === 20) {
                    console.log(`[Boot] Today is the ${dayOfMonth}th. Running catch-up for expired returns...`);
                    const { autoCreateExpiryReturns } = await import('./services/returnsService.js');
                    await autoCreateExpiryReturns(db);
                  }

                  await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_daily_check_date', ?)", [todayStr]);
                } catch (err) {
                  console.error('[Boot] Startup catch-up daily check failed:', err);
                }
              }
            }
          })(),

          // Step 4: Expiry & Shortage 23-Hour scan check
          (async () => {
            if (isAutoEnabled) {
              const { checkAndRunScheduledExpiryScan } = await import('./services/expiryAlertService.js');
              await checkAndRunScheduledExpiryScan(90).catch(err => console.error('[Boot] Startup catch-up scan check failed:', err));

              const { checkShortageRequestsAndNotifyAdmin } = await import('./services/shortageReminderService.js');
              checkShortageRequestsAndNotifyAdmin(db).catch(err => console.error('[Boot] Shortage check failed:', err));
            }
          })(),

          // Step 4b: Monthly & Mid-Month Scheduled Reports (1st & 15th of month)
          (async () => {
            const { monthlyReportService } = await import('./services/monthlyReportService.js');
            monthlyReportService.checkAndRunScheduledReports().catch(err => console.error('[Boot] Monthly report check failed:', err));
          })(),


          // Step 5: Telegram Bot initialization (Deferred to T+8s to prevent blocking boot)
          new Promise<void>((resolve) => {
            setTimeout(async () => {
              try {
                const { telegramBotService } = await import('./telegramBot.js');
                await telegramBotService.initializeOrReloadBot();
                console.log('[Boot] Telegram bot initialized');
              } catch (err) {
                console.error('[Boot] Failed to initialize Telegram Bot:', err);
              }
              resolve();
            }, 6000); // 2s baseline + 6s delay = 8s
          }),

          // Step 6: Backup scheduler
          (async () => {
            const { initBackupScheduler } = await import('./services/backupService.js');
            await initBackupScheduler().catch(err => console.error('[Boot] Failed to init backup scheduler:', err));
          })(),

          // Step 7: Worker supervisor (deferred T+5s to avoid blocking boot with fork()x2)
          new Promise<void>((resolve) => {
            setTimeout(async () => {
              try {
                const { workerSupervisor } = await import('./worker/workerSupervisor.js');
                workerSupervisor.start();
              } catch (err) {
                console.error('[Boot] Failed to start worker supervisor:', err);
              }
              try {
                const { startScispacySidecar } = await import('./services/scispacyClient.js');
                startScispacySidecar();
              } catch (err) {
                console.error('[Boot] Failed to start scispaCy sidecar:', err);
              }
              resolve();
            }, 5000);
          }),

          // Step 8: Schedulers for token refresh, messaging queue and refills fulfillment
          // Note: Pharmarack token refresh scheduler and background service starts here.
          (async () => {
            try {
              const { tokenRefreshScheduler } = await import('./services/tokenRefreshScheduler.js');
              tokenRefreshScheduler.start();
              
              const { messagingQueue } = await import('./services/messagingQueue.js');
              messagingQueue.start();

              const { orderFulfillmentService } = await import('./services/orderFulfillmentService.js');
              orderFulfillmentService.start();
            } catch (srvErr) {
              console.error('[Boot] Failed to start order/refills services:', srvErr);
            }
          })(),

          // Step 9: Doctor reporting service
          (async () => {
            const { startDoctorReportingScheduler } = await import('./services/doctorReportingService.js');
            startDoctorReportingScheduler();
          })()
        ];

        // Start all initialization tasks concurrently without blocking
        Promise.allSettled(initSteps).then((results) => {
          console.log('[Boot] Background initialization sequence completed');
        });

        // WhatsApp Queue Worker (started always, lazy-loaded)
        import('./services/whatsappQueue.js').then(m => m.whatsappQueue.startWorker()).catch(err => console.error('[Boot] WhatsApp queue worker start failed:', err));

        // Push notification event listener (lazy-loaded)
        import('./services/pushNotificationService.js').catch(err => console.error('[Boot] Push service load failed:', err));

      });

      // Register crons
      setupCrons(db);

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

  const cron = (await import('node-cron')).default;

  // Daily check at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    try {
      const mode = await getBackendFetchMode('bg.dailyScans', 'off');
      if (mode === 'off') {
        console.log('[Cron] Daily checks cron is disabled (mode=off)');
        return;
      }
      if (mode === 'manual' && activityTracker.isIdle()) {
        console.log('[Cron] Daily checks cron skipped (mode=manual, system is idle)');
        return;
      }

      const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      if (!autoRow || autoRow.value !== 'true') return;
      console.log('Running daily patient refill, bounced products & overdue credit notes check...');
      const { checkAllRefills } = await import('./services/refillService.js');
      const { checkOverdueCreditNotes } = await import('./services/creditNoteService.js');
      await checkAllRefills(db);
      await checkOverdueCreditNotes(db);
      
      try {
        const { bouncedAlertService } = await import('./services/bouncedAlertService.js');
        await bouncedAlertService.checkAndSendBouncedProductsAlert();
      } catch (bErr) {
        console.error('Failed running bounced products alert check:', bErr);
      }
      
      const dayOfMonth = new Date().getDate();
      if (dayOfMonth === 18 || dayOfMonth === 19 || dayOfMonth === 20) {
        const { autoCreateExpiryReturns } = await import('./services/returnsService.js');
        await autoCreateExpiryReturns(db);
      }

      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_daily_check_date', ?)", [todayStr]);
    } catch (err) {
      console.error('Failed running daily check cron:', err);
    }
  });

  // Automatic near-expiry scan & alerts (Every 15 days at 9:00 AM)
  cron.schedule('0 9 1,16 * *', async () => {
    try {
      const mode = await getBackendFetchMode('bg.dailyScans', 'off');
      if (mode === 'off') {
        console.log('[Cron] Near-expiry scan cron is disabled (mode=off)');
        return;
      }
      if (mode === 'manual' && activityTracker.isIdle()) {
        console.log('[Cron] Near-expiry scan cron skipped (mode=manual, system is idle)');
        return;
      }

      const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      if (!autoRow || autoRow.value !== 'true') return;
      const { runExpiryScanAndAlert } = await import('./services/expiryAlertService.js');
      await runExpiryScanAndAlert(90);
    } catch (err) {
      console.error('Failed running 15-day expiry scan cron:', err);
    }
  });

  // Nightly 9:59 PM backup
  cron.schedule('59 21 * * *', async () => {
    try {
      const mode = await getBackendFetchMode('bg.nightlyBackup', 'off');
      if (mode === 'off') {
        console.log('[Backup] Nightly backup is disabled (mode=off)');
        return;
      }
      if (mode === 'manual' && activityTracker.isIdle()) {
        console.log('[Backup] Nightly backup skipped (mode=manual, system is idle)');
        return;
      }

      const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      if (!autoRow || autoRow.value !== 'true') return;
      const { createBackup } = await import('./services/backupService.js');
      const result = await createBackup('Nightly 9:30 PM');
      console.log(`[Backup] Nightly backup created: ${result.filename}`);
    } catch (err) {
      console.error('[Backup] Nightly backup failed:', err);
    }
  });

  // Periodic Pharmarack catalog sync every 35 minutes (WhatsApp OCR Pipeline)
  cron.schedule('*/35 * * * *', async () => {
    try {
      const mode = await getBackendFetchMode('bg.catalogSync', 'auto');
      if (mode === 'off') {
        console.log('[Catalog Cache] Periodic sync is disabled (mode=off)');
        return;
      }
      if (mode === 'manual' && activityTracker.isIdle()) {
        console.log('[Catalog Cache] Periodic sync skipped (mode=manual, system is idle)');
        return;
      }

      const { pharmarackCatalogCache } = await import('./services/pharmarackCatalogCache.js');
      const result = await pharmarackCatalogCache.syncCatalog();
      console.log(`[Catalog Cache] Periodic sync complete: ${result.synced} products, ${result.errors} errors`);
    } catch (err) {
      console.error('[Catalog Cache] Periodic sync cron failed:', err);
    }
  });

  // Pharmarack daily batch dispatch: runs every minute during the 11 AM hour.
  // tryDailySend() is idempotent — it checks the exact window and today's sent-flag internally.
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
    console.warn('[Boot] WhatsApp intent service registration skipped:', err);
  }
}

// Graceful shutdown with auto-backup
async function gracefulShutdown(signal: string) {
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