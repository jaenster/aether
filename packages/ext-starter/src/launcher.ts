import { spawn, ChildProcess } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import type { StarterConfig } from "./config.js";

export interface LaunchOptions {
  gamePath: string;
  aetherDll: string;
  dbghelpDll: string;
  daemonHost: string;
  daemonPort: number;
  useWine: boolean;
  wineCommand: string;
  wineDllOverrides: string;
  extraArgs: string[];
}

export interface LaunchResult {
  process: ChildProcess;
  pid: number;
  gameDir: string;
}

function toWinePath(posixPath: string): string {
  return "Z:" + posixPath.replace(/\//g, "\\");
}

function copyDlls(opts: LaunchOptions): void {
  const gameDir = dirname(opts.gamePath);

  if (existsSync(opts.dbghelpDll)) {
    const dest = resolve(gameDir, "dbghelp.dll");
    copyFileSync(opts.dbghelpDll, dest);
  } else {
    console.warn(`dbghelp.dll not found at ${opts.dbghelpDll}`);
  }

  if (!existsSync(opts.aetherDll)) {
    console.warn(`Aether.dll not found at ${opts.aetherDll}`);
  }
}

export function launchGame(opts: LaunchOptions): LaunchResult {
  copyDlls(opts);

  const gameDir = dirname(opts.gamePath);
  const daemonAddr = `${opts.daemonHost}:${opts.daemonPort}`;
  const dllLoadPath = opts.useWine
    ? toWinePath(opts.aetherDll)
    : opts.aetherDll;

  const gameArgs = [
    "-w",
    "-ns",
    "-loaddll", dllLoadPath,
    "-daemon", daemonAddr,
    ...opts.extraArgs,
  ];

  let child: ChildProcess;

  if (opts.useWine) {
    child = spawn(opts.wineCommand, [opts.gamePath, ...gameArgs], {
      cwd: gameDir,
      stdio: "ignore",
      detached: true,
      env: {
        ...process.env,
        WINEDLLOVERRIDES: opts.wineDllOverrides,
      },
    });
  } else {
    child = spawn(opts.gamePath, gameArgs, {
      cwd: gameDir,
      stdio: "ignore",
      detached: true,
    });
  }

  child.unref();

  if (!child.pid) {
    throw new Error("Failed to spawn game process");
  }

  return {
    process: child,
    pid: child.pid,
    gameDir,
  };
}

export function configToLaunchOptions(config: StarterConfig): LaunchOptions {
  return {
    gamePath: config.gamePath,
    aetherDll: config.aetherDll,
    dbghelpDll: config.dbghelpDll,
    daemonHost: config.daemonHost,
    daemonPort: config.daemonPort,
    useWine: config.useWine,
    wineCommand: config.wineCommand,
    wineDllOverrides: config.wineDllOverrides,
    extraArgs: config.extraArgs,
  };
}
