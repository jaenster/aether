import { createBot } from "diablo:game"
import { Chicken } from "./threads/chicken.js"
import { Mephisto } from "./sequences/mephisto.js"
import { Chaos } from "./sequences/chaos.js"

export default createBot('sorc-farmer', function*(game, svc) {
  game.load.inGame(Chicken)

  while (true) {
    while (!game.inGame) yield
    yield* Chaos.factory(game, svc)
    game.exitGame()
    while (game.inGame) yield
    yield* game.delay(2000)
  }
})
