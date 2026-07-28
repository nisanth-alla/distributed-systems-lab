import express from "express";
import cors from "cors";
import crypto from "crypto";
import { EventBus } from "./event-bus";
import { SagaOrchestrator } from "./saga";
import { Broadcaster } from "./broadcaster";
import { PaymentStage } from "./stages/payment";
import { InventoryStage } from "./stages/inventory";
import { ShippingStage } from "./stages/shipping";
import { NotificationStage } from "./stages/notification";
import { type Order, type FailureConfig, type StageName } from "./types";

const app = express();
const PORT = 8003;

app.use(cors());
app.use(express.json());

// Wire everything together
const eventBus = new EventBus();
const broadcaster = new Broadcaster();

const stages = [
  new PaymentStage(),
  new InventoryStage(),
  new ShippingStage(),
  new NotificationStage(),
];

const saga = new SagaOrchestrator(stages, eventBus);

// Forward all pipeline events to connected WebSocket clients
eventBus.subscribe((event) => broadcaster.emit(event));

// Also log events to the console for the terminal experience
eventBus.subscribe((event) => {
  const prefix = `[${event.orderId.slice(0, 8)}]`;
  switch (event.type) {
    case "order.created":
      console.log(`${prefix} Order created ($${event.order.total.toFixed(2)})`);
      break;
    case "stage.started":
      console.log(`${prefix}   ${event.stage}: starting...`);
      break;
    case "stage.completed":
      console.log(`${prefix}   ${event.stage}: done (${event.result.durationMs}ms)`);
      break;
    case "stage.failed":
      console.log(`${prefix}   ${event.stage}: FAILED - ${event.error}`);
      break;
    case "compensation.started":
      console.log(`${prefix}   compensating ${event.stage}...`);
      break;
    case "compensation.completed":
      console.log(`${prefix}   ${event.stage}: ${event.result.success ? "compensated" : "COMPENSATION FAILED"}`);
      break;
    case "order.completed":
      console.log(`${prefix} Order completed successfully\n`);
      break;
    case "order.failed":
      console.log(`${prefix} Order failed at ${event.failedAt}. Compensated: [${event.compensationsRun.join(", ")}]\n`);
      break;
  }
});

// --- Endpoints ---

app.get("/health", (_req, res) => {
  res.json({ status: "ok", port: PORT });
});

/**
 * Submit a new order.
 *
 * POST /orders
 * {
 *   "customerId": "cust_123",
 *   "items": [{ "productId": "prod_1", "name": "Widget", "quantity": 2, "price": 29.99 }],
 *   "shippingAddress": "123 Main St, Springfield",
 *   "failAt": "shipping"    // optional: inject failure at a specific stage
 * }
 */
app.post("/orders", async (req, res) => {
  const { customerId, items, shippingAddress, failAt, stageDelayMs } = req.body as {
    customerId?: string;
    items?: Array<{ productId: string; name: string; quantity: number; price: number }>;
    shippingAddress?: string;
    failAt?: string;
    stageDelayMs?: number;
  };

  if (!customerId || !items || !shippingAddress) {
    res.status(400).json({ error: "customerId, items, and shippingAddress are required" });
    return;
  }

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const order: Order = {
    id: crypto.randomUUID(),
    customerId,
    items,
    total,
    shippingAddress,
    status: "created",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [],
    compensations: [],
  };

  const failureConfig: FailureConfig | undefined = failAt
    ? { failAt: failAt as StageName, stageDelayMs }
    : undefined;

  // Run the saga. This is async but we await it so the response includes
  // the final state. In a real system you'd return immediately and let
  // the client poll or subscribe to events.
  const result = await saga.execute(order, failureConfig);

  const statusCode = result.status === "completed" ? 200 : 422;
  res.status(statusCode).json(result);
});

/**
 * Get a specific order with its full history.
 */
app.get("/orders/:id", (req, res) => {
  const order = saga.getOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(order);
});

/**
 * List all orders.
 */
app.get("/orders", (_req, res) => {
  res.json(saga.getAllOrders());
});

/**
 * Get the event log for a specific order.
 */
app.get("/orders/:id/events", (req, res) => {
  const events = eventBus.getEventsForOrder(req.params.id);
  if (events.length === 0) {
    res.status(404).json({ error: "No events found for this order" });
    return;
  }
  res.json(events);
});

/**
 * Reset all state. Used between test runs.
 */
app.post("/reset", (_req, res) => {
  saga.reset();
  eventBus.reset();
  console.log("[reset] all state cleared\n");
  res.json({ message: "All orders and events cleared" });
});

// --- Start ---

const server = app.listen(PORT, () => {
  console.log(`Order pipeline experiment running on http://localhost:${PORT}`);
  console.log("");
  console.log("Endpoints:");
  console.log("  POST /orders          - submit an order (add failAt to inject failure)");
  console.log("  GET  /orders          - list all orders");
  console.log("  GET  /orders/:id      - get order with full history");
  console.log("  GET  /orders/:id/events - event log for an order");
  console.log("  POST /reset           - clear all state");
  console.log("");
  console.log("Try:");
  console.log("  npm run order-pipeline:happy           - run a successful order");
  console.log("  npm run order-pipeline:fail:shipping   - trigger shipping failure + compensation");
  console.log("  npm run order-pipeline:concurrent      - run 5 orders at once");
  console.log("");
});

broadcaster.attach(server);

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
});
