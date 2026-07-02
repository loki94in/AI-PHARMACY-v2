import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import { dbManager } from '../database/connection.js';

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

  private constructor() {}

  public static getInstance(): TokenRefreshScheduler {
    if (!TokenRefreshScheduler.instance) {
      TokenRefreshScheduler.instance = new TokenRefreshScheduler();
    }
    return TokenRefreshScheduler.instance;
  }

  public start() {
    if (this.intervalId) return;
    console.log('[TokenRefreshScheduler] Starting background token refresh job (every 20 minutes)...');
    // Run immediately on boot
    this.refreshIfNeeded();
    // Then every 20 minutes
    this.intervalId = setInterval(() => {
      this.refreshIfNeeded();
    }, 20 * 60 * 1000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public async refreshIfNeeded() {
    if (this.isRefreshing || this.isLoginWindowActive) return;
    this.isRefreshing = true;

    try {
      const db = await dbManager.getConnection();
      const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'");
      const token = tokenRow ? tokenRow.value : '';

      if (!token) {
        console.log('[TokenRefreshScheduler] No token found in app_settings. Skipping auto-refresh.');
        this.isRefreshing = false;
        return;
      }

      console.log('[TokenRefreshScheduler] Running scheduled token refresh check...');
      await this.executeRefresh();
    } catch (err: any) {
      console.error('[TokenRefreshScheduler] Error during refresh check:', err.message);
    } finally {
      this.isRefreshing = false;
    }
  }

  public async executeRefresh(): Promise<string | null> {
    const chromePath = findChromePath();
    if (!chromePath) {
      console.error('[TokenRefreshScheduler] Chrome path not found.');
      return null;
    }

    const mainProfilePath = path.resolve(__dirname, '..', '..', 'data', 'pharmarack_profile');
    if (!fs.existsSync(mainProfilePath)) {
      console.error('[TokenRefreshScheduler] Main profile folder does not exist.');
      return null;
    }

    let browser;
    const holder = { token: null as string | null };
    let tempProfilePathToDelete = '';

    try {
      console.log('[TokenRefreshScheduler] Launching background headless Chrome for silent session capture...');
      try {
        cleanProfileLockFiles(mainProfilePath);
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          userDataDir: mainProfilePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      } catch (launchErr: any) {
        console.log('[TokenRefreshScheduler] Main profile is locked. Copying to temp profile...', launchErr.message);
        const randomSuffix = Math.floor(Math.random() * 1000000);
        const tempProfilePath = path.resolve(__dirname, '..', '..', 'data', `pharmarack_profile_temp_${Date.now()}_${randomSuffix}`);
        copyProfileFolder(mainProfilePath, tempProfilePath);
        cleanProfileLockFiles(tempProfilePath);
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          userDataDir: tempProfilePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
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

      // Poll for captured token or timeout (10s max)
      const startTime = Date.now();
      while (!holder.token && Date.now() - startTime < 10000) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (holder.token) {
        console.log('[TokenRefreshScheduler] Successfully captured fresh token:', holder.token.substring(0, 15) + '...');
        const db = await dbManager.getConnection();
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', ?)", [holder.token]);
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");
        return holder.token;
      } else {
        console.warn('[TokenRefreshScheduler] Headless navigation completed but no authorization header was captured.');
        return null;
      }
    } catch (err: any) {
      console.error('[TokenRefreshScheduler] Failed to refresh token in background:', err.message);
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
