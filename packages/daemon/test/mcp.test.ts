import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { runInNewContext } from "node:vm";
import WebSocket from "ws";

import { startDaemon, type RunningDaemon } from "../src/daemon.js";
import { McpServer, serveHttp, serveStdio } from "../src/mcp.js";
import { stateSnippet, STOP_SNIPPET } from "../src/tools.js";
import { bmpToPng } from "../src/png.js";

// ── helpers ──────────────────────────────────────────────────────────

function randomPort(): number {
  return 30000 + Math.floor(Math.random() * 20000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A 2x2 24-bit bottom-up BMP: red, green / blue, white (top row first). */
function tinyBmp(): Buffer {
  const stride = 8; // 2 px * 3 bytes, padded to 4
  const pixels = Buffer.alloc(stride * 2);
  // bottom row first: blue, white
  pixels.set([255, 0, 0, 255, 255, 255], 0);
  // top row: red, green (BGR)
  pixels.set([0, 0, 255, 0, 255, 0], stride);
  const h = Buffer.alloc(54);
  h.write("BM", 0, "ascii");
  h.writeUInt32LE(54 + pixels.length, 2);
  h.writeUInt32LE(54, 10);
  h.writeUInt32LE(40, 14);
  h.writeInt32LE(2, 18);
  h.writeInt32LE(2, 22);
  h.writeUInt16LE(1, 26);
  h.writeUInt16LE(24, 28);
  return Buffer.concat([h, pixels]);
}

/**
 * A stand-in for the game side of the connection, speaking what
 * packages/native/src/net/remote.zig speaks.
 */
class FakeGame {
  ws!: WebSocket;
  received: Record<string, unknown>[] = [];
  answerEvals = true;
  ticks = 0;
  constructor(private port: number, public name: string, private gameDir?: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      this.ws.on("error", reject);
      this.ws.on("open", () =>
        this.ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientType: "game", clientName: this.name })),
      );
      this.ws.on("message", (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === "welcome") return resolve();
        this.received.push(m);
        if (m.type === "eval" && this.answerEvals) this.onEval(m);
      });
    });
  }

  private onEval(m: { id: string; code: string }): void {
    let ok = true;
    let result: string;
    if (m.code.startsWith("(function (o)")) {
      result = JSON.stringify({ inGame: true, me: { area: 164, x: 5000, y: 4000 } });
    } else if (m.code.startsWith("takeScreenshot(")) {
      const base = JSON.parse(m.code.slice("takeScreenshot(".length, m.code.indexOf(")")));
      writeFileSync(join(this.gameDir!, base + ".bmp"), tinyBmp());
      result = "requested";
    } else if (m.code === "throw new Error('boom')") {
      ok = false;
      result = "Error: boom";
    } else if (m.code === "1+1") {
      result = "2";
    } else {
      result = `echo:${m.code}`;
    }
    this.ws.send(JSON.stringify({ type: "eval:result", id: m.id, ok, result }));
  }

  state(area: number): void {
    this.ticks += 25;
    this.ws.send(JSON.stringify({ type: "state:update", state: { inGame: true, area, gameTicks: this.ticks, oogTicks: 0, loader: "loaded" } }));
  }

  log(lines: string[]): void {
    this.ws.send(JSON.stringify({ type: "log", lines, dropped: 0 }));
  }

  message(payload: string): void {
    this.ws.send(JSON.stringify({ type: "script:message", payload }));
  }

  close(): Promise<void> {
    return new Promise((r) => {
      this.ws.once("close", () => r());
      this.ws.close();
    });
  }
}

