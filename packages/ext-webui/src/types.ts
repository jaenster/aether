export interface ClientInfo {
  clientId: string;
  name: string;
  type: string;
  capabilities: string[];
  state: Record<string, unknown>;
}

export interface LogEntry {
  timestamp: number;
  direction: "in" | "out";
  type: string;
  data: Record<string, unknown>;
}

export interface BridgeState {
  daemonConnected: boolean;
  daemonClientId: string | null;
  clients: ClientInfo[];
  services: ClientInfo[];
  messageLog: LogEntry[];
}

export interface StarterInstance {
  pid: number;
  status: "running" | "exited" | "crashed";
  launchedAt: string;
  restartCount: number;
  uptimeMs: number;
}

export interface StarterState {
  instances: StarterInstance[];
  running: number;
}
