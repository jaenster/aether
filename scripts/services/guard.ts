import { createScript, type Game, Area } from "diablo:game"

/** Area-specific stuck timeouts (in seconds) */
const LONG_TIMEOUT_AREAS = new Set([
  Area.DuranceofHateLvl2,   // 101
  Area.DuranceofHateLvl3,   // 102
  Area.ChaosSanctuary,      // 108
  Area.ThroneofDestruction,  // 131
  Area.WorldstoneChamber,    // 132
])

const DEFAULT_TIMEOUT = 60
const LONG_TIMEOUT = 180

/** Guard/watchdog thread — detects stuck state and forces recovery.
 *  Runs as a background script, checks player position each tick. */
export const Guard = createScript(function*(game, _svc) {
  let lastX = 0
  let lastY = 0
  let stuckFrames = 0
  let lastArea = 0

  while (true) {
    yield

    if (!game.inGame) {
      stuckFrames = 0
      continue
    }

    const area = game.area
    const px = game.player.x
    const py = game.player.y

    // Reset on area change
    if (area !== lastArea) {
      lastArea = area
      stuckFrames = 0
      lastX = px
      lastY = py
      continue
    }

    // Check if position changed
    const dx = Math.abs(px - lastX)
    const dy = Math.abs(py - lastY)
    if (dx > 3 || dy > 3) {
      // Moved — reset stuck counter
      lastX = px
      lastY = py
      stuckFrames = 0
      continue
    }

    stuckFrames++

    // Determine timeout for current area (25fps)
    const timeoutSec = LONG_TIMEOUT_AREAS.has(area) ? LONG_TIMEOUT : DEFAULT_TIMEOUT
    const timeoutFrames = timeoutSec * 25

    if (stuckFrames >= timeoutFrames) {
      game.log(`[guard] STUCK for ${timeoutSec}s in area ${area} at ${px},${py} — forcing recovery`)
      stuckFrames = 0

      // Force exit game — the bot's main loop will handle reconnect
      game.exitGame()
    }

    // Warn at 50%
    if (stuckFrames === Math.floor(timeoutFrames / 2)) {
      game.log(`[guard] warning: no movement for ${Math.floor(timeoutSec / 2)}s in area ${area}`)
    }
  }
})
