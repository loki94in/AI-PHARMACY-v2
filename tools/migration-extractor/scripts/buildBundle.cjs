#!/usr/bin/env node
/**
 * Bundles index.js and its dependencies (adm-zip, csv-writer, commander — all
 * pure JS, no native bindings) into a single self-contained CommonJS file that
 * Node's Single Executable Application (SEA) feature can run as its embedded
 * main script. Unlike the main app, nothing needs to stay external here.
 */
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

esbuild.buildSync({
  entryPoints: [path.join(root, 'index.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(root, 'dist-pkg', 'extractor.cjs'),
  logLevel: 'info',
});
