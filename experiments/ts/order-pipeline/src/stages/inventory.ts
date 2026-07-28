import {
  type Order,
  type StageHandler,
  type StageResult,
  type CompensationResult,
} from "../types";

/**
 * Inventory stage.
 *
 * Reserves the ordered items so nobody else can buy them while this order
 * is being fulfilled. This is a "hold" rather than a deduction. The actual
 * stock deduction typically happens when the shipment is confirmed.
 *
 * Compensation: release the hold. The items go back to available stock.
 *
 * In a real system, inventory is one of the hardest stages to get right
 * because of concurrency. Two orders for the last item arrive at the same
 * time: who wins? That's where distributed locking or optimistic concurrency
 * control shows up. We're not modeling that here, but it's worth knowing
 * that this is where real e-commerce systems spend a lot of engineering time.
 */
export class InventoryStage implements StageHandler {
  readonly name = "inventory" as const;
  private delayMs: number;
  private shouldFail: boolean;

  constructor(opts: { delayMs?: number; shouldFail?: boolean } = {}) {
    this.delayMs = opts.delayMs ?? 150;
    this.shouldFail = opts.shouldFail ?? false;
  }

  async execute(order: Order): Promise<StageResult> {
    const start = Date.now();
    await this.delay();

    if (this.shouldFail) {
      const outOfStock = order.items[0]?.name ?? "item";
      return {
        stage: this.name,
        success: false,
        message: `Insufficient stock for "${outOfStock}". Available: 0, requested: ${order.items[0]?.quantity ?? 1}.`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const reservationId = `res_${order.id.slice(0, 8)}_${Date.now()}`;
    const itemSummary = order.items.map((i) => `${i.quantity}x ${i.name}`).join(", ");

    return {
      stage: this.name,
      success: true,
      message: `Reserved ${itemSummary} (hold expires in 30 min)`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      data: { reservationId, items: order.items.map((i) => i.productId) },
    };
  }

  async compensate(order: Order): Promise<CompensationResult> {
    await this.delay();

    const inventoryResult = order.history.find((h) => h.stage === "inventory");
    const resId = inventoryResult?.data?.reservationId ?? "unknown";

    return {
      stage: this.name,
      success: true,
      message: `Released inventory hold (reservation: ${resId}). Items back in available stock.`,
      timestamp: Date.now(),
    };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}
