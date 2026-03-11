import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";

import { AetherServer } from "../src/server.js";
import { Registry } from "../src/registry.js";
import { Router } from "../src/router.js";
import { Filesystem } from "../src/filesystem.js";
import { Watcher } from "../src/watcher.js";


// ── helpers ──────────────────────────────────────────────────────────

function randomPort(): number {
  return 30000 + Math.floor(Math.random() * 20000);
}

interface Daemon {
  server: AetherServer;
  watcher: Watcher;
  port: number;
  scriptsDir: string;
}

function startDaemon(scriptsDir?: string): Daemon {
  const port = randomPort();
  const dir = scriptsDir ?? mkdtempSync(join(tmpdir(), "aether-test-"));
  const server = new AetherServer(port, "127.0.0.1");
  new Registry(server);
  new Router(server);
  const filesystem = new Filesystem(server, dir);
  const watcher = new Watcher(server, dir, filesystem);
  server.start();
  watcher.start();
  return { server, watcher, port, scriptsDir: dir };
}

function stopDaemon(d: Daemon): void {
  d.watcher.stop();
  d.server.stop();
}

/** Connect and complete the hello/welcome handshake. Resolves with { ws, clientId }. */
function connectClient(
  port: number,
  opts: { clientName?: string; clientType?: "game" | "extension" | "cli" } = {},
): Promise<{ ws: WebSocket; clientId: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        clientType: opts.clientType ?? "cli",
        clientName: opts.clientName ?? `test-${randomUUID().slice(0, 8)}`,
      }));
    });
    ws.once("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "welcome") {
        resolve({ ws, clientId: msg.clientId });
      } else {
        reject(new Error(`Expected welcome, got ${msg.type}`));
      }
    });
  });
}

/** Wait for the next message of a given type on a websocket. */
function waitForMessage(ws: WebSocket, type: string, timeoutMs = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener("message", handler);
      reject(new Error(`Timed out waiting for message type "${type}"`));
    }, timeoutMs);
    function handler(data: WebSocket.RawData) {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(msg);
      }
    }
    ws.on("message", handler);
  });
}

function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      resolve();
      return;
    }
    ws.on("close", () => resolve());
    ws.close();
  });
}

// ── tests ────────────────────────────────────────────────────────────

