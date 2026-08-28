import dns from 'dns';

let cachedStatus: boolean | null = null;
let lastCheckTime = 0;
let checkInFlight: Promise<boolean> | null = null;

/**
 * Checks if the system has internet connectivity.
 * Uses a single in-flight promise and caches results (10s when online, 5s when offline)
 * to avoid duplicate DNS probes across concurrent background tasks.
 */
export async function checkConnectivity(force = false): Promise<boolean> {
  const now = Date.now();
  const cacheTtl = cachedStatus ? 10_000 : 5_000;

  if (!force && cachedStatus !== null && (now - lastCheckTime) < cacheTtl) {
    return cachedStatus;
  }

  if (checkInFlight) {
    return checkInFlight;
  }

  checkInFlight = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, 2000); // 2-second timeout

    // Try Google Public DNS / Cloudflare DNS resolution
    dns.lookup('1.1.1.1', (err) => {
      if (!err) {
        clearTimeout(timer);
        resolve(true);
        return;
      }
      dns.lookup('google.com', (err2) => {
        clearTimeout(timer);
        resolve(!err2);
      });
    });
  }).then((status) => {
    cachedStatus = status;
    lastCheckTime = Date.now();
    checkInFlight = null;
    return status;
  });

  return checkInFlight;
}

export function isCurrentlyOnline(): boolean {
  return cachedStatus !== false; // Default optimistic true until proven offline
}

