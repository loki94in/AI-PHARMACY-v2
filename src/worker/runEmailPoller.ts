import { startEmailPoller } from './emailPoller.js';

console.log('[EmailPoller Runner] Background email poller initialized.');

try {
  startEmailPoller();
} catch (err) {
  console.error('[EmailPoller Runner] Fatal error during initialization:', err);
  process.exit(1);
}

// IPC Heartbeat listener
process.on('message', (msg: any) => {
  if (msg && msg.type === 'PING') {
    process.send?.({ type: 'PONG' });
  }
});

// Graceful exit if parent terminates or disconnects
process.on('disconnect', () => {
  console.log('[EmailPoller Runner] Supervisor disconnected. Exiting...');
  process.exit(0);
});
