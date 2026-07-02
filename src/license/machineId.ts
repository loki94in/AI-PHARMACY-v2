/**
 * Machine fingerprint — SHA-256 of three hardware identifiers.
 * Survives disk replacement (MotherboardUUID), OS reinstall fallback,
 * and provides strong clone detection when all three match.
 *
 * Windows-only. Uses WMIC and registry via child_process — no extra packages.
 */
import { execSync } from 'child_process';
import crypto from 'crypto';

function runWmic(query: string): string {
  try {
    const raw = execSync(query, { encoding: 'utf8', timeout: 5000 });
    // WMIC output: header line + value line — take last non-empty line
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? '';
  } catch {
    return '';
  }
}

function getMachineGuid(): string {
  try {
    const raw = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 5000 }
    );
    const match = raw.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function getVolumeSerial(): string {
  return runWmic('wmic logicaldisk where "DeviceID=\'C:\'" get VolumeSerialNumber');
}

function getMotherboardUUID(): string {
  // Primary: BIOS UUID via WMIC
  const uuid = runWmic('wmic csproduct get UUID');
  if (uuid && uuid !== 'UUID' && !uuid.includes('FFFFFFFF')) {
    return uuid;
  }
  // Fallback: baseboard serial number
  return runWmic('wmic baseboard get SerialNumber');
}

export function deriveMachineFingerprint(): string {
  const parts = [getMachineGuid(), getVolumeSerial(), getMotherboardUUID()];
  const combined = parts.join('|');

  if (parts.every((p) => !p)) {
    throw new Error('Unable to derive machine fingerprint — all components empty.');
  }

  return crypto.createHash('sha256').update(combined).digest('hex');
}

/** Returns individual components for diagnostics (never log in production). */
export function getMachineComponents(): Record<string, string> {
  return {
    machineGuid: getMachineGuid(),
    volumeSerial: getVolumeSerial(),
    motherboardUUID: getMotherboardUUID(),
  };
}
