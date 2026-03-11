import { createScript } from "diablo:game"

export const Chicken = createScript(function*(game, _svc) {
  while (true) {
    if (game.player.hp > 0 && game.player.hp < game.player.hpmax * 0.3) {
      game.log('[chicken] low life — exiting game')
      game.exitGame()
    }
    yield
  }
})
