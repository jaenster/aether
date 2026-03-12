import { createScript } from "diablo:game"

export const Chicken = createScript(function*(game, _svc) {
  while (true) {
    // Only chicken when in a non-town area
    const area = game.player.area
    if (area > 0 && !isTown(area)) {
      if (game.player.hpmax > 0 && game.player.hp > 0 && game.player.hp < game.player.hpmax * 0.3) {
        game.log('[chicken] low life — exiting game')
        game.exitGame()
      }
    }
    yield
  }
})

function isTown(area: number): boolean {
  return area === 1 || area === 40 || area === 75 || area === 103 || area === 109
}
