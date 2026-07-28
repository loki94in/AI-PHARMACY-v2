/**
 * puppeteer-core ships ESM-only. A static `import puppeteer from 'puppeteer-core'`
 * gets compiled to a CJS `require('puppeteer-core')` by our esbuild bundle, which
 * throws (`Unexpected token 'export'`) since require() can't load an ESM-only
 * package. A real dynamic `import()` uses Node's ESM loader instead, which loads
 * both ESM and CJS packages fine — so we load it lazily here instead.
 */
import type PuppeteerCore from 'puppeteer-core';

let puppeteerPromise: Promise<typeof PuppeteerCore> | null = null;

export function getPuppeteer(): Promise<typeof PuppeteerCore> {
  if (!puppeteerPromise) {
    puppeteerPromise = import('puppeteer-core').then((m: any) => m.default ?? m);
  }
  return puppeteerPromise;
}
