import type { Server } from "node:http";
import { AetherServer } from "./server.js";
import { Registry } from "./registry.js";
import { Router } from "./router.js";
import { Filesystem } from "./filesystem.js";
import { Watcher } from "./watcher.js";
import { GameLink } from "./game-link.js";
import { McpServer, serveHttp, serveStdio } from "./mcp.js";
import { registerTools } from "./tools.js";

export interface DaemonOptions {
  port: number;
  host: string;
  scripts: string;
  tests: boolean;
  watch?: boolean;
  /** "http" serves MCP on mcpHost:mcpPort (loopback only), "stdio" on this process's stdin/stdout. */
  mcp?: "http" | "stdio";
  mcpHost?: string;
  mcpPort?: number;
  mcpToken?: string;
  gameDir?: string;
  logFiles?: Record<string, string>;
  stackGs?: string;
  messagesDir?: string;
}

export interface RunningDaemon {
  server: AetherServer;
  link: GameLink;
  mcp: McpServer;
  http?: Server;
  stop(): void;
}

export const MCP_INSTRUCTIONS = [
  "Drives d2up test clients (the test-client build of dbghelp.dll with Aether's script engine) that connected to this daemon.",
  "Start with `games`. `state` reads the game in one call; `eval` runs JavaScript on the game thread with every Aether binding as a global;",
  "`run_script`/`stop_script` load and unload a script; `log`, `messages`, `log_file` and `screenshot` show what happened;",
  "`stack_log` reads the local stack's game server. Only test clients can connect here: the release client carries no script engine.",
  "Never point a test client at prod.",
].join(" ");

export async function startDaemon(opts: DaemonOptions): Promise<RunningDaemon> {
  const server = new AetherServer(opts.port, opts.host);
  new Registry(server);
  new Router(server);
  const filesystem = new Filesystem(server, opts.scripts, opts.tests);
  const watcher = opts.watch === false ? null : new Watcher(server, opts.scripts, filesystem);
  const link = new GameLink(server, opts.scripts, opts.messagesDir);
  const mcp = new McpServer({ name: "aether", version: "0.1.0" }, MCP_INSTRUCTIONS);
  registerTools(mcp, link, { gameDir: opts.gameDir, logFiles: opts.logFiles ?? {}, stackGs: opts.stackGs });

  server.start();
  watcher?.start();

  let http: Server | undefined;
  if (opts.mcp === "http") {
    try {
      http = await serveHttp(mcp, { host: opts.mcpHost ?? "127.0.0.1", port: opts.mcpPort ?? 13120, token: opts.mcpToken });
    } catch (err) {
      watcher?.stop();
      server.stop();
      throw err;
    }
  } else if (opts.mcp === "stdio") {
    serveStdio(mcp, process.stdin, process.stdout);
  }

  return {
    server,
    link,
    mcp,
    http,
    stop() {
      http?.close();
      watcher?.stop();
      server.stop();
    },
  };
}
