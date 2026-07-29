import {
  type Order,
  type StageHandler,
  type StageResult,
  type CompensationResult,
} from "../types";

/**
 * Payment stage.
 *
 * Charges the customer for the order total. In a real system this would
 * call Stripe, Adyen, or whatever payment processor you use. The charge
 * returns a transaction ID that gets stored on the order.
 *
 * Compensation: issue a refund using the stored transaction ID.
 * This is why we save the transaction ID in the stage result. Without it,
 * the compensation handler wouldn't know what to refund.
 */
export class PaymentStage implements StageHandler {
  readonly name = "payment" as const;
  private delayMs: number;
  private shouldFail: boolean;

  constructor(opts: { delayMs?: number; shouldFail?: boolean } = {}) {
    this.delayMs = opts.delayMs ?? 200;
    this.shouldFail = opts.shouldFail ?? false;
  }

  async execute(order: Order): Promise<StageResult> {
    const start = Date.now();
    await this.delay();

    if (this.shouldFail) {
      return {
        stage: this.name,
        success: false,
        message: `Payment declined for $${order.total.toFixed(2)}. Card issuer returned: insufficient funds.`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    // Simulate a payment processor response
    const transactionId = `txn_${order.id.slice(0, 8)}_${Date.now()}`;

    return {
      stage: this.name,
      success: true,
      message: `Charged $${order.total.toFixed(2)} to customer ${order.customerId}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      data: { transactionId, amount: order.total },
    };
  }

  async compensate(order: Order): Promise<CompensationResult> {
    await this.delay();

    // Find the original transaction ID from the stage history
    const paymentResult = order.history.find((h) => h.stage === "payment");
    const txnId = paymentResult?.data?.transactionId ?? "unknown";

    return {
      stage: this.name,
      success: true,
      message: `Refund issued for $${order.total.toFixed(2)} (original transaction: ${txnId})`,
      timestamp: Date.now(),
    };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}