describe("Aether daemon e2e", () => {
  let daemon: Daemon;

  afterEach(() => {
    if (daemon) {
      stopDaemon(daemon);
    }
  });

  // 1. Server lifecycle
  it("starts and stops cleanly", () => {
    daemon = startDaemon();
    assert.ok(daemon.server.clientCount === 0);
    stopDaemon(daemon);
    // Double-stop should be harmless
    stopDaemon(daemon);
    // Null it so afterEach doesn't choke
    daemon = undefined as unknown as Daemon;
  });

  // 2. Handshake
  it("completes hello/welcome handshake", async () => {
    daemon = startDaemon();
    const { ws, clientId } = await connectClient(daemon.port);
    assert.ok(typeof clientId === "string");
    assert.ok(clientId.length > 0);
    await closeWs(ws);
  });

  // 3. Service registry
  it("registers a service and discovers it", async () => {
    daemon = startDaemon();
    const provider = await connectClient(daemon.port, { clientName: "my-service", clientType: "extension" });
    const consumer = await connectClient(daemon.port, { clientName: "consumer", clientType: "cli" });

    // Register provider
    const regPromise = waitForMessage(provider.ws, "service:registered");
    provider.ws.send(JSON.stringify({
      type: "service:register",
      name: "my-service",
      capabilities: ["memory-read", "memory-write"],
    }));
    const regMsg = await regPromise;
    assert.equal(regMsg.clientId, provider.clientId);

    // Discover by capability
    const discoverPromise = waitForMessage(consumer.ws, "service:discover:result");
    consumer.ws.send(JSON.stringify({
      type: "service:discover",
      id: "disc-1",
      filterCapability: "memory-read",
    }));
    const discMsg = await discoverPromise;
    const clients = discMsg.clients as Array<{ clientId: string; capabilities: string[] }>;
    assert.ok(clients.length >= 1);
    assert.ok(clients.some(c => c.clientId === provider.clientId));
    assert.ok(clients.find(c => c.clientId === provider.clientId)!.capabilities.includes("memory-read"));

    await closeWs(provider.ws);
    await closeWs(consumer.ws);
  });

  // 4. Message routing
  it("routes messages between clients", async () => {
    daemon = startDaemon();
    const a = await connectClient(daemon.port, { clientName: "alice" });
    const b = await connectClient(daemon.port, { clientName: "bob" });

    const incoming = waitForMessage(b.ws, "message:incoming");
    a.ws.send(JSON.stringify({
      type: "message:send",
      targetId: b.clientId,
      payload: { greeting: "hello bob" },
    }));

    const msg = await incoming;
    assert.equal(msg.fromId, a.clientId);
    assert.equal(msg.fromName, "alice");
    assert.deepEqual(msg.payload, { greeting: "hello bob" });

    await closeWs(a.ws);
    await closeWs(b.ws);
  });

  // 5. Broadcast
  it("broadcasts to all other clients", async () => {
    daemon = startDaemon();
    const a = await connectClient(daemon.port, { clientName: "sender" });
    const b = await connectClient(daemon.port, { clientName: "recv-1" });
    const c = await connectClient(daemon.port, { clientName: "recv-2" });

    const bIncoming = waitForMessage(b.ws, "message:incoming");
    const cIncoming = waitForMessage(c.ws, "message:incoming");

    a.ws.send(JSON.stringify({
      type: "message:broadcast",
      payload: { data: 42 },
    }));

    const [bMsg, cMsg] = await Promise.all([bIncoming, cIncoming]);
    assert.equal(bMsg.fromId, a.clientId);
    assert.deepEqual(bMsg.payload, { data: 42 });
    assert.equal(cMsg.fromId, a.clientId);
    assert.deepEqual(cMsg.payload, { data: 42 });

    await closeWs(a.ws);
    await closeWs(b.ws);
    await closeWs(c.ws);
  });

  // 6. Ping/pong
  it("responds to ping with pong", async () => {
    daemon = startDaemon();
    const { ws } = await connectClient(daemon.port);

    const ts = Date.now();
    const pongPromise = waitForMessage(ws, "pong");
    ws.send(JSON.stringify({
      type: "ping",
      id: "ping-1",
      timestamp: ts,
    }));

    const pong = await pongPromise;
    assert.equal(pong.id, "ping-1");
    assert.equal(pong.timestamp, ts);
    assert.ok(typeof pong.serverTime === "number");

    await closeWs(ws);
  });

  // 7. File request — bundle with deps
  it("serves transpiled bundle with correct dependency order", async () => {
    const scriptsDir = mkdtempSync(join(tmpdir(), "aether-scripts-"));

    // Create a helper module
    writeFileSync(join(scriptsDir, "helper.ts"), `
export function add(a: number, b: number): number {
  return a + b;
}
`);

    // Create entry that imports the helper
    writeFileSync(join(scriptsDir, "entry.ts"), `
import { add } from "./helper";
export const result: number = add(1, 2);
`);

    daemon = startDaemon(scriptsDir);
    const { ws } = await connectClient(daemon.port);

    const respPromise = waitForMessage(ws, "file:response");
    ws.send(JSON.stringify({
      type: "file:request",
      id: "req-1",
      path: "entry.ts",
    }));

    const resp = await respPromise;
    assert.equal(resp.id, "req-1");
    assert.ok(!resp.error, `Got error: ${resp.error} — ${resp.message}`);
    const modules = resp.modules as Array<{ path: string; source: string; deps: string[] }>;
    assert.ok(modules.length === 2, `Expected 2 modules, got ${modules.length}`);

    // Dependency-first order: helper before entry
    const helperIdx = modules.findIndex(m => m.path.includes("helper"));
    const entryIdx = modules.findIndex(m => m.path.includes("entry"));
    assert.ok(helperIdx < entryIdx, "Helper must come before entry in topological order");

    // Source should be JS (no type annotations)
    const helperSrc = modules[helperIdx].source;
    assert.ok(!helperSrc.includes(": number"), "Should strip type annotations");
    assert.ok(helperSrc.includes("function add"), "Should preserve function");

    await closeWs(ws);
    rmSync(scriptsDir, { recursive: true, force: true });
  });

  // 8. File invalidation via watcher
  it("broadcasts file:invalidate on file change", async () => {
    const scriptsDir = mkdtempSync(join(tmpdir(), "aether-watch-"));
    const testFile = join(scriptsDir, "watched.ts");
    writeFileSync(testFile, `export const v = 1;`);

    daemon = startDaemon(scriptsDir);
    // Must be "game" type — watcher broadcasts to filterType "game" only
    const { ws } = await connectClient(daemon.port, { clientType: "game", clientName: "game-client" });

    // Give chokidar a moment to finish scanning
    await new Promise(r => setTimeout(r, 300));

    const invalidatePromise = waitForMessage(ws, "file:invalidate", 5000);

    // Modify the file
    writeFileSync(testFile, `export const v = 2;`);

    const msg = await invalidatePromise;
    const paths = msg.paths as string[];
    assert.ok(paths.length > 0);
    assert.ok(paths.some(p => p.includes("watched.ts")));

    await closeWs(ws);
    rmSync(scriptsDir, { recursive: true, force: true });
  });

  // 9. Transpiler preserves diablo2: imports
  it("preserves diablo2: import specifiers", async () => {
    const scriptsDir = mkdtempSync(join(tmpdir(), "aether-d2-"));
    writeFileSync(join(scriptsDir, "d2script.ts"), `
import { getUnit } from "diablo2:game";
import { log } from "diablo2:console";

const unit: any = getUnit();
log(unit);
`);

    daemon = startDaemon(scriptsDir);
    const { ws } = await connectClient(daemon.port);

    const respPromise = waitForMessage(ws, "file:response");
    ws.send(JSON.stringify({
      type: "file:request",
      id: "d2-req",
      path: "d2script.ts",
    }));

    const resp = await respPromise;
    assert.ok(!resp.error, `Got error: ${resp.error}`);
    const modules = resp.modules as Array<{ path: string; source: string; deps: string[] }>;
    assert.ok(modules.length === 1, "Should have 1 module (diablo2: deps are not bundled)");
    const src = modules[0].source;
    assert.ok(src.includes(`"diablo2:game"`), "Should preserve diablo2:game import");
    assert.ok(src.includes(`"diablo2:console"`), "Should preserve diablo2:console import");
    // deps should list the diablo2: specifiers
    assert.ok(modules[0].deps.includes("diablo2:game"));
    assert.ok(modules[0].deps.includes("diablo2:console"));

    await closeWs(ws);
    rmSync(scriptsDir, { recursive: true, force: true });
  });

  // 10. Multiple clients get unique IDs
  it("assigns unique IDs to multiple clients", async () => {
    daemon = startDaemon();
    const clients = await Promise.all([
      connectClient(daemon.port, { clientName: "c1" }),
      connectClient(daemon.port, { clientName: "c2" }),
      connectClient(daemon.port, { clientName: "c3" }),
    ]);

    const ids = clients.map(c => c.clientId);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, 3, "All 3 clients should have unique IDs");
    assert.equal(daemon.server.clientCount, 3);

    // Disconnect one, verify count drops
    await closeWs(clients[0].ws);
    // Small delay for server to process the close
    await new Promise(r => setTimeout(r, 50));
    assert.equal(daemon.server.clientCount, 2);

    await closeWs(clients[1].ws);
    await closeWs(clients[2].ws);
  });
});
