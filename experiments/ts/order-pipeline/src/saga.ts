import { EventBus } from "./event-bus";
import {
  type Order,
  type StageHandler,
  type StageName,
  type FailureConfig,
} from "./types";

/**
 * Saga orchestrator.
 *
 * Runs each stage in sequence. If all succeed, the order is completed.
 * If any stage fails, compensation runs in reverse through every stage
 * that already succeeded.
 *
 * This is the "orchestration" approach to sagas, where one coordinator
 * drives the whole flow. The alternative is "choreography," where each
 * stage listens for events and decides what to do next on its own.
 *
 * Orchestration is simpler to reason about and debug (one place to look),
 * but creates a single point of failure (if the orchestrator crashes mid-saga,
 * the order is stuck). Choreography is more resilient but harder to trace
 * because the flow is spread across multiple services.
 *
 * For this experiment, orchestration makes the compensation chain easier
 * to see and understand.
 */
export class SagaOrchestrator {
  private stages: StageHandler[];
  private eventBus: EventBus;
  private orders: Map<string, Order> = new Map();

  constructor(stages: StageHandler[], eventBus: EventBus) {
    this.stages = stages;
    this.eventBus = eventBus;
  }

  /**
   * Execute the full saga for an order.
   *
   * Stages run in sequence. If a stage fails, we stop forward progress
   * and run compensation on everything that already completed.
   *
   * The method returns the final order state regardless of success or failure.
   */
  async execute(order: Order, failureConfig?: FailureConfig): Promise<Order> {
    this.orders.set(order.id, order);
    order.status = "processing";
    order.updatedAt = Date.now();

    this.eventBus.publish({
      type: "order.created",
      orderId: order.id,
      timestamp: Date.now(),
      order: { ...order },
    });

    // Track which stages completed so we know what to compensate
    const completedStages: StageName[] = [];

    for (const stage of this.stages) {
      this.eventBus.publish({
        type: "stage.started",
        orderId: order.id,
        timestamp: Date.now(),
        stage: stage.name,
      });

      // Check if this stage should be injected with a failure
      const shouldFail = failureConfig?.failAt === stage.name;

      // Run the stage
      // Each stage handler checks its own shouldFail flag, but we also
      // support per-order failure injection through the failure config.
      // The stage constructor sets permanent behavior; the failure config
      // overrides it for specific orders.
      let result;
      try {
        if (shouldFail) {
          // Force failure by creating a temporary failing instance
          const FailingStage = stage.constructor as new (opts: {
            delayMs?: number;
            shouldFail?: boolean;
          }) => StageHandler;
          const failingInstance = new FailingStage({
            delayMs: failureConfig?.stageDelayMs,
            shouldFail: true,
          });
          result = await failingInstance.execute(order);
        } else {
          result = await stage.execute(order);
        }
      } catch (err) {
        // Unexpected error (not a controlled failure)
        result = {
          stage: stage.name,
          success: false,
          message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
          durationMs: 0,
        };
      }

      order.history.push(result);
      order.updatedAt = Date.now();

      if (result.success) {
        completedStages.push(stage.name);
        this.eventBus.publish({
          type: "stage.completed",
          orderId: order.id,
          timestamp: Date.now(),
          stage: stage.name,
          result,
        });
      } else {
        // Stage failed. Stop forward progress.
        order.failedAt = stage.name;
        order.failureReason = result.message;

        this.eventBus.publish({
          type: "stage.failed",
          orderId: order.id,
          timestamp: Date.now(),
          stage: stage.name,
          error: result.message,
        });

        // Run compensation on stages that already completed, in reverse order.
        // This is the heart of the saga pattern.
        if (completedStages.length > 0) {
          await this.compensate(order, completedStages);
        } else {
          // Nothing to compensate. First stage failed.
          order.status = "failed";
          order.updatedAt = Date.now();
        }

        this.eventBus.publish({
          type: "order.failed",
          orderId: order.id,
          timestamp: Date.now(),
          failedAt: stage.name,
          reason: result.message,
          compensationsRun: completedStages,
        });

        return order;
      }
    }

    // All stages succeeded
    order.status = "completed";
    order.updatedAt = Date.now();

    this.eventBus.publish({
      type: "order.completed",
      orderId: order.id,
      timestamp: Date.now(),
    });

    return order;
  }

  /**
   * Run compensation for completed stages in reverse order.
   *
   * Why reverse? Because stages often depend on earlier stages.
   * Shipping depends on inventory (need items to ship). Inventory
   * depends on payment (need payment before reserving). So when
   * undoing, you cancel the shipment first, then release inventory,
   * then refund payment. If you refunded first and then tried to
   * cancel the shipment, the carrier might say "too late, it shipped."
   */
  private async compensate(order: Order, completedStages: StageName[]): Promise<void> {
    order.status = "compensating";
    order.updatedAt = Date.now();

    // Reverse the completed stages
    const toCompensate = [...completedStages].reverse();

    for (const stageName of toCompensate) {
      const stage = this.stages.find((s) => s.name === stageName);
      if (!stage) continue;

      this.eventBus.publish({
        type: "compensation.started",
        orderId: order.id,
        timestamp: Date.now(),
        stage: stageName,
      });

      try {
        const result = await stage.compensate(order);
        order.compensations.push(result);

        this.eventBus.publish({
          type: "compensation.completed",
          orderId: order.id,
          timestamp: Date.now(),
          stage: stageName,
          result,
        });
      } catch (err) {
        // Compensation itself failed. This is the scary scenario.
        // In production, this goes to a dead letter queue for manual review.
        const failResult = {
          stage: stageName,
          success: false,
          message: `Compensation failed: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        };
        order.compensations.push(failResult);

        this.eventBus.publish({
          type: "compensation.completed",
          orderId: order.id,
          timestamp: Date.now(),
          stage: stageName,
          result: failResult,
        });
      }
    }

    order.status = "compensated";
    order.updatedAt = Date.now();
  }

  /** Get an order by ID */
  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  /** Get all orders */
  getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  /** Clear all orders. Used between test runs. */
  reset(): void {
    this.orders.clear();
  }
}
