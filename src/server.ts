import './database/sqlitePatch.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { exec } from 'child_process';
import { authenticateApiKey } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { dbManager } from './database/connection.js';
import { ensureSchema } from './database.js';
import { workerSupervisor } from './worker/workerSupervisor.js';
import { registerProcessGuardian } from './process/processGuardian.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'app.db');

// Startup check disabled permanently

// Agent 2 (CRM & Utilities) Routers
import crmRouter from './routes/crm.js';
import utilitiesRouter from './routes/utilities.js';
import securityRouter from './routes/security.js';
// Agent 1 (Core) Routers
import salesRouter from './routes/sales.js';
import inventoryRouter from './routes/inventory.js';
import dashboardRouter from './routes/dashboard.js';
import purchasesRouter from './routes/purchases.js';
import returnsRouter from './routes/returns.js';
import customerReturnsRouter from './routes/customerReturns.js';
import ordersRouter from './routes/orders.js';
import expiryRouter from './routes/expiry.js';
import reportsRouter from './routes/reports.js';
import complianceRouter from './routes/compliance.js';
import emailRouter from './routes/email.js';
import migrationRouter from './routes/migration.js';
import settingsRouter from './routes/settings.js';
import pharmarackRouter from './routes/pharmarack.js';
import dispatchRouter from './routes/dispatch.js';
import archiveRouter from './routes/archive.js';
import learningRouter from './routes/learning.js';
import messagingRouter from './routes/messaging.js';
import aiCameraRouter from './routes/aiCamera.js';
import telegramPrescriptionRouter from './routes/telegramPrescription.js';
import refillsRouter from './routes/refills.js';
import waBusinessRouter from './routes/whatsappBusiness.js';
import licenseRouter from './routes/license.js';
import automationRouter from './routes/automation.js';
import uploadRouter from './routes/upload.js';
import catalogRouter from './routes/catalog.js';
import medicinesRouter from './routes/medicines.js';
import enrichmentRouter from './routes/enrichment.js';
import distributorsRouter from './routes/distributors.js';
import notificationsRouter from './routes/notifications.js';
import investigationRouter from './routes/investigation.js';
import './services/pushNotificationService.js';
import { whatsappQueue } from './services/whatsappQueue.js';
import cron from 'node-cron';
import { checkAllRefills } from './services/refillService.js';
import { checkOverdueCreditNotes, reconcileCreditNote } from './services/creditNoteService.js';
import { activityTracker } from './utils/activityTracker.js';
import { createBackup, initBackupScheduler } from './services/backupService.js';

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
  skip: (req) => req.path.startsWith('/api/migration') || req.path.startsWith('/api/notifications'),
  message: { error: 'Too many requests, please try again later' }
}));
app.use(express.json({ limit: '15mb' }));


app.use('/uploads', express.static(path.resolve(__dirname, '..', 'uploads')));
app.use('/data/search_screenshots', express.static(path.resolve(__dirname, '..', 'data', 'search_screenshots')));

// Old test console routes have been removed. This server now acts purely as an API backend.

app.use('/api/wa-business/webhook', waBusinessRouter);

// Public health check endpoint for mobile connection testing
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString() });
});

// Session token auth for all other API routes
app.use('/api', authenticateApiKey);


