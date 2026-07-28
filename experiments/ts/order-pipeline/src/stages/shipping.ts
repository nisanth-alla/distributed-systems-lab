import {
  type Order,
  type StageHandler,
  type StageResult,
  type CompensationResult,
} from "../types";

/**
 * Shipping stage.
 *
 * Creates a shipment with the carrier and gets a tracking number.
 * This is the stage we deliberately fail in the main failure scenario
 * because it creates the most interesting compensation chain: payment
 * was already charged, inventory was already reserved, and now we need
 * to undo both.
 *
 * Common real-world failure reasons:
 * - Address validation failed (can't ship to a PO Box)
 * - Carrier API is down
 * - Item is too heavy or oversized for the selected shipping method
 * - Destination country restrictions
 *
 * Compensation: cancel the shipment if a label was already created.
 * In practice, if the shipment already left the warehouse, compensation
 * gets much harder. That's a whole separate problem (returns, RMA flow).
 */
export class ShippingStage implements StageHandler {
  readonly name = "shipping" as const;
  private delayMs: number;
  private shouldFail: boolean;

  constructor(opts: { delayMs?: number; shouldFail?: boolean } = {}) {
    this.delayMs = opts.delayMs ?? 300;
    this.shouldFail = opts.shouldFail ?? false;
  }

  async execute(order: Order): Promise<StageResult> {
    const start = Date.now();
    await this.delay();

    if (this.shouldFail) {
      return {
        stage: this.name,
        success: false,
        message: `Shipping validation failed: address "${order.shippingAddress}" is not serviceable by any available carrier.`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const trackingNumber = `TRK${Date.now().toString(36).toUpperCase()}`;

    return {
      stage: this.name,
      success: true,
      message: `Shipment created to "${order.shippingAddress}". Tracking: ${trackingNumber}. Estimated delivery: 3-5 business days.`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      data: { trackingNumber, carrier: "FastShip", estimatedDays: 4 },
    };
  }

  async compensate(order: Order): Promise<CompensationResult> {
    await this.delay();

    const shippingResult = order.history.find((h) => h.stage === "shipping");
    const tracking = shippingResult?.data?.trackingNumber;

    if (!tracking) {
      return {
        stage: this.name,
        success: true,
        message: "No shipment was created. Nothing to cancel.",
        timestamp: Date.now(),
      };
    }

    return {
      stage: this.name,
      success: true,
      message: `Shipment ${tracking} cancelled before dispatch.`,
      timestamp: Date.now(),
    };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}
