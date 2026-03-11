import { createScript } from "diablo:game"

export const Chicken = createScript(function*(game, _svc) {
  while (true) {
    if (game.me.hp > 0 && game.me.hp < game.me.hpmax * 0.3) {
      game.log('[chicken] low life — exiting game')
      game.exitGame()
    }
    yield
  }
})
