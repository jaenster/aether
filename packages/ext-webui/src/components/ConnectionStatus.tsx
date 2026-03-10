import React from "react";

interface Props {
  browserConnected: boolean;
  daemonConnected: boolean;
  clientCount: number;
  onReconnect: () => void;
  onRefresh: () => void;
  onPing: () => void;
}

export function ConnectionStatus({ browserConnected, daemonConnected, clientCount, onReconnect, onRefresh, onPing }: Props) {
  let statusClass = "status-dot";
  let statusText = "Connecting...";

  if (!browserConnected) {
    statusText = "Disconnected from backend";
  } else if (daemonConnected) {
    statusClass += " connected";
    statusText = `Connected to daemon (${clientCount} client${clientCount !== 1 ? "s" : ""})`;
  } else {
    statusText = "Backend connected, daemon disconnected";
  }

  return (
    <div className="header">
      <h1>Aether Dashboard</h1>
      <span className={statusClass} />
      <span className="status-text">{statusText}</span>
      <div className="btn-row">
        <button onClick={onReconnect}>Reconnect Daemon</button>
        <button onClick={onRefresh}>Refresh Clients</button>
        <button onClick={onPing}>Ping</button>
      </div>
    </div>
  );
}
