import {
  type Order,
  type StageHandler,
  type StageResult,
  type CompensationResult,
} from "../types";

/**
 * Notification stage.
 *
 * Sends a confirmation email/SMS to the customer. This is the final stage
 * in the happy path. It runs after payment, inventory, and shipping all
 * succeed.
 *
 * This stage is interesting from a saga perspective because its compensation
 * is basically a no-op. You can't unsend an email. You could send a follow-up
 * "sorry, your order was cancelled" email, but that's a new action, not an
 * undo. Most saga implementations treat notification as a "non-compensatable"
 * step and only run it after all compensatable steps have succeeded.
 *
 * In this experiment, notification runs last specifically because of this.
 * If notification itself fails, there's nothing to compensate upstream
 * since the order is already fulfilled. You'd just retry the notification
 * or mark it as "notification failed" and move on.
 */
export class NotificationStage implements StageHandler {
  readonly name = "notification" as const;
  private delayMs: number;
  private shouldFail: boolean;

  constructor(opts: { delayMs?: number; shouldFail?: boolean } = {}) {
    this.delayMs = opts.delayMs ?? 100;
    this.shouldFail = opts.shouldFail ?? false;
  }

  async execute(order: Order): Promise<StageResult> {
    const start = Date.now();
    await this.delay();

    if (this.shouldFail) {
      return {
        stage: this.name,
        success: false,
        message: `Failed to send confirmation to customer ${order.customerId}. Email service returned 503.`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    // Pull tracking number from earlier stage results
    const shippingResult = order.history.find((h) => h.stage === "shipping");
    const tracking = shippingResult?.data?.trackingNumber ?? "pending";

    return {
      stage: this.name,
      success: true,
      message: `Confirmation sent to customer ${order.customerId}: order ${order.id}, tracking ${tracking}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      data: { channel: "email", recipient: order.customerId },
    };
  }

  async compensate(_order: Order): Promise<CompensationResult> {
    // Notification compensation is a no-op. Can't unsend an email.
    // In a real system, you might send a cancellation notice instead,
    // but that's a forward action, not a rollback.
    return {
      stage: this.name,
      success: true,
      message: "No compensation needed. Notifications are not reversible.",
      timestamp: Date.now(),
    };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}
