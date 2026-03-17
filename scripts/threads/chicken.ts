import { createScript, ItemContainer } from "diablo:game"

const CHICKEN_HP_PCT = 0.3
const HP_POT_CODES = new Set(['hp1', 'hp2', 'hp3', 'hp4', 'hp5', 'rvs', 'rvl'])

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

    // ── Potion drinking ──
    if (area <= 0 || isTown(area) || game.player.hpmax <= 0 || game.player.hp <= 0) continue

    const hpPct = game.player.hp / game.player.hpmax
    if (hpPct < CHICKEN_HP_PCT && game._frame - lastPotTick > 25) {
      for (const item of game.items) {
        if (item.location === ItemContainer.Belt && HP_POT_CODES.has(item.code)) {
          game.log('[chicken] drinking ' + item.code + ' hp=' + game.player.hp + '/' + game.player.hpmax)
          game.clickItem(0, item.unitId)
          lastPotTick = game._frame
          break
        }
      }
    }
  }
})
