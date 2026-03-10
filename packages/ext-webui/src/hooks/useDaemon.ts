import { useState, useEffect, useCallback, useRef } from "react";
import type { BridgeState, ClientInfo, LogEntry } from "../types";

const MAX_LOG_ENTRIES = 500;

interface DaemonHook {
  connected: boolean;
  state: BridgeState;
  send: (msg: Record<string, unknown>) => void;
  refreshClients: () => void;
  reconnectDaemon: () => void;
  pingDaemon: () => void;
  reloadScripts: (path?: string) => void;
  sendToClient: (targetId: string, payload: unknown) => void;
  broadcastGames: (payload: unknown) => void;
  clearLog: () => void;
}

const emptyState: BridgeState = {
  daemonConnected: false,
  daemonClientId: null,
  clients: [],
  services: [],
  messageLog: [],
};

export function useDaemon(): DaemonHook {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<BridgeState>(emptyState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {};

    ws.onmessage = (evt) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      handleMessage(msg);
    };
  }, []);

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    switch (msg.type) {
      case "snapshot":
        setState(msg.state as BridgeState);
        break;
      case "daemon:connected":
        setState((prev) => ({ ...prev, daemonConnected: true, daemonClientId: msg.clientId as string }));
        break;
      case "daemon:disconnected":
        setState((prev) => ({
          ...prev,
          daemonConnected: false,
          daemonClientId: null,
          clients: [],
          services: [],
        }));
        break;
      case "clients:update":
        setState((prev) => ({
          ...prev,
          clients: (msg.clients || []) as ClientInfo[],
          services: (msg.services || []) as ClientInfo[],
        }));
        break;
      case "log:entry":
        setState((prev) => {
          const log = [...prev.messageLog, msg.entry as LogEntry];
          if (log.length > MAX_LOG_ENTRIES) log.shift();
          return { ...prev, messageLog: log };
        });
        break;
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const refreshClients = useCallback(() => send({ type: "refresh-clients" }), [send]);
  const reconnectDaemon = useCallback(() => send({ type: "reconnect-daemon" }), [send]);
  const pingDaemon = useCallback(() => send({ type: "ping-daemon" }), [send]);
  const reloadScripts = useCallback((path?: string) => send({ type: "script-reload", ...(path ? { path } : {}) }), [send]);
  const sendToClient = useCallback((targetId: string, payload: unknown) => send({ type: "send-to-client", targetId, payload }), [send]);
  const broadcastGames = useCallback((payload: unknown) => send({ type: "broadcast-games", payload }), [send]);
  const clearLog = useCallback(() => setState((prev) => ({ ...prev, messageLog: [] })), []);

  return {
    connected,
    state,
    send,
    refreshClients,
    reconnectDaemon,
    pingDaemon,
    reloadScripts,
    sendToClient,
    broadcastGames,
    clearLog,
  };
}
