import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startDaemon, type DaemonOptions } from "./daemon.js";

// Default scripts dir: aether/scripts/ (relative to this package at aether/packages/daemon/)
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SCRIPTS = resolve(PACKAGE_ROOT, "../../scripts");

const USAGE = `node dist/index.js [options]
  --port N            game connection port (AETHER_PORT, 13119)
  --host H            game connection address (AETHER_HOST, 0.0.0.0); 127.0.0.1 for Wine on this machine,
                      the host's VM-bridge address for a VM
  --scripts DIR       scripts folder (AETHER_SCRIPTS)
  --tests             serve the test entry for main.ts
  --token T           (AETHER_TOKEN)
  --mcp http|stdio    also serve MCP: http on --mcp-host:--mcp-port (loopback only), or this process's stdio
  --mcp-host H        127.0.0.1
  --mcp-port N        13120
  --mcp-token T       require "Authorization: Bearer T" (AETHER_MCP_TOKEN)
  --game-dir DIR      the client's game folder on this machine (screenshots)
  --log-file NAME=PATH  a client log the log_file tool may tail; repeat (client=.../D2OpenGL.log)
  --stack-gs NAME     the local stack's GS container, for stack_log
  --messages-dir DIR  append each script message to DIR/<client>.jsonl`;

function parseArgs(): DaemonOptions & { token?: string } {
  const args = process.argv.slice(2);
  const opts: DaemonOptions & { token?: string } = {
    port: parseInt(process.env.AETHER_PORT || "13119", 10),
    host: process.env.AETHER_HOST || "0.0.0.0",
    scripts: process.env.AETHER_SCRIPTS || DEFAULT_SCRIPTS,
    tests: false,
    token: process.env.AETHER_TOKEN,
    mcpToken: process.env.AETHER_MCP_TOKEN,
    logFiles: {},
  };

  for (let i = 0; i < args.length; i++) {
    const next = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${args[i - 1]} needs a value`);
      return v;
    };
    switch (args[i]) {
      case "--port": opts.port = parseInt(next(), 10); break;
      case "--host": opts.host = next(); break;
      case "--scripts": opts.scripts = next(); break;
      case "--tests": opts.tests = true; break;
      case "--token": opts.token = next(); break;
      case "--mcp": {
        const m = next();
        if (m !== "http" && m !== "stdio") throw new Error("--mcp is http or stdio");
        opts.mcp = m;
        break;
      }
      case "--mcp-host": opts.mcpHost = next(); break;
      case "--mcp-port": opts.mcpPort = parseInt(next(), 10); break;
      case "--mcp-token": opts.mcpToken = next(); break;
      case "--game-dir": opts.gameDir = resolve(next()); break;
      case "--log-file": {
        const v = next();
        const eq = v.indexOf("=");
        if (eq <= 0) throw new Error("--log-file is NAME=PATH");
        opts.logFiles![v.slice(0, eq)] = resolve(v.slice(eq + 1));
        break;
      }
      case "--stack-gs": opts.stackGs = next(); break;
      case "--messages-dir": opts.messagesDir = resolve(next()); break;
      case "--help": case "-h": console.log(USAGE); process.exit(0);
      default: throw new Error(`unknown option ${args[i]}\n${USAGE}`);
    }
  }

  opts.scripts = resolve(opts.scripts);
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs();
  // stdout is the MCP channel in stdio mode: everything else goes to stderr.
  if (opts.mcp === "stdio") {
    console.log = console.error;
    console.info = console.error;
  }

  console.log("@aether/daemon v0.1.0");
  console.log(`  Port:    ${opts.port}`);
  console.log(`  Host:    ${opts.host}`);
  console.log(`  Scripts: ${opts.scripts}`);
  console.log(`  Mode:    ${opts.tests ? "tests" : "bot"}`);
  console.log(`  Auth:    ${opts.token ? "enabled" : "disabled"}`);
  console.log(`  MCP:     ${opts.mcp === "http" ? `http://${opts.mcpHost ?? "127.0.0.1"}:${opts.mcpPort ?? 13120}/mcp${opts.mcpToken ? " (token)" : ""}` : opts.mcp ?? "off"}`);

  const daemon = await startDaemon(opts);

  const shutdown = () => {
    console.log("\nShutting down...");
    daemon.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (opts.mcp === "stdio") process.stdin.on("end", shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
