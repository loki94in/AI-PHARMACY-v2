/**
 * Grace period policy — determines the current license enforcement mode
 * based on how long ago the last successful server validation occurred.
 *
 * Stages:
 *   0 – 14 days  → FULL    (full read + write access)
 *  15 – 30 days  → WARNING (full access + persistent banner)
 *  31+   days    → READONLY (all write operations blocked at middleware)
 */
import { dbManager } from '../database/connection.js';

export type LicenseMode = 'FULL' | 'WARNING' | 'READONLY' | 'UNLICENSED';

export interface LicenseState {
  mode: LicenseMode;
  daysSinceValidation: number | null;
  expiryDate: string | null;
  licenseKey: string | null;
  isExpired: boolean;
}

const GRACE_WARNING_DAYS = 14;  // warn after this many days offline
const GRACE_READONLY_DAYS = 30; // read-only after this many days offline

function daysBetween(isoA: string, isoB: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((Date.parse(isoB) - Date.parse(isoA)) / msPerDay);
}

async function getSetting(db: Awaited<ReturnType<typeof dbManager.getConnection>>, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

export async function getLicenseState(): Promise<LicenseState> {
  let db: Awaited<ReturnType<typeof dbManager.getConnection>> | null = null;
  try {
    db = await dbManager.getConnection();

    const lastValidated = await getSetting(db, 'license_last_validated');
    const expiryDate = await getSetting(db, 'license_expiry');
    const licenseKey = await getSetting(db, 'license_key');

    // Not yet activated
    if (!lastValidated || !licenseKey) {
      return { mode: 'UNLICENSED', daysSinceValidation: null, expiryDate, licenseKey, isExpired: false };
    }

    const now = new Date().toISOString();
    const daysSinceValidation = daysBetween(lastValidated, now);

    // Check hard expiry (server-set date)
    const isExpired = expiryDate ? Date.parse(now) > Date.parse(expiryDate) : false;

    if (isExpired || daysSinceValidation > GRACE_READONLY_DAYS) {
      return { mode: 'READONLY', daysSinceValidation, expiryDate, licenseKey, isExpired };
    }

    if (daysSinceValidation > GRACE_WARNING_DAYS) {
      return { mode: 'WARNING', daysSinceValidation, expiryDate, licenseKey, isExpired };
    }

    return { mode: 'FULL', daysSinceValidation, expiryDate, licenseKey, isExpired };
  } finally {
    // Connection managed externally in this project — do not close here
  }
}
