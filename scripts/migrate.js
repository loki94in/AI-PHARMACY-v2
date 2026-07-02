#!/usr/bin/env node
/**
 * migrate.js - Safe SQLite migration script (single-file)
 *
 * Features:
 * - Optionally detect & auto-kill other Node processes (set AUTO_KILL=true to enable)
 * - Uses better-sqlite3 backup API to capture consistent snapshot (includes WAL)
 * - Converts staging to journal_mode=DELETE and VACUUM to remove WAL dependency
 * - Validates with PRAGMA integrity_check
 * - Writes snapshot metadata to staging directory (not to live DB during swap)
 * - Atomically swaps files with retries and explicit error handling (no silent catches)
 *
 * Usage:
 *   1) npm install better-sqlite3
 *   2) DB_PATH=data/app.db STAGING_DB_PATH=data/staging.db node migrate.js
 *   Optional: AUTO_KILL=true to auto-terminate other node processes (use with caution)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

const DB_PATH = process.env.DB_PATH || 'app.db';
const STAGING_DB_PATH = process.env.STAGING_DB_PATH || 'staging.db';
const BACKUP_PATH = DB_PATH + '.backup_before_swap';
const LOCK_PATH = 'migration.lock';
const MAX_RETRIES = 8;
const AUTO_KILL = (process.env.AUTO_KILL || 'false').toLowerCase() === 'true';

function log(...a) { console.log('[migrate]', ...a); }
function errLog(...a) { console.error('[migrate]', ...a); }

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  errLog('Missing dependency: better-sqlite3');
  errLog('Install it with:');
  console.log('');
  console.log('  npm install better-sqlite3');
  console.log('');
  process.exit(1);
}

function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) throw new Error('Migration lock exists; another migration might be running.');
  fs.writeFileSync(LOCK_PATH, `${process.pid}\n`);
}

function releaseLock() {
  try { if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH); } catch (_) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function retry(fn, label) {
  let attempt = 0;
  while (true) {
    try { return await fn(); } catch (err) {
      attempt++;
      if (attempt >= MAX_RETRIES) throw new Error(`${label} failed after ${attempt} attempts: ${err && err.message ? err.message : err}`);
      const backoff = Math.min(500 * 2 ** (attempt - 1), 5000);
      errLog(`${label} attempt ${attempt} error: ${err.message || err}. retrying ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

function listNodeProcesses() {
  const pids = [];
  try {
    if (os.platform() === 'win32') {
      const out = child_process.execSync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /FORMAT:CSV', { encoding: 'utf8' });
      out.split(/\r?\n/).forEach(line => {
        const parts = line.trim().split(',');
        if (parts.length >= 3) {
          const pid = parseInt(parts[2], 10);
          if (pid && pid !== process.pid) pids.push(pid);
        }
      });
    } else {
      const out = child_process.execSync('ps -eo pid,comm,args', { encoding: 'utf8' });
      out.split(/\r?\n/).forEach(line => {
        if (!line.trim()) return;
        const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
        if (m) {
          const pid = parseInt(m[1], 10);
          const comm = m[2];
          const args = m[3] || '';
          if ((comm === 'node' || args.includes('node')) && pid !== process.pid) pids.push(pid);
        }
      });
    }
  } catch (e) {
    // best-effort
  }
  return Array.from(new Set(pids));
}

async function killProcesses(pids) {
  if (!pids.length) return;
  log('Killing node processes:', pids.join(', '));
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (e) {
      try { process.kill(pid, 'SIGKILL'); } catch (_) {}
    }
  }
  // wait briefly for cleanup
  await sleep(800);
}

/* Backup: use better-sqlite3 backup API which is WAL-aware */
async function safeBackupLiveToStaging() {
  log('Backing up live DB to staging (WAL-aware) ...');
  if (!fs.existsSync(DB_PATH)) throw new Error('Live DB not found at ' + DB_PATH);
  if (fs.existsSync(STAGING_DB_PATH)) {
    log('Removing existing staging DB:', STAGING_DB_PATH);
    fs.unlinkSync(STAGING_DB_PATH);
  }
  const src = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    await src.backup(STAGING_DB_PATH, {
      progress: (info) => { /* optional */ }
    });
    src.close();
    log('Backup to staging complete.');
  } catch (e) {
    try { src.close(); } catch (_) {}
    throw e;
  }
}

