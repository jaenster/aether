import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/**
 * A Model Context Protocol server over JSON-RPC 2.0, with the tools as its
 * only capability. Two transports: streamable HTTP on a loopback address
 * (every POST answered with one JSON body, no event stream) and stdio.
 */

export interface ToolContent {
  type: "text" | "image";
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface Request {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type Response =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

export class McpServer {
  private tools = new Map<string, Tool>();

  constructor(
    private info: { name: string; version: string },
    private instructions: string,
  ) {}

  add(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  toolNames(): string[] {
    return [...this.tools.keys()];
  }

  /** One JSON-RPC message in; the response, or null for a notification. */
  async handle(msg: unknown): Promise<Response | null> {
    const req = msg as Request;
    if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    }
    const isNotification = req.id === undefined;
    try {
      const result = await this.dispatch(req);
      return isNotification ? null : { jsonrpc: "2.0", id: req.id ?? null, result };
    } catch (err) {
      if (isNotification) return null;
      const e = err as { code?: number; message?: string };
      return { jsonrpc: "2.0", id: req.id ?? null, error: { code: e.code ?? -32603, message: e.message ?? String(err) } };
    }
  }

  private async dispatch(req: Request): Promise<unknown> {
    switch (req.method) {
      case "initialize": {
        const asked = String(req.params?.protocolVersion ?? "");
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.info,
          instructions: this.instructions,
        };
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return {};
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: [...this.tools.values()].map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        };
      case "tools/call": {
        const name = String(req.params?.name ?? "");
        const tool = this.tools.get(name);
        if (!tool) throw { code: -32602, message: `unknown tool "${name}"` };
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          return await tool.run(args);
        } catch (err) {
          // A tool that fails answers with isError, so the model sees why.
          return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
        }
      }
      default:
        throw { code: -32601, message: `method "${req.method}" is not offered` };
    }
  }
}

/** Only these hosts may serve MCP: it can run code inside a game. */
export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // not a browser
  try {
    const u = new URL(origin);
    return isLoopback(u.hostname) || u.hostname === "[::1]";
  } catch {
    return false;
  }
}

export interface HttpOptions {
  host: string;
  port: number;
  /** When set, every request must carry `Authorization: Bearer <token>`. */
  token?: string;
}

/** Streamable HTTP at POST /mcp, loopback only. */
export function serveHttp(mcp: McpServer, opts: HttpOptions): Promise<Server> {
  if (!isLoopback(opts.host)) {
    return Promise.reject(new Error(`MCP serves on a loopback address only, not ${opts.host}`));
  }
  const server = createServer((req, res) => void onRequest(mcp, opts, req, res));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve(server));
  });
}

function reply(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function onRequest(mcp: McpServer, opts: HttpOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  if (path !== "/mcp") return reply(res, 404, { error: "not found" });
  // A web page must not reach a game through the user's browser (DNS rebinding).
  if (!originAllowed(req.headers.origin)) return reply(res, 403, { error: "origin not allowed" });
  if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) {
    return reply(res, 401, { error: "missing or wrong bearer token" });
  }
  if (req.method === "GET" || req.method === "DELETE") {
    res.setHeader("allow", "POST");
    return reply(res, 405);
  }
  if (req.method !== "POST") return reply(res, 405);

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let msg: unknown;
  try {
    msg = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return reply(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map((m) => mcp.handle(m)))).filter((r) => r !== null);
    return out.length ? reply(res, 200, out) : reply(res, 202);
  }
  const out = await mcp.handle(msg);
  return out ? reply(res, 200, out) : reply(res, 202);
}

/**
 * stdio: one JSON-RPC message per line. The caller must keep stdout free of
 * anything else (index.ts sends the daemon's own output to stderr).
 */
export function serveStdio(mcp: McpServer, input: Readable, output: Writable): void {
  const rl = createInterface({ input });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
      return;
    }
    void mcp.handle(msg).then((r) => {
      if (r) output.write(JSON.stringify(r) + "\n");
    });
  });
}
