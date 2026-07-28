#!/usr/bin/env node
/**
 * Bundles src/server.ts (ESM, "type": "module") into a single CommonJS file
 * that Node's Single Executable Application (SEA) feature can run as its
 * embedded main script.
 *
 * Two things SEA's embedded main script cannot do on its own, which this
 * banner works around:
 *   1. `import.meta.url` is empty when esbuild emits CJS — every file in
 *      this codebase derives __dirname from it, so we shim it in.
 *   2. SEA's embedded script only lets you `require()` Node core builtins
 *      (throws ERR_UNKNOWN_BUILTIN_MODULE for anything else). We replace
 *      the global `require` with a real, filesystem-based one rooted next
 *      to the executable, so `require('express')` etc. resolve normally
 *      against the node_modules folder shipped alongside the exe.
 */
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

const banner = `
const import_meta_url = require('url').pathToFileURL(__filename).href;
require = require('module').createRequire(require('path').join(process.execPath, '..', 'sea-entry.cjs'));
`.trim();

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'bootstrap.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  packages: 'external',
  banner: { js: banner },
  define: { 'import.meta.url': 'import_meta_url' },
  outfile: path.join(root, 'dist-pkg', 'server.cjs'),
  logLevel: 'info',
});
