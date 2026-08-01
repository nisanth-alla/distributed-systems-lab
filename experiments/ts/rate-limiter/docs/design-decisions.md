# Design Decisions: Rate Limiter

## Why two strategies?

There isn't one "best" rate limiting algorithm. Token bucket and sliding window solve the same problem differently, and which one fits depends on your traffic pattern. Building both and running the same load test against each is the fastest way to feel the difference.

## Token Bucket

**What it does:** Holds a fixed number of tokens. Each request costs one. Tokens refill at a constant rate. Empty bucket means rejection.

**When it's the right choice:**
- Your API has legitimate burst patterns (batch uploads, page loads that trigger multiple calls)
- You want to allow short spikes as long as the average rate stays reasonable
- GitHub's API uses this: 5000 requests per hour, but you can use them in bursts

**What you give up:**
- A client can drain the bucket instantly and then has to wait. If your downstream can't handle bursts, this doesn't protect it.
- The "capacity" parameter needs tuning. Too high and you're not really limiting. Too low and legitimate batch operations fail.

**Implementation choice: lazy refill.** Instead of running a timer to add tokens, I calculate how many tokens should have accumulated since the last request. Simpler, no background process, and it works identically. The only case where it matters: if no requests come for a long time, the first request triggers a large refill calculation. For this experiment that's fine. At production scale with millions of keys, you'd want to think about whether the map of buckets ever gets garbage collected.

## Sliding Window

**What it does:** Counts requests in a rolling time window. Over the limit? Rejected. The window slides continuously, so there's no fixed boundary where the counter resets.

**When it's the right choice:**
- You want strict enforcement with no burst allowance
- Regulatory or billing requirements specify "N requests per minute" and mean it
- You want predictable behavior under any traffic pattern
- Cloudflare uses this for their rate limiting rules

**What you give up:**
- No burst tolerance. Even if the system could handle a short spike, the counter says no.
- The weighted calculation between current and previous windows is an approximation. It's close enough in practice but it's not mathematically exact for every possible request timing.

**Why sliding window instead of fixed window?** The boundary problem. A fixed 1-minute window resets at exactly :00. Send 100 requests at :59, wait 2 seconds, send 100 more at 1:01. Both windows say "fine" but you just did 200 requests in 2 seconds. The sliding window avoids this by weighting the previous window's count based on how far into the current one you are.

## Per-IP keying

In production, you'd rate limit by API key, user ID, or tenant rather than IP. IP-based limiting has obvious problems: shared IPs (corporate NAT, VPN exit nodes) get penalized unfairly, and attackers can rotate IPs.

I used IP here because it requires zero authentication setup, which keeps the experiment focused on the algorithm instead of the access control layer.

## In-memory state

Both implementations store state in process memory. This is fine for a single server. The moment you have two instances behind a load balancer, each one has its own counters and a client can effectively double their limit by alternating between them.

The production fix is Redis. Store the token count or window counters in Redis with atomic operations (INCR, EXPIRE, Lua scripts for token bucket). Redis is fast enough that the latency overhead is acceptable for rate limiting checks.

I didn't add Redis here because the experiment is about the algorithms, not the storage layer.

## The numbers I picked

- Token bucket: capacity 10, refill 2/sec
- Sliding window: 10 requests per 5-second window

These are deliberately low so you can see limiting happen with small load tests. In production you'd set these based on your API's actual capacity and your SLA. The burst test sends 50 requests. The sustained test sends 3/sec for 30 seconds. Both exceed the limits quickly enough to produce interesting output without waiting around.

## What I'd add next

1. **Distributed rate limiting** with Redis. Same algorithms but with atomic remote state. The interesting part is handling Redis latency and what happens if Redis goes down (fail open or fail closed?).
2. **Per-endpoint limits.** `/api/search` might tolerate 100 req/sec while `/api/transfer` should allow 5.
3. **Response header standards.** I'm using `X-RateLimit-Remaining` and `Retry-After` which are common, but the IETF is standardizing `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers. Worth tracking.
