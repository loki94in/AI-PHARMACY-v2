import './database/sqlitePatch.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { authenticateApiKey } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { dbManager } from './database/connection.js';
import { ensureSchema } from './database.js';
import { registerProcessGuardian } from './process/processGuardian.js';
import { activityTracker } from './utils/activityTracker.js';
import { getBackendFetchMode } from './services/dataFetchControl.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'app.db');

// Startup check disabled permanently

/**
 * Lazy-load route factory: defers module import until first request hits this path.
 * Eliminates ~8-12s of cold boot time from heavy transitive dependencies
 * (puppeteer, tesseract, onnxruntime, whatsapp-web.js, xlsx, etc.)
 */
function lazyRoute(modulePath: string): express.RequestHandler {
  let router: express.Router | null = null;
  let loadPromise: Promise<express.Router> | null = null;
  return (req, res, next) => {
    if (router) return router(req, res, next);
    if (!loadPromise) {
      loadPromise = import(modulePath).then(m => {
        router = m.default;
        return router!;
      });
    }
    loadPromise.then(r => r(req, res, next)).catch(next);
  };
}

// Register process-level crash handler (logs to crash_log, exits(1) for watchdog restart)
registerProcessGuardian();

// ── SKIP_AUTH safety guard ──────────────────────────────────────────
// Hard block: never allow auth bypass in production
if (process.env.SKIP_AUTH === 'true' && process.env.NODE_ENV === 'production') {
  throw new Error(
    'FATAL: SKIP_AUTH=true is set while NODE_ENV=production. ' +
    'This is forbidden. Unset SKIP_AUTH before deploying to production.'
  );
}
if (process.env.SKIP_AUTH === 'true') {
  console.warn('⚠️  AUTH BYPASS ACTIVE — SKIP_AUTH=true. DO NOT USE IN PRODUCTION.');
}
// ────────────────────────────────────────────────────────────────────

const app = express();

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
const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
const TEMP_DIR = path.join(UPLOAD_DIR, 'temp');
const RAW_DIR = path.resolve(__dirname, '..', 'catalogue', 'raw');

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
  'http://localhost:3000',  // Production build
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
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
  max: 300, // limit each IP to 300 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production' || req.path.startsWith('/api/migration') || req.path.startsWith('/api/notifications'),
  message: { error: 'Too many requests, please try again later' }
}));
app.use(express.json({ limit: '15mb' }));


app.use('/uploads', express.static(path.resolve(__dirname, '..', 'uploads')));
app.use('/data/search_screenshots', express.static(path.resolve(__dirname, '..', 'data', 'search_screenshots')));

// Old test console routes have been removed. This server now acts purely as an API backend.

// WhatsApp Business webhook (before auth — needs to be publicly accessible)
app.use('/api/wa-business/webhook', lazyRoute('./routes/whatsappBusiness.js'));

// Public health check endpoint for mobile connection testing
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString() });
});

// Session token auth for all other API routes
app.use('/api', authenticateApiKey);

