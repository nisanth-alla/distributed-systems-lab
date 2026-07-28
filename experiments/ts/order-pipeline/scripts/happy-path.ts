/**
 * Happy path: submit an order with no injected failures.
 *
 * Expect to see all four stages complete in sequence:
 *   payment -> inventory -> shipping -> notification -> completed
 *
 * This is the baseline. Run this first so you know what "normal" looks like,
 * then run the failure scripts to see what changes.
 */

const BASE = "http://localhost:8003";

async function run(): Promise<void> {
  console.log("Submitting order (no failures)...\n");

  const res = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: "cust_alice",
      items: [
        { productId: "prod_laptop", name: "ThinkPad X1 Carbon", quantity: 1, price: 1299.99 },
        { productId: "prod_charger", name: "USB-C Charger", quantity: 2, price: 39.99 },
      ],
      shippingAddress: "742 Evergreen Terrace, Springfield",
    }),
  });

  const order = await res.json();
  console.log(`Status: ${order.status}`);
  console.log(`Total: $${order.total?.toFixed(2)}`);
  console.log("");

  // Show stage timeline
  console.log("Stage timeline:");
  for (const stage of order.history ?? []) {
    const icon = stage.success ? "OK" : "FAIL";
    console.log(`  [${icon}] ${stage.stage} (${stage.durationMs}ms) - ${stage.message}`);
  }

  if (order.compensations?.length > 0) {
    console.log("\nCompensations:");
    for (const comp of order.compensations) {
      console.log(`  [${comp.success ? "OK" : "FAIL"}] ${comp.stage} - ${comp.message}`);
    }
  }

  // Fetch the event log
  console.log("\nEvent log:");
  const eventsRes = await fetch(`${BASE}/orders/${order.id}/events`);
  const events = await eventsRes.json();
  for (const event of events) {
    const time = new Date(event.timestamp).toISOString().split("T")[1]?.slice(0, 12);
    console.log(`  ${time} ${event.type}`);
  }
}

run().catch(console.error);
