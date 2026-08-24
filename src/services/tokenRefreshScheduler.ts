import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getPuppeteer } from '../utils/lazyPuppeteer.js';
import { dbManager } from '../database/connection.js';
import { getAppDataDir } from '../config/index.js';
import { activityTracker } from '../utils/activityTracker.js';
import { findChromePath, copyProfileFolder } from '../utils/chromeBrowser.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function killOrphanChromeProcesses(keyword: string = 'pharmarack_profile'): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    const resolvedPath = path.isAbsolute(keyword)
      ? keyword
      : path.join(getAppDataDir(), 'data', keyword);
    const filterPattern = resolvedPath.replace(/\\/g, '%').replace(/\//g, '%');

    const execResult = await execAsync(
      `wmic process where "name='chrome.exe' and CommandLine like '%${filterPattern}%'" get ProcessId`,
      { timeout: 3000 }
    ).catch(async () => {
      return await execAsync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='chrome.exe' and commandline like '%${filterPattern}%'\\" | Select-Object -ExpandProperty ProcessId"`,
        { timeout: 4000 }
      ).catch(() => ({ stdout: '' }));
    });

    const stdout = execResult.stdout || '';
    const pids = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.toLowerCase().includes('processid'))
      .map(pid => parseInt(pid, 10))
      .filter(pid => !isNaN(pid) && pid > 0);

    for (const pid of pids) {
      console.log(`[ProcessGuardian] Killing lock-holding Chrome process: ${pid}`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch (_) {
        try {
          await execAsync(`taskkill /F /PID ${pid}`);
        } catch (_) {}
      }
    }
    if (pids.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (err: any) {
    console.error(`[ProcessGuardian] Failed to kill lock-holding Chrome processes for ${keyword}:`, err.message);
  }
}

export function cleanTempProfileFolders() {
  try {
    const dataDir = path.resolve(getAppDataDir(), 'data');
    if (!fs.existsSync(dataDir)) return;
    const entries = fs.readdirSync(dataDir);
    for (const entry of entries) {
      if (entry.startsWith('pharmarack_profile_temp_')) {
        const fullPath = path.join(dataDir, entry);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`[TokenRefreshScheduler] Removed orphaned temp profile folder: ${entry}`);
        } catch (_) {}
      }
    }
  } catch (err: any) {
    console.warn('[TokenRefreshScheduler] Error cleaning temp profile folders:', err.message);
  }
}

export function cleanProfileLockFiles(profilePath: string) {
  if (!fs.existsSync(profilePath)) return;
  const lockFiles = [
    'SingletonLock',
    'lockfile',
    'parent.lock',
    'Singleton Cookie',
    'Singleton Socket',
    'Singleton Preference',
    'devtoolsactiveport'
  ];
  for (const file of lockFiles) {
    const filePath = path.join(profilePath, file);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[TokenRefreshScheduler] Removed stale lock file: ${filePath}`);
      } catch (err: any) {
        console.warn(`[TokenRefreshScheduler] Could not remove lock file ${filePath}: ${err.message}`);
      }
    }
  }
}

export class TokenRefreshScheduler {
  private static instance: TokenRefreshScheduler;
  private intervalId: NodeJS.Timeout | null = null;
  private isRefreshing = false;
  public isLoginWindowActive = false;
  private lastCapturedAt: number | null = null;
  private lastError: string | null = null;

  private constructor() {}

  public static getInstance(): TokenRefreshScheduler {
    if (!TokenRefreshScheduler.instance) {
      TokenRefreshScheduler.instance = new TokenRefreshScheduler();
    }
    return TokenRefreshScheduler.instance;
  }

  private timeoutId: NodeJS.Timeout | null = null;
  private nextScheduledMinutes: number | null = null;
  private hasLoggedNoToken = false;
  private firstRefreshDone = false;
  private firstRefreshCallbacks: Array<() => void> = [];
  // Single-flight mutex for browser session restores: a cron tick, a 401 retry
  // from fetchPharmarack and a catalog-cache refresh could previously overlap and
  // spawn two concurrent headless Chromes. They now share one in-flight promise.
  private refreshPromise: Promise<string | null> | null = null;
  private heartbeatInFlight = false;
  private lastHeartbeatAt: number | null = null;

