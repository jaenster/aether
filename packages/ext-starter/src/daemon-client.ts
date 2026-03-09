import WebSocket from "ws";
import { EventEmitter } from "node:events";

interface Hello {
  type: "hello";
  protocolVersion: number;
  clientType: "extension";
  clientName: string;
}

interface Welcome {
  type: "welcome";
  protocolVersion: number;
  clientId: string;
  daemonVersion: string;
}

export interface DaemonClientEvents {
  connected: [clientId: string];
  disconnected: [];
  message: [msg: Record<string, unknown>];
  error: [err: Error];
  "game:connected": [clientId: string, clientName: string];
  "game:disconnected": [clientId: string];
}

export class DaemonClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private clientId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(
    private host: string,
    private port: number,
    private autoReconnect = true,
  ) {
    super();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get id(): string | null {
    return this.clientId;
  }

  connect(): void {
    if (this.ws) return;

    const url = `ws://${this.host}:${this.port}`;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      const hello: Hello = {
        type: "hello",
        protocolVersion: 1,
        clientType: "extension",
        clientName: "starter",
      };
      this.ws!.send(JSON.stringify(hello));
    });

    this.ws.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (msg.type === "welcome") {
        const welcome = msg as unknown as Welcome;
        this.clientId = welcome.clientId;
        this.connected = true;
        this.emit("connected", this.clientId);
        this.registerService();
        return;
      }

      if (msg.type === "message:incoming") {
        this.emit("message", msg);
        return;
      }

      this.emit("message", msg);
    });

    this.ws.on("close", () => {
      this.connected = false;
      this.clientId = null;
      this.ws = null;
      this.emit("disconnected");
      if (this.autoReconnect) this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
    });
  }

  disconnect(): void {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Starter shutting down");
      this.ws = null;
    }
    this.connected = false;
    this.clientId = null;
  }

  send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  sendTo(targetId: string, payload: unknown): void {
    this.send({
      type: "message:send",
      targetId,
      payload,
    });
  }

  broadcast(payload: unknown, filterType?: string): void {
    this.send({
      type: "message:broadcast",
      filterType,
      payload,
    });
  }

  updateState(state: Record<string, unknown>): void {
    this.send({
      type: "state:update",
      state,
    });
  }

  private registerService(): void {
    this.send({
      type: "service:register",
      name: "starter",
      capabilities: ["launch", "stop", "restart", "status"],
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log("Reconnecting to daemon...");
      this.connect();
    }, 3000);
  }
}
