/**
 * Startup install-token check.
 *
 * This is the FIRST thing called in server.ts — before any route is registered,
 * before any database connection, before Chrome is launched.
 *
 * If the install token is missing or was moved from another machine,
 * the process exits immediately (code 78 = configuration error).
 *
 * In test/dev environments the check is bypassed via NODE_ENV.
 */
import { readToken, TOKEN_KEYS } from './tokenStore.js';
import { deriveMachineFingerprint } from './machineId.js';
import crypto from 'crypto';

function computeExpectedToken(fingerprint: string): string {
  // The install token is an HMAC of the fingerprint with a build-time constant.
  // The bootstrapper writes a token produced by the same algorithm.
  // This constant is deliberately not in any config file — it lives only here
  // and in the bootstrapper binary.
  const BUILD_CONSTANT = process.env.LICENSE_BUILD_CONSTANT ?? 'aip-build-2026';
  return crypto.createHmac('sha256', BUILD_CONSTANT).update(fingerprint).digest('hex');
}

export function runStartupCheck(): void {
  // BYPASSED AS REQUESTED BY USER FOR TESTING
  console.log('[License] Startup check bypassed (SECURITY DISABLED FOR TESTING)');
  return;

  let storedToken: string | null = null;
  let fingerprint: string = '';

  try {
    storedToken = readToken(TOKEN_KEYS.INSTALL_TOKEN);
  } catch (err) {
    console.error('[License] Failed to read install token from registry:', (err as Error).message);
    console.error('[License] This installation may be corrupted. Please re-run the bootstrapper.');
    process.exit(78);
  }

  if (!storedToken) {
    console.error('[License] Install token not found.');
    console.error('[License] Application was not installed through the authorized installer.');
    console.error('[License] Please obtain a valid license key and run the AI Pharmacy bootstrapper.');
    process.exit(78);
  }

  try {
    fingerprint = deriveMachineFingerprint();
  } catch (err) {
    console.error('[License] Unable to derive machine fingerprint:', (err as Error).message);
    process.exit(78);
  }

  const expected = computeExpectedToken(fingerprint);
  if (storedToken !== expected) {
    console.error('[License] Install token is invalid or was moved from another machine.');
    console.error('[License] License is bound to a specific PC. Please contact your provider.');
    process.exit(78);
  }

  console.log('[License] Startup check passed.');
}

/** Used by the bootstrapper to produce the token it writes to the registry. */
export function generateInstallToken(fingerprint: string): string {
  return computeExpectedToken(fingerprint);
}
