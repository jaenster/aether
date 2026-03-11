import { watch, type FSWatcher } from "chokidar";
import type { AetherServer } from "./server.js";
import type { Filesystem } from "./filesystem.js";
import { invalidate as invalidateTranspiler } from "./transpiler.js";

export class Watcher {
  private fsWatcher: FSWatcher | null = null;
  private pendingPaths = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 100;

  constructor(
    private server: AetherServer,
    private scriptRoot: string,
    private filesystem: Filesystem,
  ) {}

  start(): void {
    this.fsWatcher = watch(this.scriptRoot, {
      ignored: [
        /(^|[\/\\])\./,          // dotfiles
        /node_modules/,
        /\.d\.ts$/,              // declaration files
        /__tests_entry\.ts$/,    // generated test entry
      ],
      persistent: true,
      ignoreInitial: true,
    });

    this.fsWatcher.on("change", (path) => this.onFileChanged(path));
    this.fsWatcher.on("add", (path) => this.onFileChanged(path));
    this.fsWatcher.on("unlink", (path) => this.onFileChanged(path));

    console.log(`Watching ${this.scriptRoot} for changes`);
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.fsWatcher?.close();
    this.fsWatcher = null;
  }

  private onFileChanged(path: string): void {
    this.pendingPaths.add(path);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), this.DEBOUNCE_MS);
  }

  private flush(): void {
    const paths = Array.from(this.pendingPaths);
    this.pendingPaths.clear();
    this.debounceTimer = null;

    if (paths.length === 0) return;

    // Invalidate transpiler cache for changed files
    invalidateTranspiler(paths);

    console.log(`Files changed: ${paths.join(", ")}`);

    // Notify all game clients about changed files
    this.server.broadcast(
      { type: "file:invalidate", paths },
      undefined,
      "game",
    );

    // Re-bundle and push to all subscribed game clients
    this.filesystem.reloadSubscribers();
  }
}
