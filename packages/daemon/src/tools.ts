import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GameLink } from "./game-link.js";
import type { McpServer, ToolResult } from "./mcp.js";
import { bmpToPng } from "./png.js";

const run = promisify(execFile);

export interface ToolOptions {
  /** The game folder as this machine sees it; screenshots are read from it. */
  gameDir?: string;
  /** Log files on this machine a tool may tail, by name (client=..., crash=...). */
  logFiles: Record<string, string>;
  /** The local stack's game server container, for stack_log. */
  stackGs?: string;
}

function text(t: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) };
}

function json(v: unknown): ToolResult {
  return text(JSON.stringify(v, null, 2));
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

function num(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

function grepLines(lines: string[], pattern?: string): string[] {
  if (!pattern) return lines;
  const re = new RegExp(pattern, "i");
  return lines.filter((l) => re.test(l));
}

const clientProp = {
  client: { type: "string", description: "Client id or name (AETHER_CLIENT_NAME). Optional when one game is connected." },
};

/**
 * What `state` evaluates in the game. Only Aether's own bindings, so it works
 * with any script loaded or none. Returns JSON.
 */
export function stateSnippet(opts: { units?: number[]; items?: boolean; quests?: boolean; ui?: boolean; controls?: boolean; max?: number }): string {
  return `(function (o) {
  function safe(f, d) { try { return f(); } catch (e) { return d; } }
  var r = { inGame: inGame(), tick: getTickCount() };
  if (o.controls || !r.inGame) {
    r.controls = safe(function () { return JSON.parse(oogControlGetAll()); }, "unreadable");
  }
  if (!r.inGame) return JSON.stringify(r);
  var id = meGetUnitId();
  r.me = {
    id: id, name: meGetCharName(), classId: meGetClassId(), level: meGetLevel(),
    area: getArea(), act: getAct(), x: getUnitX(), y: getUnitY(), mode: unitGetMode(0, id),
    hp: getUnitHP(), maxHp: getUnitMaxHP(), mp: getUnitMP(), maxMp: getUnitMaxMP(),
    gold: meGetGold(), goldStash: meGetGoldStash(), rightSkill: getRightSkill()
  };
  r.difficulty = getDifficulty();
  r.mapSeed = safe(getMapSeed, null);
  r.interactedNpc = safe(getInteractedNPC, null);
  if (o.units && o.units.length) {
    r.units = [];
    o.units.forEach(function (t) {
      var n = unitCount(t), ids = [];
      for (var i = 0; i < n; i++) ids.push(unitAtIndex(i));
      ids.slice(0, o.max).forEach(function (u) {
        if (u < 0) return;
        var e = { type: t, id: u, classId: unitGetClassId(t, u), x: unitGetX(t, u), y: unitGetY(t, u), mode: unitGetMode(t, u) };
        if (t === 5) e.dest = safe(function () { return tileGetDestArea(u); }, null);
        if (t === 0 || t === 1) e.name = safe(function () { return unitGetName(t, u); }, null);
        r.units.push(e);
      });
      if (n > o.max) r.units.push({ type: t, more: n - o.max });
    });
  }
  if (o.items) {
    var n = unitCount(4), items = [];
    for (var i = 0; i < n; i++) {
      var g = unitAtIndex(i);
      if (g < 0) continue;
      if (items.length >= o.max) { items.push({ more: n - i }); break; }
      items.push({ id: g, code: itemGetCode(g), owner: unitGetOwnerId(4, g), location: itemGetLocation(g), quality: itemGetQuality(g), x: unitGetX(4, g), y: unitGetY(4, g) });
    }
    r.items = items;
  }
  if (o.quests) {
    var q = {};
    for (var k = 0; k < 41; k++) {
      var w = 0;
      for (var b = 0; b < 16; b++) if (getQuest(k, b)) w |= 1 << b;
      if (w) q[k] = w;
    }
    r.quests = q;
  }
  if (o.ui) {
    var ui = [];
    for (var f = 0; f < 0x28; f++) if (getUIFlag(f)) ui.push(f);
    r.uiFlags = ui;
  }
  return JSON.stringify(r);
})(${JSON.stringify({ units: opts.units ?? [], items: !!opts.items, quests: !!opts.quests, ui: !!opts.ui, controls: !!opts.controls, max: opts.max ?? 60 })})`;
}

/** Clears what a loaded script hooked, so the game runs as if none was loaded. */
export const STOP_SNIPPET = `(function () {
  var names = ["__onTick", "__onOogTick", "__onGameDraw", "__onAutomapDraw", "__onOogDraw", "__onDraw", "__onPacket", "__onPacketOut"];
  var gone = [];
  names.forEach(function (n) { if (typeof globalThis[n] === "function") { delete globalThis[n]; gone.push(n); } });
  return JSON.stringify(gone);
})()`;

let shotSeq = 0;

export function registerTools(mcp: McpServer, link: GameLink, opts: ToolOptions): void {
  mcp.add({
    name: "games",
    description:
      "The d2up test clients connected to this daemon: id, name, when they connected, their last reported state " +
      "(in game, area, tick counts, script loader state, JS heap) and whether they are alive (reported within 5 s with ticks moving). " +
      "A client that stops being alive while its process runs is frozen or behind a modal dialog.",
    inputSchema: { type: "object", properties: {} },
    run: async () => json(link.games()),
  });

  mcp.add({
    name: "eval",
    description:
      "Evaluate JavaScript in a test client's script context on its game thread (next tick) and return the result's string form. " +
      "Every Aether binding is a global (getArea, getUnitX, unitCount, interact, castSkillPacket, findTelePath, getQuest, ...). " +
      "Wrap objects in JSON.stringify. The result is cut at 64 KB. A thrown exception comes back as an error.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "A JavaScript expression or statements; the last value is returned." },
        timeoutMs: { type: "number", description: "How long to wait for the answer (default 5000)." },
        ...clientProp,
      },
      required: ["code"],
    },
    run: async (a) => {
      const code = str(a.code);
      if (!code) throw new Error("code is required");
      const r = await link.eval(link.pick(str(a.client)), code, num(a.timeoutMs, 5000));
      return text(r.result, !r.ok);
    },
  });

  mcp.add({
    name: "state",
    description:
      "Read a test client's game state in one call. Out of game: the menu controls. In game: the player (name, class, level, area, act, " +
      "position, mode, life, mana, gold, right skill), difficulty, map seed and the interacted NPC; optionally units by type " +
      "(0 players, 1 monsters, 2 objects, 3 missiles, 4 items, 5 warps/tiles with their destination area), the items, " +
      "the quest words of the current difficulty (quest id -> 16-bit word, nonzero only) and the open UI flags.",
    inputSchema: {
      type: "object",
      properties: {
        units: { type: "array", items: { type: "number" }, description: "Unit types to list, e.g. [2,5] for objects and warps." },
        max: { type: "number", description: "At most this many units per type (default 60)." },
        items: { type: "boolean", description: "List the items the client knows, with owner and location." },
        quests: { type: "boolean", description: "Include the quest words." },
        ui: { type: "boolean", description: "Include the open UI flags." },
        controls: { type: "boolean", description: "Include the menu controls in game too." },
        ...clientProp,
      },
    },
    run: async (a) => {
      const snippet = stateSnippet({
        units: Array.isArray(a.units) ? (a.units as unknown[]).map(Number).filter(Number.isFinite) : [],
        max: num(a.max, 60),
        items: a.items === true,
        quests: a.quests === true,
        ui: a.ui === true,
        controls: a.controls === true,
      });
      const r = await link.eval(link.pick(str(a.client)), snippet, 8000);
      if (!r.ok) return text(r.result, true);
      try {
        return json(JSON.parse(r.result));
      } catch {
        return text(r.result);
      }
    },
  });

  mcp.add({
    name: "run_script",
    description:
      "Bundle a script under the daemon's scripts folder and push it to a test client, which loads it at once (as a hot reload: " +
      "modules are replaced, globals survive). Use stop_script first to drop the previous script's hooks.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the scripts folder, e.g. tests/act6-smoke.test.ts" }, ...clientProp },
      required: ["path"],
    },
    run: async (a) => {
      const path = str(a.path);
      if (!path) throw new Error("path is required");
      return json(link.pushScript(link.pick(str(a.client)), path));
    },
  });

  mcp.add({
    name: "stop_script",
    description: "Remove the loaded script's tick, draw and packet hooks from a test client. The game keeps running; the script's modules stay loaded but are no longer called.",
    inputSchema: { type: "object", properties: { ...clientProp } },
    run: async (a) => {
      const r = await link.eval(link.pick(str(a.client)), STOP_SNIPPET);
      return text(r.ok ? `removed: ${r.result}` : r.result, !r.ok);
    },
  });

  mcp.add({
    name: "log",
    description:
      "The Aether log lines a test client forwarded (its script's log() calls included), newest last. Pass `since` (the last seq you saw) " +
      "to read only new lines. Kept by client name, so a client that died can still be read. For the full client log or the crash log use log_file.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "number", description: "Only lines after this seq." },
        grep: { type: "string", description: "Case-insensitive regular expression." },
        max: { type: "number", description: "At most this many lines, the newest (default 200)." },
        ...clientProp,
      },
    },
    run: async (a) => {
      const name = link.pickName(str(a.client));
      const { lines, dropped } = link.logLines(name, num(a.since, 0));
      const kept = lines.filter((l) => grepLines([l.text], str(a.grep)).length);
      const max = num(a.max, 200);
      const out = kept.slice(-max).map((l) => `${l.seq} ${new Date(l.at).toISOString().slice(11, 23)} ${l.text}`);
      const head = `client ${name}, ${kept.length} line(s)${kept.length > max ? `, showing the last ${max}` : ""}${dropped ? `, ${dropped} dropped by the game` : ""}`;
      return text([head, ...out].join("\n"));
    },
  });

  mcp.add({
    name: "messages",
    description:
      "What scripts in a test client sent with daemonSend() (test results, host requests), oldest first. Pass `since` to read only new ones.",
    inputSchema: { type: "object", properties: { since: { type: "number" }, ...clientProp } },
    run: async (a) => {
      const name = link.pickName(str(a.client));
      return json(link.scriptMessages(name, num(a.since, 0)));
    },
  });

  const logNames = Object.keys(opts.logFiles);
  mcp.add({
    name: "log_file",
    description:
      "Tail a log file of the test client on this machine (the daemon's --log-file entries: " +
      (logNames.length ? logNames.join(", ") : "none configured") +
      "). This is where a client's last words are when it died: D2OpenGL.log carries the crash: dump and the aether: first-chance fault lines.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: `One of: ${logNames.join(", ") || "(none)"}` },
        lines: { type: "number", description: "The last N lines (default 100)." },
        grep: { type: "string", description: "Case-insensitive regular expression, applied before the tail." },
      },
      required: ["name"],
    },
    run: async (a) => {
      const name = str(a.name) ?? "";
      const path = opts.logFiles[name];
      if (!path) throw new Error(`no log file "${name}" (configured: ${logNames.join(", ") || "none"})`);
      if (!existsSync(path)) return text(`${path} does not exist (yet)`);
      const all = readFileSync(path, "latin1").split(/\r?\n/);
      const lines = grepLines(all, str(a.grep)).slice(-num(a.lines, 100));
      return text(`${path} (${statSync(path).size} bytes)\n${lines.join("\n")}`);
    },
  });

  mcp.add({
    name: "screenshot",
    description:
      "Take a screenshot of a test client's window (what the renderer shows) and return it as an image. Needs the daemon's --game-dir, " +
      "the game folder as this machine sees it, because the client writes the file there.",
    inputSchema: { type: "object", properties: { timeoutMs: { type: "number" }, ...clientProp } },
    run: async (a) => {
      if (!opts.gameDir) throw new Error("the daemon was started without --game-dir, so it cannot read the client's screenshot");
      const client = link.pick(str(a.client));
      const base = `aether-mcp-${process.pid}-${++shotSeq}`;
      const r = await link.eval(client, `takeScreenshot(${JSON.stringify(base)}); "requested"`);
      if (!r.ok) return text(r.result, true);
      const deadline = Date.now() + num(a.timeoutMs, 8000);
      const candidates = [join(opts.gameDir, base + ".png"), join(opts.gameDir, base + ".bmp")];
      while (Date.now() < deadline) {
        for (const p of candidates) {
          if (!existsSync(p)) continue;
          const size = statSync(p).size;
          await new Promise((res) => setTimeout(res, 150));
          if (statSync(p).size !== size || size === 0) continue; // still being written
          const bytes = readFileSync(p);
          const png = p.endsWith(".bmp") ? bmpToPng(bytes) : bytes;
          return { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text: p }] };
        }
        await new Promise((res) => setTimeout(res, 200));
      }
      throw new Error(`no screenshot appeared in ${opts.gameDir} (the client draws it on its next frame; is it in a menu with no frame, or is its host's screenshot not wired?)`);
    },
  });

  mcp.add({
    name: "stack_log",
    description:
      "The local stack's game server log (docker logs of the configured container, this machine's docker only; never prod: prod logs are the cubed logs_query tool). " +
      "Use it after each step of a test to check for halts, asserts and 'unexpected bytes'.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "docker --since: an RFC 3339 time or a duration like 2m (default 10m)." },
        grep: { type: "string", description: "Case-insensitive regular expression." },
        lines: { type: "number", description: "The last N matching lines (default 200)." },
      },
    },
    run: async (a) => {
      if (!opts.stackGs) throw new Error("the daemon was started without --stack-gs <container>");
      const since = str(a.since) ?? "10m";
      if (!/^[0-9A-Za-z:.+\-TZ]+$/.test(since)) throw new Error("since must be a time or a duration");
      const { stdout, stderr } = await run("docker", ["logs", "--since", since, opts.stackGs], { maxBuffer: 64 * 1024 * 1024 });
      const lines = grepLines((stdout + stderr).split(/\r?\n/).filter(Boolean), str(a.grep)).slice(-num(a.lines, 200));
      return text(`${opts.stackGs}, since ${since}: ${lines.length} line(s)\n${lines.join("\n")}`);
    },
  });
}
