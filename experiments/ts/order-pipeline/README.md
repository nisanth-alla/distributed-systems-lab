# Event-Driven Order Pipeline

## Problem

You're building an e-commerce system. A customer places an order. What seems like one action is actually four separate operations that need to happen in sequence:

1. Charge the customer's credit card
2. Reserve the items in inventory
3. Create a shipment with the carrier
4. Send a confirmation email

Each of these talks to a different service or third-party API. There's no single database transaction that spans all four. And here's the hard part: what happens when step 3 fails?

Payment already went through. Inventory is already reserved. Now shipping says the address isn't serviceable. You need to undo what you did, in the right order, without leaving the system in a broken state. That's the saga pattern.

Amazon, Uber, and every major e-commerce platform deals with this. This experiment builds a simplified version of it and lets you trigger different failures to see how compensation works.

## What you'll learn

1. How the saga pattern coordinates multi-step transactions across services
2. Why compensation order matters (you can't refund before cancelling the shipment)
3. The difference between orchestration and choreography (this uses orchestration)
4. What happens when a middle step fails after earlier steps committed real side effects
5. Why some steps (like sending an email) can't be compensated at all

## The four stages

### Payment
Charges the customer. Returns a transaction ID. Compensation: issue a refund using that transaction ID. This is why the stage result stores the transaction ID, without it the compensation handler wouldn't know what to refund.

### Inventory
Reserves items so nobody else can buy them while the order is being fulfilled. This is a hold, not a deduction. Compensation: release the hold, items go back to available stock.

### Shipping
Creates a shipment with the carrier. Returns a tracking number. This is the stage we deliberately fail in the main test scenario because it produces the most interesting compensation chain: two earlier stages have already committed and both need to undo. Compensation: cancel the shipment before it dispatches.

### Notification
Sends a confirmation to the customer. Runs last because it depends on all earlier stages (needs the tracking number). Compensation is a no-op because you can't unsend an email. Most saga implementations treat this as non-compensatable and only run it after all compensatable steps succeed.

## How to run

```bash
cd experiments/ts
npm install
npm run order-pipeline:dev
```

Server starts on port 8003.

### Happy path (everything succeeds)

```bash
npm run order-pipeline:happy
```

All four stages complete in sequence. You'll see the order go through payment, inventory, shipping, notification, and finish as "completed."

### Shipping failure (triggers compensation)

```bash
npm run order-pipeline:fail:shipping
```

This is the interesting one. Payment succeeds, inventory is reserved, then shipping fails. Watch the server console: you'll see the forward flow stop at shipping, then compensation run backward through inventory (release the hold) and payment (issue refund).

### Concurrent orders (mixed results)

```bash
npm run order-pipeline:concurrent
```

Fires 5 orders simultaneously:
- Alice: succeeds
- Bob: fails at shipping (compensation runs)
- Carol: succeeds
- Dave: fails at payment (nothing to compensate, first stage failed)
- Eve: fails at inventory (only payment compensated)

Watch the server console to see how events from different orders interleave.

### Manual testing

Submit any order with a specific failure point:

```bash
# Fail at inventory
curl -X POST http://localhost:8003/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "customerId": "cust_test",
    "items": [{"productId": "p1", "name": "Widget", "quantity": 1, "price": 49.99}],
    "shippingAddress": "123 Main St",
    "failAt": "inventory"
  }'

# Get order details
curl http://localhost:8003/orders/<order-id>

# Get event log
curl http://localhost:8003/orders/<order-id>/events

# Reset everything
curl -X POST http://localhost:8003/reset
```

## What to watch for

1. **Shipping failure compensation order.** When shipping fails, inventory compensates before payment. That's because shipping depends on inventory (need items to ship) and inventory depends on payment (need payment before reserving). Undoing goes in reverse.

2. **Payment failure has no compensation.** When the first stage fails, there's nothing to undo. The order just fails immediately. Compare the event count between a payment failure and a shipping failure.

3. **Concurrent order interleaving.** Run `npm run order-pipeline:concurrent` and watch the server console. Events from different orders mix together. Each order's saga runs independently, but the console shows the real-world messiness of parallel processing.

4. **The event log as a source of truth.** Hit `/orders/<id>/events` after a failure. The event sequence tells you exactly what happened and in what order. In event-sourced systems, this log is how you reconstruct state.

## Edge cases worth thinking about

**Compensation itself fails.** This experiment assumes compensation always succeeds. In production, the payment processor might be down when you try to refund. What do you do then? Most systems put failed compensations into a dead letter queue for manual review.

**Partial stage completion.** What if the shipping API accepted the request but crashed before returning the tracking number? The stage handler doesn't know if shipping was created or not. This is the "uncertain" state that makes distributed transactions genuinely hard.

**Notification as a non-compensatable step.** You can't unsend an email. That's why notification runs last. But what if you need to notify the customer that their order was cancelled? That's a new forward action (send cancellation email), not compensation of the original notification.

**Parallel stages.** Payment and inventory don't depend on each other. Running them in parallel would be faster, but if one fails, the other might still be in progress. Do you wait for it to finish before compensating, or cancel it mid-execution?

## What this doesn't cover (on purpose)

**Saga state persistence.** The saga state lives in memory. If the server crashes between completing payment and starting inventory, the order is stuck. Production systems persist saga state to a database so they can resume after recovery.

**Retry before compensate.** A transient shipping API timeout might succeed on retry. This experiment treats every failure as permanent and jumps straight to compensation. A production saga would retry 2-3 times first.

**Shared state between orders.** Each order is fully independent. There's no shared inventory count, so two orders can't conflict. In reality, concurrent orders competing for the last item in stock creates race conditions that need distributed locking or optimistic concurrency.

See [docs/design-decisions.md](docs/design-decisions.md) for the full reasoning behind these choices.

## Lessons learned

1. The stage order isn't arbitrary. It encodes real dependencies and business rules. Changing it changes what compensation has to do and what's at risk if something fails.

2. Compensation is not the same as "undo." A refund is not the reverse of a charge. It's a new transaction that happens to cancel the effect of the original one. This distinction matters when compensations can partially fail.

3. The orchestrator pattern makes the flow easy to follow but creates a central dependency. If the orchestrator goes down, everything stops. Choreography avoids this but trades it for harder debugging (the flow is scattered across multiple services reacting to events).

4. Non-compensatable steps need special treatment. You can't just slap a compensate method on everything. Some actions are permanent, and the saga design needs to account for that by placing them at the end of the pipeline.
