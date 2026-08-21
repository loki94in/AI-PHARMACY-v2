import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getPuppeteer } from '../utils/lazyPuppeteer.js';
import { dbManager } from '../database/connection.js';
import { getAppDataDir } from '../config/index.js';
import { activityTracker } from '../utils/activityTracker.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function copyProfileFolder(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  const skippedNames = new Set([
    'cache',
    'code cache',
    'gpucache',
    'dawngraphitecache',
    'dawnwebgpucache',
    'gpupersistentcache',
    'grshadercache',
    'shadercache',
    'browsermetrics',
    'crashpad',
    'lockfile',
    'parent.lock',
    'singletonlock',
    'lock',
    'devtoolsactiveport'
  ]);

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (skippedNames.has(lowerName)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyProfileFolder(srcPath, destPath);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err: any) {
        console.warn(`[TokenRefreshScheduler] Warning: Could not copy file ${srcPath}: ${err.message}`);
      }
    }
  }
}

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

  public async logSessionRefresh(
    triggerType: 'background_random' | 'manual_reauth' | 'monthly_autosync' | 'boot',
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
      nextScheduledMinutes: this.nextScheduledMinutes
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
    console.log('[TokenRefreshScheduler] Starting dynamic background token refresh scheduler...');
    // Run initial check on boot
    this.refreshIfNeeded('boot');
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

    // Add a slight ±2 minute anti-detection jitter around targetInterval
    const jitter = Math.floor(Math.random() * 5) - 2;
    const randomMinutes = Math.max(5, targetInterval + jitter);
    this.nextScheduledMinutes = randomMinutes;
    const delayMs = randomMinutes * 60 * 1000;

    console.log(`[TokenRefreshScheduler] Next background session refresh scheduled in ${randomMinutes} minutes (configured: ${targetInterval}m).`);

    this.timeoutId = setTimeout(() => {
      this.refreshIfNeeded('background_random');
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

      if (!token && triggerType !== 'manual_reauth') {
        if (!this.hasLoggedNoToken) {
          console.log('[TokenRefreshScheduler] No token found in app_settings. Skipping background auto-refresh until user logs in.');
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
    }
  }

  public async executeRefresh(): Promise<string | null> {
    if (activityTracker.isIdle()) {
      console.log('[TokenRefreshScheduler] User is idle (>30m). Skipping background Pharmarack session refresh.');
      return null;
    }

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
        copyProfileFolder(mainProfilePath, tempProfilePath);
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
        console.warn('[TokenRefreshScheduler] Session expired: Headless browser redirected to login page. Clearing token.');
        this.lastError = 'Session expired. Please log in via Settings > External Integrations.';
        try {
          const db = await dbManager.getConnection();
          await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', '')");
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
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");
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
            copyProfileFolder(tempProfilePathToDelete, mainProfilePath);
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
