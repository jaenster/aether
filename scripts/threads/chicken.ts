import { createScript, ItemContainer } from "diablo:game"

const CHICKEN_HP_PCT = 0.3   // Drink pot below 30% HP
const HP_POT_CODES = new Set(['hp1', 'hp2', 'hp3', 'hp4', 'hp5', 'rvs', 'rvl'])

export const Chicken = createScript(function*(game, _svc) {
  let lastPotTick = 0
  let lastArea = 0
  let wasOutside = false

  while (true) {
    yield
    const area = game.player.area

    // Detect death: mode 0/17, OR sudden teleport to town from outside
    if (game.player.mode === 0 || game.player.mode === 17) {
      game.log(`[chicken] DEAD (mode=${game.player.mode}) — exiting game`)
      game.exitGame()
      yield* game.delay(3000)
      lastArea = 0
      wasOutside = false
      continue
    }

    // Track if we were outside — if we suddenly appear in town, we died and respawned
    if (area > 0 && !isTown(area)) {
      wasOutside = true
      lastArea = area
    } else if (wasOutside && isTown(area) && lastArea !== area) {
      // Were outside, now in town — did we TP or die?
      // If HP is full and we didn't use a TP, we probably died and respawned
      // (D2 SP auto-respawns with full HP in town)
      game.log(`[chicken] respawned in town from area ${lastArea} — treating as death`)
      wasOutside = false
      lastArea = area
      // Don't exit — just let the main loop handle the town cycle
    }

    const area = game.player.area
    if (area <= 0 || isTown(area) || game.player.hpmax <= 0 || game.player.hp <= 0) continue

    const hpPct = game.player.hp / game.player.hpmax
    if (hpPct < CHICKEN_HP_PCT && game._frame - lastPotTick > 25) {
      for (const item of game.items) {
        if (item.location === ItemContainer.Belt && HP_POT_CODES.has(item.code)) {
          game.log(`[chicken] drinking ${item.code} hp=${game.player.hp}/${game.player.hpmax}`)
          game.clickItem(0, item.unitId)
          lastPotTick = game._frame
          break
        }
      }
    }
  }
})

function isTown(area: number): boolean {
  return area === 1 || area === 40 || area === 75 || area === 103 || area === 109
}
