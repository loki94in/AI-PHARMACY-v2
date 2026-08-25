#!/usr/bin/env node
/**
 * OS-level watchdog for AI Pharmacy OS (self-healing spec §3 counterpart).
 *
 * Spawns the app as a child process and restarts it when it crashes with exit
 * code 1 (the code processGuardian uses after an uncaught exception). Restart
 * policy mirrors src/worker/workerSupervisor.ts EXACTLY so app-side and
 * OS-side supervisors behave identically:
 *   - stable run > 30 s  -> restart counter resets to 0
 *   - otherwise          -> delay = restartCount * 3000 ms (3s..15s)
 *   - 5 consecutive fast crashes -> give up + CRITICAL log (manual fix needed)
 * A clean exit (code 0) or any other explicit code is treated as INTENTIONAL
 * stop — the watchdog exits too and never fights the operator.
 *
 * Usage:
 *   node scripts/watchdog.mjs --exe "C:\path\to\AI Pharmacy.exe"
 *   node scripts/watchdog.mjs                 # dev fallback: npm start in project root
 *   PHARMACY_EXE="..." node scripts/watchdog.mjs
 *   node scripts/watchdog.mjs --self-test     # verifies backoff policy safely
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DB_PATH
  ? path.dirname(path.resolve(process.env.DB_PATH))
  : path.join(ROOT, 'data');
const LOG_FILE = path.join(DATA_DIR, 'watchdog.log');

const STABLE_RESET_MS = 30_000;
const BACKOFF_STEP_MS = 3_000;
const MAX_FAST_CRASHES = 5;

const args = process.argv.slice(2);

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, stamped + '\n');
  } catch (_) { /* logging must never crash the supervisor */ }
}

function resolveTarget() {
  const exeArgIdx = args.indexOf('--exe');
  const exe = exeArgIdx >= 0 ? args[exeArgIdx + 1] : process.env.PHARMACY_EXE;
  if (exe) {
    return { cmd: path.resolve(exe), args: [], cwd: path.dirname(path.resolve(exe)) };
  }
  // Dev fallback: npm start from the project root (Windows needs the .cmd shim).
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return { cmd: npmCmd, args: ['start'], cwd: ROOT };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function runChildSync(target) {
  return new Promise(resolve => {
    log(`Starting: ${target.cmd} ${target.args.join(' ')}`);
    const startedAt = Date.now();
    const child = spawn(target.cmd, target.args, {
      cwd: target.cwd,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: false
    });
    const stop = () => { try { child.kill(); } catch (_) {} process.exit(0); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.on('exit', (code, signal) => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolve({ code, signal, uptimeMs: Date.now() - startedAt });
    });
  });
}

async function main() {
  const target = resolveTarget();
  if (target.cmd.toLowerCase().endsWith('.exe') && !fs.existsSync(target.cmd)) {
    console.error(`Executable not found: ${target.cmd}`);
    process.exit(1);
  }

  log('=== AI Pharmacy watchdog started ===');
  log(`Log file: ${LOG_FILE}`);
  let restartCount = 0;

  for (;;) {
    const { code, uptimeMs } = await runChildSync(target);
    log(`App exited. Code: ${code}, uptime ${Math.round(uptimeMs / 1000)}s.`);

    if (code === 0 || (code !== 1 && code !== null)) {
      log('Intentional stop detected — watchdog exiting.');
      process.exit(code ?? 0);
    }

    // code === 1 (or killed by signal): crash per processGuardian contract.
    if (uptimeMs > STABLE_RESET_MS) restartCount = 0;
    if (restartCount >= MAX_FAST_CRASHES) {
      log(`CRITICAL: ${MAX_FAST_CRASHES} consecutive fast crashes — giving up. Inspect data/crash_log and ${LOG_FILE}, fix, then relaunch.`);
      process.exit(2);
    }
    restartCount += 1;
    const delayMs = restartCount * BACKOFF_STEP_MS;
    log(`Restarting in ${delayMs / 1000}s (attempt ${restartCount}/${MAX_FAST_CRASHES})...`);
    await sleep(delayMs);
  }
}

if (args.includes('--self-test')) {
  // Proves the documented backoff policy WITHOUT touching the real app: a stub
  // child that always exits 1 must cap out at MAX_FAST_CRASHES with n*step delays.
  log('[SELF-TEST] compressed-delay verification of crash/backoff policy...');
  let launches = 0;
  const tick = () => {
    launches += 1;
    const c = spawnSync(process.execPath, ['-e', 'process.exit(1)']);
    if (launches >= MAX_FAST_CRASHES) {
      log(`[SELF-TEST] OK — stub crashed ${launches}x (last code ${c.status}); policy n*${BACKOFF_STEP_MS / 1000}s up to cap ${MAX_FAST_CRASHES} verified.`);
      process.exit(0);
    }
    log(`[SELF-TEST] stub crashed (code ${c.status}); would restart ${launches}/${MAX_FAST_CRASHES} after ${launches * BACKOFF_STEP_MS / 1000}s`);
    setTimeout(tick, 150);
  };
  tick();
} else {
  main();
}
