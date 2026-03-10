import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { bundle } from "./bundler.js";
import type { AetherServer, ConnectedClient } from "./server.js";

interface ClientSubscription {
  clientId: string;
  requestId: string;
  path: string;
  absPath: string;
}

export class Filesystem {
  private subscriptions = new Map<string, ClientSubscription>();

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

    if (!absPath.startsWith(resolvePath(this.scriptRoot))) {
      client.ws.send(JSON.stringify({
        type: "file:response",
        id,
        error: "not_found",
        message: "Path outside script root",
      }));
      return;
    }

    // Track this client's entry point for hot-reload
    this.subscriptions.set(client.id, {
      clientId: client.id,
      requestId: id,
      path,
      absPath,
    });

    this.serveBundle(client, id, path, absPath);
  }

  private serveBundle(client: ConnectedClient, id: string, path: string, absPath: string): void {
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
      const result = bundle(absPath, this.scriptRoot);
      client.ws.send(JSON.stringify({
        type: "file:response",
        id,
        entry: result.entry,
        modules: result.modules,
      }));
      console.log(`Served bundle for ${path} (${result.modules.length} modules, entry=${result.entry})`);
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

  /**
   * Re-serve bundles to all subscribed game clients.
   * Called by the watcher after file changes are detected.
   */
  reloadSubscribers(): void {
    for (const sub of this.subscriptions.values()) {
      const client = this.server.getClient(sub.clientId);
      if (!client || client.ws.readyState !== 1) {
        this.subscriptions.delete(sub.clientId);
        continue;
      }
      console.log(`Hot-reloading ${sub.path} for ${client.name}`);
      this.serveBundle(client, sub.requestId, sub.path, sub.absPath);
    }
  }

  /**
   * Remove subscription when a client disconnects.
   */
  removeClient(clientId: string): void {
    this.subscriptions.delete(clientId);
  }

  get subscriberCount(): number {
    return this.subscriptions.size;
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
