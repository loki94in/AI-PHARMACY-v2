import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

/**
 * Writes a crash entry to the crash_log table.
 * Uses a direct DB open (not dbManager) so it works even if the shared
 * connection is in a bad state at crash time.
 */
async function writeCrashLog(message: string, stack: string): Promise<void> {
  try {
    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    // Read app_version from app_settings if available
    let appVersion = 'unknown';
    try {
      const row = await db.get("SELECT value FROM app_settings WHERE key = 'app_version'");
      if (row?.value) appVersion = row.value;
    } catch (_) {}
    await db.run(
      'INSERT INTO crash_log (message, stack, app_version) VALUES (?, ?, ?)',
      [message, stack, appVersion]
    );
    await db.close();
  } catch (err) {
    // Last resort — we cannot do anything if the DB itself is unavailable here
    console.error('[ProcessGuardian] Failed to write crash_log entry:', err);
  }
}

/**
 * Registers process-level uncaught exception / unhandled rejection handlers.
 *
 * On catch:
 *  1. Logs the error to console (matching existing style).
 *  2. Writes a row to crash_log table for diagnostics.
 *  3. Calls process.exit(1) so the OS-level watchdog can restart the app.
 *
 * NOTE: This deliberately does NOT try to keep the process alive after an
 * uncaught exception. Exiting cleanly and relying on the external watchdog is
 * more reliable than limping on in an unknown state.
 */
export function registerProcessGuardian(): void {
  const isProductionOrPkg = process.env.NODE_ENV === 'production' || typeof (process as any).pkg !== 'undefined';
  if (!isProductionOrPkg) {
    // ponytail: skip registration in dev mode
    console.log('[ProcessGuardian] Development mode detected: Bypassing registration.');
    return;
  }

  process.on('uncaughtException', async (error: Error) => {
    console.error('[ProcessGuardian] CRITICAL — Uncaught Exception:', error);
    await writeCrashLog(error.message || 'Unknown error', error.stack || '');
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? (reason.stack || '') : '';
    console.error('[ProcessGuardian] CRITICAL — Unhandled Rejection:', reason);
    await writeCrashLog(message, stack);
    process.exit(1);
  });

  console.log('[ProcessGuardian] Registered — uncaught exceptions will log to crash_log and exit(1).');
}
