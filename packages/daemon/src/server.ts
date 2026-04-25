import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";

// We can't import from @aether/protocol yet (workspace not linked),
// so inline the types we need for now
interface Hello {
  type: "hello";
  protocolVersion: number;
  clientType: "game" | "extension" | "cli";
  clientName: string;
}

interface Welcome {
  type: "welcome";
  protocolVersion: number;
  clientId: string;
  daemonVersion: string;
}

export interface ConnectedClient {
  id: string;
  name: string;
  type: "game" | "extension" | "cli";
  capabilities: string[];
  state: Record<string, unknown>;
  ws: WebSocket;
  connectedAt: Date;
}

export type MessageHandler = (client: ConnectedClient, msg: Record<string, unknown>) => void;

export class AetherServer {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ConnectedClient>();
  private handlers = new Map<string, MessageHandler>();

  constructor(
    private port: number = 13119,
    private host: string = "0.0.0.0",
  ) {}

  start(): void {
    this.wss = new WebSocketServer({ port: this.port, host: this.host });

    this.wss.on("connection", (ws, req) => {
      const clientId = randomUUID();
      let client: ConnectedClient | null = null;
      console.log(`[ws] New connection from ${req.socket.remoteAddress}:${req.socket.remotePort}`);

      // Wait for hello message
      const helloTimeout = setTimeout(() => {
        console.log(`[ws] No hello from ${clientId} after 5s, closing`);
        ws.close(1008, "No hello received");
      }, 5000);

      ws.on("message", (data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          ws.send(JSON.stringify({ type: "error", error: "invalid_message", message: "Invalid JSON" }));
          return;
        }

        // Handle hello handshake
        if (!client) {
          if (msg.type === "hello") {
            clearTimeout(helloTimeout);
            const hello = msg as unknown as Hello;
            client = {
              id: clientId,
              name: hello.clientName || "unknown",
              type: hello.clientType || "cli",
              capabilities: [],
              state: {},
              ws,
              connectedAt: new Date(),
            };
            this.clients.set(clientId, client);

            const welcome: Welcome = {
              type: "welcome",
              protocolVersion: 1,
              clientId,
              daemonVersion: "0.1.0",
            };
            ws.send(JSON.stringify(welcome));
            console.log(`Client connected: ${client.name} (${client.type}) [${clientId}]`);
          }
          return;
        }

        // Route to registered handler
        const handler = this.handlers.get(msg.type as string);
        if (handler) {
          handler(client, msg);
        } else {
          console.log(`Unhandled message type: ${msg.type}`);
        }
      });

      ws.on("close", () => {
        clearTimeout(helloTimeout);
        if (client) {
          this.clients.delete(client.id);
          console.log(`Client disconnected: ${client.name} [${client.id}]`);
        }
      });

      ws.on("error", (err) => {
        console.error(`WebSocket error for ${client?.name || "unknown"}:`, err.message);
      });
    });

    console.log(`Aether daemon listening on ${this.host}:${this.port}`);
  }

  stop(): void {
    for (const client of this.clients.values()) {
      client.ws.close(1001, "Server shutting down");
    }
    this.clients.clear();
    this.wss?.close();
    console.log("Aether daemon stopped");
  }

  on(messageType: string, handler: MessageHandler): void {
    this.handlers.set(messageType, handler);
  }

  getClient(id: string): ConnectedClient | undefined {
    return this.clients.get(id);
  }

  getClients(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  getClientsByType(type: string): ConnectedClient[] {
    return this.getClients().filter(c => c.type === type);
  }

  send(clientId: string, msg: Record<string, unknown>): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
    client.ws.send(JSON.stringify(msg));
    return true;
  }

  broadcast(msg: Record<string, unknown>, excludeId?: string, filterType?: string): void {
    for (const client of this.clients.values()) {
      if (client.id === excludeId) continue;
      if (filterType && client.type !== filterType) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(msg));
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
