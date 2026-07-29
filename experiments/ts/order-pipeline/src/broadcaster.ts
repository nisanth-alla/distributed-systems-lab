import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { type PipelineEvent } from "./types";

/**
 * WebSocket broadcaster for the order pipeline.
 * Pushes every pipeline event to connected visualization clients.
 * Same pattern as the rate limiter broadcaster.
 */
export class Broadcaster {
  private wss: WebSocketServer | null = null;

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws) => {
      console.log("[ws] visualization client connected");
      ws.on("close", () => console.log("[ws] visualization client disconnected"));
    });
  }

  emit(event: PipelineEvent): void {
    if (!this.wss) return;
    const message = JSON.stringify(event);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}
