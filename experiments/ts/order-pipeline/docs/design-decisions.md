# Design Decisions: Order Pipeline

## Why a saga?

An order that touches multiple services (payment, inventory, shipping) can't use a regular database transaction. Each service has its own data store. There's no single `BEGIN` / `COMMIT` that spans all of them.

The saga pattern solves this by breaking the overall transaction into a sequence of local transactions, each with a compensating action that undoes it. If step 3 fails, you run the compensations for steps 2 and 1 in reverse.

The alternative to a saga is "just don't distribute it." Keep everything in one service with one database and use a regular ACID transaction. That's simpler and you should prefer it when possible. The saga becomes necessary when the services genuinely need to be separate (different teams, different scaling requirements, third-party APIs you don't control).

## Orchestration vs choreography

There are two ways to coordinate a saga:

**Orchestration:** One central coordinator (the saga orchestrator) tells each service what to do, waits for the result, and decides what happens next. This is what this experiment implements.

**Choreography:** Each service listens for events and reacts independently. Payment completes and publishes "payment.completed." Inventory hears that event and starts its work. When it's done, it publishes "inventory.reserved." Shipping hears that and starts its work. No central coordinator.

I picked orchestration because:

1. The compensation chain is visible in one place. You can read the saga.ts file and see exactly what happens when shipping fails.
2. Debugging is straightforward. There's one execution log per order, not events scattered across services.
3. For learning, it's easier to follow a linear flow than a web of reactive listeners.

The downside: the orchestrator is a single point of failure. If it crashes between running a stage and recording the result, the order is stuck. In production, you'd persist the saga state to a database so it can recover and resume after a crash.

## Stage order matters

The stages run in this order for a reason:

1. **Payment** first because it's the commitment point. Until you take payment, nothing real has happened.
2. **Inventory** after payment because you only want to reserve stock for paid orders.
3. **Shipping** after inventory because you can only ship what's in stock.
4. **Notification** last because it's not compensatable (can't unsend an email) and depends on the results of all earlier stages (needs tracking number).

If you reversed payment and inventory (reserve first, pay second), you'd hold stock for orders that might never pay. That's a business decision, not a technical one. Some systems do it that way intentionally (hold for 15 minutes while the user enters payment info). The point is that the order you choose has real consequences.

## Compensation order matters too

Compensations run in reverse: the last completed stage compensates first, then the one before it, all the way back to the first.

Why reverse? Dependencies. If shipping created a label, you need to cancel the shipment before releasing inventory (otherwise the carrier might pick up items that are no longer reserved). If you refunded payment before releasing inventory, you'd have unreserved items that nobody paid for sitting in limbo.

## Failure injection through the API

Instead of hardcoding failures, the API accepts a `failAt` parameter on order creation. This lets the test scripts trigger specific failure scenarios without changing server code.

The alternative was environment variables or config files. The per-request approach is better for experimentation because you can submit five orders in parallel with different failure points and see all the behaviors side by side.

## What compensation can't fix

This experiment models a simple case where compensation always succeeds. Real systems hit cases where it doesn't:

- **Payment refund fails** because the payment processor is down. Now you've shipped an item to someone you couldn't refund.
- **Inventory release partially fails** because the database had a conflict.
- **Shipping cancellation is too late** because the package already left the warehouse.

Production systems handle this with a dead letter queue. Failed compensations go into a queue for manual review, with enough context (order ID, what succeeded, what failed, what was already compensated) for an operator to fix it by hand.

## In-memory event bus

The event bus is a simple pub/sub in process memory. Every subscriber gets every event synchronously (though the stage handlers themselves are async).

In production, this would be Kafka, RabbitMQ, or AWS EventBridge. The in-memory version keeps the experiment focused on the saga pattern rather than message broker configuration. The interface is identical: publish events, subscribe to events.

## What I'd add next

1. **Saga state persistence.** Store the saga's progress in a database so it survives crashes and can resume from where it left off.
2. **Retry before compensate.** Some stage failures are transient (payment processor timeout). Retrying 2-3 times before giving up and compensating would be more realistic.
3. **Dead letter queue for failed compensations.** Log them with full context for manual intervention.
4. **Parallel stage execution.** Payment and inventory don't actually depend on each other. Running them in parallel and only proceeding to shipping when both succeed would be faster. But it also makes the compensation logic more complex (two compensations might run concurrently).
