import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve as resolvePath, sep } from "node:path";
import type { AetherServer, ConnectedClient } from "./server.js";
import { bundle } from "./bundler.js";

/** One line kept from a game, with its arrival cursor. */
export interface Line {
  seq: number;
  at: number;
  text: string;
}

interface Ring {
  lines: Line[];
  next: number;
  dropped: number;
}

interface PendingEval {
  clientId: string;
  resolve: (r: EvalResult) => void;
  timer: NodeJS.Timeout;
}

export interface EvalResult {
  ok: boolean;
  result: string;
}

export interface GameInfo {
  clientId: string;
  name: string;
  type: string;
  connectedAt: string;
  /** Milliseconds since the game last reported its state; null when it never did. */
  stateAgeMs: number | null;
  /** The game reported within the last 5 s and its tick count moved. */
  alive: boolean;
  state: Record<string, unknown>;
}

const RING_MAX = 5000;

function newRing(): Ring {
  return { lines: [], next: 1, dropped: 0 };
}

function push(ring: Ring, text: string): void {
  ring.lines.push({ seq: ring.next++, at: Date.now(), text });
  if (ring.lines.length > RING_MAX) ring.lines.splice(0, ring.lines.length - RING_MAX);
}

/**
 * What the daemon knows about each connected game beyond the file protocol:
 * the eval round trip, the forwarded log lines, the state heartbeat and the
 * messages scripts send with daemonSend().
 */
export class GameLink {
  private logs = new Map<string, Ring>();
  private messages = new Map<string, Ring>();
  private stateAt = new Map<string, { at: number; ticks: number; moved: boolean }>();
  private pending = new Map<string, PendingEval>();
  private seq = 0;
  private pushSeq = 0;

  constructor(
    private server: AetherServer,
    private scriptRoot: string,
    /** When set, each script message is appended to <dir>/<client name>.jsonl. */
    private messagesDir?: string,
  ) {
    server.on("eval:result", (c, m) => this.onEvalResult(c, m));
    server.on("log", (c, m) => this.onLog(c, m));
    server.on("script:message", (c, m) => this.onScriptMessage(c, m));
    // Registry also handles state:update (it merges the state); this keeps the timing.
    server.onAlso("state:update", (c, m) => this.onState(c, m));
    server.onDisconnect((c) => this.onDisconnect(c));
    if (messagesDir) mkdirSync(messagesDir, { recursive: true });
  }

  games(): GameInfo[] {
    const now = Date.now();
    return this.server.getClientsByType("game").map((c) => {
      const s = this.stateAt.get(c.id);
      const age = s ? now - s.at : null;
      return {
        clientId: c.id,
        name: c.name,
        type: c.type,
        connectedAt: c.connectedAt.toISOString(),
        stateAgeMs: age,
        alive: age !== null && age < 5000 && s!.moved,
        state: c.state,
      };
    });
  }

  /** The game a tool call means: by id or name, or the only one connected. */
  pick(which?: string): ConnectedClient {
    const games = this.server.getClientsByType("game");
    if (which) {
      const hit = games.find((c) => c.id === which || c.name === which);
      if (!hit) throw new Error(`no game client "${which}" (connected: ${games.map((g) => g.name).join(", ") || "none"})`);
      return hit;
    }
    if (games.length === 1) return games[0];
    if (games.length === 0) throw new Error("no game client is connected");
    throw new Error(`${games.length} game clients are connected, name one: ${games.map((g) => g.name).join(", ")}`);
  }

