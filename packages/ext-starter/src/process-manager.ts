import { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { launchGame, configToLaunchOptions, type LaunchResult } from "./launcher.js";
import type { StarterConfig } from "./config.js";

export interface ProcessInfo {
  pid: number;
  launchedAt: Date;
  status: "running" | "exited" | "crashed";
  exitCode: number | null;
  restartCount: number;
  process: ChildProcess;
  gameDir: string;
}

export class ProcessManager extends EventEmitter {
  private processes = new Map<number, ProcessInfo>();
  private shuttingDown = false;

  constructor(private config: StarterConfig) {
    super();
  }

  get running(): ProcessInfo[] {
    return [...this.processes.values()].filter(p => p.status === "running");
  }

  get all(): ProcessInfo[] {
    return [...this.processes.values()];
  }

  async launch(count: number = 1, delay?: number): Promise<number[]> {
    const spawnDelay = delay ?? this.config.spawnDelay;
    const pids: number[] = [];

    for (let i = 0; i < count; i++) {
      if (i > 0 && spawnDelay > 0) {
        await sleep(spawnDelay);
      }

      try {
        const result = this.spawnOne();
        pids.push(result.pid);
        console.log(`Launched game instance PID=${result.pid}`);
      } catch (err) {
        console.error(`Failed to launch instance ${i + 1}:`, err);
      }
    }

    return pids;
  }

  private spawnOne(restartCount = 0): LaunchResult {
    const opts = configToLaunchOptions(this.config);
    const result = launchGame(opts);

    const info: ProcessInfo = {
      pid: result.pid,
      launchedAt: new Date(),
      status: "running",
      exitCode: null,
      restartCount,
      process: result.process,
      gameDir: result.gameDir,
    };

    this.processes.set(result.pid, info);

    result.process.on("exit", (code, signal) => {
      info.status = code === 0 ? "exited" : "crashed";
      info.exitCode = code;
      console.log(`Game PID=${info.pid} exited (code=${code}, signal=${signal})`);
      this.emit("exit", info);

      if (info.status === "crashed" && this.config.autoRestart && !this.shuttingDown) {
        console.log(`Auto-restarting crashed instance (was PID=${info.pid})...`);
        this.processes.delete(info.pid);
        try {
          this.spawnOne(info.restartCount + 1);
        } catch (err) {
          console.error("Auto-restart failed:", err);
        }
      }
    });

    return result;
  }

  stop(pid: number): boolean {
    const info = this.processes.get(pid);
    if (!info || info.status !== "running") return false;

    try {
      info.process.kill("SIGTERM");
    } catch {
      try {
        info.process.kill("SIGKILL");
      } catch {
        // already dead
      }
    }

    info.status = "exited";
    return true;
  }

  stopAll(): void {
    this.shuttingDown = true;

    for (const info of this.processes.values()) {
      if (info.status !== "running") continue;
      try {
        info.process.kill("SIGTERM");
      } catch {
        // ignore
      }
    }

    // Force-kill after 3s
    setTimeout(() => {
      for (const info of this.processes.values()) {
        if (info.status !== "running") continue;
        try {
          info.process.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, 3000);
  }

  async restart(pid: number): Promise<number | null> {
    const info = this.processes.get(pid);
    if (!info) return null;

    this.stop(pid);
    await sleep(1000);

    this.processes.delete(pid);
    try {
      const result = this.spawnOne(info.restartCount + 1);
      return result.pid;
    } catch {
      return null;
    }
  }

  getStatus(): Array<{
    pid: number;
    status: string;
    launchedAt: string;
    restartCount: number;
    uptimeMs: number;
  }> {
    return this.all.map(info => ({
      pid: info.pid,
      status: info.status,
      launchedAt: info.launchedAt.toISOString(),
      restartCount: info.restartCount,
      uptimeMs: Date.now() - info.launchedAt.getTime(),
    }));
  }

  cleanup(): void {
    this.processes.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
