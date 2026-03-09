import type { AetherServer, ConnectedClient } from "./server.js";

export class Router {
  constructor(private server: AetherServer) {
    server.on("message:send", (client, msg) => this.handleSend(client, msg));
    server.on("message:broadcast", (client, msg) => this.handleBroadcast(client, msg));
    server.on("ping", (client, msg) => this.handlePing(client, msg));
  }

  private handleSend(client: ConnectedClient, msg: Record<string, unknown>): void {
    const targetId = msg.targetId as string;
    if (!targetId) {
      client.ws.send(JSON.stringify({
        type: "error",
        error: "invalid_message",
        message: "Missing targetId",
      }));
      return;
    }

    const target = this.server.getClient(targetId);
    if (!target) {
      client.ws.send(JSON.stringify({
        type: "error",
        error: "target_not_found",
        message: `Client ${targetId} not found`,
      }));
      return;
    }

    this.server.send(targetId, {
      type: "message:incoming",
      fromId: client.id,
      fromName: client.name,
      payload: msg.payload,
    });
  }

  private handleBroadcast(client: ConnectedClient, msg: Record<string, unknown>): void {
    const filterType = msg.filterType as string | undefined;
    this.server.broadcast(
      {
        type: "message:incoming",
        fromId: client.id,
        fromName: client.name,
        payload: msg.payload,
      },
      client.id,
      filterType,
    );
  }

  private handlePing(client: ConnectedClient, msg: Record<string, unknown>): void {
    client.ws.send(JSON.stringify({
      type: "pong",
      id: msg.id,
      timestamp: msg.timestamp,
      serverTime: Date.now(),
    }));
  }
}
