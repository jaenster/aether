#!/usr/bin/env node
/**
 * E2E test harness: launches the daemon in --tests mode + Game.exe under Wine,
 * tails aether_log.txt for the test runner's `Results:` line, exits with a
 * status code reflecting pass/fail.
 *
 * Auto-enter (native feature) handles splash → char select → join with the
 * "EpicSorc" character — no manual interaction required. The character must
 * already exist as a local SP save and be in a town suitable for the tests.
 *
 * Requires:
 *   GAME_DIR  — path to the D2 install
 *
 * Usage:
 *   node scripts/e2e/run.mjs [--timeout 180]
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, openSync, readSync, closeSync, unlinkSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, "../..")
const DAEMON_PKG = join(REPO, "packages/daemon")
const NATIVE_PKG = join(REPO, "packages/native")

const args = process.argv.slice(2)
let timeoutSec = 180
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--timeout") timeoutSec = parseInt(args[++i], 10)
}

const GAME_DIR = process.env.GAME_DIR
if (!GAME_DIR) {
  console.error("E2E: GAME_DIR is not set. Export it to your D2 install path.")
  process.exit(2)
}
const LOG_PATH = join(GAME_DIR, "aether_log.txt")

// 1. Spawn daemon in --tests mode
console.log("[e2e] starting daemon (--tests)...")
const daemon = spawn("node", [join(DAEMON_PKG, "dist/index.js"), "--tests"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, AETHER_PORT: "13119" },
  detached: false,
})
daemon.stdout.on("data", b => process.stdout.write("[daemon] " + b))
daemon.stderr.on("data", b => process.stderr.write("[daemon!] " + b))
daemon.on("exit", code => console.log(`[e2e] daemon exited (code=${code})`))

await new Promise(r => setTimeout(r, 1500))

// 2. Spawn run.sh — builds DLL fresh, copies, launches Game.exe
console.log("[e2e] launching game (this builds DLL + launches Wine)...")
if (existsSync(LOG_PATH)) {
  try { unlinkSync(LOG_PATH) } catch {}
}
const game = spawn("bash", [join(NATIVE_PKG, "run.sh")], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, AETHER_DAEMON: "127.0.0.1:13119", AETHER_ENTRY: "main.ts" },
  detached: false,
})
game.stdout.on("data", b => process.stdout.write("[game] " + b))
game.stderr.on("data", b => process.stderr.write("[game!] " + b))

// 3. Tail aether_log.txt
let exitCode = 1
const deadline = Date.now() + timeoutSec * 1000
let resultsSeen = false
let pos = 0

function pollLog() {
  if (Date.now() > deadline) {
    console.error(`[e2e] TIMEOUT after ${timeoutSec}s waiting for "Results:" line`)
    cleanup(124)
    return
  }
  if (!existsSync(LOG_PATH)) {
    setTimeout(pollLog, 500)
    return
  }
  try {
    const fd = openSync(LOG_PATH, "r")
    const buf = Buffer.alloc(64 * 1024)
    let read
    do {
      read = readSync(fd, buf, 0, buf.length, pos)
      pos += read
      const chunk = buf.subarray(0, read).toString("utf8")
      if (chunk) process.stdout.write(chunk.replace(/^/gm, "[log] "))

      const m = chunk.match(/Results: (\d+) passed, (\d+) failed/)
      if (m) {
        const passed = parseInt(m[1], 10)
        const failed = parseInt(m[2], 10)
        console.log(`\n[e2e] DONE: ${passed} passed, ${failed} failed`)
        exitCode = failed === 0 ? 0 : 1
        resultsSeen = true
      }
    } while (read > 0)
    closeSync(fd)
  } catch (e) {
    console.error("[e2e] log read error:", e.message)
  }
  if (resultsSeen) {
    setTimeout(() => cleanup(exitCode), 1000)
    return
  }
  setTimeout(pollLog, 500)
}

function cleanup(code) {
  console.log(`[e2e] cleanup → exiting ${code}`)
  try { spawnSync("pkill", ["-9", "-f", "Game.exe"], { stdio: "ignore" }) } catch {}
  try { daemon.kill("SIGTERM") } catch {}
  setTimeout(() => process.exit(code), 500).unref()
}

process.on("SIGINT", () => cleanup(130))
process.on("SIGTERM", () => cleanup(143))

setTimeout(pollLog, 2000)
