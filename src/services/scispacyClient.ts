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

export function startScispacySidecar() {
  if (process.env.SCISPAXY_ENABLED !== 'true' && process.env.SCISPACY_ENABLED !== 'true') {
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
  if (process.env.SCISPAXY_ENABLED !== 'true' && process.env.SCISPACY_ENABLED !== 'true') {
    return null;
  }

  const url = process.env.SCISPACY_URL || 'http://localhost:8001/extract';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(1500),
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
