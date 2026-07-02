import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect if we are running in TypeScript or JavaScript source
const isTs = __filename.endsWith('.ts');
const ext = isTs ? '.ts' : '.js';

interface WorkerConfig {
  name: string;
  scriptPath: string;
  instance?: ChildProcess;
  restartCount: number;
  lastPongTime?: number;
  spawnTime?: number;
}

export class WorkerSupervisor {
  private static instance: WorkerSupervisor;
  private workers: Record<string, WorkerConfig> = {
    catalog: {
      name: 'Catalog Worker',
      scriptPath: path.resolve(__dirname, `runCatalogWorker${ext}`),
      restartCount: 0,
    },
    email: {
      name: 'Email Poller',
      scriptPath: path.resolve(__dirname, `runEmailPoller${ext}`),
      restartCount: 0,
    },
  };
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): WorkerSupervisor {
    if (!WorkerSupervisor.instance) {
      WorkerSupervisor.instance = new WorkerSupervisor();
    }
    return WorkerSupervisor.instance;
  }

  /** Starts all configured background workers */
  public start(): void {
    console.log('[WorkerSupervisor] Starting background worker supervisor...');
    for (const key of Object.keys(this.workers)) {
      this.spawnWorker(key);
    }
    this.startHealthCheckLoop();
  }

  /** Gracefully stops all workers and loops */
  public stop(): void {
    console.log('[WorkerSupervisor] Stopping background workers...');
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    for (const [key, config] of Object.entries(this.workers)) {
      if (config.instance) {
        config.instance.removeAllListeners('exit');
        config.instance.kill('SIGTERM');
        config.instance = undefined;
        console.log(`[WorkerSupervisor] Terminated ${config.name}.`);
      }
    }
  }

  private spawnWorker(key: string): void {
    const config = this.workers[key];
    if (config.instance) return;

    console.log(`[WorkerSupervisor] Spawning ${config.name} (Script: ${config.scriptPath})...`);
    config.spawnTime = Date.now();
    config.lastPongTime = Date.now();

    try {
      // Fork the child process inheriting environment and execution loaders (tsx etc.)
      const child = fork(config.scriptPath, [], {
        execArgv: [...process.execArgv],
        env: { ...process.env, IS_WORKER: 'true' },
      });

      config.instance = child;

      // Handle message from child (heartbeat pongs)
      child.on('message', (msg: any) => {
        if (msg && msg.type === 'PONG') {
          config.lastPongTime = Date.now();
        }
      });

      // Handle child exit
      child.on('exit', (code, signal) => {
        console.warn(`[WorkerSupervisor] ${config.name} exited. Code: ${code}, Signal: ${signal}`);
        config.instance = undefined;

        const runDuration = Date.now() - (config.spawnTime || 0);

        // If the process ran stably for more than 30 seconds, reset restart count back to 0
        if (runDuration > 30000) {
          config.restartCount = 0;
        }

        // Increment restart count and apply cooling delay backoff
        if (config.restartCount < 5) {
          config.restartCount++;
          const delayMs = config.restartCount * 3000; // 3s, 6s, 9s, 12s, 15s delay
          console.log(`[WorkerSupervisor] Restarting ${config.name} in ${delayMs / 1000} seconds...`);
          setTimeout(() => this.spawnWorker(key), delayMs);
        } else {
          console.error(
            `[WorkerSupervisor] ${config.name} failed too many times consecutively. Postponing automatic restart.`
          );
        }
      });

      // Handle error events
      child.on('error', (err) => {
        console.error(`[WorkerSupervisor] Error in ${config.name} process:`, err);
      });

    } catch (spawnErr) {
      console.error(`[WorkerSupervisor] Failed to fork ${config.name}:`, spawnErr);
    }
  }

  private startHealthCheckLoop(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, config] of Object.entries(this.workers)) {
        if (!config.instance) continue;

        // Send PING heartbeat request to the child process
        try {
          config.instance.send({ type: 'PING' });
        } catch (err) {
          console.error(`[WorkerSupervisor] Failed to send PING to ${config.name}:`, err);
        }

        // Check if the worker is unresponsive (missed pongs for over 45 seconds)
        if (config.lastPongTime && now - config.lastPongTime > 45000) {
          console.error(
            `[WorkerSupervisor] ${config.name} is unresponsive (no heartbeat for ${
              (now - config.lastPongTime) / 1000
            }s). Forcefully terminating...`
          );
          try {
            config.instance.kill('SIGKILL'); // Force terminate
          } catch (killErr) {
            console.error(`[WorkerSupervisor] Failed to kill frozen ${config.name}:`, killErr);
          }
        }
      }
    }, 15000); // Verify every 15 seconds
  }
}

export const workerSupervisor = WorkerSupervisor.getInstance();
