# Rate Limiter

## Problem

You're running an API. Maybe it's a payment endpoint, maybe it serves search results, maybe it returns user profiles. Doesn't matter. At some point, someone is going to send you way more requests than your system can handle. Could be a misbehaving client stuck in a retry loop. Could be a bot scraping your data. Could be a legitimate user doing a batch upload that accidentally hammers you.

If you don't limit the rate of incoming requests, one noisy client takes everyone else down with it. Rate limiting is how you keep the service healthy for everyone.

Every major API does this. GitHub gives you 5000 requests per hour. Stripe limits based on your plan. AWS throttles per-service and per-account. The interesting question is not *whether* to limit, but *how*.

This experiment builds two different rate limiting strategies, runs the same traffic against both, and shows you where they behave differently.

## What you'll learn

1. How token bucket rate limiting works (and why GitHub uses it)
2. How sliding window rate limiting works (and why Cloudflare uses it)
3. The specific difference in how they handle burst traffic
4. Why "10 requests per second" can mean two different things depending on the algorithm
5. What changes when you go from a single server to multiple instances

## The two strategies

### Token Bucket

Picture a bucket that holds 10 tokens. Every request takes one token out. Every half-second, a new token gets dropped in (refill rate of 2 per second). If a request arrives and the bucket is empty, it's rejected.

The key insight: a full bucket lets you burst. If no requests have come in for a while, the bucket fills up to 10, and the next 10 requests all go through instantly. After that, you're limited to 2 per second until the bucket refills.

This is good when your users have legitimate burst patterns. A page load that triggers 8 API calls should work. A script firing 1000 requests should get throttled.

### Sliding Window

Count requests in a rolling time window. The limit here is 10 requests per 5 seconds. If you've already made 10 in the current window, you're done.

The tricky part: a naive "fixed window" resets at exact boundaries, which creates a loophole. Someone could send 10 requests at second 4.9, wait until second 5.1 (new window), and send 10 more. That's 20 requests in 0.2 seconds, and both windows say "fine."

The sliding window fixes this by weighting the previous window. If you're 30% into the current window, the previous window's count still contributes 70%. This closes the boundary loophole.

This is good when you want strict enforcement. No burst tolerance, just a hard ceiling.

## How to run

```bash
# Install dependencies
npm install

# Start the server
npm run dev
```

The server starts on port 8002 with token bucket as the default strategy.

### Send a burst of traffic

In a second terminal:

```bash
npm run burst
```

This fires 50 requests simultaneously. Watch the output: you'll see the first ~10 accepted and the rest rejected. The exact number depends on timing.

### Send sustained traffic

```bash
npm run sustained
```

This sends 3 requests per second for 30 seconds. You'll see a per-second breakdown showing when rejections start and the pattern they follow. With the default token bucket settings (refill 2/sec, sending 3/sec), the bucket drains by 1 per second. You'll see rejections starting around second 4-5.

### Switch strategies

```bash
# Switch to sliding window
curl -X POST http://localhost:8002/strategy \
  -H 'Content-Type: application/json' \
  -d '{"strategy":"sliding-window"}'

# Reset counters for a clean test
curl -X POST http://localhost:8002/reset

# Run the same load test again
npm run burst
```

Compare the output. The total accepted/rejected might be similar, but the *pattern* of rejections is different.

### Inspect internal state

```bash
curl http://localhost:8002/debug/state
```

Shows the current limiter state for your IP: remaining tokens (token bucket) or weighted count and window counters (sliding window).

## What to watch for

1. **Burst test, token bucket:** The first 10 requests get through because the bucket starts full. Rejection responses include a `retryAfterMs` telling the client how long until a token is available.

2. **Burst test, sliding window:** Also roughly 10 allowed, but the rejection pattern is different. The `retryAfterMs` is based on when the window slides enough to free up capacity, which is a rougher estimate.

3. **Sustained test at 2 req/sec:** With token bucket (refill 2/sec), this should be right at the boundary. Most requests get through. With sliding window (10/5sec = 2/sec effective rate), you're right at the limit and might see occasional rejections at window boundaries.

4. **Sustained test at 5 req/sec:** Both strategies reject heavily, but at different points in the cycle. Token bucket drains fast after the initial 10, then accepts 2 per second. Sliding window rejects as soon as the weighted count hits 10.

## Edge cases worth poking at

**The refill boundary race.** Start the server, wait 10 seconds (bucket fills to 10), then send exactly 11 requests. The 11th should be rejected. But if there's any delay between the 10th and 11th request, a token might have refilled. Check the `remaining` field in the response.

**The window slide.** With sliding window active, send 9 requests, wait for the 5-second window to pass, then send 9 more. The second batch should all go through because the previous window's weight is decaying. But if you send them right at the boundary (say, 4.8 seconds later), some of the previous window's count still applies.

**Back-to-back strategy switching.** Switch from token bucket to sliding window mid-test. All state gets cleared, so the client gets a fresh start. In production, this would be a policy decision: should a strategy switch reset limits or carry them over?

## What this doesn't cover (on purpose)

**Distributed rate limiting.** This experiment runs in a single process. Two server instances behind a load balancer would each have their own counters, effectively doubling the client's limit. The fix is Redis-backed storage with atomic operations. That's a separate concern from the algorithm itself.

**Per-user vs per-IP.** Everything here is keyed by IP address. In production you'd key by API token, user ID, or tenant. IP-based limiting punishes everyone behind a corporate NAT.

**Adaptive rate limiting.** Some systems adjust limits based on server load. If CPU is at 90%, tighten the limits. If it's idle, relax them. Interesting but a different experiment.

See [docs/design-decisions.md](docs/design-decisions.md) for the full reasoning behind these choices.

## Lessons learned

1. The math for token bucket refill is simple but the timing edge cases at boundaries are real. Using floats internally and only rounding for the response header avoids a class of off-by-one issues.

2. Sliding window's weighted count is an approximation, and that's fine. The alternative (storing every individual request timestamp) is precise but uses unbounded memory. The weighted approach gets you 95% of the accuracy for a fixed memory cost.

3. The `Retry-After` header matters more than people think. A good rate limiter doesn't just say "no," it tells the client when to try again. Without it, clients tend to retry immediately in a tight loop, making the overload worse.

4. The hardest part of rate limiting is picking the right numbers. The algorithms are straightforward. Deciding between "100 requests per minute" and "2 requests per second" (same average rate, very different burst behavior) requires knowing your traffic patterns and your downstream capacity.
