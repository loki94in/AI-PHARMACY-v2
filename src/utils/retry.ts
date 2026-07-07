/**
 * withRetry — retries a function that signals failure by returning null.
 *
 * OpenFdaClient and similar API clients swallow all internal errors and return
 * null on any failure (timeout, HTTP error, empty result, 429 cooldown, etc.)
 * rather than throwing.  A normal "retry on exception" wrapper would never
 * actually fire for them, so we retry on a null result instead.
 *
 * @param fn       - Async function to call; must return T on success or null on failure.
 * @param opts.retries  - Extra attempts after the first try (default 2 → 3 total calls).
 * @param opts.delayMs  - Base delay in ms; linearly scaled by attempt number (default 400).
 * @param opts.label    - Optional name logged on each retry for easy tracing.
 */
export async function withRetry<T>(
  fn: () => Promise<T | null>,
  opts: { retries?: number; delayMs?: number; label?: string } = {}
): Promise<T | null> {
  const { retries = 2, delayMs = 400, label = 'withRetry' } = opts;
  const totalAttempts = retries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const result = await fn();
    if (result !== null) return result;

    if (attempt < totalAttempts) {
      const wait = delayMs * attempt;
      console.log(`[${label}] Attempt ${attempt}/${totalAttempts} returned null. Retrying in ${wait}ms…`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }

  console.log(`[${label}] All ${totalAttempts} attempts returned null. Giving up.`);
  return null;
}
