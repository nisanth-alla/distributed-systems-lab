/**
 * Shipping failure scenario.
 *
 * Payment succeeds, inventory is reserved, then shipping fails.
 * This triggers the compensation chain:
 *   1. Inventory hold is released (reverse of reservation)
 *   2. Payment is refunded (reverse of charge)
 *
 * This is the most interesting scenario because two stages already
 * committed real side effects (money was charged, items were reserved)
 * and both need to be undone in the correct order.
 *
 * Watch the server console while this runs. You'll see the forward
 * flow stop at shipping, then compensation run backward through
 * inventory and payment.
 */

const BASE = "http://localhost:8003";

async function run(): Promise<void> {
  console.log("Submitting order (will fail at shipping)...\n");

  const res = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: "cust_bob",
      items: [
        { productId: "prod_monitor", name: '34" Ultrawide Monitor', quantity: 1, price: 699.99 },
      ],
      shippingAddress: "PO Box 9999, Restricted Area",
      failAt: "shipping",
    }),
  });

  const order = await res.json();
  console.log(`Status: ${order.status}`);
  console.log(`Failed at: ${order.failedAt}`);
  console.log(`Reason: ${order.failureReason}`);
  console.log("");

  // Show what happened in order
  console.log("Forward flow (what happened before the failure):");
  for (const stage of order.history ?? []) {
    const icon = stage.success ? "OK" : "FAIL";
    console.log(`  [${icon}] ${stage.stage} (${stage.durationMs}ms)`);
    console.log(`       ${stage.message}`);
  }

  console.log("\nCompensation (undoing what succeeded, in reverse):");
  for (const comp of order.compensations ?? []) {
    const icon = comp.success ? "OK" : "FAIL";
    console.log(`  [${icon}] ${comp.stage}`);
    console.log(`       ${comp.message}`);
  }

  // Show full event timeline
  console.log("\nFull event timeline:");
  const eventsRes = await fetch(`${BASE}/orders/${order.id}/events`);
  const events = await eventsRes.json();
  for (const event of events) {
    const time = new Date(event.timestamp).toISOString().split("T")[1]?.slice(0, 12);
    let detail = "";
    if (event.type === "stage.failed") detail = ` (${event.error.slice(0, 60)}...)`;
    if (event.type === "compensation.completed") detail = ` (${event.result.message.slice(0, 60)})`;
    console.log(`  ${time} ${event.type}${detail}`);
  }
}

run().catch(console.error);
