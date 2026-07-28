#!/usr/bin/env node
/**
 * Packages dist-pkg/server.cjs into a single Windows executable using Node's
 * built-in Single Executable Application (SEA) support.
 *
 * We use SEA instead of `pkg` because `pkg` (vercel/pkg) cannot execute
 * dynamic `import()` at all (throws "Invalid host defined options"), and
 * this codebase's lazy-loaded routes/services depend on it throughout.
 * SEA runs the real Node binary, so dynamic import works exactly as in dev.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const outExe = path.join(distDir, 'PharmacyOS.exe');
const blobPath = path.join(root, 'dist-pkg', 'sea-prep.blob');

fs.mkdirSync(distDir, { recursive: true });

console.log('[build-sea] Generating SEA blob...');
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], {
  cwd: root,
  stdio: 'inherit',
});

console.log('[build-sea] Copying base node executable...');
if (fs.existsSync(outExe)) fs.rmSync(outExe);
fs.copyFileSync(process.execPath, outExe);

console.log('[build-sea] Injecting blob with postject...');
const q = (s) => `"${s}"`;
execSync(
  `npx --yes postject ${q(outExe)} NODE_SEA_BLOB ${q(blobPath)} --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { cwd: root, stdio: 'inherit' }
);

console.log('[build-sea] Done ->', outExe);
