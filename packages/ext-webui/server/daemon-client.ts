import WebSocket from "ws";
import { EventEmitter } from "node:events";

export interface DaemonClientEvents {
  connected: [clientId: string];
  disconnected: [];
  message: [msg: Record<string, unknown>];
  error: [err: Error];
}

export class DaemonClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private clientId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(
    private daemonUrl: string,
    private reconnectInterval = 3000,
  ) {
    super();
  }

  connect(): void {
    this.intentionalClose = false;
    this.ws = new WebSocket(this.daemonUrl);

    this.ws.on("open", () => {
      console.log(`[daemon-client] Connected to ${this.daemonUrl}`);
      this.ws!.send(JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        clientType: "extension",
        clientName: "webui",
      }));
    });

    this.ws.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (msg.type === "welcome") {
        this.clientId = msg.clientId as string;
        console.log(`[daemon-client] Welcome received, clientId: ${this.clientId}`);
        this.emit("connected", this.clientId);
        this.requestDiscovery();
        return;
      }

      this.emit("message", msg);
    });

    this.ws.on("close", () => {
      console.log("[daemon-client] Disconnected from daemon");
      this.clientId = null;
      this.emit("disconnected");
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
    });
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  requestDiscovery(): void {
    this.send({
      type: "service:discover",
      id: `discover-${Date.now()}`,
    });
  }

  sendToClient(targetId: string, payload: unknown): void {
    this.send({
      type: "message:send",
      targetId,
      payload,
    });
  }

  broadcastToGames(payload: unknown): void {
    this.send({
      type: "message:broadcast",
      filterType: "game",
      payload,
    });
  }

  requestScriptReload(path?: string): void {
    this.send({
      type: "script:reload",
      ...(path ? { path } : {}),
    });
  }

  invalidateFiles(paths: string[]): void {
    this.send({
      type: "file:invalidate",
      paths,
    });
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.clientId !== null;
  }

  get id(): string | null {
    return this.clientId;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log(`[daemon-client] Reconnecting in ${this.reconnectInterval}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }
}
