import { type PipelineEvent } from "./types";

type Listener = (event: PipelineEvent) => void;

/**
 * Simple in-memory pub/sub event bus.
 *
 * Every pipeline action publishes an event here. Subscribers (the saga
 * orchestrator, the server's order store, the WebSocket broadcaster)
 * all react to the same stream of facts.
 *
 * This is intentionally simple. A production system would use something
 * like Kafka, RabbitMQ, or Redis Streams. The point of this experiment
 * is the saga pattern and compensation logic, not the message broker.
 * An in-memory bus lets us focus on the interesting part.
 *
 * One thing this does share with real event buses: events are broadcast
 * to all subscribers, and subscribers don't affect each other. If the
 * WebSocket broadcaster throws, the saga orchestrator still gets the event.
 */
export class EventBus {
  private listeners: Listener[] = [];
  private history: PipelineEvent[] = [];

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    // Return an unsubscribe function
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  publish(event: PipelineEvent): void {
    this.history.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // Don't let one subscriber break the others
        console.error(`[event-bus] subscriber threw on ${event.type}:`, err);
      }
    }
  }

  /** Get all events for an order, in order. Useful for debugging. */
  getEventsForOrder(orderId: string): PipelineEvent[] {
    return this.history.filter((e) => e.orderId === orderId);
  }

  /** Full event history. */
  getAllEvents(): PipelineEvent[] {
    return [...this.history];
  }

  /** Clear history. Used between test runs. */
  reset(): void {
    this.history = [];
  }
}
