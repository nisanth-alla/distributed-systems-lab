/**
 * Types for the order pipeline.
 *
 * An order flows through four stages: payment, inventory, shipping, notification.
 * Each stage can succeed or fail. If a stage fails after earlier stages succeeded,
 * the saga orchestrator runs compensation in reverse order to undo what was done.
 *
 * Real-world example: you buy something online. Payment goes through. Inventory
 * is reserved. Then shipping discovers the item can't ship to your address.
 * Now what? The system needs to release the inventory hold and refund the payment.
 * That's compensation.
 */

// --- Order ---

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  total: number;
  shippingAddress: string;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  /** What happened at each stage, in order */
  history: StageResult[];
  /** If the saga had to compensate, what happened during rollback */
  compensations: CompensationResult[];
  /** Which stage caused the failure, if any */
  failedAt?: StageName;
  /** The error message from the failed stage */
  failureReason?: string;
}

export type OrderStatus =
  | "created"
  | "processing"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated";

// --- Stages ---

export type StageName = "payment" | "inventory" | "shipping" | "notification";

export interface StageResult {
  stage: StageName;
  success: boolean;
  message: string;
  timestamp: number;
  durationMs: number;
  /** Data produced by this stage (payment ID, tracking number, etc.) */
  data?: Record<string, unknown>;
}

export interface CompensationResult {
  stage: StageName;
  success: boolean;
  message: string;
  timestamp: number;
}

// --- Events ---

/**
 * Every action in the pipeline produces an event. The event bus distributes
 * them to subscribers. The server and visualization consume them.
 *
 * Events are facts about what happened, not commands about what should happen.
 * "payment.completed" means payment was taken. "payment.compensated" means
 * the refund went through. This distinction matters for event sourcing:
 * you could rebuild the entire order state by replaying these events.
 */
export type PipelineEvent =
  | OrderCreatedEvent
  | StageStartedEvent
  | StageCompletedEvent
  | StageFailedEvent
  | CompensationStartedEvent
  | CompensationCompletedEvent
  | OrderCompletedEvent
  | OrderFailedEvent;

interface BaseEvent {
  orderId: string;
  timestamp: number;
}

export interface OrderCreatedEvent extends BaseEvent {
  type: "order.created";
  order: Order;
}

export interface StageStartedEvent extends BaseEvent {
  type: "stage.started";
  stage: StageName;
}

export interface StageCompletedEvent extends BaseEvent {
  type: "stage.completed";
  stage: StageName;
  result: StageResult;
}

export interface StageFailedEvent extends BaseEvent {
  type: "stage.failed";
  stage: StageName;
  error: string;
}

export interface CompensationStartedEvent extends BaseEvent {
  type: "compensation.started";
  stage: StageName;
}

export interface CompensationCompletedEvent extends BaseEvent {
  type: "compensation.completed";
  stage: StageName;
  result: CompensationResult;
}

export interface OrderCompletedEvent extends BaseEvent {
  type: "order.completed";
}

export interface OrderFailedEvent extends BaseEvent {
  type: "order.failed";
  failedAt: StageName;
  reason: string;
  compensationsRun: StageName[];
}

// --- Stage handler interface ---

/**
 * Each stage implements this interface. The execute method does the work.
 * The compensate method undoes it. Not every stage has a meaningful
 * compensation (notification doesn't, for example, since you can't unsend
 * an email in most systems).
 */
export interface StageHandler {
  name: StageName;
  execute(order: Order): Promise<StageResult>;
  compensate(order: Order): Promise<CompensationResult>;
}

// --- Failure injection ---

/**
 * Controls which stages should fail and how. Passed when creating an order
 * so you can trigger specific failure scenarios from the scripts.
 */
export interface FailureConfig {
  /** Which stage should fail */
  failAt?: StageName;
  /** Artificial delay in ms added to each stage (simulates network/processing time) */
  stageDelayMs?: number;
}