  /**
   * Invoke cb once the first boot refresh attempt settles (success, failure or skip).
   * Used to chain the startup live-cart warm-up onto a fresh token without racing
   * the headless Chrome session refresh. If the first refresh already completed,
   * cb runs immediately; if the scheduler never runs, callers need their own fallback timer.
   */
  public onFirstRefreshComplete(cb: () => void): void {
    if (this.firstRefreshDone) {
      try { cb(); } catch (_) {}
      return;
    }
    this.firstRefreshCallbacks.push(cb);
  }

  private releaseFirstRefreshCallbacks(): void {
    if (this.firstRefreshDone) return;
    this.firstRefreshDone = true;
    const callbacks = [...this.firstRefreshCallbacks];
    this.firstRefreshCallbacks = [];
    for (const cb of callbacks) {
      try { cb(); } catch (err: any) {
        console.warn('[TokenRefreshScheduler] First-refresh callback failed:', err?.message || err);
      }
    }
  }

  public async logSessionRefresh(
    triggerType: 'background_random' | 'manual_reauth' | 'monthly_autosync' | 'boot' | 'heartbeat',
    nextScheduledMinutes: number | null,
    status: 'success' | 'failed',
    errorMessage: string | null = null
  ) {
    try {
      const db = await dbManager.getConnection();
      const now = Date.now();
      await db.run(
        `INSERT INTO session_refresh_logs (timestamp, trigger_type, next_scheduled_minutes, status, error_message)
         VALUES (?, ?, ?, ?, ?)`,
        [now, triggerType, nextScheduledMinutes, status, errorMessage]
      );

      // Auto-prune logs older than 60 days
      const sixtyDaysAgo = now - 60 * 86400 * 1000;
      await db.run("DELETE FROM session_refresh_logs WHERE timestamp < ?", [sixtyDaysAgo]);
    } catch (err: any) {
      console.warn('[TokenRefreshScheduler] Failed to record refresh log:', err.message);
    }
  }

  public getStatus() {
    return {
      isRefreshing: this.isRefreshing,
      isLoginWindowActive: this.isLoginWindowActive,
      lastCapturedAt: this.lastCapturedAt,
      lastError: this.lastError,
      nextScheduledMinutes: this.nextScheduledMinutes,
      lastHeartbeatAt: this.lastHeartbeatAt
    };
  }

  public async triggerImmediateCheck(triggerType: 'background_random' | 'manual_reauth' | 'monthly_autosync' | 'boot' = 'manual_reauth') {
    return this.refreshIfNeeded(triggerType);
  }

  public async start() {
    if (process.env.DISABLE_BACKGROUND_WORKERS !== 'false') {
      console.log('[TokenRefreshScheduler] Background token refresh scheduler is STOPPED and DISABLED.');
      this.stop();
      return;
    }

    try {
      const db = await dbManager.getConnection();
      const enabledRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_pharmarack_refresh_enabled'");
      if (enabledRow && enabledRow.value === 'false') {
        console.log('[TokenRefreshScheduler] Pharmarack token refresher disabled in Settings.');
        this.stop();
        return;
      }
    } catch (_) {}

    if (this.timeoutId) return;
    console.log('[TokenRefreshScheduler] Starting REST session heartbeat scheduler (browser only on demand)...');
    // Boot validation is REST-first now: one cheap authenticated probe confirms the
    // session; a headless Chrome launches ONLY if that probe returns 401/403 or no
    // token exists but cookies do (legacy capture path).
    this.runSessionHeartbeat('boot');
    // Schedule next execution
    this.scheduleNextRun();
  }

  private async scheduleNextRun() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    let targetInterval = 20;
    try {
      const db = await dbManager.getConnection();
      const intervalRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_pharmarack_refresh_interval_min'");
      if (intervalRow?.value) {
        const parsed = parseInt(intervalRow.value, 10);
        if (!isNaN(parsed) && parsed >= 5 && parsed <= 120) {
          targetInterval = parsed;
        }
      }
    } catch (_) {}

    // No jitter needed anymore: a REST keep-alive probe is indistinguishable from
    // the retailer web app's own polling — nothing to anti-detect.
    this.nextScheduledMinutes = targetInterval;
    const delayMs = targetInterval * 60 * 1000;

    console.log(`[TokenRefreshScheduler] Next session heartbeat in ${targetInterval} minutes.`);

