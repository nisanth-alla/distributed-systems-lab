/**
 * Token Bucket rate limiter.
 *
 * Think of it like a bucket that holds tokens. Each request costs one token.
 * Tokens refill at a steady rate. If the bucket is empty, the request is rejected.
 *
 * Why this works well for APIs:
 * - Allows short bursts (the bucket can be full and drain quickly)
 * - But enforces a long-term average rate (refill rate is constant)
 * - GitHub uses this for their API: 5000 requests/hour, but you can burst
 *
 * The interesting edge case: what happens when a burst arrives right as
 * the bucket is refilling? That's where the math gets real.
 */

export interface TokenBucketConfig {
  /** Maximum tokens the bucket can hold */
  capacity: number;
  /** How many tokens are added per second */
  refillRate: number;
}

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number | null;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillTime: number;
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(config: TokenBucketConfig) {
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.tokens = config.capacity; // start full
    this.lastRefillTime = Date.now();
  }

  /**
   * Try to consume one token.
   *
   * Before checking, we refill based on elapsed time. This is the "lazy refill"
   * approach: instead of running a timer, we calculate how many tokens should
   * have been added since the last request. Simpler and avoids the overhead
   * of a background interval.
   */
  consume(): ConsumeResult {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(this.tokens),
        retryAfterMs: null,
      };
    }

    // No tokens available. Calculate when the next one arrives.
    const msPerToken = 1000 / this.refillRate;
    const deficit = 1 - this.tokens; // how far from having 1 token
    const waitMs = Math.ceil(deficit * msPerToken);

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: waitMs,
    };
  }

  /**
   * Add tokens based on time elapsed since last refill.
   *
   * Key detail: tokens is a float internally. If 0.3 seconds passed and
   * refillRate is 10/sec, we add 3.0 tokens. This matters at the boundaries.
   * We only floor it when reporting to the client.
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;

    if (elapsedMs <= 0) return;

    const tokensToAdd = (elapsedMs / 1000) * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  /** Current state, useful for debugging and the visualization */
  getState(): { tokens: number; capacity: number; refillRate: number } {
    this.refill();
    return {
      tokens: Math.floor(this.tokens),
      capacity: this.capacity,
      refillRate: this.refillRate,
    };
  }

  /** Reset to full. Used between test runs. */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefillTime = Date.now();
  }
}