// Mount Agent 2 Routers
app.use('/api/crm', crmRouter);
app.use('/api/utilities', utilitiesRouter);
app.use('/api/security', securityRouter);
app.use('/api/email', emailRouter);
app.use('/api/migration', migrationRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/pharmarack', pharmarackRouter);
app.use('/api/dispatch', dispatchRouter);
app.use('/api/archive', archiveRouter);
app.use('/api/learning', learningRouter);
app.use('/api/messaging', messagingRouter);
app.use('/api/aicamera', aiCameraRouter);
app.use('/api/telegram-prescription', telegramPrescriptionRouter);
app.use('/api/refills', refillsRouter);
app.use('/api/wa-business', waBusinessRouter);
app.use('/api/automation', automationRouter);
// Core API routes
app.use('/api/sales', salesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/customer-returns', customerReturnsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/expiry', expiryRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/compliance', complianceRouter);
app.use('/api/license', licenseRouter);

app.use('/api', uploadRouter);
app.use('/api', catalogRouter);
app.use('/api', medicinesRouter);
app.use('/api', enrichmentRouter);
app.use('/api', distributorsRouter);
app.use('/api', notificationsRouter);
app.use('/api/investigation', investigationRouter);



// Initialize services that need startup logic
// These would be initialized via dependency injection in a complete refactor

// Error handling middleware - should be last
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

ensureSchema(DB_PATH).then(async () => {
  // Mark this boot as unclean (will be flipped to 'true' in gracefulShutdown)
  try {
    const bootDb = await dbManager.getConnection();
    const prevShutdown = await bootDb.get("SELECT value FROM app_settings WHERE key = 'last_clean_shutdown'");
    if (prevShutdown && prevShutdown.value === 'false') {
      console.warn('[Boot] WARNING: Last shutdown was unclean (app may have crashed or been force-killed).');
    }
    await bootDb.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_clean_shutdown', 'false')");
  } catch (bootErr) {
    console.error('[Boot] Could not write last_clean_shutdown flag:', bootErr);
  }

  app.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}/test`);

    // Pre-initialize fuzzy-matching OCR service in the background (G7)
    try {
      const { productNameFilterService } = await import('./services/productNameFilterService.js');
      console.log('[Boot] Pre-initializing productNameFilterService...');
      await productNameFilterService.initialize();
      console.log('[Boot] productNameFilterService pre-initialized successfully.');
    } catch (err) {
      console.error('Failed to pre-initialize productNameFilterService on startup:', err);
    }
    // Pre-initialize background services if automation is enabled in settings
    dbManager.getConnection()
      .then(async (db) => {
        await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
        const row = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
        const isAutoEnabled = row && row.value === 'true';

        if (isAutoEnabled) {
          console.log('Background automation is ENABLED in settings at startup. Running startup catch-up tasks...');
          
          // 1. WhatsApp Pre-initialization
          const waRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'");
          if (waRow && waRow.value === 'true') {
            const { shouldRouteToBusiness } = await import('./whatsappClient.js');
            const useBusiness = await shouldRouteToBusiness();
            if (!useBusiness) {
              console.log('WhatsApp Web (automated) is enabled, pre-initializing client in the background...');
              const { initClient } = await import('./whatsappClient.js');
              await initClient().catch(err => console.error('Background WhatsApp init failed:', err));
            } else {
              console.log('WhatsApp Business API is active. Skipping automated client pre-initialization.');
            }
          }

          // 3. Startup catch-up expiry scan (checks for downtime near-expiry alerts)
          import('./services/expiryAlertService.js')
            .then(m => m.checkAndRunScheduledExpiryScan(90))
            .catch(err => console.error('Failed running startup catch-up scan check:', err));

          // 4. Startup catch-up daily check (refills & overdue credit notes)
          const d = new Date();
          const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const lastCheckRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_daily_check_date'");
          
          if (!lastCheckRow || lastCheckRow.value !== todayStr) {
            console.log(`Daily check was missed today (${todayStr}). Running startup catch-up daily check...`);
            try {
              await checkAllRefills(db);
              await checkOverdueCreditNotes(db);
              
              // Auto expiry return on 18th, 19th, 20th of the month
              const dayOfMonth = new Date().getDate();
              if (dayOfMonth === 18 || dayOfMonth === 19 || dayOfMonth === 20) {
                console.log(`Today is the ${dayOfMonth}th. Running startup catch-up for expired medicine returns...`);
                const { autoCreateExpiryReturns } = await import('./services/returnsService.js');
                await autoCreateExpiryReturns(db);
              }

              await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_daily_check_date', ?)", [todayStr]);
              console.log('Startup catch-up daily check complete.');
            } catch (err) {
              console.error('Failed running startup catch-up daily check:', err);
            }
          } else {
            console.log(`Daily check has already been run today (${todayStr}). Skipping startup catch-up.`);
          }
        } else {
          console.log('Background automation is DISABLED in settings at startup. Skipping startup catch-up tasks.');
        }

        // 2. WhatsApp Queue Worker (started always; checks automation_enabled inside processQueue)
        whatsappQueue.startWorker();

        // Start new background services for Pharmarack, messaging queue and refills
        try {
          const { tokenRefreshScheduler } = await import('./services/tokenRefreshScheduler.js');
          tokenRefreshScheduler.start();
          
          const { messagingQueue } = await import('./services/messagingQueue.js');
          messagingQueue.start();

          const { orderFulfillmentService } = await import('./services/orderFulfillmentService.js');
          orderFulfillmentService.start();
        } catch (srvErr) {
          console.error('Failed to start background services:', srvErr);
        }

        // 8. Doctor WhatsApp Reporting Scheduler (started always; checks internally)
        import('./services/doctorReportingService.js')
          .then(m => m.startDoctorReportingScheduler())
          .catch(err => console.error('Failed to start doctor reporting scheduler:', err));

        // 5. Daily check at 9:00 AM for patient refills & overdue credit notes (registered always; checks dynamically)
        cron.schedule('0 9 * * *', async () => {
          try {
            const db = await dbManager.getConnection();
            const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
            if (!autoRow || autoRow.value !== 'true') {
              return;
            }
            console.log('Running daily patient refill, bounced products & overdue credit notes check...');
            await checkAllRefills(db);
            await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
            await checkOverdueCreditNotes(db);
            
            // Check for bounced products
            try {
              const { bouncedAlertService } = await import('./services/bouncedAlertService.js');
              await bouncedAlertService.checkAndSendBouncedProductsAlert();
            } catch (bErr) {
              console.error('Failed running bounced products alert check:', bErr);
            }
            
            // Auto expiry return on 18th, 19th, 20th of the month
            const dayOfMonth = new Date().getDate();
            if (dayOfMonth === 18 || dayOfMonth === 19 || dayOfMonth === 20) {
              console.log(`Today is the ${dayOfMonth}th. Checking and auto-creating supplier returns for expired medicines...`);
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

        // 6. Automatic near-expiry inventory scan & alerts (Every 15 days at 9:00 AM; registered always; checks dynamically)
        cron.schedule('0 9 1,16 * *', async () => {
          try {
            const db = await dbManager.getConnection();
            const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
            if (!autoRow || autoRow.value !== 'true') {
              return;
            }
            console.log('Running automatic 15-day near-expiry inventory scan...');
            const { runExpiryScanAndAlert } = await import('./services/expiryAlertService.js');
            await runExpiryScanAndAlert(90);
          } catch (err) {
            console.error('Failed running 15-day expiry scan cron:', err);
          }
        });

        // 7. Nightly 9:30 PM backup (pharmacy closing time; registered always; checks dynamically)
        cron.schedule('30 21 * * *', async () => {
          try {
            const db = await dbManager.getConnection();
            const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
            if (!autoRow || autoRow.value !== 'true') {
              return;
            }
            console.log('[Backup] Running nightly 9:30 PM backup...');
            const result = await createBackup('Nightly 9:30 PM');
            console.log(`[Backup] Nightly backup created: ${result.filename}`);
          } catch (err) {
            console.error('[Backup] Nightly backup failed:', err);
          }
        });
      })
      .catch(err => console.error('Background automation init check failed:', err));

    // Backup scheduler is always enabled (reads frequency from app_settings)
    initBackupScheduler().catch(err => console.error('Failed to init backup scheduler:', err));

    // Start the background worker supervisor
    try {
      workerSupervisor.start();
    } catch (err) {
      console.error('Failed to start worker supervisor:', err);
    }

    // Start Pharmarack background token refresh scheduler
    try {
      const { tokenRefreshScheduler } = await import('./services/tokenRefreshScheduler.js');
      tokenRefreshScheduler.start();
    } catch (err) {
      console.error('Failed to start Pharmarack token refresh scheduler:', err);
    }

    // Initialize Telegram Bot Service from DB settings
    try {
      const { telegramBotService } = await import('./telegramBot.js');
      await telegramBotService.initializeOrReloadBot();
    } catch (err) {
      console.error('Failed to initialize Telegram Bot Service on startup:', err);
    }

  // Daily licensing tasks disabled permanently
  });
}).catch(err => {
  if (err.message === 'DB_INTEGRITY_FAILURE') {
    console.error(
      '[FATAL] Database integrity check failed and could not be automatically recovered.\n' +
      'Please use the backup/restore feature in the app settings to restore a healthy backup.\n' +
      'The application will not start until the database is repaired.'
    );
  } else {
    console.error('Failed to initialize database schema:', err);
  }
  process.exit(1);
});

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
    const result = await createBackup(`Shutdown (${signal})`);
    console.log(`[Backup] Shutdown backup created: ${result.filename}`);
  } catch (err) {
    console.error('[Backup] Shutdown backup failed:', err);
  }
  try {
    workerSupervisor.stop();
  } catch (err) {
    console.error('Error stopping worker supervisor:', err);
  }
  await dbManager.close(true);
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));