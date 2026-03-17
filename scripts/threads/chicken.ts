import { createScript } from "diablo:game"

function isTown(area: number): boolean {
  return area === 1 || area === 40 || area === 75 || area === 103 || area === 109
}

export const Chicken = createScript(function*(game, _svc) {
  let lastPotTick = 0
  let lastArea = 0
  let wasOutside = false

  while (true) {
    yield

    // ── Death detection ──
    // Player mode 0 = death animation, 17 = dead on ground
    const mode = game.player.mode
    if (mode === 0 || mode === 17) {
      game.log('[chicken] DEAD (mode=' + mode + ') — exiting game')
      game.exitGame()
      // Wait for game exit
      for (let i = 0; i < 100; i++) {
        yield
        if (!game.inGame) break
      }
      lastArea = 0
      wasOutside = false
      continue
    }

    const area = game.player.area

    // Track field→town transitions (respawn detection)
    if (area > 0 && !isTown(area)) {
      wasOutside = true
      lastArea = area
    } else if (wasOutside && isTown(area)) {
      game.log('[chicken] returned to town from area ' + lastArea)
      wasOutside = false
      lastArea = area
    }

    // Potion drinking handled by PotionDrinker thread — no duplication
  }
})
