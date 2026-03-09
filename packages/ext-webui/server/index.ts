import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "./daemon-client.js";
import { ApiBridge } from "./api.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIR = join(__dirname, "..", "dist", "client");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function parseArgs(): { daemonUrl: string; port: number } {
  const args = process.argv.slice(2);
  const opts = {
    daemonUrl: "ws://127.0.0.1:13119",
    port: 3001,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--daemon":
        opts.daemonUrl = args[++i];
        break;
      case "--port":
        opts.port = parseInt(args[++i], 10);
        break;
    }
  }

  return opts;
}

function main(): void {
  const opts = parseArgs();
  const isProd = process.env.NODE_ENV === "production";

  console.log("@aether/ext-webui v0.2.0");
  console.log(`  Daemon:  ${opts.daemonUrl}`);
  console.log(`  WS API:  ws://127.0.0.1:${opts.port}/ws`);
  if (isProd) {
    console.log(`  HTTP:    http://127.0.0.1:${opts.port}`);
  } else {
    console.log(`  Mode:    development (run 'npm run dev:client' for Vite)`);
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!isProd) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Backend WS server running. Start Vite dev server for the UI.");
      return;
    }

    const url = req.url || "/";
    let filePath = url === "/" ? "/index.html" : url;
    filePath = filePath.replace(/\.\./g, "");
    const fullPath = join(CLIENT_DIR, filePath);
    const ext = extname(fullPath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    try {
      const content = await readFile(fullPath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      // SPA fallback: serve index.html for client-side routing
      try {
        const index = await readFile(join(CLIENT_DIR, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(index);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    }
  });

  const daemon = new DaemonClient(opts.daemonUrl);
  new ApiBridge(httpServer, daemon);

  httpServer.listen(opts.port, "0.0.0.0", () => {
    console.log(`Server listening on port ${opts.port}`);
  });

  daemon.connect();

  setInterval(() => {
    if (daemon.isConnected) {
      daemon.requestDiscovery();
    }
  }, 5000);

  const shutdown = () => {
    console.log("\nShutting down...");
    daemon.disconnect();
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
