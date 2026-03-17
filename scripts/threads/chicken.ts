import { createScript, ItemContainer } from "diablo:game"

const CHICKEN_HP_PCT = 0.3   // Drink pot below 30% HP
const HP_POT_CODES = new Set(['hp1', 'hp2', 'hp3', 'hp4', 'hp5', 'rvs', 'rvl'])

export const Chicken = createScript(function*(game, _svc) {
  let lastPotTick = 0

  while (true) {
    yield
    const area = game.player.area
    if (area <= 0 || isTown(area) || game.player.hpmax <= 0 || game.player.hp <= 0) continue

    const hpPct = game.player.hp / game.player.hpmax
    if (hpPct < CHICKEN_HP_PCT && game._frame - lastPotTick > 25) {
      // Try to drink a healing potion from belt
      for (const item of game.items) {
        if (item.location === ItemContainer.Belt && HP_POT_CODES.has(item.code)) {
          game.log(`[chicken] drinking ${item.code} hp=${game.player.hp}/${game.player.hpmax}`)
          game.clickItem(0, item.unitId) // use item
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
