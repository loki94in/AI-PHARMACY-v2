import { startWorker } from './catalogWorker.js';

console.log('[CatalogWorker Runner] Background catalog worker initialized.');

startWorker().catch((err) => {
  console.error('[CatalogWorker Runner] Fatal error during execution:', err);
  process.exit(1);
});

// IPC Heartbeat listener
process.on('message', (msg: any) => {
  if (msg && msg.type === 'PING') {
    process.send?.({ type: 'PONG' });
  }
});

// Graceful exit if parent terminates or disconnects
process.on('disconnect', () => {
  console.log('[CatalogWorker Runner] Supervisor disconnected. Exiting...');
  process.exit(0);
});
