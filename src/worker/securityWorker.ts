/**
 * Deferred security worker — downloads and runs 14 days after install.
 *
 * This file exists in the codebase but contains no enforcement logic itself.
 * The actual enforcement module is downloaded from the GAS server after the
 * delay, so day-1 inspection of the app reveals nothing to patch.
 *
 * The downloaded module validates:
 *   - Motherboard UUID matches the registered fingerprint
 *   - License key is still active
 *   - Sets license_revoked=true in SQLite if validation fails
 *
 * Registered in server.ts via the daily cron scheduler.
 */
import { dbManager } from '../database/connection.js';
import { deriveMachineFingerprint } from '../license/machineId.js';
import { readToken, TOKEN_KEYS } from '../license/tokenStore.js';

const GAS_URL = process.env.LICENSE_SERVER_URL ?? '';
const DEFERRED_DELAY_DAYS = 14;

async function getSetting(
  db: Awaited<ReturnType<typeof dbManager.getConnection>>,
  key: string
): Promise<string | null> {
  const row = await db.get<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

async function setSetting(
  db: Awaited<ReturnType<typeof dbManager.getConnection>>,
  key: string,
  value: string
): Promise<void> {
  await db.run(
    `INSERT INTO app_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - Date.parse(isoDate)) / (1000 * 60 * 60 * 24));
}

export async function runDeferredSecurityCheck(): Promise<void> {
  if (!GAS_URL) return;

  let db: Awaited<ReturnType<typeof dbManager.getConnection>> | null = null;

  try {
    db = await dbManager.getConnection();

    const installDate = await getSetting(db, 'license_install_date');
    if (!installDate) return; // Not yet activated

    // Only run after the deferred delay
    if (daysSince(installDate) < DEFERRED_DELAY_DAYS) {
      return;
    }

    const licenseKey = readToken(TOKEN_KEYS.LICENSE_KEY);
    if (!licenseKey) return;

    const fingerprint = deriveMachineFingerprint();

    const params = new URLSearchParams({
      action: 'status',
      key: licenseKey,
      fingerprint,
    });

    const response = await fetch(`${GAS_URL}?${params}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return; // Offline — do not revoke

    const data = await response.json() as { valid: boolean; message?: string };

    if (!data.valid) {
      console.warn('[SecurityWorker] Deferred check failed:', data.message);
      await setSetting(db, 'license_revoked', 'true');
    } else {
      console.log('[SecurityWorker] Deferred security check passed.');
    }
  } catch {
    // Network error — do not revoke, grace period handles it
  }
}
