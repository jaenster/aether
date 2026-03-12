import { createScript } from "diablo:game"

const EXIT_HP_PCT = 0.15     // Exit game below 15% — emergency chicken
const CHICKEN_HP_PCT = 0.3   // Log warning below 30% HP (future: TP to town)

export const Chicken = createScript(function*(game, _svc) {
  while (true) {
    const area = game.player.area
    if (area > 0 && !isTown(area) && game.player.hpmax > 0 && game.player.hp > 0) {
      const hpPct = game.player.hp / game.player.hpmax

      if (hpPct < EXIT_HP_PCT) {
        game.log(`[chicken] EMERGENCY hp=${game.player.hp}/${game.player.hpmax} — exiting game`)
        game.exitGame()
      } else if (hpPct < CHICKEN_HP_PCT) {
        game.log(`[chicken] low hp=${game.player.hp}/${game.player.hpmax}`)
        // TODO: TP to town when we have proper town-return flow
      }
    }
    yield
  }
})

function isTown(area: number): boolean {
  return area === 1 || area === 40 || area === 75 || area === 103 || area === 109
}
