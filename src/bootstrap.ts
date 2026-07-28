/**
 * Single entry point for the whole app, including its background workers.
 *
 * Packaged as a single executable (Node SEA), there is no separate script
 * file to fork for the catalog worker / email poller — the exe only knows
 * how to run its one embedded main script. So workerSupervisor forks *this
 * same app* with a WORKER_ROLE env var, and this file dispatches to the
 * right entry point instead of always starting the HTTP server.
 */

async function main() {
  const role = process.env.WORKER_ROLE;

  if (role === 'catalog') {
    const { startWorker } = await import('./worker/catalogWorker.js');
    console.log('[CatalogWorker Runner] Background catalog worker initialized.');
    startWorker().catch((err) => {
      console.error('[CatalogWorker Runner] Fatal error during execution:', err);
      process.exit(1);
    });
    process.on('message', (msg: any) => {
      if (msg && msg.type === 'PING') process.send?.({ type: 'PONG' });
    });
    process.on('disconnect', () => {
      console.log('[CatalogWorker Runner] Supervisor disconnected. Exiting...');
      process.exit(0);
    });
    return;
  }

  if (role === 'email') {
    const { startEmailPoller } = await import('./worker/emailPoller.js');
    console.log('[EmailPoller Runner] Background email poller initialized.');
    try {
      startEmailPoller();
    } catch (err) {
      console.error('[EmailPoller Runner] Fatal error during initialization:', err);
      process.exit(1);
    }
    process.on('message', (msg: any) => {
      if (msg && msg.type === 'PING') process.send?.({ type: 'PONG' });
    });
    process.on('disconnect', () => {
      console.log('[EmailPoller Runner] Supervisor disconnected. Exiting...');
      process.exit(0);
    });
    return;
  }

  await import('./server.js');
}

main();