let rpcId = 0;
async function rpc(port: number, method: string, params?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

async function call(port: number, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await rpc(port, "tools/call", { name, arguments: args });
  assert.equal(r.status, 200);
  assert.ok(r.body.result, JSON.stringify(r.body));
  return r.body.result;
}

// ── the daemon over MCP ──────────────────────────────────────────────

describe("daemon MCP", () => {
  let d: RunningDaemon;
  let wsPort: number;
  let mcpPort: number;
  let scripts: string;
  let gameDir: string;
  let messagesDir: string;
  let clientLog: string;
  let game: FakeGame;

  before(async () => {
    scripts = mkdtempSync(join(tmpdir(), "aether-mcp-scripts-"));
    gameDir = mkdtempSync(join(tmpdir(), "aether-mcp-game-"));
    messagesDir = mkdtempSync(join(tmpdir(), "aether-mcp-msgs-"));
    clientLog = join(gameDir, "D2OpenGL.log");
    writeFileSync(clientLog, "line one\r\naether: js: hello\r\ncrash: EXCEPTION_ACCESS_VIOLATION at 0044cb14\r\n");
    mkdirSync(join(scripts, "tests"));
    writeFileSync(join(scripts, "tests", "probe.ts"), 'import { helper } from "./helper.js"\nexport const x: number = helper()\n');
    writeFileSync(join(scripts, "tests", "helper.ts"), "export function helper(): number { return 1 }\n");

    // a fake docker for stack_log
    const bin = mkdtempSync(join(tmpdir(), "aether-mcp-bin-"));
    writeFileSync(join(bin, "docker"), '#!/bin/sh\necho "args: $*"\necho "gs: halt at 0x401790"\necho "gs: ok" 1>&2\n');
    chmodSync(join(bin, "docker"), 0o755);
    process.env.PATH = `${bin}:${process.env.PATH}`;

    wsPort = randomPort();
    mcpPort = randomPort();
    d = await startDaemon({
      port: wsPort,
      host: "127.0.0.1",
      scripts,
      tests: false,
      watch: false,
      mcp: "http",
      mcpPort,
      gameDir,
      logFiles: { client: clientLog },
      stackGs: "d2up-local-gs",
      messagesDir,
    });
    game = new FakeGame(wsPort, "vm1", gameDir);
    await game.connect();
  });

  after(async () => {
    d.stop();
  });

  it("initializes and lists its tools", async () => {
    const init = await rpc(mcpPort, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    assert.equal(init.status, 200);
    assert.equal(init.body.result.protocolVersion, "2025-06-18");
    assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
    const note = await rpc(mcpPort, "notifications/initialized");
    assert.equal(note.status, 200); // has an id here, so it is answered
    const list = await rpc(mcpPort, "tools/list");
    const names = list.body.result.tools.map((t: { name: string }) => t.name).sort();
    assert.deepEqual(names, ["eval", "games", "log", "log_file", "messages", "run_script", "screenshot", "stack_log", "state", "stop_script"]);
    for (const t of list.body.result.tools) assert.equal(t.inputSchema.type, "object");
  });

  it("answers a notification with 202 and no body", async () => {
    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(res.status, 202);
    assert.equal(await res.text(), "");
  });

  it("refuses a browser origin that is not loopback", async () => {
    const r = await rpc(mcpPort, "tools/list", undefined, { origin: "http://evil.example" });
    assert.equal(r.status, 403);
    const ok = await rpc(mcpPort, "tools/list", undefined, { origin: "http://localhost:5173" });
    assert.equal(ok.status, 200);
  });

  it("lists the game and calls it alive once its ticks move", async () => {
    game.state(1);
    await sleep(50);
    game.state(1);
    await sleep(50);
    const r = await call(mcpPort, "games");
    const games = JSON.parse(r.content[0].text);
    assert.equal(games.length, 1);
    assert.equal(games[0].name, "vm1");
    assert.equal(games[0].alive, true);
    assert.equal(games[0].state.area, 1);
  });

  it("evaluates in the game", async () => {
    const r = await call(mcpPort, "eval", { code: "1+1" });
    assert.equal(r.content[0].text, "2");
    assert.equal(r.isError, undefined);
    const byName = await call(mcpPort, "eval", { code: "1+1", client: "vm1" });
    assert.equal(byName.content[0].text, "2");
  });

  it("returns a script exception as an error", async () => {
    const r = await call(mcpPort, "eval", { code: "throw new Error('boom')" });
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, "Error: boom");
  });

  it("times out when the game does not answer", async () => {
    game.answerEvals = false;
    try {
      const r = await call(mcpPort, "eval", { code: "1+1", timeoutMs: 200 });
      assert.equal(r.isError, true);
      assert.match(r.content[0].text, /did not answer within 200 ms/);
    } finally {
      game.answerEvals = true;
    }
  });

  it("refuses an unknown client", async () => {
    const r = await call(mcpPort, "eval", { code: "1+1", client: "nope" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /no game client "nope"/);
  });

  it("reads the state as JSON", async () => {
    const r = await call(mcpPort, "state", { units: [2, 5], quests: true });
    const s = JSON.parse(r.content[0].text);
    assert.equal(s.me.area, 164);
    const sent = game.received.filter((m) => m.type === "eval").pop() as { code: string };
    assert.match(sent.code, /"units":\[2,5\]/);
    assert.match(sent.code, /"quests":true/);
  });

  it("removes a script's hooks", async () => {
    const r = await call(mcpPort, "stop_script");
    assert.match(r.content[0].text, /^removed: echo:/);
  });

  it("pushes a bundled script, and refuses a path outside the scripts folder", async () => {
    const r = await call(mcpPort, "run_script", { path: "tests/probe.ts" });
    const out = JSON.parse(r.content[0].text);
    assert.equal(out.entry, "./tests/probe.js");
    assert.equal(out.modules, 2);
    await sleep(50);
    const push = game.received.find((m) => m.type === "file:response") as any;
    assert.equal(push.push, true);
    assert.equal(push.entry, "./tests/probe.js");
    assert.equal(push.modules.length, 2);
    assert.ok(push.modules.every((m: { source: string }) => !m.source.includes(": number")), "transpiled to JS");

    const bad = await call(mcpPort, "run_script", { path: "../../etc/passwd" });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /leaves the scripts root/);
  });

  it("keeps forwarded log lines, by seq, with grep", async () => {
    game.log(["aether: js: hello: loaded", "aether: js: hello: in game, area 1"]);
    game.log(["loader: modules loaded=00000002"]);
    await sleep(50);
    const all = await call(mcpPort, "log");
    assert.match(all.content[0].text, /3 line\(s\)/);
    assert.match(all.content[0].text, /^1 .* aether: js: hello: loaded$/m);
    const since = await call(mcpPort, "log", { since: 2 });
    assert.match(since.content[0].text, /1 line\(s\)/);
    assert.match(since.content[0].text, /loader: modules loaded/);
    const grep = await call(mcpPort, "log", { grep: "IN GAME" });
    assert.match(grep.content[0].text, /1 line\(s\)/);
  });

  it("keeps script messages and appends them to the messages folder", async () => {
    game.message('{"t":"result","name":"probe","ok":true}');
    game.message('{"t":"host","id":1,"cmd":"ping"}');
    await sleep(50);
    const r = await call(mcpPort, "messages");
    const msgs = JSON.parse(r.content[0].text);
    assert.equal(msgs.length, 2);
    assert.equal(JSON.parse(msgs[0].text).name, "probe");
    const file = readFileSync(join(messagesDir, "vm1.jsonl"), "utf-8").trim().split("\n");
    assert.equal(file.length, 2);
    assert.equal(JSON.parse(file[1]).cmd, "ping");
  });

  it("tails a client log file", async () => {
    const r = await call(mcpPort, "log_file", { name: "client", grep: "crash:" });
    assert.match(r.content[0].text, /crash: EXCEPTION_ACCESS_VIOLATION/);
    assert.doesNotMatch(r.content[0].text, /line one/);
    const bad = await call(mcpPort, "log_file", { name: "other" });
    assert.equal(bad.isError, true);
  });

  it("returns a screenshot as a PNG image", async () => {
    const r = await call(mcpPort, "screenshot", { timeoutMs: 3000 });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(r.content[0].type, "image");
    assert.equal(r.content[0].mimeType, "image/png");
    const png = Buffer.from(r.content[0].data, "base64");
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  });

  it("reads the local stack's GS log through docker", async () => {
    const r = await call(mcpPort, "stack_log", { since: "5m", grep: "halt|args" });
    assert.match(r.content[0].text, /args: logs --since 5m d2up-local-gs/);
    assert.match(r.content[0].text, /halt at 0x401790/);
    assert.doesNotMatch(r.content[0].text, /gs: ok/);
    const bad = await call(mcpPort, "stack_log", { since: "5m; rm -rf /" });
    assert.equal(bad.isError, true);
  });

  it("still reads a client's lines after it disconnected", async () => {
    await game.close();
    await sleep(50);
    const games = JSON.parse((await call(mcpPort, "games")).content[0].text);
    assert.equal(games.length, 0);
    const r = await call(mcpPort, "log", { client: "vm1" });
    assert.match(r.content[0].text, /3 line\(s\)/);
    const unnamed = await call(mcpPort, "log");
    assert.match(unnamed.content[0].text, /client vm1/);
    const ev = await call(mcpPort, "eval", { code: "1+1" });
    assert.equal(ev.isError, true);
    assert.match(ev.content[0].text, /no game client is connected/);
  });
});

describe("MCP transports", () => {
  it("serves HTTP on a loopback address only", async () => {
    const mcp = new McpServer({ name: "t", version: "0" }, "");
    await assert.rejects(serveHttp(mcp, { host: "0.0.0.0", port: randomPort() }), /loopback address only/);
  });

  it("requires the bearer token when one is set", async () => {
    const mcp = new McpServer({ name: "t", version: "0" }, "");
    const port = randomPort();
    const http = await serveHttp(mcp, { host: "127.0.0.1", port, token: "s3cret" });
    try {
      assert.equal((await rpc(port, "ping")).status, 401);
      const ok = await rpc(port, "ping", undefined, { authorization: "Bearer s3cret" });
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.body.result, {});
      const get = await fetch(`http://127.0.0.1:${port}/mcp`, { headers: { authorization: "Bearer s3cret" } });
      assert.equal(get.status, 405);
    } finally {
      http.close();
    }
  });

  it("speaks newline-delimited JSON-RPC on stdio", async () => {
    const mcp = new McpServer({ name: "t", version: "0" }, "");
    mcp.add({ name: "hi", description: "", inputSchema: { type: "object" }, run: async () => ({ content: [{ type: "text", text: "hello" }] }) });
    const input = new PassThrough();
    const output = new PassThrough();
    serveStdio(mcp, input, output);
    const lines: string[] = [];
    output.on("data", (b) => lines.push(...b.toString().split("\n").filter(Boolean)));
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hi" } }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    input.write("not json\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "nope" }) + "\n");
    await sleep(50);
    const out = lines.map((l) => JSON.parse(l));
    assert.equal(out.length, 3);
    assert.equal(out.find((o) => o.id === 1).result.content[0].text, "hello");
    assert.equal(out.find((o) => o.id === null).error.code, -32700);
    assert.equal(out.find((o) => o.id === 2).error.code, -32601);
  });
});

