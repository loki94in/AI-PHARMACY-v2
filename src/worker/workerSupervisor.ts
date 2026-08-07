import { fork, ChildProcess } from 'child_process';
import { isPackagedApp } from '../config/index.js';

interface WorkerConfig {
  name: string;
  role: 'catalog' | 'email';
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
      role: 'catalog',
      restartCount: 0,
    },
    email: {
      name: 'Email Poller',
      role: 'email',
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
    if (process.env.DISABLE_BACKGROUND_WORKERS !== 'false') {
      console.log('[WorkerSupervisor] ALL background workers are STOPPED and DISABLED.');
      this.stop();
      return;
    }

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

    // Packaged as a single executable, there's no separate worker script file to fork —
    // fork this same app (or, in dev, the same entry script) and let it dispatch on
    // WORKER_ROLE instead of starting the HTTP server. See src/bootstrap.ts.
    const forkTarget = isPackagedApp() ? process.execPath : process.argv[1];

    console.log(`[WorkerSupervisor] Spawning ${config.name} (role: ${config.role})...`);
    config.spawnTime = Date.now();
    config.lastPongTime = Date.now();

    if (process.env.SINGLE_PROCESS_WORKERS === 'true') {
      console.log(`[WorkerSupervisor] Running ${config.name} in-process (Low-RAM Single Process mode)...`);
      if (config.role === 'catalog') {
        import('./catalogWorker.js').then(m => {
          if (m.startWorker) m.startWorker();
        }).catch(err => console.error('[WorkerSupervisor] Inline catalog worker error:', err));
      } else if (config.role === 'email') {
        import('./emailPoller.js').then(m => {
          if (m.startEmailPoller) m.startEmailPoller();
        }).catch(err => console.error('[WorkerSupervisor] Inline email poller error:', err));
      }
      return;
    }

    try {
      // Fork the child process inheriting environment and execution loaders (tsx etc.)
      const child = fork(forkTarget, [], {
        execArgv: [...process.execArgv],
        env: { ...process.env, IS_WORKER: 'true', WORKER_ROLE: config.role },
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
    // Perform initial health check heartbeat scan on BOOT
    const now = Date.now();
    for (const [key, config] of Object.entries(this.workers)) {
      if (!config.instance) continue;
      try {
        config.instance.send({ type: 'PING' });
      } catch (err) {
        console.error(`[WorkerSupervisor] Failed to send PING to ${config.name}:`, err);
      }
    }
  }
}

export const workerSupervisor = WorkerSupervisor.getInstance();
