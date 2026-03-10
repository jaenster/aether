export interface PingRequest {
  type: "ping";
  id: string;
  timestamp: number;
}

export interface PongResponse {
  type: "pong";
  id: string;
  timestamp: number;
  serverTime: number;
}

export interface DaemonStatus {
  type: "daemon:status";
  connectedClients: number;
  uptime: number;
  scriptCacheSize: number;
}
