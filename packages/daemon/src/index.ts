import { AetherServer } from "./server.js";
import { Registry } from "./registry.js";
import { Router } from "./router.js";
import { Filesystem } from "./filesystem.js";
import { Watcher } from "./watcher.js";
import { resolve, dirname } from "node:path";

// Default scripts dir: aether/scripts/ (relative to this package at aether/packages/daemon/)
const PACKAGE_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_SCRIPTS = resolve(PACKAGE_ROOT, "../../scripts");

function parseArgs(): { port: number; host: string; scripts: string; tests: boolean; token?: string } {
  const args = process.argv.slice(2);
  const opts = {
    port: parseInt(process.env.AETHER_PORT || "13119", 10),
    host: process.env.AETHER_HOST || "0.0.0.0",
    scripts: process.env.AETHER_SCRIPTS || DEFAULT_SCRIPTS,
    tests: false,
    token: process.env.AETHER_TOKEN,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port":
        opts.port = parseInt(args[++i], 10);
        break;
      case "--host":
        opts.host = args[++i];
        break;
      case "--scripts":
        opts.scripts = args[++i];
        break;
      case "--tests":
        opts.tests = true;
        break;
      case "--token":
        opts.token = args[++i];
        break;
    }
  }

  opts.scripts = resolve(opts.scripts);
  return opts;
}

function main(): void {
  const opts = parseArgs();

  console.log("@aether/daemon v0.1.0");
  console.log(`  Port:    ${opts.port}`);
  console.log(`  Host:    ${opts.host}`);
  console.log(`  Scripts: ${opts.scripts}`);
  console.log(`  Mode:    ${opts.tests ? "tests" : "bot"}`);
  console.log(`  Auth:    ${opts.token ? "enabled" : "disabled"}`);

  const server = new AetherServer(opts.port, opts.host);

  new Registry(server);
  new Router(server);
  const filesystem = new Filesystem(server, opts.scripts, opts.tests);

  const watcher = new Watcher(server, opts.scripts, filesystem);

  server.start();
  watcher.start();

  const shutdown = () => {
    console.log("\nShutting down...");
    watcher.stop();
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
