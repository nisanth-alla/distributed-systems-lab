/**
 * Burst load test.
 *
 * Fires 50 requests as fast as possible, all at once.
 * This is the scenario that shows the difference between the two strategies:
 *
 * - Token bucket: allows the first 10 (bucket was full), rejects the rest.
 *   After the burst, tokens trickle back at 2/sec.
 *
 * - Sliding window: allows the first 10 (window was empty), rejects the rest.
 *   But the "rest" depends on where you are in the window cycle.
 *
 * Run this against each strategy and compare:
 *   1. Start the server:         npm run dev
 *   2. Send burst:               npm run burst
 *   3. Switch strategy:          curl -X POST http://localhost:8002/strategy -H 'Content-Type: application/json' -d '{"strategy":"sliding-window"}'
 *   4. Reset:                    curl -X POST http://localhost:8002/reset
 *   5. Send burst again:         npm run burst
 */

const BASE = "http://localhost:8002";
const TOTAL_REQUESTS = 50;

interface RequestResult {
  index: number;
  status: number;
  body: Record<string, unknown>;
  remaining: number;
  latencyMs: number;
}

async function sendRequest(index: number): Promise<RequestResult> {
  const start = Date.now();
  const res = await fetch(`${BASE}/api/resource`);
  const body = (await res.json()) as Record<string, unknown>;
  const remaining = parseInt(res.headers.get("x-ratelimit-remaining") ?? "0", 10);
  return {
    index,
    status: res.status,
    body,
    remaining,
    latencyMs: Date.now() - start,
  };
}

async function runBurst(): Promise<void> {
  console.log(`Sending ${TOTAL_REQUESTS} requests simultaneously...\n`);

  // Check which strategy is active
  const healthRes = await fetch(`${BASE}/health`);
  const health = (await healthRes.json()) as { strategy: string };
  console.log(`Active strategy: ${health.strategy}\n`);

  // Fire all at once
  const promises = Array.from({ length: TOTAL_REQUESTS }, (_, i) => sendRequest(i));
  const results = await Promise.all(promises);

  // Count results
  const accepted = results.filter((r) => r.status === 200);
  const rejected = results.filter((r) => r.status === 429);

  console.log("Results:");
  console.log(`  Accepted: ${accepted.length}/${TOTAL_REQUESTS}`);
  console.log(`  Rejected: ${rejected.length}/${TOTAL_REQUESTS}`);
  console.log("");

  // Show the first few accepted and rejected for detail
  if (accepted.length > 0) {
    const first = accepted[0]!;
    console.log(`  First accepted: request #${first.index} (${first.latencyMs}ms)`);
  }
  if (rejected.length > 0) {
    const first = rejected[0]!;
    const retryAfter = first.body.retryAfterMs;
    console.log(
      `  First rejected: request #${first.index} (${first.latencyMs}ms, retry after ${retryAfter}ms)`
    );
  }

  // Show timeline: when did rejections start?
  console.log("\nTimeline (first 20):");
  results.slice(0, 20).forEach((r) => {
    const symbol = r.status === 200 ? "OK " : "429";
    const detail =
      r.status === 200
        ? `remaining: ${r.remaining}`
        : `retry: ${r.body.retryAfterMs}ms`;
    console.log(`  [${symbol}] #${String(r.index).padStart(2)} ${detail}`);
  });
}

runBurst().catch(console.error);
