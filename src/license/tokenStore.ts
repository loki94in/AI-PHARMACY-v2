/**
 * DPAPI-backed token store using Windows PowerShell and the Registry.
 *
 * Encryption scope: CurrentUser — the encrypted blob is mathematically
 * unreadable on any other Windows user account or machine.
 *
 * Storage: HKCU\Software\AIPharmacyOS  (no admin rights required)
 *
 * Windows-only. No extra npm packages.
 */
import { execSync } from 'child_process';

const REG_KEY = 'HKCU\\Software\\AIPharmacyOS';

// ── DPAPI helpers (PowerShell) ──────────────────────────────────────────────

function dpapiEncrypt(plaintext: string): string {
  const escaped = plaintext.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$b = [System.Text.Encoding]::UTF8.GetBytes('${escaped}')`,
    '$e = [System.Security.Cryptography.ProtectedData]::Protect($b,$null,"CurrentUser")',
    '[Convert]::ToBase64String($e)',
  ].join(';');

  return execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
    encoding: 'utf8',
    timeout: 10000,
  }).trim();
}

function dpapiDecrypt(base64: string): string {
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$e = [Convert]::FromBase64String('${base64}')`,
    '$b = [System.Security.Cryptography.ProtectedData]::Unprotect($e,$null,"CurrentUser")',
    '[System.Text.Encoding]::UTF8.GetString($b)',
  ].join(';');

  return execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
    encoding: 'utf8',
    timeout: 10000,
  }).trim();
}

// ── Registry helpers ────────────────────────────────────────────────────────

function regWrite(valueName: string, data: string): void {
  execSync(
    `reg add "${REG_KEY}" /v "${valueName}" /t REG_SZ /d "${data.replace(/"/g, '\\"')}" /f`,
    { encoding: 'utf8', timeout: 5000 }
  );
}

function regRead(valueName: string): string | null {
  try {
    const raw = execSync(
      `reg query "${REG_KEY}" /v "${valueName}"`,
      { encoding: 'utf8', timeout: 5000 }
    );
    const match = raw.match(new RegExp(`${valueName}\\s+REG_SZ\\s+([^\\r\\n]+)`));
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function regDelete(valueName: string): void {
  try {
    execSync(`reg delete "${REG_KEY}" /v "${valueName}" /f`, {
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch {
    // Value may not exist — ignore
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Write a value encrypted with DPAPI into the Windows Registry. */
export function writeToken(valueName: string, plaintext: string): void {
  const encrypted = dpapiEncrypt(plaintext);
  regWrite(valueName, encrypted);
}

/** Read and decrypt a DPAPI-protected value from the Windows Registry. */
export function readToken(valueName: string): string | null {
  const encrypted = regRead(valueName);
  if (!encrypted) return null;
  try {
    return dpapiDecrypt(encrypted);
  } catch {
    // Decryption fails on wrong machine/user — token is invalid
    return null;
  }
}

/** Remove a token from the Registry. */
export function deleteToken(valueName: string): void {
  regDelete(valueName);
}

/** Named token keys — centralise names to avoid typos. */
export const TOKEN_KEYS = {
  INSTALL_TOKEN: 'InstallToken',
  SESSION_TOKEN: 'SessionToken',
  LICENSE_KEY: 'LicenseKey',
} as const;
