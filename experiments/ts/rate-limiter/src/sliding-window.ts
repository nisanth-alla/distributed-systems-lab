/**
 * Sliding Window Counter rate limiter.
 *
 * Counts requests in a rolling time window. If the count exceeds the limit,
 * the request is rejected. Simple as that.
 *
 * The twist: a naive fixed window has a boundary problem. If the limit is
 * 100 req/min and someone sends 100 requests at 0:59 and 100 at 1:01,
 * they've sent 200 requests in 2 seconds but both windows say "fine."
 *
 * The sliding window fixes this by weighting the previous window's count
 * based on how far into the current window we are. If we're 30% into the
 * current minute, the previous minute counts for 70% of its total.
 *
 * This is how Cloudflare and most CDNs actually do it. Clean, memory-efficient,
 * and avoids the boundary spike problem.
 */

export interface SlidingWindowConfig {
  /** Max requests allowed per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface WindowCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number | null;
  currentCount: number;
}

interface WindowState {
  count: number;
  startTime: number;
}

export class SlidingWindowCounter {
  private readonly limit: number;
  private readonly windowMs: number;
  private currentWindow: WindowState;
  private previousWindow: WindowState;

  constructor(config: SlidingWindowConfig) {
    this.limit = config.limit;
    this.windowMs = config.windowMs;

    const now = Date.now();
    this.currentWindow = { count: 0, startTime: this.getWindowStart(now) };
    this.previousWindow = { count: 0, startTime: this.getWindowStart(now) - this.windowMs };
  }

  /**
   * Check if a request should be allowed.
   *
   * The weighted count formula:
   *   previousWindow.count * (1 - elapsedRatio) + currentWindow.count
   *
   * where elapsedRatio = how far we are into the current window (0.0 to 1.0)
   *
   * Example: limit = 100, window = 60s
   *   Previous window had 80 requests
   *   Current window has 30 requests
   *   We're 40% into the current window
   *   Weighted count = 80 * 0.6 + 30 = 78 → allowed (78 < 100)
   */
  check(): WindowCheckResult {
    const now = Date.now();
    this.advanceWindows(now);

    const elapsedRatio = (now - this.currentWindow.startTime) / this.windowMs;
    const previousWeight = 1 - elapsedRatio;
    const weightedCount =
      this.previousWindow.count * previousWeight + this.currentWindow.count;

    if (weightedCount < this.limit) {
      this.currentWindow.count += 1;
      const newWeightedCount = this.previousWindow.count * previousWeight + this.currentWindow.count;

      return {
        allowed: true,
        remaining: Math.max(0, Math.floor(this.limit - newWeightedCount)),
        retryAfterMs: null,
        currentCount: this.currentWindow.count,
      };
    }

    // Rejected. Calculate when the window will slide enough to allow a request.
    // This is an approximation since the window is continuously sliding.
    const msRemaining = this.windowMs - (now - this.currentWindow.startTime);

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.ceil(msRemaining * 0.1), // rough estimate: try again at ~10% window shift
      currentCount: this.currentWindow.count,
    };
  }

  /**
   * If we've moved into a new window, rotate.
   * If we've somehow skipped an entire window (long gap), reset both.
   */
  private advanceWindows(now: number): void {
    const currentWindowStart = this.getWindowStart(now);

    if (currentWindowStart === this.currentWindow.startTime) {
      return; // still in the same window
    }

    if (currentWindowStart === this.currentWindow.startTime + this.windowMs) {
      // Moved exactly one window forward. Previous becomes the old current.
      this.previousWindow = { ...this.currentWindow };
      this.currentWindow = { count: 0, startTime: currentWindowStart };
    } else {
      // Skipped a whole window (or more). Both windows are stale.
      this.previousWindow = { count: 0, startTime: currentWindowStart - this.windowMs };
      this.currentWindow = { count: 0, startTime: currentWindowStart };
    }
  }

  /** Align to window boundary */
  private getWindowStart(timestamp: number): number {
    return Math.floor(timestamp / this.windowMs) * this.windowMs;
  }

  /** Current state for debugging and visualization */
  getState(): {
    limit: number;
    windowMs: number;
    currentWindowCount: number;
    previousWindowCount: number;
    weightedCount: number;
  } {
    const now = Date.now();
    this.advanceWindows(now);
    const elapsedRatio = (now - this.currentWindow.startTime) / this.windowMs;
    const weightedCount =
      this.previousWindow.count * (1 - elapsedRatio) + this.currentWindow.count;

    return {
      limit: this.limit,
      windowMs: this.windowMs,
      currentWindowCount: this.currentWindow.count,
      previousWindowCount: this.previousWindow.count,
      weightedCount: Math.round(weightedCount * 100) / 100,
    };
  }

  /** Reset counters. Used between test runs. */
  reset(): void {
    const now = Date.now();
    this.currentWindow = { count: 0, startTime: this.getWindowStart(now) };
    this.previousWindow = { count: 0, startTime: this.getWindowStart(now) - this.windowMs };
  }
}