describe("the snippets the tools send", () => {
  /** Aether's bindings, faked just enough to run a snippet. */
  function bindings(inGame: boolean): Record<string, unknown> {
    const units: Record<number, number[]> = { 2: [10, 11], 4: [20], 5: [30] };
    let snap: number[] = [];
    return {
      JSON,
      inGame: () => inGame,
      getTickCount: () => 1234,
      oogControlGetAll: () => '[{"i":0,"type":6,"x":627,"y":572,"w":128,"h":35,"text":"OK"}]',
      meGetUnitId: () => 1,
      meGetCharName: () => "Smoke",
      meGetClassId: () => 1,
      meGetLevel: () => 90,
      getArea: () => 164,
      getAct: () => 5,
      getUnitX: () => 5000,
      getUnitY: () => 4000,
      unitGetMode: () => 1,
      getUnitHP: () => 500,
      getUnitMaxHP: () => 500,
      getUnitMP: () => 900,
      getUnitMaxMP: () => 900,
      meGetGold: () => 0,
      meGetGoldStash: () => 0,
      getRightSkill: () => 54,
      getDifficulty: () => 0,
      getMapSeed: () => 42,
      getInteractedNPC: () => -1,
      unitCount: (t: number) => { snap = units[t] ?? []; return snap.length; },
      unitAtIndex: (i: number) => snap[i] ?? -1,
      unitGetClassId: () => 7,
      unitGetX: () => 1,
      unitGetY: () => 2,
      unitGetName: () => "x",
      tileGetDestArea: () => 165,
      unitGetOwnerId: () => 1,
      itemGetCode: () => "tbk",
      itemGetLocation: () => 0,
      itemGetQuality: () => 2,
      getQuest: (q: number, b: number) => (q === 40 && b === 0 ? 1 : 0),
      getUIFlag: (f: number) => f === 0x19,
    };
  }

  it("state runs in game and reads everything it was asked for", () => {
    const code = stateSnippet({ units: [2, 5], items: true, quests: true, ui: true, max: 1 });
    const out = JSON.parse(runInNewContext(code, bindings(true)) as string);
    assert.equal(out.me.area, 164);
    assert.equal(out.me.rightSkill, 54);
    assert.equal(out.mapSeed, 42);
    assert.deepEqual(out.units.map((u: { type: number; id?: number; more?: number }) => [u.type, u.id ?? `+${u.more}`]), [[2, 10], [2, "+1"], [5, 30]]);
    assert.equal(out.units[2].dest, 165);
    assert.equal(out.items[0].code, "tbk");
    assert.deepEqual(out.quests, { 40: 1 });
    assert.deepEqual(out.uiFlags, [0x19]);
  });

  it("state reads the menu controls out of game", () => {
    const out = JSON.parse(runInNewContext(stateSnippet({}), bindings(false)) as string);
    assert.equal(out.inGame, false);
    assert.equal(out.controls[0].text, "OK");
    assert.equal(out.me, undefined);
  });

  it("stop_script removes only the hooks that are there", () => {
    const g: Record<string, unknown> = { JSON, __onTick() {}, __onPacket() {} };
    g.globalThis = g;
    const out = JSON.parse(runInNewContext(STOP_SNIPPET, g) as string);
    assert.deepEqual(out, ["__onTick", "__onPacket"]);
    assert.equal(g.__onTick, undefined);
  });
});

describe("bmpToPng", () => {
  it("turns a bottom-up 24-bit BMP into a PNG of the same size", () => {
    const png = bmpToPng(tinyBmp());
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), 2);
    assert.equal(png.readUInt32BE(20), 2);
    // IDAT starts after the signature (8) and IHDR (25): length, "IDAT", data
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    // row 0: filter, red, green; row 1: filter, blue, white
    assert.deepEqual([...raw], [0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  });

  it("refuses what is not a BMP", () => {
    assert.throws(() => bmpToPng(Buffer.from("nope")), /not a BMP/);
  });
});
