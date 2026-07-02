import dns from 'dns';

/**
 * Checks if the system has internet connectivity.
 * Performs a DNS lookup on api.fda.gov with a short timeout.
 */
export async function checkConnectivity(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, 3000); // 3-second timeout

    dns.lookup('api.fda.gov', (err) => {
      clearTimeout(timer);
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}
