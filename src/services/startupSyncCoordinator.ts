/**
 * StartupSyncCoordinator
 *
 * Coordinates startup background scanning with Pharmarack live cart loading.
 * Ensures background scanning waits until the live Pharmarack cart is initialized
 * or until a safety timeout (15s) elapses, preventing false shortage alerts and
 * race conditions with medicines already in the cart.
 */

class StartupSyncCoordinator {
  private cartLoaded: boolean = false;
  private syncPending: boolean = true;
  private startupTime: number = Date.now();
  private maxTimeoutMs: number = 15000;
  private resolveCallbacks: Array<() => void> = [];
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor() {
    // Auto-release after safety timeout (15 seconds) so background scanning is never blocked forever
    this.timeoutHandle = setTimeout(() => {
      if (this.syncPending && !this.cartLoaded) {
        console.log('[StartupSyncCoordinator] 15s startup window elapsed. Releasing background scanners.');
        this.releaseWaiters();
      }
    }, this.maxTimeoutMs);
  }

  /**
   * Called when Pharmarack cart items are successfully loaded or synchronized.
   */
  public markCartLoaded(): void {
    if (!this.cartLoaded) {
      this.cartLoaded = true;
      this.syncPending = false;
      console.log(`[StartupSyncCoordinator] Pharmarack cart loaded successfully in ${Date.now() - this.startupTime}ms. Releasing scanners.`);
      this.releaseWaiters();
    }
  }

  /**
   * Called by background workers (WhatsApp intent scanner, OCR queue, refill scanner)
   * on cold boot to await cart readiness before processing new shortage scans.
   */
  public async waitForCartSync(): Promise<void> {
    if (this.cartLoaded || !this.syncPending) {
      return Promise.resolve();
    }

    // If already past timeout, proceed immediately
    if (Date.now() - this.startupTime >= this.maxTimeoutMs) {
      this.releaseWaiters();
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.resolveCallbacks.push(resolve);
    });
  }

  /**
   * Release all waiting promises.
   */
  private releaseWaiters(): void {
    this.syncPending = false;
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    const callbacks = [...this.resolveCallbacks];
    this.resolveCallbacks = [];
    callbacks.forEach(cb => {
      try {
        cb();
      } catch (err) {
        console.error('[StartupSyncCoordinator] Error in release waiter callback:', err);
      }
    });
  }

  /**
   * Check if cart sync is complete.
   */
  public isReady(): boolean {
    return this.cartLoaded || !this.syncPending;
  }

  /**
   * Get current sync status for UI alerting.
   */
  public getStatus(): { cartLoaded: boolean; syncPending: boolean; elapsedMs: number; timedOut: boolean } {
    const elapsed = Date.now() - this.startupTime;
    const timedOut = !this.cartLoaded && elapsed >= this.maxTimeoutMs;
    return {
      cartLoaded: this.cartLoaded,
      syncPending: this.syncPending && !timedOut,
      elapsedMs: elapsed,
      timedOut
    };
  }
}

export const startupSyncCoordinator = new StartupSyncCoordinator();
