import React, { useState, useMemo } from "react";
import type { ClientInfo, StarterState, StarterInstance } from "../types";

interface Props {
  services: ClientInfo[];
  sendToClient: (targetId: string, payload: unknown) => void;
}

function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

export function StarterPanel({ services, sendToClient }: Props) {
  const [count, setCount] = useState(1);

  const starter = useMemo(
    () => services.find((s) => s.name === "starter" && s.capabilities?.includes("launch")),
    [services],
  );

  const starterState = starter?.state as StarterState | undefined;
  const instances: StarterInstance[] = starterState?.instances ?? [];
  const runningCount = starterState?.running ?? 0;

  if (!starter) {
    return (
      <div className="panel">
        <h2>Game Launcher</h2>
        <p className="empty-state">
          Starter service not connected. Launch{" "}
          <code>aether-starter start</code> to enable game management.
        </p>
      </div>
    );
  }

  const handleLaunch = () => {
    sendToClient(starter.clientId, { action: "launch", count });
  };

  const handleStopAll = () => {
    sendToClient(starter.clientId, { action: "stop", all: true });
  };

  const handleStop = (pid: number) => {
    sendToClient(starter.clientId, { action: "stop", pid });
  };

  const handleRestart = (pid: number) => {
    sendToClient(starter.clientId, { action: "restart", pid });
  };

  return (
    <div className="panel">
      <h2>Game Launcher</h2>
      <div className="starter-controls">
        <div className="btn-row">
          <label className="starter-label">
            Count:
            <input
              type="number"
              className="starter-count"
              min={1}
              max={8}
              value={count}
              onChange={(e) => setCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </label>
          <button className="btn-launch" onClick={handleLaunch}>Launch Game</button>
          <button className="btn-stop" onClick={handleStopAll} disabled={runningCount === 0}>
            Stop All ({runningCount})
          </button>
        </div>
      </div>

      {instances.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>PID</th>
              <th>Status</th>
              <th>Uptime</th>
              <th>Restarts</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((inst) => (
              <tr key={inst.pid}>
                <td>{inst.pid}</td>
                <td>
                  <span className={`tag ${inst.status === "running" ? "game" : inst.status === "crashed" ? "crashed" : ""}`}>
                    {inst.status}
                  </span>
                </td>
                <td>{formatUptime(inst.uptimeMs)}</td>
                <td>{inst.restartCount}</td>
                <td>
                  <div className="btn-row">
                    {inst.status === "running" && (
                      <>
                        <button onClick={() => handleStop(inst.pid)}>Stop</button>
                        <button onClick={() => handleRestart(inst.pid)}>Restart</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
