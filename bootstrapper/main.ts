/**
 * AI Pharmacy OS — Bootstrapper
 *
 * This is the ONLY thing you send to customers.
 * PharmacyOS.exe is never distributed directly.
 *
 * Flow:
 *   1. Prompts for license key
 *   2. Derives machine fingerprint
 *   3. Calls GAS license server — activate endpoint
 *   4. Downloads PharmacyOS.exe from Google Drive URL returned by server
 *   5. Installs to %ProgramFiles%\AI Pharmacy OS\
 *   6. Writes DPAPI-encrypted install token to Windows Registry
 *   7. Launches the installed app
 *
 * Build: cd bootstrapper && npm run build
 * Output: dist/AIPharmacySetup.exe
 */
import { execSync, exec } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import https from 'https';
import http from 'http';

// ── Config ───────────────────────────────────────────────────────────────────

const GAS_URL           = process.env.LICENSE_SERVER_URL ?? 'YOUR_GAS_URL_HERE';
const BUILD_CONSTANT    = process.env.LICENSE_BUILD_CONSTANT ?? 'aip-build-2026';
const INSTALL_DIR       = path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'AI Pharmacy OS');
const REG_KEY           = 'HKCU\\Software\\AIPharmacyOS';
const APP_EXE_NAME      = 'PharmacyOS.exe';

// ── Machine fingerprint (same algorithm as src/license/machineId.ts) ─────────

function runCmd(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch { return ''; }
}

function getMachineFingerprint(): string {
  const guid = (() => {
    const raw = runCmd('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid');
    const m = raw.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/);
    return m ? m[1].trim() : '';
  })();

  const serial = runCmd('wmic logicaldisk where "DeviceID=\'C:\'" get VolumeSerialNumber')
    .split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() ?? '';

  const uuid = (() => {
    const u = runCmd('wmic csproduct get UUID').split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() ?? '';
    return (u && u !== 'UUID' && !u.includes('FFFFFFFF')) ? u : runCmd('wmic baseboard get SerialNumber').split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() ?? '';
  })();

  return crypto.createHash('sha256').update(`${guid}|${serial}|${uuid}`).digest('hex');
}

// ── DPAPI token write (same algorithm as src/license/tokenStore.ts) ──────────

function dpapiEncrypt(plaintext: string): string {
  const escaped = plaintext.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$b = [System.Text.Encoding]::UTF8.GetBytes('${escaped}')`,
    '$e = [System.Security.Cryptography.ProtectedData]::Protect($b,$null,"CurrentUser")',
    '[Convert]::ToBase64String($e)',
  ].join(';');
  return execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, { encoding: 'utf8', timeout: 10000 }).trim();
}

function writeRegistry(valueName: string, data: string): void {
  execSync(`reg add "${REG_KEY}" /v "${valueName}" /t REG_SZ /d "${data.replace(/"/g, '\\"')}" /f`, { timeout: 5000 });
}

// ── Download helper ───────────────────────────────────────────────────────────

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);

    function get(u: string): void {
      protocol.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          get(res.headers.location); // follow redirect (Google Drive)
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
    }

    get(url);
  });
}

// ── User input ────────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     AI Pharmacy OS — Setup & Activation  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const licenseKey = (await prompt('Enter your license key (AIPH-XXXX-XXXX-XXXX): ')).toUpperCase();

  if (!licenseKey.match(/^AIPH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    console.error('\n✗ Invalid license key format. Expected: AIPH-XXXX-XXXX-XXXX');
    process.exit(1);
  }

  console.log('\n→ Deriving machine fingerprint…');
  const fingerprint = getMachineFingerprint();

  console.log('→ Contacting license server…');

  const params = new URLSearchParams({ action: 'activate', key: licenseKey, fingerprint });
  let serverData: { valid: boolean; downloadUrl?: string; nonce?: string; expiry?: string; sessionToken?: string; message?: string };

  try {
    const res = await fetch(`${GAS_URL}?${params}`, { signal: AbortSignal.timeout(20000) });
    serverData = await res.json() as typeof serverData;
  } catch (err) {
    console.error('\n✗ Cannot reach license server. Check your internet connection.');
    process.exit(1);
  }

  if (!serverData.valid) {
    console.error(`\n✗ License validation failed: ${serverData.message}`);
    process.exit(1);
  }

  console.log('✓ License key accepted.');

  // ── Download ────────────────────────────────────────────────────────────────
  const downloadUrl = serverData.downloadUrl ?? '';
  if (!downloadUrl) {
    console.error('\n✗ Server did not return a download URL. Contact your provider.');
    process.exit(1);
  }

  const tempPath = path.join(process.env.TEMP ?? 'C:\\Temp', APP_EXE_NAME);
  console.log(`\n→ Downloading AI Pharmacy OS…`);

  try {
    await downloadFile(downloadUrl, tempPath);
  } catch (err) {
    console.error('\n✗ Download failed:', (err as Error).message);
    process.exit(1);
  }

  console.log('✓ Download complete.');

  // ── Install ─────────────────────────────────────────────────────────────────
  console.log(`\n→ Installing to ${INSTALL_DIR}…`);
  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  const installPath = path.join(INSTALL_DIR, APP_EXE_NAME);
  fs.copyFileSync(tempPath, installPath);
  fs.unlinkSync(tempPath);

  // ── Write DPAPI install token to registry ───────────────────────────────────
  console.log('→ Writing license credentials…');

  const installToken = crypto.createHmac('sha256', BUILD_CONSTANT).update(fingerprint).digest('hex');
  const encryptedInstallToken = dpapiEncrypt(installToken);
  writeRegistry('InstallToken', encryptedInstallToken);

  const encryptedSessionToken = dpapiEncrypt(serverData.sessionToken ?? '');
  writeRegistry('SessionToken', encryptedSessionToken);

  const encryptedKey = dpapiEncrypt(licenseKey);
  writeRegistry('LicenseKey', encryptedKey);

  console.log('✓ License credentials stored (DPAPI-encrypted, machine-bound).');

  // ── Create desktop shortcut ─────────────────────────────────────────────────
  const desktopPath = path.join(process.env.USERPROFILE ?? 'C:\\Users\\Default', 'Desktop', 'AI Pharmacy OS.lnk');
  try {
    const shortcutScript = `$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${desktopPath.replace(/'/g, "''")}'); $s.TargetPath = '${installPath.replace(/'/g, "''")}'; $s.Save()`;
    execSync(`powershell -NoProfile -NonInteractive -Command "${shortcutScript}"`, { timeout: 5000 });
    console.log('✓ Desktop shortcut created.');
  } catch {
    // Non-fatal
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  ✓  AI Pharmacy OS activated & installed  ║');
  console.log(`║     License expires: ${(serverData.expiry ?? 'N/A').slice(0, 10).padEnd(18)}     ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('→ Launching AI Pharmacy OS…\n');

  exec(`"${installPath}"`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ Unexpected error:', err.message);
  process.exit(1);
});
