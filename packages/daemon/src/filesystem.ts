import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { bundle } from "./bundler.js";
import type { AetherServer, ConnectedClient } from "./server.js";

export class Filesystem {
  constructor(
    private server: AetherServer,
    private scriptRoot: string,
  ) {
    server.on("file:request", (client, msg) => this.handleFileRequest(client, msg));
    server.on("file:raw", (client, msg) => this.handleRawRequest(client, msg));
  }

  private handleFileRequest(client: ConnectedClient, msg: Record<string, unknown>): void {
    const id = msg.id as string;
    const path = msg.path as string;

    if (!id || !path) {
      client.ws.send(JSON.stringify({
        type: "file:response",
        id: id || "",
        error: "invalid_message",
        message: "Missing id or path",
      }));
      return;
    }

    const absPath = resolvePath(this.scriptRoot, path);

    // Security: ensure resolved path is under scriptRoot
    if (!absPath.startsWith(resolvePath(this.scriptRoot))) {
      client.ws.send(JSON.stringify({
        type: "file:response",
        id,
        error: "not_found",
        message: "Path outside script root",
      }));
      return;
    }

    if (!existsSync(absPath)) {
      client.ws.send(JSON.stringify({
        type: "file:response",
        id,
        error: "not_found",
        message: `File not found: ${path}`,
      }));
      return;
    }

    try {
      const modules = bundle(absPath);
      client.ws.send(JSON.stringify({
        type: "file:response",
        id,
        modules,
      }));
      console.log(`Served bundle for ${path} (${modules.length} modules)`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isResolve = error.message.includes("Cannot find") || error.message.includes("Cannot resolve");
      client.ws.send(JSON.stringify({
        type: "file:response",
        id,
        error: isResolve ? "resolve_error" : "transpile_error",
        message: error.message,
      }));
    }
  }

  private handleRawRequest(client: ConnectedClient, msg: Record<string, unknown>): void {
    const id = msg.id as string;
    const path = msg.path as string;

    if (!id || !path) {
      client.ws.send(JSON.stringify({
        type: "file:raw:response",
        id: id || "",
        error: "invalid_message",
      }));
      return;
    }

    const absPath = resolvePath(this.scriptRoot, path);

    if (!absPath.startsWith(resolvePath(this.scriptRoot))) {
      client.ws.send(JSON.stringify({
        type: "file:raw:response",
        id,
        error: "not_found",
      }));
      return;
    }

    if (!existsSync(absPath)) {
      client.ws.send(JSON.stringify({
        type: "file:raw:response",
        id,
        error: "not_found",
      }));
      return;
    }

    try {
      const content = readFileSync(absPath, "utf-8");
      client.ws.send(JSON.stringify({
        type: "file:raw:response",
        id,
        content,
      }));
    } catch (err) {
      client.ws.send(JSON.stringify({
        type: "file:raw:response",
        id,
        error: "not_found",
        message: String(err),
      }));
    }
  }
}
