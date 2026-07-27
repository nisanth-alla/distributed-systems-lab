import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";

/**
 * Lightweight WebSocket broadcaster for pushing rate limiter events
 * to connected clients in real time. Used by the interactive visualization
 * (Phase 5) to animate requests being allowed/rejected.
 *
 * Same pattern as the broadcaster in system-design-notes/experiments/shared.
 * Keeps the experiment server and the viz layer decoupled: the server doesn't
 * know or care whether anyone is watching.
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

  emit(data: unknown): void {
    if (!this.wss) return;
    const message = JSON.stringify(data);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}
