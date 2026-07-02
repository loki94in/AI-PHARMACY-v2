/**
 * Daily license check — pings the Google Apps Script license server,
 * validates the response, rotates the nonce, and updates SQLite.
 *
 * Called:
 *   - Once on startup (if internet available)
 *   - Daily via node-cron
 *
 * Offline behaviour: silently fails; grace period in gracePolicy.ts handles it.
 */
import crypto from 'crypto';
import { dbManager } from '../database/connection.js';
import { deriveMachineFingerprint } from './machineId.js';
import { readToken, TOKEN_KEYS } from './tokenStore.js';

// Set this to your deployed GAS Web App URL
const GAS_URL = process.env.LICENSE_SERVER_URL ?? '';

interface GASResponse {
  valid: boolean;
  nonce?: string;
  expiry?: string;
  message?: string;
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

export async function performLicenseCheck(): Promise<boolean> {
  if (!GAS_URL) {
    console.warn('[License] LICENSE_SERVER_URL not set — skipping check.');
    return false;
  }

  let db: Awaited<ReturnType<typeof dbManager.getConnection>> | null = null;

  try {
    db = await dbManager.getConnection();

    const licenseKey = readToken(TOKEN_KEYS.LICENSE_KEY);
    if (!licenseKey) {
      console.warn('[License] No license key in token store — check skipped.');
      return false;
    }

    const fingerprint = deriveMachineFingerprint();
    const currentNonce = await getSetting(db, 'license_current_nonce') ?? '';

    const params = new URLSearchParams({
      action: 'heartbeat',
      key: licenseKey,
      fingerprint,
      nonce: currentNonce,
    });

    const response = await fetch(`${GAS_URL}?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      console.warn(`[License] Server responded ${response.status} — grace period continues.`);
      return false;
    }

    const data: GASResponse = await response.json();

    if (!data.valid) {
      console.warn(`[License] Server rejected: ${data.message}`);
      // Mark as revoked — grace period will handle enforcement
      await setSetting(db, 'license_revoked', 'true');
      return false;
    }

    // Success — rotate nonce and refresh timestamps
    const newNonce = data.nonce ?? crypto.randomUUID();
    await setSetting(db, 'license_current_nonce', newNonce);
    await setSetting(db, 'license_last_validated', new Date().toISOString());
    if (data.expiry) {
      await setSetting(db, 'license_expiry', data.expiry);
    }
    await setSetting(db, 'license_revoked', 'false');

    console.log('[License] Daily check passed. Next check in 24 hours.');
    return true;
  } catch (err) {
    // Network error — offline, grace period continues silently
    console.warn('[License] Check failed (offline?):', (err as Error).message);
    return false;
  }
}

/** Called after successful activation to store initial server-issued values. */
export async function storeActivationResult(params: {
  licenseKey: string;
  nonce: string;
  expiry: string;
  sessionToken: string;
}): Promise<void> {
  const db = await dbManager.getConnection();
  await setSetting(db, 'license_current_nonce', params.nonce);
  await setSetting(db, 'license_last_validated', new Date().toISOString());
  await setSetting(db, 'license_expiry', params.expiry);
  await setSetting(db, 'license_install_date', new Date().toISOString());
  await setSetting(db, 'license_revoked', 'false');
  await setSetting(db, 'license_session_token', params.sessionToken);
  await setSetting(db, 'license_key', params.licenseKey);
}