    this.timeoutId = setTimeout(() => {
      this.runSessionHeartbeat('heartbeat');
      this.scheduleNextRun();
    }, delayMs);
  }

  public stop() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  public async refreshIfNeeded(triggerType: 'background_random' | 'manual_reauth' | 'monthly_autosync' | 'boot' = 'background_random') {
    if (this.isRefreshing || this.isLoginWindowActive) return;
    this.isRefreshing = true;

    let resToken: string | null = null;
    let errorMsg: string | null = null;

    try {
      const { getBackendFetchMode } = await import('./dataFetchControl.js');
      const mode = await getBackendFetchMode('bg.pharmarackTokenRefresh', 'auto');
      if (mode === 'off') {
        this.isRefreshing = false;
        return;
      }
      const { activityTracker } = await import('../utils/activityTracker.js');
      if (mode === 'manual' && activityTracker.isIdle()) {
        console.log('[TokenRefreshScheduler] Skipped background token refresh (mode=manual, system is idle)');
        this.isRefreshing = false;
        return;
      }

      const db = await dbManager.getConnection();
      const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'");
      const token = tokenRow ? tokenRow.value : '';

      const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
      const hasStoredProfile = fs.existsSync(mainProfilePath) && fs.readdirSync(mainProfilePath).length > 0;

      if (!token && !hasStoredProfile && triggerType !== 'manual_reauth') {
        if (!this.hasLoggedNoToken) {
          console.log('[TokenRefreshScheduler] No token or browser profile found. Skipping background auto-refresh until user logs in.');
          this.hasLoggedNoToken = true;
        }
        this.isRefreshing = false;
        return;
      }
      this.hasLoggedNoToken = false;

      console.log(`[TokenRefreshScheduler] Running token refresh check (trigger=${triggerType})...`);
      resToken = await this.executeRefresh();
      if (!resToken) {
        errorMsg = this.lastError || 'Token capture failed';
      }
    } catch (err: any) {
      console.error('[TokenRefreshScheduler] Error during refresh check:', err.message);
      errorMsg = err.message || 'Refresh error';
    } finally {
      this.isRefreshing = false;
      const status = resToken ? 'success' : 'failed';
      await this.logSessionRefresh(triggerType, this.nextScheduledMinutes, status, errorMsg);
      // P1 push event: services-status UI updates without polling
      try {
        const { eventService } = await import('./eventService.js');
        eventService.broadcast('pharmarack_session_refreshed', { status, error: errorMsg });
      } catch (_) {}
      // Signal boot-phase listeners (e.g. startup live-cart warm-up) that the first
      // refresh window has settled — covers success, failure and skip paths alike.
      this.releaseFirstRefreshCallbacks();
    }
    return resToken;
  }

  /**
   * REST session keep-alive (replaces the periodic headless-Chrome refresh).
   *
   * Fires ONE cheap authenticated probe against GetUserCartDetails — the same
   * endpoint the retailer web app itself polls — so it is indistinguishable from
   * normal usage and strictly LESS detectable than the old repeated automation
   * launches (owner zero-ban-risk requirement). A headless Chrome session restore
   * is launched ONLY when the probe proves auth death (401/403) or when a browser
   * profile exists without any stored token (legacy silent-capture path).
   *
   * P4 exemption (credentials are sacred): runs even while idle — its whole
   * purpose is overnight session survival so no morning OTP re-login is needed.
   * Cost: ~1 small request per interval. Only mode='off' suppresses it.
   */
  public async runSessionHeartbeat(trigger: 'boot' | 'heartbeat' = 'heartbeat'): Promise<boolean> {
    if (this.heartbeatInFlight || this.isLoginWindowActive) return false;
    this.heartbeatInFlight = true;

    let ok = false;
    let errorMsg: string | null = null;
    let skipped = false;

    try {
      const { getBackendFetchMode } = await import('./dataFetchControl.js');
      const mode = await getBackendFetchMode('bg.pharmarackTokenRefresh', 'auto');
      if (mode === 'off') {
        skipped = true;
        return false;
      }

      const db = await dbManager.getConnection();
      const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'");
      const token: string = tokenRow?.value || '';

      const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
      const hasStoredProfile = fs.existsSync(mainProfilePath) && fs.readdirSync(mainProfilePath).length > 0;

      if (!token && !hasStoredProfile) {
        skipped = true;
        if (!this.hasLoggedNoToken) {
          console.log('[TokenRefreshScheduler] No token or browser profile found. Heartbeat standing by until user logs in.');
          this.hasLoggedNoToken = true;
        }
        return false;
      }
      this.hasLoggedNoToken = false;

      if (token) {
        console.log(`[TokenRefreshScheduler] Session heartbeat probe (${trigger})...`);
        try {
          const res = await fetch('https://pharmretail-api.pharmarack.com/cart/api/v1/GetUserCartDetails', {
            method: 'GET',
            headers: {
              'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
              'Content-Type': 'application/json',
              'devicetype': 'web',
              'Accept': 'application/json, text/plain, */*',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://retailers.pharmarack.com/',
              'Origin': 'https://retailers.pharmarack.com'
            },
            signal: AbortSignal.timeout(12_000)
          });

          if (res.ok) {
            ok = true;
            this.lastError = null;
            // Keep UI truth fresh — a previously stale/expired session just proved alive.
            try {
              await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_status', 'active')");
            } catch (_) {}
          } else if (res.status === 401 || res.status === 403) {
            console.log('[TokenRefreshScheduler] Heartbeat got 401/403 → launching on-demand browser session restore...');
            const fresh = await this.executeRefresh();
            ok = !!fresh;
            if (!ok) errorMsg = this.lastError || 'Session restore after heartbeat auth failure failed';
          } else {
            // Soft failure (network blip / upstream 5xx): do NOT burn a Chrome
            // launch on it. Next tick retries; real usage gets the reactive 401 path.
            errorMsg = `Heartbeat HTTP ${res.status}`;
          }
        } catch (probeErr: any) {
          errorMsg = probeErr?.message || 'Heartbeat probe error';
        }
      } else {
        // Profile cookies exist but no stored token — legacy one-shot capture attempt.
        console.log('[TokenRefreshScheduler] Token missing but profile present → on-demand browser capture...');
        const fresh = await this.executeRefresh();
        ok = !!fresh;
        if (!ok) errorMsg = this.lastError || 'Browser token capture failed';
      }
    } catch (err: any) {
      console.error('[TokenRefreshScheduler] Heartbeat error:', err.message);
      errorMsg = err.message || 'Heartbeat error';
    } finally {
      this.heartbeatInFlight = false;
      if (!skipped) {
        this.lastHeartbeatAt = Date.now();
        const status = ok ? 'success' : 'failed';
        await this.logSessionRefresh(trigger, this.nextScheduledMinutes, status, errorMsg);
        // P1 push event: services-status UI updates without polling
        try {
          const { eventService } = await import('./eventService.js');
          eventService.broadcast('pharmarack_session_refreshed', { status, error: errorMsg });
        } catch (_) {}
      }
      // Signal boot-phase listeners (startup live-cart warm-up) that the first
      // keep-alive window settled — success, failure AND skip paths alike.
      this.releaseFirstRefreshCallbacks();
    }
    return ok;
  }

  /** Single-flight mutex: overlapping callers (cron, 401 retry, catalog cache)
   *  share ONE browser session restore instead of spawning concurrent Chromes. */
  public executeRefresh(): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.executeRefreshInternal().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async executeRefreshInternal(): Promise<string | null> {
    // P4 decision (API_OPTIMIZATION_IMPLEMENTATION_PLAN.md Phase 1.3): refresh runs
    // even when the user is idle — its whole purpose is keeping the Pharmarack
    // session alive overnight so no morning OTP re-login is needed.

    const chromePath = findChromePath();
    if (!chromePath) {
      console.error('[TokenRefreshScheduler] Chrome path not found.');
      return null;
    }

    const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
    if (!fs.existsSync(mainProfilePath)) {
      fs.mkdirSync(mainProfilePath, { recursive: true });
      console.log('[TokenRefreshScheduler] Initialized missing main profile folder at:', mainProfilePath);
    }

    let browser;
    const holder = { token: null as string | null };
    let tempProfilePathToDelete = '';
    const puppeteer = await getPuppeteer();

    try {
      console.log('[TokenRefreshScheduler] Killing orphan Chrome processes and cleaning profile locks...');
      await killOrphanChromeProcesses('pharmarack_profile');
      cleanTempProfileFolders();
      try {
        cleanProfileLockFiles(mainProfilePath);
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          userDataDir: mainProfilePath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--single-process',
            '--renderer-process-limit=1',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-default-apps',
            '--no-first-run',
            '--mute-audio',
            '--no-zygote',
            '--js-flags=--max-old-space-size=128',
            '--window-position=-10000,-10000'
          ]
        });
      } catch (launchErr: any) {
        console.log('[TokenRefreshScheduler] Main profile is locked. Copying to temp profile...', launchErr.message);
        const randomSuffix = Math.floor(Math.random() * 1000000);
        const tempProfilePath = path.resolve(getAppDataDir(), 'data', `pharmarack_profile_temp_${Date.now()}_${randomSuffix}`);
        await copyProfileFolder(mainProfilePath, tempProfilePath, '[TokenRefreshScheduler]');
        cleanProfileLockFiles(tempProfilePath);
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          userDataDir: tempProfilePath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--single-process',
            '--renderer-process-limit=1',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-default-apps',
            '--no-first-run',
            '--mute-audio',
            '--no-zygote',
            '--js-flags=--max-old-space-size=128',
            '--window-position=-10000,-10000'
          ]
        });
        tempProfilePathToDelete = tempProfilePath;
      }

      const [page] = await browser.pages();
      
      page.on('request', request => {
        const headers = request.headers();
        const auth = headers['authorization'] || headers['Authorization'];
        if (auth && auth.length > 15) {
          let tokenVal = auth;
          if (auth.startsWith('Bearer ') || auth.startsWith('bearer ')) {
            tokenVal = auth.substring(7);
          }
          if (tokenVal && tokenVal.length > 10) {
            holder.token = tokenVal;
          }
        }
      });

      // Start navigation with a 10s timeout and domcontentloaded
      await page.goto('https://retailers.pharmarack.com/', { waitUntil: 'domcontentloaded', timeout: 10000 })
        .catch(err => {
          console.log('[TokenRefreshScheduler] Headless navigation error/timeout:', err.message);
        });

      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('/signin')) {
        console.warn('[TokenRefreshScheduler] Session expired: Headless browser redirected to login page. Marking token stale (profile cookies preserved for re-login).');
        this.lastError = 'Session expired. Please log in via Settings > External Integrations.';
        try {
          const db = await dbManager.getConnection();
          // P4: never blank the stored token on transient/expiry detection —
          // keep the last value and mark status so the UI can prompt re-login.
          await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_status', 'expired')");
        } catch (_) {}
        return null;
      }

      // Poll for captured token or timeout (8s max)
      const startTime = Date.now();
      while (!holder.token && Date.now() - startTime < 8000) {
        if (page.url().includes('/login')) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (holder.token) {
        console.log('[TokenRefreshScheduler] Successfully captured fresh token:', holder.token.substring(0, 15) + '...');
        this.lastCapturedAt = Date.now();
        this.lastError = null;
        const db = await dbManager.getConnection();
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', ?)", [holder.token]);
        import('./pharmarackCatalogCache.js').then(m => m.ensureCatalogSyncCron()).catch(() => {});
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_status', 'active')");
        return holder.token;
      } else {
        console.warn('[TokenRefreshScheduler] Headless navigation completed but no authorization header was captured.');
        this.lastError = 'No authorization header captured';
        return null;
      }
    } catch (err: any) {
      console.error('[TokenRefreshScheduler] Failed to refresh token in background:', err.message);
      this.lastError = err.message || 'Background token refresh failed';
      return null;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          // ignore
        }
      }
      if (tempProfilePathToDelete) {
        try {
          if (holder.token) {
            console.log('[TokenRefreshScheduler] Copying updated session back to main profile...');
            await copyProfileFolder(tempProfilePathToDelete, mainProfilePath, '[TokenRefreshScheduler]');
          }
        } catch (copyBackErr: any) {
          console.warn('[TokenRefreshScheduler] Could not copy temp profile back to main profile:', copyBackErr.message);
        }
        try {
          if (fs.existsSync(tempProfilePathToDelete)) {
            fs.rmSync(tempProfilePathToDelete, { recursive: true, force: true });
            console.log(`[TokenRefreshScheduler] Cleared temp profile directory at ${tempProfilePathToDelete}`);
          }
        } catch (rmErr: any) {
          console.warn(`[TokenRefreshScheduler] Could not remove temp folder: ${rmErr.message}`);
        }
      }
    }
  }
}

export const tokenRefreshScheduler = TokenRefreshScheduler.getInstance();
