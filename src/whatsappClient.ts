import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { eventService } from './services/eventService.js';
import { dbManager } from './database/connection.js';
import { config as appConfig, getAppDataDir } from './config/index.js';
import { whatsappBusinessService } from './services/whatsappBusinessService.js';
import { cleanProfileLockFiles } from './services/tokenRefreshScheduler.js';

// whatsapp-web.js uses CommonJS default export, so Client is a value not a type.
// Use InstanceType<typeof Client> to get the correct instance type.
type WAClient = InstanceType<typeof Client>;

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(getAppDataDir(), 'uploads');
// Env override lets tests (and portable installs) point at an isolated auth dir so a
// developer's REAL saved session can never be loaded or wiped by non-app processes.
const WWEBJS_AUTH_DIR = process.env.WWEBJS_AUTH_DIR
  ? path.resolve(process.env.WWEBJS_AUTH_DIR)
  : path.resolve(getAppDataDir(), '.wwebjs_auth');

/** Helper to check if an authenticated WhatsApp session folder exists on disk */
export function hasSavedSession(): boolean {
  const sessionPath = path.join(WWEBJS_AUTH_DIR, 'session');
  if (!fs.existsSync(sessionPath)) return false;
  try {
    const files = fs.readdirSync(sessionPath);
    return files.length > 0;
  } catch {
    return false;
  }
}

/** Helper to detect Puppeteer detached frame or destroyed context errors */
export function isPuppeteerDetachedError(msg?: string): boolean {
  if (!msg) return false;
  const str = String(msg);
  return (
    str.includes('detached Frame') ||
    str.includes('Navigating frame was detached') ||
    str.includes('LifecycleWatcher') ||
    str.includes('ECONNREFUSED') ||
    str.includes('Execution context was destroyed') ||
    str.includes('Session closed') ||
    str.includes('Target closed') ||
    str.includes('Protocol error') ||
    str.includes('Page crashed') ||
    str.includes('browser has disconnected') ||
    str.includes('CdpFrame') ||
    str.includes('CdpPage')
  );
}

// Catch and ignore Puppeteer/whatsapp-web.js internal detached frame and context
// destroyed rejections so they don't crash the server process in dev or production.
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || String(reason);
  if (isPuppeteerDetachedError(msg)) {
    console.warn('[WhatsApp SafeGuard] Handled internal Puppeteer/WA rejection & resetting state:', msg);
    isReady = false;
    clientInstance = null;
    if (activeClient) {
      activeClient.destroy().catch(() => {});
      activeClient = null;
    }
    return;
  }
  console.error('[Unhandled Rejection]', reason);
});

let clientInstance: WAClient | null = null;
let activeClient: WAClient | null = null; // Track currently initializing or active client
let initPromise: Promise<WAClient | null> | null = null; // Single-flight mutex
let initializing = false;
let isSyncing = false;
let qrTimeout: NodeJS.Timeout | null = null;
// Timestamp (ms) of the last getChats() failure — suppresses retries for 30 s
let lastSyncFailureAt: number = 0;
const SYNC_RETRY_COOLDOWN_MS = 30_000;

// ── Idle sleep (RAM diet, owner decision 2026-08) ─────────────────────────────
// The resident headless Chrome is the app's single biggest steady-state RAM
// consumer (~250–400 MB). All patient messaging is user-clicked (Strict
// Manual-Only contract), so after an idle window we close the browser and let
// demand-driven wake paths re-open it: sendMessage()/getChats() auto-init via
// initClient(), and whatsappQueueWorker's existing 60 s-cooldown silent restore
// wakes it for queued items. Same number, same library, identical ban profile —
// this changes ONLY when Chrome runs, never how WhatsApp is driven.
let waSleepTimer: NodeJS.Timeout | null = null;
let lastWaActivityAt: number = Date.now();
let isSleeping = false;
const WA_SLEEP_EVALUATOR_MS = 60_000;

async function getIdleSleepMinutes(): Promise<number> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_idle_sleep_min'");
    const parsed = row?.value ? parseInt(row.value, 10) : NaN;
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  } catch (_) {}
  return 15;
}

function armSleepEvaluator(delayMs: number = WA_SLEEP_EVALUATOR_MS): void {
  if (waSleepTimer) clearTimeout(waSleepTimer);
  waSleepTimer = setTimeout(() => {
    evaluateIdleSleep().catch(() => {});
  }, delayMs);
}

/** Mark user-, queue-, or sync-driven WhatsApp usage so idle-sleep backs off. */
export function markWhatsAppActivity(): void {
  lastWaActivityAt = Date.now();
  if (!waSleepTimer && clientInstance && isReady) {
    armSleepEvaluator();
  }
}

async function evaluateIdleSleep(): Promise<void> {
  waSleepTimer = null;
  // Evaluator only runs while a browser is resident; it stops itself when none
  // exists (asleep/offline) and the next markWhatsAppActivity() re-arms it.
  if (!isReady || !clientInstance) return;
  const idleMin = await getIdleSleepMinutes();
  if (idleMin <= 0) return; // feature disabled in Settings — stays off until next activity

  // Busy flows: retry shortly instead of sleeping mid-flight.
  if (initPromise || initializing || currentQr || isSyncing) {
    armSleepEvaluator();
    return;
  }

  const idleFor = Date.now() - lastWaActivityAt;
  if (idleFor < idleMin * 60_000) {
    armSleepEvaluator(Math.min(idleMin * 60_000 - idleFor + 1_000, WA_SLEEP_EVALUATOR_MS));
    return;
  }

  console.log(`[WhatsApp] Idle ≥ ${idleMin} min — sleeping WhatsApp browser to free RAM (saved session intact; auto-wakes on demand).`);
  isSleeping = true;
  try {
    eventService.broadcast('wa_status_changed', {
      status: 'sleeping',
      message: 'WhatsApp sleeping to save memory. It wakes automatically when you send a message.',
      service: 'whatsapp'
    });
  } catch (_) {}
  try {
    await destroyClient();
  } catch (_) {}
}
// ── end idle sleep ────────────────────────────────────────────────────────────

export let currentQr: string | null = null;
export let isReady: boolean = false;

export function setCurrentQr(qr: string | null) {
  currentQr = qr;
}

export function setIsReady(ready: boolean) {
  isReady = ready;
}

/** Check if WhatsApp is explicitly disabled in store settings */
export async function isWhatsAppExplicitlyDisabled(): Promise<boolean> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'");
    if (row && row.value === 'false') return true;
    const prefRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_preferred_system'");
    if (prefRow && prefRow.value === 'disabled') return true;
    return false;
  } catch {
    return false;
  }
}

