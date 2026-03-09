import React from "react";
import type { ClientInfo } from "../types";

interface Props {
  services: ClientInfo[];
  onReloadScripts: () => void;
}

export function ServiceRegistry({ services, onReloadScripts }: Props) {
  return (
    <div className="panel">
      <h2>Service Registry</h2>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Type</th>
            <th>Capabilities</th>
          </tr>
        </thead>
        <tbody>
          {services.length === 0 ? (
            <tr>
              <td colSpan={3} className="empty-state">No services registered</td>
            </tr>
          ) : (
            services.map((s) => (
              <tr key={s.clientId}>
                <td>{s.name}</td>
                <td><span className={`tag ${s.type}`}>{s.type}</span></td>
                <td>
                  {(s.capabilities || []).map((cap) => (
                    <span key={cap} className="tag">{cap}</span>
                  ))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="btn-row">
        <button onClick={onReloadScripts}>Reload Scripts</button>
      </div>
    </div>
  );
}
