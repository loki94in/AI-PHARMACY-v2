/**
 * puppeteer-core ships ESM-only. A static `import puppeteer from 'puppeteer-core'`
 * gets compiled to a CJS `require('puppeteer-core')` by our esbuild bundle, which
 * throws (`Unexpected token 'export'`) since require() can't load an ESM-only
 * package. A real dynamic `import()` uses Node's ESM loader instead, which loads
 * both ESM and CJS packages fine — so we load it lazily here.
 *
 * In packaged environments (Node SEA / dist-pkg/server.cjs), dynamic `import('puppeteer-core')`
 * may attempt to resolve bare specifiers relative to `process.cwd()` (which defaults to C:\Windows\System32
 * when launched from shortcuts/services). To ensure rock-solid resolution across dev, tsx, and production,
 * we resolve the absolute file URL through require.resolve first before loading via import().
 */
import type PuppeteerCore from 'puppeteer-core';
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';
import { getAppDataDir } from '../config/index.js';

let puppeteerPromise: Promise<typeof PuppeteerCore> | null = null;

function resolvePuppeteerModule(): string | null {
  // 1. Try global / ambient require.resolve if available
  if (typeof require !== 'undefined' && typeof require.resolve === 'function') {
    try {
      return require.resolve('puppeteer-core');
    } catch {}
  }

  // 2. Comprehensive candidate directories where the app or its node_modules might live
  const candidateDirs = [
    getAppDataDir ? getAppDataDir() : null,
    process.execPath ? path.dirname(process.execPath) : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'AI Pharmacy OS') : null,
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'AI Pharmacy OS') : null,
    process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'AI Pharmacy OS') : null,
    typeof __filename !== 'undefined' ? path.dirname(__filename) : null,
    typeof __dirname !== 'undefined' ? path.resolve(__dirname, '..') : null,
    typeof __dirname !== 'undefined' ? path.resolve(__dirname, '..', '..') : null,
    process.argv[1] ? path.dirname(process.argv[1]) : null,
    process.cwd() ? process.cwd() : null,
  ].filter(Boolean) as string[];

  // 3. Try createRequire against anchors in candidate directories
  for (const cand of candidateDirs) {
    const anchors = [
      path.join(cand, 'package.json'),
      path.join(cand, 'sea-entry.cjs'),
      path.join(cand, 'index.js'),
    ];
    for (const anchor of anchors) {
      try {
        const req = createRequire(anchor);
        const resolved = req.resolve('puppeteer-core');
        if (resolved && fs.existsSync(resolved)) return resolved;
      } catch {}
    }
  }

  // 4. Direct filesystem probing for puppeteer-core entrypoints
  const subPaths = [
    path.join('node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js'),
    path.join('node_modules', 'puppeteer-core', 'lib', 'esm', 'puppeteer', 'puppeteer-core.js'),
    path.join('node_modules', 'puppeteer-core', 'lib', 'cjs', 'puppeteer', 'puppeteer-core.js'),
    path.join('node_modules', 'puppeteer-core', 'index.js'),
  ];

  for (const cand of candidateDirs) {
    for (const sub of subPaths) {
      const full = path.join(cand, sub);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  }

  return null;
}

export function getPuppeteer(): Promise<typeof PuppeteerCore> {
  if (!puppeteerPromise) {
    puppeteerPromise = (async () => {
      // 1. If absolute path is resolvable, load via absolute file URL (safe in all working directories)
      const resolvedPath = resolvePuppeteerModule();
      if (resolvedPath) {
        try {
          const fileUrl = pathToFileURL(resolvedPath).href;
          const m: any = await import(fileUrl);
          return m.default ?? m;
        } catch (fileImportErr) {
          console.warn('[lazyPuppeteer] Loading via file URL failed, falling back:', fileImportErr);
        }
      }

      // 2. Fallback to standard bare specifier dynamic import
      const m: any = await import('puppeteer-core');
      return m.default ?? m;
    })();
  }
  return puppeteerPromise;
}

