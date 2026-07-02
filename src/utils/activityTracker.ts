import { fileURLToPath } from 'url';

class ActivityTracker {
  private lastActivity: number = 0;
  private idleThresholdMs: number = 30000; // 30 seconds

  public recordActivity(): void {
    this.lastActivity = Date.now();
  }

  public getLastActivity(): number {
    return this.lastActivity;
  }

  public isAppInUse(): boolean {
    return (Date.now() - this.lastActivity) < this.idleThresholdMs;
  }

  /**
   * Blocks execution by sleeping in intervals if the app is currently in use.
   * Resumes automatically once the user has been idle for the threshold duration.
   */
  public async waitUntilIdle(checkIntervalMs: number = 2000): Promise<void> {
    if (this.isAppInUse()) {
      console.log(`[ActivityTracker] App is active (last request: ${Math.round((Date.now() - this.lastActivity)/1000)}s ago). Pausing background process...`);
    }
    while (this.isAppInUse()) {
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
  }
}

export const activityTracker = new ActivityTracker();
export default activityTracker;