  eval(client: ConnectedClient, code: string, timeoutMs = 5000): Promise<EvalResult> {
    const id = `e${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the game did not answer within ${timeoutMs} ms (it runs evals on its tick: is it frozen, or behind a modal dialog?)`));
      }, timeoutMs);
      this.pending.set(id, { clientId: client.id, resolve, timer });
      if (!this.server.send(client.id, { type: "eval", id, code })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("the game's connection is not open"));
      }
    });
  }

  /** Bundle a script under the scripts root and push it; the game loads it as a hot reload. */
  pushScript(client: ConnectedClient, path: string): { entry: string; modules: number } {
    const root = resolvePath(this.scriptRoot);
    const abs = resolvePath(root, path);
    if (!abs.startsWith(root + sep)) throw new Error("the path leaves the scripts root");
    const result = bundle(abs, this.scriptRoot);
    const id = `push-${++this.pushSeq}`;
    const ok = this.server.send(client.id, {
      type: "file:response",
      id,
      push: true,
      entry: result.entry,
      modules: result.modules.map((m) => ({ specifier: m.specifier, source: m.source })),
    });
    if (!ok) throw new Error("the game's connection is not open");
    return { entry: result.entry, modules: result.modules.length };
  }

  /**
   * The client name a log or message read means. Lines are kept by name, so a
   * client that died can still be read, and one that restarts under the same
   * name continues its lines.
   */
  pickName(which?: string): string {
    const games = this.server.getClientsByType("game");
    if (which) {
      const hit = games.find((c) => c.id === which || c.name === which);
      if (hit) return hit.name;
      if (this.logs.has(which) || this.messages.has(which)) return which;
      throw new Error(`no game client "${which}", connected or gone`);
    }
    if (games.length === 1) return games[0].name;
    const known = new Set([...this.logs.keys(), ...this.messages.keys()]);
    if (games.length === 0 && known.size === 1) return [...known][0];
    if (games.length === 0 && known.size === 0) throw new Error("no game client has connected");
    throw new Error(`name a client: ${[...new Set([...games.map((g) => g.name), ...known])].join(", ")}`);
  }

  logLines(name: string, since = 0): { lines: Line[]; dropped: number } {
    const r = this.logs.get(name) ?? newRing();
    return { lines: r.lines.filter((l) => l.seq > since), dropped: r.dropped };
  }

  scriptMessages(name: string, since = 0): Line[] {
    const r = this.messages.get(name) ?? newRing();
    return r.lines.filter((l) => l.seq > since);
  }

  private onEvalResult(_c: ConnectedClient, m: Record<string, unknown>): void {
    const p = this.pending.get(String(m.id));
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(String(m.id));
    p.resolve({ ok: m.ok === true, result: String(m.result ?? "") });
  }

  private onLog(c: ConnectedClient, m: Record<string, unknown>): void {
    const ring = this.logs.get(c.name) ?? newRing();
    this.logs.set(c.name, ring);
    for (const l of (m.lines as unknown[]) ?? []) push(ring, String(l));
    if (typeof m.dropped === "number") ring.dropped += m.dropped;
  }

  private onScriptMessage(c: ConnectedClient, m: Record<string, unknown>): void {
    const ring = this.messages.get(c.name) ?? newRing();
    this.messages.set(c.name, ring);
    const text = String(m.payload ?? "");
    push(ring, text);
    if (this.messagesDir) {
      const safe = c.name.replace(/[^A-Za-z0-9_.-]/g, "_");
      appendFileSync(join(this.messagesDir, `${safe}.jsonl`), text.replace(/\n/g, " ") + "\n");
    }
  }

  private onState(c: ConnectedClient, m: Record<string, unknown>): void {
    const s = (m.state ?? {}) as Record<string, unknown>;
    const ticks = Number(s.gameTicks ?? 0) + Number(s.oogTicks ?? 0);
    const prev = this.stateAt.get(c.id);
    this.stateAt.set(c.id, { at: Date.now(), ticks, moved: prev ? ticks !== prev.ticks : true });
  }

  private onDisconnect(c: ConnectedClient): void {
    for (const [id, p] of this.pending) {
      if (p.clientId !== c.id) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.resolve({ ok: false, result: "the game disconnected before it answered" });
    }
    this.stateAt.delete(c.id);
    // logs and messages stay: they are what is left of a client that died
  }
}
