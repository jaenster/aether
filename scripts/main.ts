import { createBot } from "diablo:game"
import { Chicken } from "./threads/chicken.js"
import { ThreatMonitor } from "./threads/threat-monitor.js"
import { Chaos } from "./sequences/chaos.js"
import { Cows } from "./sequences/cows.js"
import { Pits } from "./sequences/pits.js"
import { AncientTunnels } from "./sequences/ancient-tunnels.js"
import { Town } from "./services/town.js"
import { Buffs } from "./services/buffs.js"

export default createBot('sorc-farmer', function*(game, svc) {
  game.load.inGame(Chicken)
  game.load.inGame(ThreatMonitor)
  const town = svc.get(Town)
  const buffs = svc.get(Buffs)

  while (true) {
    while (!game.inGame) yield;

    yield* game.run(function*() {
      // Skip town for testing
      // yield* town.doTownChores()
      // yield* buffs.refreshAll()

      yield* Pits.factory(game, svc)
      game.exitGame()
    }())

    while (game.inGame) yield
    yield* game.delay(2000)
  }
})
