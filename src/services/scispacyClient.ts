import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

export interface ScispacyEntity {
  label: string; // e.g. "CHEMICAL"
  text: string;  // e.g. "Azithromycin"
}

export interface ScispacyResponse {
  entities: ScispacyEntity[];
  features?: {
    drug?: string[];
    dose?: string[];
    form?: string[];
    org?: string[];
  };
}

let sidecarProcess: ChildProcess | null = null;

export function startScispacySidecar(force = false) {
  const isEnabled = process.env.SCISPAXY_ENABLED === 'true' || process.env.SCISPACY_ENABLED === 'true';
  const isAutoStart = process.env.SCISPACY_AUTOSTART === 'true';

  if (!isEnabled && !force) {
    return;
  }

  // If enabled but autostart is false, log lazy-loading deferral
  if (isEnabled && !isAutoStart && !force) {
    console.log('[scispaCy] Lazy-loading enabled: Python sidecar deferred until prescription scanner request.');
    return;
  }

  if (sidecarProcess) return;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const pythonScript = path.resolve(__dirname, '..', '..', 'python', 'scan_nlp', 'main.py');
  
  // Resolve isolated virtual environment Python executable if it exists
  const projectRoot = path.resolve(__dirname, '..', '..');
  const venvPythonWin = path.join(projectRoot, 'python', 'scan_nlp', '.venv', 'Scripts', 'python.exe');
  const venvPythonPosix = path.join(projectRoot, 'python', 'scan_nlp', '.venv', 'bin', 'python');
  
  let pythonCmd = 'python';
  if (fs.existsSync(venvPythonWin)) {
    pythonCmd = venvPythonWin;
  } else if (fs.existsSync(venvPythonPosix)) {
    pythonCmd = venvPythonPosix;
  }

  console.log(`[scispaCy] Starting Python sidecar: ${pythonCmd} ${pythonScript}...`);
  
  // Spawn python process
  sidecarProcess = spawn(pythonCmd, [pythonScript], {
    stdio: 'inherit',
    env: { ...process.env }
  });

  sidecarProcess.on('error', (err) => {
    console.error('[scispaCy] Failed to start Python sidecar. Make sure python is in PATH and dependencies are installed.', err);
  });

  sidecarProcess.on('exit', (code, signal) => {
    console.log(`[scispaCy] Python sidecar exited with code ${code} and signal ${signal}`);
    sidecarProcess = null;
  });

  // Ensure child process is killed when parent exits
  process.on('exit', () => {
    if (sidecarProcess) {
      sidecarProcess.kill();
    }
  });
}

export function stopScispacySidecar() {
  if (sidecarProcess) {
    sidecarProcess.kill();
    sidecarProcess = null;
  }
}

export async function queryScispacy(text: string): Promise<ScispacyResponse | null> {
  const isEnabled = process.env.SCISPAXY_ENABLED === 'true' || process.env.SCISPACY_ENABLED === 'true';
  if (!isEnabled) {
    return null;
  }

  // Lazy-load sidecar process on first query if not running
  if (!sidecarProcess) {
    startScispacySidecar(true);
    // Allow brief time for fast sidecar readiness if spawned on-demand
    await new Promise(r => setTimeout(r, 1500));
  }

  const url = process.env.SCISPACY_URL || 'http://localhost:8001/extract';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data as ScispacyResponse;
  } catch (err) {
    // Timeout or fetch error — fail silently and return null
    return null;
  }
}