/* Convert staging to DELETE journal + VACUUM to avoid WAL sidecars */
function makeStagingSelfContained() {
  log('Converting staging to journal_mode=DELETE and VACUUM ...');
  const s = new Database(STAGING_DB_PATH);
  try {
    const mode = s.pragma('journal_mode = DELETE', { simple: true });
    log('journal_mode result:', mode);
    s.exec('VACUUM;');
    s.close();
    log('Staging is now self-contained (no WAL).');
  } catch (e) {
    try { s.close(); } catch (_) {}
    throw e;
  }
}

function integrityCheck(dbPath) {
  log('Running integrity_check on', dbPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma('integrity_check', { simple: true });
    db.close();
    if (result !== 'ok') throw new Error('integrity_check failed: ' + result);
    log('integrity_check OK for', dbPath);
  } catch (e) {
    try { db.close(); } catch (_) {}
    throw e;
  }
}

/* Atomic swap with backup and retries - handles Windows file locking by retrying */
async function atomicSwap(stagingPath, targetPath) {
  log('Starting atomic swap:', stagingPath, '=>', targetPath);
  if (!fs.existsSync(stagingPath)) throw new Error('Staging missing: ' + stagingPath);
  if (!fs.existsSync(targetPath)) {
    // If target missing, just rename staging into place
    await retry(() => {
      fs.renameSync(stagingPath, targetPath);
      return Promise.resolve();
    }, 'Rename staging->live');
    return;
  }

  // Copy live to BACKUP_PATH (overwrite)
  log('Creating pre-swap backup:', BACKUP_PATH);
  fs.copyFileSync(targetPath, BACKUP_PATH);

  await retry(() => {
    const tmpOld = targetPath + '.old_migrate';
    // remove tmpOld if present
    try { if (fs.existsSync(tmpOld)) fs.unlinkSync(tmpOld); } catch (_) {}
    // move live -> tmpOld
    fs.renameSync(targetPath, tmpOld); // may throw if file locked
    // move staging -> live
    try {
      fs.renameSync(stagingPath, targetPath);
    } catch (e) {
      // restore old live
      if (fs.existsSync(tmpOld)) fs.renameSync(tmpOld, targetPath);
      throw e;
    }
    // remove tmpOld (old live)
    try { if (fs.existsSync(tmpOld)) fs.unlinkSync(tmpOld); } catch (e) { /* non-fatal */ }
    return Promise.resolve();
  }, 'Atomic swap (rename)');

  // Try to fsync target file (best-effort)
  try {
    const fd = fs.openSync(targetPath, 'r');
    try { fs.fsyncSync(fd); } catch (_) {}
    fs.closeSync(fd);
  } catch (_) {}
  log('Atomic swap completed.');
}

function writeSnapshotMetadata(stagingDir) {
  const meta = {
    created_at: new Date().toISOString(),
    source: DB_PATH,
    staging: STAGING_DB_PATH,
    pid: process.pid
  };
  const out = path.join(stagingDir, 'migration_snapshot.json');
  fs.writeFileSync(out, JSON.stringify(meta, null, 2));
  log('Wrote snapshot metadata to', out);
}

/* Main flow */
(async function main() {
  try {
    acquireLock();
    log('Acquired migration lock.');

    const nodePids = listNodeProcesses();
    if (nodePids.length) {
      log('Detected other Node.js processes (possible zombies):', nodePids.join(', '));
      if (AUTO_KILL) {
        log('AUTO_KILL enabled: attempting to terminate other node processes.');
        await killProcesses(nodePids);
        // give OS a moment to release locks
        await sleep(800);
      } else {
        throw new Error('Other Node processes detected. Stop them or run with AUTO_KILL=true to auto-terminate.');
      }
    } else {
      log('No other Node processes detected.');
    }

    await retry(async () => await safeBackupLiveToStaging(), 'Backup live->staging');

    makeStagingSelfContained();

    integrityCheck(STAGING_DB_PATH);

    // write metadata to the staging directory
    writeSnapshotMetadata(path.dirname(STAGING_DB_PATH));

    await atomicSwap(STAGING_DB_PATH, DB_PATH);

    integrityCheck(DB_PATH);

    log('Migration successful. Remove', BACKUP_PATH, 'manually when satisfied.');

  } catch (e) {
    errLog('Migration error:', e && e.message ? e.message : e);
    // attempt restore if backup exists
    try {
      if (fs.existsSync(BACKUP_PATH)) {
        errLog('Restoring backup to live DB from', BACKUP_PATH);
        fs.copyFileSync(BACKUP_PATH, DB_PATH);
        errLog('Restoration attempted.');
      }
    } catch (rerr) {
      errLog('Restoration failed:', rerr && rerr.message ? rerr.message : rerr);
    }
    process.exitCode = 1;
  } finally {
    releaseLock();
    log('Released migration lock.');
  }
})();
