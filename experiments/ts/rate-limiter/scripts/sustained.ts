/**
 * Sustained load test.
 *
 * Sends requests at a steady rate over 30 seconds.
 * This shows how the two strategies behave under continuous load:
 *
 * - Token bucket with 2 tokens/sec refill: at 2 req/sec, every request
 *   gets through because refill matches consumption exactly. At 3 req/sec,
 *   the bucket slowly drains and you start seeing rejections. At 5 req/sec,
 *   rejections come fast after the initial burst.
 *
 * - Sliding window with 10 req/5sec: at 2 req/sec, that's 10 per window,
 *   right at the limit. You might see occasional rejections at the boundary
 *   because of the weighted count from the previous window.
 *
 * The interesting bit: try changing REQUESTS_PER_SECOND to values around
 * the limit boundary (2-3 for token bucket, 2 for sliding window).
 * That's where the behavior differences become visible.
 */

const BASE = "http://localhost:8002";
const DURATION_SECONDS = 30;
const REQUESTS_PER_SECOND = 3; // try 1, 2, 3, 5 to see different behaviors

interface Stats {
  accepted: number;
  rejected: number;
  totalSent: number;
  seconds: Map<number, { accepted: number; rejected: number }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendAndRecord(stats: Stats, second: number): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/resource`);
    stats.totalSent++;

    if (!stats.seconds.has(second)) {
      stats.seconds.set(second, { accepted: 0, rejected: 0 });
    }
    const bucket = stats.seconds.get(second)!;

    if (res.status === 200) {
      stats.accepted++;
      bucket.accepted++;
    } else {
      stats.rejected++;
      bucket.rejected++;
    }
  } catch {
    console.log(`  [error] request failed at second ${second}`);
  }
}

async function runSustained(): Promise<void> {
  // Check strategy
  const healthRes = await fetch(`${BASE}/health`);
  const health = (await healthRes.json()) as { strategy: string };
  console.log(`Active strategy: ${health.strategy}`);
  console.log(`Rate: ${REQUESTS_PER_SECOND} req/sec for ${DURATION_SECONDS}s`);
  console.log(`Total requests: ${REQUESTS_PER_SECOND * DURATION_SECONDS}`);
  console.log("");

  const stats: Stats = {
    accepted: 0,
    rejected: 0,
    totalSent: 0,
    seconds: new Map(),
  };

  const intervalMs = 1000 / REQUESTS_PER_SECOND;

  for (let s = 0; s < DURATION_SECONDS; s++) {
    const promises: Promise<void>[] = [];

    for (let r = 0; r < REQUESTS_PER_SECOND; r++) {
      promises.push(
        sleep(r * intervalMs).then(() => sendAndRecord(stats, s))
      );
    }

    await Promise.all(promises);

    // Progress dot every second
    const secStats = stats.seconds.get(s);
    if (secStats) {
      const bar = "O".repeat(secStats.accepted) + "X".repeat(secStats.rejected);
      process.stdout.write(`  [${String(s + 1).padStart(2)}s] ${bar}\n`);
    }

    // Wait for the rest of the second if we haven't used it all
    if (s < DURATION_SECONDS - 1) {
      await sleep(Math.max(0, 1000 - REQUESTS_PER_SECOND * intervalMs));
    }
  }

  // Summary
  console.log("\nSummary:");
  console.log(`  Total sent:  ${stats.totalSent}`);
  console.log(`  Accepted:    ${stats.accepted} (${Math.round((stats.accepted / stats.totalSent) * 100)}%)`);
  console.log(`  Rejected:    ${stats.rejected} (${Math.round((stats.rejected / stats.totalSent) * 100)}%)`);

  // Find the pattern: when did rejections start?
  let firstRejectionSecond: number | null = null;
  for (const [sec, data] of stats.seconds) {
    if (data.rejected > 0 && firstRejectionSecond === null) {
      firstRejectionSecond = sec;
    }
  }
  if (firstRejectionSecond !== null) {
    console.log(`  First rejection at: second ${firstRejectionSecond + 1}`);
  } else {
    console.log(`  No rejections (rate is within limits)`);
  }
}

runSustained().catch(console.error);
