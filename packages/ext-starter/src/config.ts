import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface StarterConfig {
  gamePath: string;
  aetherDll: string;
  dbghelpDll: string;
  daemonHost: string;
  daemonPort: number;
  useWine: boolean;
  wineCommand: string;
  wineDllOverrides: string;
  autoRestart: boolean;
  spawnDelay: number;
  extraArgs: string[];
}

const DEFAULTS: StarterConfig = {
  gamePath: resolve(__dirname, "../../../../114Clean/Game.exe"),
  aetherDll: resolve(__dirname, "../../native/zig-out/bin/Aether.dll"),
  dbghelpDll: resolve(__dirname, "../../native/zig-out/bin/dbghelp.dll"),
  daemonHost: "127.0.0.1",
  daemonPort: 13119,
  useWine: platform() !== "win32",
  wineCommand: "wine",
  wineDllOverrides: "dbghelp=n",
  autoRestart: false,
  spawnDelay: 3000,
  extraArgs: [],
};

function loadConfigFile(): Partial<StarterConfig> {
  const configPath = resolve(process.cwd(), "aether-starter.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error(`Failed to parse ${configPath}:`, err);
    return {};
  }
}

function loadEnvOverrides(): Partial<StarterConfig> {
  const overrides: Partial<StarterConfig> = {};
  if (process.env.GAME_DIR) {
    overrides.gamePath = resolve(process.env.GAME_DIR, "Game.exe");
  }
  if (process.env.AETHER_DAEMON_HOST) overrides.daemonHost = process.env.AETHER_DAEMON_HOST;
  if (process.env.AETHER_DAEMON_PORT) overrides.daemonPort = parseInt(process.env.AETHER_DAEMON_PORT, 10);
  if (process.env.AETHER_WINE) overrides.wineCommand = process.env.AETHER_WINE;
  if (process.env.AETHER_NO_WINE) overrides.useWine = false;
  return overrides;
}

export function loadConfig(cliOverrides?: Partial<StarterConfig>): StarterConfig {
  return {
    ...DEFAULTS,
    ...loadConfigFile(),
    ...loadEnvOverrides(),
    ...cliOverrides,
  };
}
