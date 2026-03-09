import React, { useState } from "react";
import type { ClientInfo } from "../types";

interface Props {
  clients: ClientInfo[];
  onSend: (targetId: string, payload: unknown) => void;
}

export function CommandSender({ clients, onSend }: Props) {
  const [target, setTarget] = useState("");
  const [payload, setPayload] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !payload.trim()) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed = payload;
    }

    onSend(target, parsed);
    setPayload("");
  };

  return (
    <div className="panel full-width">
      <h2>Send Command</h2>
      <form className="send-form" onSubmit={handleSubmit}>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">-- select target --</option>
          {clients.map((c) => (
            <option key={c.clientId} value={c.clientId}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder='JSON payload, e.g. {"action":"test"}'
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
