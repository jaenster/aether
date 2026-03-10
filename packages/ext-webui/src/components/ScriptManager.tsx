import React, { useState } from "react";

interface Props {
  onReload: (path?: string) => void;
}

export function ScriptManager({ onReload }: Props) {
  const [path, setPath] = useState("");

  const handleReload = () => {
    onReload(path || undefined);
    setPath("");
  };

  return (
    <div className="panel">
      <h2>Scripts</h2>
      <div className="send-form">
        <input
          type="text"
          placeholder="Script path (blank for all)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button onClick={handleReload}>Reload</button>
      </div>
    </div>
  );
}
