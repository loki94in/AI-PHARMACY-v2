import { activityTracker } from '../utils/activityTracker.js';

export function recordActivity(): void {
  activityTracker.recordActivity();
}

export function getLastActiveTime(): number {
  return activityTracker.getLastActivity();
}

export function isIdle(thresholdMs?: number): boolean {
  return activityTracker.isIdle(thresholdMs);
}
