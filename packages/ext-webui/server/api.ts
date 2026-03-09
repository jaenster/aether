import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { DaemonClient } from "./daemon-client.js";

interface ClientState {
  clientId: string;
  name: string;
  type: string;
  capabilities: string[];
  state: Record<string, unknown>;
}

interface BridgeState {
  daemonConnected: boolean;
  daemonClientId: string | null;
  clients: ClientState[];
  services: ClientState[];
  messageLog: LogEntry[];
}

interface LogEntry {
  timestamp: number;
  direction: "in" | "out";
  type: string;
  data: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 500;

export class ApiBridge {
  private wss: WebSocketServer;
  private browsers = new Set<WebSocket>();
  private state: BridgeState = {
    daemonConnected: false,
    daemonClientId: null,
    clients: [],
    services: [],
    messageLog: [],
  };

  constructor(
    httpServer: Server,
    private daemon: DaemonClient,
  ) {
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    this.wss.on("connection", (ws) => {
      this.browsers.add(ws);
      ws.send(JSON.stringify({ type: "snapshot", state: this.state }));

      ws.on("message", (data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        this.handleBrowserMessage(msg);
      });

      ws.on("close", () => {
        this.browsers.delete(ws);
      });
    });

    this.setupDaemonListeners();
  }

  private setupDaemonListeners(): void {
    this.daemon.on("connected", (clientId: string) => {
      this.state.daemonConnected = true;
      this.state.daemonClientId = clientId;
      this.broadcastToBrowsers({ type: "daemon:connected", clientId });
    });

    this.daemon.on("disconnected", () => {
      this.state.daemonConnected = false;
      this.state.daemonClientId = null;
      this.state.clients = [];
      this.state.services = [];
      this.broadcastToBrowsers({ type: "daemon:disconnected" });
    });

    this.daemon.on("message", (msg: Record<string, unknown>) => {
      this.logMessage("in", msg);

      switch (msg.type) {
        case "service:discover:result":
          this.handleDiscoverResult(msg);
          break;
        case "state:update":
          this.broadcastToBrowsers({ type: "state:update", data: msg });
          break;
        case "message:incoming":
          this.broadcastToBrowsers({ type: "message:incoming", data: msg });
          break;
        case "script:loaded":
        case "script:error":
          this.broadcastToBrowsers({ type: msg.type as string, data: msg });
          break;
        case "file:invalidate":
          this.broadcastToBrowsers({ type: "file:invalidate", data: msg });
          break;
        case "pong":
          this.broadcastToBrowsers({ type: "pong", data: msg });
          break;
        case "error":
          this.broadcastToBrowsers({ type: "daemon:error", data: msg });
          break;
        default:
          this.broadcastToBrowsers({ type: "daemon:message", data: msg });
          break;
      }
    });
  }

  private handleDiscoverResult(msg: Record<string, unknown>): void {
    const all = (msg.clients || []) as ClientState[];
    this.state.clients = all.filter(c => c.type === "game");
    this.state.services = all.filter(c => c.type !== "game");
    this.broadcastToBrowsers({
      type: "clients:update",
      clients: this.state.clients,
      services: this.state.services,
    });
  }

  private handleBrowserMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "refresh-clients":
        this.daemon.requestDiscovery();
        break;
      case "send-to-client": {
        const targetId = msg.targetId as string;
        const payload = msg.payload;
        if (targetId && payload) {
          this.daemon.sendToClient(targetId, payload);
          this.logMessage("out", {
            type: "message:send",
            targetId,
            payload: payload as Record<string, unknown>,
          });
        }
        break;
      }
      case "broadcast-games": {
        const payload = msg.payload;
        if (payload) {
          this.daemon.broadcastToGames(payload);
          this.logMessage("out", {
            type: "message:broadcast",
            filterType: "game",
            payload: payload as Record<string, unknown>,
          });
        }
        break;
      }
      case "script-reload": {
        const path = msg.path as string | undefined;
        this.daemon.requestScriptReload(path);
        this.logMessage("out", { type: "script:reload", path: path ?? "" });
        break;
      }
      case "file-invalidate": {
        const paths = msg.paths as string[];
        if (paths?.length) {
          this.daemon.invalidateFiles(paths);
          this.logMessage("out", { type: "file:invalidate", paths: paths.join(",") });
        }
        break;
      }
      case "reconnect-daemon":
        this.daemon.disconnect();
        this.daemon.connect();
        break;
      case "ping-daemon":
        this.daemon.send({
          type: "ping",
          id: `ping-${Date.now()}`,
          timestamp: Date.now(),
        });
        this.logMessage("out", { type: "ping" });
        break;
      default:
        this.daemon.send(msg);
        this.logMessage("out", msg);
        break;
    }
  }

  private logMessage(direction: "in" | "out", msg: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      direction,
      type: (msg.type as string) || "unknown",
      data: msg,
    };
    this.state.messageLog.push(entry);
    if (this.state.messageLog.length > MAX_LOG_ENTRIES) {
      this.state.messageLog.shift();
    }
    this.broadcastToBrowsers({ type: "log:entry", entry });
  }

  private broadcastToBrowsers(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);
    for (const ws of this.browsers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json);
      }
    }
  }
}
