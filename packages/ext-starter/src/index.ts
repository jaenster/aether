#!/usr/bin/env node

import { loadConfig, type StarterConfig } from "./config.js";
import { DaemonClient } from "./daemon-client.js";
import { ProcessManager } from "./process-manager.js";
import { parseArgs } from "node:util";

function printUsage(): void {
  console.log(`
aether-starter - Diablo II game instance launcher

Usage:
  aether-starter start [--count N] [--delay MS] [--headless] [--auto-restart]
  aether-starter stop [--all | --pid PID]
  aether-starter status
  aether-starter restart [--pid PID]

Options:
  --count N        Number of game instances to launch (default: 1)
  --delay MS       Delay between spawns in ms (default: 3000)
  --headless       Pass --headless flag to game
  --auto-restart   Restart crashed instances automatically
  --daemon HOST    Daemon address (default: 127.0.0.1)
  --port PORT      Daemon port (default: 13119)
  --game-path PATH Path to Game.exe
  --no-wine        Don't use Wine even on macOS/Linux
`);
}

function parseCliArgs(): { command: string; options: Record<string, unknown> } {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const rest = args.slice(1);

  const { values } = parseArgs({
    args: rest,
    options: {
      count: { type: "string", short: "n", default: "1" },
      delay: { type: "string", short: "d" },
      pid: { type: "string", short: "p" },
      all: { type: "boolean", default: false },
      headless: { type: "boolean", default: false },
      "auto-restart": { type: "boolean", default: false },
      daemon: { type: "string" },
      port: { type: "string" },
      "game-path": { type: "string" },
      "no-wine": { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  return { command, options: values };
}

async function main(): Promise<void> {
  const { command, options } = parseCliArgs();

  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  const configOverrides: Partial<StarterConfig> = {};
  if (options.daemon) configOverrides.daemonHost = options.daemon as string;
  if (options.port) configOverrides.daemonPort = parseInt(options.port as string, 10);
  if (options["game-path"]) configOverrides.gamePath = options["game-path"] as string;
  if (options["no-wine"]) configOverrides.useWine = false;
  if (options["auto-restart"]) configOverrides.autoRestart = true;
  if (options.delay) configOverrides.spawnDelay = parseInt(options.delay as string, 10);
  if (options.headless) configOverrides.extraArgs = ["--headless"];

  const config = loadConfig(configOverrides);
  const daemon = new DaemonClient(config.daemonHost, config.daemonPort);
  const pm = new ProcessManager(config);

  // Handle incoming commands from other extensions via daemon
  daemon.on("message", (msg: Record<string, unknown>) => {
    const payload = (msg as { payload?: Record<string, unknown> }).payload;
    if (!payload || typeof payload !== "object") return;

    const action = (payload as { action?: string }).action;
    if (!action) return;

    handleRemoteCommand(pm, daemon, action, payload as Record<string, unknown>);
  });

  // Sync process state to daemon periodically
  let stateInterval: ReturnType<typeof setInterval> | null = null;
  daemon.on("connected", () => {
    console.log("Connected to daemon");
    stateInterval = setInterval(() => {
      daemon.updateState({
        instances: pm.getStatus(),
        running: pm.running.length,
      });
    }, 5000);
  });

  daemon.on("disconnected", () => {
    console.log("Disconnected from daemon");
    if (stateInterval) {
      clearInterval(stateInterval);
      stateInterval = null;
    }
  });

  daemon.on("error", () => {
    // Suppress connection errors during reconnect
  });

  // Graceful shutdown
  const shutdown = (): void => {
    console.log("\nShutting down...");
    pm.stopAll();
    daemon.disconnect();
    if (stateInterval) clearInterval(stateInterval);
    setTimeout(() => process.exit(0), 4000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Connect to daemon (non-blocking, will reconnect)
  daemon.connect();

  switch (command) {
    case "start": {
      const count = parseInt(options.count as string, 10) || 1;
      console.log(`Launching ${count} game instance(s)...`);
      console.log(`  Game: ${config.gamePath}`);
      console.log(`  Wine: ${config.useWine ? config.wineCommand : "disabled"}`);
      console.log(`  Daemon: ${config.daemonHost}:${config.daemonPort}`);
      console.log(`  Delay: ${config.spawnDelay}ms between spawns`);

      const pids = await pm.launch(count);
      console.log(`Launched PIDs: ${pids.join(", ")}`);

      // Keep running to monitor processes
      pm.on("exit", (info) => {
        if (pm.running.length === 0 && !config.autoRestart) {
          console.log("All instances exited.");
          daemon.disconnect();
          process.exit(0);
        }
      });
      break;
    }

    case "stop": {
      if (options.all) {
        pm.stopAll();
        console.log("Stopped all instances");
        setTimeout(() => process.exit(0), 2000);
      } else if (options.pid) {
        const pid = parseInt(options.pid as string, 10);
        if (pm.stop(pid)) {
          console.log(`Stopped PID=${pid}`);
        } else {
          console.error(`No running instance with PID=${pid}`);
        }
        process.exit(0);
      } else {
        console.error("Specify --all or --pid PID");
        process.exit(1);
      }
      break;
    }

    case "status": {
      const status = pm.getStatus();
      if (status.length === 0) {
        console.log("No tracked instances");
      } else {
        for (const s of status) {
          const uptime = Math.floor(s.uptimeMs / 1000);
          console.log(`  PID=${s.pid}  status=${s.status}  uptime=${uptime}s  restarts=${s.restartCount}`);
        }
      }
      process.exit(0);
      break;
    }

    case "restart": {
      if (!options.pid) {
        console.error("Specify --pid PID");
        process.exit(1);
      }
      const pid = parseInt(options.pid as string, 10);
      const newPid = await pm.restart(pid);
      if (newPid) {
        console.log(`Restarted PID=${pid} -> new PID=${newPid}`);
      } else {
        console.error(`Failed to restart PID=${pid}`);
      }
      process.exit(0);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function handleRemoteCommand(
  pm: ProcessManager,
  daemon: DaemonClient,
  action: string,
  payload: Record<string, unknown>,
): void {
  switch (action) {
    case "launch": {
      const count = (payload.count as number) || 1;
      const delay = payload.delay as number | undefined;
      console.log(`Remote command: launch ${count} instance(s)`);
      pm.launch(count, delay).then(pids => {
        daemon.broadcast({ type: "starter:launched", pids });
      });
      break;
    }
    case "stop": {
      if (payload.all) {
        pm.stopAll();
        daemon.broadcast({ type: "starter:stopped", all: true });
      } else if (payload.pid) {
        pm.stop(payload.pid as number);
        daemon.broadcast({ type: "starter:stopped", pid: payload.pid });
      }
      break;
    }
    case "status": {
      const fromId = (payload as { _replyTo?: string })._replyTo;
      if (fromId) {
        daemon.sendTo(fromId, { type: "starter:status", instances: pm.getStatus() });
      }
      break;
    }
    case "restart": {
      if (payload.pid) {
        pm.restart(payload.pid as number).then(newPid => {
          daemon.broadcast({ type: "starter:restarted", oldPid: payload.pid, newPid });
        });
      }
      break;
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
