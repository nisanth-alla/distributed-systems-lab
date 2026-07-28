import express from "express";
import cors from "cors";
import { RateLimiterMiddleware, type Strategy } from "./middleware";
import { Broadcaster } from "./broadcaster";

const app = express();
const PORT = 8002;

app.use(cors());
app.use(express.json());

const broadcaster = new Broadcaster();
const limiter = new RateLimiterMiddleware("token-bucket", broadcaster);

// --- Endpoints ---

/**
 * Health check. Not rate-limited.
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", strategy: limiter.getStrategy() });
});

/**
 * The protected resource. This is the endpoint that gets rate-limited.
 *
 * In a real API this would be your actual business logic. Here it just
 * returns a success message so you can focus on watching the rate limiter
 * do its thing.
 */
app.get("/api/resource", limiter.handler(), (_req, res) => {
  res.json({
    message: "Request accepted",
    strategy: limiter.getStrategy(),
    timestamp: Date.now(),
  });
});

/**
 * Switch rate limiting strategy at runtime.
 *
 * POST /strategy { "strategy": "token-bucket" | "sliding-window" }
 *
 * This clears all limiter state so you get a clean comparison.
 * Run the same load test under each strategy and compare the results.
 */
app.post("/strategy", (req, res) => {
  const { strategy } = req.body as { strategy?: string };
  if (strategy !== "token-bucket" && strategy !== "sliding-window") {
    res.status(400).json({
      error: 'strategy must be "token-bucket" or "sliding-window"',
    });
    return;
  }
  limiter.setStrategy(strategy as Strategy);
  console.log(`[strategy] switched to ${strategy}`);
  res.json({ strategy, message: "Strategy updated. All limiter state cleared." });
});

/**
 * Reset limiter state without changing strategy. Useful between test runs.
 */
app.post("/reset", (_req, res) => {
  limiter.reset();
  console.log("[reset] limiter state cleared");
  res.json({ message: "Limiter state reset", strategy: limiter.getStrategy() });
});

/**
 * Debug endpoint: see the internal state for a given IP.
 */
app.get("/debug/state", (req, res) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  res.json({
    ip,
    strategy: limiter.getStrategy(),
    state: limiter.getStateForIp(ip),
  });
});

// --- Start ---

const server = app.listen(PORT, () => {
  console.log(`Rate limiter experiment running on http://localhost:${PORT}`);
  console.log(`Strategy: ${limiter.getStrategy()}`);
  console.log("");
  console.log("Endpoints:");
  console.log(`  GET  /api/resource   - the rate-limited endpoint`);
  console.log(`  POST /strategy       - switch between token-bucket and sliding-window`);
  console.log(`  POST /reset          - clear limiter state`);
  console.log(`  GET  /debug/state    - inspect internal limiter state`);
  console.log(`  GET  /health         - health check`);
  console.log("");
  console.log("Try:");
  console.log(`  npm run rate-limiter:burst      - send 50 requests in ~1 second`);
  console.log(`  npm run rate-limiter:sustained   - send 3 req/sec for 30 seconds`);
});

broadcaster.attach(server);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
});