// All routes lazy-loaded: modules import on first request, not at server startup.
// Agent 2 (CRM & Utilities) Routers
app.use('/api/crm', lazyRoute('./routes/crm.js'));
app.use('/api/utilities', lazyRoute('./routes/utilities.js'));
app.use('/api/security', lazyRoute('./routes/security.js'));
app.use('/api/email', lazyRoute('./routes/email.js'));
app.use('/api/verification', lazyRoute('./routes/verification.js'));
app.use('/api/migration', lazyRoute('./routes/migration.js'));
app.use('/api/settings', lazyRoute('./routes/settings.js'));
app.use('/api/pharmarack', lazyRoute('./routes/pharmarack.js'));
app.use('/api/dispatch', lazyRoute('./routes/dispatch.js'));
app.use('/api/archive', lazyRoute('./routes/archive.js'));
app.use('/api/learning', lazyRoute('./routes/learning.js'));
app.use('/api/messaging', lazyRoute('./routes/messaging.js'));
app.use('/api/aicamera', lazyRoute('./routes/aiCamera.js'));
app.use('/api/telegram-prescription', lazyRoute('./routes/telegramPrescription.js'));
app.use('/api/refills', lazyRoute('./routes/refills.js'));
app.use('/api/wa-business', lazyRoute('./routes/whatsappBusiness.js'));
app.use('/api/automation', lazyRoute('./routes/automation.js'));
// Core API routes
app.use('/api/sales', lazyRoute('./routes/sales.js'));
app.use('/api/inventory', lazyRoute('./routes/inventory.js'));
app.use('/api/dashboard', lazyRoute('./routes/dashboard.js'));
app.use('/api/purchases', lazyRoute('./routes/purchases.js'));
app.use('/api/returns', lazyRoute('./routes/returns.js'));
app.use('/api/customer-returns', lazyRoute('./routes/customerReturns.js'));
app.use('/api/orders', lazyRoute('./routes/orders.js'));
app.use('/api/expiry', lazyRoute('./routes/expiry.js'));
app.use('/api/reports', lazyRoute('./routes/reports.js'));
app.use('/api/compliance', lazyRoute('./routes/compliance.js'));
app.use('/api/license', lazyRoute('./routes/license.js'));
// Generic /api routes
app.use('/api', lazyRoute('./routes/upload.js'));
app.use('/api', lazyRoute('./routes/catalog.js'));
app.use('/api', lazyRoute('./routes/medicines.js'));
app.use('/api', lazyRoute('./routes/enrichment.js'));
app.use('/api', lazyRoute('./routes/distributors.js'));
app.use('/api', lazyRoute('./routes/notifications.js'));
app.use('/api/investigation', lazyRoute('./routes/investigation.js'));
app.use('/api', lazyRoute('./routes/medicineAvailability.js'));



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

const PORT = process.env.PORT || 3000;

// Start HTTP server immediately to accept requests in <20ms
app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}/test`);

  // Asynchronously initialize database, indexes and cache in the background
  (async () => {
    try {
      console.log('[Boot] Initializing database schema and index checks...');
      await ensureSchema(DB_PATH);
      
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
          // Step 1: WhatsApp automated client (if enabled)
          (async () => {
            const waRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'");
            if (waRow && waRow.value === 'true') {
              const { shouldRouteToBusiness } = await import('./whatsappClient.js');
              const useBusiness = await shouldRouteToBusiness();
              if (!useBusiness) {
                console.log('[Boot] WhatsApp Web (automated) is enabled, initializing in background...');
                const { startWhatsAppClient } = await import('./whatsappHandler.js');
                startWhatsAppClient();
              } else {
                console.log('[Boot] WhatsApp Business API is active. Skipping automated client initialization.');
              }
            }
          })(),

          // Step 2: Unified Engine background workers
          (async () => {
            const { startStockCalculatorWorker } = await import('./worker/stockCalculatorWorker.js');
            const { startSubstituteCacheWorker } = await import('./worker/substituteCacheWorker.js');
            startStockCalculatorWorker();
            // startSubstituteCacheWorker(); // disabled to prevent SQLite DB locks and redundant 12M rows substitutes table precomputation on boot
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
            if (isAutoEnabled) {
              const d = new Date();
              const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              const lastCheckRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_daily_check_date'");
              
              if (!lastCheckRow || lastCheckRow.value !== todayStr) {
                console.log(`[Boot] Daily check missed today (${todayStr}). Running catch-up daily check...`);
                try {
                  const { checkAllRefills } = await import('./services/refillService.js');
                  const { checkOverdueCreditNotes } = await import('./services/creditNoteService.js');
                  await checkAllRefills(db);
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

          // Step 4: Expiry scan check
          (async () => {
            if (isAutoEnabled) {
              const { checkAndRunScheduledExpiryScan } = await import('./services/expiryAlertService.js');
              await checkAndRunScheduledExpiryScan(90).catch(err => console.error('[Boot] Startup catch-up scan check failed:', err));
            }
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

        // Eagerly initialize WhatsApp client so session is restored before first send
        setTimeout(() => {
          import('./whatsappClient.js').then(m => m.initClient()).catch(err =>
            console.warn('[Boot] WhatsApp client eager-init skipped (non-fatal):', err?.message || err)
          );
        }, 8000); // 8s delay to let other boot steps finish first

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
});

async function setupCrons(db: any) {
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

  // Nightly 9:30 PM backup
  cron.schedule('30 21 * * *', async () => {
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

  // Periodic Pharmarack catalog sync every 15 minutes (WhatsApp OCR Pipeline)
  cron.schedule('*/15 * * * *', async () => {
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
    console.log('[Boot] WhatsApp OCR intent service registered.');
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