export async function getWhatsAppStatus() {
  let pendingCount = 0;
  try {
    const db = await dbManager.getConnection();
    const row = await db.get("SELECT COUNT(*) as cnt FROM whatsapp_send_queue WHERE sent_at IS NULL");
    pendingCount = row?.cnt || 0;
  } catch (_) {}
  return {
    isReady,
    initializing: initializing || !!initPromise,
    isSyncing,
    pendingQueueCount: pendingCount,
    hasQr: !!currentQr,
    sleeping: isSleeping && !isReady
  };
}

/**
 * Bounded wait for the personal WhatsApp client to become ready — used by background
 * alert senders (email arrival, distributor invoice alerts) that can fire during the
 * boot session-restore window. Reuses the single-flight init when a saved session
 * exists instead of failing immediately with "session is not connected".
 * Returns true once ready; false on timeout, disabled WhatsApp, missing saved session,
 * or when routing goes through the Business API (personal readiness irrelevant there).
 */
export async function waitForWhatsAppReady(timeoutMs: number = 90_000): Promise<boolean> {
  if (await shouldRouteToBusiness()) return true;
  const deadline = Date.now() + timeoutMs;
  let lastKick = 0;
  while (Date.now() < deadline) {
    if (isReady && clientInstance) return true;
    if (await isWhatsAppExplicitlyDisabled()) return false;
    if (!hasSavedSession()) return false;
    const now = Date.now();
    // Re-kick a failed/silent init at most every 20s within our own budget —
    // never tight-loop Chrome launches.
    if (!initializing && !initPromise && now - lastKick > 20_000) {
      lastKick = now;
      initClient().catch(() => {});
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  return !!(isReady && clientInstance);
}

/**
 * Ensures WhatsApp is warmed up and ready before scheduled batch triggers execute.
 * If WhatsApp is sleeping, triggers silent session restore and awaits ready state.
 */
export async function ensureWhatsAppReady(timeoutMs: number = 30_000): Promise<boolean> {
  markWhatsAppActivity();
  return waitForWhatsAppReady(timeoutMs);
}

/** Helper to check whether we should route messages to WhatsApp Business Cloud API */
export async function shouldRouteToBusiness(): Promise<boolean> {
  const db = await dbManager.getConnection();

  // First, check preferred system
  const preferredSystemRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_preferred_system'");
  if (preferredSystemRow) {
    if (preferredSystemRow.value === 'official') return true;
    if (preferredSystemRow.value === 'automated') return false;
  }

  // Fallback to wa_business_enabled
  const row = await db.get("SELECT value FROM app_settings WHERE key = 'wa_business_enabled'");
  if (row) {
    return row.value === 'true';
  }

  // Default to automated mode (use the scanned in-app WhatsApp Web session headlessly)
  return false;
}

/**
 * Kill stale Chrome/Edge processes and remove lock files holding the wwebjs session profile.
 *
 * Uses async exec (not execSync) with a hard timeout: the underlying WMI query
 * (Get-CimInstance) is known to stall for many seconds — occasionally longer —
 * on real machines (corrupted WMI repo, AV interference, slow disks). This runs
 * on every WhatsApp init, including the automatic one on server boot whenever a
 * session was already linked, so a synchronous hang here used to freeze the
 * entire single-process app, not just WhatsApp.
 */
async function cleanupProfileLocks(): Promise<void> {
  const sessionPath = path.join(WWEBJS_AUTH_DIR, 'session');

  if (process.platform === 'win32') {
    try {
      const filterPattern = sessionPath.replace(/\\/g, '*').replace(/\//g, '*');
      const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe' or name = 'msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${filterPattern}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`;
      await execAsync(cmd, { timeout: 8000 });
      console.log('[WhatsApp Init] Stale WhatsApp browser processes terminated.');
    } catch (err: any) {
      // Includes timeout kills (ETIMEDOUT/SIGTERM) — non-fatal either way, WA init proceeds.
      console.warn('[WhatsApp Init] Could not check/kill running browser processes (non-fatal):', err.message);
    }
  }

  // Delegate to the canonical lock-file cleanup (tokenRefreshScheduler.ts) — its 7-file
  // list is a superset of the 3 this used to clean locally, so nothing is lost.
  cleanProfileLockFiles(sessionPath);
}

/** Shared ignore-check used by the message_create handler (mirrors whatsappIntentService's own copy, used for the raw client event path). */
async function isChatIgnored(db: any, chatId: string): Promise<boolean> {
  const phone = chatId.split('@')[0];
  const row = await db.get(
    `SELECT reason FROM ignored_whatsapp_numbers WHERE phone = ? OR phone = ? LIMIT 1`,
    [chatId, phone]
  );
  if (row) {
    return row.reason !== 'unignored';
  }
  const isGroupOrBroadcast = chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.includes('broadcast') || chatId === 'status@broadcast' || chatId.includes('-');
  if (isGroupOrBroadcast) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO ignored_whatsapp_numbers (phone, reason) VALUES (?, ?)`,
        [chatId, chatId.endsWith('@g.us') ? 'group' : 'broadcast']
      );
    } catch (e) {
      console.warn('[WhatsApp] Failed to auto-insert ignored chat:', e);
    }
  }
  return isGroupOrBroadcast;
}

/** Asynchronously sync chats and recent messages from WhatsApp to SQLite (fired on 'ready' and opportunistically). */
async function syncWhatsappData(client: WAClient) {
  if (isSyncing) {
    console.log('[WhatsApp] Synchronization already in progress, skipping duplicate request.');
    return;
  }

  // Cooldown: if getChats() failed recently, skip to avoid rapid error loops
  const now = Date.now();
  if (lastSyncFailureAt > 0 && (now - lastSyncFailureAt) < SYNC_RETRY_COOLDOWN_MS) {
    const retryInSec = Math.ceil((SYNC_RETRY_COOLDOWN_MS - (now - lastSyncFailureAt)) / 1000);
    console.log(`[WhatsApp] Sync skipped — last failure was recent. Retry in ${retryInSec}s.`);
    return;
  }

  isSyncing = true;
  try {
    console.log('[WhatsApp] Starting background synchronization of chats and messages...');
    let chats: any[];
    try {
      chats = await client.getChats();
    } catch (getChatsErr: any) {
      const errMsg = getChatsErr?.message || String(getChatsErr);
      
      // If client was just initialized, wait 3 seconds and retry getChats() once silently before logging failure
      if (errMsg === 'r' || errMsg.includes('Evaluation failed')) {
        await new Promise(res => setTimeout(res, 3000));
        try {
          chats = await client.getChats();
        } catch (retryErr: any) {
          lastSyncFailureAt = Date.now();
          console.log('[WhatsApp] Chat sync scheduled for next periodic cycle.');
          return;
        }
      } else {
        lastSyncFailureAt = Date.now();
        console.warn(`[WhatsApp] getChats() deferred (will retry after ${SYNC_RETRY_COOLDOWN_MS / 1000}s):`, errMsg);
        if (isPuppeteerDetachedError(errMsg)) {
          console.warn('[WhatsApp] Sync hit detached Frame/browser context. Invalidating client state...');
          isReady = false;
          clientInstance = null;
          if (activeClient) {
            activeClient.destroy().catch(() => {});
            activeClient = null;
          }
        }
        return;
      }
    }
    const db = await dbManager.getConnection();

    const ignoreRows = await db.all('SELECT phone, reason FROM ignored_whatsapp_numbers');
    const ignoreMap = new Map<string, string>();
    for (const r of ignoreRows) {
      ignoreMap.set(r.phone, r.reason);
    }

    const isIgnoredCached = async (chatId: string) => {
      const phone = chatId.split('@')[0];
      const explicit = ignoreMap.get(chatId) || ignoreMap.get(phone);
      if (explicit !== undefined) {
        return explicit !== 'unignored';
      }
      const isGroupOrBroadcast = chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.includes('broadcast') || chatId === 'status@broadcast' || chatId.includes('-');
      if (isGroupOrBroadcast) {
        try {
          await db.run(
            `INSERT OR IGNORE INTO ignored_whatsapp_numbers (phone, reason) VALUES (?, ?)`,
            [chatId, chatId.endsWith('@g.us') ? 'group' : 'broadcast']
          );
          ignoreMap.set(chatId, chatId.endsWith('@g.us') ? 'group' : 'broadcast');
        } catch (e) {
          console.warn('[WhatsApp] Failed to auto-insert ignored chat in sync:', e);
        }
      }
      return isGroupOrBroadcast;
    };

    for (const chat of chats) {
      const chatId = chat.id._serialized;
      if (await isIgnoredCached(chatId)) {
        continue;
      }
      const lastMsg = chat.lastMessage ? chat.lastMessage.body : null;

      let resolvedNumber = chatId.split('@')[0];
      if (chatId.endsWith('@lid')) {
        try {
          const mapping = await client.getContactLidAndPhone([chatId]);
          if (mapping && mapping[0] && mapping[0].pn) {
            resolvedNumber = mapping[0].pn;
          } else {
            const contact = await client.getContactById(chatId);
            if (contact && contact.number && contact.number !== resolvedNumber) {
              resolvedNumber = contact.number;
            }
          }
        } catch (e) {
          console.error(`[WhatsApp] Failed to resolve LID ${chatId}:`, e);
        }
      }

      await db.run(
        `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           unread_count=excluded.unread_count,
           timestamp=excluded.timestamp,
           last_message=excluded.last_message,
           is_group=excluded.is_group,
           resolved_number=excluded.resolved_number`,
        [
          chatId,
          chat.name || chat.id.user,
          chat.unreadCount || 0,
          chat.timestamp || Math.floor(Date.now() / 1000),
          lastMsg,
          chat.isGroup ? 1 : 0,
          resolvedNumber
        ]
      );
    }
    console.log('[WhatsApp] Background synchronization completed successfully.');
    eventService.broadcast('wa_chats_updated', { success: true });
  } catch (err) {
    console.error('[WhatsApp] Error during synchronization:', err);
  } finally {
    isSyncing = false;
  }
}

/** Internal helper to instantiate WAClient and bind event listeners */
function launchClientInstance(forceQr: boolean): Promise<WAClient> {
  return new Promise<WAClient>((resolve, reject) => {
    let execPath = '';
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        execPath = p;
        break;
      }
    }

    const puppeteerArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-component-update',
      '--disable-background-networking',
      '--renderer-process-limit=1',
      '--js-flags=--max-old-space-size=256'
    ];

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: WWEBJS_AUTH_DIR }),
      puppeteer: execPath
        ? { executablePath: execPath, headless: true, args: puppeteerArgs }
        : { headless: true, args: puppeteerArgs }
    });
    activeClient = client;

    let qrCount = 0;
    let qrAutoStopTimer: NodeJS.Timeout | null = null;

    // Hard watchdog: on some PCs Puppeteer/Chrome launch can hang indefinitely
    // (browser missing at all 4 hardcoded paths so puppeteer-core has nothing to
    // launch, a corrupted profile, driver/AV interference) without ever emitting
    // 'qr', 'ready', or rejecting initialize(). Without this, `initializing` gets
    // stuck `true` forever and WhatsApp features stay dead until the whole app
    // is restarted. Cleared as soon as any real progress (qr/ready/init failure)
    // is observed — legitimate long QR waits are governed by their own 120s timer.
    const initWatchdog = setTimeout(() => {
      if (clientInstance) return;
      console.error('[WhatsApp] Init watchdog fired — no response from browser within 60s. Resetting.');
      initializing = false;
      isReady = false;
      activeClient = null;
      client.destroy().catch(() => {});
      reject(new Error('WhatsApp client initialization timed out (60s) — Chrome/Edge may be missing or unresponsive.'));
    }, 60_000);
    const clearInitWatchdog = () => clearTimeout(initWatchdog);

    client.on('qr', (qr: string) => {
      clearInitWatchdog();
      // If user did not explicitly request QR scan and no valid saved session exists, stop immediately
      if (!forceQr && !hasSavedSession()) {
        console.log('[WhatsApp] Unsolicited QR event suppressed. Stopping client until explicit user connection.');
        if (qrAutoStopTimer) clearTimeout(qrAutoStopTimer);
        currentQr = null;
        initializing = false;
        isReady = false;
        activeClient = null;
        client.destroy().catch(() => {});
        // Settle the init promise — otherwise every caller (sendMessage, boot auto-init,
        // Settings connect) awaits a promise that never resolves and WA stays dead until restart.
        reject(new Error('WhatsApp connection requires a manual QR scan (no saved session). Connect from Settings or the Learning page.'));
        return;
      }

      qrCount++;
      console.log(`[WhatsApp] QR code received (attempt ${qrCount}/5, standing by for scan)...`);
      currentQr = qr;
      isReady = false;

      if (!qrAutoStopTimer) {
        qrAutoStopTimer = setTimeout(() => {
          console.log('[WhatsApp] QR scan timed out (2 minutes elapsed). Stopping browser process until manual connect.');
          currentQr = null;
          initializing = false;
          isReady = false;
          if (activeClient) {
            activeClient.destroy().catch(() => {});
            activeClient = null;
          }
          clientInstance = null;
          // Settle the init promise so awaiting callers fail fast instead of hanging forever.
          reject(new Error('WhatsApp QR scan timed out (2 minutes). Click Reconnect / Open Live Chrome Window to try again.'));
        }, 120_000);
      }

      if (qrCount >= 5) {
        console.log('[WhatsApp] Reached max QR refresh attempts (5). Auto-stopping browser until manual connect.');
        if (qrAutoStopTimer) clearTimeout(qrAutoStopTimer);
        currentQr = null;
        initializing = false;
        isReady = false;
        activeClient = null;
        client.destroy().catch(() => {});
        // Settle the init promise so awaiting callers fail fast instead of hanging forever.
        reject(new Error('WhatsApp QR expired 5 times without being scanned. Reconnect from Settings to try again.'));
      }
    });

    client.on('ready', async () => {
      console.log('WhatsApp Client is ready!');
      clearInitWatchdog();
      if (qrTimeout) clearTimeout(qrTimeout);
      if (qrAutoStopTimer) clearTimeout(qrAutoStopTimer);
      clientInstance = client;
      activeClient = client;
      initializing = false;
      isReady = true;
      currentQr = null;
      isSleeping = false;
      resolve(client);
      markWhatsAppActivity();

      // P1 push event: WA UI updates without polling
      try {
        eventService.broadcast('wa_status_changed', { status: 'ready', service: 'whatsapp' });
      } catch (_) {}

      // Extract and save connected phone number to app_settings persistently
      try {
        const infoNumber = (client as any)?.info?.wid?.user || (client as any)?.info?.wid?._serialized?.split('@')[0];
        if (infoNumber) {
          const cleanPhone = String(infoNumber).replace(/\D/g, '');
          console.log(`[WhatsApp Persist] Connected phone number detected: ${cleanPhone}`);
          const db = await dbManager.getConnection();

          await db.run(
            `INSERT INTO app_settings (key, value) VALUES ('whatsapp_connected_number', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [cleanPhone]
          );

          const existingOwner = await db.get("SELECT value FROM app_settings WHERE key = 'owner_whatsapp_number'");
          if (!existingOwner || !existingOwner.value || !existingOwner.value.trim()) {
            await db.run(
              `INSERT INTO app_settings (key, value) VALUES ('owner_whatsapp_number', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
              [cleanPhone]
            );
          }

          const existingShopPhone = await db.get("SELECT value FROM app_settings WHERE key = 'shop_phone'");
          if (!existingShopPhone || !existingShopPhone.value || !existingShopPhone.value.trim()) {
            await db.run(
              `INSERT INTO app_settings (key, value) VALUES ('shop_phone', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
              [cleanPhone]
            );
          }
        }
      } catch (saveErr) {
        console.warn('[WhatsApp Persist] Failed to save connected phone number to app_settings:', saveErr);
      }

      // Trigger background queue worker with proper pacing and status tracking
      import('./services/whatsappQueueWorker.js').then(({ whatsappQueueWorker }) => {
        whatsappQueueWorker.triggerProcessing();
      }).catch(err => {
        console.warn('[WhatsApp] Could not trigger queue worker on ready:', err);
      });

      // Sync chats separately — failure here must not block send queue drain
      setTimeout(() => {
        syncWhatsappData(client).catch(err => {
          console.error('[WhatsApp] Background sync failed:', err);
        });
      }, 2500);
    });

    client.on('disconnected', (reason: string) => {
      console.log('WhatsApp client disconnected:', reason);
      isReady = false;
      clientInstance = null;
      activeClient = null;
      initializing = false;
      isSleeping = false; // a real disconnect must not be reported as deliberate sleep
      if (qrTimeout) clearTimeout(qrTimeout);

      // P4: session folder on disk stays intact — reconnect reuses saved credentials.
      try {
        eventService.broadcast('wa_status_changed', { status: 'disconnected', reason, service: 'whatsapp' });
      } catch (_) {}
      eventService.broadcast('auth_failure', {
        message: 'WhatsApp Web disconnected. Use Reconnect in Settings (your session is saved).',
        service: 'whatsapp'
      });

      client.destroy().catch(() => {}).finally(() => {
        console.log('WhatsApp client destroyed. Waiting for manual or API-triggered reconnect.');
      });
    });

    client.on('auth_failure', (msg: string) => {
      initializing = false;
      isReady = false;
      activeClient = null;
      isSleeping = false;

      eventService.broadcast('auth_failure', {
        message: `WhatsApp authentication failed: ${msg}. Please reconnect in Settings.`,
        service: 'whatsapp'
      });

      reject(new Error(msg));
    });

    // Real remote-logout detection (P4): WhatsApp invalidated the session server-side.
    // Session folder on disk is preserved — only an explicit user Logout wipes credentials.
    client.on('logout', async (_msg?: string) => {
      console.log('[WhatsApp] Remote logout detected by WhatsApp servers.');
      initializing = false;
      isReady = false;
      activeClient = null;
      clientInstance = null;
      isSleeping = false;
      if (qrTimeout) clearTimeout(qrTimeout);

      eventService.broadcast('wa_status_changed', {
        status: 'logged_out',
        message: 'WhatsApp signed out remotely. Scan the QR code in Settings to sign in again.',
        service: 'whatsapp'
      });

      client.destroy().catch(() => {});
    });

    client.on('message_create', async (msg: any) => {
      try {
        const chatId = msg.to && msg.fromMe ? msg.to : msg.from;
        const db = await dbManager.getConnection();

        if (await isChatIgnored(db, chatId)) {
          return;
        }

        const msgId = msg.id?._serialized || msg.id?.id || `msg_${msg.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        await db.run(
          `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          [
            msgId,
            chatId,
            msg.body || '',
            msg.fromMe ? 1 : 0,
            msg.timestamp || Math.floor(Date.now() / 1000),
            msg.type || 'text',
            msg.hasMedia ? 1 : 0
          ]
        );

        let resolvedNumber = chatId.split('@')[0];
        let chatName = chatId.split('@')[0];
        try {
          const chat = await msg.getChat();
          if (chat) chatName = chat.name || chatName;
        } catch (e) {}

        if (chatId.endsWith('@lid')) {
          try {
            const mapping = await client.getContactLidAndPhone([chatId]);
            if (mapping && mapping[0] && mapping[0].pn) {
              resolvedNumber = mapping[0].pn;
            } else {
              const contact = await msg.getContact();
              if (contact && contact.number && contact.number !== resolvedNumber) {
                resolvedNumber = contact.number;
              }
            }
          } catch (e) {}
        }

        await db.run(
          `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             timestamp=excluded.timestamp,
             last_message=excluded.last_message,
             resolved_number=excluded.resolved_number,
             unread_count = CASE WHEN ? = 0 THEN unread_count + 1 ELSE unread_count END`,
          [
            chatId,
            chatName,
            msg.fromMe ? 0 : 1,
            msg.timestamp,
            msg.body || '',
            chatId.includes('g.us') ? 1 : 0,
            resolvedNumber,
            msg.fromMe ? 1 : 0
          ]
        );

        eventService.broadcast('wa_new_message', {
          chat_id: chatId,
          resolved_number: resolvedNumber,
          message: {
            id: msg.id._serialized,
            body: msg.body,
            fromMe: msg.fromMe,
            timestamp: msg.timestamp,
            type: msg.type,
            hasMedia: msg.hasMedia
          }
        });

        // Route inbound customer messages through the existing WhatsApp intent service
        if (!msg.fromMe) {
          import('./services/whatsappIntentService.js')
            .then(mod => {
              const handler = mod.handleInbound || mod.whatsappIntentService?.handleInbound || mod.default?.handleInbound;
              if (handler) {
                handler(msg).catch(err => console.error('[WhatsApp] Intent service execution error:', err));
              } else {
                console.error('[WhatsApp] Could not resolve handleInbound from whatsappIntentService module.');
              }
            })
            .catch(err => console.error('[WhatsApp] Intent service import error:', err));
        }
      } catch (err) {
        console.error('[WhatsApp] Error in message_create event handler:', err);
      }
    });

    client.on('message_ack', async (msg: any, ack: any) => {
      try {
        eventService.broadcast('wa_message_ack', {
          msg_id: msg.id._serialized,
          ack
        });
      } catch (err) {
        console.error('[WhatsApp] Error in message_ack event handler:', err);
      }
    });

    client.initialize().catch(err => {
      clearInitWatchdog();
      const errMsg = err?.message || String(err);
      if (isPuppeteerDetachedError(errMsg)) {
        console.warn('[WhatsApp] Initialize interrupted by teardown/reconnect:', errMsg);
      } else if (
        errMsg.includes('4294967295') ||
        errMsg.includes('exit code: -1') ||
        errMsg.includes('exit code -1') ||
        errMsg.includes('Failed to launch the browser process')
      ) {
        console.warn('[WhatsApp SafeGuard] Browser process closed with transient exit code -1 during launch (retrying silently).');
      } else {
        console.error('[WhatsApp] Failed during initialize():', err);
      }
      initializing = false;
      isReady = false;
      clientInstance = null;
      activeClient = null;
      reject(err);
    });
  });
}

/** Initialize the WhatsApp client and return it */
export async function initClient(options: { forceQr?: boolean } = {}): Promise<WAClient | null> {
  const forceQr = options.forceQr ?? false;

  if (clientInstance && isReady) return clientInstance;

  // Single-flight in-flight Promise: if initialization is already running, join it
  if (initPromise) {
    return initPromise;
  }

  // Check if WhatsApp is disabled in settings
  if (!forceQr && (await isWhatsAppExplicitlyDisabled())) {
    console.log('[WhatsApp] Auto-init skipped: WhatsApp is disabled in Settings.');
    return null;
  }

  // Unless user explicitly requested connection (forceQr=true) OR an existing saved session exists on disk,
  // do NOT launch Puppeteer / Chrome to generate unsolicited QR codes.
  if (!forceQr && !hasSavedSession()) {
    console.log('[WhatsApp] Auto-init skipped: No saved session on disk. Standing down until explicit user connection.');
    return null;
  }

  initializing = true;

  initPromise = (async () => {
    try {
      // 1. Terminate stale processes and remove lingering profile locks
      await cleanupProfileLocks();

      // 2. Windows Kernel Drain Grace Period: allow OS 600ms to cleanly release file handles & mutexes
      if (process.platform === 'win32') {
        await new Promise(resolve => setTimeout(resolve, 600));
      }

      // 3. Launch internal client with single silent retry on transient Windows process lock contention
      try {
        const client = await launchClientInstance(forceQr);
        return client;
      } catch (launchErr: any) {
        const errMsg = launchErr?.message || String(launchErr);
        if (
          errMsg.includes('4294967295') ||
          errMsg.includes('exit code: -1') ||
          errMsg.includes('exit code -1') ||
          errMsg.includes('Failed to launch the browser process')
        ) {
          console.warn('[WhatsApp SafeGuard] Transient lock on initial browser launch (Exit Code -1). Draining locks and retrying once silently...');
          await cleanupProfileLocks();
          if (process.platform === 'win32') {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          const client = await launchClientInstance(forceQr);
          return client;
        }
        throw launchErr;
      }
    } catch (err: any) {
      initializing = false;
      isReady = false;
      clientInstance = null;
      activeClient = null;
      throw err;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/** Destroy the WhatsApp client to release file locks on the session folder */
export async function destroyClient(): Promise<void> {
  console.log('[WhatsApp] Destroying client to release session locks...');
  isReady = false;
  currentQr = null;
  initializing = false;
  if (qrTimeout) {
    clearTimeout(qrTimeout);
    qrTimeout = null;
  }
  if (activeClient) {
    try {
      await Promise.race([
        activeClient.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('client.destroy() timed out')), 15000))
      ]);
    } catch (err) {
      console.error('[WhatsApp] Error destroying client:', err);
    }
    activeClient = null;
  }
  clientInstance = null;
}

/** Force reconnect, clear saved session, and reinitialize for a fresh QR code */
export async function forceReconnect(): Promise<void> {
  console.log('[WhatsApp] Force reconnect requested. Destroying client and clearing session...');

  isReady = false;
  currentQr = null;
  initializing = false;
  isSleeping = false;
  if (qrTimeout) clearTimeout(qrTimeout);

  if (activeClient) {
    try {
      await Promise.race([
        activeClient.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('client.destroy() timed out')), 15000))
      ]);
    } catch (err) {
      console.error('[WhatsApp] Error destroying client (non-fatal):', err);
    }
    activeClient = null;
  }
  clientInstance = null;

  const authPath = WWEBJS_AUTH_DIR;
  try {
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log('[WhatsApp] Old session data cleared from', authPath);
    }
  } catch (err) {
    console.error('[WhatsApp] Failed to clear session folder (non-fatal):', err);
  }

  try {
    const db = await dbManager.getConnection();
    await db.run("DELETE FROM ignored_whatsapp_numbers WHERE reason IN ('group', 'broadcast')");
    console.log('[WhatsApp] Cleared auto-ignored group and broadcast chats from database.');
  } catch (err) {
    console.error('[WhatsApp] Failed to clear auto-ignored chats from database (non-fatal):', err);
  }

  await new Promise(r => setTimeout(r, 2000));
  initClient().catch(err => {
    console.error('[WhatsApp] Re-initialization after reconnect failed (non-fatal):', err.message);
  });
}

/**
 * ponytail: P4 credentials-are-sacred reconnect.
 * Destroys the running client and restarts it with the SAVED session.
 * NEVER deletes .wwebjs_auth — QR only appears if WhatsApp itself
 * invalidated the session remotely. Used by POST /api/messaging/reconnect.
 */
export async function reconnectClient(): Promise<void> {
  console.log('[WhatsApp] Reconnect requested (non-destructive). Restarting with saved session...');
  await destroyClient();
  await cleanupProfileLocks();
  if (process.platform === 'win32') {
    await new Promise(r => setTimeout(r, 600));
  }
  try {
    await initClient();
  } catch (err: any) {
    console.error('[WhatsApp] Non-destructive re-initialization failed (session preserved):', err?.message);
    eventService.broadcast('wa_status_changed', {
      status: 'disconnected',
      message: 'Reconnect failed but your saved WhatsApp session is intact. Retry or scan QR only if asked.',
      service: 'whatsapp'
    });
  }
}

const recentSendsCache = new Map<string, number>();

export interface SendMessageResult {
  sent: boolean;
  suppressed?: boolean;
}

/**
 * Normalizes any phone string to a standard WhatsApp number format (digits only, with country code).
 * Supports: 10-digit Indian (9876543210 -> 919876543210), 11-digit with leading 0 (09876543210 -> 919876543210), 12-digit with 91 (919876543210).
 */
export function normalizeWhatsAppPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `91${digits}`;
  }
  return digits;
}

/** ponytail: shared hash for duplicate-suppress key and outbox verification */
export function hashMessageBody(body: string): number {
  const fullMsg = (body || '').trim();
  let msgHash = 0;
  for (let ci = 0; ci < fullMsg.length; ci++) {
    msgHash = ((msgHash << 5) - msgHash + fullMsg.charCodeAt(ci)) | 0;
  }
  return msgHash;
}

/** Send a media or text message using the WhatsApp Business API or the live WhatsApp Web client, and log it to SQLite */
export async function sendMessage(
  to: string,
  mediaPath?: string,
  caption?: string,
  file?: { mimetype: string; data: string; filename?: string }
): Promise<SendMessageResult> {
  if (!to) {
    console.warn('Attempted to send WhatsApp message to an empty or null number. Skipping.');
    return { sent: false };
  }

  const db = await dbManager.getConnection();
  const recipients = String(to)
    .split(/[,;\s]+/)
    .map(r => r.trim())
    .filter(r => r.length > 0);

  let aggregateResult: SendMessageResult = { sent: false };

  for (const recipient of recipients) {
    let cleanPhone = recipient;
    if (cleanPhone.includes('@')) {
      cleanPhone = cleanPhone.split('@')[0];
    }
    cleanPhone = normalizeWhatsAppPhone(cleanPhone);

    if (!cleanPhone || cleanPhone.length < 10) {
      console.warn(`[WhatsApp] Invalid phone number passed to sendMessage: "${recipient}". Skipping.`);
      throw new Error(`Invalid phone number: "${recipient}" (must contain at least 10 valid digits).`);
    }

    const chatId = `${cleanPhone}@c.us`;

    // Any send (user-clicked or queue-drained) counts as activity for idle-sleep.
    markWhatsAppActivity();

    // Anti-duplicate protection: prevent identical sends to same recipient within 30s
    // Use a simple hash of the full message to avoid false collisions between different orders
    const fullMsg = (caption || '').trim();
    const msgHash = hashMessageBody(fullMsg);
    const sendKey = `${cleanPhone}:${msgHash}:${fullMsg.length}`;
    const nowTs = Date.now();
    if (recentSendsCache.has(sendKey) && nowTs - recentSendsCache.get(sendKey)! < 30000) {
      console.log(`[WhatsApp Safeguard] Suppressed duplicate send to ${cleanPhone} within 30s.`);
      aggregateResult = { sent: true, suppressed: true };
      continue;
    }

    // Register in-flight BEFORE dispatching: the previous post-send-only registration let
    // two near-simultaneous calls for the same recipient+body both pass the check above
    // while the first was still awaiting delivery, double-delivering the message.
    // The catch below deletes the key on failure so legitimate retries stay unblocked.
    recentSendsCache.set(sendKey, nowTs);

    let success = false;
    let messageId = `msg_out_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    if (await isWhatsAppExplicitlyDisabled()) {
      throw new Error('WhatsApp messaging is disabled in Settings.');
    }

    const useBusiness = await shouldRouteToBusiness();
    if (!useBusiness && (!isReady || !clientInstance)) {
      if (!hasSavedSession()) {
        throw new Error('WhatsApp is not connected. Please connect WhatsApp in Learning or Settings before sending messages.');
      }
      try {
        console.log('[WhatsApp Client] Client not ready on sendMessage call. Initializing saved session...');
        await initClient();
      } catch (initErr) {
        console.error('[WhatsApp Client] Auto-initialization failed during send:', initErr);
        throw new Error('WhatsApp session is not connected. Please scan the QR code in Settings or click "Open Live Chrome Window" to log in.');
      }
    }

    try {
      if (!useBusiness) {
        // Live WhatsApp Web client. Send via the WA Web.js client.
        const doSend = async (targetClient: WAClient) => {
          let targetChatId = chatId;

          // Attempt to resolve contact & LID via getNumberId to populate Store and prevent "No LID for user" errors
          if (!chatId.includes('@g.us') && !chatId.includes('@broadcast') && !chatId.includes('-')) {
            try {
              const numberDetails = await targetClient.getNumberId(cleanPhone);
              if (numberDetails && numberDetails._serialized) {
                targetChatId = numberDetails._serialized;
              }
            } catch (numErr: any) {
              console.warn(`[WhatsApp] getNumberId resolution note for ${cleanPhone}, fallback to direct JID ${chatId}:`, numErr?.message || numErr);
            }
          }

          let sentMsg: any = null;
          if (file && file.mimetype && file.data) {
            const media = new MessageMedia(file.mimetype, file.data, file.filename || 'file');
            sentMsg = await targetClient.sendMessage(targetChatId, media, { caption: caption ?? '' });
          } else if (mediaPath) {
            const media = MessageMedia.fromFilePath(mediaPath);
            sentMsg = await targetClient.sendMessage(targetChatId, media, { caption: caption ?? '' });
          } else {
            sentMsg = await targetClient.sendMessage(targetChatId, caption ?? '');
          }

          if (sentMsg?.id?._serialized) {
            messageId = sentMsg.id._serialized;
          }
          return sentMsg;
        };

        try {
          await doSend(clientInstance!);
        } catch (sendErr: any) {
          const errMsg = sendErr?.message || String(sendErr);
          if (isPuppeteerDetachedError(errMsg)) {
            console.warn('[WhatsApp] Detached Frame or destroyed browser context detected during sendMessage. Invalidating stale client...');
            isReady = false;
            clientInstance = null;
            if (activeClient) {
              activeClient.destroy().catch(() => {});
              activeClient = null;
            }

            console.log('[WhatsApp] Attempting automatic client re-initialization and retry...');
            try {
              const freshClient = await initClient();
              if (!freshClient) throw new Error('Re-initialization returned null client.');
              await doSend(freshClient);
              console.log('[WhatsApp] Automatic re-initialization and message send retry succeeded!');
            } catch (retryErr: any) {
              console.error('[WhatsApp] Send retry after client auto-reconnect failed:', retryErr);
              throw new Error('WhatsApp connection lost (detached browser frame). Please scan the QR code in Settings to reconnect.');
            }
          } else {
            throw sendErr;
          }
        }

        // Send confirmed — register in recent sends cache
        recentSendsCache.set(sendKey, Date.now());

        // Provisional DB record — ensures chat + message appear immediately in UI.
        try {
          const provisionalBody = file ? `[Document] ${file.filename || ''} ${caption || ''}`.trim()
            : (mediaPath ? `[Document] ${path.basename(mediaPath)} ${caption || ''}`.trim() : (caption || ''));
          const provTimestamp = Math.floor(Date.now() / 1000);
          const provHasMedia = file || mediaPath ? 1 : 0;

          await db.run(
            `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
            [messageId, chatId, provisionalBody, 1, provTimestamp, file || mediaPath ? 'document' : 'text', provHasMedia]
          );

          const existingChatRow = await db.get('SELECT name FROM whatsapp_chats WHERE id = ?', [chatId]);
          const chatNameProv = existingChatRow?.name || cleanPhone;
          await db.run(
            `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               timestamp = EXCLUDED.timestamp,
               last_message = EXCLUDED.last_message,
               resolved_number = EXCLUDED.resolved_number`,
            [chatId, chatNameProv, 0, provTimestamp, provisionalBody, 0, cleanPhone]
          );

          eventService.broadcast('wa_new_message', {
            chat_id: chatId,
            resolved_number: cleanPhone,
            message: {
              id: messageId,
              body: provisionalBody,
              fromMe: true,
              timestamp: provTimestamp,
              type: file || mediaPath ? 'document' : 'text',
              hasMedia: !!provHasMedia
            }
          });
        } catch (provErr: any) {
          console.warn('[WhatsApp] Provisional DB write failed (non-fatal):', provErr?.message);
        }

        aggregateResult = { sent: true, suppressed: false };
        continue;
      } else {
        if (file && file.mimetype && file.data) {
          if (!fs.existsSync(appConfig.tempDir)) {
            fs.mkdirSync(appConfig.tempDir, { recursive: true });
          }
          const tempFilePath = path.join(appConfig.tempDir, `wa_temp_${Date.now()}_${file.filename || 'document.pdf'}`);
          fs.writeFileSync(tempFilePath, Buffer.from(file.data, 'base64'));
          try {
            const result = await whatsappBusinessService.sendDocument(cleanPhone, tempFilePath, caption, file.filename);
            success = result.success;
            if (result.messageId) messageId = result.messageId;
          } finally {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
          }
        } else if (mediaPath) {
          const result = await whatsappBusinessService.sendDocument(cleanPhone, mediaPath, caption);
          success = result.success;
          if (result.messageId) messageId = result.messageId;
        } else {
          const result = await whatsappBusinessService.sendTextMessage(cleanPhone, caption ?? '');
          success = result.success;
          if (result.messageId) messageId = result.messageId;
        }

        if (!success) {
          throw new Error('WhatsApp Business API rejected message transmission');
        }

        // Send confirmed — register in recent sends cache
        recentSendsCache.set(sendKey, Date.now());
      }
    } catch (err: any) {
      // Clear cache on error so retries are never blocked
      recentSendsCache.delete(sendKey);
      console.error('[WhatsApp Client Wrapper] Send failed:', err?.message || err);
      throw err;
    }

    // Business API sends have no local client event to log them, so write here.
    // (The automated/whatsapp-web.js branch never reaches this point — it `continue`s above.)
    const bodyText = file ? `[Document] ${file.filename || ''} ${caption || ''}` : (mediaPath ? `[Document] ${path.basename(mediaPath)} ${caption || ''}` : (caption || ''));
    const timestamp = Math.floor(Date.now() / 1000);
    const hasMedia = file || mediaPath ? 1 : 0;

    try {
      await db.run(
        `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [messageId, chatId, bodyText, 1, timestamp, file || mediaPath ? 'document' : 'text', hasMedia]
      );

      const existingChat = await db.get('SELECT name FROM whatsapp_chats WHERE id = ?', [chatId]);
      const chatName = existingChat?.name || cleanPhone;

      await db.run(
        `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           timestamp = EXCLUDED.timestamp,
           last_message = EXCLUDED.last_message,
           resolved_number = EXCLUDED.resolved_number`,
        [chatId, chatName, 0, timestamp, bodyText, 0, cleanPhone]
      );

      eventService.broadcast('wa_new_message', {
        chat_id: chatId,
        message: {
          id: messageId,
          body: bodyText,
          fromMe: true,
          timestamp,
          type: file || mediaPath ? 'document' : 'text',
          hasMedia: !!hasMedia
        }
      });
    } catch (dbErr) {
      console.error('[WhatsApp Client Wrapper] SQLite write error:', dbErr);
    }

    aggregateResult = { sent: true, suppressed: false };
  }

  return aggregateResult.sent ? aggregateResult : { sent: false };
}

/** Get all chats from the local SQLite cache with contact name enrichment and LID deduplication */
export async function getChats(): Promise<any[]> {
  try {
    markWhatsAppActivity(); // user is viewing the inbox — keep the browser awake
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT id, name, unread_count as unreadCount, timestamp, is_group as isGroup, last_message as lastMessage, resolved_number as resolvedNumber
       FROM whatsapp_chats
       ORDER BY timestamp DESC`
    );

    // Deduplicate chats that share the same last 10 digits (e.g. @lid vs @c.us)
    const dedupedMap = new Map<string, any>();
    for (const r of rows) {
      const rawNum = r.resolvedNumber || (r.id ? r.id.split('@')[0] : '');
      const digits = rawNum.replace(/\D/g, '');
      const key = digits.length >= 10 ? digits.slice(-10) : (r.id || rawNum);

      if (dedupedMap.has(key)) {
        const existing = dedupedMap.get(key);
        existing.unreadCount = (existing.unreadCount || 0) + (r.unreadCount || 0);
        if (r.timestamp && r.timestamp > (existing.timestamp || 0)) {
          existing.timestamp = r.timestamp;
          if (r.lastMessage) existing.lastMessage = r.lastMessage;
        }
      } else {
        dedupedMap.set(key, { ...r });
      }
    }
    const resultRows = Array.from(dedupedMap.values());

    // Enrich names from pharmacy DB tables (customers, refills, delivery_boys, doctors)
    for (const r of resultRows) {
      const rawNum = r.resolvedNumber || (r.id ? r.id.split('@')[0] : '');
      const digits = rawNum.replace(/\D/g, '');
      const last10 = digits.length >= 10 ? digits.slice(-10) : '';

      if (last10) {
        const likePattern = `%${last10}%`;

        // 1. Check customers
        const cust = await db.get('SELECT name FROM customers WHERE phone LIKE ? AND name IS NOT NULL AND name != "" LIMIT 1', [likePattern]);
        if (cust?.name) {
          r.name = cust.name;
          continue;
        }

        // 2. Check patient refills
        const refill = await db.get('SELECT patient_name FROM patient_refills WHERE patient_phone LIKE ? AND patient_name IS NOT NULL AND patient_name != "" LIMIT 1', [likePattern]);
        if (refill?.patient_name) {
          r.name = refill.patient_name;
          continue;
        }

        // 3. Check delivery boys
        const deliv = await db.get('SELECT name FROM delivery_boys WHERE whatsapp_number LIKE ? AND name IS NOT NULL AND name != "" LIMIT 1', [likePattern]);
        if (deliv?.name) {
          r.name = deliv.name;
          continue;
        }

        // 4. Check doctors
        const doc = await db.get('SELECT name FROM doctors WHERE phone LIKE ? AND name IS NOT NULL AND name != "" LIMIT 1', [likePattern]);
        if (doc?.name) {
          r.name = doc.name;
          continue;
        }

        // 5. Check sales invoices via joined customer record
        const sale = await db.get(
          `SELECT c.name as customer_name
           FROM sales_invoices si
           JOIN customers c ON si.customer_id = c.id
           WHERE c.phone LIKE ? AND c.name IS NOT NULL AND c.name != ""
           LIMIT 1`,
          [likePattern]
        );
        if (sale?.customer_name) {
          r.name = sale.customer_name;
          continue;
        }

        // 6. Check distributors table (learned from OCR / AI Learning page)
        const dist = await db.get(
          'SELECT name FROM distributors WHERE (phone LIKE ? OR phone = ?) AND name IS NOT NULL AND name != "" LIMIT 1',
          [likePattern, last10]
        );
        if (dist?.name) {
          r.name = dist.name;
        }
      }
    }

    return resultRows;
  } catch (err) {
    console.error('[WhatsApp Client Wrapper] getChats SQLite error:', err);
    return [];
  }
}

/** Get messages for a specific chat from local SQLite cache, matching across @lid and @c.us */
export async function getChatMessages(chatId: string, limit: number = 500): Promise<any[]> {
  const raw = String(chatId || '').trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, '');
  const phoneWithoutCc = digits.length >= 10 ? digits.slice(-10) : digits;
  const likePattern = `%${phoneWithoutCc}%`;

  try {
    const db = await dbManager.getConnection();

    // Look up all chat IDs associated with this contact in whatsapp_chats
    const relatedChatIds = new Set<string>([raw]);
    if (phoneWithoutCc && phoneWithoutCc.length >= 7) {
      const chatRows = await db.all(
        `SELECT id, resolved_number FROM whatsapp_chats
         WHERE id = ? OR id LIKE ? OR resolved_number LIKE ? OR resolved_number = ?`,
        [raw, likePattern, likePattern, phoneWithoutCc]
      );
      for (const c of chatRows) {
        if (c.id) relatedChatIds.add(c.id);
        if (c.resolved_number) {
          relatedChatIds.add(c.resolved_number);
          relatedChatIds.add(`${c.resolved_number}@c.us`);
        }
      }
    }

    const idList = Array.from(relatedChatIds);
    const inPlaceholders = idList.map(() => '?').join(',');
    const params: any[] = [...idList];

    let whereClause = `wm.chat_id IN (${inPlaceholders})`;
    if (phoneWithoutCc && phoneWithoutCc.length >= 7) {
      whereClause += ` OR wm.chat_id LIKE ?`;
      params.push(likePattern);
    }
    params.push(limit);

    const rows = await db.all(
      `SELECT wm.id, wm.body, wm.from_me as fromMe, wm.timestamp,
              wm.type, wm.has_media as hasMedia,
              sm.result_json as scannedResult
       FROM whatsapp_messages wm
       LEFT JOIN scanned_messages sm ON sm.msg_id = wm.id
       WHERE ${whereClause}
       ORDER BY wm.timestamp ASC
       LIMIT ?`,
      params
    );
    return rows;
  } catch (err) {
    console.error('[WhatsApp Client Wrapper] getChatMessages SQLite error:', err);
    return [];
  }
}


/** Retrieve cached media file from local storage */
export async function getMessageMedia(chatId: string, messageId: string): Promise<{ mimetype: string; data: string; filename?: string }> {  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  // Look for any file in the uploads directory that starts with the messageId
  const files = fs.readdirSync(UPLOADS_DIR);
  const matchedFile = files.find(f => f.startsWith(messageId));

  if (!matchedFile) {
    throw new Error(`Media not found locally for message ID: ${messageId}`);
  }

  const filePath = path.join(UPLOADS_DIR, matchedFile);
  const ext = path.extname(matchedFile).toLowerCase();

  let mimetype = 'image/jpeg';
  if (ext === '.png') mimetype = 'image/png';
  else if (ext === '.pdf') mimetype = 'application/pdf';
  else if (ext === '.mp3') mimetype = 'audio/mp3';
  else if (ext === '.mp4') mimetype = 'video/mp4';

  const data = fs.readFileSync(filePath).toString('base64');
  return {
    mimetype,
    data,
    filename: matchedFile
  };
}

/**
 * Download media for an inbound message by re-hydrating a FRESH Message
 * instance from the client store via getMessageById(). Event-emitted Message
 * objects frequently lose their media-decrypt context (whatsapp-web.js throws
 * minified internals like Error("r") — observed on @lid chats and after
 * idle-sleep wakes), while a store-fresh instance still downloads fine.
 * Returns undefined when no ready client exists; never throws for
 * missing/unreachable messages beyond what downloadMedia itself raises.
 */
export async function downloadMessageMediaById(serializedId: string): Promise<{ data?: string; mimetype?: string } | undefined> {
  if (!clientInstance || !isReady || !serializedId) return undefined;
  const fresh: any = await clientInstance.getMessageById(serializedId);
  if (!fresh) return undefined;
  return await fresh.downloadMedia();
}
