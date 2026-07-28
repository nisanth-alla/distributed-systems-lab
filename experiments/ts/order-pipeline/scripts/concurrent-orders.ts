/**
 * Concurrent orders: submit 5 orders at the same time.
 *
 * Some succeed, some fail at different stages. This shows how the
 * saga orchestrator handles multiple orders simultaneously and how
 * events interleave on the server console.
 *
 * In a real system with shared resources (like inventory), concurrent
 * orders create race conditions. Two orders for the last item in stock
 * might both check inventory, both see "1 available," and both reserve it.
 * That's a double-booking. This experiment doesn't model shared state
 * (each order is independent), but the interleaving is still interesting
 * to see.
 */

const BASE = "http://localhost:8003";

interface OrderRequest {
  customerId: string;
  items: Array<{ productId: string; name: string; quantity: number; price: number }>;
  shippingAddress: string;
  failAt?: string;
  label: string;
}

const orders: OrderRequest[] = [
  {
    label: "Alice (happy path)",
    customerId: "cust_alice",
    items: [{ productId: "prod_book", name: "DDIA", quantity: 1, price: 45.99 }],
    shippingAddress: "123 Oak Lane, Portland",
  },
  {
    label: "Bob (shipping fails)",
    customerId: "cust_bob",
    items: [{ productId: "prod_desk", name: "Standing Desk", quantity: 1, price: 549.00 }],
    shippingAddress: "Restricted Zone Alpha",
    failAt: "shipping",
  },
  {
    label: "Carol (happy path)",
    customerId: "cust_carol",
    items: [
      { productId: "prod_keyboard", name: "Mechanical Keyboard", quantity: 1, price: 159.99 },
      { productId: "prod_mouse", name: "Ergonomic Mouse", quantity: 1, price: 79.99 },
    ],
    shippingAddress: "456 Pine St, Seattle",
  },
  {
    label: "Dave (payment fails)",
    customerId: "cust_dave",
    items: [{ productId: "prod_chair", name: "Aeron Chair", quantity: 1, price: 1395.00 }],
    shippingAddress: "789 Elm Ave, Austin",
    failAt: "payment",
  },
  {
    label: "Eve (inventory fails)",
    customerId: "cust_eve",
    items: [{ productId: "prod_gpu", name: "RTX 5090", quantity: 3, price: 1999.99 }],
    shippingAddress: "321 Maple Dr, Denver",
    failAt: "inventory",
  },
];

async function submitOrder(order: OrderRequest): Promise<{ label: string; status: string; failedAt?: string }> {
  const res = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: order.customerId,
      items: order.items,
      shippingAddress: order.shippingAddress,
      failAt: order.failAt,
    }),
  });

  const result = await res.json();
  return {
    label: order.label,
    status: result.status,
    failedAt: result.failedAt,
  };
}

async function run(): Promise<void> {
  console.log(`Submitting ${orders.length} orders concurrently...\n`);

  // Fire all at once
  const results = await Promise.all(orders.map(submitOrder));

  console.log("Results:");
  console.log("-".repeat(60));

  for (const r of results) {
    const statusIcon = r.status === "completed" ? "OK" : "FAIL";
    const failInfo = r.failedAt ? ` (failed at: ${r.failedAt})` : "";
    console.log(`  [${statusIcon}] ${r.label} -> ${r.status}${failInfo}`);
  }

  const succeeded = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status !== "completed").length;

  console.log("");
  console.log(`  Completed: ${succeeded}/${results.length}`);
  console.log(`  Failed:    ${failed}/${results.length}`);
  console.log("");
  console.log("Check the server console to see how the events interleaved.");
}

run().catch(console.error);
