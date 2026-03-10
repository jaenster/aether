import React from "react";
import type { ClientInfo } from "../types";

const DIFFICULTIES = ["Normal", "Nightmare", "Hell"];

interface Props {
  clients: ClientInfo[];
}

export function ClientList({ clients }: Props) {
  return (
    <div className="panel">
      <h2>Game Clients</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>ID</th>
            <th>Character</th>
            <th>Area</th>
            <th>Difficulty</th>
          </tr>
        </thead>
        <tbody>
          {clients.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty-state">No clients connected</td>
            </tr>
          ) : (
            clients.map((c) => {
              const s = c.state || {};
              const area = s.area != null
                ? `Act ${s.act || "?"} - ${s.areaName || s.area}`
                : "-";
              const diff = s.difficulty != null
                ? DIFFICULTIES[s.difficulty as number] ?? String(s.difficulty)
                : "-";
              const charName = (s.characterName || s.name || "-") as string;

              return (
                <tr key={c.clientId}>
                  <td>
                    <span className={`tag ${c.type}`}>{c.type}</span>{" "}
                    {c.name}
                  </td>
                  <td title={c.clientId}>{c.clientId.slice(0, 8)}...</td>
                  <td>{charName}</td>
                  <td>{area}</td>
                  <td>{diff}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
