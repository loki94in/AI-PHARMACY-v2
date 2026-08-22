import fs from 'fs';
import path from 'path';

/**
 * Shared Chromium browser/profile helpers.
 *
 * Single source for locating a Chrome/Edge executable and copying a Chrome
 * profile directory (session-critical for Pharmarack login persistence).
 * Previously duplicated in routes/pharmarack.ts and services/tokenRefreshScheduler.ts.
 */

/**
 * Locate an installed Chromium browser binary.
 * Pass { includeEdge: true } to also consider Microsoft Edge as a fallback
 * (used by Pharmarack cart flows); the default keeps strict Chrome-only
 * lookup semantics.
 */
export function findChromePath(options?: { includeEdge?: boolean }): string | null {
  const paths: (string | null)[] = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null
  ];

  if (options?.includeEdge) {
    paths.push(
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe') : null,
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe') : null
    );
  }

  for (const p of paths.filter(Boolean) as string[]) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/** Directory entries skipped when cloning a Chrome profile (caches + lock files). */
const PROFILE_SKIP_NAMES = new Set([
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

/**
 * Recursively copy a Chrome profile folder, omitting caches/locks so the copy
 * can be opened by a second browser instance without profile-lock crashes.
 */
export function copyProfileFolder(src: string, dest: string, logPrefix = '[ChromeProfile]'): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (PROFILE_SKIP_NAMES.has(lowerName)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyProfileFolder(srcPath, destPath, logPrefix);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err: any) {
        console.warn(`${logPrefix} Warning: Could not copy file ${srcPath}: ${err.message}`);
      }
    }
  }
}
