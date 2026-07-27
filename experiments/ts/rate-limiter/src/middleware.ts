import { Request, Response, NextFunction } from "express";
import { TokenBucket, type ConsumeResult } from "./token-bucket";
import {
  SlidingWindowCounter,
  type WindowCheckResult,
} from "./sliding-window";
import { type Broadcaster } from "./broadcaster";

export type Strategy = "token-bucket" | "sliding-window";

export interface RateLimitEvent {
  type: "request:allowed" | "request:rejected";
  strategy: Strategy;
  ip: string;
  path: string;
  remaining: number;
  retryAfterMs: number | null;
  timestamp: number;
}

/**
 * Rate limiting middleware that supports switching strategies at runtime.
 *
 * Each client IP gets its own limiter instance. In production you'd key this
 * differently (API key, user ID, etc.) and store the state in Redis instead
 * of in-process memory. But for this experiment, per-IP in-memory is enough
 * to demonstrate the algorithms.
 *
 * The strategy can be changed at runtime via the /strategy endpoint.
 * When you switch, all existing limiter instances are cleared so you
 * can see the new strategy from a clean state.
 */
export class RateLimiterMiddleware {
  private strategy: Strategy;
  private tokenBuckets: Map<string, TokenBucket> = new Map();
  private slidingWindows: Map<string, SlidingWindowCounter> = new Map();
  private broadcaster: Broadcaster | null;

  // Defaults: 10 requests allowed, refilling at 2/sec (token bucket)
  // or 10 per 5-second window (sliding window). Low numbers so you can
  // actually see limiting happen without sending thousands of requests.
  private readonly tokenBucketCapacity = 10;
  private readonly tokenBucketRefillRate = 2;
  private readonly slidingWindowLimit = 10;
  private readonly slidingWindowMs = 5000;

  constructor(strategy: Strategy, broadcaster?: Broadcaster) {
    this.strategy = strategy;
    this.broadcaster = broadcaster ?? null;
  }

  /** The actual Express middleware */
  handler() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
      const result = this.check(ip);

      const event: RateLimitEvent = {
        type: result.allowed ? "request:allowed" : "request:rejected",
        strategy: this.strategy,
        ip,
        path: req.path,
        remaining: result.remaining,
        retryAfterMs: result.retryAfterMs,
        timestamp: Date.now(),
      };
      this.broadcaster?.emit(event);

      // Standard rate limit headers (RFC 6585 / draft-ietf-httpapi-ratelimit-headers)
      res.set("X-RateLimit-Strategy", this.strategy);
      res.set("X-RateLimit-Remaining", String(result.remaining));

      if (!result.allowed) {
        if (result.retryAfterMs) {
          res.set("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
        }
        res.status(429).json({
          error: "Too many requests",
          strategy: this.strategy,
          remaining: result.remaining,
          retryAfterMs: result.retryAfterMs,
        });
        return;
      }

      next();
    };
  }

  private check(ip: string): { allowed: boolean; remaining: number; retryAfterMs: number | null } {
    if (this.strategy === "token-bucket") {
      return this.checkTokenBucket(ip);
    }
    return this.checkSlidingWindow(ip);
  }

  private checkTokenBucket(ip: string): ConsumeResult {
    let bucket = this.tokenBuckets.get(ip);
    if (!bucket) {
      bucket = new TokenBucket({
        capacity: this.tokenBucketCapacity,
        refillRate: this.tokenBucketRefillRate,
      });
      this.tokenBuckets.set(ip, bucket);
    }
    return bucket.consume();
  }

  private checkSlidingWindow(ip: string): WindowCheckResult {
    let window = this.slidingWindows.get(ip);
    if (!window) {
      window = new SlidingWindowCounter({
        limit: this.slidingWindowLimit,
        windowMs: this.slidingWindowMs,
      });
      this.slidingWindows.set(ip, window);
    }
    return window.check();
  }

  /** Switch strategy at runtime. Clears all state for a clean comparison. */
  setStrategy(strategy: Strategy): void {
    this.strategy = strategy;
    this.tokenBuckets.clear();
    this.slidingWindows.clear();
  }

  getStrategy(): Strategy {
    return this.strategy;
  }

  /** Reset all limiters without changing strategy. Used between test runs. */
  reset(): void {
    this.tokenBuckets.clear();
    this.slidingWindows.clear();
  }

  /** Get state for a specific IP. Useful for debugging. */
  getStateForIp(ip: string): Record<string, unknown> {
    if (this.strategy === "token-bucket") {
      const bucket = this.tokenBuckets.get(ip);
      return bucket ? bucket.getState() : { message: "no bucket for this IP" };
    }
    const window = this.slidingWindows.get(ip);
    return window ? window.getState() : { message: "no window for this IP" };
  }
}
