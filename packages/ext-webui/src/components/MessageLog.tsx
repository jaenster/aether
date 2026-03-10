import React, { useState, useRef, useEffect, useMemo } from "react";
import type { LogEntry } from "../types";

interface Props {
  entries: LogEntry[];
  onClear: () => void;
}

export function MessageLog({ entries, onClear }: Props) {
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);

  const filtered = useMemo(() => {
    if (!filter) return entries;
    return entries.filter((e) => e.type.includes(filter));
  }, [entries, filter]);

  useEffect(() => {
    const el = containerRef.current;
    if (el && wasAtBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (el) {
      wasAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    }
  };

  return (
    <div className="panel full-width">
      <h2>Message Log</h2>
      <div className="log-filter">
        <input
          type="text"
          placeholder="Filter by message type..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button onClick={onClear}>Clear</button>
      </div>
      <div className="log-container" ref={containerRef} onScroll={handleScroll}>
        {filtered.map((entry, i) => {
          const time = new Date(entry.timestamp).toLocaleTimeString();
          const arrow = entry.direction === "in" ? "\u2190" : "\u2192";
          const dataStr = JSON.stringify(entry.data);
          const truncated = dataStr.length > 200 ? dataStr.slice(0, 200) + "..." : dataStr;

          return (
            <div key={`${entry.timestamp}-${i}`} className="log-entry">
              <span className="time">{time}</span>
              <span className={`dir ${entry.direction}`}>{arrow}</span>
              <span className="msg-type">{entry.type}</span>
              <span className="msg-data" title={dataStr}>{truncated}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
